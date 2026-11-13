/* Track records: rebuilds a portfolio's daily value from its full trade history (not from
   today's holdings), then derives the return, worst drop, monthly returns, volatility,
   a 1-7 risk score and typical holding time. Practice portfolios only. */
const Market = require('./market');
const DAY = 86400000;
const cache = new Map();
/* Risk score bands on annualized volatility, as used for European fund risk ratings (1 = lowest). */
const BANDS = [0.005, 0.02, 0.05, 0.10, 0.15, 0.25];
const riskScore = vol => { let s = 1; for (const b of BANDS) if (vol >= b) s++; return s; };
const pv = pf => (pf.cash || 0) + Object.entries(pf.positions || {}).reduce((a, [s, p]) => a + p.shares * Market.price(s), 0);

async function compute(q, pid, sinceTs){
  const pf = (await q('SELECT data FROM doc_portfolios WHERE id = $1', [pid])).rows[0]; if (!pf) return null;
  const prof = ((await q('SELECT data FROM doc_profiles WHERE id = $1', [pid])).rows[0] || {}).data || {};
  const trades = (await q(`SELECT data FROM doc_trades WHERE data->>'pid' = $1 ORDER BY (data->>'ts')::bigint`, [pid])).rows.map(r => r.data);
  const divs = (await q(`SELECT data FROM doc_dividends WHERE data->>'pid' = $1`, [pid]).catch(() => ({ rows: [] }))).rows.map(r => Object.assign({ side: 'dividend' }, r.data));
  /* Money moved into or out of the account (pooled club contributions and payouts) is a transfer, not a gain. */
  const pooled = new Set((await q(`SELECT id FROM doc_groups WHERE (data->>'pooled')::boolean`)).rows.map(r => r.id)), flows = [];
  if (pid.startsWith('club_')) (await q('SELECT data FROM club_entries WHERE gid = $1', [pid.slice(5)]).catch(() => ({ rows: [] }))).rows.map(r => r.data).filter(e => !e.voided && e.pid && e.kind !== 'valuation').forEach(e => flows.push({ side: 'flow', ts: e.ts, flow: e.kind === 'payment' ? e.amount : -e.amount }));
  else (await q(`SELECT gid, data FROM club_entries WHERE data->>'pid' = $1`, [pid]).catch(() => ({ rows: [] }))).rows.filter(r => pooled.has(r.gid) && !r.data.voided && r.data.kind !== 'valuation').forEach(r => flows.push({ side: 'flow', ts: r.data.ts, flow: r.data.kind === 'payment' ? -r.data.amount : r.data.amount }));
  const events = trades.concat(divs, flows).sort((a, b) => a.ts - b.ts);
  const now = Date.now(), first = trades.length ? trades[0].ts : now;
  const born = Math.max(pf.data.kind === 'club' || !trades.length ? Math.min(prof.createdTs || first, first) : first, pf.data.resetTs || 0); /* starts at the first trade (no flat stretch before it); a practice reset restarts it */
  const start = Math.max(born, sinceTs || 0, now - 365 * DAY);
  /* Walk backwards from today's actual holdings, undoing each trade, so today's value is always exact. */
  let cash = pf.data.cash || 0; const pos = {}; Object.entries(pf.data.positions || {}).forEach(([s, p]) => { pos[s] = p.shares; });
  let i = events.length - 1, negative = false;
  const undo = t => { if (t.side === 'dividend'){ cash -= t.amount; return; } if (t.side === 'flow'){ cash -= t.flow; return; } const amt = t.shares * t.price; if (t.side === 'buy'){ cash += amt; pos[t.sym] = (pos[t.sym] || 0) - t.shares; } else { cash -= amt; pos[t.sym] = (pos[t.sym] || 0) + t.shares; }
    if (pos[t.sym] < -1e-3) negative = true; if (Math.abs(pos[t.sym]) < 1e-4) delete pos[t.sym]; };
  const value = t => cash + Object.entries(pos).reduce((a, [s, sh]) => a + Math.max(0, sh) * Market.price(s, t), 0);
  const days = Math.max(1, Math.floor((now - start) / DAY)), pts = new Array(days + 1);
  for (let k = days; k >= 0; k--){
    const t = k === days ? now : start + k * DAY;
    while (i >= 0 && events[i].ts > t) undo(events[i--]);
    pts[k] = { t, v: value(t) };
  }
  const atBirth = pf.data.kind !== 'club' && start === born && trades.length && trades[0].ts >= start;
  { const sv = pf.data.startValue || 100000; if (pts.length && Math.abs(pts[0].v - sv) < 0.5) pts[0].v = sv; } /* no $99,999.99 from cent rounding */
  const approximate = negative || cash < -1 || (atBirth && Math.abs(pts[0].v - (pf.data.startValue || 100000)) / (pf.data.startValue || 100000) > 0.01);
  const last = pts[pts.length - 1].v;
  /* Time-weighted daily returns: each day's transfers are taken out before measuring the change. */
  const rets = []; for (let k = 1; k < pts.length; k++){ const f = flows.filter(x => x.ts > pts[k - 1].t && x.ts <= pts[k].t).reduce((a, x) => a + x.flow, 0); rets.push(pts[k - 1].v > 0.005 ? (pts[k].v - f) / pts[k - 1].v - 1 : 0); }
  const idx = [1]; rets.forEach(r => idx.push(idx[idx.length - 1] * (1 + r)));
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const vol = rets.length > 1 ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(365) : 0;
  let peak = idx[0], mdd = 0; idx.forEach(v => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  const monthly = []; const d = new Date(now); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  const at = t => { let best = null; for (const p of pts){ if (p.t <= t) best = p; else break; } return best; };
  for (let m = 0; m < 12; m++){
    const ms = new Date(d); ms.setUTCMonth(d.getUTCMonth() - m); const me = new Date(ms); me.setUTCMonth(ms.getUTCMonth() + 1);
    if (me.getTime() <= start) break;
    const a = at(Math.max(ms.getTime(), start)) || pts[0], b = at(Math.min(me.getTime(), now)) || pts[pts.length - 1];
    const ia = pts.indexOf(a), ib = pts.indexOf(b);
    monthly.unshift({ month: ms.toISOString().slice(0, 7), ret: ia >= 0 && ib >= 0 ? idx[ib] / idx[ia] - 1 : null, partial: m === 0 || ms.getTime() < start });
  }
  /* Typical holding time: first-in, first-out matching of sells to earlier buys. */
  const lots = {}; let heldDays = 0, heldShares = 0;
  trades.forEach(t => { if (t.side === 'buy') (lots[t.sym] = lots[t.sym] || []).push({ sh: t.shares, ts: t.ts }); else { let left = t.shares; const L = lots[t.sym] || []; while (left > 1e-6 && L.length){ const lot = L[0], use = Math.min(lot.sh, left); heldDays += use * (t.ts - lot.ts) / DAY; heldShares += use; lot.sh -= use; left -= use; if (lot.sh < 1e-6) L.shift(); } } });
  let openDays = 0, openShares = 0; Object.values(lots).forEach(L => L.forEach(l => { openDays += l.sh * (now - l.ts) / DAY; openShares += l.sh; }));
  const recent = trades.filter(t => t.ts > now - 90 * DAY && !String(t.copyOf || '').startsWith('portfolio:')).length;
  const divTotal = divs.filter(x => x.ts > now - 365 * DAY).reduce((a, x) => a + x.amount, 0);
  return { pid, dividends12m: Math.round(divTotal * 100) / 100, since: start, days, sinceStart: start === born || start === sinceTs, totalReturn: idx[idx.length - 1] - 1, maxDrawdown: mdd, volatility: vol, riskScore: Object.keys(pf.data.positions || {}).length ? riskScore(vol) : 1, thin: !Object.keys(pf.data.positions || {}).length || days < 14,
    monthly, avgHoldDays: heldShares ? heldDays / heldShares : null, openPositionAgeDays: openShares ? openDays / openShares : null, tradesPerMonth: recent / 3, trades: trades.length, approximate,
    series: pts.filter((p, k) => k % Math.max(1, Math.round(pts.length / 120)) === 0 || k === pts.length - 1).map(p => ({ t: p.t, v: Math.round(p.v * 100) / 100 })) };
}
async function get(q, key, pid, sinceTs){
  const c = cache.get(key); if (c && Date.now() - c.at < 5 * 60000) return c.v;
  const v = await compute(q, pid, sinceTs); cache.set(key, { at: Date.now(), v }); if (cache.size > 2000) cache.delete(cache.keys().next().value); return v;
}
function mount(app, d){
  const { q, wrap, ok, bad } = d;
  const memberOf = async (req, gid) => { const u = await d.currentUser(req); if (!u) return false; if (d.isAdmin(u)) return true; const m = ((await q('SELECT data FROM doc_memberships WHERE id = $1', [gid + '__u_' + u.id])).rows[0] || {}).data; return !!m && m.role !== 'observer'; };
  app.get('/api/stats/investor/:pid', wrap(async (req, res) => {
    if (String(req.params.pid).startsWith('club_')) return bad(res, 'Investor not found.', 404); const v = await get(q, 'i:' + req.params.pid, String(req.params.pid)); if (!v) return bad(res, 'Investor not found.', 404); ok(res, { stats: v }); }));
  app.get('/api/stats/group/:gid', wrap(async (req, res) => {
    const g = ((await q('SELECT data FROM doc_groups WHERE id = $1', [String(req.params.gid)])).rows[0] || {}).data; if (!g) return bad(res, 'Group not found.', 404);
    if (g.pooled && !(await memberOf(req, String(req.params.gid)))) return bad(res, "A pooled club's results are for its members.", 403);
    const pid = g.pooled ? 'club_' + req.params.gid : g.leadPid;
    const v = await get(q, 'g:' + req.params.gid + ':' + pid, pid, g.createdTs); ok(res, { stats: v, leadPid: g.leadPid });
  }));
}
module.exports = { mount, compute, riskScore };
