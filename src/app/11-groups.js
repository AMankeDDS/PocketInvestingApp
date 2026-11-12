/* Groups: discovery, joining, invites, proposals, votes and approvals. */

function groupStats(gid){
  const month = Date.now() - 30 * 86400000;
  const trades = Store.all('posts').filter(p => p.groupId === gid && p.groupTrade && p.ts > month).length;
  const week = Store.all('posts').filter(p => p.groupId === gid && p.groupTrade && p.ts > Date.now() - 7 * 86400000).length;
  const dec = Store.all('copyRequests').filter(r => r.gid === gid && !['pending'].includes(Store.requestState(r)));
  const ok = dec.filter(r => ['filled','queued'].includes(Store.requestState(r))).length;
  return { trades, week, approval: dec.length ? ok / dec.length : null };
}

function reviewSheet(gid, id, decision, kind){
  openModal(`<header><h2>${decision === 'confirmed' ? 'Confirm' : 'Decline'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="rv-n">Note to the member${decision === 'declined' ? '' : ' (optional)'}</label><input class="input" id="rv-n" maxlength="300" placeholder="${decision === 'declined' ? "e.g. Amount doesn't match the receipt" : 'e.g. Thanks, received'}"></div>
    <button class="btn" id="rv-go" style="width:100%">${decision === 'confirmed' ? (kind === 'withdrawal' ? 'Approve and pay out' : 'Confirm and record payment') : 'Decline'}</button>`, sh => {
    sh.querySelector('#rv-go').onclick = async () => { const note = sh.querySelector('#rv-n').value;
      try { if (kind === 'withdrawal'){ const r = await Store.clubDecideWithdrawal(id, decision, note); ui.club[gid] = null; if (r && r.waiting){ closeModal(); toast('Approved. It now needs a second approver.'); render(); return; } } else ui.club[gid] = await Store.http('POST', `/api/club/${gid}/review`, { id, decision, note });
        closeModal(); toast(decision === 'confirmed' ? 'Done.' : 'Declined. The member will see your note.'); render(); } catch(e){ errToast(e); } };
  });
}

function approvalCard(r){
  const st = Store.requestState(r); const g = r.gid ? (Store.get('groups', r.gid) || { name:'a group' }) : null;
  const verb = r.side === 'buy' ? 'bought' : 'sold';
  const src = g ? g.name : 'Copying ' + Store.displayName(r.leaderPid);
  const sellFrac = r.side === 'sell' && r.leaderFrac ? fracWord(r.leaderFrac) : null;
  const head = `<h3>${esc(Store.displayName(r.leaderPid))} ${sellFrac ? 'sold ' + sellFrac + ' of their ' + esc(r.sym) : verb + ' ' + esc(r.sym)}${g ? ' for ' + esc(g.name) : ''}</h3>${g ? '' : '<span class="tag blue" style="margin-bottom:6px">You copy this investor</span>'}`;
  if (st !== 'pending'){
    const half = r.frac && r.frac < 0.995;
    const label = { cancelled:'You cancelled this order before the open', filled: half && !r.partial ? `Copied ${fracWord(r.frac)}: ${r.side === 'buy' ? 'bought' : 'sold'} ${shs(r.fillShares)} of ${shs(r.shares)} suggested at ${usd(r.fillPrice)}` : r.partial ? `Partly copied: ${r.side === 'buy' ? 'bought' : 'sold'} ${shs(r.fillShares)} of ${shs(r.shares)} at ${usd(r.fillPrice)} (${esc(r.note || '')})` : `Copied: ${r.side === 'buy' ? 'bought' : 'sold'} ${shs(r.fillShares)} at ${usd(r.fillPrice)}`, declined:'You declined this trade' + (r.note ? ' (' + esc(r.note) + ')' : ''), expired:'Expired before approval', queued:'Approved: fills at the next market open' }[st] || st;
    return `<div class="row"><div class="grow"><div class="ellip"><b>${esc(r.sym)}</b> <span class="muted">${esc(src)}</span></div><div class="small muted">${label}</div></div>${st === 'queued' && Store.canWrite && r.memberPid === Store.myPid ? `<button class="btn sm ghost" data-act="cancelq" data-id="${r.id}">Cancel order</button>` : `<div class="small muted">${ago(r.decidedTs || r.createdTs)}</div>`}</div>`;
  }
  const isOpen = r.mode === 'open';
  const ring = isOpen
    ? `<div class="ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="var(--ember)" stroke-width="5" opacity=".9"/></svg><div class="t" style="font-size:12px">Open</div></div>`
    : `<div class="ring" data-ring data-exp="${r.expiresTs}" data-start="${r.createdTs}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="32" cy="32" r="27" fill="none" stroke="var(--ember)" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="0"/></svg><div class="t" data-cd>${left(r.expiresTs - Date.now())}</div></div>`;
  const what = r.side === 'buy' ? 'buy' : 'sell';
  const note = isOpen
    ? `The market is closing or closed. Approve to ${what} at the next open; the opening price may differ from the Lead Trader's.`
    : sellFrac ? `Approve to sell ${sellFrac} of yours: ${shs(r.shares)} shares. The window closes 30 minutes after the trade, or 5 minutes before the market closes.`
    : `Approve to ${what} ${shs(r.shares)} shares in your own account, sized to your capital. The window closes 30 minutes after the trade, or 5 minutes before the market closes.`;
  return `<article class="approval">${ring}<div>${head}<p class="muted small" style="margin:0">${note}</p>
    <div class="facts">
      <div><span>Lead Trader's fill</span><b>${usd(r.leaderPrice)}</b></div>
      <div><span>Price now</span><b data-px="${r.sym}">${usd(Market.price(r.sym))}</b></div>
      <div><span>Your shares</span><b>${shs(Math.floor(r.shares * (ui.copyFrac[r.id] || 1) * 1000) / 1000)}</b></div>
      <div><span>Est. ${r.side === 'buy' ? 'cost' : 'proceeds'}</span><b data-est="${r.sym}" data-sh="${r.shares * (ui.copyFrac[r.id] || 1)}">${usd(r.shares * (ui.copyFrac[r.id] || 1) * Market.price(r.sym))}</b></div>
    </div>
    ${ui.tour != null || Store.canWrite ? `<div style="display:flex;align-items:center;gap:10px;margin:-4px 0 12px;flex-wrap:wrap"><span class="small muted">Copy</span><div class="seg">${[[0.5,'Half'],[1,'Full']].map(([k, l]) => `<button class="${(ui.copyFrac[r.id] || 1) === k ? 'on' : ''}" data-act="cfrac" data-id="${r.id}" data-k="${k}" ${ui.tour != null ? 'disabled' : ''}>${l}</button>`).join('')}</div><span class="small muted">of the suggested amount</span></div>` : ''}
    ${(() => { const pf = Store.get('portfolios', r.memberPid); if (r.side !== 'buy' || !pf) return ''; const cost = r.shares * Market.price(r.sym); return cost > pf.cash + 0.01 ? `<div class="banner ember" style="margin:0 0 12px;font-size:14px">You have ${usd(pf.cash)} in cash, so this would partly fill: about ${shs(Math.floor(pf.cash / Market.price(r.sym) * 1000) / 1000)} of ${shs(r.shares)} shares.</div>` : ''; })()}
    <p class="hint" style="margin:0 0 12px">${DISCLOSE}</p>
    <div class="acts">${ui.tour != null ? `<button class="btn ember" disabled>Approve</button><button class="btn ghost" disabled>Decline</button><span class="hint">In the app, the member decides here.</span>` : Store.canWrite ? `<button class="btn ember" data-act="approve" data-id="${r.id}">${isOpen ? 'Approve for the open' : 'Approve'}${(ui.copyFrac[r.id] || 1) < 1 ? ' half' : ''}</button><button class="btn ghost" data-act="decline" data-id="${r.id}">Decline</button>` : '<span class="muted small">View-only</span>'}</div>
  </div></article>`;
}

