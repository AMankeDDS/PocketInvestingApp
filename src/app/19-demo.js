/* Demo controls, the guided tour and presenter mode. */

function tourReviewSample(g){
  const now = Date.now(), px = Market.price('GOOGL'), lead = Store.get('portfolios', g.leadPid);
  return { id:'tour-review', gid: g.id, leaderPid: g.leadPid, sym:'GOOGL', side:'buy', shares: Math.floor((Store.portfolioValue(lead) * 0.07) / px * 1000) / 1000, price: px, status:'pending', createdTs: now - 3 * 60000, expiresTs: now + 12 * 60000, sample: true };
}

function tourSample(){
  const g = Store.get('groups', 'g_techmomentum'); if (!g) return null;
  const now = Date.now(); const pf = Store.get('portfolios', Store.myPid);
  const leadPf = Store.get('portfolios', g.leadPid); const px = Market.price('MSFT');
  const sh = Math.floor((6000 / Store.portfolioValue(leadPf)) * Store.portfolioValue(pf) / px * 1000) / 1000;
  return { id:'tour-sample', gid: g.id, leaderPid: g.leadPid, memberPid: Store.myPid, sym:'MSFT', side:'buy', leaderPrice: Market.price('MSFT', now - 4 * 60000), leaderShares: Math.floor(6000 / px * 1000) / 1000, shares: sh, status:'pending', mode:'window', createdTs: now - 4 * 60000, expiresTs: now + 26 * 60000 };
}

