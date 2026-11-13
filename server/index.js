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
const config = require('./config');
const real = require('./real');
const marketdata = require('./marketdata');
const metrics = require('./metrics');
const stats = require('./stats');
const vis = require('./visibility');
const club = require('./club');
const Market = require('./market');
const totp = require('./totp');

const PORT = process.env.PORT || 3000;
const ENV_ADMINS = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const COOKIE = 'pi_session';
const SESSION_DAYS = 30;
const TERMS_VERSION = 'draft-2026-10';

const app = express();
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:", "connect-src 'self' ws: wss:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "worker-src 'self'", "manifest-src 'self'"].join('; ');
app.use((req, res, next) => {
  res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin' });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
/* Changes must come from Pocket's own pages: a request carrying another site's Origin is refused. */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin; if (!o) return next();
  let h = null; try { h = new URL(o).host; } catch (e){}
  if (h && (h === req.headers.host || ALLOWED_ORIGINS.includes(o))) return next();
  res.status(403).json({ error: 'Request blocked: it came from another website.' });
});
/* Admin activity log: every admin change is recorded. */
app.use((req, res, next) => {
  const p = req.path, isAdminCall = req.method === 'POST' && (p.startsWith('/api/admin/') || /^\/api\/action\/(demo|setClock|admin)/.test(p) || /^\/api\/admin/.test(p));
  if (!isAdminCall) return next();
  res.on('finish', async () => { try { const u = await currentUser(req); if (!u || !isAdmin(u)) return;
    const b = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => !/password|code|secret|file|data|token/i.test(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 80) : v]));
    await q('INSERT INTO admin_log (user_id, action, detail, status) VALUES ($1, $2, $3, $4)', [u.id, p.replace('/api/', ''), JSON.stringify(b).slice(0, 500), res.statusCode]); } catch (e){} });
  next();
});
/* Acting as a test account: security settings are off-limits and every change is logged under the admin. */
app.use(async (req, res, next) => {
  if (req.method !== 'POST' || !req.path.startsWith('/api/') || req.path === '/api/act-as/stop') return next();
  let u = null; try { u = await currentUser(req); } catch (e){}
  if (!u || !u.acting_admin) return next();
  if (/^\/api\/(change-password|2fa\/|logout|admin\/)/.test(req.path)) return res.status(403).json({ error: "That isn't available while acting as a test account." });
  res.on('finish', () => { const b = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => !/password|code|secret|file|data|token/i.test(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 80) : v]));
    q('INSERT INTO admin_log (user_id, action, detail, status) VALUES ($1, $2, $3, $4)', [u.acting_admin, 'as ' + u.username + ': ' + req.path.replace('/api/', ''), JSON.stringify(b).slice(0, 500), res.statusCode]).catch(() => {}); });
  next();
});
/* Read-only mode: blocks changes while an issue is fixed (admins can still act). */
app.use(async (req, res, next) => {
  if (req.method !== 'POST' || !/^\/api\/(action|real|club|statements)\//.test(req.path)) return next();
  try { const m = await setting('maintenance', null); if (!m || !m.on) return next(); const u = await currentUser(req); if (isAdmin(u)) return next();
    return res.status(503).json({ error: m.message || 'Pocket is read-only for a few minutes while we fix an issue. Your account is safe; try again soon.' }); } catch (e){ next(); }
});
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(require('compression')());
const jsonSmall = express.json({ limit: '50kb' }), jsonLarge = express.json({ limit: '8mb' });
app.use((req, res, next) => (/^\/api\/club\/[^/]+\/(submit|taxdoc)$/.test(req.path) || req.path === '/api/photo' || req.path === '/api/support' ? jsonLarge : jsonSmall)(req, res, next));
const visitSeen = new Map();
/* Referral links: pocketinvesting.com/r/CODE */
app.get('/r/:code', (req, res) => res.redirect(302, '/#/ref/' + String(req.params.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16)));
app.get(['/j/:code', '/j/:code/:by'], (req, res) => {
  const code = String(req.params.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16), by = String(req.params.by || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  res.redirect(302, '/#/invite/' + code + (by ? '/' + by : ''));
});
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });
const q = (sql, p) => db.pool.query(sql, p);
const clean = s => String(s || '').trim();
const ok = (res, body = {}) => res.json(Object.assign({ ok: true }, body));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res) => fn(req, res).catch(e => { if (e.userFacing) return bad(res, e.message); console.error(e); try { noteError(); } catch (x){} bad(res, 'Something went wrong. Try again.', 500); });

