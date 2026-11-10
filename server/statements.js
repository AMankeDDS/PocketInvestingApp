/* Statements: personal practice accounts, a member's stake in a club, and a club's own account.
   Values are rebuilt from the actual trade, dividend and ledger history, so a statement for any past
   date shows what was true then. Money moved into or out of an account is a transfer, not a gain:
   period returns use the Modified Dietz method. Statements can be viewed, or downloaded as PDF or CSV. */
const Market = require('./market');
const { replay } = require('./club');
const Acc = require('./accounts');
const DAY = 86400000;
const EDIT = ['owner', 'admin', 'treasurer', 'asstTreasurer'];
let q = null;
const r2 = n => Math.round((n || 0) * 100) / 100;
const dayEnd = s => Date.parse(s + 'T23:59:59Z'), dayStart = s => Date.parse(s + 'T00:00:00Z'), iso = t => new Date(t).toISOString().slice(0, 10);
const pooledSet = async () => new Set((await q(`SELECT id FROM doc_groups WHERE (data->>'pooled')::boolean`)).rows.map(r => r.id));
const gname = async gid => ((((await q('SELECT data FROM doc_groups WHERE id = $1', [gid])).rows[0]) || {}).data || {}).name || 'Club';
const pname = async pid => ((((await q('SELECT data FROM doc_profiles WHERE id = $1', [pid])).rows[0]) || {}).data || {}).name || pid;