function vDemo(){
  if (!Store.canEdit || !Store.site.demoTools) return `<div class="empty">Demo controls are available on the demo site.</div>`;
  const m = Clock.mode();
  const leadGroups = Store.all('groups').filter(g => Store.isDemo(g.leadPid));
  const openProps = Store.all('proposals').filter(p => !Store.tally(p.id).closed);
  const demoPeople = Store.all('profiles').filter(p => p.kind === 'demo');
  const reports = Store.all('reports').sort((a, b) => b.ts - a.ts);
  return `<div class="pagehead"><div><h1>Demo controls</h1><p class="muted">Drive the sample investors during a presentation. Only demo admins see this page.</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ember" data-act="presenter">Start presenter mode</button><button class="btn ghost" data-act="tour">Preview the viewer tour</button></div></div>
  <section class="panel" style="padding:20px"><h2>Market clock</h2><p class="muted small">Live follows real US market hours. Use the demo clock to show the approval window or the buy-at-open option at any time of day. The clock applies to everyone using the demo.</p>
    <div class="seg">${[['live','Live'],['open','Market open'],['late','3:57 PM']].map(([k, l]) => `<button class="${m === k ? 'on' : ''}" data-act="clock" data-k="${k}">${l}</button>`).join('')}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Have a Lead Trader trade</h2><p class="muted small">The Lead Trader's order fills, and every member gets an approval request sized to their capital (after Risk Manager review, if the group uses it). Group rules apply, such as position limits and allowed investments. Join the group first to receive one yourself.</p>
    ${leadGroups.length ? `<div class="grid2"><div class="field"><label for="d-g">Group</label><select class="input" id="d-g">${leadGroups.map(g => `<option value="${g.id}">${esc(g.name)} (${esc(Store.displayName(g.leadPid))})</option>`).join('')}</select></div>
      <div class="field"><label for="d-s">Stock</label><select class="input" id="d-s">${Market.LIST.map(t => `<option value="${t.s}">${t.s} — ${esc(t.n)}</option>`).join('')}</select></div>
      <div class="field"><label for="d-side">Side</label><select class="input" id="d-side"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
      <div class="field"><label for="d-amt">Amount (dollars)</label><input class="input" id="d-amt" type="number" min="1" value="8000"></div></div>
      <div class="field"><label for="d-note">Note to the group (optional)</label><input class="input" id="d-note" placeholder="Why this trade"></div>
      <button class="btn ember" data-act="demotrade">Place the Lead Trader's trade</button>` : '<p class="muted">No groups with a sample Lead Trader yet.</p>'}</section>
  ${Store.site.marketData ? (() => { const A = ui.anchorInfo; if (!A){ ui.anchorInfo = 'loading'; Store.http('GET', '/api/admin/marketdata').then(r => { ui.anchorInfo = r.anchors; render(); }, () => { ui.anchorInfo = { at: null }; }); }
    const info = A && A !== 'loading' ? A : {};
    return `<section class="panel" style="padding:20px;margin-top:16px"><h2>Prices</h2><p class="muted small">Simulated prices drift away from real ones over time. Updating starts each stock from its real closing price, then it moves on its own again. Last updated: ${info.at ? agoText(info.at) : 'never'}.</p>
      <p class="small" style="margin:0 0 12px"><b>Heads up:</b> the first update can move prices a lot (Apple from about $241 to its real price), which changes everyone's gains and losses. Afterwards, use Add new sample data or Reset if you want the sample history to line up with the new prices.</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn" data-act="anchor">Update prices to real closes</button>
        <span class="small muted">Update automatically each morning</span><div class="seg"><button class="${info.auto ? 'on' : ''}" ${info.auto ? '' : 'data-act="anchorauto" data-k="1"'}>On</button><button class="${info.auto ? '' : 'on'}" ${info.auto ? 'data-act="anchorauto" data-k="0"' : ''}>Off</button></div></div></section>`; })() : ''}
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Add new sample data</h2><p class="muted small">Adds the 20 sample investors, 8 groups and about four months of history alongside what's already here. Nothing is deleted: your groups, posts and testers' activity stay. Running it again adds nothing new.</p>
    <button class="btn" data-act="addsample">Add new sample data</button></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Sample activity</h2><p class="muted small">Sample investors post and trade through the day (8am to 9pm ET) so the demo never feels frozen. All practice money, all labeled as samples. Group trades send real approval requests to members, so they're off unless you turn them on.</p>
    ${(() => { const S = Store.settings.sampleActivity || {}; return `<div class="list">${[['posts','Posts, likes and comments'],['trades','Personal trades, shared to the feed'],['groupTrades','Group trades by sample Lead Traders']].map(([k, l]) => `<div class="row"><div class="grow">${l}</div><div class="seg"><button class="${S[k] ? 'on' : ''}" ${S[k] ? '' : `data-act="sampleact" data-k="${k}"`}>On</button><button class="${S[k] ? '' : 'on'}" ${S[k] ? `data-act="sampleact" data-k="${k}"` : ''}>Off</button></div></div>`).join('')}</div>`; })()}</section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Risk Manager review</h2><p class="muted small">Tech Momentum Crew holds every group trade for its Risk Manager (Jake) before members see it. Release the latest held trade, or pause it for a group vote.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${Store.all('reviews').filter(r => r.status === 'pending').length ? `<button class="btn ember" data-act="demorelease" data-gid="g_techmomentum">Jake releases the trade</button><button class="btn ghost" data-act="demopause" data-gid="g_techmomentum">Jake pauses it for a vote</button>` : '<span class="hint">No trades are waiting for review.</span>'}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Have an investor trade</h2><p class="muted small">A personal trade that's shared to the feed. Everyone copying that investor gets an approval request. Copy them from their profile first to receive one yourself.</p>
    <div class="grid2"><div class="field"><label for="i-p">Investor</label><select class="input" id="i-p">${demoPeople.map(p => `<option value="${p.id}">${esc(p.name)} (${Store.copiersOf(p.id).length} copying)</option>`).join('')}</select></div>
      <div class="field"><label for="i-s">Stock</label><select class="input" id="i-s">${Market.LIST.map(t => `<option value="${t.s}">${t.s} — ${esc(t.n)}</option>`).join('')}</select></div>
      <div class="field"><label for="i-side">Side</label><select class="input" id="i-side"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
      <div class="field"><label for="i-amt">Amount (dollars)</label><input class="input" id="i-amt" type="number" min="1" value="5000"></div></div>
    <div class="field"><label for="i-note">Post text (optional)</label><input class="input" id="i-note" placeholder="Why this trade"></div>
    <button class="btn ember" data-act="indtrade">Place the investor's trade</button></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Sample members respond</h2><p class="muted small">Sample members approve or decline their pending requests, so the group's copy rate fills in.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${Store.all('groups').map(g => `<button class="btn ghost sm" data-act="demoapprove" data-gid="${g.id}">${esc(g.name)}</button>`).join('')}</div></section>
  ${reportsPanel()}
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Sample members vote</h2><p class="muted small">Sample members cast votes on an open proposal.</p>
    <div class="list">${openProps.map(p => `<div class="row"><div class="grow"><div class="ellip">${esc(p.title)}</div><div class="small muted">${esc((Store.get('groups', p.gid) || {}).name || '')}</div></div><button class="btn ghost sm" data-act="demovote" data-id="${p.id}">Simulate votes</button></div>`).join('') || '<div class="empty">No open proposals.</div>'}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Group decisions</h2><p class="muted small">Passed trade proposals the Lead Trader hasn't executed yet.</p>
    <div class="list">${Store.all('proposals').filter(p => p.tradeSym && !p.executed).map(p => { const t = Store.tally(p.id); return `<div class="row"><div class="grow"><div class="ellip">${esc(p.title)}</div><div class="small muted">${t.closed ? (t.result === 'passed' ? 'Passed' : 'Did not pass') : 'Voting open'}</div></div>${t.closed && t.result === 'passed' ? `<button class="btn sm ember" data-act="demoexec" data-id="${p.id}">Lead Trader executes</button>` : ''}</div>`; }).join('') || '<div class="empty">No trade proposals waiting.</div>'}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Groups grow</h2><p class="muted small">Sample owners approve requests to join their invite-only groups, and friends join from your invite links.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end"><button class="btn ghost" data-act="demojoins">Owners approve join requests</button>
    ${Store.myGroups().length ? `<div class="field" style="margin:0"><label for="v-g">Your group</label><select class="input" id="v-g">${Store.myGroups().map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div><button class="btn ghost" data-act="demoinvites">Friends join from my invite</button>` : '<span class="hint">Join a group to simulate invites.</span>'}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px;border-color:var(--loss)"><h2>Reset the whole demo</h2><p class="muted small">Restores the original sample investors, groups, posts and proposals, and gives every account, including yours, a fresh start. Use it before each meeting.</p><button class="btn ghost" data-act="resetall" style="color:var(--loss);border-color:var(--loss)">Reset the demo</button></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Reset my account</h2><p class="muted small">Back to ${usd(Store.START_CASH, 0)} in cash with no holdings, and clear your approval history. Group memberships stay.</p><button class="btn ghost" data-act="reset">Reset my account</button></section>`;
}

