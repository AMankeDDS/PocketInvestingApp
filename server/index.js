/* Pocket Investing demo server: the app, the API, live updates, push notifications,
   admin tools for the beta, and background jobs. */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const db = require('./db');
const push = require('./push');
const { actions, housekeeping, deleteAccountDocs } = require('./logic');
const { createAccount, seedIfEmpty } = require('./seed');

const PORT = process.env.PORT || 3000;
const ENV_ADMINS = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const COOKIE = 'pi_session';
const SESSION_DAYS = 30;
const TERMS_VERSION = 'draft-2026-10';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });
const q = (sql, p) => db.pool.query(sql, p);
const clean = s => String(s || '').trim();
const ok = (res, body = {}) => res.json(Object.assign({ ok: true }, body));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res) => fn(req, res).catch(e => { if (e.userFacing) return bad(res, e.message); console.error(e); bad(res, 'Something went wrong. Try again.', 500); });

/* ---------- sessions ---------- */
function readCookie(req){ const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([a-f0-9]{64})')); return m && m[1]; }
async function currentUser(req){
  const token = readCookie(req); if (!token) return null;
  const r = await q('SELECT u.id, u.username, u.display_name, u.is_admin, u.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now() AND NOT u.disabled', [token]);
  const u = r.rows[0]; if (!u) return null;
  if (!u.last_seen_at || Date.now() - new Date(u.last_seen_at).getTime() > 300000) q('UPDATE users SET last_seen_at = now() WHERE id = $1', [u.id]).catch(() => {});
  return u;
}
const isAdmin = u => !!u && (u.is_admin || ENV_ADMINS.includes(u.username));
function ctxFor(u){ return u ? { userId: u.id, pid: 'u_' + u.id, username: u.username, isAdmin: isAdmin(u) } : { pid: null, isAdmin: false }; }
async function startSession(req, res, userId){
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [token, userId]);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
const clearCookie = res => res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
const needUser = async (req, res) => { const u = await currentUser(req); if (!u){ bad(res, 'Sign in to do that.', 401); return null; } return u; };
const needAdmin = async (req, res) => { const u = await currentUser(req); if (!isAdmin(u)){ bad(res, 'Only demo admins can do that.', 403); return null; } return u; };
const logEvent = (userId, name, props) => q('INSERT INTO events (user_id, name, props) VALUES ($1, $2, $3)', [userId || null, String(name).slice(0, 60), props ? JSON.stringify(props) : null]).catch(() => {});

/* ---------- live updates ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcastRaw(obj){ const msg = JSON.stringify(obj); for (const c of wss.clients) if (c.readyState === 1) c.send(msg); }
function broadcast(changes){
  if (!changes.length) return;
  broadcastRaw({ type: 'changes', changes });
  push.fromChanges(db.pool, changes).catch(e => console.error('push', e.message));
}
setInterval(() => { for (const c of wss.clients){ if (c.isAlive === false){ c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const actionLimit = rateLimit({ windowMs: 60000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little and try again.' } });
const lightLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
const setting = async (key, dflt) => { const r = await q('SELECT value FROM settings WHERE key = $1', [key]); return r.rows[0] ? r.rows[0].value : dflt; };
const setSetting = (key, value) => q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

/* ---------- accounts ---------- */
app.post('/api/signup', authLimit, wrap(async (req, res) => {
  const username = clean(req.body.username).toLowerCase(), password = req.body.password, name = clean(req.body.name).slice(0, 40), code = clean(req.body.invite).toUpperCase();
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) return bad(res, 'Usernames are 3 to 24 letters, numbers, dots or underscores.');
  if (!validPassword(password)) return bad(res, 'Use a password of at least 8 characters.');
  if (!name) return bad(res, 'Add the name others will see.');
  if (!req.body.terms) return bad(res, 'Please accept the terms and privacy policy to continue.');
  if ((await q('SELECT 1 FROM users WHERE username = $1', [username])).rows.length) return bad(res, 'That username is taken.');
  const inviteOnly = (await setting('inviteOnly', true)) !== false;
  let useCode = null;
  if (inviteOnly && !ENV_ADMINS.includes(username)){
    if (!code) return bad(res, 'The beta is invite only. Enter your invite code.');
    const ic = (await q('SELECT * FROM invite_codes WHERE code = $1', [code])).rows[0];
    if (!ic || !ic.active || (ic.max_uses && ic.uses >= ic.max_uses)) return bad(res, "That invite code isn't valid or has been used up.");
    useCode = code;
  }
  const id = db.newId(); const hash = await bcrypt.hash(password, 10);
  const risk = ['conservative','balanced','growth'].includes(req.body.risk) ? req.body.risk : 'balanced';
  const { changes } = await db.withTx(async tx => {
    await tx.query('INSERT INTO users (id, username, display_name, pass_hash, invite_code, terms_accepted_at, terms_version) VALUES ($1, $2, $3, $4, $5, now(), $6)', [id, username, name, hash, useCode, TERMS_VERSION]);
    if (useCode) await tx.query('UPDATE invite_codes SET uses = uses + 1 WHERE code = $1', [useCode]);
    await createAccount(tx, id, name, risk);
  });
  broadcast(changes); logEvent(id, 'signup');
  await startSession(req, res, id); ok(res);
}));
app.post('/api/login', authLimit, wrap(async (req, res) => {
  const username = clean(req.body.username).toLowerCase();
  const u = (await q('SELECT id, pass_hash, display_name, disabled FROM users WHERE username = $1', [username])).rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.pass_hash))) return bad(res, "That username and password don't match.");
  if (u.disabled) return bad(res, 'This account has been turned off. Contact the Pocket Investing team.');
  if (!(await q('SELECT 1 FROM doc_profiles WHERE id = $1', ['u_' + u.id])).rows.length){ const { changes } = await db.withTx(tx => createAccount(tx, u.id, u.display_name)); broadcast(changes); }
  await startSession(req, res, u.id); logEvent(u.id, 'login'); ok(res);
}));
app.post('/api/logout', wrap(async (req, res) => { const t = readCookie(req); if (t) await q('DELETE FROM sessions WHERE token = $1', [t]); clearCookie(res); ok(res); }));
app.get('/api/me', wrap(async (req, res) => {
  const u = await currentUser(req); const c = ctxFor(u);
  res.json({ signedIn: !!u, pid: c.pid, username: u && u.username, name: u && u.display_name, isAdmin: c.isAdmin, inviteOnly: (await setting('inviteOnly', true)) !== false, pushKey: push.publicKey });
}));
app.post('/api/reset-password', authLimit, wrap(async (req, res) => {
  const username = clean(req.body.username).toLowerCase(), code = clean(req.body.code).toUpperCase();
  if (!validPassword(req.body.password)) return bad(res, 'Use a password of at least 8 characters.');
  const u = (await q('SELECT id FROM users WHERE username = $1', [username])).rows[0];
  const hashCode = crypto.createHash('sha256').update(code).digest('hex');
  const r = u && (await q('SELECT * FROM password_resets WHERE token_hash = $1 AND user_id = $2 AND NOT used AND expires_at > now()', [hashCode, u.id])).rows[0];
  if (!r) return bad(res, "That reset code isn't valid or has expired. Ask the Pocket team for a new one.");
  await q('UPDATE users SET pass_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.password, 10), u.id]);
  await q('UPDATE password_resets SET used = true WHERE token_hash = $1', [hashCode]);
  await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  await startSession(req, res, u.id); ok(res);
}));
app.post('/api/change-password', authLimit, wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  const row = (await q('SELECT pass_hash FROM users WHERE id = $1', [u.id])).rows[0];
  if (!(await bcrypt.compare(String(req.body.current || ''), row.pass_hash))) return bad(res, "Your current password isn't right.");
  if (!validPassword(req.body.password)) return bad(res, 'Use a new password of at least 8 characters.');
  await q('UPDATE users SET pass_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.password, 10), u.id]);
  await q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [u.id, readCookie(req)]);
  ok(res);
}));
app.post('/api/delete-account', authLimit, wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  const row = (await q('SELECT pass_hash FROM users WHERE id = $1', [u.id])).rows[0];
  if (!(await bcrypt.compare(String(req.body.password || ''), row.pass_hash))) return bad(res, "That password isn't right.");
  const { changes } = await db.withTx(async tx => { await deleteAccountDocs(tx, 'u_' + u.id); await tx.query('DELETE FROM users WHERE id = $1', [u.id]); await tx.query('DELETE FROM events WHERE user_id = $1', [u.id]); });
  broadcast(changes); clearCookie(res); ok(res);
}));

