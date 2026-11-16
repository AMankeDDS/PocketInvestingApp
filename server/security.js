/* Account protection.
   - Wrong passwords and wrong two-step codes: 5 in a row pause sign-in and codes for 15 minutes.
     A second pause within 24 hours, with no successful sign-in in between, locks the account
     until the Pocket team unlocks it.
   - Two-step codes: one shared check for sign-in and every sensitive action; a code can't be used twice.
   - Sessions are stored scrambled (SHA-256), so a copy of the database can't be used to sign in.
   - Signed-in devices, withdrawal holds and the daily withdrawal cap, the bot check (Cloudflare
     Turnstile), and security alerts for the admins. */
const crypto = require('crypto');
const totp = require('./totp');
const config = require('./config');

const MAX_WRONG = 5, FREEZE_MIN = 15, LOCK_WINDOW_H = 24;
const LOCKED_MSG = "This account is locked for your security after repeated wrong passwords or codes. Request an unlock and the Pocket team will check it's you.";
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const frozenMsg = until => { const m = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000)); return `Too many wrong attempts. For your security, sign-in and codes are paused. Try again in ${m} minute${m === 1 ? '' : 's'}.`; };
const reply = (code, body) => ({ code, body });

/* Usernames and display names that could pass for Pocket staff. */
const RESERVED = /(pocket|support|admin|staff|official|moderator|security|alpaca|helpdesk|customerservice|customercare)/;
const RESERVED_EXACT = new Set(['team', 'help', 'mod', 'mods', 'root', 'system', 'service', 'info', 'billing', 'compliance', 'legal', 'ceo', 'founder']);
const STAFF_NAME = /(pocket|support|admin|staff|official|moderator|customer service|customer care|help ?desk)/i;
function reservedUsername(u){ const s = String(u || '').toLowerCase().replace(/[._]/g, ''); return RESERVED.test(s) || RESERVED_EXACT.has(s); }
function reservedName(n){ return STAFF_NAME.test(String(n || '')); }

