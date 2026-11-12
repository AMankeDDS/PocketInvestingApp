/* Markets, stock pages, news, earnings and the watchlist. */

function logo(sym, cls = ''){ return `<span class="logo ${cls}" style="background:${SECTOR_COLOR[SECTOR[sym]] || AV[Market.hash(sym) % AV.length]}" aria-hidden="true">${esc(String(sym).slice(0, 4))}</span>`; }

function newsRows(items, max = 5){
  return items.slice(0, max).map(n => `<a class="row" href="${esc(n.url || '#')}" target="_blank" rel="noopener noreferrer" style="align-items:flex-start"><div class="grow"><div style="font-weight:600;line-height:1.35">${esc(n.headline)}</div>
    <div class="small muted" style="margin-top:3px">${esc(n.source || 'News')}, ${agoText(n.ts)}${n.symbols && n.symbols.length ? ' · ' + n.symbols.slice(0, 3).map(esc).join(', ') : ''}</div></div><span class="small muted" aria-hidden="true">↗</span></a>`).join('');
}

function newsSection(title, symbols, max = 5){
  if (!Store.site.news) return '';
  const items = Store.news(symbols, 10);
  if (items === null) return `<section class="block"><header><h2>${title}</h2></header><div class="list"><div class="empty">Loading headlines…</div></div></section>`;
  return items.length ? `<section class="block"><header><h2>${title}</h2></header><div class="list">${newsRows(items, max)}</div>${newsNote()}</section>` : '';
}

function marketBrief(){
  const ch = s => Market.dayChange(s), word = v => v >= 0 ? 'up' : 'down', p = v => Math.abs(v * 100).toFixed(1) + '%';
  const movers = Market.LIST.map(t => t.s).filter(s => !['SPY','QQQ','SCHD'].includes(s)).sort((a, b) => Math.abs(ch(b)) - Math.abs(ch(a))).slice(0, 3);
  const heads = Store.site.news ? (Store.news([], 5) || []) : [];
  const srcNote = !heads.length ? '' : heads.every(h => h.source === 'SEC filing') ? ' Headlines are company filings from SEC EDGAR.' : heads.some(h => h.source === 'SEC filing') ? ' Headlines are real: news from Benzinga via Alpaca, and SEC filings.' : ' Headlines are real, from Benzinga via Alpaca.';
  const d = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  return `<section class="block"><header><h2>Market brief</h2><span class="muted small">${d}</span></header><div class="panel" style="padding:16px 18px">
    <p style="margin:0 0 8px">The S&amp;P 500 (SPY) is <b class="${sgn(ch('SPY'))}">${word(ch('SPY'))} ${p(ch('SPY'))}</b> today and the Nasdaq-100 (QQQ) is <b class="${sgn(ch('QQQ'))}">${word(ch('QQQ'))} ${p(ch('QQQ'))}</b>.</p>
    <p class="small" style="margin:0 0 ${heads.length ? 12 : 0}px">Biggest moves: ${movers.map(s => `<a href="#/stock/${s}"><b>${s}</b></a> <span class="${sgn(ch(s))}">${pct(ch(s))}</span>`).join(', ')}.</p>
    ${heads.length ? `<div class="small muted" style="margin-bottom:4px">Top headlines</div><div class="list" style="margin:0 -6px">${newsRows(heads, 3)}</div>` : ''}
    <p class="hint" style="margin:10px 0 0">${Store.site.realPrices ? 'Prices from the market.' : 'Prices are simulated.'}${srcNote} For information only, not a recommendation.</p></div></section>`;
}

function trending(){
  const since = Date.now() - 7 * 86400000, by = {};
  const add = (sym, pid, kind) => { if (!Market.MAP[sym] || SMALL_CAPS.has(sym)) return; const x = by[sym] = by[sym] || { sym, members: new Set(), buys: 0, posts: 0 }; x.members.add(pid); if (kind === 'buy') x.buys++; else x.posts++; };
  Store.all('trades').filter(t => t.ts > since && t.side === 'buy' && !t.copyOf).forEach(t => add(t.sym, t.pid, 'buy'));
  Store.all('posts').filter(p => p.ts > since).forEach(p => { const syms = new Set(((p.text || '').match(/\$([A-Z]{1,5})\b/g) || []).map(x => x.slice(1))); if (p.trade) syms.add(p.trade.sym); syms.forEach(sym => add(sym, p.pid, 'post')); });
  return Object.values(by).filter(x => x.members.size >= MIN_TREND_MEMBERS).sort((a, b) => (b.members.size * 2 + b.buys + b.posts) - (a.members.size * 2 + a.buys + a.posts)).slice(0, 5);
}