async function tourGo(i){
  closeModal();
  if (i < 0 || i >= TOUR.length){ ui.tour = null; Store.setViewAs(null); ui.seenReqs = null; renderTour(); location.hash = '#/home'; return render(); }
  if (ui.tour == null){ Store.setViewAs('demo_dan'); ui.seenReqs = null; }
  ui.tour = i; renderTour();
  location.hash = TOUR[i].go; render();
  if (TOUR[i].after) setTimeout(TOUR[i].after, 120);
}

function renderTour(){
  let el = document.getElementById('tourbar');
  if (ui.tour == null){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement('div'); el.id = 'tourbar'; document.body.appendChild(el); }
  const i = ui.tour, s = TOUR[i];
  el.setAttribute('style', 'position:fixed;z-index:56;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));width:min(94vw,620px);background:var(--ink);color:#fff;border-radius:16px;padding:14px 16px;box-shadow:0 12px 32px rgba(10,16,30,.3)');
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:13px;color:#c9d1e0">Tour: ${i + 1} of ${TOUR.length}</span><button data-act="texit" style="background:none;border:0;color:#c9d1e0;font-size:13px">Exit tour</button></div>
    <div style="height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:8px 0 6px"><div style="height:4px;width:${(i + 1) / TOUR.length * 100}%;background:var(--ember);border-radius:2px"></div></div>
    <div style="font-family:var(--f-num);font-weight:700;font-size:18px">${esc(s.t)}</div><div style="font-size:14px;color:#dfe5f0;margin-top:4px">${esc(s.say)}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">${i > 0 ? '<button class="btn sm ghost" data-act="tback" style="color:#fff;border-color:rgba(255,255,255,.3)">Back</button>' : ''}<button class="btn sm ember" data-act="tnext">${i === TOUR.length - 1 ? 'Finish' : 'Next'}</button></div>`;
}