/* ---------- data and actions ---------- */
app.get('/api/state', wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await db.snapshot()); }));
app.post('/api/action/:name', actionLimit, wrap(async (req, res) => {
  const fn = actions[req.params.name]; if (!fn) return bad(res, 'Unknown action.', 404);
  const u = await needUser(req, res); if (!u) return;
  const { out, changes } = await db.withTx(tx => fn(tx, ctxFor(u), req.body || {}));
  broadcast(changes); logEvent(u.id, 'action:' + req.params.name);
  ok(res, { result: out === undefined ? null : out, changes });
}));
app.get('/api/export/trades.csv', wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  const pid = 'u_' + u.id;
  const trades = (await q(`SELECT data FROM doc_trades WHERE data->>'pid' = $1 ORDER BY (data->>'ts')::bigint`, [pid])).rows.map(r => r.data);
  const groups = Object.fromEntries((await q('SELECT id, data FROM doc_groups')).rows.map(r => [r.id, r.data.name]));
  const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['Date (UTC)','Symbol','Side','Shares','Price','Amount','Source','Group'].join(',')];
  for (const t of trades) lines.push([new Date(t.ts).toISOString().replace('T', ' ').slice(0, 19), t.sym, t.side, t.shares, t.price.toFixed(2), (t.shares * t.price).toFixed(2), t.copyOf ? (t.groupId ? 'Copied group trade' : 'Copied investor') : t.groupId ? 'Group trade (as Lead Trader)' : 'Personal', t.groupId ? groups[t.groupId] || '' : ''].map(esc).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="pocket-trades-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n') + '\n');
}));