async function migrate(q){
  for (const c of ['fail_count int NOT NULL DEFAULT 0', 'freeze_until timestamptz', 'last_freeze_at timestamptz', 'locked_at timestamptz', 'withdraw_hold_until timestamptz', 'withdraw_hold_reason text', 'last_code_step bigint'])
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);
  for (const c of ['sid text', 'ua text', 'ip text', 'created_at timestamptz DEFAULT now()', 'hashed boolean NOT NULL DEFAULT false'])
    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${c}`);
  /* Sessions saved before they were scrambled can't be matched any more; clear them (everyone signs in once). */
  await q('DELETE FROM sessions WHERE NOT hashed');
}

function create(d){
  const { q, logEvent, securityEvent } = d;
  const ipOf = req => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60);

  /* Is sign-in (and code entry) paused or locked for this account? */
  async function gate(userId){
    const r = (await q('SELECT locked_at, freeze_until FROM users WHERE id = $1', [userId])).rows[0]; if (!r) return null;
    if (r.locked_at) return reply(423, { error: LOCKED_MSG, locked: true });
    if (r.freeze_until && new Date(r.freeze_until) > new Date()) return reply(429, { error: frozenMsg(r.freeze_until), frozen: true });
    return null;
  }
  /* A wrong password or code. Returns a reply when this attempt paused or locked the account. */
  async function wrong(req, userId, what){
    const r = (await q('UPDATE users SET fail_count = fail_count + 1 WHERE id = $1 RETURNING fail_count, last_freeze_at', [userId])).rows[0]; if (!r) return null;
    logEvent(userId, what === 'code' ? 'sec:badcode' : 'sec:fail');
    if (r.fail_count < MAX_WRONG) return null;
    const noun = what === 'code' ? 'codes' : 'passwords';
    if (r.last_freeze_at && Date.now() - new Date(r.last_freeze_at).getTime() < LOCK_WINDOW_H * 3600000){
      await q('UPDATE users SET fail_count = 0, freeze_until = NULL, locked_at = now() WHERE id = $1', [userId]);
      await q('DELETE FROM sessions WHERE user_id = $1', [userId]);
      logEvent(userId, 'sec:lock');
      securityEvent(req, userId, 'lock', 'Account locked after repeated wrong passwords or codes', 'Your Pocket account was locked after repeated wrong passwords or codes, and all devices were signed out. Request an unlock from the sign-in screen.');
      return reply(423, { error: LOCKED_MSG, locked: true });
    }
    const until = new Date(Date.now() + FREEZE_MIN * 60000);
    await q('UPDATE users SET fail_count = 0, freeze_until = $2, last_freeze_at = now() WHERE id = $1', [userId, until]);
    logEvent(userId, 'sec:freeze');
    securityEvent(req, userId, 'freeze', `Sign-in paused for ${FREEZE_MIN} minutes after ${MAX_WRONG} wrong ${noun}`, `Someone entered ${MAX_WRONG} wrong ${noun} for your Pocket account. Sign-in is paused for ${FREEZE_MIN} minutes. If this wasn't you, change your password.`);
    return reply(429, { error: frozenMsg(until), frozen: true });
  }
  /* A successful sign-in clears the count and the earlier pause. */
  async function signedIn(userId){ await q('UPDATE users SET fail_count = 0, freeze_until = NULL, last_freeze_at = NULL WHERE id = $1', [userId]); }

  /* The one check for two-step codes. Returns null when the code is good, or a reply to send. */
  async function checkCode(req, userId, input, { backup = false } = {}){
    const g = await gate(userId); if (g) return g;
    const row = (await q('SELECT totp_enabled, totp_secret, last_code_step FROM users WHERE id = $1', [userId])).rows[0];
    if (!row || !row.totp_enabled) return reply(403, { error: 'Turn on two-step sign-in first.' });
    const code = String(input || '').trim();
    if (!code) return reply(401, { error: 'Enter the 6-digit code from your authenticator app to confirm.', needCode: true });
    const secret = totp.open(row.totp_secret, config.appSecret), step = secret ? totp.match(secret, code) : -1;
    if (step >= 0){
      if (row.last_code_step != null && step <= Number(row.last_code_step)) return reply(401, { error: 'That code was already used. Wait for the next code in your app.', needCode: true });
      await q('UPDATE users SET last_code_step = $2, fail_count = 0 WHERE id = $1', [userId, step]);
      return null;
    }
    if (backup && await require('./backup').use(q, userId, code)){
      await q('UPDATE users SET fail_count = 0 WHERE id = $1', [userId]);
      securityEvent(req, userId, 'two-step', 'Backup code used', "A two-step backup code was used. Each code works once. If this wasn't you, change your password now.");
      return null;
    }
    const w = await wrong(req, userId, 'code'); if (w) return w;
    return reply(401, { error: backup ? "That code didn't match. Try the newest code, or a backup code." : "That code didn't match. Try the newest code.", needCode: true });
  }

  /* ---------- sessions ---------- */
  async function newSession(req, userId, token, { days = 30, minutes = null, actingAdmin = null } = {}){
    const sid = crypto.randomBytes(8).toString('hex');
    await q(`INSERT INTO sessions (token, user_id, expires_at, acting_admin, sid, ua, ip, hashed, last_used_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4, $5, $6, $7, true, now())`,
      [hashToken(token), userId, String(minutes || days * 1440), actingAdmin, sid, String(req.headers['user-agent'] || '').slice(0, 300), ipOf(req)]);
    return sid;
  }
  const maskIp = ip => { ip = String(ip || ''); if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, '.x'); if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…'; return ip || 'unknown'; };

  function mount(app, m){
    const { wrap, ok, bad, needUser, needAdmin, readCookie, deviceName, setting, setSetting, push, ENV_ADMINS, authLimit } = m;
    /* Signed-in devices */
    app.get('/api/sessions', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
      const cur = hashToken(readCookie(req) || '');
      const rows = (await q(`SELECT sid, ua, ip, created_at, last_used_at, token = $2 AS current FROM sessions WHERE user_id = $1 AND acting_admin IS NULL AND expires_at > now() ORDER BY (token = $2) DESC, last_used_at DESC NULLS LAST LIMIT 30`, [u.id, cur])).rows;
      ok(res, { sessions: rows.map(r => ({ sid: r.sid, device: deviceName(r.ua), ip: maskIp(r.ip), since: r.created_at, lastActive: r.last_used_at || r.created_at, current: r.current })) }); }));
    app.post('/api/sessions/revoke', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
      if (u.acting_admin) return bad(res, "That isn't available while acting as a test account.");
      const cur = hashToken(readCookie(req) || '');
      const r = req.body.others ? await q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2 AND acting_admin IS NULL', [u.id, cur])
        : await q('DELETE FROM sessions WHERE user_id = $1 AND sid = $2 AND token <> $3 AND acting_admin IS NULL', [u.id, String(req.body.sid || ''), cur]);
      if (r.rowCount) securityEvent(req, u.id, 'sign-out', req.body.others ? 'Signed out of all other devices' : 'Signed out of a device', null);
      ok(res, { removed: r.rowCount }); }));

    /* Locked accounts: a request from the sign-in screen (no account needed), and the admin unlock. */
    app.post('/api/unlock-request', authLimit, wrap(async (req, res) => {
      if (!(await verifyBot(req.body.botToken, ipOf(req)))) return bad(res, "Please complete the check that you're not a bot, then try again.");
      const username = String(req.body.username || '').trim().toLowerCase().slice(0, 40), contact = String(req.body.contact || '').trim().slice(0, 200), note = String(req.body.note || '').trim().slice(0, 1000);
      if (!username) return bad(res, 'Enter your username.');
      if (!contact) return bad(res, 'Add an email address or phone number so we can confirm it is you.');
      const u = (await q('SELECT id, locked_at FROM users WHERE username = $1', [username])).rows[0];
      /* Same answer whether or not the account exists or is locked, so this can't be used to probe usernames. */
      if (u && u.locked_at && !(await q(`SELECT 1 FROM support_requests WHERE user_id = $1 AND topic = 'unlock' AND status <> 'closed' AND created_at > now() - interval '1 day'`, [u.id])).rows.length){
        const ref = 'S-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
        await q('INSERT INTO support_requests (id, ref, user_id, topic, body) VALUES ($1, $2, $3, $4, $5)', [crypto.randomBytes(10).toString('hex'), ref, u.id, 'unlock', `Unlock request for @${username}.\nHow to reach them: ${contact}${note ? '\nNote: ' + note : ''}`]);
        logEvent(u.id, 'sec:unlock-request');
      }
      ok(res, { message: "Thanks. If that account is locked, the Pocket team will contact you to confirm it's you, then unlock it." }); }));

    /* Beta admin → Security: counts, alerts, locked accounts and settings. */
    app.get('/api/admin/security', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
      const s = await stats();
      const locked = (await q(`SELECT id, username, display_name, locked_at FROM users WHERE locked_at IS NOT NULL ORDER BY locked_at DESC LIMIT 100`)).rows;
      const frozen = (await q(`SELECT id, username, freeze_until FROM users WHERE freeze_until > now() ORDER BY freeze_until DESC LIMIT 100`)).rows;
      ok(res, { stats: s.counts, alerts: s.alerts, locked, frozen, appSecret: config.appSecret ? (config.appSecret.length >= 24 ? 'ok' : 'short') : 'missing', demo: config.demoSite,
        turnstile: !!(config.turnstile.site && config.turnstile.secret), dailyWithdrawCap: await setting('dailyWithdrawCap', 50000), realMoney: config.realMoney }); }));
    app.post('/api/admin/security/cap', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
      const v = Math.round(Number(req.body.cap)); if (!(v >= 100 && v <= 1000000)) return bad(res, 'Enter a daily cap between $100 and $1,000,000.');
      await setSetting('dailyWithdrawCap', v); ok(res); }));

    /* Alert the admins when something spikes (checked every 5 minutes, at most once an hour per kind). */
    const lastSent = {};
    setInterval(async () => { try {
      const { alerts } = await stats(); const fresh = alerts.filter(a => Date.now() - (lastSent[a.key] || 0) > 3600000); if (!fresh.length) return;
      fresh.forEach(a => { lastSent[a.key] = Date.now(); });
      const admins = (await q('SELECT id FROM users WHERE is_admin OR lower(username) = ANY($1)', [ENV_ADMINS])).rows.map(x => 'u_' + x.id);
      push.send(d.pool, admins, { title: 'Pocket Investing: security alert', body: fresh.map(a => a.text).join(' '), url: '/#/admin', tag: 'security-alert' }).catch(() => {});
    } catch (e){} }, 5 * 60000).unref();
  }

  /* Counts for the last hour and day, and which thresholds are crossed. */
  const LIMITS = [
    { key: 'fails', kinds: ['sec:fail', 'sec:unknown-user'], window: 'hour', max: 50, text: n => `${n} wrong passwords in the last hour.` },
    { key: 'codes', kinds: ['sec:badcode'], window: 'hour', max: 20, text: n => `${n} wrong two-step codes in the last hour.` },
    { key: 'freezes', kinds: ['sec:freeze'], window: 'hour', max: 5, text: n => `${n} accounts paused for wrong attempts in the last hour.` },
    { key: 'locks', kinds: ['sec:lock'], window: 'day', max: 3, text: n => `${n} accounts locked in the last day.` },
    { key: 'wblocked', kinds: ['sec:withdraw-blocked'], window: 'day', max: 5, text: n => `${n} withdrawals blocked by the cap or a hold in the last day.` },
    { key: 'withdraws', kinds: ['sec:withdraw'], window: 'hour', max: 20, text: n => `${n} withdrawals requested in the last hour.` },
  ];
  async function stats(){
    const rows = (await q(`SELECT name, count(*) FILTER (WHERE ts > now() - interval '1 hour')::int AS hour, count(*)::int AS day FROM events WHERE name LIKE 'sec:%' AND ts > now() - interval '1 day' GROUP BY name`)).rows;
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    const sum = (kinds, w) => kinds.reduce((a, k) => a + ((by[k] || {})[w] || 0), 0);
    const counts = [['Wrong passwords', ['sec:fail', 'sec:unknown-user']], ['Wrong two-step codes', ['sec:badcode']], ['Accounts paused', ['sec:freeze']], ['Accounts locked', ['sec:lock']], ['Unlock requests', ['sec:unlock-request']], ['Withdrawals requested', ['sec:withdraw']], ['Withdrawals blocked', ['sec:withdraw-blocked']]]
      .map(([label, kinds]) => ({ label, hour: sum(kinds, 'hour'), day: sum(kinds, 'day') }));
    const alerts = LIMITS.map(l => ({ l, n: sum(l.kinds, l.window) })).filter(x => x.n >= x.l.max).map(x => ({ key: x.l.key, text: x.l.text(x.n) }));
    return { counts, alerts };
  }

  /* ---------- withdrawals ---------- */
  async function holdWithdrawals(userId, reason){ await q(`UPDATE users SET withdraw_hold_until = now() + interval '48 hours', withdraw_hold_reason = $2 WHERE id = $1`, [userId, reason]); }
  /* Returns an error message when a withdrawal can't go ahead (hold or daily cap), else null. */
  async function withdrawCheck(userId, amount, getSetting){
    const r = (await q('SELECT withdraw_hold_until, withdraw_hold_reason FROM users WHERE id = $1', [userId])).rows[0];
    if (r && r.withdraw_hold_until && new Date(r.withdraw_hold_until) > new Date()){
      const when = new Date(r.withdraw_hold_until).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
      const why = r.withdraw_hold_reason === 'bank' ? 'a new bank account was linked' : 'your password was changed';
      logEvent(userId, 'sec:withdraw-blocked');
      return { error: `For your security, withdrawals are paused for 48 hours because ${why}. You can withdraw after ${when}. Deposits and trading still work.` };
    }
    const cap = Number(await getSetting('dailyWithdrawCap', 50000)) || 50000;
    const today = (await q(`SELECT coalesce(sum(amount), 0)::float AS s FROM real_transfers WHERE user_id = $1 AND direction = 'OUTGOING' AND upper(status) NOT IN ('CANCELED', 'REJECTED', 'RETURNED') AND (created_at AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date`, [userId])).rows[0].s;
    if (today + amount > cap + 0.001){
      logEvent(userId, 'sec:withdraw-blocked');
      const left = Math.max(0, cap - today);
      return { error: `Daily withdrawal limit reached ($${cap.toLocaleString('en-US')}).${left >= 1 ? ` You can withdraw up to $${left.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more today.` : ''} Need to move more? Contact the Pocket team.`, contact: true };
    }
    return null;
  }

  /* ---------- bot check (Cloudflare Turnstile); off until both keys are set ---------- */
  async function verifyBot(token, ip){
    if (!config.turnstile.site || !config.turnstile.secret) return true;
    if (!token) return false;
    try {
      const body = new URLSearchParams({ secret: config.turnstile.secret, response: String(token).slice(0, 2048), remoteip: ip || '' });
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
      const j = await r.json(); return !!j.success;
    } catch (e){ console.error('turnstile', e.message); return false; }
  }

  return { gate, wrong, signedIn, checkCode, newSession, mount, holdWithdrawals, withdrawCheck, verifyBot, stats };
}

module.exports = { migrate, create, hashToken, reservedUsername, reservedName, LOCKED_MSG };
