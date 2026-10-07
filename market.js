/* Simulated market + market clock. Same deterministic prices as the browser,
   so every viewer and the server always agree on a price. */
const LIST = [
  ['AAPL','Apple',232],['MSFT','Microsoft',448],['NVDA','NVIDIA',182],['AMZN','Amazon',214],
  ['GOOGL','Alphabet',196],['META','Meta Platforms',612],['TSLA','Tesla',298],['JPM','JPMorgan Chase',262],
  ['V','Visa',334],['KO','Coca-Cola',69],['COST','Costco',912],['NFLX','Netflix',1085],
  ['DIS','Disney',114],['AMD','AMD',198],['XOM','ExxonMobil',116],['JNJ','Johnson & Johnson',164],
  ['SPY','S&P 500 ETF',652],['QQQ','Nasdaq-100 ETF',578],['SCHD','US Dividend Equity ETF',28],['O','Realty Income',58]
].map(([s, n, b]) => ({ s, n, b }));
const MAP = Object.fromEntries(LIST.map(t => [t.s, t]));
function hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed){ let t = (seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function price(sym, ms = Date.now()){
  const T = MAP[sym]; if (!T) return 0;
  const m = ms / 60000, h = hash(sym);
  const p1 = rnd(h) * 6.283, p2 = rnd(h + 1) * 6.283, p3 = rnd(h + 2) * 6.283, vol = 0.6 + rnd(h + 3);
  let x = 0.035 * vol * Math.sin(2 * Math.PI * m / (1440 * 9) + p1) + 0.018 * vol * Math.sin(2 * Math.PI * m / (1440 * 2.3) + p2) + 0.007 * vol * Math.sin(2 * Math.PI * m / (60 * 5.1) + p3);
  const k = Math.floor(m / 15), f = m / 15 - k;
  const n0 = rnd((h + k * 7919) | 0) - 0.5, n1 = rnd((h + (k + 1) * 7919) | 0) - 0.5;
  x += 0.006 * vol * (n0 + (n1 - n0) * f);
  return Math.round(T.b * Math.exp(x) * 100) / 100;
}
function et(ms){
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', hourCycle:'h23', weekday:'short', hour:'2-digit', minute:'2-digit', second:'2-digit' }).formatToParts(new Date(ms));
  const o = {}; for (const p of parts) o[p.type] = p.value; return { wd: o.weekday, mins: (+o.hour % 24) * 60 + (+o.minute) + (+o.second) / 60 };
}
/* mode: 'live' follows real US market hours; 'open' and 'late' are demo clocks set by an admin */
function session(mode, now = Date.now()){
  if (mode === 'open') return { open: true, closeAt: now + 3 * 3600000 };
  if (mode === 'late') return { open: true, closeAt: now + 3 * 60000 };
  const e = et(now); const weekday = !['Sat','Sun'].includes(e.wd);
  const open = weekday && e.mins >= 570 && e.mins < 960;
  return { open, closeAt: open ? now + (960 - e.mins) * 60000 : null };
}
function approvalWindow(mode, now = Date.now()){
  const s = session(mode, now);
  if (s.open && s.closeAt - now > 5 * 60000) return { mode: 'window', expiresTs: Math.min(now + 30 * 60000, s.closeAt - 5 * 60000) };
  return { mode: 'open', expiresTs: now + 18 * 3600000 };
}
function canFillNow(mode, now = Date.now()){ const s = session(mode, now); return s.open && s.closeAt - now > 5 * 60000; }
module.exports = { LIST, MAP, hash, price, session, approvalWindow, canFillNow };
