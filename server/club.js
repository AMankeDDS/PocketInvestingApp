/* Club books: investment club accounting with the unit value system. Kept in its own table and
   served only to the group's full members, never in the public data snapshot. Treasurers,
   Owners and Admins can edit; every member can read. */
const crypto = require('crypto');
const EDIT = ['owner', 'admin', 'treasurer', 'asstTreasurer'];
const ROLE_WAIT = 3 * 86400000;
const monthOf = d => String(d).slice(0, 7);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const r2 = n => Math.round(n * 100) / 100;

function replay(entries, startUV){
  const list = entries.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order - b.order) || (a.ts - b.ts));
  let units = 0, uv = startUV, value = 0; const members = {}; const out = []; let problem = null;
  for (const e of list){
    const x = Object.assign({}, e);
    if (e.kind === 'valuation'){ if (units <= 1e-9 && e.amount > 0.005 && !problem) problem = { id: e.id, date: e.date, kind: 'nounits' }; value = e.amount; uv = units > 1e-9 ? value / units : startUV; x.unitValue = uv; }
    else {
      const m = members[e.pid] = members[e.pid] || { units: 0, paid: 0, withdrawn: 0 };
      const u = e.amount / uv; x.unitValue = uv; x.units = u;
      if (e.kind === 'payment'){ units += u; value += e.amount; m.units += u; m.paid += e.amount; }
      else { if (u > m.units + 1e-6 && !problem) problem = { id: e.id, date: e.date }; units -= u; value -= e.amount; m.units -= u; m.withdrawn += e.amount; }
    }
    x.clubValue = value; x.clubUnits = units; out.push(x);
  }
  return { entries: out, units, unitValue: uv, value, members, problem };
}
function summary(all, startUV, pids){
  const voided = all.filter(e => e.voided), entries = all.filter(e => !e.voided);
  const R = replay(entries, startUV);
  const rows = pids.map(pid => { const m = R.members[pid] || { units: 0, paid: 0, withdrawn: 0 }, val = m.units * R.unitValue;
    return { pid, units: m.units, value: val, share: R.units > 1e-9 ? m.units / R.units : 0, paid: m.paid, withdrawn: m.withdrawn, gain: val + m.withdrawn - m.paid }; });
  Object.keys(R.members).filter(p => !pids.includes(p)).forEach(pid => { const m = R.members[pid]; rows.push({ pid, former: true, units: m.units, value: m.units * R.unitValue, share: R.units > 1e-9 ? m.units / R.units : 0, paid: m.paid, withdrawn: m.withdrawn, gain: m.units * R.unitValue + m.withdrawn - m.paid }); });
  const years = {};
  const ys = [...new Set(entries.map(e => e.date.slice(0, 4)))].sort();
  for (const y of ys){
    const before = replay(entries.filter(e => e.date < y + '-01-01'), startUV), upto = replay(entries.filter(e => e.date <= y + '-12-31'), startUV);
    years[y] = rows.map(r => { const a = before.members[r.pid] || { units: 0, paid: 0, withdrawn: 0 }, b = upto.members[r.pid] || { units: 0, paid: 0, withdrawn: 0 };
      const sv = a.units * before.unitValue, ev = b.units * upto.unitValue, paid = b.paid - a.paid, wd = b.withdrawn - a.withdrawn;
      return { pid: r.pid, startValue: sv, paid, withdrawn: wd, endValue: ev, gain: ev - sv - paid + wd }; }).filter(x => x.startValue || x.paid || x.withdrawn || x.endValue);
  }
  return { entries: R.entries.concat(voided).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts - b.ts), units: R.units, unitValue: R.unitValue, value: R.value, members: rows, years, problem: R.problem };
}
function mount(app, d){
  const { q, wrap, ok, bad, needUser } = d;
  (async () => {
    await q(`CREATE TABLE IF NOT EXISTS club_books (gid text PRIMARY KEY, data jsonb NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS club_entries (id text PRIMARY KEY, gid text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS club_entries_gid ON club_entries (gid)`);
    await q(`CREATE TABLE IF NOT EXISTS club_submissions (id text PRIMARY KEY, gid text NOT NULL, pid text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS club_submissions_gid ON club_submissions (gid)`);
    await q(`CREATE TABLE IF NOT EXISTS club_tax_docs (id text PRIMARY KEY, gid text NOT NULL, pid text, year int NOT NULL, kind text NOT NULL, file_id text NOT NULL, name text, uploaded_by text, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS club_log (id bigserial PRIMARY KEY, gid text NOT NULL, pid text, text text NOT NULL, ts timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS club_log_gid ON club_log (gid, id)`);
    await q(`CREATE TABLE IF NOT EXISTS club_files (id text PRIMARY KEY, gid text NOT NULL, pid text NOT NULL, name text, mime text NOT NULL, size int NOT NULL, bytes bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  })().catch(e => console.error('club tables', e.message));
  async function access(req, res, needEdit){
    const u = await needUser(req, res); if (!u) return null;
    const gid = String(req.params.gid || ''), pid = 'u_' + u.id;
    const m = ((await q('SELECT data FROM doc_memberships WHERE id = $1', [gid + '__' + pid])).rows[0] || {}).data;
    if (!m || m.role === 'observer'){ bad(res, 'Club books are for full members of this group.', 403); return null; }
    if (needEdit && !EDIT.includes(m.role)){ bad(res, 'Only the Treasurer, Owner or Admins can change the club books.', 403); return null; }
    const twoStep = !!((await q('SELECT totp_enabled FROM users WHERE id = $1', [u.id])).rows[0] || {}).totp_enabled;
    if (needEdit && !twoStep){ bad(res, 'Club money actions need two-step sign-in. Turn it on in your Profile, then try again.', 403); return null; }
    return { gid, pid, role: m.role, roleChangedTs: m.roleChangedTs || null, canEdit: EDIT.includes(m.role), twoStep };
  }
  const notify = (pids, payload) => { const p = [...new Set((pids || []).filter(Boolean))]; if (p.length && d.push) d.push(p, payload); };
  const gname = async gid => ((((await q('SELECT data FROM doc_groups WHERE id = $1', [gid])).rows[0]) || {}).data || {}).name || 'Your club';
  async function eligible(gid, exclude){
    const ms = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [gid])).rows.map(r => r.data).filter(m => m.role !== 'observer' && !exclude.includes(m.pid));
    const officers = ms.filter(m => EDIT.includes(m.role) && !(m.roleChangedTs && Date.now() - m.roleChangedTs < ROLE_WAIT)).map(m => m.pid);
    return officers.length ? officers : ms.map(m => m.pid);
  }
  const log = (gid, pid, text) => q('INSERT INTO club_log (gid, pid, text) VALUES ($1, $2, $3)', [gid, pid, String(text).slice(0, 300)]).catch(() => {});
  /* Same approver rule as withdrawals: never yourself; officers with a money role (after the wait), or any other member if none is available. */
  async function canApprove(gid, pid, exclude){
    if (exclude.includes(pid)) return false;
    const ms = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [gid])).rows.map(r => r.data).filter(m => m.role !== 'observer' && !exclude.includes(m.pid));
    const officers = ms.filter(m => EDIT.includes(m.role) && !(m.roleChangedTs && Date.now() - m.roleChangedTs < ROLE_WAIT)).map(m => m.pid);
    return officers.length ? officers.includes(pid) : ms.some(m => m.pid === pid);
  }
  const lockedThrough = B => ((B && B.closes) || []).filter(c => c.signedBy).map(c => c.month).sort().slice(-1)[0] || '';
  const book = async gid => ((await q('SELECT data FROM club_books WHERE gid = $1', [gid])).rows[0] || {}).data || null;
  const entries = async gid => (await q('SELECT id, data FROM club_entries WHERE gid = $1', [gid])).rows.map(r => Object.assign({ id: r.id }, r.data));
  const members = async gid => (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [gid])).rows.map(r => r.data).filter(m => m.role !== 'observer').map(m => m.pid);
  async function full(gid){ const B = await book(gid); if (!B) return { book: null }; const E = await entries(gid); return Object.assign({ book: B }, summary(E, B.startUnitValue, await members(gid))); }
  /* Requests and uploads: members see their own; editors see all payment proofs and withdrawals;
     club documents (for the Pocket team's review) are visible to every full member. */
  async function submissions(A){
    const rows = (await q('SELECT id, pid, data, created_at FROM club_submissions WHERE gid = $1 ORDER BY created_at DESC LIMIT 200', [A.gid])).rows.map(r => Object.assign({ id: r.id, pid: r.pid }, r.data));
    const fallback = !A.canEdit && await canApprove(A.gid, A.pid, []);
    return rows.filter(x => x.kind === 'document' || A.canEdit || fallback || x.pid === A.pid);
  }
  const pooled = async gid => !!((((await q('SELECT data FROM doc_groups WHERE id = $1', [gid])).rows[0]) || {}).data || {}).pooled;
  async function view(A){
    const logRows = (await q('SELECT pid, text, ts FROM club_log WHERE gid = $1 ORDER BY id DESC LIMIT 100', [A.gid])).rows.map(r => ({ pid: r.pid, text: r.text, ts: new Date(r.ts).getTime() }));
    const Acc = require('./accounts'); let nums = { club: null, members: {} };
    try { await Acc.club(A.gid); for (const m of (await members(A.gid))) await Acc.member(A.gid, m); nums = await Acc.clubNumbers(A.gid); } catch (e){}
    const numbers = { club: nums.club, mine: nums.members[A.pid] || null, members: A.canEdit ? nums.members : {} };
    return Object.assign({ numbers, canEdit: A.canEdit, roleWaitUntil: A.roleChangedTs && EDIT.includes(A.role) ? A.roleChangedTs + ROLE_WAIT : null, pooled: await pooled(A.gid), submissions: await submissions(A), log: logRows }, await full(A.gid));
  }
  app.get('/api/club/:gid', wrap(async (req, res) => { const A = await access(req, res); if (!A) return; ok(res, await view(A)); }));
  const TYPES = { 'image/jpeg': [0xff, 0xd8], 'image/png': [0x89, 0x50], 'image/webp': [0x52, 0x49], 'application/pdf': [0x25, 0x50] };
  const DOCS = ['Articles of organization (LLC)', 'Partnership agreement', 'Tax ID (EIN) letter', 'Operating agreement', 'Bank or brokerage statement', 'Other'];
  app.post('/api/club/:gid/submit', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    const kind = String(req.body.kind || ''), f = req.body.file || {};
    if (!['payment', 'document'].includes(kind)) return bad(res, 'Unknown request type.');
    if (kind === 'document' && !A.canEdit) return bad(res, 'Only the Treasurer, Owner or Admins can send club documents.', 403);
    if (kind === 'document' && !A.twoStep) return bad(res, 'Club money actions need two-step sign-in. Turn it on in your Profile, then try again.', 403);
    const mime = String(f.type || ''), buf = Buffer.from(String(f.data || ''), 'base64');
    if (!TYPES[mime]) return bad(res, 'Upload a photo (JPG, PNG or WebP) or a PDF.');
    if (!buf.length || buf.length > 5 * 1024 * 1024) return bad(res, 'Files can be up to 5 MB.');
    if (buf[0] !== TYPES[mime][0] || buf[1] !== TYPES[mime][1]) return bad(res, "That file doesn't look like a " + (mime === 'application/pdf' ? 'PDF' : 'photo') + '.');
    const data = { kind, status: 'pending', ts: Date.now(), note: String(req.body.note || '').slice(0, 300) };
    if (kind === 'payment'){
      if (await pooled(A.gid)) return bad(res, 'In a pooled club, add money from your portfolio instead.');
      const amount = r2(Number(req.body.amount)); if (!(amount > 0) || amount > 1e7) return bad(res, 'Enter the amount you paid.');
      if (!isDate(String(req.body.date || ''))) return bad(res, 'Pick the date you paid.');
      Object.assign(data, { amount, date: String(req.body.date) });
    } else { const dt = String(req.body.docType || ''); if (!DOCS.includes(dt)) return bad(res, 'Pick the document type.'); data.docType = dt; }
    const fid = crypto.randomBytes(10).toString('hex');
    await q('INSERT INTO club_files (id, gid, pid, name, mime, size, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)', [fid, A.gid, A.pid, String(f.name || 'upload').slice(0, 120), mime, buf.length, buf]);
    data.fileId = fid; data.fileName = String(f.name || 'upload').slice(0, 120);
    await q('INSERT INTO club_submissions (id, gid, pid, data) VALUES ($1, $2, $3, $4)', [crypto.randomBytes(8).toString('hex'), A.gid, A.pid, JSON.stringify(data)]);
    await log(A.gid, A.pid, kind === 'document' ? `Sent ${data.docType} to Pocket for review` : `Sent proof of a $${data.amount.toFixed(2)} payment`);
    if (kind === 'payment') notify(await eligible(A.gid, [A.pid]), { title: (await gname(A.gid)) + ': payment to review', body: `A member sent proof of a $${data.amount.toFixed(2)} payment.`, url: '/#/group/' + A.gid + '/club', tag: 'club-' + A.gid });
    ok(res, await view(A));
  }));
  /* The club's Treasurer, Owner or Admins confirm or decline payment proofs; confirming records the payment. */
  app.post('/api/club/:gid/review', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    const row = (await q('SELECT id, pid, data FROM club_submissions WHERE id = $1 AND gid = $2', [req.body.id, A.gid])).rows[0];
    if (!row || row.data.kind !== 'payment') return bad(res, 'Request not found.');
    if (row.data.status !== 'pending') return bad(res, 'This was already decided.');
    const decision = req.body.decision === 'confirmed' ? 'confirmed' : 'declined', note = String(req.body.note || '').slice(0, 300);
    if (row.pid === A.pid) return bad(res, "You can't review your own payment. Another officer or member will.");
    if (!A.twoStep) return bad(res, 'Club money actions need two-step sign-in. Turn it on in your Profile, then try again.', 403);
    if (!(await canApprove(A.gid, A.pid, [row.pid]))) return bad(res, "You can't review this one yet. New money roles wait 7 days.");
    if (decision === 'declined' && !note) return bad(res, 'Add a short note so the member knows why.');
    if (decision === 'confirmed') await add(A, [{ kind: 'payment', amount: row.data.amount, date: row.data.date, pid: row.pid, note: 'Proof confirmed' + (row.data.note ? ': ' + row.data.note.slice(0, 80) : ''), by: A.pid, ts: Date.now(), order: 1 }]);
    await q('UPDATE club_submissions SET data = data || $2::jsonb WHERE id = $1', [row.id, JSON.stringify({ status: decision, reviewNote: note, reviewerPid: A.pid, reviewedTs: Date.now() })]);
    await log(A.gid, A.pid, `Payment proof of $${row.data.amount.toFixed(2)} ${decision}`);
    notify([row.pid], { title: (await gname(A.gid)) + ': payment ' + decision, body: decision === 'confirmed' ? `Your $${row.data.amount.toFixed(2)} payment was confirmed and added to the books.` : `Your payment proof was declined: ${note}`, url: '/#/group/' + A.gid + '/club', tag: 'club-' + A.gid });
    ok(res, await view(A));
  }));
  app.get('/api/club/:gid/file/:fid', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const f = (await q('SELECT id, gid, pid, name, mime, bytes FROM club_files WHERE id = $1 AND gid = $2', [req.params.fid, req.params.gid])).rows[0]; if (!f) return bad(res, 'File not found.', 404);
    const sub = (await q(`SELECT data FROM club_submissions WHERE gid = $1 AND data->>'fileId' = $2`, [f.gid, f.id])).rows[0];
    const pid = 'u_' + u.id, m = ((await q('SELECT data FROM doc_memberships WHERE id = $1', [f.gid + '__' + pid])).rows[0] || {}).data;
    const td = (await q('SELECT pid FROM club_tax_docs WHERE file_id = $1', [f.id])).rows[0];
    const allowed = d.isAdmin(u) || f.pid === pid || (m && EDIT.includes(m.role)) || (m && m.role !== 'observer' && sub && sub.data.kind === 'document') || (td && td.pid === pid);
    if (!allowed) return bad(res, "You don't have access to this file.", 403);
    res.set('Content-Type', f.mime); res.set('Content-Disposition', 'inline; filename="' + String(f.name || 'file').replace(/[^\w. -]/g, '_') + '"'); res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff'); res.send(f.bytes);
  }));
  /* The Pocket team reviews club documents (Beta admin). */
  app.get('/api/admin/club-docs', wrap(async (req, res) => {
    if (!(await d.needAdmin(req, res))) return;
    const rows = (await q(`SELECT s.id, s.gid, s.pid, s.data, g.data AS g FROM club_submissions s LEFT JOIN doc_groups g ON g.id = s.gid WHERE s.data->>'kind' = 'document' ORDER BY s.created_at DESC LIMIT 200`)).rows;
    ok(res, { docs: rows.map(r => Object.assign({ id: r.id, gid: r.gid, pid: r.pid, groupName: (r.g || {}).name || r.gid }, r.data)) });
  }));
  app.post('/api/admin/club-docs/review', wrap(async (req, res) => {
    const u = await d.needAdmin(req, res); if (!u) return;
    const decision = req.body.decision === 'confirmed' ? 'confirmed' : 'declined', note = String(req.body.note || '').slice(0, 300);
    if (decision === 'declined' && !note) return bad(res, 'Add a note saying what needs to change.');
    const r = await q(`UPDATE club_submissions SET data = data || $2::jsonb WHERE id = $1 AND data->>'kind' = 'document' RETURNING id`, [req.body.id, JSON.stringify({ status: decision, reviewNote: note, reviewerPid: 'pocket', reviewedTs: Date.now() })]);
    if (!r.rows.length) return bad(res, 'Document not found.');
    const row = (await q('SELECT gid, data FROM club_submissions WHERE id = $1', [req.body.id])).rows[0];
    const eds = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [row.gid])).rows.map(x => x.data).filter(m => EDIT.includes(m.role)).map(m => m.pid);
    notify(eds, { title: (await gname(row.gid)) + ': document ' + (decision === 'confirmed' ? 'verified' : 'needs changes'), body: decision === 'confirmed' ? `${row.data.docType} was verified by Pocket.` : `${row.data.docType}: ${note}`, url: '/#/group/' + row.gid + '/club', tag: 'club-' + row.gid });
    ok(res);
  }));
  app.post('/api/club/:gid/setup', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    const dues = req.body.dues == null || req.body.dues === '' ? null : Number(req.body.dues);
    if (dues != null && !(dues >= 0 && dues <= 1000000)) return bad(res, 'Enter monthly dues in dollars, or leave it blank.');
    const cur = await book(A.gid);
    const data = Object.assign({ startUnitValue: 10, createdTs: Date.now() }, cur || {}, { dues });
    await q('INSERT INTO club_books (gid, data) VALUES ($1, $2) ON CONFLICT (gid) DO UPDATE SET data = EXCLUDED.data', [A.gid, JSON.stringify(data)]);
    if (!cur){
      const date = String(req.body.startDate || ''); if (!isDate(date)) return bad(res, 'Pick the date the books start.');
      await q('INSERT INTO club_entries (id, gid, data) VALUES ($1, $2, $3)', [crypto.randomBytes(8).toString('hex'), A.gid, JSON.stringify({ kind: 'valuation', amount: 0, date, note: 'Books started', by: A.pid, ts: Date.now(), order: 0 })]);
    }
    ok(res, await view(A));
  }));
  async function add(A, list){
    const B = await book(A.gid); if (!B) throw Object.assign(new Error('Set up the club books first.'), { userFacing: true });
    const E = await entries(A.gid), pids = await members(A.gid);
    for (const e of list){
      if (!['valuation', 'payment', 'withdrawal'].includes(e.kind)) throw Object.assign(new Error('Unknown entry type.'), { userFacing: true });
      if (!isDate(e.date)) throw Object.assign(new Error('Pick a date.'), { userFacing: true });
      if (monthOf(e.date) <= lockedThrough(B)) throw Object.assign(new Error(`${monthOf(e.date)} is closed. Record it in the current month with a note instead.`), { userFacing: true });
      if (!(e.amount >= 0) || e.amount > 1e9 || (e.kind !== 'valuation' && !(e.amount > 0))) throw Object.assign(new Error('Enter an amount in dollars.'), { userFacing: true });
      if (e.kind !== 'valuation' && !pids.includes(e.pid)) throw Object.assign(new Error('Pick a member of the group.'), { userFacing: true });
      if (e.kind !== 'valuation' && !E.concat(list).some(x => x.kind === 'valuation' && x.date <= e.date)) throw Object.assign(new Error('Record a valuation on or before this date first, so the unit value is known.'), { userFacing: true });
    }
    const S = summary(E.concat(list.map((e, i) => Object.assign({ id: 'new' + i }, e))), B.startUnitValue, pids);
    if (S.problem) throw Object.assign(new Error(S.problem.kind === 'nounits' ? "Record members' payments (or opening balances) before a valuation above $0." : 'That withdrawal is more than the member owns on that date.'), { userFacing: true });
    for (const e of list) await q('INSERT INTO club_entries (id, gid, data) VALUES ($1, $2, $3)', [crypto.randomBytes(8).toString('hex'), A.gid, JSON.stringify(e)]);
    if (list.length > 1) await log(A.gid, A.pid, `Recorded ${list.length} payments of $${list[0].amount.toFixed(2)} (${list[0].note || 'dues'}) dated ${list[0].date}`);
    else for (const e of list) await log(A.gid, A.pid, `Recorded ${e.kind} of $${e.amount.toFixed(2)} dated ${e.date}${e.note ? ' · ' + e.note : ''}`);
  }
  app.post('/api/club/:gid/entry', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    if (await pooled(A.gid)) return bad(res, "A pooled club's books update automatically from its account.");
    const kind = String(req.body.kind || ''), amount = r2(Number(req.body.amount));
    await add(A, [{ kind, amount, date: String(req.body.date || ''), pid: kind === 'valuation' ? null : String(req.body.pid || ''), note: String(req.body.note || '').slice(0, 200), by: A.pid, ts: Date.now(), order: kind === 'valuation' ? 0 : 1 }]);
    ok(res, await view(A));
  }));
  app.post('/api/club/:gid/dues', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    if (await pooled(A.gid)) return bad(res, "A pooled club's books update automatically from its account.");
    const amount = r2(Number(req.body.amount)), date = String(req.body.date || ''), pids = await members(A.gid);
    await add(A, pids.map(pid => ({ kind: 'payment', amount, date, pid, note: 'Monthly dues', by: A.pid, ts: Date.now(), order: 1 })));
    ok(res, await view(A));
  }));
  app.post('/api/club/:gid/void', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    if (await pooled(A.gid)) return bad(res, "A pooled club's books update automatically from its account.");
    const reason = String(req.body.reason || '').trim().slice(0, 200); if (!reason) return bad(res, 'Say why this entry is being voided.');
    const B = await book(A.gid), E = await entries(A.gid), e = E.find(x => x.id === req.body.id);
    if (!e || e.voided) return bad(res, 'Entry not found.');
    if (e.note === 'Books started') return bad(res, "The starting entry can't be voided.");
    if (monthOf(e.date) <= lockedThrough(B)) return bad(res, `${monthOf(e.date)} is closed. Record a correcting entry in the current month instead.`);
    if (summary(E.filter(x => x.id !== e.id), B.startUnitValue, await members(A.gid)).problem) return bad(res, "Voiding that would leave a later withdrawal larger than the member's share. Void the withdrawal first.");
    await q('UPDATE club_entries SET data = data || $2::jsonb WHERE id = $1 AND gid = $3', [e.id, JSON.stringify({ voided: { by: A.pid, ts: Date.now(), reason } }), A.gid]);
    await log(A.gid, A.pid, `Voided ${e.kind} of $${Number(e.amount).toFixed(2)} dated ${e.date}: ${reason}`);
    ok(res, await view(A));
  }));
  /* Monthly close: one officer closes a month after checking the books; a different person signs off, which locks it. */
  app.post('/api/club/:gid/close', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    const month = String(req.body.month || ''), cur = new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month) || month >= cur) return bad(res, 'Only a past month can be closed.');
    const B = await book(A.gid); const closes = B.closes || [];
    if (closes.some(c => c.month === month)) return bad(res, month + ' is already closed.');
    if (month <= lockedThrough(B)) return bad(res, 'A later month is already locked.');
    B.closes = closes.concat([{ month, preparedBy: A.pid, preparedTs: Date.now(), note: String(req.body.note || '').slice(0, 300) }]);
    await q('UPDATE club_books SET data = $2 WHERE gid = $1', [A.gid, JSON.stringify(B)]); await log(A.gid, A.pid, `Closed ${month}; waiting for a second sign-off`);
    notify(await eligible(A.gid, [A.pid]), { title: (await gname(A.gid)) + ': month to sign off', body: `${month} was closed and needs a second sign-off to lock it.`, url: '/#/group/' + A.gid + '/club', tag: 'club-' + A.gid });
    ok(res, await view(A));
  }));
  app.post('/api/club/:gid/signoff', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    const B = await book(A.gid), c = (B.closes || []).find(x => x.month === req.body.month);
    if (!c || c.signedBy) return bad(res, 'Nothing to sign off for that month.');
    if (!A.twoStep) return bad(res, 'Club money actions need two-step sign-in. Turn it on in your Profile, then try again.', 403);
    if (!(await canApprove(A.gid, A.pid, [c.preparedBy]))) return bad(res, "Someone other than the person who closed the month signs off: an officer with a money role, or any member if no officer is available.");
    c.signedBy = A.pid; c.signedTs = Date.now(); await q('UPDATE club_books SET data = $2 WHERE gid = $1', [A.gid, JSON.stringify(B)]);
    await log(A.gid, A.pid, `Signed off ${c.month}; the month is now locked`); ok(res, await view(A));
  }));
  /* Annual review by a member who isn't an officer with a money role. */
  app.post('/api/club/:gid/review-year', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    if (EDIT.includes(A.role)) return bad(res, "The annual review is done by a member who isn't an officer with a money role.");
    const year = String(req.body.year || ''); if (!/^\d{4}$/.test(year)) return bad(res, 'Pick a year.');
    const B = await book(A.gid); B.yearReviews = Object.assign({}, B.yearReviews, { [year]: { pid: A.pid, ts: Date.now(), note: String(req.body.note || '').slice(0, 500) } });
    await q('UPDATE club_books SET data = $2 WHERE gid = $1', [A.gid, JSON.stringify(B)]); await log(A.gid, A.pid, `Reviewed the ${year} books`); ok(res, await view(A));
  }));
  /* Tax documents: the Treasurer, Owner or an Admin uploads each member's K-1 (seen only by that member and officers) and the club's own forms. */
  app.post('/api/club/:gid/taxdoc', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    const year = Number(req.body.year), kind = ['k1', 'club-1099', 'other'].includes(req.body.kind) ? req.body.kind : null, f = req.body.file || {};
    if (!(year >= 2000 && year <= 2100) || !kind) return bad(res, 'Pick the tax year and document type.');
    const target = kind === 'k1' ? String(req.body.pid || '') : null;
    if (kind === 'k1' && !(await q(`SELECT 1 FROM club_entries WHERE gid = $1 AND data->>'pid' = $2 LIMIT 1`, [A.gid, target])).rows.length && !(await members(A.gid)).includes(target)) return bad(res, 'Pick a member of the club.');
    if (f.type !== 'application/pdf') return bad(res, 'Upload the document as a PDF.');
    const buf = Buffer.from(String(f.data || ''), 'base64'); if (!buf.length || buf.length > 5 * 1024 * 1024 || buf[0] !== 0x25 || buf[1] !== 0x50) return bad(res, "That file doesn't look like a PDF (up to 5 MB).");
    const fid = crypto.randomBytes(10).toString('hex');
    await q('INSERT INTO club_files (id, gid, pid, name, mime, size, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)', [fid, A.gid, A.pid, String(f.name || 'document.pdf').slice(0, 120), 'application/pdf', buf.length, buf]);
    await q('INSERT INTO club_tax_docs (id, gid, pid, year, kind, file_id, name, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [crypto.randomBytes(8).toString('hex'), A.gid, target, year, kind, fid, String(f.name || 'document.pdf').slice(0, 120), A.pid]);
    await log(A.gid, A.pid, kind === 'k1' ? `Posted a ${year} K-1 for a member` : `Posted the club's ${year} ${kind === 'club-1099' ? '1099' : 'tax document'}`);
    if (kind === 'k1') notify([target], { title: (await gname(A.gid)) + ': your ' + year + ' K-1 is ready', body: 'Download it under Statements, Tax documents.', url: '/#/statements', tag: 'tax' });
    ok(res);
  }));
  app.get('/api/tax-docs', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return; const pid = 'u_' + u.id;
    const mine = (await q(`SELECT data FROM doc_memberships WHERE data->>'pid' = $1`, [pid])).rows.map(r => r.data), officerOf = new Set(mine.filter(m => EDIT.includes(m.role)).map(m => m.gid));
    const rows = (await q(`SELECT id, gid, pid, year, kind, file_id, name, created_at FROM club_tax_docs WHERE pid = $1 OR gid = ANY($2) ORDER BY year DESC, created_at DESC`, [pid, [...officerOf]])).rows;
    const out = []; for (const r of rows) out.push({ id: r.id, gid: r.gid, club: await gname(r.gid), pid: r.pid, year: r.year, kind: r.kind, name: r.name, url: `/api/club/${r.gid}/file/${r.file_id}`, mine: r.pid === pid });
    ok(res, { docs: out });
  }));
  app.get('/api/club-waiting', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return; const pid = 'u_' + u.id;
    const mine = (await q(`SELECT data FROM doc_memberships WHERE data->>'pid' = $1`, [pid])).rows.map(r => r.data).filter(m => m.role !== 'observer');
    const out = [];
    for (const m of mine){
      let n = 0;
      for (const r of (await q(`SELECT pid, data FROM club_submissions WHERE gid = $1 AND data->>'status' = 'pending' AND data->>'kind' <> 'document'`, [m.gid])).rows){
        const base = (r.data.kind === 'distribution' ? [] : [r.pid]).concat(r.data.initiatedBy ? [r.data.initiatedBy] : []).concat((r.data.approvals || []).map(x => x.pid));
        if (await canApprove(m.gid, pid, base)) n++;
      }
      const B = await book(m.gid); for (const c of (B && B.closes) || []) if (!c.signedBy && await canApprove(m.gid, pid, [c.preparedBy])) n++;
      if (n) out.push({ gid: m.gid, name: await gname(m.gid), count: n });
    }
    ok(res, { waiting: out });
  }));
  /* Early each month, remind the people who keep the books when last month isn't closed yet. */
  setInterval(async () => { try {
    const now = new Date();
    if (now.getUTCMonth() === 0 && now.getUTCDate() >= 3){ const ty = now.getUTCFullYear() - 1;
      for (const r of (await q('SELECT gid, data FROM club_books')).rows){ const B = r.data; if (B.taxReminded === ty) continue;
        const eds = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [r.gid])).rows.map(x => x.data).filter(m => EDIT.includes(m.role)).map(m => m.pid);
        notify(eds, { title: (await gname(r.gid)) + ': ' + ty + ' tax packet ready', body: "Close December, then download the tax packet for your club's preparer from the Club books tab.", url: '/#/group/' + r.gid + '/club', tag: 'club-' + r.gid });
        B.taxReminded = ty; await q('UPDATE club_books SET data = $2 WHERE gid = $1', [r.gid, JSON.stringify(B)]); } }
    if (now.getUTCDate() < 3 || now.getUTCDate() > 10) return;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
    for (const r of (await q('SELECT gid, data FROM club_books')).rows){
      const B = r.data; if (B.remindedFor === prev || (B.closes || []).some(c => c.month === prev)) continue;
      const started = ((await q(`SELECT min(data->>'date') AS d FROM club_entries WHERE gid = $1`, [r.gid])).rows[0] || {}).d; if (!started || started.slice(0, 7) > prev) continue;
      const eds = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [r.gid])).rows.map(x => x.data).filter(m => EDIT.includes(m.role)).map(m => m.pid);
      notify(eds, { title: (await gname(r.gid)) + ': time to close ' + prev, body: 'Check the books against the account, then close the month for a second sign-off.', url: '/#/group/' + r.gid + '/club', tag: 'club-' + r.gid });
      B.remindedFor = prev; await q('UPDATE club_books SET data = $2 WHERE gid = $1', [r.gid, JSON.stringify(B)]);
    }
  } catch (e){ console.error('club reminders', e.message); } }, 6 * 3600000);
  /* Year-end figures for the club's tax preparer: each member's capital account and, for pooled clubs,
     their share of dividends and realized gains, allocated by the units they held when each was earned. */
  app.get('/api/club/:gid/tax.csv', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    const year = String(req.query.year || new Date().getUTCFullYear()); if (!/^\d{4}$/.test(year)) return bad(res, 'Pick a year.');
    const F = await full(A.gid); if (!F.book) return bad(res, 'No club books yet.');
    const E = (await entries(A.gid)).filter(e => !e.voided), pids = F.members.map(m => m.pid), isPooled = await pooled(A.gid);
    const unitsAt = ts => { const R = replay(E.filter(e => e.date <= new Date(ts).toISOString().slice(0, 10)), F.book.startUnitValue); return R; };
    const alloc = {}; pids.forEach(p => { alloc[p] = { div: 0, st: 0, lt: 0 }; });
    const share = (ts, amt, key) => { const R = unitsAt(ts); if (!(R.units > 1e-9)) return; for (const [p, m] of Object.entries(R.members)){ if (!alloc[p]) alloc[p] = { div: 0, st: 0, lt: 0 }; alloc[p][key] += amt * m.units / R.units; } };
    let clubDiv = 0, clubST = 0, clubLT = 0;
    if (isPooled){
      const pp = 'club_' + A.gid, y0 = Date.parse(year + '-01-01T00:00:00Z'), y1 = Date.parse((+year + 1) + '-01-01T00:00:00Z');
      for (const r of (await q(`SELECT data FROM doc_dividends WHERE data->>'pid' = $1`, [pp])).rows){ const x = r.data; if (x.ts >= y0 && x.ts < y1){ clubDiv += x.amount; share(x.ts, x.amount, 'div'); } }
      const trades = (await q(`SELECT data FROM doc_trades WHERE data->>'pid' = $1 ORDER BY (data->>'ts')::bigint`, [pp])).rows.map(r => r.data), lots = {};
      for (const t of trades){
        if (t.side === 'buy'){ (lots[t.sym] = lots[t.sym] || []).push({ sh: t.shares, px: t.price, ts: t.ts }); continue; }
        let left = t.shares; const L = lots[t.sym] || [];
        while (left > 1e-6 && L.length){ const lot = L[0], use = Math.min(lot.sh, left), gain = use * (t.price - lot.px), lt = t.ts - lot.ts > 365 * 86400000;
          if (t.ts >= y0 && t.ts < y1){ if (lt){ clubLT += gain; share(t.ts, gain, 'lt'); } else { clubST += gain; share(t.ts, gain, 'st'); } }
          lot.sh -= use; left -= use; if (lot.sh < 1e-6) L.shift(); }
      }
    }
    const yr = F.years[year] || [], names = {}; (await q('SELECT id, data FROM doc_profiles WHERE id = ANY($1)', [Object.keys(alloc).concat(pids)])).rows.forEach(r => { names[r.id] = r.data.name || r.id; });
    const endR = replay(E.filter(e => e.date <= year + '-12-31'), F.book.startUnitValue);
    const c2 = v => v == null ? '' : (Math.round(v * 100) / 100).toFixed(2), cell = v => typeof v === 'number' ? c2(v) : '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [...new Set(yr.map(x => x.pid).concat(Object.keys(alloc).filter(p => alloc[p].div || alloc[p].st || alloc[p].lt)))].map(p => {
      const y = yr.find(x => x.pid === p) || { startValue: 0, paid: 0, withdrawn: 0, endValue: 0, gain: 0 }, a = alloc[p] || { div: 0, st: 0, lt: 0 }, em = endR.members[p];
      return [names[p] || p, em && endR.units > 1e-9 ? (em.units / endR.units * 100).toFixed(2) + '%' : '0.00%', y.startValue, y.paid, y.withdrawn, isPooled ? a.div : '', isPooled ? a.st : '', isPooled ? a.lt : '', isPooled ? y.gain - a.div - a.st - a.lt : y.gain, y.endValue].map(cell).join(',');
    });
    const head = [`"Year-end figures for ${String(await gname(A.gid)).replace(/"/g, '')}, ${year}"`, '"For the club\'s tax preparer. This is not a tax form; allocations follow units held when each item was earned."',
      isPooled ? `"Club totals: dividends ${c2(clubDiv)}, short-term gains ${c2(clubST)}, long-term gains ${c2(clubLT)}"` : '"Income detail comes from the club\'s brokerage 1099; this file covers each member\'s capital account."', '',
      'Member,Ownership at year end,Beginning capital,Contributions,Withdrawals,Dividends (share),Short-term gains (share),Long-term gains (share),Other change in value,Ending capital'];
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="club-year-end-${year}.csv"`); res.send(head.concat(rows).join('\n') + '\n');
  }));
  app.get('/api/club/:gid/csv', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    const F = await full(A.gid); if (!F.book) return bad(res, 'No club books yet.');
    const names = {}; (await q(`SELECT id, data FROM doc_profiles WHERE id = ANY($1)`, [F.members.map(m => m.pid)])).rows.forEach(r => { names[r.id] = r.data.name || r.id; });
    const cell = v => typeof v === 'number' ? v.toFixed(Math.abs(v) < 1 && v !== 0 ? 4 : 2) : '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = ['Member statement', 'Member,Units,Value,Share of club,Paid in,Withdrawn,Gain'].concat(F.members.map(m => [names[m.pid] || m.pid, m.units, m.value, m.share, m.paid, m.withdrawn, m.gain].map(cell).join(',')),
      ['', 'Ledger', 'Date,Type,Member,Amount,Unit value,Units,Club value after,Note'], F.entries.map(e => [e.date, e.kind, e.pid ? names[e.pid] || e.pid : '', e.amount, e.unitValue, e.units == null ? '' : e.units, e.clubValue, e.note || ''].map(cell).join(',')));
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="club-books.csv"'); res.send(lines.join('\n') + '\n');
  }));
}
module.exports = { mount, replay, summary };
