/* Email through Resend.
   Every email is queued in email_log, sent by a small worker, and retried with backoff if sending fails.
   Security emails (resets, confirmations, alerts) always go first; near the daily limit, only they are sent.
   Nothing is sent until RESEND_API_KEY is set: emails are logged as "not set up" instead.
   Promotional emails (recaps, news) would need a postal address in the footer by law, so they stay off
   until COMPANY_ADDRESS is set. Resets, confirmations and security alerts don't need one. */
const crypto = require('crypto');
const config = require('./config');

const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const validEmail = e => /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(String(e || '')) && String(e).length <= 160;
const normEmail = e => String(e || '').trim().toLowerCase();
const maskEmail = e => { const [u, d] = String(e || '').split('@'); if (!d) return ''; return (u.length <= 2 ? u[0] + '*' : u[0] + '*'.repeat(Math.min(6, u.length - 2)) + u[u.length - 1]) + '@' + d; };
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function migrate(q){
  for (const c of ['email text', 'email_verified_at timestamptz', 'email_pending text', "email_prefs jsonb NOT NULL DEFAULT '{}'::jsonb"])
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL`);
  await q(`CREATE TABLE IF NOT EXISTS email_tokens (token_hash text PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL, email text, expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS email_log (id bigserial PRIMARY KEY, user_id text, to_addr text NOT NULL, kind text NOT NULL, priority int NOT NULL DEFAULT 1, subject text NOT NULL, html text NOT NULL, body text NOT NULL,
    status text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), error text, provider_id text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz)`);
  await q(`CREATE INDEX IF NOT EXISTS email_log_queue ON email_log (status, next_at)`);
  await q(`ALTER TABLE email_log ADD COLUMN IF NOT EXISTS headers jsonb`);
}

/* ---------- templates ---------- */
const SECURITY_KINDS = new Set(['verify', 'reset', 'change-old', 'change-new', 'security', 'unlock-request', 'unlock', 'test']);
/* Notices a member chose to get (each has its own switch and one-click unsubscribe). They're about the member's
   own account, so they don't need the postal address that promotional email does. */
const NOTICE_KINDS = { approvals: 'approval request', alerts: 'price alert', support: 'support reply', votes: 'vote reminder', mentions: 'mention' };
/* Sent because someone asked (an invite request, an invite) or to the Pocket team itself. No switch, no address needed. */
const TRANSACTIONAL = new Set(['invite-request', 'invite', 'summary', 'leader-apply']);
const needsAddress = kind => !SECURITY_KINDS.has(kind) && !NOTICE_KINDS[kind] && !TRANSACTIONAL.has(kind);
function layout({ heading, lines = [], button = null, after = [], security = true, unsub = null }){
  const addr = config.company.address;
  const footerText = `${config.company.name}${addr ? ', ' + addr : ''}\nPocket Investing will never ask for your password or a two-step code by email.\nQuestions? Reply to this email or write to ${config.email.replyTo.replace(/.*<|>.*/g, '')}.`
    + (unsub ? `\nDon't want ${unsub.label} emails? Turn them off: ${unsub.url}\nChange all your email settings: ${unsub.manage}` : '');
  const text = [heading, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(after.length ? ['', ...after] : []), '', '--', footerText].join('\n');
  const p = t => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1b2333">${escH(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;padding:28px">
<tr><td><div style="font-weight:700;font-size:18px;color:#13203f;margin-bottom:18px">Pocket Investing</div>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 14px;color:#13203f">${escH(heading)}</h1>
${lines.map(p).join('')}
${button ? `<p style="margin:22px 0"><a href="${escH(button.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escH(button.label)}</a></p><p style="margin:0 0 14px;font-size:13px;color:#5b6475">Or copy this link: ${escH(button.url)}</p>` : ''}
${after.map(p).join('')}
<hr style="border:0;border-top:1px solid #e5e7ee;margin:22px 0">
<p style="margin:0;font-size:12px;line-height:1.5;color:#5b6475">${footerText.split('\n').filter(l => !unsub || !/^(Don't want|Change all your)/.test(l)).map(escH).join('<br>')}</p>
${unsub ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#5b6475"><a href="${escH(unsub.url)}" style="color:#5b6475">Turn off ${escH(unsub.label)} emails</a> · <a href="${escH(unsub.manage)}" style="color:#5b6475">Email settings</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { text, html, security };
}

function create(d){
  const { q } = d;
  const link = (path) => config.appUrl + path;

  /* Queue an email. kind: verify, reset, change-old, change-new, security, unlock-request, unlock, or an optional kind. */
  async function queue(userId, to, kind, subject, t, headers){
    if (!validEmail(to)) return null;
    if (needsAddress(kind) && !config.company.address) return null; /* promotional email needs a postal address */
    if (!SECURITY_KINDS.has(kind) && !TRANSACTIONAL.has(kind)){
      const pref = userId ? (await q('SELECT email_prefs FROM users WHERE id = $1', [userId])).rows[0] : null;
      if (pref && pref.email_prefs && pref.email_prefs[kind] === false) return null;
    }
    const status = config.email.key ? 'queued' : 'not-configured';
    const r = await q(`INSERT INTO email_log (user_id, to_addr, kind, priority, subject, html, body, status, headers) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userId || null, to, kind, SECURITY_KINDS.has(kind) ? 0 : needsAddress(kind) ? 2 : 1, subject, t.html, t.text, status, headers ? JSON.stringify(headers) : null]);
    if (status === 'queued') setImmediate(tick);
    return r.rows[0].id;
  }

  /* ---------- worker ---------- */
  let busy = false, again = false;
  async function tick(){
    if (!config.email.key) return; if (busy){ again = true; return; } busy = true; again = false;
    try {
      const sent = Number((await q(`SELECT count(*)::int n FROM email_log WHERE status = 'sent' AND sent_at > now() - interval '24 hours'`)).rows[0].n);
      const limit = config.email.dailyLimit, onlySecurity = sent >= limit - 10;
      if (sent >= limit) return;
      const rows = (await q(`SELECT * FROM email_log WHERE status IN ('queued', 'retry') AND next_at <= now() ${onlySecurity ? 'AND priority = 0' : ''} ORDER BY priority, id LIMIT 5`)).rows;
      for (const m of rows){
        try {
          const r = await fetch(config.email.apiUrl, { method: 'POST', headers: { authorization: 'Bearer ' + config.email.key, 'content-type': 'application/json' },
            body: JSON.stringify(Object.assign({ from: config.email.from, to: [m.to_addr], reply_to: config.email.replyTo, subject: m.subject, html: m.html, text: m.body }, m.headers ? { headers: m.headers } : {})), signal: AbortSignal.timeout(15000) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error(j.message || j.error || ('HTTP ' + r.status)), { permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
          await q(`UPDATE email_log SET status = 'sent', sent_at = now(), attempts = attempts + 1, provider_id = $2, error = NULL WHERE id = $1`, [m.id, j.id || null]);
        } catch (e){
          const tries = m.attempts + 1, wait = [1, 5, 15, 60][tries - 1];
          if (e.permanent || !wait) await q(`UPDATE email_log SET status = 'failed', attempts = $2, error = $3 WHERE id = $1`, [m.id, tries, String(e.message).slice(0, 300)]);
          else await q(`UPDATE email_log SET status = 'retry', attempts = $2, error = $3, next_at = now() + ($4 || ' minutes')::interval WHERE id = $1`, [m.id, tries, String(e.message).slice(0, 300), String(wait)]);
        }
      }
    } catch (e){ console.error('email worker', e.message); }
    finally { busy = false; if (again) setImmediate(tick); }
  }
  setInterval(tick, 15000).unref();

  /* ---------- tokens ---------- */
  async function newToken(userId, kind, email, minutes){
    const t = crypto.randomBytes(24).toString('hex');
    await q(`INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`, [hash(t), userId, kind, email || null, String(minutes)]);
    return t;
  }
  async function useToken(t, kind){
    const r = (await q(`UPDATE email_tokens SET used = true WHERE token_hash = $1 AND kind = $2 AND NOT used AND expires_at > now() RETURNING user_id, email`, [hash(t), kind])).rows[0];
    return r || null;
  }

  /* ---------- the emails ---------- */
  async function sendVerify(userId, email, name, isChange){
    const t = await newToken(userId, 'verify', email, 48 * 60);
    return queue(userId, email, isChange ? 'change-new' : 'verify', 'Confirm your email for Pocket Investing', layout({ heading: 'Confirm your email',
      lines: [`Hi ${name || 'there'},`, isChange ? 'Confirm this is your new email address for Pocket Investing.' : 'Confirm this email address so you can reset your password and get security alerts.'],
      button: { label: 'Confirm email', url: link('/#/verify/' + t) }, after: ["The link works for 48 hours. If you didn't ask for this, you can ignore this email."] }));
  }
  async function sendReset(userId, email, name){
    const t = await newToken(userId, 'reset', email, 60);
    return queue(userId, email, 'reset', 'Reset your Pocket Investing password', layout({ heading: 'Reset your password',
      lines: [`Hi ${name || 'there'},`, 'Someone asked to reset the password for your Pocket Investing account. If it was you, choose a new password with the button below.'],
      button: { label: 'Choose a new password', url: link('/#/reset/' + t) }, after: ["The link works once, for 1 hour. If you didn't ask for this, ignore this email; your password stays the same."] }));
  }
  /* A security alert to the member's confirmed address. */
  async function sendSecurity(userId, subject, lines){
    const u = (await q('SELECT email, email_verified_at, display_name FROM users WHERE id = $1', [userId])).rows[0];
    if (!u || !u.email || !u.email_verified_at) return null;
    return queue(userId, u.email, 'security', subject, layout({ heading: subject, lines: [`Hi ${u.display_name || 'there'},`, ...lines],
      after: ["If this wasn't you, change your password right away and contact the Pocket team."] }));
  }
  async function sendRaw(userId, email, kind, subject, lines, button, after){ return queue(userId, email, kind, subject, layout({ heading: subject, lines, button, after })); }

  /* ---------- notices with one-click unsubscribe ---------- */
  let unsubKey = null;
  async function key(){
    if (unsubKey) return unsubKey;
    const r = (await q(`SELECT value FROM settings WHERE key = 'emailUnsubKey'`)).rows[0];
    let k = r && r.value && r.value.k;
    if (!k){ k = crypto.randomBytes(32).toString('hex'); await q(`INSERT INTO settings (key, value) VALUES ('emailUnsubKey', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify({ k })]);
      k = (await q(`SELECT value FROM settings WHERE key = 'emailUnsubKey'`)).rows[0].value.k; }
    return unsubKey = k;
  }
  const sig = async (userId, kind) => crypto.createHmac('sha256', await key()).update(userId + ':' + kind).digest('base64url').slice(0, 22);
  async function unsubToken(userId, kind){ return Buffer.from(String(userId)).toString('base64url') + '.' + kind + '.' + await sig(userId, kind); }
  async function readUnsub(token){
    const [u, kind, s] = String(token || '').split('.'); if (!u || !NOTICE_KINDS[kind] || !s) return null;
    let userId; try { userId = Buffer.from(u, 'base64url').toString(); } catch (e){ return null; }
    const want = await sig(userId, kind); if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
    return { userId, kind, label: NOTICE_KINDS[kind] };
  }
  /* An email a member asked for: approvals, price alerts, support replies, vote reminders, mentions. Only to a confirmed address. */
  async function notice(userId, kind, subject, lines, button){
    if (!NOTICE_KINDS[kind]) throw new Error('unknown notice kind ' + kind);
    const u = (await q('SELECT email, email_verified_at, display_name, email_prefs FROM users WHERE id = $1', [userId])).rows[0];
    if (!u || !u.email || !u.email_verified_at || (u.email_prefs || {})[kind] === false) return null;
    const t = await unsubToken(userId, kind), url = link('/#/unsub/' + t);
    return queue(userId, u.email, kind, subject, layout({ heading: subject, lines: [`Hi ${u.display_name || 'there'},`, ...lines], button, security: false,
      unsub: { label: NOTICE_KINDS[kind], url, manage: link('/#/settings/notifications') } }),
      { 'List-Unsubscribe': `<${link('/api/unsubscribe/' + t)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  }

  async function status(){
    const c = (await q(`SELECT status, count(*)::int n FROM email_log WHERE created_at > now() - interval '24 hours' GROUP BY status`)).rows;
    const last = (await q(`SELECT kind, to_addr, status, error, created_at FROM email_log ORDER BY id DESC LIMIT 15`)).rows.map(r => Object.assign(r, { to_addr: maskEmail(r.to_addr) }));
    return { configured: !!config.email.key, from: config.email.from, dailyLimit: config.email.dailyLimit, address: !!config.company.address, counts: Object.fromEntries(c.map(r => [r.status, r.n])), recent: last };
  }

  return { queue, tick, sendVerify, sendReset, sendSecurity, sendRaw, notice, unsubToken, readUnsub, newToken, useToken, status, link };
}

module.exports = { migrate, create, validEmail, normEmail, maskEmail, layout, NOTICE_KINDS };
