/* Practice dividends: practice portfolios (and pooled practice clubs) receive estimated dividends
   on a regular schedule, so track records aren't unfair to dividend investors. Yields are rough
   annual estimates; real-money accounts get actual dividends from the broker. */
const Market = require('./market');
const YIELDS = { AAPL: 0.0045, MSFT: 0.0075, NVDA: 0.0003, GOOGL: 0.0045, META: 0.0035, JPM: 0.022, V: 0.007, KO: 0.029, COST: 0.005, DIS: 0.009, XOM: 0.035, JNJ: 0.031, SPY: 0.012, QQQ: 0.006, SCHD: 0.036, O: 0.055 };
const MONTHLY = new Set(['O']);
const PAY_DAY = 15;
function info(sym){ const y = YIELDS[sym]; if (!y) return null; const monthly = MONTHLY.has(sym); return { yield: y, perYear: monthly ? 12 : 4, offset: Market.hash(sym) % 3, monthly }; }
function paysOn(sym, date){ const I = info(sym); if (!I) return false; const d = new Date(date + 'T12:00:00Z'); if (d.getUTCDate() !== PAY_DAY) return false; return I.monthly || d.getUTCMonth() % 3 === I.offset; }
function nextPayment(sym, from = Date.now()){ const I = info(sym); if (!I) return null; const d = new Date(from); for (let i = 0; i < 400; i++){ const s = d.toISOString().slice(0, 10); if (paysOn(sym, s) && d.getTime() > from - 86400000) return s; d.setUTCDate(d.getUTCDate() + 1); } return null; }
async function payFor(tx, date){
  let n = 0;
  const syms = Object.keys(YIELDS).filter(s => paysOn(s, date)); if (!syms.length) return 0;
  const t = new Date(date + 'T20:00:00Z').getTime();
  for (const pf of await tx.find('portfolios')){
    let add = 0;
    for (const s of syms){ const sh = ((pf.positions || {})[s] || {}).shares || 0; if (!sh) continue;
      const I = info(s), per = Market.price(s, Math.min(t, Date.now())) * I.yield / I.perYear, amt = Math.round(sh * per * 100) / 100; if (amt < 0.01) continue;
      const id = `dv_${s}_${date}_${pf.id}`; if (await tx.get('dividends', id)) continue;
      await tx.set('dividends', id, { pid: pf.id, sym: s, shares: sh, perShare: Math.round(per * 10000) / 10000, amount: amt, ts: Math.min(t, Date.now()) }); add += amt; n++; }
    if (add) await tx.update('portfolios', pf.id, { cash: Math.round(((pf.cash || 0) + add) * 100) / 100 });
  }
  return n;
}
/* Pays every scheduled date since the last run (never back-fills before the first run). */
async function run(withTx){
  const today = new Date().toISOString().slice(0, 10);
  const { out, changes } = await withTx(async tx => {
    let last = await tx.getSetting('dividendsThrough', null), paid = 0;
    if (!last){ await tx.setSetting('dividendsThrough', today); return 0; }
    const d = new Date(last + 'T12:00:00Z');
    for (let i = 0; i < 40; i++){ d.setUTCDate(d.getUTCDate() + 1); const s = d.toISOString().slice(0, 10); if (s > today) break; paid += await payFor(tx, s); last = s; }
    await tx.setSetting('dividendsThrough', last); return paid;
  });
  return { paid: out, changes };
}
module.exports = { YIELDS, info, paysOn, nextPayment, payFor, run };