function trendRow(x){ return `<a class="row" href="#/stock/${x.sym}">${logo(x.sym)}<div class="grow"><div class="sym">${x.sym}</div><div class="small muted ellip">${x.members.size} members active: ${x.buys} buy${x.buys === 1 ? '' : 's'}, ${x.posts} post${x.posts === 1 ? '' : 's'} this week</div></div>${mini(x.sym)}</a>`; }

/* ---------- earnings calendar (estimated from each company's past SEC earnings filings) ---------- */
function earnings(){ if (!ui.earn){ ui.earn = 'loading'; Store.http('GET', '/api/earnings').then(r => { ui.earn = r.earnings || {}; render(); }, () => { ui.earn = {}; }); } return ui.earn === 'loading' ? {} : ui.earn; }

function myRadarSyms(){
  const pf = Store.get('portfolios', Store.myPid) || {}, prof = Store.get('profiles', Store.myPid) || {}, out = new Set(Object.keys(pf.positions || {}).concat(prof.watchlist || []));
  Store.myGroups().forEach(g => { const lp = Store.get('portfolios', g.pooled ? 'club_' + g.id : g.leadPid); Object.keys((lp && lp.positions) || {}).forEach(s => out.add(s)); Store.all('groupWatch').filter(w => w.gid === g.id).forEach(w => out.add(w.sym)); });
  return [...out];
}

function marketRows(limit){
  let list = Market.LIST.map(t => t.s);
  if (limit) list = list.sort((a, b) => Math.abs(Market.dayChange(b)) - Math.abs(Market.dayChange(a))).slice(0, limit);
  return list.map(s => stockRow(s)).join('');
}

function vMarkets(){
  const R = ui.search;
  return `<div class="pagehead"><div><a href="#/home" class="small">← Home</a><h1 style="margin-top:6px">Markets</h1><p class="muted">${Store.site.realPrices ? 'Market prices' : 'Simulated prices'}${Store.site.marketData ? '. Search any stock listed on a major US exchange.' : ' for the stocks in Pocket today.'}</p></div></div>
  <div class="field" style="max-width:520px"><label for="mk-q" class="sr">Search stocks</label><input class="input" id="mk-q" data-search placeholder="Search by ticker or company, e.g. F or Ford" autocomplete="off" value="${esc(ui.searchQ || '')}"></div>
  ${ui.searchQ ? `<section class="block" style="margin-top:6px"><header><h2>Results</h2></header><div class="list">${R === 'loading' ? '<div class="empty">Searching…</div>' : (R || []).map(r => `<a class="row" href="#/stock/${esc(r.s)}">${logo(r.s)}<div class="grow"><div class="sym">${esc(r.s)}</div><div class="small muted ellip">${esc(r.n)}</div></div>${r.added ? mini(r.s) : '<span class="small muted">View</span>'}</a>`).join('') || '<div class="empty">No stocks match. Pocket supports stocks on major US exchanges priced $5 and up.</div>'}</div></section>` : ''}
  <section class="block"><header><h2>In Pocket</h2></header><div class="list">${marketRows()}</div></section>`;
}

