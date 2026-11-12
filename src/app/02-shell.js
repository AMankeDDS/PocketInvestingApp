/* App shell: routing, navigation, render loop, toasts and modals. */

function route(){ const h = (location.hash || '#/home').slice(2).split('/'); return { name: h[0] || 'home', a: h[1] ? decodeURIComponent(h[1]) : null, b: h[2] || null }; }


/* ---------- nav ---------- */
function renderNav(){
  const r = route().name; const n = Store.myPending().length + (Store.site.realMoney && Array.isArray(ui.realReq) ? ui.realReq.filter(x => x.status === 'pending').length : 0);
  const items = [['home','Home','home'],['explore','Explore','explore'],['portfolio','Portfolio','portfolio'],['groups','Groups','groups'],['u','Profile','me']], railItems = items.slice(0, 4).concat([['inbox','Approvals','inbox']], items.slice(4));
  const href = k => k === 'u' ? '#/u/' + (Store.myPid || '') : '#/' + k;
  const on = k => (k === r || (k === 'groups' && r === 'group') || (k === 'explore' && ['feed', 'markets', 'stock'].includes(r))) ? 'on' : '';
  const s = Clock.session(); const un = Store.get('profiles', Store.myPid) ? Store.unreadCount() : 0;
  const bell = `<a href="#/notifications" class="${r === 'notifications' ? 'on' : ''}" aria-label="Notifications" style="position:relative;display:inline-grid;place-items:center;width:38px;height:38px;border-radius:10px;color:inherit">${ICON.bell.replace('<svg', '<svg width="22" height="22"')}${un ? `<span class="badge" style="top:0;left:22px">${un > 9 ? '9+' : un}</span>` : ''}</a>`;
  const searchBtn = `<button class="btn ghost sm" data-act="search" aria-label="Search stocks, people and groups" title="Search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></button>`;
  const fbIcon = Store.signedIn ? `<button class="btn ghost sm fb-top" data-act="feedback" aria-label="Send feedback" title="Send feedback"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>` : '';
  const sess = `<span class="session" title="${esc(s.label)}" aria-label="${esc(s.label)}"><span class="dot ${s.open ? 'on' : ''}"></span><span class="sess-label">${esc(s.label)}</span>${s.demo ? '<span class="sess-x"> (demo clock)</span>' : ''}</span>`;
  $('#rail').innerHTML = `<div class="brand"><span class="mark">P</span>Pocket Investing</div><button class="nav" data-act="search" style="width:calc(100% - 24px);border:0;background:none;text-align:left;cursor:pointer;font:inherit;color:inherit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span>Search</span></button>` +
    railItems.map(([k, l, i]) => `<a class="nav ${on(k)}" href="${href(k)}"${k === 'explore' ? ' data-act="navexplore"' : ''}>${ICON[i]}<span>${l}</span>${['inbox', 'home', 'portfolio'].includes(k) && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('') +
    `<a class="nav ${r === 'notifications' ? 'on' : ''}" href="#/notifications">${ICON.bell}<span>Notifications</span>${un ? `<span class="badge">${un}</span>` : ''}</a>` +
    (!Store.signedIn && Store.ready ? `<button class="btn" data-act="signin" style="margin:10px 12px">Sign in</button>` : '') +
    (Store.adminNeeds2fa && !Store.canEdit ? `<a class="nav ${r === 'admin' ? 'on' : ''}" href="#/admin">${ICON.me}<span>Beta admin</span></a>` : '') + (Store.canEdit ? `${Store.site.demoTools ? `<a class="nav ${r === 'demo' ? 'on' : ''}" href="#/demo">${ICON.demo}<span>Demo controls</span></a>` : ''}<a class="nav ${r === 'metrics' ? 'on' : ''}" href="#/metrics">${ICON.metrics}<span>Pilot metrics</span></a><a class="nav ${r === 'admin' ? 'on' : ''}" href="#/admin">${ICON.me}<span>Beta admin</span></a>` : '') + sess;
  $('#bottomnav').innerHTML = items.map(([k, l, i]) => `<a class="${on(k)}" href="${href(k)}"${k === 'explore' ? ' data-act="navexplore"' : ''}>${ICON[i]}<span>${l}</span>${['inbox', 'home', 'portfolio'].includes(k) && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('');
  $('#topbar').innerHTML = `<div class="brand"><span class="mark">P</span>Pocket</div><div style="display:flex;gap:8px;align-items:center">${sess}${searchBtn}${fbIcon}${!Store.signedIn && Store.ready ? '<button class="btn sm" data-act="signin">Sign in</button>' : ''}${Store.get('profiles', Store.myPid) ? bell : ''}${Store.canEdit ? `<a href="#/demo" class="btn ghost sm" aria-label="Demo controls">${ICON.demo.replace('<svg','<svg width="18" height="18"')}</a>` : ''}</div>`;
}

function renderItem(it, showGroup){
  const gid = it.kind === 'prop' ? it.p.gid : it.p.groupId;
  const label = showGroup ? `<div class="small" style="padding:12px 18px 0;margin-bottom:-6px"><a href="#/group/${gid}" class="muted">${esc((Store.get('groups', gid) || {}).name || '')}</a></div>` : '';
  if (it.kind === 'prop'){ const role = (Store.membership(gid) || {}).role; return label + `<div style="position:relative">${proposalCard(it.p, role).replace('<article class="post">', `<article class="post"><div class="meta" style="margin-bottom:10px">${avatar(it.p.authorPid, 'sm')}<div class="grow">${nameLink(it.p.authorPid)} <span class="muted small">opened a vote, ${ago(it.p.createdTs)} ago</span></div></div>`)}</div>`; }
  return label + (it.kind === 'trade' ? groupTradeRow(it.p) : postCard(it.p));
}

function schedule(){ if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; render(); }); }