function groupRow(g){
  const ms = Store.membersOf(g.id), my = Store.membership(g.id);
  const lead = Store.get('portfolios', g.leadPid); const ret = lead ? Store.portfolioValue(lead) / (lead.startValue || Store.START_CASH) - 1 : 0;
  const st = stackOf(ms.filter(m => m.role !== 'observer').map(m => m.pid)), gs = groupStats(g.id);
  return `<a class="row" href="#/group/${g.id}"><div class="avatar" style="background:${AV[Market.hash(g.id) % AV.length]};border-radius:12px">${esc(g.name.slice(0, 1))}</div>
    <div class="grow"><div class="ellip" style="font-weight:600">${esc(g.name)}${g.featured ? ' <span class="tag ember" style="font-size:10px;padding:1px 6px;vertical-align:2px">Featured</span>' : ''}</div>
      <div class="small muted ellip" style="display:flex;gap:8px;align-items:center;margin-top:3px">${st.html}<span class="ellip">${esc(st.label)}${gs.week ? ', ' + gs.week + ' trade' + (gs.week === 1 ? '' : 's') + ' this week' : ''}</span></div></div>
    <div class="r"><div class="small num ${g.pooled ? '' : sgn(ret)}">${g.pooled ? 'Pooled' : pct(ret)}</div><div class="small muted">${my ? esc(Store.ROLE_LABEL[my.role]) : (g.membership === 'invite' ? 'Invite only' : 'Open')}</div></div></a>`;
}

