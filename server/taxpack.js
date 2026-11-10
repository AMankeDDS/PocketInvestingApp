/* Club tax packet: worksheets for the club's tax preparer. Each member's K-1 worksheet maps the year's
   figures to the Schedule K-1 boxes as the form is laid out today; the club worksheet's totals tie to the
   sum of the members'. These are worksheets, not tax forms: the club (or its CPA) prepares, signs and files. */
const Market = require('./market');
const { replay } = require('./club');
const Acc = require('./accounts');
const S = require('./statements');
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
async function build(q, gid, year, onlyPid){
  const g = ((await q('SELECT data FROM doc_groups WHERE id = $1', [gid])).rows[0] || {}).data || {}; const pooled = !!g.pooled;
  const B = ((await q('SELECT data FROM club_books WHERE gid = $1', [gid])).rows[0] || {}).data; if (!B) throw Object.assign(new Error('This club has no books yet.'), { userFacing: true });
  const F = Date.parse(year + '-01-01T00:00:00Z') - 1, T = Math.min(Date.parse(year + '-12-31T23:59:59Z'), Date.now());
  const E = (await q('SELECT id, data FROM club_entries WHERE gid = $1', [gid])).rows.map(r => Object.assign({ id: r.id }, r.data)).filter(e => !e.voided);
  const pids = [...new Set(E.filter(e => e.pid).map(e => e.pid))].filter(p => !onlyPid || p === onlyPid);
  const names = {}; for (const p of pids) names[p] = ((((await q('SELECT data FROM doc_profiles WHERE id = $1', [p])).rows[0]) || {}).data || {}).name || p;
  let sales = [], divs = [], shareAt = null;
  if (pooled){
    const pev = await S.events('club_' + gid); sales = S.lotsAt(pev, T, F).sales; divs = pev.filter(e => e.type === 'dividend' && e.ts > F && e.ts <= T);
    const upTo = t => E.filter(e => (e.ts ? e.ts <= t : e.date <= iso(t)));
    shareAt = (t, p) => { const R = replay(upTo(t), B.startUnitValue); return R.units > 1e-9 ? ((R.members[p] || { units: 0 }).units / R.units) : 0; };
  }
  const docs = [], club = await Acc.club(gid), totals = { div: 0, st: 0, lt: 0, dist: 0, contrib: 0, begin: 0, end: 0 };
  for (const p of pids){
    const M = await S.memberMetrics(gid, p, F, T); if (M.a.value < 0.005 && M.b.value < 0.005 && !M.flows.length) continue;
    let div = 0, st = 0, lt = 0; if (pooled){ divs.forEach(e => { div += e.amount * shareAt(e.ts, p); }); sales.forEach(x => { const sh = shareAt(x.ts, p) * x.gain; if (x.long) lt += sh; else st += sh; }); }
    totals.div += div; totals.st += st; totals.lt += lt; totals.dist += M.withdrawals; totals.contrib += M.contributions; totals.begin += M.a.value; totals.end += M.b.value;
    docs.push({ kind: 'k1', pid: p, title: 'Schedule K-1 worksheet: ' + (g.name || 'Club'), account: await Acc.member(gid, p), holder: names[p], period: { from: year + '-01-01', to: iso(T), label: 'Tax year ' + year }, generatedTs: Date.now(),
      note: "Worksheet for the club's tax preparer, not a tax form. Box numbers follow Schedule K-1 (Form 1065) as laid out today; the preparer confirms them. Allocations follow the units each member held when each item was earned." + (pooled ? ' Qualified dividends, wash sales, return of capital and foreign tax come from the broker\'s 1099 to the club.' : ' This club keeps its money at its own brokerage, so income detail comes from that brokerage\'s 1099; this worksheet covers the capital account.'),
      summary: [['Box 5: Interest income', pooled ? 0 : null, '$'], ['Box 6a: Ordinary dividends', pooled ? div : null, '$'], ['Box 6b: Qualified dividends', null, '$'], ['Box 8: Net short-term capital gain or loss', pooled ? st : null, '$'], ['Box 9a: Net long-term capital gain or loss', pooled ? lt : null, '$'], ['Box 19: Distributions (cash)', M.withdrawals, '$'],
        ['Item L: Beginning capital account', M.a.value, '$'], ['Item L: Capital contributed during the year', M.contributions, '$'], ['Item L: Current year increase (decrease)', M.change, '$'], ['Item L: Withdrawals and distributions', -M.withdrawals, '$'], ['Item L: Ending capital account', M.b.value, '$'], ['Ownership at year end (units)', M.b.share, '%']],
      tables: [] });
  }
  if (!onlyPid){
    const D = {}; divs.forEach(e => { D[e.sym] = (D[e.sym] || 0) + e.amount; });
    docs.unshift({ kind: 'club', title: 'Partnership return worksheet: ' + (g.name || 'Club'), account: club, holder: g.name || 'Club', period: { from: year + '-01-01', to: iso(T), label: 'Tax year ' + year }, generatedTs: Date.now(),
      note: "Club-level totals for the preparer of the club's partnership return (Form 1065). The member worksheets that follow add up to these totals. Not a tax form.",
      summary: [['Interest income', pooled ? 0 : null, '$'], ['Ordinary dividends', pooled ? totals.div : null, '$'], ['Net short-term capital gain or loss', pooled ? totals.st : null, '$'], ['Net long-term capital gain or loss', pooled ? totals.lt : null, '$'], ['Distributions to members', totals.dist, '$'], ['Contributions from members', totals.contrib, '$'], ['Members\' beginning capital (total)', totals.begin, '$'], ['Members\' ending capital (total)', totals.end, '$'], ['Members with a K-1 worksheet', docs.length, 'n3']],
      tables: pooled ? [{ title: 'Sales by lot', columns: ['Sold', 'Stock', 'Shares', 'Acquired', 'Proceeds', 'Cost', 'Gain or loss', 'Term'], types: ['s', 's', 'n3', 's', '$', '$', '$', 's'], rows: sales.map(x => [iso(x.ts), x.sym, x.shares, iso(x.acquired), x.proceeds, x.cost, x.gain, x.long ? 'Long-term' : 'Short-term']) },
        { title: 'Dividends by stock', columns: ['Stock', 'Amount'], types: ['s', '$'], rows: Object.entries(D).map(([k, v]) => [k, v]) }] : [] });
  }
  /* Boxes Pocket can't know show where the number comes from instead of a blank. */
  const src = pooled ? "From the broker's 1099 to the club" : "From the club's brokerage 1099";
  docs.forEach(d => { d.summary = d.summary.map(r => r[1] === null ? [r[0], src, 's'] : r); });
  return docs;
}
module.exports = { build };