function refocus(){ const i = document.querySelector('[data-search]'); if (i){ i.focus(); const v = i.value; i.value = ''; i.value = v; } }

function render(){
  renderNav();
  const view = $('#view'), r = route();
  view.style.paddingTop = ui.tour != null || ui.presenter != null ? '190px' : '';
  if (!Store.ready){ view.innerHTML = '<div class="loading">Loading Pocket Investing…</div>'; return; }
  if (!Store.hasDb){ view.innerHTML = `<div class="panel empty" style="margin-top:40px"><h2>Can't reach Pocket Investing</h2><p>Check your connection and refresh the page.</p><button class="btn" onclick="location.reload()">Refresh</button></div>`; return; }
  const active = document.activeElement, ak = active && active.dataset && active.dataset.draft, sel = ak ? [active.selectionStart, active.selectionEnd] : null;
  const y = window.scrollY;
  let html;
  switch (r.name){
    case 'feed': ui.exploreTab = 'feed'; html = vExplore(); break;
    case 'groups': html = vGroups(); break;
    case 'group': html = vGroup(r.a, r.b); break;
    case 'inbox': html = vInbox(); break;
    case 'u': html = vProfile(r.a || Store.myPid); break;
    case 'stock': html = vStock(r.a); break;
    case 'demo': html = vDemo(); break;
    case 'notifications': html = vNotifications(); break;
    case 'open': html = vOpenAccount(); break;
    case 'markets': html = vMarkets(); break;
    case 'security': html = vSecurity(); break;
    case 'statements': html = vPocketStatements(); break;
    case 'help': html = vHelp(); break;
    case 'portfolio': html = vPortfolio(); break;
    case 'alerts': html = vAlerts(); break;
    case 'explore': html = vExplore(); break;
    case 'documents': html = vStatements(); break;
    case 'join': html = Store.signedIn ? vHome() : vOnboard(); break;
    case 'terms': html = vLegal('terms'); break;
    case 'privacy': html = vLegal('privacy'); break;
    case 'admin': html = vAdmin(); break;
    case 'settings': html = vNotifySettings(); break;
    case 'invite': html = vInvite(r.a, r.b); break;
    case 'signup': try { if (r.a) sessionStorage.setItem('pi_invite_code', r.a); } catch(e){} html = Store.signedIn ? vHome() : vOnboard(); break;
    case 'digest': html = vDigest(); break;
    case 'metrics': html = vMetrics(); break;
    default: html = vHome();
  }
  const demoVals = route().name === 'demo' ? Object.fromEntries($$('#view select, #view input').map(e => [e.id, e.value])) : null;
  const ann = Store.settings.announcement; let annOff = ''; try { annOff = localStorage.getItem('pi_ann_off') || ''; } catch(e){}
  if (ann && ann.text && String(ann.ts) !== annOff && ui.tour == null) html = `<div class="banner ember" style="margin-bottom:16px"><div style="flex:1"><b>From the Pocket team</b><div class="small">${esc(ann.text)}</div></div><button class="btn sm ghost" data-act="annoff" data-k="${ann.ts}">Dismiss</button></div>` + html;
  const site = Store.site, strip = site.demoSite ? `<div class="banner" style="margin-bottom:16px" role="note"><div style="flex:1"><b>Demo</b>: sample people and simulated prices. Nothing here is real.</div><a class="btn sm" href="https://www.pocketinvesting.com/#invite">Request an invite</a></div>`
    : site.realMoney ? (site.alpacaEnv === 'sandbox' ? `<div class="site-strip" role="note"><b>Real money</b> · test environment: no real money moves</div>` : '')
    : `<div class="site-strip" role="note"><b>Beta</b> · practice money${site.realPrices ? ', real market prices' : ''}</div>`;
  html = strip + html;
  const ac = Store.actingAs; if (ac) html = `<div class="banner ember" style="margin-bottom:16px" role="status"><div style="flex:1"><b>Acting as ${esc(Store.get('profiles', Store.myPid) ? Store.displayName(Store.myPid) : 'a test account')}</b> <span class="small">(test account)</span><div class="small">Everything you do here is real in the sandbox and recorded in the admin log under ${esc(ac.admin)}. Ends ${new Date(ac.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</div></div><button class="btn sm" data-act="actstop">Return to your account</button></div>` + html;
  const mt = Store.maintenance; if (mt && mt.on) html = `<div class="banner ember" style="margin-bottom:16px" role="status"><div style="flex:1"><b>Pocket is read-only for a few minutes</b><div class="small">${esc(mt.message || "We're fixing an issue. Your account and money are safe; you can look around, and changes will work again shortly.")}</div></div></div>` + html;
  view.innerHTML = html;
  try { ichRestore(); } catch(e){}
  renderFeedbackButton();
  if (demoVals) for (const [id, v] of Object.entries(demoVals)){ const e = document.getElementById(id); if (e) e.value = v; }
  $$('[data-draft]', view).forEach(el => { if (ui.drafts[el.dataset.draft] != null) el.value = ui.drafts[el.dataset.draft]; });
  if (ak){ const el = view.querySelector(`[data-draft="${CSS.escape(ak)}"]`); if (el){ el.focus({ preventScroll:true }); try { el.setSelectionRange(sel[0], sel[1]); } catch(e){} } }
  window.scrollTo(0, y);
  live(true);
}