function vGroups(){
  const mine = Store.myGroups(); const mineIds = new Set(mine.map(g => g.id));
  const others = Store.all('groups').filter(g => !mineIds.has(g.id) && !Store.rulesOf(g).hidden).sort((a, b) => Store.membersOf(b.id).length - Store.membersOf(a.id).length);
  return `<div class="pagehead"><div><h1>Groups</h1><p class="muted">Invest with a group: vote on strategy and copy its Lead Trader, trade by trade.</p></div>${Store.canWrite && Store.get('profiles', Store.myPid) ? `<button class="btn" data-act="newgroup">Create group</button>` : ''}</div>
  ${mine.length ? `<section class="block" style="margin-top:0"><header><h2>Your groups</h2></header><div class="list">${mine.map(groupRow).join('')}</div></section>` : ''}
  ${(() => { const rp = (Store.get('profiles', Store.myPid) || {}).riskProfile; const sug = rp ? others.filter(g => g.riskLevel === rp) : []; return sug.length ? `<section class="block"><header><h2>Suggested for your style</h2><span class="tag">${esc(RISK[rp][0])}</span></header><div class="list">${sug.map(groupRow).join('')}</div></section>` : ''; })()}
  ${(() => { const fe = others.filter(g => g.featured); return fe.length ? `<section class="block"><header><h2>Featured groups</h2><span class="muted small">Chosen by the Pocket team</span></header><div class="list">${fe.map(groupRow).join('')}</div></section>` : ''; })()}
  <section class="block"><header><h2>Discover</h2></header>
    <div class="chips">${[['all','All']].concat(CATS).map(([k, l]) => `<button class="${(ui.groupCat || 'all') === k ? 'on' : ''}" data-act="gcat" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="list">${others.filter(g => (ui.groupCat || 'all') === 'all' || g.category === ui.groupCat).map(groupRow).join('') || '<div class="empty">No groups in this category yet. Start one.</div>'}</div></section>`;
}

function vGroup(gid, tab){
  const g = Store.get('groups', gid); if (!g) return `<div class="empty">This group doesn't exist. <a href="#/groups">See all groups</a></div>`;
  tab = tab || 'activity';
  const my = Store.membership(gid), role = my && my.role, ms = Store.membersOf(gid);
  const hasMe = !!Store.get('profiles', Store.myPid);
  const head = `<div class="pagehead"><div><a href="#/groups" class="small">← Groups</a><h1 style="margin-top:6px">${esc(g.name)}</h1>
      <p class="muted" style="max-width:62ch">${esc(g.description || '')}</p>
      ${g.goals ? `<p class="small" style="max-width:62ch;margin:6px 0 0"><b>Our goal:</b> ${esc(g.goals)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${g.category ? `<span class="tag">${esc((CATS.find(c => c[0] === g.category) || [0, ''])[1])}</span>` : ''}${g.strategy ? `<span class="tag">${esc(g.strategy)}</span>` : ''}<span class="tag">Lead Trader: ${esc(Store.displayName(g.leadPid))}</span>${role ? `<span class="tag blue">You: ${esc(Store.ROLE_LABEL[role])}</span>` : ''}${g.pooled ? '<span class="tag ember">Pooled practice club</span>' : ''}</div>
      ${(() => { const st = stackOf(ms.filter(m => m.role !== 'observer').map(m => m.pid), 5), gs = groupStats(gid); return `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:14px" class="small">${st.html}<span><b class="num">${ms.length}</b> ${ms.length === 1 ? 'member' : 'members'}</span><span><b class="num">${gs.trades}</b> trades this month</span>${gs.approval != null ? `<span><b class="num">${Math.round(gs.approval * 100)}%</b> of trade requests copied</span>` : ''}</div>`; })()}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${joinButton(g, role, hasMe)}
      ${role === 'observer' && !Store.isPro() && Store.canWrite ? `<button class="btn" data-act="join" data-id="${gid}">Become a full member</button>` : ''}
      ${role && Store.canTradeFor(role) && Store.canWrite && !g.pooled ? `<button class="btn ember" data-act="trade" data-gid="${gid}">Trade for the group</button>` : ''}
      ${role === 'junior' && Store.canWrite ? `<button class="btn ember" data-act="suggest" data-id="${gid}">Suggest a trade</button>` : ''}
      ${role && role !== 'observer' && g.leadPid !== Store.myPid && Store.canWrite && !g.pooled ? `<button class="btn ghost sm" data-act="copyonce" data-gid="${gid}">Catch up: copy current holdings</button>` : ''}
      ${role && Store.canWrite ? `<button class="btn ghost sm" data-act="invite" data-id="${gid}">Invite friends</button>` : ''}
      ${hasMe && Store.canWrite && role !== 'owner' ? `<button class="linkbtn small muted" data-act="report" data-id="${gid}">Report this group</button>` : ''}
      ${Store.canEdit && Store.canWrite ? `<button class="btn ghost sm" data-act="feature" data-id="${gid}" data-k="${g.featured ? '0' : '1'}">${g.featured ? 'Remove from Featured' : 'Feature in Discover'}</button>` : ''}</div></div>`;
  const tabs = `<nav class="tabs">${[['activity','Activity'],['performance','Performance'],['proposals','Proposals'],['ideas','Ideas'],['meetings','Meetings'],['members','Members']].concat(role && role !== 'observer' ? [['club', 'Club books' + ((clubWaiting().find(w => w.gid === gid) || {}).count ? ' (' + clubWaiting().find(w => w.gid === gid).count + ')' : '')]] : []).concat([['rules', Store.canManage(role) ? 'Settings' : 'Rules']]).map(([k, l]) => `<a class="${tab === k ? 'on' : ''}" href="#/group/${gid}/${k}">${l}</a>`).join('')}</nav>`;
  let body = '';
  if (tab === 'activity'){
    const mine = Store.myPending().filter(r => r.gid === gid);
    const items = groupItems([gid]);
    const pin = g.pinned && g.pinned.text ? `<div class="banner" style="margin-bottom:14px;align-items:flex-start"><div style="flex:1"><b>Pinned by ${esc(Store.displayName(g.pinned.by))}</b> <span class="muted small">${ago(g.pinned.ts)} ago</span><div class="small" style="margin-top:4px;white-space:pre-wrap">${esc(g.pinned.text)}</div></div>${Store.canManage(role) && Store.canWrite ? `<button class="btn sm ghost" data-act="pin" data-id="${gid}">Edit</button>` : ''}</div>`
      : (Store.canManage(role) && Store.canWrite ? `<p style="margin:0 0 12px"><button class="btn sm ghost" data-act="pin" data-id="${gid}">Pin an announcement</button></p>` : '');
    body = `${pin}${reviewCards(g, role)}${suggestionCards(g, role)}${mine.map(approvalCard).join('')}${mine.length ? '<div style="height:16px"></div>' : ''}
      <div class="list">${role ? composer('g:' + gid, 'Post to the group', 'gpost', `data-gid="${gid}"`) : ''}${items.slice(0, ui.feedLimit).map(it => renderItem(it, false)).join('') || '<div class="empty">No group activity yet.</div>'}</div>${items.length > ui.feedLimit ? '<p style="text-align:center;margin-top:14px"><button class="btn ghost" data-act="more">Show more</button></p>' : ''}`;
  } else if (tab === 'performance'){
    body = trackRecord('group', gid) + (g.pooled ? '<p class="hint">A pooled club trades one shared account, so there are no copies to compare.</p>' : `<div style="height:16px"></div>` + perfView(gid, role));
  } else if (tab === 'ideas'){
    body = ideasView(g, role);
  } else if (tab === 'meetings'){
    body = meetingsView(g, role);
  } else if (tab === 'club'){
    body = role && role !== 'observer' ? clubView(gid, role) : '<div class="panel empty">Club books are for full members of this group.</div>';
  } else if (tab === 'rules'){
    body = rulesView(g, role);
  } else if (tab === 'proposals'){
    const prs = Store.all('proposals').filter(p => p.gid === gid).sort((a, b) => { const ta = Store.tally(a.id), tb = Store.tally(b.id); return (ta.closed - tb.closed) || b.createdTs - a.createdTs; });
    const R = Store.rulesOf(g);
    body = `<p class="hint" style="margin-top:0">${R.quorum ? `Quorum: ${Math.round(R.quorum * 100)}% of members must vote. ` : ''}Passes with ${R.passRule === 'two-thirds' ? 'two-thirds' : 'a majority'} of yes and no votes.${R.voteWaitDays ? ` New members can vote after ${R.voteWaitDays} days.` : ''}</p>
      ${role && Store.canPropose(role, R) && Store.canWrite ? `<div style="margin-bottom:14px"><button class="btn" data-act="newprop" data-gid="${gid}">New proposal</button></div>` : role ? `<p class="hint">${R.proposeRoles.map(x => Store.ROLE_LABEL[x]).join(', ')} can create proposals. Members vote.</p>` : ''}
      <div class="list">${prs.map(p => proposalCard(p, role)).join('') || '<div class="empty">No proposals yet.</div>'}</div>`;
  } else {
    const order = ['owner','admin','lead','treasurer','asstTreasurer','member','observer'];
    body = `${role ? `<div class="panel" style="padding:16px 18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>Your copy size</b><div class="small muted">Share of your capital used when sizing the group's trades for you.</div></div><div class="seg">${[0.5, 1].map(x => `<button class="${(my.copyPct ?? 1) === x ? 'on' : ''}" data-act="copypct" data-gid="${gid}" data-k="${x}">${x * 100}%</button>`).join('')}</div></div>` : ''}
      ${(() => { const jr = Store.all('joinRequests').filter(j => j.gid === gid && j.status === 'pending'); return Store.canManage(role) && jr.length ? `<section style="margin-bottom:16px"><header class="pagehead" style="margin:0 0 10px"><h3>Requests to join</h3></header><div class="list">${jr.map(j => `<div class="row">${avatar(j.pid)}<div class="grow">${nameLink(j.pid)}<div class="small muted">Asked ${ago(j.ts)} ago</div></div><button class="btn sm" data-act="joinyes" data-id="${j.id}">Approve</button><button class="btn sm ghost" data-act="joinno" data-id="${j.id}">Decline</button></div>`).join('')}</div></section>` : ''; })()}
      <div class="list">${ms.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).map(m => `<div class="row">${avatar(m.pid)}<div class="grow">${nameLink(m.pid)}<div class="small muted">Joined ${ago(m.joinedTs)} ago${(Store.canManage(role) || role === 'treasurer') && m.role !== 'observer' ? participation(gid, m) : ''}${m.invitedBy ? ' from ' + esc(Store.displayName(m.invitedBy)) + "'s invite" : ''}</div></div>
        ${Store.canManage(role) && m.role !== 'owner' && m.pid !== Store.myPid && Store.canWrite ? `<select class="input" style="width:auto;padding:7px 10px;font-size:14px" data-act="role" data-gid="${gid}" data-pid="${m.pid}" aria-label="Role">${['admin','lead','junior','analyst','risk','moderator','treasurer','asstTreasurer','member','observer'].filter(r => !(Store.get('groups', gid).pooled && (VOTED_ROLES.includes(r) || VOTED_ROLES.includes(m.role)) && r !== m.role)).map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${Store.ROLE_LABEL[r]}</option>`).join('')}</select>${Store.get('groups', gid).pooled ? `<button class="btn sm ghost" data-act="potexit" data-gid="${gid}" data-pid="${m.pid}" aria-label="Exit payout for ${esc(Store.displayName(m.pid))}">Exit payout</button>` : `<button class="btn sm ghost" data-act="rmmember" data-gid="${gid}" data-pid="${m.pid}" aria-label="Remove ${esc(Store.displayName(m.pid))}">Remove</button>`}` : `<span class="tag ${['lead','risk'].includes(m.role) ? 'ember' : ['owner','admin'].includes(m.role) ? 'blue' : ''}">${Store.ROLE_LABEL[m.role]}</span>`}</div>`).join('')}</div>
      ${role === 'owner' && Store.canWrite && ms.length > 1 ? `<div class="panel" style="padding:16px 18px;margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>Transfer ownership</b><div class="small muted">You become an Admin. The new Owner needs Pro.</div></div><select class="input" id="xfer" style="width:auto">${ms.filter(m => m.pid !== Store.myPid).map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))}</option>`).join('')}</select><button class="btn sm ghost" data-act="xfer" data-gid="${gid}">Transfer</button></div>` : ''}
      <section class="block"><header><h2>What each role does</h2></header><div class="list">${Store.ROLE_INFO_KEYS.map(k => `<div class="row"><span class="tag" style="min-width:110px;justify-content:center">${Store.ROLE_LABEL[k]}</span><div class="grow small">${Store.ROLE_INFO[k]}</div></div>`).join('')}</div></section>
      ${role && role !== 'owner' && Store.canWrite ? `<p style="margin-top:16px"><button class="btn ghost sm" data-act="leave" data-id="${gid}">Leave group</button></p>` : ''}`;
  }
  return head + tabs + body;
}

function joinButton(g, role, hasMe){
  if (!hasMe || !Store.canWrite) return '';
  const R = Store.rulesOf(g);
  if (role === 'observer') return `<button class="btn" data-act="join" data-id="${g.id}">Become a full member</button>`;
  if (role) return '';
  if (R.joinMode === 'request'){ const jr = Store.get('joinRequests', g.id + '__' + Store.myPid); return jr ? `<span class="tag ember">${{ pending:'Request sent', declined:'Request declined', approved:'Request approved' }[jr.status]}</span>` : `<button class="btn" data-act="reqjoin" data-id="${g.id}">Request to join</button>`; }
  if (R.joinMode === 'invite' && ui.inviteFor !== g.id) return '<span class="tag">Invite only</span>';
  return `<button class="btn" data-act="join" data-id="${g.id}">Join group</button>`;
}

function reviewCards(g, role){
  let rvs = Store.all('reviews').filter(r => r.gid === g.id && r.status === 'pending').sort((a, b) => b.createdTs - a.createdTs);
  if (ui.tour != null && TOUR[ui.tour] && TOUR[ui.tour].sampleReview && !rvs.length && g.id === 'g_techmomentum') rvs = [tourReviewSample(g)];
  if (!rvs.length || !role) return '';
  if (ui.tour != null) return rvs.map(r => `<article class="approval" style="margin-bottom:12px"><div class="ring" data-ring data-exp="${r.expiresTs}" data-start="${r.createdTs}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="32" cy="32" r="27" fill="none" stroke="var(--ember)" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="0"/></svg><div class="t" data-cd>${left(r.expiresTs - Date.now())}</div></div>
    <div><span class="tag ember" style="margin-bottom:6px">Risk Manager review</span><h3>${esc(Store.displayName(r.leaderPid))} ${r.side === 'buy' ? 'bought' : 'sold'} ${shs(r.shares)} ${esc(r.sym)} at ${usd(r.price)}</h3>
    <p class="muted small" style="margin:4px 0 12px">Members don't see this trade yet. The Risk Manager releases it, or pauses it for a group vote. If nobody acts, it's released automatically when the timer ends.</p>
    <div class="acts"><button class="btn ember" disabled>Release to members</button><button class="btn ghost" disabled>Pause for a vote</button><span class="hint">Only the Risk Manager sees these buttons.</span></div></div></article>`).join('');
  return rvs.map(r => `<article class="approval" style="margin-bottom:12px"><div class="ring" data-ring data-exp="${r.expiresTs}" data-start="${r.createdTs}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="32" cy="32" r="27" fill="none" stroke="var(--ember)" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="0"/></svg><div class="t" data-cd>${left(r.expiresTs - Date.now())}</div></div>
    <div><span class="tag ember" style="margin-bottom:6px">Risk Manager review</span><h3>${esc(Store.displayName(r.leaderPid))} ${r.side === 'buy' ? 'bought' : 'sold'} ${shs(r.shares)} ${esc(r.sym)} at ${usd(r.price)}</h3>
    <p class="muted small" style="margin:4px 0 12px">${Store.canReview(role) ? 'Release it to members, or pause it for a group vote. If nobody acts, it is released automatically when the timer ends.' : 'The Risk Manager is reviewing this trade before members get approval requests.'}</p>
    ${Store.canReview(role) && Store.canWrite ? `<div class="acts"><button class="btn ember" data-act="rvrelease" data-id="${r.id}">Release to members</button><button class="btn ghost" data-act="rvpause" data-id="${r.id}">Pause for a vote</button></div>` : ''}</div></article>`).join('');
}

function rulesView(g, role){
  const R = Store.rulesOf(g), mg = Store.canManage(role) && Store.canWrite;
  const row = (a, b) => `<div class="row"><div class="grow muted">${a}</div><b style="text-align:right">${b}</b></div>`;
  const allowed = R.allowed === 'etf' ? 'ETFs only (SPY, QQQ, SCHD)' : R.allowed === 'list' ? R.allowedList.join(', ') : 'Any stock or ETF';
  return `${mg ? '<div style="margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="editrules" data-id="' + g.id + '">Edit settings</button><button class="btn ghost" data-act="invite" data-id="' + g.id + '">Invite link</button></div>' : ''}
  ${R.rulesText ? `<section class="block" style="margin-top:0"><header><h2>Group rules</h2></header><div class="panel" style="padding:16px 18px;white-space:pre-wrap">${esc(R.rulesText)}</div></section>` : ''}
  <section class="block"><header><h2>Joining</h2></header><div class="list">${row('How people join', { open:'Anyone can join', request:'Request to join, Owner or Admin approves', invite:'Invite link only' }[R.joinMode])}${row('Member limit', R.maxMembers ? R.maxMembers + ' members' : 'No limit')}${row('Minimum account value', R.minAccount ? usd(R.minAccount, 0) : 'None')}${row('Shown in Discover', R.hidden ? 'No, hidden' : 'Yes')}</div></section>
  <section class="block"><header><h2>Voting</h2></header><div class="list">${row('Who can propose', R.proposeRoles.map(x => Store.ROLE_LABEL[x]).join(', '))}${row('Quorum', R.quorum ? Math.round(R.quorum * 100) + '% of members' : 'None')}${row('To pass', R.passRule === 'two-thirds' ? 'Two-thirds of yes and no votes' : 'Majority of yes and no votes')}${row('Default voting period', R.votingDays + ' day' + (R.votingDays === 1 ? '' : 's'))}${row('New members can vote after', R.voteWaitDays ? R.voteWaitDays + ' days' : 'Right away')}</div></section>
  <section class="block"><header><h2>Trading</h2></header><div class="list">${row('Largest trade without a vote', R.maxPositionPct ? Math.round(R.maxPositionPct * 100) + '% of the portfolio' : 'No limit')}${row('Allowed investments', esc(allowed))}${row('Approval window', R.approvalMinutes + ' minutes')}${row('Risk Manager review', R.riskReview ? 'Every group trade' : 'Off')}${row('Starting copy size for new members', R.defaultCopyPct === 1 ? '100%' : '50%')}</div></section>
  <section class="block"><header><h2>Paid group</h2></header><div class="list">${row('Monthly member fee', '<span class="tag">Available after adviser registration</span>')}</div></section>`;
}

function groupTradeRow(p){
  const rvx = p.reviewId && Store.get('reviews', p.reviewId);
  const reqs = Store.all('copyRequests').filter(r => r.gid === p.groupId && r.leaderPid === p.pid && r.sym === p.trade.sym && (rvx ? r.tradeId === rvx.tradeId : Math.abs(r.createdTs - p.ts) < 120000));
  const st = reqs.map(r => Store.requestState(r));
  const filled = st.filter(s => s === 'filled' || s === 'queued').length, pending = st.filter(s => s === 'pending').length;
  const rv = p.reviewId && Store.get('reviews', p.reviewId);
  const rvNote = rv ? ({ pending:'<div class="banner" style="margin:8px 0;font-size:14px">Held for Risk Manager review. Members get approval requests once it is released.</div>', paused:'<div class="banner ember" style="margin:8px 0;font-size:14px">Paused by the Risk Manager for a group vote.</div>', blocked:'<div class="banner" style="margin:8px 0;font-size:14px">The group voted not to copy this trade.</div>', released: rv.how === 'vote' ? '<div class="small muted" style="margin-bottom:6px">Released after a group vote.</div>' : rv.how === 'auto' ? '<div class="small muted" style="margin-bottom:6px">Released automatically after 15 minutes.</div>' : '<div class="small muted" style="margin-bottom:6px">Released by the Risk Manager.</div>' }[rv.status] || '') : '';
  return `<article class="post"><div class="meta">${avatar(p.pid, 'sm')}<div class="grow">${nameLink(p.pid)} <span class="tag ember" style="margin-left:4px">Lead Trader</span> <span class="muted small">${ago(p.ts)}</span></div></div>
    ${p.text ? `<div class="body">${linkify(p.text)}</div>` : '<div style="height:10px"></div>'}
    <div class="chip"><span class="tag ${p.trade.side === 'buy' ? 'blue' : 'ember'}">${p.trade.side === 'buy' ? 'Bought' : 'Sold'}</span><a class="sym" href="#/stock/${esc(p.trade.sym)}">${esc(p.trade.sym)}</a><span class="num">${shs(p.trade.shares)} @ ${usd(p.trade.price)}</span></div>${rvNote}
    ${reqs.length ? `<div class="small"><b>${filled} of ${reqs.length}</b> members copied${pending ? `, <span style="color:var(--ember-ink)">${pending} still deciding</span>` : ''}</div>
    <div class="tally" style="height:6px"><div class="y" style="width:${filled / reqs.length * 100}%"></div><div style="width:${pending / reqs.length * 100}%;background:var(--ember)"></div></div>` : ''}</article>`;
}

/* group timeline: posts, Lead Trader trades and proposals, newest first */
function groupItems(gids){
  const set = new Set(gids);
  const posts = Store.all('posts').filter(p => set.has(p.groupId)).map(p => ({ ts: p.ts, kind: p.groupTrade ? 'trade' : 'post', p }));
  const props = Store.all('proposals').filter(p => set.has(p.gid)).map(p => ({ ts: p.createdTs, kind:'prop', p }));
  return posts.concat(props).sort((a, b) => b.ts - a.ts);
}

function proposalCard(p, role){
  const t = Store.tally(p.id); const tot = Math.max(1, t.cast);
  const TYPE = { trade:'Trade idea', strategy:'Strategy change', policy:'Policy change', role:'Role change', review:'Risk review' };
  const canV = Store.canVote(role) && !t.closed && Store.canWrite && !t.waitDays;
  return `<article class="post"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="tag">${TYPE[p.type] || 'Proposal'}</span>
      ${t.closed ? `<span class="tag ${t.result === 'passed' ? 'blue' : ''}">${t.result === 'passed' ? 'Passed' : 'Did not pass'}</span>` : `<span class="tag ember">${timeLeft(p.deadlineTs)}</span>`}</div>
    <h3 style="margin-top:10px">${esc(p.title)}</h3>${p.details ? `<div class="body">${linkify(p.details)}</div>` : ''}
    ${p.tradeSym ? `<div class="chip" style="display:inline-flex;gap:8px;align-items:center;padding:7px 11px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line);font-size:14px;margin:6px 0 8px"><span class="tag ${p.tradeSide === 'sell' ? 'ember' : 'blue'}">${p.tradeSide === 'sell' ? 'Sell' : 'Buy'}</span><a class="sym" href="#/stock/${esc(p.tradeSym)}">${esc(p.tradeSym)}</a><span class="num">${Math.round(p.tradePct * 1000) / 10}% of the portfolio</span></div>` : ''}
    <div class="small muted">Proposed by ${esc(Store.displayName(p.authorPid))}, ${ago(p.createdTs)} ago</div>
    <div class="tally"><div class="y" style="width:${t.yes / tot * 100}%"></div><div class="n" style="width:${t.no / tot * 100}%"></div><div class="a" style="width:${t.abstain / tot * 100}%"></div></div>
    <div class="small num"><span class="gain">${t.yes} yes</span> &nbsp; <span class="loss">${t.no} no</span> &nbsp; <span class="muted">${t.abstain} abstain — ${t.cast} of ${t.eligible} voted${t.rules.quorum ? (t.quorumMet ? ', quorum met' : `, quorum ${Math.round(t.rules.quorum * 100)}% not yet met`) : ''}</span></div>
    ${t.waitDays && !t.closed ? `<div class="small muted" style="margin-top:8px">You can vote in this group in ${t.waitDays} day${t.waitDays === 1 ? '' : 's'}.</div>` : ''}
    ${canV ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${['yes','no','abstain'].map(v => `<button class="btn sm ${t.mine === v ? '' : 'ghost'}" data-act="vote" data-id="${p.id}" data-k="${v}" aria-pressed="${t.mine === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
      ${Store.canManage(role) ? `<button class="btn sm ghost" data-act="closeprop" data-id="${p.id}" style="margin-left:auto">Close vote</button>` : ''}</div>` : (t.mine ? `<div class="small muted" style="margin-top:8px">You voted ${t.mine}.</div>` : '')}
    ${p.type === 'windDown' && t.closed && t.result === 'passed' ? (p.executed ? `<div class="banner" style="margin:12px 0 0"><div style="flex:1">The club is closing. See Club books.</div></div>` : Store.canTradeFor(role) && Store.canWrite ? `<div style="margin-top:12px"><button class="btn ember sm" data-act="execprop" data-id="${p.id}">Start closing the club</button></div>` : '<div class="small muted" style="margin-top:10px">Passed. Waiting for the Owner, an Admin or the Lead Trader to start closing the club.</div>') : ''}
    ${p.rolePid ? `<div class="small" style="margin-top:10px"><b>Role change:</b> ${esc(Store.displayName(p.rolePid))}, ${Store.ROLE_LABEL[p.roleFrom] || ''} → ${Store.ROLE_LABEL[p.roleName]}</div>` : ''}
    ${p.rolePid && t.closed && t.result === 'passed' ? (p.executed ? `<div class="banner" style="margin:12px 0 0"><div style="flex:1">Role change applied by ${esc(Store.displayName(p.executedBy))} ${ago(p.executedTs)} ago.</div></div>` : Store.canTradeFor(role) && Store.canWrite ? `<div style="margin-top:12px"><button class="btn ember sm" data-act="execprop" data-id="${p.id}">Apply the role change</button></div>` : `<div class="small muted" style="margin-top:10px">Passed. Waiting for the Owner, an Admin or the Lead Trader to apply it.</div>`) : ''}
    ${p.tradeSym && t.closed && t.result === 'passed' ? (p.executed ? `<div class="banner" style="margin:12px 0 0"><div style="flex:1">Executed by ${esc(Store.displayName(p.executedBy))} ${ago(p.executedTs)} ago. ${(Store.get('groups', p.gid) || {}).pooled ? 'Bought or sold in the club account.' : 'Members received approval requests.'}</div><a class="btn sm ghost" href="#/group/${p.gid}/activity">See trade</a></div>`
      : (Store.canTradeFor(role) && Store.canWrite ? `<div style="margin-top:12px"><button class="btn ember sm" data-act="execprop" data-id="${p.id}">Execute the group's decision</button><span class="hint" style="margin-left:10px">Places the trade and asks every member to approve</span></div>` : `<div class="small muted" style="margin-top:10px">Passed. Waiting for the Lead Trader to execute it.</div>`)) : ''}
  </article>`;
}

function inviteSheet(gid){
  const g = Store.get('groups', gid); const link = location.origin + '/j/' + (g.inviteCode || '') + (Store.myPid ? '/' + Store.myPid : '');
  const joined = Store.all('memberships').filter(m => m.gid === gid && m.invitedBy === Store.myPid);
  const mg = Store.canManage((Store.membership(gid) || {}).role);
  openModal(`<header><h2>Invite friends to ${esc(g.name)}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Anyone with this link can join${Store.rulesOf(g).joinMode === 'request' ? ' after an Owner or Admin approves them' : ''}. Friends who join from it are credited to you.</p>
    ${g.inviteOff ? `<div class="est" style="display:block"><b>This group's invite link is turned off.</b><div class="small muted" style="margin-top:4px">${mg ? 'Turn it back on to invite people.' : 'Ask an Owner or Admin to turn it back on.'}</div></div>` : `<div style="display:flex;gap:8px"><input class="input" id="iv-l" readonly value="${esc(link)}" aria-label="Invite link" style="font-size:14px"><button class="btn" id="iv-c">Copy</button></div>
    ${navigator.share ? '<button class="btn ghost" id="iv-s" style="width:100%;margin-top:10px">Share…</button>' : ''}`}
    <div class="est" style="margin-top:14px"><span>Joined from your invites</span><b class="num">${joined.length}</b></div>
    ${joined.length ? `<div class="list">${joined.map(m => `<div class="row">${avatar(m.pid, 'sm')}<div class="grow">${esc(Store.displayName(m.pid))}</div><span class="small muted">${ago(m.joinedTs)} ago</span></div>`).join('')}</div>` : ''}
    ${mg ? `<p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn sm ghost" id="iv-r">Reset the link</button><button class="btn sm ghost" id="iv-o">${g.inviteOff ? 'Turn the link on' : 'Turn the link off'}</button> <span class="hint">A reset gives a new link; old ones stop working.</span></p>` : ''}`, sh => {
    const s = sh.querySelector('#iv-s'); if (s) s.onclick = async () => { try { await navigator.share({ title: 'Join ' + g.name + ' on Pocket Investing', text: 'Join my investing group, ' + g.name + ', on Pocket Investing.', url: link }); } catch(e){} };
    const o = sh.querySelector('#iv-o'); if (o) o.onclick = async () => { try { await Store.setInviteLink(gid, !!g.inviteOff); closeModal(); toast(g.inviteOff ? 'Invite link turned on.' : 'Invite link turned off. It stops working right away.'); inviteSheet(gid); } catch(e){ errToast(e); } };
    if (!sh.querySelector('#iv-c')) return;
    sh.querySelector('#iv-c').onclick = async () => { const i = sh.querySelector('#iv-l'); i.select(); try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch(e){ try { document.execCommand('copy'); toast('Invite link copied.'); } catch(e2){ toast('Select the link and copy it.'); } } };
    const r = sh.querySelector('#iv-r'); if (r) r.onclick = async () => { try { await Store.newInviteCode(gid); closeModal(); toast('New invite link created.'); inviteSheet(gid); } catch(e){ errToast(e); } };
  });
}

function inviteRules(R){
  const out = [];
  out.push(R.proposeRoles.includes('member') ? 'Any member can propose trades and changes.' : 'The Owner, Admins, Lead Trader and Analysts propose trades and changes.');
  out.push(`Votes pass with a ${R.passRule === 'two-thirds' ? 'two-thirds' : 'simple'} majority${R.quorum ? `, with at least ${Math.round(R.quorum * 100)}% of members voting` : ''}.`);
  if (R.maxPositionPct) out.push(`No single stock above ${Math.round(R.maxPositionPct * 100)}% of the portfolio without a member vote.`);
  if (R.riskReview) out.push('A Risk Manager reviews trades before they reach members.');
  out.push(`You approve each copied trade${R.defaultCopyPct < 1 ? ', at half size by default,' : ''} within ${R.approvalMinutes} minutes. Nothing is copied without your approval.`);
  if (R.minAccount) out.push(`Minimum account value to join: ${usd(R.minAccount, 0)}.`);
  if (R.joinMode === 'request') out.push('An Owner or Admin approves new members.');
  return out;
}

function vInvite(code, by){
  ui.invitePrev = ui.invitePrev || {}; const P = ui.invitePrev[code];
  if (!P){ ui.invitePrev[code] = 'loading'; Store.http('GET', '/api/invite/' + encodeURIComponent(code)).then(r => { ui.invitePrev[code] = r; if (r.group) Store.inject('groups', r.group); render(); }, () => { ui.invitePrev[code] = { group: null }; render(); }); }
  if (!P || P === 'loading') return '<div class="loading" style="min-height:30vh">Opening the invite…</div>';
  const g = P.group ? Object.assign({}, Store.get('groups', P.group.id) || {}, P.group) : null;
  if (!g || g.inviteOff) return `<div class="panel empty" style="margin-top:24px">That invite link isn't valid anymore. Ask the person who sent it for a new one.</div>`;
  ui.inviteFor = g.id; ui.inviteCode = g.inviteCode; ui.inviteBy = by || null;
  try { localStorage.setItem('pi_src', JSON.stringify({ kind: 'group-invite', detail: g.id })); } catch(e){}
  const mine = Store.signedIn && Store.membership(g.id);
  if (mine && mine.role !== 'observer'){ setTimeout(() => { location.hash = '#/group/' + g.id; }, 0); return '<div class="loading">Opening the group…</div>'; }
  const R = Store.rulesOf(g), n = P.members, ret = P.leadReturn;
  const days = Math.max(1, Math.round((Date.now() - (g.createdTs || Date.now())) / 86400000));
  const back = '#/invite/' + g.inviteCode + (by ? '/' + by : '');
  const cta = !Store.signedIn ? `<button class="btn" data-act="invsignup" data-k="${esc(back)}" style="width:100%">Create a free account to join</button><p class="small" style="text-align:center;margin-top:10px">Already have an account? <button class="linkbtn" data-act="invsignin" data-k="${esc(back)}">Sign in</button></p>`
    : !Store.canWrite ? '' : R.joinMode === 'request' ? `<button class="btn" data-act="reqjoin" data-id="${g.id}" style="width:100%">Request to join</button>` : `<button class="btn" data-act="join" data-id="${g.id}" style="width:100%">Join ${esc(g.name)}</button>`;
  return `<div style="max-width:560px;margin:0 auto">
    <div class="panel" style="padding:24px"><p class="small muted" style="margin:0 0 6px">You're invited to join</p>
      <div style="display:flex;gap:12px;align-items:center"><div class="avatar" style="background:${AV[Market.hash(g.id) % AV.length]};border-radius:12px">${esc(g.name.slice(0, 1))}</div><h1 style="margin:0">${esc(g.name)}</h1></div>
      ${g.strategy ? `<p style="margin:12px 0 0"><b>${esc(g.strategy)}</b></p>` : ''}${g.description ? `<p class="muted" style="margin:6px 0 0">${esc(g.description)}</p>` : ''}
      <div class="kv" style="margin-top:16px"><div><span>Members</span><b>${n}</b></div><div><span>Started</span><b>${days} day${days === 1 ? '' : 's'} ago</b></div>${ret != null ? `<div><span>Lead Trader's portfolio since it started</span><b class="${sgn(ret)}">${pct(ret)}</b></div>` : ''}</div>
      ${(() => { const S = g.pooled ? null : statsFor('group', g.id); return S && !S.none ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${riskBadge(S)}${S.thin ? '' : `<span class="tag">Worst drop ${(S.maxDrawdown * 100).toFixed(1)}%</span>`}</div>` : ''; })()}
      <p class="hint" style="margin-top:8px">${Store.site.realMoney ? 'Practice-portfolio results. ' : 'Simulated money. '}Member names are shown once you join. Past results don't predict future returns.</p></div>
    <section class="block"><header><h2>How this group works</h2></header><div class="panel" style="padding:16px 20px"><ul style="margin:0;padding-left:20px;line-height:1.6">${inviteRules(R).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${R.rulesText ? `<details style="margin-top:10px"><summary>The Owner's group rules</summary><p style="white-space:pre-wrap" class="muted">${esc(R.rulesText)}</p></details>` : ''}</div></section>
    <div style="margin-top:18px">${cta}</div>
    <p class="hint" style="text-align:center;margin-top:14px">${esc(DISCLOSE)}</p></div>`;
}

function newInviteSheet(){
  openModal(`<header><h2>New invite code</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="ni-l">Label (who it's for)</label><input class="input" id="ni-l" maxlength="60" placeholder="e.g. Tony, or Investment club pilot"></div>
    <div class="grid2"><div class="field"><label for="ni-m">Uses allowed</label><input class="input" id="ni-m" type="number" min="1" placeholder="Unlimited"></div><div class="field"><label for="ni-c">Custom code (optional)</label><input class="input" id="ni-c" maxlength="16" autocapitalize="characters" placeholder="Auto"></div></div>
    <button class="btn" id="ni-go" style="width:100%">Create code</button>`, sh => {
    sh.querySelector('#ni-go').onclick = async () => { try { const r = await Store.http('POST', '/api/admin/invite', { label: sh.querySelector('#ni-l').value, maxUses: sh.querySelector('#ni-m').value, custom: sh.querySelector('#ni-c').value }); closeModal(); toast('Invite code ' + r.code + ' created.'); await loadAdmin(); } catch(e){ errToast(e); } };
  });
}

function groupSheet(){
  openModal(`<header><h2>Create a group</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label>Start from</label><div class="tplgrid" role="radiogroup">${GROUP_TEMPLATES.map(([k, l, d], i) => `<button type="button" class="tpl${i === 0 ? ' on' : ''}" role="radio" aria-checked="${i === 0}" data-tpl="${k}"><b>${l}</b><span class="small muted">${d}</span></button>`).join('')}</div>
      <div class="est" id="g-tplsum" style="display:block;margin-top:10px"></div></div>
    <div class="field"><label for="g-n">Group name</label><input class="input" id="g-n" maxlength="60" placeholder="e.g. Sunday Stock Club"></div>
    <div class="field"><label for="g-s">Strategy</label><input class="input" id="g-s" maxlength="120" placeholder="e.g. Long-term dividend growth"></div>
    <div class="field"><label for="g-d">Description</label><textarea class="input" id="g-d" maxlength="300" placeholder="What the group invests in and how it decides"></textarea></div>
    <div class="grid2"><div class="field"><label for="g-c">Category</label><select class="input" id="g-c">${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div><div class="field"><label for="g-goal">Group goal (optional)</label><input class="input" id="g-goal" maxlength="300" placeholder="e.g. Grow dividend income every year"></div></div>
    <div class="field"><label for="g-m">Who can join</label><select class="input" id="g-m"><option value="open">Anyone</option><option value="request">Request to join, I approve</option><option value="invite">Invite link only</option></select><span class="hint">You can set rules, limits and roles in the group's Settings tab.</span></div>
    <div class="est" style="display:block"><b>Group Pro: $19.99 a month per group</b><div class="small muted" style="margin-top:4px">Roles, voting, approval-based copying and member management. Simulated here; nothing is charged.</div></div>
    <p class="hint">You'll be the Owner and Lead Trader. Members copy your trades only when they approve each one.</p>
    <button class="btn" id="g-go" style="width:100%">Start Group Pro and create group</button>`, sh => {
    let tpl = 'club';
    const pickTpl = k => { tpl = k; const T = GROUP_TEMPLATES.find(x => x[0] === k);
      sh.querySelectorAll('[data-tpl]').forEach(b => { const on = b.dataset.tpl === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      sh.querySelector('#g-m').value = T[3]; sh.querySelector('#g-tplsum').innerHTML = `<b>${T[1]} rules</b><ul style="margin:6px 0 0;padding-left:18px" class="small">${T[4].map(x => `<li>${x}</li>`).join('')}</ul><div class="small muted" style="margin-top:6px">You can change any of these later in Settings.</div>`; };
    sh.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => pickTpl(b.dataset.tpl)); pickTpl('club');
    sh.querySelector('#g-go').onclick = async () => {
      try { const id = await Store.createGroup({ template: tpl, name: sh.querySelector('#g-n').value, strategy: sh.querySelector('#g-s').value, description: sh.querySelector('#g-d').value, membership: sh.querySelector('#g-m').value, category: sh.querySelector('#g-c').value, goals: sh.querySelector('#g-goal').value });
        closeModal(); toast('Group created.'); location.hash = '#/group/' + id; } catch(e){ errToast(e); }
    };
  });
}

function proposalSheet(gid, presym){
  openModal(`<header><h2>New proposal</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="p-t">Type</label><select class="input" id="p-t"><option value="trade">Trade idea</option><option value="strategy">Strategy change</option><option value="policy">Policy change</option><option value="role">Role change</option>${(Store.get('groups', gid) || {}).pooled ? '<option value="windDown">Close the club</option>' : ''}</select></div>
    <div id="p-trade" class="grid2"><div class="field"><label for="p-sym">Stock</label><select class="input" id="p-sym">${Market.LIST.map(t => `<option value="${t.s}">${t.s} — ${esc(t.n)}</option>`).join('')}</select></div>
      <div class="field"><label for="p-side">Action</label><select class="input" id="p-side"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
      <div class="field"><label for="p-pct">Size (% of the portfolio)</label><select class="input" id="p-pct"><option value="0.02">2%</option><option value="0.05" selected>5%</option><option value="0.1">10%</option></select></div></div>
    <div id="p-role" class="grid2" style="display:none"><div class="field"><label for="p-rpid">Member</label><select class="input" id="p-rpid">${Store.membersOf(gid).map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))} (${Store.ROLE_LABEL[m.role]})</option>`).join('')}</select></div>
      <div class="field"><label for="p-rname">New role</label><select class="input" id="p-rname">${['owner','admin','lead','junior','analyst','risk','moderator','treasurer','asstTreasurer','member','observer'].map(r => `<option value="${r}">${Store.ROLE_LABEL[r]}</option>`).join('')}</select></div></div>
    <div class="field"><label for="p-title">Title</label><input class="input" id="p-title" maxlength="120" placeholder="e.g. Add $COST at 5% of the portfolio"></div>
    <div class="field"><label for="p-d">Details</label><textarea class="input" id="p-d" maxlength="800" placeholder="The case for it, and what happens if it passes"></textarea></div>
    <div class="field"><label for="p-days">Voting period</label><select class="input" id="p-days"><option value="1">1 day</option><option value="3" selected>3 days</option><option value="7">7 days</option></select></div>
    <button class="btn" id="p-go" style="width:100%">Open voting</button>`, sh => {
    const tSel = sh.querySelector('#p-t'), syncT = () => { sh.querySelector('#p-trade').style.display = tSel.value === 'trade' ? '' : 'none'; sh.querySelector('#p-role').style.display = tSel.value === 'role' ? '' : 'none'; }; tSel.onchange = syncT; syncT();
    if (presym && sh.querySelector('#p-sym')){ sh.querySelector('#p-sym').value = presym; const ti = sh.querySelector('#p-title'); if (ti && !ti.value) ti.value = 'Buy $' + presym; }
    sh.querySelector('#p-go').onclick = async () => {
      try { await Store.propose(gid, { type: tSel.value, title: sh.querySelector('#p-title').value, details: sh.querySelector('#p-d').value, days: sh.querySelector('#p-days').value, sym: sh.querySelector('#p-sym').value, side: sh.querySelector('#p-side').value, pct: sh.querySelector('#p-pct').value, rolePid: tSel.value === 'role' ? sh.querySelector('#p-rpid').value : undefined, roleName: tSel.value === 'role' ? sh.querySelector('#p-rname').value : undefined });
        closeModal(); toast('Voting is open.'); } catch(e){ errToast(e); }
    };
  });
}

function pinSheet(gid){
  const g = Store.get('groups', gid);
  openModal(`<header><h2>Pinned announcement</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Shown at the top of the group's Activity tab. Leave it empty to remove it.</p>
    <div class="field"><label for="pn-t" class="sr">Announcement</label><textarea class="input" id="pn-t" maxlength="400" style="min-height:110px">${esc((g.pinned && g.pinned.text) || '')}</textarea></div>
    <button class="btn" id="pn-go" style="width:100%">Save</button>`, sh => {
    sh.querySelector('#pn-go').onclick = async () => { try { await Store.setPinned(gid, sh.querySelector('#pn-t').value); closeModal(); toast('Announcement saved.'); } catch(e){ errToast(e); } };
  });
}

function rulesAcceptHTML(g){ const R = Store.rulesOf(g); return R.rulesText ? `<div class="panel" style="padding:14px 16px;margin-bottom:12px;max-height:180px;overflow:auto;white-space:pre-wrap;font-size:14px">${esc(R.rulesText)}</div><label style="display:flex;gap:10px;align-items:center;margin-bottom:14px"><input type="checkbox" id="j-rules"> I agree to the group's rules</label>` : ''; }

function joinExtras(sh, g){ const c = sh.querySelector('#j-rules'); return { acceptRules: c ? c.checked : true, code: ui.inviteFor === g.id ? ui.inviteCode : undefined, by: ui.inviteFor === g.id ? ui.inviteBy : undefined }; }

function reqJoinSheet(gid){
  const g = Store.get('groups', gid);
  openModal(`<header><h2>Request to join ${esc(g.name)}</h2><button class="x" data-close aria-label="Close">×</button></header><p class="muted" style="margin-top:0">The Owner or an Admin reviews each request.</p>${rulesAcceptHTML(g)}<button class="btn" id="rq-go" style="width:100%">Send request</button>`, sh => {
    sh.querySelector('#rq-go').onclick = async () => { try { await Store.requestJoin(gid, joinExtras(sh, g).acceptRules); closeModal(); toast('Request sent. The owner decides who joins.'); } catch(e){ errToast(e); } };
  });
}

function joinSheet(gid){
  const g = Store.get('groups', gid); const my = Store.membership(gid);
  openModal(`<header><h2>Join ${esc(g.name)}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="list" style="margin-bottom:16px">
      <div class="row"><div class="grow"><b>Full member with Pro</b><div class="small muted">Vote on proposals and copy the Lead Trader's trades with your approval. $9.99 a month.</div></div></div>
      <div class="row"><div class="grow"><b>Observer, free</b><div class="small muted">Follow the group's trades and discussion without voting or copying.</div></div></div></div>
    ${my ? '' : rulesAcceptHTML(g)}${Store.isPro() ? '' : wouldPayHTML()}<button class="btn" id="j-pro" style="width:100%">${Store.isPro() ? 'Join as a member' : 'Start Pro and join as a member'}</button>
    ${my ? '' : `<button class="btn ghost" id="j-obs" style="width:100%;margin-top:10px">Join as an observer</button>`}
    <p class="hint" style="text-align:center;margin-top:10px">Simulated subscription for this demo. Nothing is charged.</p>`, sh => {
    const wp = wireWouldPay(sh);
    sh.querySelector('#j-pro').onclick = async () => { try { const x = joinExtras(sh, g); if (!x.acceptRules) throw Object.assign(new Error("Please accept the group's rules to join."), { userFacing: true }); if (!Store.isPro()) await Store.upgradePro(wp()); await Store.join(gid, 'member', x); closeModal(); toast("You're on Pro and joined as a member. Group trades will ask for your approval."); } catch(e){ errToast(e); } };
    const o = sh.querySelector('#j-obs'); if (o) o.onclick = async () => { try { const x = joinExtras(sh, g); if (!x.acceptRules) throw Object.assign(new Error("Please accept the group's rules to join."), { userFacing: true }); await Store.join(gid, 'observer', x); closeModal(); toast('You joined as an observer.'); } catch(e){ errToast(e); } };
  });
}

function reportSheet(gid){
  const g = Store.get('groups', gid);
  openModal(`<header><h2>Report ${esc(g.name)}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="r-r">What's the problem?</label><select class="input" id="r-r"><option value="coordinated">Coordinated buying or selling to move a price</option><option value="misleading">Misleading performance claims</option><option value="spam">Spam or promotion</option><option value="other">Something else</option></select></div>
    <div class="field"><label for="r-d">Details (optional)</label><textarea class="input" id="r-d" maxlength="500" placeholder="What did you see, and when?"></textarea></div>
    <button class="btn" id="r-go" style="width:100%">Send report</button>
    <p class="hint" style="text-align:center;margin-top:10px">The trust and safety team reviews every report. The group isn't told who reported it.</p>`, sh => {
    sh.querySelector('#r-go').onclick = async () => { try { await Store.report(gid, sh.querySelector('#r-r').value, sh.querySelector('#r-d').value); closeModal(); toast('Report sent to the trust and safety team.'); } catch(e){ errToast(e); } };
  });
}

function rulesSheet(gid){
  const g = Store.get('groups', gid), R = Store.rulesOf(g);
  const opt = (v, cur, l) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
  const roleChecks = ['admin','lead','junior','analyst','risk','moderator','member'].map(k => `<label style="display:inline-flex;gap:6px;align-items:center;margin:0 14px 8px 0"><input type="checkbox" class="pr-role" value="${k}" ${R.proposeRoles.includes(k) ? 'checked' : ''}> ${Store.ROLE_LABEL[k]}</label>`).join('');
  openModal(`<header><h2>Group settings</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="s-n">Name</label><input class="input" id="s-n" maxlength="60" value="${esc(g.name)}"></div>
    <div class="field"><label for="s-st">Strategy</label><input class="input" id="s-st" maxlength="120" value="${esc(g.strategy || '')}"></div>
    <div class="field"><label for="s-d">Description</label><textarea class="input" id="s-d" maxlength="300">${esc(g.description || '')}</textarea></div>
    <div class="grid2"><div class="field"><label for="s-cat">Category</label><select class="input" id="s-cat">${CATS.map(([k, l]) => `<option value="${k}" ${g.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field"><label for="s-goal">Group goal</label><input class="input" id="s-goal" maxlength="300" value="${esc(g.goals || '')}"></div></div>
    <h3 style="margin:18px 0 10px">Joining</h3>
    <div class="grid2"><div class="field"><label for="s-jm">How people join</label><select class="input" id="s-jm">${opt('open', R.joinMode, 'Anyone can join')}${opt('request', R.joinMode, 'Request, then approval')}${opt('invite', R.joinMode, 'Invite link only')}</select></div>
      <div class="field"><label for="s-mx">Member limit</label><input class="input" id="s-mx" type="number" min="2" placeholder="No limit" value="${R.maxMembers || ''}"></div>
      <div class="field"><label for="s-min">Minimum account value ($)</label><input class="input" id="s-min" type="number" min="0" step="500" value="${R.minAccount || 0}"></div>
      <div class="field"><label for="s-hid">Shown in Discover</label><select class="input" id="s-hid">${opt('false', R.hidden, 'Yes')}${opt('true', R.hidden, 'No, hidden')}</select></div></div>
    <div class="field"><label for="s-rt">Group rules members accept when joining</label><textarea class="input" id="s-rt" maxlength="2000" placeholder="Optional">${esc(R.rulesText || '')}</textarea></div>
    <h3 style="margin:18px 0 10px">Voting</h3>
    <div class="field"><label>Who can propose (Owners always can)</label><div>${roleChecks}</div></div>
    <div class="grid2"><div class="field"><label for="s-q">Quorum</label><select class="input" id="s-q">${[0, 0.25, 0.5, 0.6, 0.75].map(v => opt(v, R.quorum, v ? Math.round(v * 100) + '% of members' : 'None')).join('')}</select></div>
      <div class="field"><label for="s-pr">To pass</label><select class="input" id="s-pr">${opt('majority', R.passRule, 'Majority')}${opt('two-thirds', R.passRule, 'Two-thirds')}</select></div>
      <div class="field"><label for="s-vd">Default voting period</label><select class="input" id="s-vd">${[1, 3, 5, 7].map(v => opt(v, R.votingDays, v + ' day' + (v === 1 ? '' : 's'))).join('')}</select></div>
      <div class="field"><label for="s-vw">New members can vote after</label><select class="input" id="s-vw">${[0, 7, 14, 30].map(v => opt(v, R.voteWaitDays, v ? v + ' days' : 'Right away')).join('')}</select></div></div>
    <h3 style="margin:18px 0 10px">Trading</h3>
    <div class="grid2"><div class="field"><label for="s-mp">Largest trade without a vote</label><select class="input" id="s-mp">${opt('', R.maxPositionPct || '', 'No limit')}${[0.05, 0.1, 0.15, 0.2, 0.25].map(v => opt(v, R.maxPositionPct, Math.round(v * 100) + '% of the portfolio')).join('')}</select></div>
      <div class="field"><label for="s-al">Allowed investments</label><select class="input" id="s-al">${opt('any', R.allowed, 'Any stock or ETF')}${opt('etf', R.allowed, 'ETFs only')}${opt('list', R.allowed, 'A set list')}</select></div>
      <div class="field"><label for="s-aw">Approval window</label><select class="input" id="s-aw">${[15, 30, 60].map(v => opt(v, R.approvalMinutes, v + ' minutes')).join('')}</select></div>
      <div class="field"><label for="s-rr">Risk Manager review</label><select class="input" id="s-rr">${opt('false', R.riskReview, 'Off')}${opt('true', R.riskReview, 'Every group trade')}</select><span class="hint">Needs a member with the Risk Manager role.</span></div>
      <div class="field"><label for="s-cp">Starting copy size for new members</label><select class="input" id="s-cp">${opt(1, R.defaultCopyPct, '100%')}${opt(0.5, R.defaultCopyPct, '50%')}</select></div></div>
    <div class="field" id="s-list-f"><label>Allowed list</label><div style="display:flex;flex-wrap:wrap">${Market.LIST.map(t => `<label style="display:inline-flex;gap:6px;align-items:center;margin:0 14px 8px 0"><input type="checkbox" class="al-sym" value="${t.s}" ${R.allowedList.includes(t.s) ? 'checked' : ''}> ${t.s}</label>`).join('')}</div></div>
    <h3 style="margin:18px 0 10px">Paid group</h3><p class="hint" style="margin-top:0">Monthly member fees are available after adviser registration.</p>
    <div class="hint" id="s-err" style="color:var(--loss);min-height:1.2em"></div>
    <button class="btn" id="s-go" style="width:100%">Save settings</button>`, sh => {
    const q = id => sh.querySelector('#' + id); const syncL = () => q('s-list-f').style.display = q('s-al').value === 'list' ? '' : 'none'; q('s-al').onchange = syncL; syncL();
    q('s-go').onclick = async () => {
      const mx = q('s-mx').value.trim(), mp = q('s-mp').value;
      const rules = { joinMode: q('s-jm').value, maxMembers: mx ? Math.round(Number(mx)) : null, minAccount: Math.max(0, Number(q('s-min').value) || 0), hidden: q('s-hid').value === 'true', rulesText: q('s-rt').value,
        proposeRoles: ['owner'].concat($$('.pr-role', sh).filter(c => c.checked).map(c => c.value)), quorum: Number(q('s-q').value), passRule: q('s-pr').value, votingDays: Number(q('s-vd').value), voteWaitDays: Number(q('s-vw').value),
        maxPositionPct: mp ? Number(mp) : null, allowed: q('s-al').value, allowedList: $$('.al-sym', sh).filter(c => c.checked).map(c => c.value), approvalMinutes: Number(q('s-aw').value), riskReview: q('s-rr').value === 'true', defaultCopyPct: Number(q('s-cp').value) };
      if (rules.allowed === 'list' && !rules.allowedList.length){ q('s-err').textContent = 'Pick at least one allowed investment.'; return; }
      try { await Store.updateGroup(gid, { rules, name: q('s-n').value, strategy: q('s-st').value, description: q('s-d').value, category: q('s-cat').value, goals: q('s-goal').value }); closeModal(); toast('Group settings saved.'); } catch(e){ q('s-err').textContent = e.userFacing ? e.message : 'Something went wrong.'; }
    };
  });
}
