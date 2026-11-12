/* Home: the practice account overview and what is coming up. */

function comingUp(){
  const E = earnings(), soon = Date.now() + 14 * 86400000, items = [];
  myRadarSyms().forEach(s => { const e = E[s]; if (e && Date.parse(e.next + 'T23:59:00Z') >= Date.now() && Date.parse(e.next + 'T00:00:00Z') <= soon) items.push({ t: Date.parse(e.next + 'T12:00:00Z'), html: `<a class="row" href="#/stock/${s}">${logo(s)}<div class="grow"><b>${s}</b> reports earnings <span class="muted small">(estimated)</span></div><span class="small">${fmtDay(e.next)}</span></a>` }); });
  const pf = Store.get('portfolios', Store.myPid) || {};
  Object.keys(pf.positions || {}).forEach(s => { const d = nextDividend(s); if (d && d.getTime() <= soon){ const amt = pf.positions[s].shares * Market.price(s) * DIV_YIELDS[s] / (s === 'O' ? 12 : 4); items.push({ t: d.getTime(), html: `<a class="row" href="#/stock/${s}">${logo(s)}<div class="grow"><b>${s}</b> pays a dividend of about ${usd(amt)} <span class="muted small">(practice estimate)</span></div><span class="small">${fmtDay(d.toISOString().slice(0, 10))}</span></a>` }); } });
  Store.all('recurring').filter(r => r.pid === Store.myPid && !r.paused && r.nextTs <= soon).forEach(r => items.push({ t: r.nextTs, html: `<a class="row" href="#/stock/${r.sym}">${logo(r.sym)}<div class="grow">Recurring buy: <b>${usd(r.amount)}</b> of ${r.sym}</div><span class="small">${new Date(r.nextTs).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></a>` }));
  if (!items.length) return '';
  return `<section class="block"><header><h2>Coming up</h2></header><div class="list">${items.sort((a, b) => a.t - b.t).slice(0, 8).map(x => x.html).join('')}</div></section>`;
}

function waitingOnYou(){ const W = clubWaiting(); if (!W.length) return ''; return `<section class="block"><header><h2>Waiting on you</h2></header><div class="list">${W.map(w => `<a class="row" href="#/group/${w.gid}/club"><div class="grow"><b>${esc(w.name)}</b><div class="small muted">Club money to approve or sign off</div></div><span class="tag ember">${w.count}</span></a>`).join('')}</div></section>`; }

function vHome(){
  if (Store.site.realMoney && Store.signedIn && Store.get('portfolios', Store.myPid)){
    const tabs = `<div class="seg" style="margin-bottom:16px"><button class="${ui.homeTab !== 'real' ? 'on' : ''}" data-act="hometab" data-k="practice">Practice</button><button class="${ui.homeTab === 'real' ? 'on' : ''}" data-act="hometab" data-k="real">Real money</button></div>`;
    return tabs + (ui.homeTab === 'real' ? vReal() : vPracticeHome());
  }
  return vPracticeHome();
}