/* Every cash and share movement for an account, oldest first. flow: +in / -out of the account. */
async function events(pid){
  const ev = [];
  (await q(`SELECT data FROM doc_trades WHERE data->>'pid' = $1`, [pid])).rows.forEach(({ data: t }) => ev.push({ ts: t.ts, type: 'trade', side: t.side, sym: t.sym, shares: t.shares, price: t.price, copyOf: t.copyOf, groupId: t.groupId }));
  (await q(`SELECT data FROM doc_dividends WHERE data->>'pid' = $1`, [pid]).catch(() => ({ rows: [] }))).rows.forEach(({ data: x }) => ev.push({ ts: x.ts, type: 'dividend', sym: x.sym, amount: x.amount, shares: x.shares }));
  const pooled = await pooledSet();
  if (pid.startsWith('club_')){
    const gid = pid.slice(5);
    (await q(`SELECT data FROM club_entries WHERE gid = $1`, [gid])).rows.map(r => r.data).filter(e => !e.voided && e.kind !== 'valuation' && e.pid).forEach(e => ev.push({ ts: e.ts, type: 'flow', flow: e.kind === 'payment' ? e.amount : -e.amount, desc: e.kind === 'payment' ? 'Member contribution' : 'Paid to member', who: e.pid }));
  } else {
    (await q(`SELECT gid, data FROM club_entries WHERE data->>'pid' = $1`, [pid])).rows.filter(r => pooled.has(r.gid) && !r.data.voided && r.data.kind !== 'valuation').forEach(r => ev.push({ ts: r.data.ts, type: 'flow', flow: r.data.kind === 'payment' ? -r.data.amount : r.data.amount, gid: r.gid, desc: r.data.kind === 'payment' ? 'Moved to a pooled club' : 'Paid out from a pooled club' }));
  }
  return ev.sort((a, b) => a.ts - b.ts);
}
/* Holdings and cash at time T, walking back from today's actual account. */
function stateAt(cur, ev, T){
  let cash = cur.cash || 0; const pos = {}; Object.entries(cur.positions || {}).forEach(([s, p]) => { pos[s] = p.shares; });
  for (let i = ev.length - 1; i >= 0 && ev[i].ts > T; i--){ const e = ev[i];
    if (e.type === 'trade'){ const a = e.shares * e.price; if (e.side === 'buy'){ cash += a; pos[e.sym] = (pos[e.sym] || 0) - e.shares; } else { cash -= a; pos[e.sym] = (pos[e.sym] || 0) + e.shares; } }
    else if (e.type === 'dividend') cash -= e.amount; else if (e.type === 'flow') cash -= e.flow; }
  Object.keys(pos).forEach(s => { if (Math.abs(pos[s]) < 1e-4) delete pos[s]; });
  return { cash, pos };
}
const px = (s, T) => T >= Date.now() - 60000 ? Market.price(s) : Market.price(s, T);
const valueOf = (st, T) => st.cash + Object.entries(st.pos).reduce((a, [s, sh]) => a + Math.max(0, sh) * px(s, T), 0);
/* Cost basis and realized gains by first-in, first-out lots. */
function lotsAt(ev, T, from){
  const lots = {}; let realized = 0;
  ev.filter(e => e.type === 'trade' && e.ts <= T).forEach(e => {
    if (e.side === 'buy'){ (lots[e.sym] = lots[e.sym] || []).push({ sh: e.shares, px: e.price }); return; }
    let left = e.shares; const L = lots[e.sym] || [];
    while (left > 1e-6 && L.length){ const lot = L[0], use = Math.min(lot.sh, left); if (from != null && e.ts > from) realized += use * (e.price - lot.px); lot.sh -= use; left -= use; if (lot.sh < 1e-6) L.shift(); }
  });
  const cost = {}; Object.entries(lots).forEach(([s, L]) => { cost[s] = L.reduce((a, l) => a + l.sh * l.px, 0); });
  return { cost, realized };
}
function dietz(begin, end, flows, from, to){
  const net = flows.reduce((a, f) => a + f.amount, 0), span = Math.max(1, to - from);
  const w = flows.reduce((a, f) => a + f.amount * (to - f.ts) / span, 0), base = begin + w;
  return base > 0.005 ? (end - begin - net) / base : null;
}
/* Personal or club account statement (anything with its own portfolio). */
async function accountStatement(pid, from, to, meta){
  const pf = ((await q('SELECT data FROM doc_portfolios WHERE id = $1', [pid])).rows[0] || {}).data; if (!pf) throw Object.assign(new Error('Account not found.'), { userFacing: true });
  const ev = await events(pid), F = dayStart(from), T = Math.min(dayEnd(to), Date.now()), asOf = from === to;
  const sF = stateAt(pf, ev, F), sT = stateAt(pf, ev, T), begin = valueOf(sF, F), end = valueOf(sT, T);
  const inP = ev.filter(e => e.ts > F && e.ts <= T), flows = inP.filter(e => e.type === 'flow').map(e => ({ ts: e.ts, amount: e.flow }));
  const divs = inP.filter(e => e.type === 'dividend').reduce((a, e) => a + e.amount, 0), L = lotsAt(ev, T, F);
  const holdings = Object.entries(sT.pos).filter(([, sh]) => sh > 1e-4).map(([s, sh]) => { const p = px(s, T), v = sh * p, c = L.cost[s] || 0; return [s, sh, p, v, c, v - c]; }).sort((a, b) => b[3] - a[3]);
  const ret = dietz(begin, end, flows, F, T), deposits = flows.filter(f => f.amount > 0).reduce((a, f) => a + f.amount, 0), withdrawals = -flows.filter(f => f.amount < 0).reduce((a, f) => a + f.amount, 0);
  const summary = asOf ? [['Account value', end, '$'], ['Cash', sT.cash, '$'], ['Invested', end - sT.cash, '$'], ['Unrealized gain or loss', holdings.reduce((a, h) => a + h[5], 0), '$']]
    : [['Beginning value', begin, '$'], [meta.inLabel || 'Money in', deposits, '$'], [meta.outLabel || 'Money out', -withdrawals, '$'], ['Dividends', divs, '$'], ['Realized gains or losses', L.realized, '$'],
       ['Change in market value', end - begin - deposits + withdrawals - divs, '$'], ['Ending value', end, '$'], ['Return for the period', ret, '%']];
  const activity = inP.map(e => e.type === 'trade' ? [iso(e.ts), e.side === 'buy' ? 'Bought' : 'Sold', e.sym, e.shares, e.price, (e.side === 'buy' ? -1 : 1) * e.shares * e.price, e.copyOf ? (String(e.copyOf).startsWith('portfolio:') ? 'Copied portfolio' : 'Copied trade') : e.groupId ? 'Group trade' : '']
    : e.type === 'dividend' ? [iso(e.ts), 'Dividend', e.sym, e.shares, null, e.amount, 'Practice estimate'] : [iso(e.ts), e.flow > 0 ? 'Transfer in' : 'Transfer out', '', null, null, e.flow, e.desc]);
  const tables = [{ title: asOf ? 'Holdings on ' + to : 'Holdings at period end', columns: ['Stock', 'Shares', 'Price', 'Value', 'Cost', 'Gain or loss'], types: ['s', 'n3', '$', '$', '$', '$'], rows: holdings }];
  if (!asOf) tables.push({ title: 'Activity', columns: ['Date', 'Type', 'Stock', 'Shares', 'Price', 'Amount', 'Note'], types: ['s', 's', 's', 'n3', '$', '$', 's'], rows: activity });
  return { summary, tables, begin, end, ret };
}
/* A member's stake in a club, from the club ledger (and the club account, for pooled clubs). */
async function memberStatement(gid, pid, from, to){
  const pooled = (await pooledSet()).has(gid), B = ((await q('SELECT data FROM club_books WHERE gid = $1', [gid])).rows[0] || {}).data; if (!B) throw Object.assign(new Error('This club has no books yet.'), { userFacing: true });
  const E = (await q('SELECT id, data FROM club_entries WHERE gid = $1', [gid])).rows.map(r => Object.assign({ id: r.id }, r.data)).filter(e => !e.voided);
  const F = dayStart(from), T = Math.min(dayEnd(to), Date.now()), asOf = from === to;
  const upTo = t => E.filter(e => (e.ts && pooled ? e.ts <= t : e.date <= iso(t)));
  let pf = null, pev = null; if (pooled){ pf = ((await q('SELECT data FROM doc_portfolios WHERE id = $1', ['club_' + gid])).rows[0] || {}).data; pev = await events('club_' + gid); }
  const at = t => { const R = replay(upTo(t), B.startUnitValue), m = R.members[pid] || { units: 0, paid: 0, withdrawn: 0 };
    const clubV = pooled ? valueOf(stateAt(pf, pev, t), t) : R.value, uv = R.units > 1e-9 ? clubV / R.units : B.startUnitValue; return { units: m.units, uv, value: m.units * uv, share: R.units > 1e-9 ? m.units / R.units : 0, paid: m.paid, withdrawn: m.withdrawn, R }; };
  const a = at(F), b = at(T);
  const mine = E.filter(e => e.pid === pid && (pooled ? e.ts > F && e.ts <= T : e.date > iso(F) && e.date <= iso(T)));
  const flows = mine.map(e => ({ ts: e.ts || dayEnd(e.date), amount: e.kind === 'payment' ? e.amount : -e.amount }));
  let div = 0, gains = 0;
  if (pooled){ const inP = pev.filter(e => e.ts > F && e.ts <= T), L = [];
    const lotsAll = {}; pev.filter(e => e.type === 'trade' && e.ts <= T).forEach(e => { if (e.side === 'buy'){ (lotsAll[e.sym] = lotsAll[e.sym] || []).push({ sh: e.shares, px: e.price }); return; } let left = e.shares; const LL = lotsAll[e.sym] || []; while (left > 1e-6 && LL.length){ const lot = LL[0], use = Math.min(lot.sh, left); if (e.ts > F) L.push({ ts: e.ts, g: use * (e.price - lot.px) }); lot.sh -= use; left -= use; if (lot.sh < 1e-6) LL.shift(); } });
    const shareAt = t => { const x = at(t); return x.R.units > 1e-9 ? (x.R.members[pid] || { units: 0 }).units / x.R.units : 0; };
    inP.filter(e => e.type === 'dividend').forEach(e => { div += e.amount * shareAt(e.ts); }); L.forEach(x => { gains += x.g * shareAt(x.ts); }); }
  const net = flows.reduce((s, f) => s + f.amount, 0), ret = dietz(a.value, b.value, flows, F, T);
  const summary = asOf ? [['Units', b.units, 'n3'], ['Unit value', b.uv, '$'], ['Value of your stake', b.value, '$'], ['Your share of the club', b.share, '%'], ['Paid in to date', b.paid, '$'], ['Withdrawn to date', b.withdrawn, '$']]
    : [['Beginning value', a.value, '$'], ['Units at start', a.units, 'n3'], ['Contributions', flows.filter(f => f.amount > 0).reduce((s, f) => s + f.amount, 0), '$'], ['Withdrawals', flows.filter(f => f.amount < 0).reduce((s, f) => s + f.amount, 0), '$'],
       ...(pooled ? [['Your share of dividends', div, '$'], ['Your share of realized gains', gains, '$']] : []), ['Change in value', b.value - a.value - net, '$'], ['Ending value', b.value, '$'], ['Units at end', b.units, 'n3'], ['Unit value at end', b.uv, '$'], ['Your share of the club', b.share, '%'], ['Return for the period', ret, '%']];
  const tables = asOf ? [] : [{ title: 'Your activity', columns: ['Date', 'Type', 'Amount', 'Unit value', 'Units', 'Note'], types: ['s', 's', '$', '$', 'n3', 's'],
    rows: replay(E, B.startUnitValue).entries.filter(e => e.pid === pid && mine.some(m => m.id === e.id)).map(e => [e.date, e.kind === 'payment' ? 'Contribution' : 'Withdrawal', e.kind === 'payment' ? e.amount : -e.amount, e.unitValue, e.kind === 'payment' ? e.units : -e.units, e.note || '']) }];
  return { summary, tables };
}
async function clubStatement(gid, from, to){
  const pooled = (await pooledSet()).has(gid), F = dayStart(from), T = Math.min(dayEnd(to), Date.now()), asOf = from === to;
  const out = pooled ? await accountStatement('club_' + gid, from, to, { inLabel: 'Member contributions', outLabel: 'Paid to members' }) : { summary: [], tables: [] };
  const B = ((await q('SELECT data FROM club_books WHERE gid = $1', [gid])).rows[0] || {}).data || { startUnitValue: 10 };
  const E = (await q('SELECT id, data FROM club_entries WHERE gid = $1', [gid])).rows.map(r => Object.assign({ id: r.id }, r.data));
  const live = E.filter(e => !e.voided), R = replay(live.filter(e => (pooled && e.ts ? e.ts <= T : e.date <= iso(T))), B.startUnitValue);
  const clubV = pooled ? out.end : R.value, uv = R.units > 1e-9 ? clubV / R.units : B.startUnitValue, nums = await Acc.clubNumbers(gid);
  if (!pooled){ const R0 = replay(live.filter(e => e.date <= iso(F)), B.startUnitValue); out.summary = asOf ? [['Club value', R.value, '$'], ['Unit value', uv, '$'], ['Units', R.units, 'n3']] : [['Beginning club value', R0.value, '$'], ['Ending club value', R.value, '$'], ['Unit value at end', uv, '$'], ['Units at end', R.units, 'n3']]; }
  else out.summary.push(['Units at end', R.units, 'n3'], ['Unit value at end', uv, '$']);
  const names = {}; for (const p of Object.keys(R.members)) names[p] = await pname(p);
  out.tables.push({ title: 'Members at ' + (asOf ? to : 'period end'), columns: ['Member', 'Account', 'Units', 'Value', 'Share'], types: ['s', 's', 'n3', '$', '%'],
    rows: Object.entries(R.members).filter(([, m]) => m.units > 1e-6).map(([p, m]) => [names[p], nums.members[p] || '', m.units, m.units * uv, R.units > 1e-9 ? m.units / R.units : 0]) });
  if (!asOf){
    const inP = E.filter(e => (pooled && e.ts ? e.ts > F && e.ts <= T : e.date > iso(F) && e.date <= iso(T)));
    out.tables.push({ title: 'Club ledger', columns: ['Date', 'Entry', 'Member', 'Amount', 'Note'], types: ['s', 's', 's', '$', 's'], rows: inP.map(e => [e.date, (e.voided ? 'VOIDED ' : '') + e.kind, e.pid ? (names[e.pid] || await0(e.pid)) : '', e.amount, e.voided ? e.voided.reason : (e.note || '')]) });
    const subs = (await q(`SELECT pid, data FROM club_submissions WHERE gid = $1`, [gid])).rows.filter(r => r.data.reviewedTs > F && r.data.reviewedTs <= T);
    out.tables.push({ title: 'Approvals', columns: ['Decided', 'Request', 'Status', 'Approved by'], types: ['s', 's', 's', 's'], rows: await Promise.all(subs.map(async r => [iso(r.data.reviewedTs), r.data.kind === 'document' ? r.data.docType : r.data.kind + (r.data.amount ? ' $' + r2(r.data.amount).toFixed(2) : ''), r.data.status, (await Promise.all((r.data.approvals || []).map(x => pname(x.pid)))).join(', ') || (r.data.reviewerPid && r.data.reviewerPid !== 'pocket' ? await pname(r.data.reviewerPid) : r.data.reviewerPid === 'pocket' ? 'Pocket team' : '')])) });
    const log = (await q(`SELECT pid, text, ts FROM club_log WHERE gid = $1 AND ts > to_timestamp($2 / 1000.0) AND ts <= to_timestamp($3 / 1000.0) ORDER BY id`, [gid, F, T])).rows;
    out.tables.push({ title: 'Money log', columns: ['Date', 'By', 'What happened'], types: ['s', 's', 's'], rows: await Promise.all(log.map(async l => [iso(new Date(l.ts).getTime()), l.pid ? await pname(l.pid) : '', l.text])) });
  }
  return out;
}
const await0 = p => p;
/* Who may see which statement. */
async function allowed(viewer, kind, gid, pid){
  if (viewer.isAdmin) return true;
  if (kind === 'personal') return pid === viewer.pid;
  const m = ((await q('SELECT data FROM doc_memberships WHERE id = $1', [gid + '__' + viewer.pid])).rows[0] || {}).data;
  const officer = !!m && EDIT.includes(m.role);
  if (kind === 'club') return officer;
  if (kind === 'member'){ if (pid === viewer.pid){ if (m && m.role !== 'observer') return true; return (await q(`SELECT 1 FROM club_entries WHERE gid = $1 AND data->>'pid' = $2 LIMIT 1`, [gid, pid])).rows.length > 0; } return officer; }
  return false;
}
async function build(kind, { gid, pid, from, to, label }){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw Object.assign(new Error('Pick a valid period.'), { userFacing: true });
  if (to > iso(Date.now())) to = iso(Date.now());
  let body, title, account, holder, note;
  if (kind === 'personal'){ body = await accountStatement(pid, from, to, { inLabel: 'Transfers in', outLabel: 'Transfers out' }); title = 'Practice account statement'; account = await Acc.personal(pid); holder = await pname(pid); note = 'Practice account record from Pocket Investing. Simulated money; not a brokerage statement. Dividends are practice estimates.'; }
  else if (kind === 'member'){ body = await memberStatement(gid, pid, from, to); title = 'Club member statement: ' + await gname(gid); account = await Acc.member(gid, pid); holder = await pname(pid); note = "A record of this member's stake in the club, kept in the club's books on Pocket Investing. Not a brokerage statement" + ((await pooledSet()).has(gid) ? '; this pooled club uses practice money during the beta.' : '; the club\'s money is held at its own brokerage.'); }
  else if (kind === 'club'){ body = await clubStatement(gid, from, to); title = 'Club statement: ' + await gname(gid); account = await Acc.club(gid); holder = await gname(gid); note = "The club's own records on Pocket Investing. Not a brokerage statement" + ((await pooledSet()).has(gid) ? '; this pooled club uses practice money during the beta.' : '; the brokerage holding the club\'s money issues the official statement.'); }
  else throw Object.assign(new Error('Unknown statement type.'), { userFacing: true });
  return { kind, gid: gid || null, pid: pid || null, title, account, holder, period: { from, to, label: label || (from === to ? 'As of ' + to : from + ' to ' + to) }, generatedTs: Date.now(), note, summary: body.summary, tables: body.tables };
}
/* ---------- rendering ---------- */
const money = v => v == null ? '' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v, t) => v == null || v === '' ? '' : t === '$' ? money(v) : t === '%' ? (v * 100).toFixed(2) + '%' : t === 'n3' ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(v);
const pdfSafe = s => String(s).replace(/→/g, '->').replace(/[−–]/g, '-').replace(/•/g, '*');
function csv(S){
  const c = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"', lines = [[S.title], ['Account', S.account], ['Holder', S.holder], ['Period', S.period.label], [S.note], [], ['Summary']].map(r => r.map(c).join(','));
  S.summary.forEach(([k, v, t]) => lines.push([k, fmt(v, t)].map(c).join(',')));
  S.tables.forEach(T => { lines.push('', c(T.title), T.columns.map(c).join(',')); T.rows.forEach(r => lines.push(r.map((v, i) => c(T.types[i] === 's' ? v : v == null ? '' : typeof v === 'number' ? (T.types[i] === '%' ? (v * 100).toFixed(4) : T.types[i] === 'n3' ? v.toFixed(4) : v.toFixed(2)) : v)).join(','))); });
  return lines.join('\n') + '\n';
}
function pdf(S, res){
  const PDFDocument = require('pdfkit'); const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 64, left: 54, right: 54 }, bufferPages: true, info: { Title: S.title, Author: 'Pocket Investing' } });
  res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', `attachment; filename="statement-${S.account}-${S.period.from}-to-${S.period.to}.pdf"`); doc.pipe(res);
  const W = doc.page.width - 108, ink = '#14213d', muted = '#5b6577';
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text('Pocket Investing'); doc.moveDown(0.2).font('Helvetica-Bold').fontSize(13).text(pdfSafe(S.title));
  doc.moveDown(0.6).font('Helvetica').fontSize(10).fillColor('#18202e');
  [['Account number', S.account], ['Account holder', S.holder], ['Period', S.period.label], ['Prepared', new Date(S.generatedTs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })]].forEach(([k, v]) => { doc.font('Helvetica-Bold').text(k + ': ', { continued: true }).font('Helvetica').text(pdfSafe(v)); });
  doc.moveDown(0.5).fontSize(8.5).fillColor(muted).text(pdfSafe(S.note), { width: W }); doc.moveDown(0.8);
  const section = t => { if (doc.y > doc.page.height - 140) doc.addPage(); doc.moveDown(0.4).fillColor(ink).font('Helvetica-Bold').fontSize(11.5).text(pdfSafe(t)); doc.moveTo(54, doc.y + 2).lineTo(54 + W, doc.y + 2).strokeColor('#d5d9e0').lineWidth(0.7).stroke(); doc.moveDown(0.5); };
  section('Summary'); doc.fontSize(10).fillColor('#18202e');
  S.summary.forEach(([k, v, t]) => { const y = doc.y; doc.font('Helvetica').text(pdfSafe(k), 54, y, { width: W * 0.6 }); doc.font('Helvetica-Bold').text(pdfSafe(fmt(v, t)), 54 + W * 0.6, y, { width: W * 0.4, align: 'right' }); doc.moveDown(0.25); });
  S.tables.forEach(T => {
    section(T.title); if (!T.rows.length){ doc.font('Helvetica').fontSize(9.5).fillColor(muted).text('None in this period.'); return; }
    const n = T.columns.length, wts = T.columns.map((c, i) => T.types[i] === 's' && /Note|What|Member|Request|Type|Entry|By/.test(c) ? 2 : 1), tot = wts.reduce((a, b) => a + b, 0), cw = wts.map(x => W * x / tot);
    const head = () => { let x = 54; const y = doc.y; doc.font('Helvetica-Bold').fontSize(8.5).fillColor(muted); T.columns.forEach((c, i) => { doc.text(pdfSafe(c), x, y, { width: cw[i] - 4, align: T.types[i] === 's' ? 'left' : 'right' }); x += cw[i]; }); doc.moveDown(0.3); doc.fillColor('#18202e'); };
    head();
    T.rows.forEach(r => { const cells = r.map((v, i) => pdfSafe(T.types[i] === 's' ? (v == null ? '' : v) : fmt(v, T.types[i])));
      const h = Math.max(...cells.map((t, i) => doc.font('Helvetica').fontSize(8.5).heightOfString(t, { width: cw[i] - 4 }))) + 3;
      if (doc.y + h > doc.page.height - 70){ doc.addPage(); head(); }
      let x = 54; const y = doc.y; cells.forEach((t, i) => { doc.font('Helvetica').fontSize(8.5).text(t, x, y, { width: cw[i] - 4, align: T.types[i] === 's' ? 'left' : 'right' }); x += cw[i]; }); doc.y = y + h; doc.x = 54; });
  });
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++){ doc.switchToPage(i); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(muted).text(pdfSafe(`${S.holder}  |  ${S.account}  |  ${S.period.label}  |  Page ${i + 1} of ${range.count}`), 54, doc.page.height - 40, { width: W, align: 'center' }); doc.page.margins.bottom = bottom; }
  doc.end();
}
/* ---------- periods and automatic generation ---------- */
function lastPeriods(now = new Date()){
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), out = [];
  const pm = new Date(Date.UTC(y, m - 1, 1)), me = new Date(Date.UTC(y, m, 0));
  out.push({ key: 'M-' + iso(pm).slice(0, 7), from: iso(pm), to: iso(me), label: pm.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), months: [iso(pm).slice(0, 7)] });
  if (m % 3 === 0){ const qs = new Date(Date.UTC(y, m - 3, 1)), qn = Math.floor(qs.getUTCMonth() / 3) + 1; out.push({ key: `Q-${qs.getUTCFullYear()}-Q${qn}`, from: iso(qs), to: iso(me), label: `Q${qn} ${qs.getUTCFullYear()}`, months: [0, 1, 2].map(i => iso(new Date(Date.UTC(y, m - 3 + i, 1))).slice(0, 7)) }); }
  if (m === 0) out.push({ key: 'Y-' + (y - 1), from: (y - 1) + '-01-01', to: (y - 1) + '-12-31', label: 'Year ' + (y - 1), months: Array.from({ length: 12 }, (_, i) => (y - 1) + '-' + String(i + 1).padStart(2, '0')) });
  return out;
}
async function store(kind, gid, pid, P){
  const ex = await q(`SELECT 1 FROM statements WHERE kind = $1 AND coalesce(gid, '') = $2 AND coalesce(pid, '') = $3 AND period_key = $4`, [kind, gid || '', pid || '', P.key]); if (ex.rows.length) return false;
  const S = await build(kind, { gid, pid, from: P.from, to: P.to, label: P.label });
  await q(`INSERT INTO statements (id, kind, gid, pid, period_key, period_from, period_to, label, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`, [require('crypto').randomBytes(8).toString('hex'), kind, gid || null, pid || null, P.key, P.from, P.to, P.label, JSON.stringify(S)]);
  return true;
}
async function generate(notify){
  let n = 0;
  for (const P of lastPeriods()){
    for (const r of (await q(`SELECT id, data FROM doc_profiles WHERE id LIKE 'u\\_%'`)).rows){ if ((r.data.createdTs || 0) > dayEnd(P.to)) continue;
      if (await store('personal', null, r.id, P)){ n++; notify && notify([r.id], { title: 'Your ' + P.label + ' statement is ready', body: 'See it under Statements in your Profile.', url: '/#/statements', tag: 'statement' }); } }
    for (const b of (await q('SELECT gid, data FROM club_books')).rows){
      const locked = ((b.data.closes || []).filter(c => c.signedBy).map(c => c.month).sort().slice(-1)[0]) || '';
      if (!P.months.every(m => m <= locked)) continue; /* club statements wait until the period's months are closed and signed off */
      const first = ((await q(`SELECT min(data->>'date') AS d FROM club_entries WHERE gid = $1`, [b.gid])).rows[0] || {}).d; if (!first || first > P.to) continue;
      if (await store('club', b.gid, null, P)) n++;
      const holders = (await q(`SELECT DISTINCT data->>'pid' AS pid FROM club_entries WHERE gid = $1 AND data->>'pid' IS NOT NULL AND data->>'date' <= $2`, [b.gid, P.to])).rows.map(x => x.pid);
      for (const p of holders) if (await store('member', b.gid, p, P)){ n++; notify && notify([p], { title: 'Your ' + P.label + ' club statement is ready', body: 'See it under Statements in your Profile.', url: '/#/statements', tag: 'statement' }); }
    }
  }
  return n;
}
function mount(app, d){
  q = d.q;
  (async () => { await q(`CREATE TABLE IF NOT EXISTS statements (id text PRIMARY KEY, kind text NOT NULL, gid text, pid text, period_key text NOT NULL, period_from date, period_to date, label text, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS statements_unique ON statements (kind, coalesce(gid, ''), coalesce(pid, ''), period_key)`); await Acc.migrate(q); setTimeout(() => Acc.ensureAll().catch(e => console.error('account numbers', e.message)), 8000); })().catch(e => console.error('statements setup', e.message));
  setInterval(() => Acc.ensureAll().catch(e => console.error('account numbers', e.message)), 10 * 60000);
  const run = () => generate(d.push).then(n => { if (n) console.log('Generated ' + n + ' statements.'); }).catch(e => console.error('statements', e.message));
  setTimeout(run, 40000); setInterval(run, 3 * 3600000);
  const viewer = async (req, res) => { const u = await d.needUser(req, res); if (!u) return null; return { pid: 'u_' + u.id, isAdmin: d.isAdmin(u) }; };
  /* What this person can see: stored statements, and the accounts they can build one for. */
  app.get('/api/statements', wrap2(d, async (req, res) => {
    const V = await viewer(req, res); if (!V) return; await Acc.ensureAll().catch(() => {});
    const mine = (await q(`SELECT data FROM doc_memberships WHERE data->>'pid' = $1`, [V.pid])).rows.map(r => r.data).filter(m => m.role !== 'observer');
    const clubs = new Set((await q('SELECT gid FROM club_books')).rows.map(r => r.gid)), accounts = [{ kind: 'personal', pid: V.pid, label: 'Practice account', number: await Acc.personal(V.pid) }];
    for (const m of mine) if (clubs.has(m.gid)){ const name = await gname(m.gid); accounts.push({ kind: 'member', gid: m.gid, pid: V.pid, label: name + ': your stake', number: await Acc.member(m.gid, V.pid) }); if (EDIT.includes(m.role)) accounts.push({ kind: 'club', gid: m.gid, label: name + ': club account', number: await Acc.club(m.gid) }); }
    const rows = (await q(`SELECT id, kind, gid, pid, period_key, label, period_from, period_to, created_at FROM statements ORDER BY period_to DESC, created_at DESC LIMIT 300`)).rows;
    const list = []; for (const r of rows) if (await allowed(V, r.kind, r.gid, r.pid) && (r.kind !== 'personal' || r.pid === V.pid) && (r.kind !== 'member' || r.pid === V.pid || accounts.some(a => a.kind === 'club' && a.gid === r.gid))) list.push({ id: r.id, kind: r.kind, gid: r.gid, pid: r.pid, label: r.label, key: r.period_key, from: iso(new Date(r.period_from).getTime()), to: iso(new Date(r.period_to).getTime()) });
    d.ok(res, { accounts, statements: list.slice(0, 120) });
  }));
  const fromQuery = async (req, res) => { const V = await viewer(req, res); if (!V) return null; const kind = String(req.query.kind || ''), gid = req.query.gid ? String(req.query.gid) : null, pid = kind === 'club' ? null : String(req.query.pid || V.pid);
    if (!(await allowed(V, kind, gid, pid))){ d.bad(res, "You don't have access to that statement.", 403); return null; }
    return build(kind, { gid, pid, from: String(req.query.from || ''), to: String(req.query.to || ''), label: req.query.label ? String(req.query.label).slice(0, 60) : null }); };
  app.get('/api/statements/build', wrap2(d, async (req, res) => { const S = await fromQuery(req, res); if (S) d.ok(res, { statement: S }); }));
  app.get('/api/statements/build.pdf', wrap2(d, async (req, res) => { const S = await fromQuery(req, res); if (S) pdf(S, res); }));
  app.get('/api/statements/build.csv', wrap2(d, async (req, res) => { const S = await fromQuery(req, res); if (S){ res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="statement-${S.account}-${S.period.from}-to-${S.period.to}.csv"`); res.send(csv(S)); } }));
  const saved = async (req, res) => { const V = await viewer(req, res); if (!V) return null; const r = (await q('SELECT kind, gid, pid, data FROM statements WHERE id = $1', [String(req.params.id)])).rows[0];
    if (!r || !(await allowed(V, r.kind, r.gid, r.pid))){ d.bad(res, 'Statement not found.', 404); return null; } return r.data; };
  app.get('/api/statements/:id.pdf', wrap2(d, async (req, res) => { const S = await saved(req, res); if (S) pdf(S, res); }));
  app.get('/api/statements/:id.csv', wrap2(d, async (req, res) => { const S = await saved(req, res); if (S){ res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="statement-${S.account}-${S.period.from}-to-${S.period.to}.csv"`); res.send(csv(S)); } }));
  app.get('/api/statements/:id', wrap2(d, async (req, res) => { const S = await saved(req, res); if (S) d.ok(res, { statement: S }); }));
  app.get('/api/admin/account/:num', wrap2(d, async (req, res) => {
    if (!(await d.needAdmin(req, res))) return; const num = String(req.params.num || '').trim().toUpperCase(); const f = await Acc.find(num);
    if (!f) return d.ok(res, { found: false, valid: Acc.valid(num) });
    d.ok(res, { found: true, kind: f.kind, number: f.number, holder: f.pid ? await pname(f.pid) : null, pid: f.pid, gid: f.gid, club: f.gid ? await gname(f.gid) : null });
  }));
}
const wrap2 = (d, fn) => d.wrap(fn);
module.exports = { mount, build, generate, lastPeriods, events, stateAt, dietz };