/* ---------- sessions ---------- */
function readCookie(req){ const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([a-f0-9]{64})')); return m && m[1]; }
async function currentUser(req){
  const token = readCookie(req); if (!token) return null;
  const r = await q('SELECT s.last_used_at, s.acting_admin, s.expires_at AS session_expires, u.is_test, u.id, u.username, u.display_name, u.is_admin, u.last_seen_at, u.totp_enabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now() AND NOT u.disabled', [token]);
  const u = r.rows[0]; if (!u) return null;
  if (config.sessionIdleMin > 0){
    const used = u.last_used_at ? new Date(u.last_used_at).getTime() : Date.now();
    if (Date.now() - used > config.sessionIdleMin * 60000){ q('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {}); return null; }
    if (!u.last_used_at || Date.now() - used > 60000) q('UPDATE sessions SET last_used_at = now() WHERE token = $1', [token]).catch(() => {});
  }
  if (!u.last_seen_at || Date.now() - new Date(u.last_seen_at).getTime() > 300000) q('UPDATE users SET last_seen_at = now() WHERE id = $1', [u.id]).catch(() => {});
  return u;
}
const isAdminAccount = u => !!u && (u.is_admin || ENV_ADMINS.includes(u.username));
/* Admin powers need two-step sign-in (unless ADMIN_REQUIRE_2FA is turned off for testing). */
const isAdmin = u => isAdminAccount(u) && (!config.adminRequire2fa || !!u.totp_enabled);
function ctxFor(u){ return u ? { userId: u.id, pid: 'u_' + u.id, username: u.username, isAdmin: isAdmin(u), adminPending: isAdminAccount(u) && !isAdmin(u), twoStep: !!u.totp_enabled } : { pid: null, isAdmin: false }; }
async function startSession(req, res, userId){
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [token, userId]);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
const clearCookie = res => res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
const needUser = async (req, res) => { const u = await currentUser(req); if (!u){ bad(res, 'Sign in to do that.', 401); return null; } return u; };
const needAdmin = async (req, res) => { const u = await currentUser(req); if (!isAdmin(u)){ bad(res, isAdminAccount(u) ? 'Turn on two-step sign-in in your Profile to use admin tools.' : 'Only demo admins can do that.', 403); return null; } return u; };
const logEvent = (userId, name, props) => q('INSERT INTO events (user_id, name, props) VALUES ($1, $2, $3)', [userId || null, String(name).slice(0, 60), props ? JSON.stringify(props) : null]).catch(() => {});

/* ---------- live updates ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcastRaw(obj){ const msg = JSON.stringify(obj); for (const c of wss.clients) if (c.readyState === 1) c.send(msg); }
/* Live updates are filtered per person. When memberships or groups change, each open app's
   access is recomputed, and anyone whose groups changed reloads to pick up what they can now see. */
const lookupDoc = async (col, id) => { const t = { posts: 'doc_posts', proposals: 'doc_proposals' }[col]; if (!t || !id) return null; const r = await q(`SELECT id, data FROM ${t} WHERE id = $1`, [id]); return r.rows[0] ? Object.assign({ id: r.rows[0].id }, r.rows[0].data) : null; };
async function sharedForVis(){ const ms = (await q('SELECT data FROM doc_memberships')).rows.map(r => r.data); const gs = (await q('SELECT id, data FROM doc_groups')).rows.map(r => Object.assign({ id: r.id }, r.data)); const bl = (await q('SELECT data FROM doc_blocks').catch(() => ({ rows: [] }))).rows.map(r => r.data); return { bl, ms, gs }; }
async function visCtx(userId, admin, shared){ shared = shared || await sharedForVis(); return vis.makeCtx({ pid: userId ? 'u_' + userId : null, isAdmin: !!admin }, shared.ms, shared.gs, config.sampleData, shared.bl || []); }
async function broadcast(changes){
  if (!changes || !changes.length) return;
  for (const n of changes.filter(c => c.col === '_notify')) push.send(db.pool, n.pids, n.payload).catch(() => {});
  changes = changes.filter(c => c.col !== '_notify'); if (!changes.length) return;
  push.fromChanges(db.pool, changes).catch(e => console.error('push', e.message));
  try {
    const structural = changes.some(c => c.wipe || c.col === 'memberships' || c.col === 'groups' || c.col === 'blocks');
    const shared = structural || [...wss.clients].some(c => !c.ctx) ? await sharedForVis() : null;
    for (const c of wss.clients){
      if (c.readyState !== 1) continue;
      try {
        if (structural || !c.ctx){
          const before = c.ctx ? JSON.stringify(c.ctx.role) : null;
          c.ctx = await visCtx(c.userId, c.isAdmin, shared);
          if (before !== null && before !== JSON.stringify(c.ctx.role)){ c.send(JSON.stringify({ type: 'resync' })); continue; }
        }
        c.send(JSON.stringify({ type: 'changes', changes: await vis.filterChanges(c.ctx, changes, lookupDoc) }));
      } catch (e){}
    }
  } catch (e){ console.error('broadcast', e.message); }
}
setInterval(() => { for (const c of wss.clients){ if (c.isAlive === false){ c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
wss.on('connection', async (ws, req) => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  try { const u = await currentUser(req); if (u){ ws.userId = u.id; ws.isAdmin = isAdmin(u); } } catch (e){}
});
/* Private messages (real balances, order fills) go only to that person's open sessions. */
function sendTo(userId, obj){ const msg = JSON.stringify(obj); for (const c of wss.clients) if (c.readyState === 1 && c.userId === userId) c.send(msg); }

const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const actionLimit = rateLimit({ windowMs: 60000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little and try again.' } });
const lightLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
const setting = async (key, dflt) => { const r = await q('SELECT value FROM settings WHERE key = $1', [key]); return r.rows[0] ? r.rows[0].value : dflt; };
const setSetting = (key, value) => q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

/* ---------- accounts ---------- */
app.post('/api/signup', authLimit, wrap(async (req, res) => {
  if (config.demoSite && !ENV_ADMINS.includes(String(req.body.username || '').trim().toLowerCase())) return bad(res, "The demo doesn't create accounts. Request an invite to the beta at pocketinvesting.com.");
  const username = clean(req.body.username).toLowerCase(), password = req.body.password, name = clean(req.body.name).slice(0, 40), code = clean(req.body.invite).toUpperCase();
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) return bad(res, 'Usernames are 3 to 24 letters, numbers, dots or underscores.');
  if (!validPassword(password)) return bad(res, 'Use a password of at least 8 characters.');
  if (!name) return bad(res, 'Add the name others will see.');
  if (!req.body.terms) return bad(res, 'Please accept the terms and privacy policy to continue.');
  if (req.body.adult !== true) return bad(res, 'Please confirm you are 18 or older to use Pocket.');
  if ((await q('SELECT 1 FROM users WHERE username = $1', [username])).rows.length) return bad(res, 'That username is taken.');
  const inviteOnly = (await setting('inviteOnly', true)) !== false;
  let useCode = null;
  /* A member's group invite link counts as an invite to the beta. */
  const gcode = clean(req.body.groupInvite).toUpperCase().slice(0, 16);
  const ginv = gcode ? (await q(`SELECT id, data FROM doc_groups WHERE upper(data->>'inviteCode') = $1 AND coalesce((data->>'inviteOff')::boolean, false) = false`, [gcode])).rows[0] : null;
  const src = req.body.source && typeof req.body.source === 'object' ? req.body.source : {};
  const source = ginv ? 'group-invite' : ['ad', 'campaign'].includes(src.kind) ? src.kind : code ? 'beta-code' : 'direct';
  const sourceDetail = ginv ? ginv.id : String(src.detail || '').slice(0, 120) || null;
  const rcode = clean(req.body.ref).toUpperCase().slice(0, 16), refBy = rcode ? (await q('SELECT id FROM users WHERE ref_code = $1', [rcode]).catch(() => ({ rows: [] }))).rows[0] : null;
  if (inviteOnly && !ENV_ADMINS.includes(username) && !ginv && !refBy){
    if (!code) return bad(res, 'The beta is invite only. Enter your invite code.');
    const ic = (await q('SELECT * FROM invite_codes WHERE code = $1', [code])).rows[0];
    if (!ic || !ic.active || (ic.max_uses && ic.uses >= ic.max_uses)) return bad(res, "That invite code isn't valid or has been used up.");
    useCode = code;
  }
  const id = db.newId(); const hash = await bcrypt.hash(password, 10);
  const risk = ['conservative','balanced','growth','dividends'].includes(req.body.risk) ? req.body.risk : 'balanced';
  const { changes } = await db.withTx(async tx => {
    await tx.query('INSERT INTO users (id, username, display_name, pass_hash, invite_code, terms_accepted_at, terms_version, signup_source, signup_detail) VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)', [id, username, name, hash, useCode, TERMS_VERSION, source, sourceDetail]);
    if (useCode) await tx.query('UPDATE invite_codes SET uses = uses + 1 WHERE code = $1', [useCode]);
    if (refBy) await tx.query('UPDATE users SET referred_by = $2 WHERE id = $1', [id, refBy.id]);
    await tx.query('UPDATE users SET adult_confirmed_at = now() WHERE id = $1', [id]);
    await createAccount(tx, id, name, risk);
  });
  broadcast(changes); logEvent(id, 'signup', { source });
  await startSession(req, res, id); ok(res);
}));
/* Security activity: recorded for the account holder to review, with a push alert for sign-ins and changes. */
async function securityEvent(req, userId, kind, detail, alert){
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60), ua = String(req.headers['user-agent'] || '').slice(0, 200);
  await q('INSERT INTO security_events (user_id, kind, detail, ip, ua) VALUES ($1, $2, $3, $4, $5)', [userId, kind, detail || null, ip, ua]).catch(() => {});
  if (alert) push.send(db.pool, ['u_' + userId], { title: 'Pocket Investing security', body: alert, url: '/#/u/u_' + userId, tag: 'security' }).catch(() => {});
}
const deviceName = ua => { ua = String(ua || ''); const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'a browser'; const o = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'a device'; return b + ' on ' + o; };
const failedLogins = new Map();
app.post('/api/login', authLimit, wrap(async (req, res) => {
  const username = clean(req.body.username).toLowerCase();
  const recent = (failedLogins.get(username) || []).filter(t => Date.now() - t < 15 * 60000);
  if (recent.length >= 10) return bad(res, 'Too many wrong passwords for this account. Try again in 15 minutes.', 429);
  const u = (await q('SELECT id, pass_hash, display_name, disabled, totp_enabled, totp_secret FROM users WHERE username = $1', [username])).rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.pass_hash))){
    recent.push(Date.now()); failedLogins.set(username, recent);
    if (u && recent.length === 10) securityEvent(req, u.id, 'lockout', 'Sign-in paused after 10 wrong passwords', 'Someone entered the wrong password for your account 10 times. Sign-in is paused for 15 minutes.');
    return bad(res, "That username and password don't match."); }
  if (u.disabled) return bad(res, 'This account has been turned off. Contact the Pocket Investing team.');
  if (u.totp_enabled){
    if (!req.body.code) return res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app.', need2fa: true });
    const secret = totp.open(u.totp_secret, config.appSecret);
    if (!secret || !totp.verify(secret, req.body.code)){
      if (await require('./backup').use(q, u.id, req.body.code)) securityEvent(req, u.id, 'two-step', 'Backup code used to sign in', 'A two-step backup code was used to sign in. Each code works once. If this wasn\'t you, change your password now.');
      else { recent.push(Date.now()); failedLogins.set(username, recent); return res.status(400).json({ error: "That code didn't match. Try the newest code, or a backup code.", need2fa: true }); } }
  }
  failedLogins.delete(username);
  if (!(await q('SELECT 1 FROM doc_profiles WHERE id = $1', ['u_' + u.id])).rows.length){ const { changes } = await db.withTx(tx => createAccount(tx, u.id, u.display_name)); broadcast(changes); }
  await startSession(req, res, u.id); logEvent(u.id, 'login');
  securityEvent(req, u.id, 'sign-in', deviceName(req.headers['user-agent']), 'New sign-in on ' + deviceName(req.headers['user-agent']) + '. If this wasn\'t you, change your password now.');
  ok(res);
}));
app.post('/api/logout', wrap(async (req, res) => { const t = readCookie(req); if (t) await q('DELETE FROM sessions WHERE token = $1', [t]); clearCookie(res); ok(res); }));
/* Members who joined before the 18+ question confirm once. */
app.post('/api/confirm-adult', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; if (req.body.adult !== true) return bad(res, 'Please confirm you are 18 or older.'); await q('UPDATE users SET adult_confirmed_at = now() WHERE id = $1 AND adult_confirmed_at IS NULL', [u.id]); ok(res); }));
app.get('/api/me', wrap(async (req, res) => {
  const u = await currentUser(req); const c = ctxFor(u);
  if (u && !u.acting_admin){ const day = new Date().toISOString().slice(0, 10); if (visitSeen.get(u.id) !== day){ visitSeen.set(u.id, day); logEvent(u.id, 'visit', {}); db.withTx(async tx => { if (await tx.get('profiles', 'u_' + u.id)) await tx.update('profiles', 'u_' + u.id, { lastActiveTs: Date.now() }); }).then(r => broadcast(r.changes)).catch(() => {}); } }
  const tf = u ? (await q('SELECT totp_enabled FROM users WHERE id = $1', [u.id])).rows[0] : null;
  const needsAdult = u && !u.acting_admin ? !(await q('SELECT adult_confirmed_at FROM users WHERE id = $1', [u.id])).rows[0].adult_confirmed_at : false;
  res.json({ needsAdult, signedIn: !!u, pid: c.pid, username: u && u.username, name: u && u.display_name, isAdmin: c.isAdmin, inviteOnly: (await setting('inviteOnly', true)) !== false, pushKey: push.publicKey,
    actingAs: u && u.acting_admin ? { admin: ((await q('SELECT display_name FROM users WHERE id = $1', [u.acting_admin])).rows[0] || {}).display_name || 'Admin', until: new Date(u.session_expires).getTime() } : null, isTest: !!(u && u.is_test),
    twofa: !!(tf && tf.totp_enabled), adminAccount: isAdminAccount(u), adminNeeds2fa: isAdminAccount(u) && !isAdmin(u), maintenance: await setting('maintenance', null), site: config.publicInfo(), accountNumber: u ? await require('./accounts').personal('u_' + u.id).catch(() => null) : null });
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
  securityEvent(req, u.id, 'password', 'Password reset with a code', 'Your password was reset and other devices were signed out.');
  await startSession(req, res, u.id); ok(res);
}));
app.post('/api/change-password', authLimit, wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  const row = (await q('SELECT pass_hash FROM users WHERE id = $1', [u.id])).rows[0];
  if (!(await bcrypt.compare(String(req.body.current || ''), row.pass_hash))) return bad(res, "Your current password isn't right.");
  if (!validPassword(req.body.password)) return bad(res, 'Use a new password of at least 8 characters.');
  await q('UPDATE users SET pass_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.password, 10), u.id]);
  await q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [u.id, readCookie(req)]);
  securityEvent(req, u.id, 'password', 'Password changed; other sessions signed out', 'Your password was changed and other devices were signed out.');
  ok(res);
}));
app.post('/api/delete-account', authLimit, wrap(async (req, res) => {
  const u = await needUser(req, res); if (!u) return;
  if (u.acting_admin) return bad(res, "You can't delete an account while acting as a test account.");
  const row = (await q('SELECT pass_hash, totp_enabled, totp_secret, username FROM users WHERE id = $1', [u.id])).rows[0];
  if (!(await bcrypt.compare(String(req.body.password || ''), row.pass_hash))) return bad(res, "That password isn't right.");
  if (row.totp_enabled){ const secret = require('./totp').open(row.totp_secret, config.appSecret);
    if (!req.body.code) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app to confirm.', needCode: true });
    if (!secret || !require('./totp').verify(secret, req.body.code)) return res.status(401).json({ error: "That code didn't match. Try the newest code.", needCode: true }); }
  if (String(req.body.confirm || '') !== 'DELETE') return bad(res, 'Type DELETE to confirm.');
  /* Group owners hand over first. */
  const owned = (await q(`SELECT g.id, g.data->>'name' AS name FROM doc_groups g WHERE g.data->>'ownerPid' = $1 AND EXISTS (SELECT 1 FROM doc_memberships m WHERE m.data->>'gid' = g.id AND m.data->>'pid' <> $1)`, ['u_' + u.id])).rows;
  if (owned.length) return bad(res, `You own ${owned.map(g => g.name).join(', ')}. Transfer ownership to another member first, then delete your account.`);
  /* Real money: the brokerage account must be empty, then it is closed with the broker and the records are kept. */
  const ba = (await q('SELECT * FROM broker_accounts WHERE user_id = $1', [u.id]).catch(() => ({ rows: [] }))).rows[0];
  if (ba && ba.alpaca_id){
    const alp = require('./alpaca');
    try { const tr = (await alp.listTransfers(ba.alpaca_id)) || [], t = await alp.tradingAccount(ba.alpaca_id), pos = (await alp.positions(ba.alpaca_id)) || [];
      if (pos.length || Number(t.equity || 0) > 0.009 || Number(t.cash || 0) > 0.009) return bad(res, 'Sell your holdings and withdraw your full balance first. Then you can close your account.');
      /* money still on its way in or out also blocks closing */
      const pending = (Array.isArray(tr) ? tr : []).some(x => !['COMPLETE', 'RETURNED', 'CANCELED', 'REJECTED'].includes(String(x.status || '').toUpperCase()));
      const localPending = (await q(`SELECT 1 FROM real_transfers WHERE user_id = $1 AND upper(status) NOT IN ('COMPLETE','RETURNED','CANCELED','REJECTED') LIMIT 1`, [u.id]).catch(() => ({ rows: [] }))).rows.length;
      if (pending || localPending) return bad(res, 'A deposit or withdrawal is still on its way. Once it finishes and your balance is $0, you can close your account.'); }
    catch (e){ return bad(res, "We couldn't check your brokerage account right now. Try again in a few minutes."); }
    try { await alp.closeAccount(ba.alpaca_id); } catch (e){ return bad(res, "Your brokerage account couldn't be closed right now. Try again later, or contact us."); }
    await q(`UPDATE broker_accounts SET status = 'CLOSED' WHERE user_id = $1`, [u.id]).catch(() => {});
  }
  await q('INSERT INTO admin_log (user_id, action, detail, status) VALUES ($1, $2, $3, $4)', [u.id, 'account-deleted', JSON.stringify({ username: row.username, brokerage: !!ba }), 200]).catch(() => {});
  const { changes } = await db.withTx(async tx => {
    await deleteAccountDocs(tx, 'u_' + u.id); await tx.query('DELETE FROM events WHERE user_id = $1', [u.id]);
    await tx.query('DELETE FROM photos WHERE key = $1', ['u_' + u.id]).catch(() => {});
    if (ba){ /* keep the user row (and with it the brokerage records), but remove anything personal and any way to sign in */
      await tx.query(`UPDATE users SET username = $2, display_name = 'Deleted member', pass_hash = $3, totp_enabled = false, totp_secret = NULL WHERE id = $1`, [u.id, 'deleted_' + u.id, await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10)]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [u.id]).catch(() => {});
    } else await tx.query('DELETE FROM users WHERE id = $1', [u.id]);
  });
  broadcast(changes); clearCookie(res); ok(res);
}));

