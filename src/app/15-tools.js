/* Search (stocks, people, groups), price alerts, and copy protection (stop-loss). */
function searchSheet(){
  let recent = []; try { recent = JSON.parse(localStorage.getItem('pi_recent') || '[]'); } catch(e){}
  openModal(`<header><h2>Search</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="sq">Stocks, people and groups</label><input class="input" id="sq" type="search" autocomplete="off" placeholder="e.g. Apple, KO, Maya, Tech Momentum"></div>
    <div id="sr" aria-live="polite"></div>`, sh => {
    const box = sh.querySelector('#sq'), out = sh.querySelector('#sr');
    const row = (href, title, sub, key) => `<a class="row" href="${href}" data-recent="${key || ''}"><div class="grow"><b>${title}</b><div class="small muted">${sub}</div></div><span class="muted">›</span></a>`;
    const draw = () => {
      const t = box.value.trim().toLowerCase();
      if (!t){ out.innerHTML = recent.length ? `<p class="small muted" style="margin:6px 0">Recent</p><div class="list">${recent.filter(s => Market.MAP[s]).map(s => row('#/stock/' + s, s, esc(Market.MAP[s].n), s)).join('')}</div>` : '<p class="hint">Search by company name or ticker, a member\'s name, or a group.</p>'; return; }
      const stocks = Market.LIST.filter(x => x.s.toLowerCase().startsWith(t) || x.n.toLowerCase().includes(t)).sort((a, b) => (b.s.toLowerCase() === t) - (a.s.toLowerCase() === t) || (b.s.toLowerCase().startsWith(t)) - (a.s.toLowerCase().startsWith(t))).slice(0, 8);
      const people = Store.all('profiles').filter(p => p.name && p.name.toLowerCase().includes(t) && p.id !== Store.myPid).slice(0, 5);
      const groups = Store.all('groups').filter(g => !Store.rulesOf(g).hidden && (g.name || '').toLowerCase().includes(t)).slice(0, 5);
      out.innerHTML = (stocks.length ? `<p class="small muted" style="margin:6px 0">Stocks</p><div class="list">${stocks.map(x => row('#/stock/' + x.s, x.s + ' <span class="muted" style="font-weight:400">' + esc(x.n) + '</span>', `${usd(Market.price(x.s))} · ${pct(Market.dayChange(x.s))} today`, x.s)).join('')}</div>` : '')
        + (people.length ? `<p class="small muted" style="margin:10px 0 6px">People</p><div class="list">${people.map(p => row('#/u/' + p.id, esc(p.name), p.kind === 'demo' ? 'Sample investor' : 'Member')).join('')}</div>` : '')
        + (groups.length ? `<p class="small muted" style="margin:10px 0 6px">Groups</p><div class="list">${groups.map(g => row('#/group/' + g.id, esc(g.name), esc((g.tagline || g.goal || '').slice(0, 70)))).join('')}</div>` : '')
        || '<div class="panel empty">No matches. Try a ticker like AAPL, or part of a name.</div>';
    };
    box.oninput = draw; draw(); setTimeout(() => box.focus(), 50);
    out.onclick = e => { const a = e.target.closest('a[data-recent]'); if (!a) return; const k = a.dataset.recent;
      if (k){ recent = [k].concat(recent.filter(x => x !== k)).slice(0, 6); try { localStorage.setItem('pi_recent', JSON.stringify(recent)); } catch(err){} } closeModal(); };
  });
}
function vAlerts(){
  if (!Store.signedIn) return vProfile(null);
  const X = ui.alerts; if (!X){ ui.alerts = 'loading'; Store.http('GET', '/api/alerts').then(r => { ui.alerts = r; render(); }, e => { ui.alerts = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading">Loading your alerts…</div>'; if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const W = { above: 'Rises above', below: 'Falls below', move: 'Moves more than' }, fmt = a => a.kind === 'move' ? a.value + '% in a day' : usd(a.value);
  const act = X.alerts.filter(a => a.active), done = X.alerts.filter(a => !a.active);
  return `<div class="pagehead"><div><a href="#/u/${Store.myPid}" class="small">← Profile</a><h1 style="margin-top:6px">Price alerts</h1><p class="muted">Push and in-app notifications, checked every minute. Each alert fires once.</p></div></div>
    <section class="panel" style="padding:16px 18px"><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="al-w" ${X.watchMoves ? 'checked' : ''} style="margin-top:4px"><span><b>Big moves in my watchlist</b><span class="small muted" style="display:block">Once a day per stock, when it moves more than the amount below.</span></span></label>
      <div class="field" style="margin:10px 0 0;max-width:220px"><label for="al-t">Move size</label><select class="input" id="al-t">${[3, 5, 10].map(v => `<option value="${v}" ${X.threshold == v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
      <button class="btn sm" data-act="alertprefs" style="margin-top:10px">Save</button></section>
    <section class="block"><header><h2>Active (${act.length})</h2></header><div class="list">${act.map(a => `<div class="row"><div class="grow"><a href="#/stock/${a.sym}"><b class="sym">${a.sym}</b></a> <span class="small">${W[a.kind]} ${fmt(a)}</span><div class="small muted">Now ${usd(Market.price(a.sym))}</div></div><button class="btn sm ghost" data-act="alertdel" data-id="${a.id}">Remove</button></div>`).join('') || '<div class="empty">No active alerts. Open any stock and choose Set alert.</div>'}</div></section>
    ${done.length ? `<section class="block"><header><h2>Triggered</h2></header><div class="list">${done.slice(0, 20).map(a => `<div class="row"><div class="grow"><b class="sym">${a.sym}</b> <span class="small muted">${W[a.kind]} ${fmt(a)}${a.triggered_price ? ', at ' + usd(a.triggered_price) : ''}</span></div><span class="small muted">${a.triggered_at ? ago(new Date(a.triggered_at).getTime()) + ' ago' : ''}</span></div>`).join('')}</div></section>` : ''}`;
}
function alertSheet(sym){
  const p = Market.price(sym);
  openModal(`<header><h2>Alert for ${esc(sym)}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Now ${usd(p)}. We'll notify you once when this happens.</p>
    <div class="field"><label for="as-k">When ${esc(sym)}</label><select class="input" id="as-k"><option value="above">rises above a price</option><option value="below">falls below a price</option><option value="move">moves more than a % in a day</option></select></div>
    <div class="field"><label for="as-v" id="as-vl">Price ($)</label><input class="input num" id="as-v" type="number" step="any" min="0" inputmode="decimal" value="${(p * 1.05).toFixed(2)}"></div>
    <div class="hint" id="as-why" style="margin:-6px 0 14px"></div><button class="btn" id="as-go" style="width:100%">Set alert</button>`, sh => {
    const k = sh.querySelector('#as-k'), v = sh.querySelector('#as-v'), go = sh.querySelector('#as-go'), why = sh.querySelector('#as-why');
    const upd = () => { const val = parseFloat(v.value);
      whyNot(why, go, !(val > 0) ? 'Enter a value to continue.' : k.value === 'above' && val <= p ? `${sym} is already at ${usd(p)}. Pick a price above that.` : k.value === 'below' && val >= p ? `${sym} is already at ${usd(p)}. Pick a price below that.` : '', ''); };
    k.onchange = () => { sh.querySelector('#as-vl').textContent = k.value === 'move' ? 'Move size (%)' : 'Price ($)'; v.value = k.value === 'move' ? '5' : (p * (k.value === 'above' ? 1.05 : 0.95)).toFixed(2); upd(); };
    v.oninput = upd; upd();
    go.onclick = async () => { go.disabled = true; try { await Store.http('POST', '/api/alerts', { sym, kind: k.value, value: parseFloat(v.value) }); ui.alerts = null; closeModal(); toast('Alert set. Manage alerts in Profile.'); } catch(e){ errToast(e); go.disabled = false; } };
  });
}
function copyStopSheet(o){
  const rel = o.gid ? Store.membership(o.gid) || {} : Store.all('copies').find(c => c.from === Store.myPid && c.to === o.pid) || {};
  const who = o.gid ? ((Store.get('groups', o.gid) || {}).name || 'this group') : Store.displayName(o.pid);
  openModal(`<header><h2>Protect your copies</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">For stocks you got by copying ${esc(who)}: if one falls far enough below what you paid, Pocket steps in. Applies to practice and real money.</p>
    ${rel.copyPaused ? `<div class="why-not">Copies from ${esc(who)} are paused because a stock passed your limit. Save to resume them.</div>` : ''}
    <div class="field"><label for="cs-p">If a copied stock falls below what I paid by</label><select class="input" id="cs-p"><option value="">Off</option>${[10, 15, 20, 25, 30].map(v => `<option value="${v}" ${rel.stopPct == v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
    <div class="field"><label for="cs-a">Then</label><select class="input" id="cs-a"><option value="ask" ${rel.stopAction !== 'stop' ? 'selected' : ''}>Ask me to sell it (you approve, as always)</option><option value="stop" ${rel.stopAction === 'stop' ? 'selected' : ''}>Stop copying ${esc(who)} (keep what I have)</option></select></div>
    <p class="hint">Nothing is sold without your approval. Checked every couple of minutes while the market is open.</p>
    <button class="btn" id="cs-go" style="width:100%">Save</button>`, sh => {
    sh.querySelector('#cs-go').onclick = async () => { const b = sh.querySelector('#cs-go'); b.disabled = true;
      try { await Store.setCopyStop({ gid: o.gid || null, pid: o.pid || null, pct: sh.querySelector('#cs-p').value || null, action: sh.querySelector('#cs-a').value, resume: true }); closeModal(); toast('Saved.'); } catch(e){ errToast(e); b.disabled = false; } };
  });
}