function live(prices){
  const now = Date.now();
  $$('[data-ring]').forEach(el => { const exp = +el.dataset.exp, st = +el.dataset.start, frac = Math.max(0, Math.min(1, (exp - now) / Math.max(1, exp - st))); const c = el.querySelectorAll('circle')[1]; if (c) c.setAttribute('stroke-dashoffset', String(169.6 * (1 - frac))); const t = el.querySelector('[data-cd]'); if (t) t.textContent = left(exp - now); });
  if (!prices) return;
  $$('[data-px]').forEach(el => el.textContent = usd(Market.price(el.dataset.px)));
  $$('[data-chg]').forEach(el => { const c = Market.dayChange(el.dataset.chg); el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue = pct(c) + ' ' : el.textContent = pct(c); el.classList.remove('gain','loss','muted'); el.classList.add(sgn(c)); });
  $$('[data-est]').forEach(el => el.textContent = usd(+el.dataset.sh * Market.price(el.dataset.est)));
  $$('[data-hv]').forEach(el => el.textContent = usd(+el.dataset.sh * Market.price(el.dataset.hv)));
  $$('[data-updated]').forEach(el => { const s = Math.round((Date.now() - Store.lastChange) / 1000); el.textContent = s < 20 ? 'Updated just now' : 'Updated ' + ago(Store.lastChange) + ' ago'; });
  $$('[data-pv]').forEach(el => { const pf = Store.get('portfolios', el.dataset.pv); if (pf) el.textContent = usd(Store.portfolioValue(pf)); });
}