function vPracticeHome(){
  const me = Store.myPid, pf = Store.get('portfolios', me);
  if (!pf) return vReadOnlyHome();
  const prof = Store.get('profiles', me) || {};
  const v = Store.portfolioValue(pf), total = v / (pf.startValue || Store.START_CASH) - 1;
  const v24 = Store.portfolioValue(pf, Date.now() - 86400000), d = v24 ? v / v24 - 1 : 0;
  const hold = Object.entries(pf.positions || {}).map(([s, p]) => ({ s, ...p, val: p.shares * Market.price(s) })).sort((a, b) => b.val - a.val);
  const groups = Store.myGroups(), myGids = groups.map(g => g.id);
  const sec = (title, inner, extra = '') => inner ? `<section class="block"><header><h2>${title}</h2>${extra}</header>${inner}</section>` : '';
  /* 1. portfolio */
  const hero = `<div class="panel hero"><div style="display:flex;justify-content:space-between;align-items:center"><span class="muted">${Store.site.realMoney ? 'Practice portfolio' : 'Portfolio value'}</span><span class="tag">${Store.site.realMoney ? 'Practice' : 'Simulated'}</span></div>
    <div class="value" data-pv="${me}">${usd(v)}</div>
    <div class="num"><span class="${sgn(d)}" data-pd="${me}">${pct(d)}</span> <span class="muted">today</span> &nbsp; <span class="${sgn(total)}">${pct(total)}</span> <span class="muted">all time</span></div>
    ${ichart('pf:home', seriesPts(t => { let v = pf.cash || 0; for (const [s, p] of Object.entries(pf.positions || {})) v += p.shares * Market.price(s, t); return v; }, ui.pfSpan), ui.pfSpan, { h: 120, aria: 'Portfolio value chart' })}
    <div class="seg" role="tablist" style="margin-top:10px">${Object.keys(SPANS).map(k => `<button class="${ui.pfSpan === k ? 'on' : ''}" data-act="pfspan" data-k="${k}">${k.toUpperCase()}</button>`).join('')}</div>
    ${(() => { const dv = myDividends(); return dv.length ? `<p class="small muted" style="margin:10px 0 0">Dividends received in the past year: <b class="gain">${usd(dv.reduce((a, x) => a + x.amount, 0))}</b> <span class="muted">(practice estimates)</span></p>` : ''; })()}
    <div class="actions" style="align-items:center"><button class="btn" data-act="trade">Trade</button><a class="btn ghost" href="#/groups">Find a group</a><span class="updated" data-updated style="margin-left:auto">Updated just now</span></div></div>`;
  /* 2. waiting on you: approvals, votes, reviews, suggestions */
  const pend = Store.myPending();
  const votes = Store.all('proposals').filter(p => myGids.includes(p.gid)).filter(p => { const t = Store.tally(p.id); return t && !t.closed && !t.mine && !t.waitDays && Store.canVote((Store.membership(p.gid) || {}).role); });
  const reviews = Store.all('reviews').filter(r => r.status === 'pending' && Store.canReview((Store.membership(r.gid) || {}).role));
  const sugg = Store.all('suggestions').filter(x => x.status === 'pending' && Store.canTradeFor((Store.membership(x.gid) || {}).role));
  const gname = gid => (Store.get('groups', gid) || {}).name || 'your group';
  const waiting = pend.length || votes.length || reviews.length || sugg.length ? `${pend.slice(0, 2).map(approvalCard).join('')}
    ${votes.length || reviews.length || sugg.length || pend.length > 2 ? `<div class="list" style="margin-top:${pend.length ? 12 : 0}px">
      ${pend.length > 2 ? `<a class="row" href="#/inbox"><div class="grow"><b>${pend.length - 2} more approval request${pend.length - 2 === 1 ? '' : 's'}</b></div><span class="small">Open</span></a>` : ''}
      ${reviews.map(r => `<a class="row" href="#/group/${r.gid}/activity"><div class="grow"><b>Review a trade</b><div class="small muted ellip">${esc(Store.displayName(r.leaderPid))} ${r.side === 'buy' ? 'bought' : 'sold'} ${esc(r.sym)} in ${esc(gname(r.gid))}</div></div><span class="tag ember">Risk review</span></a>`).join('')}
      ${sugg.map(x => `<a class="row" href="#/group/${x.gid}/activity"><div class="grow"><b>Trade suggestion</b><div class="small muted ellip">${esc(Store.displayName(x.pid))} suggests ${x.side === 'buy' ? 'buying' : 'selling'} ${esc(x.sym)} in ${esc(gname(x.gid))}</div></div><span class="small">Decide</span></a>`).join('')}
      ${votes.slice(0, 3).map(p => `<a class="row" href="#/group/${p.gid}/proposals"><div class="grow"><b>Your vote is needed</b><div class="small muted ellip">${esc(p.title)}, ${esc(gname(p.gid))}</div></div><span class="tag ember">${timeLeft(p.deadlineTs)}</span></a>`).join('')}
    </div>` : ''}` : '';
  /* 3. your groups, latest */
  const latest = myGids.length ? groupItems(myGids).slice(0, 4).map(it => { const gid = it.kind === 'prop' ? it.p.gid : it.p.groupId; const who = it.kind === 'prop' ? it.p.authorPid : it.p.pid;
    const what = it.kind === 'prop' ? 'opened a vote: ' + esc(it.p.title) : it.kind === 'trade' ? `${it.p.trade.side === 'buy' ? 'bought' : 'sold'} ${esc(it.p.trade.sym)} for the group` : esc((it.p.text || '').slice(0, 90));
    return `<a class="row" href="#/group/${gid}/activity">${avatar(who, 'sm')}<div class="grow"><div class="ellip"><b>${esc(Store.displayName(who))}</b> ${what}</div><div class="small muted">${esc(gname(gid))}, ${ago(it.ts)} ago</div></div></a>`; }).join('') : '';
  /* 4. trending, 5. watchlist, 6. explainer */
  const tr = trending().slice(0, 3);
  const watch = (prof.watchlist || []).filter(s => Market.MAP[s]).slice(0, 5);
  const exp = explainerCard();
  return `${gettingStarted()}${showInstallTip()}${starterCard(prof, groups)}${hero}
  ${sec('Waiting on you', waiting)}
  ${sec('Your groups', latest ? `<div class="list">${latest}</div>` : '', '<button class="linkbtn small" data-act="gofeedgroups">See all</button>')}
  ${waitingOnYou()}
  ${comingUp()}
  ${recurringList()}
  ${marketBrief()}
  ${(() => { const mineSyms = [...new Set(hold.map(h => h.s).concat(prof.watchlist || []))]; return mineSyms.length ? newsSection('News for your stocks', mineSyms, 3) : ''; })()}
  ${sec('Trending on Pocket', tr.length ? `<div class="list">${tr.map(trendRow).join('')}</div>` : '', '<span class="muted small">Member activity this week</span>')}
  ${sec('Your watchlist', watch.length ? `<div class="list">${watch.map(sym => stockRow(sym)).join('')}</div>` : '')}
  ${exp}
  ${sec('Holdings', `<div class="list">${hold.length ? hold.map(h => { const px = Market.price(h.s), g = h.cost ? h.val / h.cost - 1 : 0; return `<a class="row" href="#/stock/${h.s}">${logo(h.s)}<div class="grow"><div class="sym">${h.s}</div><div class="small muted">${shs(h.shares)} shares</div></div>${mini(h.s)}<div class="r" style="min-width:86px"><div class="num" data-hv="${h.s}" data-sh="${h.shares}">${usd(h.shares * px)}</div><div class="small num ${sgn(g)}">${pct(g)}</div></div></a>`; }).join('') : `<div class="empty">No holdings yet. <button class="linkbtn" data-act="trade">Place your first trade</button> or join a group to copy its Lead Trader.</div>`}</div>`, `<span class="muted small num">Cash ${usd(pf.cash)}</span>`)}
  ${!Store.isPro() ? `<div class="banner" style="margin-top:16px"><div style="flex:1"><b>Upgrade to Pro</b><div class="small">Join groups as a full member, copy investors, and see how you track your group. $9.99 a month.</div></div><button class="btn sm" data-act="upgrade">See Pro</button></div>` : ''}
  ${groups.length ? `<a class="panel" href="#/digest" style="display:flex;gap:14px;align-items:center;padding:16px 18px;margin-top:26px;color:var(--text)"><span class="avatar" style="background:var(--ember);color:#1b1206;border-radius:12px">7d</span><div class="grow"><b>Your weekly digest</b><div class="small muted">Group trades, your copy rate, open votes and how you track your groups</div></div><span class="small">Open</span></a>` : ''}
  ${sec('Markets', `<div class="list">${marketRows(3)}</div>`, '<a class="small" href="#/markets">All stocks</a>')}
  <p class="hint" style="margin-top:22px">${DISCLOSE}</p>`;
}