async function presenterGo(i){
  if (i < 0 || i >= PRESENT.length){ ui.presenter = null; return renderPresenter(); }
  ui.presenter = i; renderPresenter(true);
  try { await PRESENT[i].go(); } catch(e){ errToast(e); }
  renderPresenter();
}

function renderPresenter(busy){
  let el = document.getElementById('presenter');
  if (ui.presenter == null){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement('div'); el.id = 'presenter'; document.body.appendChild(el); }
  const i = ui.presenter, s = PRESENT[i];
  el.setAttribute('style', 'position:fixed;z-index:55;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));width:min(94vw,640px);background:var(--ink);color:#fff;border-radius:16px;padding:14px 16px;box-shadow:0 12px 32px rgba(10,16,30,.3)');
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:13px;color:#c9d1e0">Presenter: step ${i + 1} of ${PRESENT.length}</span><button data-act="pexit" style="background:none;border:0;color:#c9d1e0;font-size:13px">Exit</button></div>
    <div style="font-family:var(--f-num);font-weight:700;font-size:18px;margin-top:4px">${esc(s.t)}</div><div style="font-size:14px;color:#dfe5f0;margin-top:4px">${esc(s.say)}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">${i > 0 ? '<button class="btn sm ghost" data-act="pback" style="color:#fff;border-color:rgba(255,255,255,.3)">Back</button>' : ''}<button class="btn sm ember" data-act="pnext" ${busy ? 'disabled' : ''}>${i === PRESENT.length - 1 ? 'Finish' : 'Next'}</button></div>`;
}

/* Trust and safety queue: shown on Demo controls and in Beta admin. */
function reportsPanel(){
  const reports = Store.all('reports').sort((a, b) => b.ts - a.ts);
  return `<section class="panel" style="padding:20px;margin-top:16px"><h2>Trust and safety queue</h2><p class="muted small">Reports members have sent about groups and profile photos.</p>
    <div class="list">${reports.map(r => r.kind === 'photo' ? `<div class="row"><div class="grow"><div class="ellip"><b>Profile photo: ${esc(Store.displayName(r.pid))}</b> <span class="muted small">${ago(r.ts)} ago</span></div><div class="small muted">${r.status === 'open' ? 'Open' : 'Resolved'}</div></div>${avatar(r.pid)} <button class="btn sm ghost" data-act="rmphoto" data-k="${esc(r.pid)}">Remove photo</button></div>` : `<div class="row"><div class="grow"><div class="ellip"><b>${esc((Store.get('groups', r.gid) || {}).name || 'Group')}</b> <span class="muted small">${ago(r.ts)} ago</span></div><div class="small muted">${esc({ coordinated:'Coordinated buying or selling', misleading:'Misleading performance claims', spam:'Spam or promotion', other:'Something else' }[r.reason] || r.reason)}${r.details ? ': ' + esc(r.details) : ''}</div></div>${r.status === 'open' ? `<button class="btn sm ghost" data-act="resolvereport" data-id="${r.id}">Mark reviewed</button>` : '<span class="tag">Reviewed</span>'}</div>`).join('') || '<div class="empty">No reports.</div>'}</div></section>`;
}
