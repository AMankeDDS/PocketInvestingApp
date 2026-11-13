/* Inbox, notifications, the digest and push settings. */

function vInbox(){
  const all = Store.all('copyRequests').filter(r => r.memberPid === Store.myPid);
  let pend = all.filter(r => Store.requestState(r) === 'pending').sort((a, b) => b.createdTs - a.createdTs);
  if (ui.tour != null && !pend.length){ const t = tourSample(); if (t) pend = [t]; }
  const queued = all.filter(r => Store.requestState(r) === 'queued');
  const hist = all.filter(r => !['pending','queued'].includes(Store.requestState(r))).sort((a, b) => (b.decidedTs || b.createdTs) - (a.decidedTs || a.createdTs));
  return `<div class="pagehead"><div><h1>Approvals</h1><p class="muted">Group trades wait for your approval. Nothing executes in your account without it.</p></div></div>
  ${pend.map(approvalCard).join('') || `<div class="panel empty">No trades waiting. When a Lead Trader in one of your groups trades, it shows up here.</div>`}
  ${queued.length ? `<section class="block"><header><h2>Waiting for the open</h2><span class="small muted">You can cancel until the market opens</span></header><div class="list">${queued.map(approvalCard).join('')}</div></section>` : ''}
  ${hist.length ? `<section class="block"><header><h2>History</h2></header><div class="list">${hist.slice(0, 30).map(approvalCard).join('')}</div></section>` : ''}`;
}

function vNotifications(){
  if (!Store.get('profiles', Store.myPid)) return vOnboard();
  const seen = (Store.get('profiles', Store.myPid) || {}).notifSeenTs || 0;
  const list = Store.notifications();
  return `<div class="pagehead"><div><h1>Notifications</h1><p class="muted">Approvals, votes, followers and activity on your posts.</p></div></div>
  <div class="list">${list.map(n => `<a class="row" href="${n.href}"><span class="dot ${n.ts > seen ? 'on' : ''}" style="${n.ts > seen ? 'background:var(--ember);box-shadow:none' : 'opacity:.25'}"></span><div class="grow"><div>${esc(n.text)}</div><div class="small muted">${ago(n.ts)} ago</div></div></a>`).join('') || '<div class="empty">Nothing yet. Join a group or follow investors to see activity here.</div>'}</div>`;
}

