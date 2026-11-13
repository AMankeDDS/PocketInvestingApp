/* Explore: the day's market and what's happening on Pocket, plus the feed. Facts, not recommendations. */
const INDEXES = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['DIA', 'Dow'], ['IWM', 'Russell 2000']];
function exploreData(){
  if (!ui.explore || Date.now() - (ui.exploreTs || 0) > 600000){ if (!ui.exploreLoading){ ui.exploreLoading = true;
    Store.http('GET', '/api/explore').then(r => { ui.explore = r; ui.exploreTs = Date.now(); }, () => { ui.explore = ui.explore || { industries: {}, earnings: [], events: [], related: null }; }).finally(() => { ui.exploreLoading = false; render(); }); } }
  return ui.explore || { industries: {}, earnings: [], events: [], related: null };
}
const EX_CHIPS = [['market', 'Market'], ['movers', 'Movers'], ['sectors', 'Sectors'], ['onpocket', 'On Pocket'], ['earnings', 'Earnings'], ['outlook', 'Outlook'], ['news', 'News'], ['feed', 'Feed']];
function vExplore(){
  const tab = ui.exploreTab || 'market', act = tab === 'feed' ? 'feed' : (ui.exActive || 'market');
  const body = tab === 'feed' ? vFeed() : exploreMarket(), has = k => k === 'feed' || k === 'market' || tab === 'feed' || body.includes(`id="ex-${k}"`);
  const chips = `<nav class="exchips" aria-label="Explore sections">${EX_CHIPS.filter(([k]) => has(k)).map(([k, l]) => `<button class="${act === k ? 'on' : ''}" data-act="exjump" data-k="${k}" aria-current="${act === k}">${l}</button>`).join('')}</nav>`;
  return `<h1 class="ex-h1">Explore</h1>${chips}${body}`;
}
/* Highlight the chip for the section in view. */
function exSpy(force){
  if (route().name !== 'explore' || (ui.exploreTab || 'market') === 'feed') return;
  const nav = document.querySelector('.exchips'); if (!nav) return; const lim = nav.getBoundingClientRect().bottom + 24;
  let cur = 'market'; document.querySelectorAll('section[id^="ex-"]').forEach(s => { if (s.getBoundingClientRect().top <= lim) cur = s.id.slice(3); });
  if (!force && cur === ui.exActive) return; ui.exActive = cur;
  nav.querySelectorAll('button').forEach(b => { const on = b.dataset.k === cur; b.classList.toggle('on', on); b.setAttribute('aria-current', on); if (on) nav.scrollTo({ left: Math.max(0, b.offsetLeft - 20), behavior: 'smooth' }); });
}
let exSpyT = 0; window.addEventListener('scroll', () => { if (exSpyT) return; exSpyT = setTimeout(() => { exSpyT = 0; exSpy(); }, 80); }, { passive: true });
/* "Market closed · opens Monday 9:30 AM ET", using the regular schedule and NYSE holidays. */
const NYSE_HOLIDAYS = new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25','2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24']);
function marketStatusLine(){
  if (!Store.site.realPrices) return '';
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'long' });
  const at = t => Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const isDay = p => !['Saturday', 'Sunday'].includes(p.weekday) && !NYSE_HOLIDAYS.has(`${p.year}-${p.month}-${p.day}`);
  const now = at(Date.now()), mins = (+now.hour) * 60 + (+now.minute);
  if (isDay(now) && mins >= 570 && mins < 960) return 'Market open · closes 4:00 PM ET';
  if (isDay(now) && mins < 570) return 'Market closed · opens today 9:30 AM ET';
  for (let d = 1; d < 10; d++){ const p = at(Date.now() + d * 86400000); if (isDay(p)) return `Market closed · opens ${d === 1 ? 'tomorrow' : p.weekday} 9:30 AM ET`; }
  return 'Market closed';
}
function exploreMarket(){
  const D = exploreData(), sectorOf = s => (D.industries[s] || {}).sector || SECTOR[s] || null;
  const live = s => !Store.site.realPrices || Market.isReal(s);
  const uni = Market.LIST.map(t => t.s).filter(s => !SMALL_CAPS.has(s) && !(Market.ETFS_UI || []).includes(s) && !INDEXES.some(i => i[0] === s) && Market.price(s) >= 5 && live(s)); /* the movers and On Pocket lists show stocks priced $5 and up */
  const chg = s => Market.dayChange(s), sec = (key, title, inner, extra = '') => inner ? `<section class="block" id="ex-${key}"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2>${title}</h2>${extra}</header>${inner}</section>` : '';
  /* market at a glance */
  const idx = INDEXES.filter(([s]) => Market.MAP[s]);
  const glance = idx.length ? `${marketStatusLine() ? `<p class="small muted" style="margin:-4px 0 10px;display:flex;align-items:center;gap:6px"><span class="dot" style="background:${/open ·/.test(marketStatusLine()) ? 'var(--gain)' : 'var(--loss)'}"></span>${marketStatusLine()}</p>` : ''}<div class="exstrip">${idx.map(([s, n]) => `<a class="panel" href="#/stock/${s}"><div class="small muted">${n}</div><div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px"><div><b class="num">${usd(Market.price(s))}</b><div class="small num ${sgn(chg(s))}">${pct(chg(s))}</div></div>${mini(s)}</div></a>`).join('')}</div><p class="hint" style="margin:8px 0 0">Shown through each index's fund (${idx.map(i => i[0]).join(', ')}).</p>` : '';
  /* movers */
  const tab = ui.exMovers || 'gainers', fs = ui.exSector || null, pool = uni.filter(s => !fs || sectorOf(s) === fs);
  const list = tab === 'losers' ? pool.filter(s => chg(s) < 0).sort((a, b) => chg(a) - chg(b)) : pool.filter(s => chg(s) > 0).sort((a, b) => chg(b) - chg(a));
  const movers = `<div class="seg" style="margin-bottom:10px">${[['gainers', 'Biggest gainers'], ['losers', 'Biggest losers']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="exmovers" data-k="${k}">${l}</button>`).join('')}</div>
    ${fs ? `<p class="small" style="margin:0 0 8px">Showing ${esc(fs)} only. <button class="linkbtn small" data-act="exsector" data-k="">Show all sectors</button></p>` : ''}
    <div class="list">${list.slice(0, (ui.exAll || {}).movers ? 20 : 5).map(s => stockRow(s)).join('') || '<div class="empty">No moves to show yet today.</div>'}</div>${list.length > 5 ? `<button class="linkbtn small" data-act="exall" data-k="movers" style="margin-top:8px">${(ui.exAll || {}).movers ? 'Show fewer' : 'See all'}</button>` : ''}`;
  /* sectors */
  const by = {}; uni.forEach(s => { const k = sectorOf(s); if (!k) return; (by[k] = by[k] || []).push(chg(s)); });
  const FUNDS = [['Technology', 'XLK'], ['Financials', 'XLF'], ['Health care', 'XLV'], ['Energy', 'XLE'], ['Consumer', 'XLY'], ['Consumer staples', 'XLP'], ['Industrials', 'XLI'], ['Materials', 'XLB'], ['Utilities', 'XLU'], ['Real estate', 'XLRE'], ['Communication', 'XLC']].filter(([, f]) => Market.MAP[f] && Market.isReal(f));
  const byFund = Store.site.realPrices && FUNDS.length >= 6;
  const sectors = byFund ? FUNDS.map(([k, f]) => [k, chg(f), f]).sort((a, b) => b[1] - a[1]) : Object.entries(by).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length, v.length]).sort((a, b) => b[1] - a[1]);
  const tiles = sectors.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">${sectors.map(([k, a, n]) => { const t = Math.min(1, Math.abs(a) / 0.03);
      return `<button class="panel" data-act="exsector" data-k="${esc(k)}" aria-pressed="${fs === k}" style="padding:12px 14px;text-align:left;cursor:pointer;border:${fs === k ? '2px solid var(--blue)' : '1px solid var(--line)'};background:color-mix(in srgb, ${a >= 0 ? 'var(--gain)' : 'var(--loss)'} ${Math.round(8 + t * 22)}%, var(--surface))"><b style="display:block">${esc(k)}</b><span class="num ${sgn(a)}">${pct(a)}</span> <span class="small muted">${typeof n === 'string' ? n : n + ' stocks'}</span></button>`; }).join('')}</div><p class="hint" style="margin:8px 0 0">${byFund ? 'Each sector\'s move today, measured by its sector fund (for example XLK for Technology). Tap one to filter the movers.' : 'Average move of the stocks Pocket tracks in each sector, based on SEC industry codes. Tap one to filter the movers.'}</p>` : '';
  /* on Pocket */
  const day = Date.now() - 86400000, week = Date.now() - 7 * 86400000, cnt = arr => Object.entries(arr.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {})).filter(([s]) => Market.MAP[s]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const floor = arr => arr.filter(([s]) => Market.price(s) >= 5);
  const bought = cnt(Store.all('trades').filter(t => t.ts > day && t.side === 'buy' && !t.copyOf).map(t => t.sym));
  const watched = cnt(Store.all('profiles').flatMap(p => p.watchlist || []));
  const talked = cnt(Store.all('posts').filter(p => p.ts > week).flatMap(p => [...new Set(((p.text || '').match(/\$([A-Z]{1,5})\b/g) || []).map(x => x.slice(1)))]));
  const col = (title, rows, unit) => { rows = floor(rows); return `<div class="panel" style="padding:14px 16px"><b>${title}</b>${rows.length ? `<div class="plainlist">${rows.map(([s, n]) => `<a class="prow" href="#/stock/${s}"><b class="sym" style="flex:1">${s}</b><span class="small muted">${n} ${unit}${n === 1 ? '' : 's'}</span></a>`).join('')}</div>` : '<p class="small muted" style="margin:8px 0 0">Nothing yet.</p>'}</div>`; };
  const onPocket = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">${col('Bought most today', bought, 'buy')}${col('Most watched', watched, 'watcher')}${col('Most discussed this week', talked, 'post')}</div>`;
  /* related to what you own */
  const R = D.related; let related = '';
  if (Store.signedIn && R){
    if (!R.own.length) related = `<div class="panel empty">${Store.site.realMoney ? 'Make your first trade' : 'Make a practice trade'} or join a group, and companies related to what you own will show up here.</div>`;
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
  return `${sec('market', 'Market at a glance', glance)}
    ${sec('movers', "Today's movers", movers, '<span class="small muted">Biggest moves today, not recommendations. Stocks priced $5 and up.</span>')}
    ${sec('sectors', 'Sectors today', tiles)}
    ${sec('onpocket', 'On Pocket', onPocket, '<span class="small muted">Stocks priced $5 and up</span>')}
    ${related ? sec('related', 'Related to what you own', related) : ''}
    ${sec('earnings', 'Earnings this week', earnings)}
    ${sec('outlook', 'Pocket outlook', exploreOutlook())}
    ${sec('events', 'Coming up', events, '<span class="small muted">Launches, conferences and other dates to know</span>')}
    <div id="ex-news-wrap">${newsSyms.length ? newsSection('Market news', newsSyms, (ui.exAll || {}).news ? 15 : 5, { id: 'ex-news', more: 'news' }) : ''}</div>
    <p class="hint" style="margin-top:22px">${Store.site.realPrices ? 'Prices from the market.' : 'Prices are simulated.'} For information only, not investment advice.</p>`;
}
