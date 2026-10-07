/* Pocket Investing demo server: serves the app, the API, live updates and background jobs. */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const db = require('./db');
const { actions, housekeeping } = require('./logic');
const { createAccount, seedIfEmpty } = require('./seed');

const PORT = process.env.PORT || 3000;
const ADMINS = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const COOKIE = 'pi_session';
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });

/* ---------- sessions ---------- */
function readCookie(req){ const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([a-f0-9]{64})')); return m && m[1]; }
async function currentUser(req){
  const token = readCookie(req); if (!token) return null;
  const r = await db.pool.query('SELECT u.id, u.username, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()', [token]);
  return r.rows[0] || null;
}
function ctxFor(u){ return u ? { userId: u.id, pid: 'u_' + u.id, username: u.username, isAdmin: ADMINS.includes(u.username) } : { pid: null, isAdmin: false }; }
async function startSession(req, res, userId){
  const token = crypto.randomBytes(32).toString('hex');
  await db.pool.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [token, userId]);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

/* ---------- live updates ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(changes){
  if (!changes.length) return;
  const msg = JSON.stringify({ type: 'changes', changes });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
setInterval(() => { for (const c of wss.clients){ if (c.isAlive === false){ c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

/* ---------- auth routes ---------- */
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const actionLimit = rateLimit({ windowMs: 60000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little and try again.' } });
const clean = s => String(s || '').trim();

app.post('/api/signup', authLimit, async (req, res) => {
  try {
    const username = clean(req.body.username).toLowerCase(), password = String(req.body.password || ''), name = clean(req.body.name).slice(0, 40);
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) return res.status(400).json({ error: 'Usernames are 3 to 24 letters, numbers, dots or underscores.' });
    if (password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    if (!name) return res.status(400).json({ error: 'Add the name others will see.' });
    const exists = await db.pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (exists.rows.length) return res.status(400).json({ error: 'That username is taken.' });
    const id = db.newId(); const hash = await bcrypt.hash(password, 10);
    const risk = ['conservative','balanced','growth'].includes(req.body.risk) ? req.body.risk : 'balanced';
    const { changes } = await db.withTx(async tx => {
      await tx.query('INSERT INTO users (id, username, display_name, pass_hash) VALUES ($1, $2, $3, $4)', [id, username, name, hash]);
      await createAccount(tx, id, name, risk);
    });
    broadcast(changes);
    await startSession(req, res, id);
    res.json({ ok: true });
  } catch (e){ console.error(e); res.status(500).json({ error: 'Something went wrong. Try again.' }); }
});
app.post('/api/login', authLimit, async (req, res) => {
  try {
    const username = clean(req.body.username).toLowerCase();
    const r = await db.pool.query('SELECT id, pass_hash FROM users WHERE username = $1', [username]);
    if (!r.rows[0] || !(await bcrypt.compare(String(req.body.password || ''), r.rows[0].pass_hash))) return res.status(400).json({ error: "That username and password don't match." });
    const pid = 'u_' + r.rows[0].id;
    const has = await db.pool.query('SELECT 1 FROM doc_profiles WHERE id = $1', [pid]);
    if (!has.rows.length){ const u = await db.pool.query('SELECT display_name FROM users WHERE id = $1', [r.rows[0].id]); const { changes } = await db.withTx(tx => createAccount(tx, r.rows[0].id, u.rows[0].display_name)); broadcast(changes); }
    await startSession(req, res, r.rows[0].id);
    res.json({ ok: true });
  } catch (e){ console.error(e); res.status(500).json({ error: 'Something went wrong. Try again.' }); }
});
app.post('/api/logout', async (req, res) => {
  const token = readCookie(req); if (token) await db.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true });
});
app.get('/api/me', async (req, res) => {
  const u = await currentUser(req); const c = ctxFor(u);
  res.json({ signedIn: !!u, pid: c.pid, username: u && u.username, name: u && u.display_name, isAdmin: c.isAdmin });
});

/* ---------- data ---------- */
app.get('/api/state', async (req, res) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await db.snapshot()); }
  catch (e){ console.error(e); res.status(500).json({ error: 'Could not load data.' }); }
});
app.post('/api/action/:name', actionLimit, async (req, res) => {
  const fn = actions[req.params.name];
  if (!fn) return res.status(404).json({ error: 'Unknown action.' });
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Sign in to do that.' });
  try {
    const { out, changes } = await db.withTx(tx => fn(tx, ctxFor(u), req.body || {}));
    broadcast(changes);
    res.json({ ok: true, result: out === undefined ? null : out, changes });
  } catch (e){
    if (e.userFacing) return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---------- the app ---------- */
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { setHeaders(res, p){ if (/\.(html|webmanifest)$|sw\.js$/.test(p)) res.set('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

/* ---------- boot ---------- */
(async () => {
  await db.migrate();
  if (await seedIfEmpty(db.withTx)) console.log('Loaded sample data.');
  setInterval(async () => {
    try { const { changes } = await db.withTx(tx => housekeeping(tx)); broadcast(changes); }
    catch (e){ console.error('housekeeping', e.message); }
  }, 30000);
  setInterval(() => db.pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}), 3600000);
  server.listen(PORT, () => console.log('Pocket Investing demo running on port ' + PORT + (ADMINS.length ? ' (admins: ' + ADMINS.join(', ') + ')' : ' (no admins set: add ADMIN_USERNAMES)')));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
