/* Support requests and complaints, idea statuses (feedback, bug reports, badge ideas), and the public status page. */
const crypto = require('crypto');
const STATUS = { received: 'Received', considering: 'Under consideration', planned: 'Planned', live: 'Live', notplanned: 'Not planned', confirmed: 'Confirmed' };
const BAN = /guarantee|pump|dump|signal|get ?rich|rich ?quick|free ?money|can'?t ?lose|no ?risk|risk ?free|sure ?thing|insider|\b\d+x\b|to the moon|double your|\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|nazi|porn|sex)/i;
async function migrate(q){
  await q(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'feedback', ADD COLUMN IF NOT EXISTS note text, ADD COLUMN IF NOT EXISTS updated_at timestamptz`);
  await q(`CREATE TABLE IF NOT EXISTS support_requests (id text PRIMARY KEY, ref text UNIQUE NOT NULL, user_id text NOT NULL, topic text NOT NULL, body text NOT NULL, screenshot text, complaint boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'received', outcome text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS support_replies (id bigserial PRIMARY KEY, request_id text NOT NULL, from_admin boolean NOT NULL, body text NOT NULL, ts timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS incidents (id text PRIMARY KEY, title text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz)`);
  await q(`CREATE TABLE IF NOT EXISTS incident_updates (id bigserial PRIMARY KEY, incident_id text NOT NULL, status text NOT NULL, body text NOT NULL, ts timestamptz NOT NULL DEFAULT now())`);
}
function mount(app, d){
  const { q, wrap, ok, bad, needUser, needAdmin, push, db, sendTo } = d;
  const tell = (uid, title, body, url) => { push.send(db.pool, ['u_' + uid], { title, body, url, tag: 'c-' + Date.now() }).catch(() => {}); sendTo(uid, { type: 'alert', text: title + '. ' + body }); };
  const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
  /* Ideas and reports, with statuses members can see. */
  app.get('/api/my-ideas', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    ok(res, { items: (await q(`SELECT id, kind, body, status, note, created_at, updated_at FROM feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [u.id])).rows.map(r => Object.assign(r, { label: STATUS[r.status] || (r.status === 'open' ? 'Received' : r.status === 'done' ? 'Reviewed' : r.status) })) }); }));
  app.post('/api/badge-ideas', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const name = clean(req.body.name, 24), why = clean(req.body.why, 300), earn = clean(req.body.earn, 300);
    if (!name || !why) return bad(res, 'Give the badge a name and say what it\'s for.');
    if (BAN.test(name + ' ' + why + ' ' + earn)) return bad(res, "That idea can't be used: badges can't promise returns or include offensive words.");
    if (Number((await q(`SELECT count(*)::int AS n FROM feedback WHERE user_id = $1 AND kind = 'badge' AND created_at > now() - interval '7 days'`, [u.id])).rows[0].n) >= 3) return bad(res, 'You can suggest up to 3 badges a week.');
    await q(`INSERT INTO feedback (id, user_id, screen, body, kind, status) VALUES ($1, $2, 'badges', $3, 'badge', 'received')`, [db.newId(), u.id, JSON.stringify({ name, why, earn })]); ok(res); }));
  app.post('/api/admin/idea-status', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
    const st = String(req.body.status || ''); if (!STATUS[st]) return bad(res, 'Pick a status.');
    const r = (await q(`UPDATE feedback SET status = $2, note = $3, updated_at = now() WHERE id = $1 RETURNING user_id, kind, body`, [String(req.body.id || ''), st, clean(req.body.note, 200) || null])).rows[0]; if (!r) return bad(res, 'Not found.');
    if (r.user_id){ const what = r.kind === 'badge' ? 'Your badge idea' : r.kind === 'bug' ? 'Your bug report' : 'Your idea';
      tell(r.user_id, st === 'live' && r.kind === 'badge' ? 'Your badge idea is live' : `${what}: ${STATUS[st]}`, clean(req.body.note, 200) || 'Thanks for helping shape Pocket.', '/#/help'); }
    if (d.onContribution) d.onContribution(r.user_id).catch(() => {}); ok(res); }));
  /* Support requests. Brokerage complaints are logged with dates and outcomes. */
  const ref = () => 'S-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  app.post('/api/support', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const topic = ['account', 'money', 'groups', 'bug', 'other'].includes(req.body.topic) ? req.body.topic : 'other', body = clean(req.body.body, 4000); if (!body) return bad(res, 'Tell us what happened.');
    const shot = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(req.body.screenshot || '')) && String(req.body.screenshot).length < 1.4e6 ? req.body.screenshot : null;
    const r = ref(); await q('INSERT INTO support_requests (id, ref, user_id, topic, body, screenshot, complaint) VALUES ($1, $2, $3, $4, $5, $6, $7)', [db.newId(), r, u.id, topic, body, shot, topic === 'money' && !!req.body.complaint]);
    ok(res, { ref: r }); }));
  app.get('/api/support', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const rs = (await q('SELECT id, ref, topic, body, status, complaint, created_at, updated_at FROM support_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [u.id])).rows;
    for (const r of rs) r.replies = (await q('SELECT from_admin, body, ts FROM support_replies WHERE request_id = $1 ORDER BY ts', [r.id])).rows;
    ok(res, { requests: rs }); }));
  app.post('/api/support/:id/reply', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const r = (await q('SELECT id FROM support_requests WHERE id = $1 AND user_id = $2', [req.params.id, u.id])).rows[0]; if (!r) return bad(res, 'Request not found.');
    const body = clean(req.body.body, 4000); if (!body) return bad(res, 'Write a reply.');
    await q('INSERT INTO support_replies (request_id, from_admin, body) VALUES ($1, false, $2)', [r.id, body]); await q(`UPDATE support_requests SET status = 'received', updated_at = now() WHERE id = $1`, [r.id]); ok(res); }));
  app.get('/api/admin/support', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
    const rs = (await q(`SELECT s.id, s.ref, s.topic, s.body, s.status, s.complaint, s.outcome, s.created_at, s.updated_at, (s.screenshot IS NOT NULL) AS has_shot, u.username FROM support_requests s LEFT JOIN users u ON u.id = s.user_id ORDER BY (s.status = 'answered' OR s.status = 'closed'), s.updated_at DESC LIMIT 100`)).rows;
    for (const r of rs) r.replies = (await q('SELECT from_admin, body, ts FROM support_replies WHERE request_id = $1 ORDER BY ts', [r.id])).rows;
    ok(res, { requests: rs }); }));
  app.get('/api/admin/support/:id/screenshot', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; const r = (await q('SELECT screenshot FROM support_requests WHERE id = $1', [req.params.id])).rows[0];
    if (!r || !r.screenshot) return res.status(404).end(); const m = /^data:(image\/\w+);base64,(.*)$/.exec(r.screenshot); res.set({ 'Content-Type': m[1], 'X-Content-Type-Options': 'nosniff' }); res.end(Buffer.from(m[2], 'base64')); }));
  app.post('/api/admin/support/:id', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
    const r = (await q('SELECT id, ref, user_id FROM support_requests WHERE id = $1', [req.params.id])).rows[0]; if (!r) return bad(res, 'Request not found.');
    const reply = clean(req.body.reply, 4000); if (reply) await q('INSERT INTO support_replies (request_id, from_admin, body) VALUES ($1, true, $2)', [r.id, reply]);
    const st = ['received', 'answered', 'closed'].includes(req.body.status) ? req.body.status : (reply ? 'answered' : null);
    await q('UPDATE support_requests SET status = coalesce($2, status), complaint = coalesce($3, complaint), outcome = coalesce($4, outcome), updated_at = now() WHERE id = $1', [r.id, st, typeof req.body.complaint === 'boolean' ? req.body.complaint : null, clean(req.body.outcome, 300) || null]);
    if (reply) tell(r.user_id, `Reply to your request ${r.ref}`, reply.slice(0, 120), '/#/help'); ok(res); }));
  /* Status page. */
  async function current(){ const inc = (await q(`SELECT * FROM incidents ORDER BY created_at DESC LIMIT 20`)).rows; for (const i of inc) i.updates = (await q('SELECT status, body, ts FROM incident_updates WHERE incident_id = $1 ORDER BY ts DESC', [i.id])).rows; return inc; }
  app.get('/api/status', wrap(async (req, res) => { const inc = await current(); ok(res, { active: inc.filter(i => !i.resolved_at), recent: inc.filter(i => i.resolved_at).slice(0, 10) }); }));
  app.post('/api/admin/incident', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; const b = req.body || {}, st = ['investigating', 'identified', 'monitoring', 'resolved'].includes(b.status) ? b.status : 'investigating', body = clean(b.body, 1000);
    if (b.op === 'create'){ const title = clean(b.title, 120); if (!title || !body) return bad(res, 'Add a title and what\'s happening.'); const id = db.newId(); await q('INSERT INTO incidents (id, title, status) VALUES ($1, $2, $3)', [id, title, st]); await q('INSERT INTO incident_updates (incident_id, status, body) VALUES ($1, $2, $3)', [id, st, body]); d.broadcastAll({ type: 'status' }); return ok(res, { id }); }
    const i = (await q('SELECT id FROM incidents WHERE id = $1', [String(b.id || '')])).rows[0]; if (!i) return bad(res, 'Incident not found.'); if (!body) return bad(res, 'Add an update.');
    await q('INSERT INTO incident_updates (incident_id, status, body) VALUES ($1, $2, $3)', [i.id, st, body]); await q(`UPDATE incidents SET status = $2, resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END WHERE id = $1`, [i.id, st]); d.broadcastAll({ type: 'status' }); ok(res); }));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const LBL = { investigating: 'Investigating', identified: 'Cause found', monitoring: 'Fix in place, monitoring', resolved: 'Resolved' };
  app.get('/status', wrap(async (req, res) => { const inc = await current(), act = inc.filter(i => !i.resolved_at), past = inc.filter(i => i.resolved_at).slice(0, 10);
    const card = i => `<section class="inc"><h3>${esc(i.title)} <span class="pill ${i.resolved_at ? 'ok' : 'warn'}">${LBL[i.status] || esc(i.status)}</span></h3>${i.updates.map(u => `<p><b>${LBL[u.status] || esc(u.status)}</b> · <span class="t">${new Date(u.ts).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</span><br>${esc(u.body)}</p>`).join('')}</section>`;
    res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pocket status</title><meta name="description" content="Current status of Pocket Investing."><style>:root{--bg:#f2f4f8;--card:#fff;--text:#14213d;--muted:#5b6478;--line:#e1e5ed;--ok:#14804a;--warn:#b3541e}@media (prefers-color-scheme:dark){:root{--bg:#0e1424;--card:#172038;--text:#e8ecf5;--muted:#a3adc2;--line:#2a3552;--ok:#4cc38a;--warn:#f0a35e}}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text)}main{max-width:720px;margin:0 auto;padding:28px 18px 60px}a{color:inherit}.banner{padding:18px 20px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-weight:600;font-size:18px;margin:18px 0}.banner.ok{border-left:6px solid var(--ok)}.banner.warn{border-left:6px solid var(--warn)}.inc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:12px 0}.inc h3{margin:0 0 6px;font-size:17px}.pill{font-size:12px;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}.pill.ok{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.pill.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.t{color:var(--muted);font-size:14px}h2{font-size:15px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:28px}</style></head><body><main><a href="/" style="text-decoration:none;font-weight:700">← Pocket</a><h1 style="margin:14px 0 0">Pocket status</h1>
      <div class="banner ${act.length ? 'warn' : 'ok'}">${act.length ? `${act.length === 1 ? 'We\'re working on a problem' : 'We\'re working on ' + act.length + ' problems'}` : 'All systems working'}</div>${act.map(card).join('')}<h2>Recent</h2>${past.map(card).join('') || '<p class="t">No incidents recently.</p>'}</main></body></html>`); }));
}
module.exports = { migrate, mount, STATUS };