/* ---------- feedback, errors, usage events ---------- */
app.post('/api/feedback', lightLimit, wrap(async (req, res) => {
  const u = await currentUser(req); const body = clean(req.body.text).slice(0, 4000); if (!body) return bad(res, 'Write a little about what you saw.');
  await q('INSERT INTO feedback (id, user_id, screen, body, ua) VALUES ($1, $2, $3, $4, $5)', [db.newId(), u && u.id, clean(req.body.screen).slice(0, 200), body, clean(req.headers['user-agent']).slice(0, 300)]);
  ok(res);
}));
app.post('/api/client-error', lightLimit, wrap(async (req, res) => {
  const u = await currentUser(req);
  await q('INSERT INTO client_errors (user_id, message, stack, url, ua) VALUES ($1, $2, $3, $4, $5)', [u && u.id, clean(req.body.message).slice(0, 500), clean(req.body.stack).slice(0, 4000), clean(req.body.url).slice(0, 300), clean(req.headers['user-agent']).slice(0, 300)]);
  await q('DELETE FROM client_errors WHERE id < (SELECT max(id) - 1000 FROM client_errors)');
  ok(res);
}));
app.post('/api/event', lightLimit, wrap(async (req, res) => {
  const u = await currentUser(req); const name = clean(req.body.name);
  if (/^view:[a-z]+$/.test(name)) logEvent(u && u.id, name);
  ok(res);
}));

