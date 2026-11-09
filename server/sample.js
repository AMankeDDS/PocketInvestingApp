/* Daily sample activity for the demo site: sample investors post and trade through the
   day so the demo never feels frozen. All of it is practice money, and every sample
   investor is labeled as a sample in the app. Off on the real-money site. */
const Market = require('./market');
const { PEOPLE, STYLE_SYMS, TPL, COMMENTS } = require('./seed');
const { personalTrade, groupTrade, rulesOf } = require('./logic');

const pick = a => a[Math.floor(Math.random() * a.length)];
const fill = (t, s) => t.replace(/\$\{S\}/g, '$' + s);
function etHour(){ const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', weekday: 'short' }).formatToParts(new Date()); const o = {}; p.forEach(x => o[x.type] = x.value); return { h: +o.hour % 24, wd: o.weekday }; }

async function tick(withTx, opt = {}){
  let { h, wd } = etHour(); if (opt.force){ h = 11; wd = 'Wed'; }
  if (h < 8 || h >= 21) return [];
  const weekend = wd === 'Sat' || wd === 'Sun';
  const P = opt.force ? 1 : null; /* tests: always act */
  const { changes } = await withTx(async tx => {
    const s = await tx.getSetting('sampleActivity', { posts: true, trades: true, groupTrades: false });
    const people = (await tx.find('profiles', { kind: 'demo' })).filter(p => PEOPLE.some(x => x[0] === p.id));
    if (!people.length) return;
    const style = id => (PEOPLE.find(x => x[0] === id) || [])[3] || 'index';
    /* a post: often a comment on the market, sometimes general */
    if (s.posts && (P || Math.random() < 0.35)){
      const p = pick(people), sym = pick(STYLE_SYMS[style(p.id)]);
      const id = tx.newId();
      await tx.set('posts', id, { pid: p.id, ts: Date.now(), groupId: null, text: Math.random() < 0.3 ? pick(TPL.general) : fill(pick(TPL[style(p.id)]), sym), sample: true });
      for (const q of people.filter(x => x.id !== p.id).sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 3))) await tx.set('reactions', id + '__' + q.id, { postId: id, pid: q.id, ts: Date.now() });
      if (Math.random() < 0.3){ const q = pick(people.filter(x => x.id !== p.id)); await tx.set('comments', tx.newId(), { postId: id, pid: q.id, text: pick(COMMENTS), ts: Date.now() }); }
    }
    /* a personal trade during market hours, shared to the feed */
    if (s.trades && !weekend && h >= 9 && h < 16 && (P || Math.random() < 0.3)){
      const p = pick(people), pf = await tx.get('portfolios', p.id); if (!pf) return;
      const held = Object.keys(pf.positions || {}), sell = held.length > 2 && Math.random() < 0.3;
      const sym = sell ? pick(held) : pick(STYLE_SYMS[style(p.id)]);
      let v = pf.cash || 0; for (const [k, x] of Object.entries(pf.positions || {})) v += x.shares * Market.price(k);
      const shares = sell ? pf.positions[sym].shares * (0.25 + Math.random() * 0.3) : Math.min(pf.cash || 0, v * (0.02 + Math.random() * 0.04)) / Market.price(sym);
      if (shares > 0.001){ try { await personalTrade(tx, p.id, sym, sell ? 'sell' : 'buy', Math.floor(shares * 1000) / 1000, { share: true, note: fill(pick(sell ? TPL.sell : TPL.buy), sym) }); } catch (e){ if (!e.userFacing) throw e; } }
    }
    /* group trades send real approval requests to members, so they are off unless an admin turns them on */
    if (s.groupTrades && !weekend && h >= 10 && h < 15 && (P || Math.random() < 0.06)){
      const groups = (await tx.find('groups')).filter(g => people.some(p => p.id === g.leadPid));
      const g = pick(groups); if (!g) return; const r = rulesOf(g);
      const list = r.allowed === 'etf' ? Market.ETFS : r.allowed === 'list' ? r.allowedList : STYLE_SYMS[style(g.leadPid)];
      const sym = pick(list), lpf = await tx.get('portfolios', g.leadPid); if (!lpf) return;
      let v = lpf.cash || 0; for (const [k, x] of Object.entries(lpf.positions || {})) v += x.shares * Market.price(k);
      const pct = Math.min(r.maxPositionPct || 0.1, 0.05), shares = Math.min(lpf.cash || 0, v * pct) / Market.price(sym);
      if (shares > 0.001){ try { await groupTrade(tx, g.id, g.leadPid, sym, 'buy', Math.floor(shares * 1000) / 1000, fill(pick(TPL.buy), sym)); } catch (e){ if (!e.userFacing) throw e; } }
    }
  });
  return changes;
}
module.exports = { tick };