function vStock(sym){
  const t = Market.MAP[sym];
  if (!t){
    if (!Store.site.marketData) return `<div class="empty">That stock isn't available yet. <a href="#/markets">See all stocks</a></div>`;
    if (!ui.ensuring[sym]){ ui.ensuring[sym] = 'loading'; Store.ensureStock(sym).then(() => { ui.ensuring[sym] = 'ok'; render(); }, e => { ui.ensuring[sym] = e.userFacing ? e.message : "Couldn't load that stock."; render(); }); }
    return ui.ensuring[sym] === 'loading' || ui.ensuring[sym] === 'ok' ? '<div class="loading" style="min-height:30vh">Loading ' + esc(sym) + '…</div>' : `<div class="empty">${esc(ui.ensuring[sym])} <a href="#/markets">Search stocks</a></div>`;
  }
  const px = Market.price(sym), c = Market.dayChange(sym);
  let pts = seriesPts(t => Market.price(sym, t), ui.chartSpan);
  if (Market.isReal(sym)){ const k = sym + ':' + ui.chartSpan; if (!ui.bars[k]){ ui.bars[k] = 'loading'; Store.bars(sym, ui.chartSpan).then(b => { ui.bars[k] = b; render(); }, () => { ui.bars[k] = []; }); }
    if (Array.isArray(ui.bars[k]) && ui.bars[k].length > 2) pts = ui.bars[k].map(b => ({ t: b.t, v: b.c })).concat([{ t: Date.now(), v: px }]); }
  const pf = Store.get('portfolios', Store.myPid); const pos = pf && (pf.positions || {})[sym];
  const postsHtml = stockPosts(sym);
  const watching = ((Store.get('profiles', Store.myPid) || {}).watchlist || []).includes(sym);
  const holders = Store.all('portfolios').filter(p => (p.positions || {})[sym]).length;
  const groupsHolding = Store.all('groups').filter(g => !Store.rulesOf(g).hidden && (((Store.get('portfolios', g.leadPid) || {}).positions || {})[sym] || Store.all('posts').some(p => p.groupId === g.id && p.groupTrade && p.trade && p.trade.sym === sym && p.ts > Date.now() - 90 * 86400000)));
  return `<div class="pagehead"><div><a href="#/home" class="small">← Back</a><div style="display:flex;gap:12px;align-items:center;margin-top:6px">${logo(sym)}<h1>${esc(t.n)} <span class="muted">${sym}</span></h1></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><span class="tag">${esc(SECTOR[sym] || 'Stock')}</span>${holders ? `<span class="tag">${holders} Pocket member${holders === 1 ? '' : 's'} own it</span>` : ''}</div></div>
    ${Store.canWrite && Store.get('profiles', Store.myPid) ? `<button class="btn ${watching ? 'ghost' : ''} sm" data-act="watch" data-k="${sym}" aria-pressed="${watching}">${watching ? '★ Watching' : '☆ Watch'}</button>` : ''}</div>
  <div class="panel hero"><div class="value" data-px="${sym}">${usd(px)}</div><div class="num ${sgn(c)}" data-chg="${sym}">${pct(c)} <span class="muted">today</span></div>
    ${ichart('stock:' + sym, pts, ui.chartSpan, { aria: sym + ' price chart' })}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px"><div class="seg" role="tablist">${Object.keys(SPANS).map(k => `<button class="${ui.chartSpan === k ? 'on' : ''}" data-act="span" data-k="${k}">${k.toUpperCase()}</button>`).join('')}</div>
    ${pf ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="trade" data-sym="${sym}" data-side="buy">Buy</button>${pos ? `<button class="btn ghost" data-act="trade" data-sym="${sym}" data-side="sell">Sell</button>` : ''}${Store.canWrite ? `<button class="btn ghost" data-act="recurring" data-k="${sym}" ${Store.site.realMoney ? 'hidden' : ''}>Invest automatically</button>` : ''}</div>` : ''}</div>
    ${(() => { const nd = nextDividend(sym), E = earnings()[sym], bits = [];
      if (DIV_YIELDS[sym]) bits.push(`Dividend: about ${(DIV_YIELDS[sym] * 100).toFixed(1)}% a year, paid ${sym === 'O' ? 'monthly' : 'quarterly'}${nd ? '; next around ' + fmtDay(nd.toISOString().slice(0, 10)) : ''} <span class="muted">(practice estimate)</span>`);
      if (E) bits.push(`Next earnings: around ${fmtDay(E.next)} <span class="muted">(estimated from past SEC filings)</span>`);
      return bits.length ? `<div class="small" style="margin-top:12px;display:grid;gap:4px">${bits.map(b => `<div>${b}</div>`).join('')}</div>` : ''; })()}</div>
  ${pos ? `<section class="block"><header><h2>Your position</h2></header><div class="panel kv"><div><span>Shares</span><b>${shs(pos.shares)}</b></div><div><span>Market value</span><b data-hv="${sym}" data-sh="${pos.shares}">${usd(pos.shares * px)}</b></div><div><span>Average cost</span><b>${usd(pos.cost / pos.shares)}</b></div><div><span>Return</span><b class="${sgn(pos.shares * px / pos.cost - 1)}">${pct(pos.shares * px / pos.cost - 1)}</b></div></div></section>` : ''}
  ${newsSection('News', [sym], 5)}
  ${groupsHolding.length ? `<section class="block"><header><h2>Groups invested in ${sym}</h2></header><div class="list">${groupsHolding.slice(0, 4).map(groupRow).join('')}</div></section>` : ''}
  ${postsHtml}`;
}


/* ---------- notifications for new approval requests ---------- */
function watchRequests(){
  const pend = Store.myPending();
  if (ui.seenReqs === null){ if (Store.ready) ui.seenReqs = new Set(pend.map(r => r.id)); return; }
  for (const r of pend){
    if (ui.seenReqs.has(r.id)) continue; ui.seenReqs.add(r.id);
    const g = r.gid && Store.get('groups', r.gid);
    toast(`${Store.displayName(r.leaderPid)} ${r.side === 'buy' ? 'bought' : 'sold'} ${r.sym}${g ? ' for ' + g.name : ''}. Approve to copy.`, { tone:'ember', href:'#/inbox', label:'Review', ms:9000 });
  }
}