/* ---------- push notifications ---------- */
app.post('/api/push/subscribe', wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  const sub = req.body.subscription; if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return bad(res, 'Invalid subscription.');
  await q('INSERT INTO push_subs (endpoint, user_id, sub) VALUES ($1, $2, $3) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, sub = EXCLUDED.sub', [sub.endpoint, u.id, JSON.stringify(sub)]);
  ok(res);
}));
app.post('/api/push/unsubscribe', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; await q('DELETE FROM push_subs WHERE endpoint = $1 AND user_id = $2', [String(req.body.endpoint || ''), u.id]); ok(res); }));
app.post('/api/push/test', lightLimit, wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  const n = await push.send(db.pool, ['u_' + u.id], { title: 'Notifications are on', body: "You'll get approval requests here, even when Pocket is closed.", url: '/#/inbox', tag: 'test' });
  ok(res, { sent: n });
}));

/* ---------- admin ---------- */
app.get('/api/admin/overview', wrap(async (req, res) => {
  if (!(await needAdmin(req, res))) return;
  const users = (await q(`SELECT u.id, u.username, u.display_name, u.is_admin, u.disabled, u.invite_code, u.created_at, u.last_seen_at, (SELECT count(*)::int FROM push_subs p WHERE p.user_id = u.id) AS push FROM users u ORDER BY u.created_at DESC`)).rows
    .map(x => Object.assign(x, { env_admin: ENV_ADMINS.includes(x.username) }));
  const invites = (await q('SELECT * FROM invite_codes ORDER BY created_at DESC')).rows;
  const feedback = (await q(`SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 200`)).rows;
  const errors = (await q(`SELECT e.*, u.username FROM client_errors e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 100`)).rows;
  ok(res, { users, invites, feedback, errors, inviteOnly: (await setting('inviteOnly', true)) !== false, announcement: await setting('announcement', null) });
}));
app.post('/api/admin/user', wrap(async (req, res) => {
  const me = await needAdmin(req, res); if (!me) return;
  const { userId, op } = req.body; const u = (await q('SELECT id, username FROM users WHERE id = $1', [userId])).rows[0]; if (!u) return bad(res, 'User not found.');
  if (op === 'reset'){
    const code = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
    await q(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '24 hours')`, [crypto.createHash('sha256').update(code).digest('hex'), u.id]);
    return ok(res, { code });
  }
  if (u.id === me.id && ['unadmin','disable'].includes(op)) return bad(res, "You can't do that to your own account.");
  if (op === 'admin') await q('UPDATE users SET is_admin = true WHERE id = $1', [u.id]);
  else if (op === 'unadmin') await q('UPDATE users SET is_admin = false WHERE id = $1', [u.id]);
  else if (op === 'disable'){ await q('UPDATE users SET disabled = true WHERE id = $1', [u.id]); await q('DELETE FROM sessions WHERE user_id = $1', [u.id]); }
  else if (op === 'enable') await q('UPDATE users SET disabled = false WHERE id = $1', [u.id]);
  else return bad(res, 'Unknown operation.');
  ok(res);
}));
app.post('/api/admin/invite', wrap(async (req, res) => {
  if (!(await needAdmin(req, res))) return;
  if (req.body.code && req.body.op === 'toggle'){ await q('UPDATE invite_codes SET active = NOT active WHERE code = $1', [req.body.code]); return ok(res); }
  const code = (clean(req.body.custom).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)) || ('PI-' + crypto.randomBytes(3).toString('hex').toUpperCase());
  if ((await q('SELECT 1 FROM invite_codes WHERE code = $1', [code])).rows.length) return bad(res, 'That code already exists.');
  const max = Number(req.body.maxUses) > 0 ? Math.min(10000, Math.floor(Number(req.body.maxUses))) : null;
  await q('INSERT INTO invite_codes (code, label, max_uses) VALUES ($1, $2, $3)', [code, clean(req.body.label).slice(0, 60) || null, max]);
  ok(res, { code });
}));
app.post('/api/admin/feedback', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; await q(`UPDATE feedback SET status = CASE WHEN status = 'open' THEN 'done' ELSE 'open' END WHERE id = $1`, [req.body.id]); ok(res); }));
app.post('/api/admin/errors/clear', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; await q('DELETE FROM client_errors'); ok(res); }));
app.post('/api/admin/settings', wrap(async (req, res) => {
  if (!(await needAdmin(req, res))) return;
  const changes = [];
  if (typeof req.body.inviteOnly === 'boolean'){ await setSetting('inviteOnly', req.body.inviteOnly); changes.push({ setting: 'inviteOnly', value: req.body.inviteOnly }); }
  if ('announcement' in req.body){ const t = clean(req.body.announcement).slice(0, 300); const v = t ? { text: t, ts: Date.now() } : null; await setSetting('announcement', v); changes.push({ setting: 'announcement', value: v }); }
  broadcastRaw({ type: 'changes', changes }); ok(res);
}));
app.get('/api/admin/usage', wrap(async (req, res) => {
  if (!(await needAdmin(req, res))) return;
  const one = async (sql, p) => (await q(sql, p)).rows[0];
  const active = async days => (await one(`SELECT count(DISTINCT user_id)::int AS n FROM events WHERE user_id IS NOT NULL AND ts > now() - ($1 || ' days')::interval`, [days])).n;
  const users = (await one('SELECT count(*)::int AS n FROM users')).n;
  const ret = await one(`SELECT count(*)::int AS cohort, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.ts >= u.created_at + interval '7 days' AND e.ts < u.created_at + interval '14 days'))::int AS kept
    FROM users u WHERE u.created_at < now() - interval '7 days' AND u.created_at > now() - interval '90 days'`);
  const actions = (await q(`SELECT name, count(*)::int AS n FROM events WHERE name LIKE 'action:%' AND ts > now() - interval '7 days' GROUP BY name ORDER BY n DESC LIMIT 12`)).rows;
  const views = (await q(`SELECT name, count(*)::int AS n FROM events WHERE name LIKE 'view:%' AND ts > now() - interval '7 days' GROUP BY name ORDER BY n DESC LIMIT 12`)).rows;
  const daily = (await q(`SELECT to_char(date_trunc('day', ts), 'Mon DD') AS day, count(DISTINCT user_id)::int AS n FROM events WHERE user_id IS NOT NULL AND ts > now() - interval '14 days' GROUP BY date_trunc('day', ts) ORDER BY date_trunc('day', ts)`)).rows;
  const signups = (await one(`SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '7 days'`)).n;
  const pushUsers = (await one('SELECT count(DISTINCT user_id)::int AS n FROM push_subs')).n;
  ok(res, { users, dau: await active(1), wau: await active(7), mau: await active(30), signups7: signups, retention: ret.cohort ? { cohort: ret.cohort, kept: ret.kept } : null, actions, views, daily, pushUsers });
}));

app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---------- the app ---------- */
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { setHeaders(res, p){ if (/\.(html|webmanifest)$|sw\.js$/.test(p)) res.set('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

/* ---------- boot ---------- */
(async () => {
  await db.migrate();
  await push.init(db.pool);
  if (await seedIfEmpty(db.withTx)) console.log('Loaded sample data.');
  setInterval(async () => {
    try { const { changes } = await db.withTx(tx => housekeeping(tx)); broadcast(changes); }
    catch (e){ console.error('housekeeping', e.message); }
  }, 30000);
  setInterval(() => { q('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}); q(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`).catch(() => {}); }, 3600000);
  server.listen(PORT, () => console.log('Pocket Investing demo running on port ' + PORT + (ENV_ADMINS.length ? ' (admins: ' + ENV_ADMINS.join(', ') + ')' : ' (no admins set: add ADMIN_USERNAMES)')));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
