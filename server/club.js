/* Club books: investment club accounting with the unit value system. Kept in its own table and
   served only to the group's full members, never in the public data snapshot. Treasurers,
   Owners and Admins can edit; every member can read. */
const crypto = require('crypto');
const EDIT = ['owner', 'admin', 'treasurer'];
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
function summary(entries, startUV, pids){
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
  return { entries: R.entries, units: R.units, unitValue: R.unitValue, value: R.value, members: rows, years, problem: R.problem };
}
function mount(app, d){
  const { q, wrap, ok, bad, needUser } = d;
  (async () => {
    await q(`CREATE TABLE IF NOT EXISTS club_books (gid text PRIMARY KEY, data jsonb NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS club_entries (id text PRIMARY KEY, gid text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS club_entries_gid ON club_entries (gid)`);
    await q(`CREATE TABLE IF NOT EXISTS club_submissions (id text PRIMARY KEY, gid text NOT NULL, pid text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS club_submissions_gid ON club_submissions (gid)`);
    await q(`CREATE TABLE IF NOT EXISTS club_files (id text PRIMARY KEY, gid text NOT NULL, pid text NOT NULL, name text, mime text NOT NULL, size int NOT NULL, bytes bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  })().catch(e => console.error('club tables', e.message));
  async function access(req, res, needEdit){
    const u = await needUser(req, res); if (!u) return null;
    const gid = String(req.params.gid || ''), pid = 'u_' + u.id;
    const m = ((await q('SELECT data FROM doc_memberships WHERE id = $1', [gid + '__' + pid])).rows[0] || {}).data;
    if (!m || m.role === 'observer'){ bad(res, 'Club books are for full members of this group.', 403); return null; }
    if (needEdit && !EDIT.includes(m.role)){ bad(res, 'Only the Treasurer, Owner or Admins can change the club books.', 403); return null; }
    return { gid, pid, role: m.role, canEdit: EDIT.includes(m.role) };
  }
  const book = async gid => ((await q('SELECT data FROM club_books WHERE gid = $1', [gid])).rows[0] || {}).data || null;
  const entries = async gid => (await q('SELECT id, data FROM club_entries WHERE gid = $1', [gid])).rows.map(r => Object.assign({ id: r.id }, r.data));
  const members = async gid => (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [gid])).rows.map(r => r.data).filter(m => m.role !== 'observer').map(m => m.pid);
  async function full(gid){ const B = await book(gid); if (!B) return { book: null }; const E = await entries(gid); return Object.assign({ book: B }, summary(E, B.startUnitValue, await members(gid))); }
  /* Requests and uploads: members see their own; editors see all payment proofs and withdrawals;
     club documents (for the Pocket team's review) are visible to every full member. */
  async function submissions(A){
    const rows = (await q('SELECT id, pid, data, created_at FROM club_submissions WHERE gid = $1 ORDER BY created_at DESC LIMIT 200', [A.gid])).rows.map(r => Object.assign({ id: r.id, pid: r.pid }, r.data));
    return rows.filter(x => x.kind === 'document' || A.canEdit || x.pid === A.pid);
  }
  const pooled = async gid => !!((((await q('SELECT data FROM doc_groups WHERE id = $1', [gid])).rows[0]) || {}).data || {}).pooled;
  async function view(A){ return Object.assign({ canEdit: A.canEdit, pooled: await pooled(A.gid), submissions: await submissions(A) }, await full(A.gid)); }
  app.get('/api/club/:gid', wrap(async (req, res) => { const A = await access(req, res); if (!A) return; ok(res, await view(A)); }));
  const TYPES = { 'image/jpeg': [0xff, 0xd8], 'image/png': [0x89, 0x50], 'image/webp': [0x52, 0x49], 'application/pdf': [0x25, 0x50] };
  const DOCS = ['Articles of organization (LLC)', 'Partnership agreement', 'Tax ID (EIN) letter', 'Operating agreement', 'Bank or brokerage statement', 'Other'];
  app.post('/api/club/:gid/submit', wrap(async (req, res) => {
    const A = await access(req, res); if (!A) return;
    const kind = String(req.body.kind || ''), f = req.body.file || {};
    if (!['payment', 'document'].includes(kind)) return bad(res, 'Unknown request type.');
    if (kind === 'document' && !A.canEdit) return bad(res, 'Only the Treasurer, Owner or Admins can send club documents.', 403);
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
    ok(res, await view(A));
  }));
  /* The club's Treasurer, Owner or Admins confirm or decline payment proofs; confirming records the payment. */
  app.post('/api/club/:gid/review', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    const row = (await q('SELECT id, pid, data FROM club_submissions WHERE id = $1 AND gid = $2', [req.body.id, A.gid])).rows[0];
    if (!row || row.data.kind !== 'payment') return bad(res, 'Request not found.');
    if (row.data.status !== 'pending') return bad(res, 'This was already decided.');
    const decision = req.body.decision === 'confirmed' ? 'confirmed' : 'declined', note = String(req.body.note || '').slice(0, 300);
    if (decision === 'declined' && !note) return bad(res, 'Add a short note so the member knows why.');
    if (decision === 'confirmed') await add(A, [{ kind: 'payment', amount: row.data.amount, date: row.data.date, pid: row.pid, note: 'Proof confirmed' + (row.data.note ? ': ' + row.data.note.slice(0, 80) : ''), by: A.pid, ts: Date.now(), order: 1 }]);
    await q('UPDATE club_submissions SET data = data || $2::jsonb WHERE id = $1', [row.id, JSON.stringify({ status: decision, reviewNote: note, reviewerPid: A.pid, reviewedTs: Date.now() })]);
    ok(res, await view(A));
  }));
  app.get('/api/club/:gid/file/:fid', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const f = (await q('SELECT id, gid, pid, name, mime, bytes FROM club_files WHERE id = $1 AND gid = $2', [req.params.fid, req.params.gid])).rows[0]; if (!f) return bad(res, 'File not found.', 404);
    const sub = (await q(`SELECT data FROM club_submissions WHERE gid = $1 AND data->>'fileId' = $2`, [f.gid, f.id])).rows[0];
    const pid = 'u_' + u.id, m = ((await q('SELECT data FROM doc_memberships WHERE id = $1', [f.gid + '__' + pid])).rows[0] || {}).data;
    const allowed = d.isAdmin(u) || f.pid === pid || (m && EDIT.includes(m.role)) || (m && m.role !== 'observer' && sub && sub.data.kind === 'document');
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
    if (!r.rows.length) return bad(res, 'Document not found.'); ok(res);
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
      if (!(e.amount >= 0) || e.amount > 1e9 || (e.kind !== 'valuation' && !(e.amount > 0))) throw Object.assign(new Error('Enter an amount in dollars.'), { userFacing: true });
      if (e.kind !== 'valuation' && !pids.includes(e.pid)) throw Object.assign(new Error('Pick a member of the group.'), { userFacing: true });
      if (e.kind !== 'valuation' && !E.concat(list).some(x => x.kind === 'valuation' && x.date <= e.date)) throw Object.assign(new Error('Record a valuation on or before this date first, so the unit value is known.'), { userFacing: true });
    }
    const S = summary(E.concat(list.map((e, i) => Object.assign({ id: 'new' + i }, e))), B.startUnitValue, pids);
    if (S.problem) throw Object.assign(new Error(S.problem.kind === 'nounits' ? "Record members' payments (or opening balances) before a valuation above $0." : 'That withdrawal is more than the member owns on that date.'), { userFacing: true });
    for (const e of list) await q('INSERT INTO club_entries (id, gid, data) VALUES ($1, $2, $3)', [crypto.randomBytes(8).toString('hex'), A.gid, JSON.stringify(e)]);
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
  app.post('/api/club/:gid/delete', wrap(async (req, res) => {
    const A = await access(req, res, true); if (!A) return;
    if (await pooled(A.gid)) return bad(res, "A pooled club's books update automatically from its account.");
    const B = await book(A.gid), E = await entries(A.gid), rest = E.filter(e => e.id !== req.body.id);
    if (rest.length === E.length) return bad(res, 'Entry not found.');
    if (summary(rest, B.startUnitValue, await members(A.gid)).problem) return bad(res, "Deleting that would leave a later withdrawal larger than the member's share. Delete the withdrawal first.");
    await q('DELETE FROM club_entries WHERE id = $1 AND gid = $2', [req.body.id, A.gid]); ok(res, await view(A));
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