function vReadOnlyHome(){
  if (!Store.site.demoTools) return `<div class="panel" style="padding:24px;margin-bottom:18px"><div class="mark" style="width:44px;height:44px;font-size:20px;border-radius:13px">P</div>
    <h1 style="margin-top:16px">Invest on your own, or together.</h1><p class="muted">Follow investors you trust, invest with a group that decides together, and approve every trade that touches your account.${Store.inviteOnly ? ' Pocket Investing is invite only right now.' : ''}</p>
    ${Store.signedIn ? '' : `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="signin">Sign in</button><a class="btn ghost" href="#/join">${Store.inviteOnly ? 'I have an invite code' : 'Create an account'}</a></div>`}</div>`;
  return `<div class="panel" style="padding:24px;margin-bottom:18px"><div class="mark" style="width:44px;height:44px;font-size:20px;border-radius:13px">P</div>
    <h1 style="margin-top:16px">See Pocket Investing in two minutes</h1><p class="muted">Take a guided tour as Dan, a sample member of an investing group. You'll see an approval request, the Risk Manager's review, group rules and voting, the feed and how members track their group.${Store.inviteOnly ? ' Have an invite code? Create an account and try it with simulated money.' : ' Or create a free account and try it with simulated money.'}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ember" data-act="tour">Start the tour</button>${Store.signedIn ? '' : `<a class="btn ghost" href="#/join">Create a free account</a><button class="btn ghost" data-act="signin">Sign in</button>`}</div></div>
  <section class="block"><header><h2>Markets</h2><span class="muted small">Simulated prices</span></header><div class="list">${marketRows()}</div></section>`;
}