/* ---------- toasts & modal ---------- */
function toast(msg, opt = {}){
  const el = document.createElement('div'); el.className = 'toast' + (opt.tone ? ' ' + opt.tone : '');
  el.innerHTML = `<div class="grow">${esc(msg)}</div>${opt.href ? `<button>${esc(opt.label || 'View')}</button>` : ''}`;
  if (opt.href) el.querySelector('button').onclick = () => { location.hash = opt.href; el.remove(); };
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || 4200);
}

function errToast(e){ toast(e && e.userFacing ? e.message : 'Something went wrong. Try again.'); if (!(e && e.userFacing)) console.error(e); }

function openModal(html, mount){
  $('#modal').innerHTML = `<div class="scrim" data-scrim><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const s = $('#modal [data-scrim]'); s.addEventListener('click', e => { if (e.target === s) closeModal(); });
  $$('#modal [data-close]').forEach(b => b.onclick = closeModal);
  if (mount) mount($('#modal .sheet'));
  const f = $('#modal input, #modal select, #modal textarea'); if (f && !(f.hasAttribute('data-nofocus') && window.matchMedia && matchMedia('(max-width: 760px)').matches)) f.focus();
}

function closeModal(){ $('#modal').innerHTML = ''; }

function suggestSheet(gid){
  const g = Store.get('groups', gid), R = Store.rulesOf(g);
  const list = R.allowed === 'etf' ? Market.LIST.filter(t => Market.ETFS_UI.includes(t.s)) : R.allowed === 'list' ? Market.LIST.filter(t => R.allowedList.includes(t.s)) : Market.LIST;
  openModal(`<header><h2>Suggest a trade</h2><button class="x" data-close aria-label="Close">×</button></header><p class="muted" style="margin-top:0">The Lead Trader reviews your suggestion. If they approve, it becomes a group trade.</p>
    <div class="grid2"><div class="field"><label for="sg-s">Stock</label><select class="input" id="sg-s">${list.map(t => `<option value="${t.s}">${t.s} — ${esc(t.n)}</option>`).join('')}</select></div>
    <div class="field"><label for="sg-side">Action</label><select class="input" id="sg-side"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
    <div class="field"><label for="sg-p">Size</label><select class="input" id="sg-p"><option value="0.02">2% of the portfolio</option><option value="0.05" selected>5%</option><option value="0.1">10%</option></select></div></div>
    <div class="field"><label for="sg-n">Why (optional)</label><textarea class="input" id="sg-n" maxlength="500" placeholder="Your reasoning"></textarea></div><button class="btn ember" id="sg-go" style="width:100%">Send suggestion</button>`, sh => {
    sh.querySelector('#sg-go').onclick = async () => { try { await Store.suggestTrade({ gid, sym: sh.querySelector('#sg-s').value, side: sh.querySelector('#sg-side').value, pct: Number(sh.querySelector('#sg-p').value), note: sh.querySelector('#sg-n').value }); closeModal(); toast('Suggestion sent to the Lead Trader.'); } catch(e){ errToast(e); } };
  });
}

function renderFeedbackButton(){
  let b = document.getElementById('fbbtn');
  const narrow = window.matchMedia && matchMedia('(max-width: 959px)').matches;
  if (!Store.signedIn || ui.tour != null || ui.presenter != null || narrow){ if (b) b.remove(); return; }
  if (!b){ b = document.createElement('button'); b.id = 'fbbtn'; b.className = 'btn sm ghost'; b.textContent = 'Feedback'; b.setAttribute('data-act', 'feedback');
    b.setAttribute('style', 'position:fixed;z-index:25;right:14px;bottom:calc(76px + env(safe-area-inset-bottom,0px));background:var(--surface);box-shadow:0 4px 14px rgba(10,16,30,.12)'); document.body.appendChild(b); }
  b.style.bottom = window.matchMedia && window.matchMedia('(min-width: 960px)').matches ? '20px' : 'calc(76px + env(safe-area-inset-bottom,0px))';
}