/* ---------- data and actions ---------- */
app.get('/api/state', wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); const snap = await db.snapshot();
  { const u = await currentUser(req), C = snap.collections || {};
    const ctx = vis.makeCtx({ pid: u ? 'u_' + u.id : null, isAdmin: isAdmin(u) }, C.memberships || [], C.groups || [], config.sampleData, C.blocks || []);
    snap.collections = await vis.filterCollections(ctx, C, lookupDoc); } snap.market = { extras: marketdata.extras(), bases: marketdata.bases(), quotes: config.realPrices ? Market.QUOTES : {} }; res.json(snap); }));
app.get('/api/admin/log', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; ok(res, { log: (await q(`SELECT l.action, l.detail, l.status, l.ts, u.username FROM admin_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200`)).rows }); }));
/* Site notice (a banner for everyone) and read-only mode (blocks changes while an issue is fixed). */
app.post('/api/admin/maintenance', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
  await setSetting('maintenance', req.body.on ? { on: true, message: clean(req.body.message).slice(0, 300) || null, ts: Date.now() } : null); broadcastRaw({ type: 'notice' }); ok(res); }));
/* Error spikes alert the admins (at most once an hour). */
const errorTimes = []; let lastErrorAlert = 0;
function noteError(){
  const now = Date.now(); errorTimes.push(now); while (errorTimes.length && now - errorTimes[0] > 10 * 60000) errorTimes.shift();
  if (errorTimes.length >= 10 && now - lastErrorAlert > 3600000){ lastErrorAlert = now;
    q(`SELECT id FROM users WHERE is_admin OR lower(username) = ANY($1)`, [ENV_ADMINS]).then(r => push.send(db.pool, r.rows.map(x => 'u_' + x.id), { title: 'Pocket Investing: errors spiking', body: errorTimes.length + ' errors in the last 10 minutes. Check Beta admin, Errors, and consider posting a status update.', url: '/#/admin', tag: 'errors' })).catch(() => {}); }
}
app.get('/api/security-events', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; ok(res, { events: (await q('SELECT kind, detail, ts FROM security_events WHERE user_id = $1 ORDER BY id DESC LIMIT 15', [u.id])).rows }); }));
/* ---------- test accounts and "Act as" (sandbox only) ---------- */
const sandboxOnly = res => { if (!config.realMoney || config.alpaca.env !== 'sandbox'){ bad(res, 'Test accounts are only available on the real-money site while it uses the sandbox.', 403); return false; } return true; };
const cookieVal = (req, name) => { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([a-f0-9]{64})')); return m && m[1]; };
const setCookie = (req, res, name, val, maxAge) => { const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'; res.append('Set-Cookie', `${name}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`); };
app.post('/api/admin/test-accounts', wrap(async (req, res) => {
  const a = await needAdmin(req, res); if (!a || !sandboxOnly(res)) return;
  const count = Math.max(1, Math.min(10, Math.floor(Number(req.body.count) || 1))), deposit = Math.max(0, Math.min(50000, Number(req.body.deposit) || 0));
  let n = Number((await q('SELECT count(*)::int AS n FROM users WHERE is_test')).rows[0].n), made = [];
  for (let i = 0; i < count; i++){
    n++; const id = db.newId(), username = 'test' + n + '_' + crypto.randomBytes(2).toString('hex'), name = 'Test User ' + n;
    const { changes } = await db.withTx(async tx => {
      await tx.query('INSERT INTO users (id, username, display_name, pass_hash, terms_accepted_at, terms_version, signup_source, signup_detail, is_test) VALUES ($1, $2, $3, $4, now(), $5, $6, $7, true)', [id, username, name, await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10), TERMS_VERSION, 'test', 'made by ' + a.username]); await tx.query('UPDATE users SET adult_confirmed_at = now() WHERE id = $1', [id]);
      await createAccount(tx, id, name, 'balanced');
    });
    broadcast(changes);
    const ssn = String(100000000 + Math.floor(Math.random() * 600000000)), now = new Date().toISOString();
    const r = await require('./alpaca').createAccount({ contact: { email_address: `test+${id.slice(0, 10)}@pocketinvesting.com`, phone_number: '+12035550' + String(100 + n).slice(-3), street_address: ['1 Test Street'], city: 'Southington', state: 'CT', postal_code: '06489', country: 'USA' },
      identity: { given_name: 'Test', family_name: 'User' + n, date_of_birth: '1990-01-15', tax_id: `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`, tax_id_type: 'USA_SSN', country_of_citizenship: 'USA', country_of_birth: 'USA', country_of_tax_residence: 'USA', funding_source: ['employment_income'] },
      disclosures: { is_control_person: false, is_affiliated_exchange_or_finra: false, is_politically_exposed: false, immediate_family_exposed: false, employment_status: 'employed', employer_name: 'Pocket Investing', employment_position: 'Tester' },
      agreements: [{ agreement: 'customer_agreement', signed_at: now, ip_address: '127.0.0.1' }, { agreement: 'account_agreement', signed_at: now, ip_address: '127.0.0.1' }], enabled_assets: ['us_equity'] });
    await q('INSERT INTO broker_accounts (user_id, alpaca_id, account_number, status, active_since) VALUES ($1, $2, $3, $4, $5)', [id, r.id, r.account_number || null, r.status || 'SUBMITTED', r.status === 'ACTIVE' ? new Date() : null]);
    await q('INSERT INTO test_setup (user_id, deposit) VALUES ($1, $2)', [id, deposit]);
    made.push({ id, username, name });
  }
  ok(res, { made });
}));
app.get('/api/admin/test-accounts', wrap(async (req, res) => {
  if (!(await needAdmin(req, res))) return;
  ok(res, { sandbox: config.realMoney && config.alpaca.env === 'sandbox', accounts: (await q(`SELECT u.id, u.username, u.display_name, u.created_at, b.status, b.account_number, t.step, t.deposit, t.note FROM users u LEFT JOIN broker_accounts b ON b.user_id = u.id LEFT JOIN test_setup t ON t.user_id = u.id WHERE u.is_test ORDER BY u.created_at`)).rows });
}));
app.post('/api/admin/act-as', wrap(async (req, res) => {
  const a = await needAdmin(req, res); if (!a || !sandboxOnly(res)) return;
  const t = (await q('SELECT id, is_test FROM users WHERE id = $1', [String(req.body.userId || '')])).rows[0];
  if (!t || !t.is_test) return bad(res, 'You can only act as test accounts.', 403);
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions (token, user_id, expires_at, acting_admin) VALUES ($1, $2, now() + interval '30 minutes', $3)`, [token, t.id, a.id]);
  setCookie(req, res, 'pi_return', readCookie(req), 3600); setCookie(req, res, COOKIE, token, 1800);
  await q('INSERT INTO admin_log (user_id, action, detail, status) VALUES ($1, $2, $3, 200)', [a.id, 'act-as', JSON.stringify({ test: t.id })]);
  ok(res);
}));
app.post('/api/act-as/stop', wrap(async (req, res) => {
  const tok = readCookie(req), s = tok && (await q('SELECT acting_admin FROM sessions WHERE token = $1', [tok])).rows[0];
  if (tok && s && s.acting_admin) await q('DELETE FROM sessions WHERE token = $1', [tok]);
  const back = cookieVal(req, 'pi_return'), ok2 = back && s && (await q('SELECT 1 FROM sessions WHERE token = $1 AND user_id = $2 AND expires_at > now()', [back, s.acting_admin])).rows.length;
  if (ok2) setCookie(req, res, COOKIE, back, 30 * 86400); else clearCookie(res);
  res.append('Set-Cookie', 'pi_return=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); ok(res, { back: !!ok2 });
}));
/* ---------- Explore: industries, earnings this week, market events, and related companies ---------- */
app.get('/api/explore', wrap(async (req, res) => {
  const u = await currentUser(req), pid = u ? 'u_' + u.id : null;
  const industries = Object.fromEntries((await q('SELECT sym, industry, sector FROM company_info')).rows.map(r => [r.sym, { industry: r.industry, sector: r.sector }]));
  const earnings = (await q(`SELECT sym, next_date FROM earnings WHERE next_date >= current_date AND next_date < current_date + 7 ORDER BY next_date`)).rows.map(r => ({ sym: r.sym, date: r.next_date }));
  const events = (await q(`SELECT id, date, title, syms, note FROM market_events WHERE date >= current_date - 1 AND date < current_date + 45 ORDER BY date`)).rows;
  /* Related to what you own: companies in the same industry, and what other members who hold the same stocks also hold.
     Built only from aggregate counts (at least 3 members), never from any one person's holdings. */
  let related = null;
  if (pid){
    const me = ((await q('SELECT data FROM doc_portfolios WHERE id = $1', [pid])).rows[0] || {}).data || {};
    const gids = (await q(`SELECT data->>'gid' AS gid FROM doc_memberships WHERE data->>'pid' = $1`, [pid])).rows.map(r => r.gid);
    const mine = Object.keys(me.positions || {}), groupSyms = new Set();
    const leads = (await q(`SELECT data->>'leadPid' AS l FROM doc_groups WHERE id = ANY($1)`, [gids])).rows.map(r => r.l).filter(l => l && l !== pid);
    for (const r of (await q(`SELECT data FROM doc_portfolios WHERE id = ANY($1)`, [leads.concat(gids.map(g => 'club_' + g))])).rows) Object.keys((r.data || {}).positions || {}).forEach(s => groupSyms.add(s));
    const own = new Set(mine.concat([...groupSyms]));
    const peers = {}; for (const s of own){ const ind = industries[s] && industries[s].industry; if (!ind) continue;
      const same = Object.entries(industries).filter(([t, v]) => v.industry === ind && t !== s && !own.has(t)).map(([t]) => t).slice(0, 6); if (same.length) peers[s] = { industry: ind, syms: same }; }
    const co = {}; if (own.size){
      for (const r of (await q(`SELECT id, data FROM doc_portfolios WHERE id LIKE 'u\_%' AND id <> $1`, [pid])).rows){ const ps = Object.keys((r.data || {}).positions || {}); if (!ps.some(s => own.has(s))) continue;
        for (const s of ps) if (!own.has(s)) co[s] = (co[s] || 0) + 1; } }
    related = { own: [...own], fromGroups: [...groupSyms].filter(s => !mine.includes(s)), peers, alsoHeld: Object.entries(co).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([sym, n]) => ({ sym, n })) };
  }
  ok(res, { industries, earnings, events, related });
}));
app.post('/api/admin/market-events', wrap(async (req, res) => {
  const a = await needAdmin(req, res); if (!a) return;
  if (req.body.remove){ await q('DELETE FROM market_events WHERE id = $1', [String(req.body.remove)]); return ok(res); }
  const date = String(req.body.date || ''), title = clean(req.body.title).slice(0, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return bad(res, 'Add a date and a title.');
  const syms = String(req.body.syms || '').toUpperCase().split(/[\s,]+/).filter(s => /^[A-Z.]{1,6}$/.test(s)).slice(0, 8);
  await q('INSERT INTO market_events (id, date, title, syms, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [db.newId(), date, title, syms, clean(req.body.note).slice(0, 300) || null, a.id]);
  broadcastRaw({ type: 'explore' }); ok(res);
}));
app.get('/api/invite/:code', wrap(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 16);
  const r = (await q(`SELECT id, data FROM doc_groups WHERE upper(data->>'inviteCode') = $1`, [code])).rows[0];
  if (!r || r.data.inviteOff) return ok(res, { group: null });
  const g = Object.assign({ id: r.id }, r.data);
  const members = (await q(`SELECT count(*)::int AS n FROM doc_memberships WHERE data->>'gid' = $1 AND data->>'role' <> 'observer'`, [g.id])).rows[0].n;
  const lead = g.pooled ? null : ((await q('SELECT data FROM doc_portfolios WHERE id = $1', [g.leadPid])).rows[0] || {}).data;
  const value = lead ? (lead.cash || 0) + Object.entries(lead.positions || {}).reduce((a, [s, p]) => a + p.shares * Market.price(s), 0) : null;
  ok(res, { group: { id: g.id, name: g.name, description: g.description, strategy: g.strategy, category: g.category, createdTs: g.createdTs, rules: g.rules, membership: g.membership, pooled: !!g.pooled, template: g.template, ownerPid: g.ownerPid, leadPid: g.leadPid, inviteCode: g.inviteCode },
    members, leadReturn: lead ? value / (lead.startValue || 100000) - 1 : null });
}));
app.post('/api/action/:name', actionLimit, wrap(async (req, res) => {
  const fn = actions[req.params.name]; if (!fn) return bad(res, 'Unknown action.', 404);
  if (!config.demoTools && /^(demo|setClock$|resetAll$|setSampleActivity$)/.test(req.params.name)) return bad(res, "That's only available on the demo site.", 403);
  const u = await needUser(req, res); if (!u) return;
  const { out, changes } = await db.withTx(tx => fn(tx, ctxFor(u), req.body || {}));
  broadcast(changes); logEvent(u.id, 'action:' + req.params.name);
  ok(res, { result: out === undefined ? null : out, changes: await vis.filterChanges(await visCtx(u.id, isAdmin(u)), changes.filter(c => c.col !== '_notify'), lookupDoc) });
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
  await q(`INSERT INTO feedback (id, user_id, screen, body, ua, kind, status) VALUES ($1, $2, $3, $4, $5, $6, 'received')`, [db.newId(), u && u.id, clean(req.body.screen).slice(0, 200), body, clean(req.headers['user-agent']).slice(0, 300), req.body.kind === 'bug' ? 'bug' : 'feedback']);
  ok(res);
}));
app.post('/api/client-error', lightLimit, wrap(async (req, res) => {
  const u = await currentUser(req);
  try { noteError(); } catch (x){}
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
  if (op === 'reset2fa'){ /* after checking who they are: two-step off, backup codes cleared, money moves held 48 hours */
    await q("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_pending = NULL, money_hold_until = now() + interval '48 hours' WHERE id = $1", [u.id]); await q('DELETE FROM totp_backup WHERE user_id = $1', [u.id]).catch(() => {});
    securityEvent(req, u.id, 'two-step', 'Two-step sign-in was reset by the Pocket team', 'Two-step sign-in was reset for your account. Set it up again at your next sign-in. Withdrawals and bank changes are paused for 48 hours. If you didn\'t ask for this, contact us right away.');
    return ok(res); }
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

app.get('/healthz', (req, res) => res.json({ ok: true, mode: config.mode }));
const realDeps = { broadcastRaw: (...a) => broadcastRaw(...a), securityEvent: (...a) => securityEvent(...a), q, wrap, ok, bad, needUser, needAdmin, sendTo, newId: db.newId, getSetting: setting, setSetting,
  isPro: async pid => { const r = await q('SELECT data FROM doc_profiles WHERE id = $1', [pid]); const p = r.rows[0] && r.rows[0].data; return !!p && (p.kind === 'demo' || p.plan === 'pro'); } };
real.mount(app, realDeps);
realDeps.push = push; realDeps.pool = db.pool; require('./realcopy').mount(app, realDeps);
require('./outlook').mount(app, { q, wrap, ok, bad, needUser, db, broadcast: (...x) => broadcast(...x) });
require('./community').mount(app, { q, wrap, ok, bad, needUser, needAdmin, push, db, sendTo, broadcastAll: m => { for (const c of wss.clients) try { c.send(JSON.stringify(m)); } catch (e){} }, onContribution: (...a) => (global.__contrib ? global.__contrib(...a) : Promise.resolve()) });
require('./referrals').mount(app, { q, wrap, ok, bad, needUser, needAdmin, db, broadcast: (...x) => broadcast(...x), push, sendTo });
require('./badges').mount(app, { wrap, ok, bad, needAdmin, db, broadcast: (...x) => broadcast(...x), q });
require('./photos').mount(app, { q, wrap, ok, bad, needUser, needAdmin, db, broadcast: (...x) => broadcast(...x) });
require('./alerts').mount(app, { q, wrap, ok, bad, needUser, sendTo, push, db, getSetting: setting, setSetting, broadcast: (...a) => broadcast(...a), logic: require('./logic') });
marketdata.mount(app, { q, wrap, ok, bad, needUser, needAdmin, getSetting: setting, setSetting, broadcastMsg: obj => broadcastRaw(obj), push, pool: db.pool });
metrics.mount(app, { q, wrap, ok, bad, needAdmin, getSetting: setting, setSetting });
stats.mount(app, { q, wrap, ok, bad, currentUser, isAdmin });
club.mount(app, { q, wrap, ok, bad, needUser, needAdmin, isAdmin: u => isAdmin(u), push: (pids, payload) => push.send(db.pool, pids, payload).catch(() => 0) });
require('./statements').mount(app, { realMoney: config.realMoney, q, wrap, ok, bad, needUser, needAdmin, isAdmin: u => isAdmin(u), push: (pids, payload) => push.send(db.pool, pids, payload).catch(() => 0) });

/* ---------- the app ---------- */
const pub = path.join(__dirname, '..', 'public');
/* The public website: shown at the main domain (pocketinvesting.com and www), and at /site on any domain for previews. */
const SITE_FILE = require('path').join(pub, 'site', 'index.html');
const MARKETING_HOSTS = String(process.env.MARKETING_HOSTS || 'pocketinvesting.com,www.pocketinvesting.com').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
app.get(['/', '/index.html'], (req, res, next) => { if (!MARKETING_HOSTS.includes(String(req.hostname || '').toLowerCase())) return next(); res.set('Cache-Control', 'no-cache'); res.sendFile(SITE_FILE); });
app.get('/site', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(SITE_FILE); });
/* Beta invite requests from the website. */
const waitHits = new Map();
app.post('/api/waitlist', wrap(async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), now = Date.now(), h = (waitHits.get(ip) || []).filter(t => now - t < 3600000);
  if (h.length >= 5) return bad(res, 'Too many requests from this connection. Try again in an hour.', 429); h.push(now); waitHits.set(ip, h);
  if (req.body.website) return ok(res); /* hidden field: bots fill it in */
  const email = clean(req.body.email).toLowerCase().slice(0, 160), name = clean(req.body.name).slice(0, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email address.');
  if (!name) return bad(res, 'Enter your name.');
  const how = ['own', 'copy', 'group', 'club'].includes(req.body.how) ? req.body.how : null, size = clean(req.body.clubSize).slice(0, 20), note = clean(req.body.note).slice(0, 500);
  await q(`INSERT INTO waitlist (email, name, how, club_size, note, source) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, how = EXCLUDED.how, club_size = EXCLUDED.club_size, note = EXCLUDED.note`, [email, name, how, size || null, note || null, clean(req.body.source).slice(0, 80) || 'website']);
  ok(res);
}));
app.get('/api/admin/waitlist', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; ok(res, { requests: (await q('SELECT id, email, name, how, club_size, note, source, created_at, invited_code, invited_at FROM waitlist ORDER BY created_at DESC LIMIT 500')).rows }); }));
app.post('/api/admin/waitlist/invited', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; await q('UPDATE waitlist SET invited_code = $2, invited_at = now() WHERE id = $1', [Number(req.body.id), clean(req.body.code).slice(0, 20)]); ok(res); }));
app.use(express.static(pub, { setHeaders(res, p){ if (/\.(html|webmanifest)$|sw\.js$/.test(p)) res.set('Cache-Control', 'no-cache'); else if (/[\\/](js|css)[\\/]app\.[0-9a-f]{10}\.(js|css)$/.test(p)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); } }));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

/* ---------- boot ---------- */
(async () => {
  await db.migrate();
  await require('./referrals').migrate(q); await require('./community').migrate(q); await require('./outlook').migrate(q);
  await real.migrate(q); await require('./realcopy').migrate(q); await require('./alerts').migrate(q); await require('./photos').migrate(q);
  if (!config.demoTools) await q(`INSERT INTO settings (key, value) VALUES ('clock', '"live"') ON CONFLICT (key) DO UPDATE SET value = '"live"'`).catch(() => {}); /* without demo tools, the market follows real hours */
  await marketdata.migrate(q);
  await marketdata.loadExtras();
  await push.init(db.pool);
  if (config.sampleData && config.realPrices && !(await q('SELECT 1 FROM doc_profiles LIMIT 1')).rows.length){ console.log('Loading real price history before creating sample data…'); await require('./marketdata').warmForSeed().catch(e => console.error('warm', e.message)); }
  if (config.sampleData && await seedIfEmpty(db.withTx)) console.log('Loaded sample data.');
  { const dividends = require('./dividends'); const payDiv = async () => { try { const r = await dividends.run(db.withTx); if (r.paid) console.log('Paid ' + r.paid + ' practice dividends.'); broadcast(r.changes); } catch (e){ console.error('dividends', e.message); } }; setTimeout(payDiv, 15000); setInterval(payDiv, 60 * 60000); }
  if (config.sampleData){ const fixed = await require('./seed').repairSampleTrades(db.withTx).catch(e => { console.error('sample trade repair', e.message); return 0; }); if (fixed) console.log('Repaired sample trade history for ' + fixed + ' sample investors.'); }
  if (config.mode === 'live' && !config.appSecret) console.warn('WARNING: set APP_SECRET on the live site to encrypt two-step sign-in secrets.');
  if (config.realMoney && !require('./alpaca').configured()) console.warn('WARNING: ALPACA_KEY and ALPACA_SECRET are not set. Real-money features will show as unavailable.');
  real.startSync({ q, sendTo, onOrderUpdate: (...a) => realDeps.onOrderUpdate ? realDeps.onOrderUpdate(...a) : null, testSetupTick: () => require('./realcopy').testSetupTick(q) });
  marketdata.start().catch(e => console.error('market data', e.message));
  if (config.sampleData){
    const sample = require('./sample');
    setInterval(async () => { try { broadcast(await sample.tick(db.withTx)); } catch (e){ console.error('sample activity', e.message); } }, 15 * 60000);
  }
  setInterval(async () => {
    try { const { changes } = await db.withTx(tx => housekeeping(tx)); broadcast(changes); }
    catch (e){ console.error('housekeeping', e.message); }
  }, 30000);
  setInterval(() => { q('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}); q(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`).catch(() => {}); }, 3600000);
  server.listen(PORT, () => console.log('Pocket Investing (' + config.mode + (config.realMoney ? ', Alpaca ' + config.alpaca.env : '') + ') running on port ' + PORT + (ENV_ADMINS.length ? ' (admins: ' + ENV_ADMINS.join(', ') + ')' : ' (no admins set: add ADMIN_USERNAMES)')));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