function vDigest(){
  const me = Store.myPid, pf = Store.get('portfolios', me); if (!pf) return vOnboard();
  const week = Date.now() - 7 * 86400000, v = Store.portfolioValue(pf), v7 = Store.portfolioValue(pf, week), ch = v7 ? v / v7 - 1 : 0;
  const groups = Store.myGroups();
  const fol = new Set(Store.all('follows').filter(f => f.from === me).map(f => f.to));
  const top = Store.all('posts').filter(p => !p.groupId && fol.has(p.pid) && p.ts > week).map(p => [p, Store.all('reactions').filter(r => r.postId === p.id).length]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const fmt = ts => new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  return `<div class="pagehead"><div><a href="#/home" class="small">← Home</a><h1 style="margin-top:6px">Your week in Pocket</h1><p class="muted">${fmt(week)} to ${fmt(Date.now())}. Sent every Monday morning.</p></div></div>
  <div class="panel kv"><div><span>Portfolio value</span><b>${usd(v)}</b></div><div><span>This week</span><b class="${sgn(ch)}">${pct(ch)}</b></div><div><span>Waiting for approval</span><b>${Store.myPending().length}</b></div></div>
  ${groups.map(g => {
    const trades = Store.all('posts').filter(p => p.groupId === g.id && p.groupTrade && p.ts > week && p.pid !== me);
    const reqs = Store.all('copyRequests').filter(r => r.gid === g.id && r.memberPid === me && r.createdTs > week);
    const copied = reqs.filter(r => ['filled','queued'].includes(Store.requestState(r))).length;
    const open = Store.all('proposals').filter(p => p.gid === g.id && !Store.tally(p.id).closed);
    const needVote = open.filter(p => !Store.tally(p.id).mine && Store.canVote((Store.membership(g.id) || {}).role));
    const decided = Store.all('proposals').filter(p => p.gid === g.id && p.closedTs && p.closedTs > week);
    const P = Store.isPro() ? Store.performance(g.id) : null;
    return `<section class="block"><header><h2>${esc(g.name)}</h2><a class="small" href="#/group/${g.id}">Open group</a></header><div class="list">
      <div class="row"><div class="grow"><b>${trades.length} group trade${trades.length === 1 ? '' : 's'}</b><div class="small muted">You copied ${copied} of ${reqs.length || trades.length}</div></div>${P && P.rows.length ? `<div class="r small"><div>You <b class="num ${sgn(P.mineAvg)}">${pct(P.mineAvg)}</b></div><div class="muted">Lead Trader <span class="num">${pct(P.leadAvg)}</span></div></div>` : ''}</div>
      ${needVote.map(p => `<a class="row" href="#/group/${g.id}/proposals"><div class="grow"><b>Your vote is needed</b><div class="small muted ellip">${esc(p.title)}</div></div><span class="tag ember">${timeLeft(p.deadlineTs)}</span></a>`).join('')}
      ${decided.map(p => `<div class="row"><div class="grow"><b>Decided: ${p.status === 'passed' ? 'passed' : 'did not pass'}</b><div class="small muted ellip">${esc(p.title)}</div></div></div>`).join('')}
    </div></section>`; }).join('') || '<div class="panel empty" style="margin-top:16px">Join a group to see its weekly summary here.</div>'}
  ${top.length ? `<section class="block"><header><h2>Top posts from people you follow</h2></header><div class="list">${top.map(([p]) => postCard(p)).join('')}</div></section>` : ''}
  <p class="hint" style="margin-top:22px">${disclose()}</p>`;
}

function vNotifySettings(){
  if (!Store.signedIn) return vProfile(null);
  const p = Store.get('profiles', Store.myPid) || {}, n = p.notif || {};
  const q = n.quiet || { on:false, start:'22:00', end:'07:00' }, muted = new Set(n.mutedGroups || []);
  const ps = ui.pushState; if (ps === null){ ui.pushState = 'loading'; pushStatus().then(x => { ui.pushState = x; render(); }); }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || ''), standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const tog = (id, on, label, hint) => `<label class="row" style="cursor:pointer"><div class="grow"><b>${label}</b>${hint ? `<div class="small muted">${hint}</div>` : ''}</div><input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="width:22px;height:22px"></label>`;
  const pushRow = ps === 'unsupported' ? (ios && !standalone ? 'On iPhone, add Pocket to your Home Screen first, then open it from there to turn on notifications.' : "This browser doesn't support notifications.")
    : ps === 'denied' ? 'Notifications are blocked for this site. Turn them on in your browser or phone settings.' : ps === 'on' ? 'On for this device.' : ps === 'loading' || ps === null ? 'Checking…' : 'Off for this device.';
  return `<div class="pagehead"><div><a href="#/u/${Store.myPid}" class="small">← Profile</a><h1 style="margin-top:6px">Notifications</h1><p class="muted">Approval requests have a short window, so phone alerts matter.</p></div></div>
  <section class="panel" style="padding:18px 20px"><h2>Phone alerts</h2><p class="muted small" style="margin:6px 0 12px">${pushRow}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${ps === 'off' ? '<button class="btn ember" data-act="pushon">Turn on notifications</button>' : ''}${ps === 'on' ? '<button class="btn ghost" data-act="pushtest">Send a test</button><button class="btn ghost" data-act="pushoff">Turn off on this device</button>' : ''}</div></section>
  <section class="block"><header><h2>What to alert me about</h2></header><div class="list">
    ${tog('n-ap', n.approvals !== false, 'Approval requests', 'Group trades, investors you copy, Risk Manager reviews and trade suggestions')}
    ${tog('n-vo', n.votes !== false, 'New votes in my groups', '')}
    ${tog('n-so', n.social !== false, 'Followers, copiers and join requests', '')}
    ${tog('n-wr', n.weeklyRecap !== false, 'Weekly group recap', 'Monday mornings: trades, votes and new members in each of your groups')}
    ${Store.site.news ? tog('n-nw', n.news === true, 'News about stocks I own or watch', 'Up to 3 a day, never during quiet hours') : ''}</div></section>
  <section class="block"><header><h2>Quiet hours</h2></header><div class="list">
    ${tog('n-qon', !!q.on, 'Pause alerts overnight', '')}
    <div class="row"><div class="grow muted">From</div><input class="input" id="n-qs" aria-label="Quiet hours start" type="time" value="${esc(q.start)}" style="width:auto"></div>
    <div class="row"><div class="grow muted">Until</div><input class="input" id="n-qe" aria-label="Quiet hours end" type="time" value="${esc(q.end)}" style="width:auto"></div>
    ${tog('n-aq', n.approvalsInQuiet !== false, 'Still alert me for approval requests', "Approvals expire, so we recommend keeping this on")}</div></section>
  ${Store.myGroups().length ? `<section class="block"><header><h2>Groups</h2></header><div class="list">${Store.myGroups().map(g => tog('n-g-' + g.id, !muted.has(g.id), esc(g.name), '')).join('')}</div></section>` : ''}
  <p style="margin-top:18px"><button class="btn" data-act="savenotif">Save settings</button></p>`;
}

async function pushStatus(){
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); return sub ? 'on' : 'off'; } catch(e){ return 'off'; }
}

function b64ToU8(b){ const p = '='.repeat((4 - b.length % 4) % 4); const raw = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); }

async function pushOn(){
  const perm = await Notification.requestPermission(); if (perm !== 'granted') throw Object.assign(new Error('Notifications were not allowed.'), { userFacing: true });
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(Store.pushKey) }));
  await Store.http('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
}

async function pushOff(){ const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub){ await Store.http('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } }
