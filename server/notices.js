/* Notification emails (items 95-99):
   - approval requests and mentions wait about 15 minutes and only go out if the member hasn't opened Pocket since
     (and, for approvals, the request is still waiting);
   - price alerts and support replies go out right away;
   - vote reminders go out once, when a vote the member hasn't voted on is about to close;
   - a daily summary goes to the Pocket team each morning;
   - one-click unsubscribe (the email footer link and the List-Unsubscribe header). */
const config = require('./config');

async function migrate(q){
  await q(`CREATE TABLE IF NOT EXISTS email_notices (id bigserial PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL, subject text NOT NULL, lines jsonb NOT NULL,
    button jsonb, due_at timestamptz NOT NULL, check_kind text, check_id text, created_at timestamptz NOT NULL DEFAULT now(), done boolean NOT NULL DEFAULT false)`);
  await q(`CREATE INDEX IF NOT EXISTS email_notices_due ON email_notices (done, due_at)`);
  await q(`CREATE TABLE IF NOT EXISTS notice_marks (key text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())`);
  for (const c of ['confirm_sent_at timestamptz', 'emailed_at timestamptz']) await q(`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS ${c}`);
  /* Founding Leader applications from the website (item 113). */
  await q(`CREATE TABLE IF NOT EXISTS leader_applications (id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, handles text NOT NULL, platform text, followers text, invests text,
    source text, status text NOT NULL DEFAULT 'new', note text, invited_code text, emailed_at timestamptz, confirm_sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
}

const PLATFORM = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn', newsletter: 'Newsletter or blog', podcast: 'Podcast', other: 'Other' };
const FOLLOWERS = { 'under-1k': 'under 1,000', '1k-10k': '1,000 to 10,000', '10k-100k': '10,000 to 100,000', '100k-1m': '100,000 to 1 million', '1m-plus': 'over 1 million' };
const uidOf = pid => String(pid || '').startsWith('u_') ? String(pid).slice(2) : null;
const hrs = ms => { const h = Math.round(ms / 3600000); return h <= 1 ? 'less than an hour' : h + ' hours'; };

function create(d){
  const { q, em } = d;
  const link = p => config.appUrl + p;
  const once = async key => (await q('INSERT INTO notice_marks (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1', [key])).rows.length > 0;

  /* Send now, or after a wait (only if the member hasn't been in the app since). */
  async function later(userId, kind, subject, lines, button, opt = {}){
    if (!userId) return;
    const wait = opt.delayMin == null ? 15 : opt.delayMin;
    if (!wait) return em.notice(userId, kind, subject, lines, button).catch(e => console.error('notice', e.message));
    await q(`INSERT INTO email_notices (user_id, kind, subject, lines, button, due_at, check_kind, check_id) VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval, $7, $8)`,
      [userId, kind, subject, JSON.stringify(lines), button ? JSON.stringify(button) : null, String(wait), opt.check ? opt.check[0] : null, opt.check ? String(opt.check[1]) : null]);
  }

  /* Is the thing the email is about still waiting? */
  async function stillWaiting(kind, id){
    if (!kind) return true;
    if (kind === 'copyreq'){ const r = (await q('SELECT data FROM doc_copy_requests WHERE id = $1', [id]).catch(() => ({ rows: [] }))).rows[0];
      return !!r && r.data.status === 'pending' && !(r.data.expiresTs && r.data.expiresTs < Date.now()); }
    if (kind === 'review'){ const r = (await q('SELECT data FROM doc_reviews WHERE id = $1', [id]).catch(() => ({ rows: [] }))).rows[0]; return !!r && r.data.status === 'pending'; }
    if (kind === 'realcopy'){ const r = (await q('SELECT status, expires_at FROM real_copy_requests WHERE id = $1', [id]).catch(() => ({ rows: [] }))).rows[0];
      return !!r && r.status === 'pending' && (!r.expires_at || new Date(r.expires_at) > new Date()); }
    return true;
  }

  async function sweep(){
    const due = (await q(`UPDATE email_notices SET done = true WHERE id IN (SELECT id FROM email_notices WHERE NOT done AND due_at <= now() ORDER BY id LIMIT 50) RETURNING *`)).rows;
    for (const n of due){
      try {
        /* They opened Pocket after this was created, so they've seen it in the app. */
        const seen = (await q('SELECT 1 FROM sessions WHERE user_id = $1 AND last_used_at > $2 LIMIT 1', [n.user_id, n.created_at])).rows.length;
        if (seen || !(await stillWaiting(n.check_kind, n.check_id))) continue;
        await em.notice(n.user_id, n.kind, n.subject, n.lines, n.button || undefined);
      } catch (e){ console.error('notice sweep', e.message); }
    }
    await q(`DELETE FROM email_notices WHERE done AND created_at < now() - interval '7 days'`).catch(() => {});
  }

  /* Approval requests from the practice sites (called with the push module's list of new requests). */
  async function fromPush(o, c){
    if (o.kind !== 'approvals' || !['copyRequests', 'reviews'].includes(c.col)) return;
    const d = c.data || {};
    for (const pid of o.pids){ const uid = uidOf(pid); if (!uid) continue;
      let wait = 15; if (d.expiresTs){ const left = (d.expiresTs - Date.now()) / 60000; if (left < 4) continue; wait = Math.max(2, Math.min(15, Math.floor(left / 2))); }
      await later(uid, 'approvals', o.payload.title, [o.payload.body, d.expiresTs ? `This request expires in about ${Math.max(1, Math.round((d.expiresTs - Date.now()) / 60000))} minutes.` : ''].filter(Boolean),
        { label: 'Review it in Pocket', url: link(o.payload.url || '/#/inbox') }, { delayMin: wait, check: [c.col === 'reviews' ? 'review' : 'copyreq', c.id] }); }
  }

  /* Notifications made inside an action that ask for an email (mentions). */
  async function fromNotify(pids, payload){
    if (!payload || !payload.mail) return;
    for (const pid of pids){ const uid = uidOf(pid); if (!uid) continue;
      await later(uid, payload.mail, payload.title, [payload.body], { label: 'Open in Pocket', url: link(payload.url || '/#/notifications') }, { delayMin: payload.mailDelay }); }
  }

  /* Votes closing soon: once per member per vote, for members who haven't voted. */
  async function voteSweep(){
    const now = Date.now();
    const props = (await q(`SELECT id, data FROM doc_proposals WHERE data->>'status' = 'open'`).catch(() => ({ rows: [] }))).rows;
    for (const { id, data: p } of props){
      const left = (p.deadlineTs || 0) - now, length = (p.deadlineTs || 0) - (p.createdTs || 0); if (left <= 0) continue;
      const window = length >= 2 * 86400000 ? 24 * 3600000 : 6 * 3600000; if (left > window) continue;
      const g = ((await q('SELECT data FROM doc_groups WHERE id = $1', [p.gid])).rows[0] || {}).data || {};
      const members = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [p.gid])).rows.map(r => r.data).filter(m => m.role && m.role !== 'observer');
      const voted = new Set((await q(`SELECT data->>'pid' AS pid FROM doc_votes WHERE data->>'prid' = $1`, [id])).rows.map(r => r.pid));
      for (const m of members){ const uid = uidOf(m.pid); if (!uid || voted.has(m.pid)) continue;
        if (!(await once('vote:' + id + ':' + uid))) continue;
        await em.notice(uid, 'votes', `Vote closing soon in ${g.name || 'your group'}`, [`"${p.title}" closes in ${hrs(left)}, and you haven't voted yet.`],
          { label: 'Vote now', url: link('/#/group/' + p.gid + '/proposals') }).catch(e => console.error('vote notice', e.message)); }
    }
  }

  /* ---------- the daily summary to the Pocket team (item 97) ---------- */
  async function summaryData(){
    const one = async (sql, p) => (await q(sql, p).catch(() => ({ rows: [{}] }))).rows[0] || {};
    const reqs = (await q(`SELECT name, email, how FROM waitlist WHERE created_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 10`).catch(() => ({ rows: [] }))).rows;
    const waiting = (await one(`SELECT count(*)::int n FROM waitlist WHERE invited_code IS NULL`)).n || 0;
    const signups = (await one(`SELECT count(*)::int n FROM users WHERE created_at > now() - interval '24 hours' AND NOT coalesce(is_test, false)`)).n || 0;
    const support = await one(`SELECT count(*)::int n, min(created_at) oldest FROM support_requests WHERE status NOT IN ('answered', 'closed')`);
    const leaders = (await q(`SELECT name, platform, followers FROM leader_applications WHERE created_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 10`).catch(() => ({ rows: [] }))).rows;
    const leadersNew = (await one(`SELECT count(*)::int n FROM leader_applications WHERE status = 'new'`)).n || 0;
    const locked = (await one(`SELECT count(*)::int n FROM users WHERE locked_at IS NOT NULL`)).n || 0;
    const errors = (await one(`SELECT count(*)::int n FROM client_errors WHERE created_at > now() - interval '24 hours'`)).n || 0;
    const failed = (await one(`SELECT count(*)::int n FROM email_log WHERE status = 'failed' AND created_at > now() - interval '24 hours'`)).n || 0;
    let alerts = []; try { alerts = ((d.secStats && await d.secStats()) || {}).alerts || []; } catch (e){}
    return { reqs, waiting, leaders, leadersNew, signups, support: support.n || 0, oldest: support.oldest, locked, errors, failed, alerts };
  }
  async function sendSummary(force){
    const s = await summaryData();
    const lines = [
      `New invite requests: ${s.reqs.length}${s.reqs.length ? ' (' + s.reqs.map(r => r.name || r.email).join(', ') + ')' : ''}. Waiting for an invite: ${s.waiting}.`,
      `Founding Leader applications: ${s.leaders.length}${s.leaders.length ? ' (' + s.leaders.map(l => `${l.name}, ${PLATFORM[l.platform] || l.platform}, ${FOLLOWERS[l.followers] || l.followers}`).join('; ') + ')' : ''}. Not reviewed yet: ${s.leadersNew}.`,
      `New sign-ups: ${s.signups}.`,
      `Open support requests: ${s.support}${s.oldest ? ', oldest from ' + new Date(s.oldest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : ''}.`,
      `Locked accounts: ${s.locked}.`,
      `Security alerts: ${s.alerts.length ? s.alerts.map(a => a.text).join(' ') : 'none'}.`,
      `Errors in the last day: ${s.errors}. Emails that failed: ${s.failed}.`];
    const admins = (await q(`SELECT id, email FROM users WHERE (is_admin OR lower(username) = ANY($1)) AND email IS NOT NULL AND email_verified_at IS NOT NULL AND NOT coalesce(is_test, false)`, [d.envAdmins || []])).rows;
    const site = config.demoSite ? 'demo' : config.realMoney ? 'real-money site' : 'beta';
    for (const a of admins) await em.sendRaw(a.id, a.email, 'summary', `Pocket daily summary (${site})`, lines, { label: 'Open Beta admin', url: link('/#/admin') });
    return { sent: admins.length, lines };
  }
  async function summaryTick(){
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
    if (Number(parts.hour) < 8) return;
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (!(await once('summary:' + day))) return;
    await sendSummary().catch(e => console.error('daily summary', e.message));
  }

  function start(){
    setInterval(() => sweep().catch(e => console.error('notices', e.message)), 60000).unref();
    setInterval(() => voteSweep().catch(e => console.error('votes', e.message)), 10 * 60000).unref();
    setInterval(() => summaryTick().catch(e => console.error('summary', e.message)), 10 * 60000).unref();
    setTimeout(() => summaryTick().catch(() => {}), 30000).unref();
  }

  /* ---------- routes ---------- */
  function mount(app, r){
    const { wrap, ok, bad, needAdmin, needUser, clean } = r;
    /* One-click unsubscribe: what the link is for, then the POST that turns it off (also what mail apps send). */
    app.get('/api/unsubscribe/:token', wrap(async (req, res) => { const t = await em.readUnsub(req.params.token); if (!t) return bad(res, "This link isn't valid. Change your email settings in Pocket instead.", 404); ok(res, { kind: t.kind, label: t.label }); }));
    app.post('/api/unsubscribe/:token', wrap(async (req, res) => {
      const t = await em.readUnsub(req.params.token); if (!t) return bad(res, "This link isn't valid. Change your email settings in Pocket instead.", 404);
      await q(`UPDATE users SET email_prefs = email_prefs || $2::jsonb WHERE id = $1`, [t.userId, JSON.stringify({ [t.kind]: false })]);
      ok(res, { kind: t.kind, label: t.label });
    }));
    /* Item 113: Founding Leader applications. */
    const leadHits = new Map();
    app.post('/api/leaders/apply', wrap(async (req, res) => {
      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), now = Date.now(), h = (leadHits.get(ip) || []).filter(t => now - t < 3600000);
      if (h.length >= 10) return bad(res, 'Too many applications from this connection. Try again in an hour.', 429); h.push(now); leadHits.set(ip, h);
      if (req.body.website) return ok(res); /* hidden field: bots fill it in */
      if (r.verifyBot && !(await r.verifyBot(req.body.botToken, ip))) return bad(res, "Please complete the check that you're not a bot, then try again.");
      const t = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
      const email = t(req.body.email, 160).toLowerCase(), name = t(req.body.name, 80), handles = t(req.body.handles, 300), invests = t(req.body.invests, 500);
      if (!require('./email').validEmail(email)) return bad(res, 'Enter a valid email address.');
      if (!name) return bad(res, 'Enter your name.'); if (!handles) return bad(res, 'Add at least one social handle.'); if (!invests) return bad(res, 'Tell us a little about what you invest in.');
      const platform = PLATFORM[req.body.platform] ? req.body.platform : 'other', followers = FOLLOWERS[req.body.followers] ? req.body.followers : null;
      await q(`INSERT INTO leader_applications (email, name, handles, platform, followers, invests, source) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, handles = EXCLUDED.handles, platform = EXCLUDED.platform, followers = EXCLUDED.followers, invests = EXCLUDED.invests, updated_at = now()`,
        [email, name, handles, platform, followers, invests, t(req.body.source, 80) || 'website']);
      const first = (await q(`UPDATE leader_applications SET confirm_sent_at = now() WHERE email = $1 AND confirm_sent_at IS NULL RETURNING id`, [email])).rows.length;
      if (first) await em.sendRaw(null, email, 'leader-apply', 'We got your Founding Leader application', [`Hi ${name.split(/\s+/)[0]},`,
        'Thanks for applying to be a Founding Leader on Pocket Investing. We read every application ourselves.', "We'll email you within a couple of weeks about next steps."],
        null, ["Didn't apply? You can ignore this email; we won't send anything else."]).catch(e => console.error('leader email', e.message));
      ok(res);
    }));
    app.get('/api/admin/leaders', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
      ok(res, { applications: (await q('SELECT id, email, name, handles, platform, followers, invests, source, status, note, invited_code, emailed_at, created_at FROM leader_applications ORDER BY created_at DESC LIMIT 500')).rows.map(a => Object.assign(a, { platformLabel: PLATFORM[a.platform] || a.platform, followersLabel: FOLLOWERS[a.followers] || '' })) }); }));
    app.post('/api/admin/leaders/status', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
      const st = ['new', 'contacted', 'accepted', 'declined'].includes(req.body.status) ? req.body.status : null; if (!st) return bad(res, 'Pick a status.');
      const n = (await q('UPDATE leader_applications SET status = $2, updated_at = now() WHERE id = $1 RETURNING id', [Number(req.body.id) || 0, st])).rows.length; if (!n) return bad(res, 'Application not found.', 404); ok(res); }));
    app.post('/api/admin/leaders/invite', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
      const a = (await q('SELECT * FROM leader_applications WHERE id = $1', [Number(req.body.id) || 0])).rows[0]; if (!a) return bad(res, 'Application not found.', 404);
      if (a.emailed_at && Date.now() - new Date(a.emailed_at).getTime() < 10 * 60000 && !req.body.again) return bad(res, 'An invite was emailed to them a few minutes ago.');
      let code = a.invited_code;
      if (!code){ code = 'PI-' + require('crypto').randomBytes(3).toString('hex').toUpperCase(); await q('INSERT INTO invite_codes (code, label, max_uses) VALUES ($1, $2, 1)', [code, ('Leader: ' + a.name).slice(0, 60)]); }
      const id = await em.sendRaw(null, a.email, 'invite', 'Your Founding Leader invite to Pocket Investing', [`Hi ${a.name.split(/\s+/)[0]},`, "You're in. Use the button below to create your Pocket Investing account, then start a group from Groups.",
        'The beta uses practice money, so you and your followers can try everything with nothing at risk.'], { label: 'Create your account', url: link('/#/signup/' + code) }, [`Your invite code is ${code}. It works once.`, 'Questions? Just reply to this email.']);
      if (!id) return bad(res, "That email address doesn't look valid, so nothing was sent.");
      await q(`UPDATE leader_applications SET invited_code = $2, emailed_at = now(), status = 'accepted', updated_at = now() WHERE id = $1`, [a.id, code]); ok(res, { code });
    }));
    /* Item 95: email an invite straight from Invite requests. */
    app.post('/api/admin/waitlist/send', wrap(async (req, res) => {
      const a = await needAdmin(req, res); if (!a) return;
      const row = (await q('SELECT * FROM waitlist WHERE id = $1', [Number(req.body.id)])).rows[0]; if (!row) return bad(res, 'Request not found.', 404);
      if (row.emailed_at && Date.now() - new Date(row.emailed_at).getTime() < 10 * 60000 && !req.body.again) return bad(res, 'An invite was emailed to them a few minutes ago.');
      let code = row.invited_code;
      if (!code){ code = 'PI-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
        await q('INSERT INTO invite_codes (code, label, max_uses) VALUES ($1, $2, 1)', [code, ('Website: ' + (row.name || row.email)).slice(0, 60)]);
        await q('UPDATE waitlist SET invited_code = $2, invited_at = now() WHERE id = $1', [row.id, code]); }
      const first = String(row.name || '').trim().split(/\s+/)[0] || 'there';
      const id = await em.sendRaw(null, row.email, 'invite', 'Your invite to the Pocket Investing beta', [`Hi ${first},`, "Your invite to the Pocket Investing beta is ready. Use the button below to create your account.",
        'The beta uses practice money, so you can try everything with nothing at risk.'], { label: 'Create your account', url: link('/#/signup/' + code) },
        [`Your invite code is ${code}. It works once.`, 'Questions? Just reply to this email.']);
      if (!id) return bad(res, "That email address doesn't look valid, so nothing was sent.");
      await q('UPDATE waitlist SET emailed_at = now() WHERE id = $1', [row.id]);
      ok(res, { code, emailed: true });
    }));
    /* Item 99: a test email to yourself, then wait a few seconds to see what Resend said. */
    app.post('/api/admin/email/test', wrap(async (req, res) => {
      const a = await needAdmin(req, res); if (!a) return;
      const u = (await q('SELECT email, email_verified_at, display_name FROM users WHERE id = $1', [a.id])).rows[0];
      if (!u || !u.email) return bad(res, 'Add an email address to your profile first (Profile, Email).');
      if (!config.email.key) return ok(res, { status: 'not-configured', to: require('./email').maskEmail(u.email) });
      const id = await em.sendRaw(a.id, u.email, 'test', 'Test email from Pocket Investing', [`Hi ${u.display_name || 'there'},`, `This is a test from the ${config.demoSite ? 'demo' : config.realMoney ? 'real-money site' : 'beta'} (${config.appUrl}).`,
        `It was sent from ${config.email.from}. Replies go to ${config.email.replyTo}.`, 'If you can read this, email is working.']);
      let row = null; for (let i = 0; i < 24; i++){ row = (await q('SELECT status, error FROM email_log WHERE id = $1', [id])).rows[0]; if (row && !['queued'].includes(row.status)) break; await new Promise(r => setTimeout(r, 500)); }
      ok(res, { status: row ? row.status : 'queued', error: row && row.error, to: require('./email').maskEmail(u.email) });
    }));
    app.post('/api/admin/email/summary', wrap(async (req, res) => { const a = await needAdmin(req, res); if (!a) return; ok(res, await sendSummary(true)); }));
  }

  return { later, sweep, voteSweep, fromPush, fromNotify, sendSummary, summaryData, start, mount, once };
}

module.exports = { migrate, create };
