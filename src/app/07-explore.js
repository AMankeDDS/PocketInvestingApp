/* Explore: the day's market and what's happening on Pocket, plus the feed. Facts, not recommendations. */
const INDEXES = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['DIA', 'Dow'], ['IWM', 'Russell 2000']];
function exploreData(){
  if (!ui.explore || Date.now() - (ui.exploreTs || 0) > 600000){ if (!ui.exploreLoading){ ui.exploreLoading = true;
    Store.http('GET', '/api/explore').then(r => { ui.explore = r; ui.exploreTs = Date.now(); }, () => { ui.explore = ui.explore || { industries: {}, earnings: [], events: [], related: null }; }).finally(() => { ui.exploreLoading = false; render(); }); } }
  return ui.explore || { industries: {}, earnings: [], events: [], related: null };
}
function vExplore(){
  const tab = ui.exploreTab || 'market';
  const seg = `<div class="seg" style="margin-bottom:16px" role="tablist"><button class="${tab === 'market' ? 'on' : ''}" data-act="extab" data-k="market" role="tab" aria-selected="${tab === 'market'}">Market</button><button class="${tab === 'feed' ? 'on' : ''}" data-act="extab" data-k="feed" role="tab" aria-selected="${tab === 'feed'}">Feed</button></div>`;
  if (tab === 'feed') return seg + vFeed();
  return `<div class="pagehead"><div><h1>Explore</h1><p class="muted">What's moving today, in the market and on Pocket.</p></div><a class="btn ghost sm" href="#/markets">Search stocks</a></div>${seg}${exploreMarket()}`;
}
function exploreMarket(){
  const D = exploreData(), sectorOf = s => (D.industries[s] || {}).sector || SECTOR[s] || null;
  const live = s => !Store.site.realPrices || Market.isReal(s);
  const uni = Market.LIST.map(t => t.s).filter(s => !SMALL_CAPS.has(s) && !(Market.ETFS_UI || []).includes(s) && !INDEXES.some(i => i[0] === s) && Market.price(s) >= 1 && live(s));
  const chg = s => Market.dayChange(s), sec = (title, inner, extra = '') => inner ? `<section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2>${title}</h2>${extra}</header>${inner}</section>` : '';
  /* market at a glance */
  const idx = INDEXES.filter(([s]) => Market.MAP[s]);
  const glance = idx.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">${idx.map(([s, n]) => `<a class="panel" href="#/stock/${s}" style="padding:14px 16px;color:var(--text)"><div class="small muted">${n}</div><div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px"><div><b class="num">${usd(Market.price(s))}</b><div class="small num ${sgn(chg(s))}">${pct(chg(s))}</div></div>${mini(s)}</div></a>`).join('')}</div><p class="hint" style="margin:8px 0 0">Shown through each index's fund (${idx.map(i => i[0]).join(', ')}).</p>` : '';
  /* movers */
  const tab = ui.exMovers || 'gainers', fs = ui.exSector || null, pool = uni.filter(s => !fs || sectorOf(s) === fs);
  const list = tab === 'losers' ? pool.filter(s => chg(s) < 0).sort((a, b) => chg(a) - chg(b)) : pool.filter(s => chg(s) > 0).sort((a, b) => chg(b) - chg(a));
  const movers = `<div class="seg" style="margin-bottom:10px">${[['gainers', 'Biggest gainers'], ['losers', 'Biggest losers']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="exmovers" data-k="${k}">${l}</button>`).join('')}</div>
    ${fs ? `<p class="small" style="margin:0 0 8px">Showing ${esc(fs)} only. <button class="linkbtn small" data-act="exsector" data-k="">Show all sectors</button></p>` : ''}
    <div class="list">${list.slice(0, 8).map(s => stockRow(s)).join('') || '<div class="empty">No moves to show yet today.</div>'}</div>`;
  /* sectors */
  const by = {}; uni.forEach(s => { const k = sectorOf(s); if (!k) return; (by[k] = by[k] || []).push(chg(s)); });
  const sectors = Object.entries(by).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length, v.length]).sort((a, b) => b[1] - a[1]);
  const tiles = sectors.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">${sectors.map(([k, a, n]) => { const t = Math.min(1, Math.abs(a) / 0.03);
      return `<button class="panel" data-act="exsector" data-k="${esc(k)}" aria-pressed="${fs === k}" style="padding:12px 14px;text-align:left;cursor:pointer;border:${fs === k ? '2px solid var(--blue)' : '1px solid var(--line)'};background:color-mix(in srgb, ${a >= 0 ? 'var(--gain)' : 'var(--loss)'} ${Math.round(8 + t * 22)}%, var(--surface))"><b style="display:block">${esc(k)}</b><span class="num ${sgn(a)}">${pct(a)}</span> <span class="small muted">${n} stocks</span></button>`; }).join('')}</div><p class="hint" style="margin:8px 0 0">Average move of the stocks Pocket tracks in each sector, based on SEC industry codes. Tap one to filter the movers.</p>` : '';
  /* on Pocket */
  const day = Date.now() - 86400000, week = Date.now() - 7 * 86400000, cnt = arr => Object.entries(arr.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {})).filter(([s]) => Market.MAP[s]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const bought = cnt(Store.all('trades').filter(t => t.ts > day && t.side === 'buy' && !t.copyOf).map(t => t.sym));
  const watched = cnt(Store.all('profiles').flatMap(p => p.watchlist || []));
  const talked = cnt(Store.all('posts').filter(p => p.ts > week).flatMap(p => [...new Set(((p.text || '').match(/\$([A-Z]{1,5})\b/g) || []).map(x => x.slice(1)))]));
  const col = (title, rows, unit) => `<div class="panel" style="padding:14px 16px"><b>${title}</b><div class="list" style="margin-top:8px">${rows.map(([s, n]) => `<a class="row" href="#/stock/${s}" style="padding:8px 0"><div class="grow"><b class="sym">${s}</b></div><span class="small muted">${n} ${unit}${n === 1 ? '' : 's'}</span></a>`).join('') || '<div class="small muted">Nothing yet.</div>'}</div></div>`;
  const onPocket = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">${col('Bought most today', bought, 'buy')}${col('Most watched', watched, 'watcher')}${col('Most discussed this week', talked, 'post')}</div>`;
  /* related to what you own */
  const R = D.related; let related = '';
  if (Store.signedIn && R){
    if (!R.own.length) related = `<div class="panel empty">Make a practice trade or join a group, and companies related to what you own will show up here.</div>`;
    else { const chips = syms => syms.map(s => `<a class="tag" href="#/stock/${s}" style="text-decoration:none">${s}</a>`).join(' ');
      const peerRows = Object.entries(R.peers || {}).slice(0, 5).map(([s, p]) => `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow" style="min-width:180px"><b>Same industry as ${s}</b><div class="small muted">${esc(p.industry)}${R.fromGroups.includes(s) ? ', held by your group' : ''}</div></div><div>${chips(p.syms)}</div></div>`).join('');
      related = `<div class="list">${peerRows}${R.alsoHeld.length ? `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow" style="min-width:180px"><b>Members who own your stocks also hold</b><div class="small muted">Counted across members, at least 3 each</div></div><div>${chips(R.alsoHeld.map(x => x.sym))}</div></div>` : ''}${!peerRows && !R.alsoHeld.length ? '<div class="empty">No related companies found yet. Industry details fill in over the next day.</div>' : ''}</div>
        <p class="hint" style="margin:8px 0 0">Related companies, not recommendations. Pocket doesn't suggest what to buy.</p>`; }
  }
  /* earnings, events, news */
  const fmtDay = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const earn = (D.earnings || []).filter(e => Market.MAP[e.sym]).slice(0, 12);
  const earnings = earn.length ? `<div class="list">${earn.map(e => `<a class="row" href="#/stock/${e.sym}">${logo(e.sym)}<div class="grow"><b class="sym">${e.sym}</b> <span class="small muted">${esc((Market.MAP[e.sym] || {}).n || '')}</span></div><span class="small">${fmtDay(e.date)}</span></a>`).join('')}</div><p class="hint" style="margin:8px 0 0">Estimated from each company's past SEC earnings filings.</p>` : '';
  const events = (D.events || []).length ? `<div class="list">${D.events.map(e => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><b>${esc(e.title)}</b>${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}<div style="margin-top:4px">${(e.syms || []).map(s => `<a class="tag" href="#/stock/${s}" style="text-decoration:none">${s}</a>`).join(' ')}</div></div><span class="small">${fmtDay(e.date)}</span></div>`).join('')}</div>` : '';
  const newsSyms = [...new Set(list.slice(0, 6).concat((R && R.own) || []))].slice(0, 12);
  return `${sec('Market at a glance', glance)}
    ${sec("Today's movers", movers, '<span class="small muted">Biggest moves today, not recommendations</span>')}
    ${sec('Sectors today', tiles)}
    ${sec('On Pocket', onPocket)}
    ${related ? sec('Related to what you own', related) : ''}
    ${sec('Earnings this week', earnings)}
    ${sec('Coming up', events, '<span class="small muted">Launches, conferences and other dates to know</span>')}
    ${newsSyms.length ? newsSection('Market news', newsSyms, 6) : ''}
    <p class="hint" style="margin-top:22px">${Store.site.realPrices ? 'Prices from the market.' : 'Prices are simulated.'} For information only, not investment advice.</p>`;
}
