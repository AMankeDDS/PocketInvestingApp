/* Beta admin and pilot metrics (admins only). */

function vMetrics(){
  if (!Store.canEdit) return `<div class="empty">Pilot metrics are available to demo admins.</div>`;
  const M = Store.metrics(); const P = x => x == null ? '—' : (x * 100).toFixed(0) + '%';
  const tile = (label, value, note) => `<div class="panel" style="padding:16px 18px"><div class="small muted">${label}</div><div class="num" style="font-size:28px;font-weight:700;margin:4px 0">${value}</div>${note ? `<div class="small muted">${note}</div>` : ''}</div>`;
  const tiles = (arr) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">${arr.join('')}</div>`;
  if (ui.usage === null){ ui.usage = 'loading'; Store.http('GET', '/api/admin/usage').then(u => { ui.usage = u; render(); }, () => { ui.usage = 'error'; render(); }); }
  const U = typeof ui.usage === 'object' && ui.usage ? ui.usage : null;
  const realUsage = U ? `<section class="block" style="margin-top:0"><header><h2>Real usage from testers</h2><button class="btn sm ghost" data-act="usage-refresh">Refresh</button></header>${tiles([
      tile('Testers', U.users, U.signups7 + ' joined this week'), tile('Active today', U.dau, 'Daily active users'), tile('Active this week', U.wau, 'Weekly active users'), tile('7-day retention', U.retention ? Math.round(U.retention.kept / U.retention.cohort * 100) + '%' : '—', U.retention ? `${U.retention.kept} of ${U.retention.cohort} came back in week 2` : 'Needs testers older than 7 days'),
      tile('Phone alerts on', U.pushUsers, 'Testers with notifications enabled')])}
    ${U.daily.length ? `<div class="panel" style="padding:16px 18px;margin-top:12px"><div class="small muted" style="margin-bottom:8px">Active testers by day</div><div style="display:flex;align-items:flex-end;gap:6px;height:90px">${U.daily.map(d => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:100%;max-width:26px;height:${Math.max(4, d.n / Math.max(...U.daily.map(x => x.n)) * 70)}px;background:var(--blue);border-radius:4px 4px 0 0"></div><span style="font-size:10px" class="muted">${esc(d.day.slice(4))}</span></div>`).join('')}</div></div>` : ''}
    <div class="grid2" style="margin-top:12px"><div class="list">${U.actions.map(a => `<div class="row"><div class="grow small">${esc(a.name.replace('action:', ''))}</div><b class="num small">${a.n}</b></div>`).join('') || '<div class="empty">No actions this week.</div>'}</div><div class="list">${U.views.map(a => `<div class="row"><div class="grow small">${esc(a.name.replace('view:', ''))} screen</div><b class="num small">${a.n}</b></div>`).join('') || '<div class="empty">No screen views this week.</div>'}</div></div></section>` : '';
  return `<div class="pagehead"><div><h1>Pilot metrics</h1><p class="muted">Real tester activity first, then the product metrics calculated from everything in the demo, sample investors included.</p></div></div>${realUsage}
  <section class="block" style="margin-top:0"><header><h2>Growth and revenue</h2></header>${tiles([
    tile('Accounts', M.accounts, 'Sample investors plus real sign-ins'), tile('Pro conversion', P(M.proRate), 'Plan: 3% at launch, rising to 8%'),
    tile('Groups on Group Pro', M.groupPro + ' of ' + M.groups, 'Group Pro is $19.99 a month'), tile('Subscription run rate', usd(M.runRate, 0), 'Pro and Group Pro, annualized')])}</section>
  <section class="block"><header><h2>Groups, the growth engine</h2></header>${tiles([
    tile('Members per group', M.perGroup.toFixed(1), 'Plan assumes about 8 per new group'), tile('Joined from invites', M.invites, 'Members brought in by other members'),
    tile('Group trades this week', M.groupTrades7, ''), tile('Vote participation', P(M.participation), 'Share of eligible members voting')])}</section>
  <section class="block"><header><h2>Approval-based copying</h2></header>${tiles([
    tile('Approval requests', M.requests, ''), tile('Approval rate', P(M.approvalRate), 'Approved, of requests decided'),
    tile('Median time to approve', M.medianApprove == null ? '—' : left(M.medianApprove).replace(':', 'm ') + (M.medianApprove < 3600000 ? 's' : ''), 'Window is 30 minutes'), tile('Expired', P(M.expiredRate), 'Missed the window')])}</section>
  <section class="block"><header><h2>Engagement and safety</h2></header>${tiles([
    tile('Posts this week', M.posts7, ''), tile('Comments this week', M.comments7, ''), tile('Copying relationships', M.copies, 'People copying an individual investor'), tile('Open reports', M.reportsOpen, 'Trust and safety queue')])}</section>
  <section class="block"><header><h2>Series A readiness targets (Month 18)</h2></header><div class="list">
    ${[['Monthly active users','~24,000'],['Pro subscribers','~1,100'],['Funded accounts','~6,000'],['Active groups','~1,700'],['Run-rate revenue','~$260,000 a year']].map(([a, b]) => `<div class="row"><div class="grow">${a}</div><b class="num">${b}</b></div>`).join('')}</div></section>`;
}

function vAdmin(){
  if (!Store.canEdit && Store.adminNeeds2fa) return `<div class="panel" style="padding:22px;max-width:560px"><h1>Turn on two-step sign-in</h1><p class="muted">Admin tools can see everyone's data, so they need two-step sign-in. Turn it on in your Profile, then come back.</p><a class="btn" href="#/u/${Store.myPid}">Go to Profile</a></div>`;
  if (!Store.canEdit) return `<div class="empty">The beta admin is available to demo admins.</div>`;
  if (!ui.admin){ loadAdmin(); return '<div class="loading">Loading beta admin…</div>'; }
  const A = ui.admin, tab = ui.adminTab;
  const T = [['metrics','Metrics'],['testacct','Test accounts'],['replication','Replication'],['requests','Invite requests'],['clubdocs','Club documents'],['adminlog','Admin log'],['testers','Testers ' + A.users.length],['invites','Invites'],['feedback','Feedback ' + A.feedback.filter(f => f.status === 'open').length],['errors','Errors ' + A.errors.length]].concat(Store.site.realMoney ? [['real','Real money']] : []).concat([['market','Market data'], ['settings','Settings']]);
  const when = t => t ? ago(new Date(t).getTime()) + ' ago' : 'never';
  let body = '';
  if (tab === 'testers') body = `<div class="list">${A.users.map(u => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><b>${esc(u.display_name)}</b> <span class="muted small">@${esc(u.username)}</span> ${u.env_admin || u.is_admin ? '<span class="tag blue">Admin</span>' : ''} ${u.disabled ? '<span class="tag">Turned off</span>' : ''}
      <div class="small muted">Joined ${when(u.created_at)}, last seen ${when(u.last_seen_at)}${u.invite_code ? ', invite ' + esc(u.invite_code) : ''}${u.push ? ', alerts on' : ''}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm ghost" data-act="adm" data-op="reset" data-id="${u.id}" data-n="${esc(u.username)}">Reset code</button><button class="btn sm ghost" data-act="adm" data-op="reset2fa" data-id="${u.id}" data-n="${esc(u.username)}">Reset two-step</button>
      ${u.env_admin ? '' : `<button class="btn sm ghost" data-act="adm" data-op="${u.is_admin ? 'unadmin' : 'admin'}" data-id="${u.id}">${u.is_admin ? 'Remove admin' : 'Make admin'}</button><button class="btn sm ghost" data-act="adm" data-op="${u.disabled ? 'enable' : 'disable'}" data-id="${u.id}">${u.disabled ? 'Turn on' : 'Turn off'}</button>`}</div></div>`).join('') || '<div class="empty">No testers yet.</div>'}</div>`;
  else if (tab === 'invites') body = `<div style="margin-bottom:14px"><button class="btn" data-act="adm-newinv">New invite code</button></div><div class="list">${A.invites.map(c => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><b class="num">${esc(c.code)}</b> ${c.label ? '<span class="muted">' + esc(c.label) + '</span>' : ''}<div class="small muted">${c.uses} used${c.max_uses ? ' of ' + c.max_uses : ''}${c.active ? '' : ', turned off'}</div></div>
      <button class="btn sm ghost" data-act="adm-copylink" data-k="${esc(c.code)}">Copy sign-up link</button><button class="btn sm ghost" data-act="adm-invtoggle" data-k="${esc(c.code)}">${c.active ? 'Turn off' : 'Turn on'}</button></div>`).join('') || '<div class="empty">No invite codes yet. Create one for each tester or group of testers.</div>'}</div>`;
  else if (tab === 'feedback') body = `<div class="list">${A.feedback.map(f => `<div class="row" style="align-items:flex-start"><div class="grow"><div class="small muted">${esc(f.username || 'Signed-out visitor')}, ${when(f.created_at)}, on ${esc(f.screen || '?')}</div><div style="white-space:pre-wrap;margin-top:4px">${esc(f.body)}</div></div><button class="btn sm ${f.status === 'open' ? '' : 'ghost'}" data-act="adm-fb" data-id="${f.id}">${f.status === 'open' ? 'Mark done' : 'Reopen'}</button></div>`).join('') || '<div class="empty">No feedback yet.</div>'}</div>`;
  else if (tab === 'errors') body = `${A.errors.length ? '<div style="margin-bottom:14px"><button class="btn ghost" data-act="adm-errclear">Clear all</button></div>' : ''}<div class="list">${A.errors.map(e => `<div class="row" style="align-items:flex-start"><div class="grow" style="min-width:0"><b class="small">${esc(e.message)}</b><div class="small muted">${esc(e.username || 'visitor')}, ${when(e.created_at)}, ${esc(e.url || '')}</div>${e.stack ? `<pre style="white-space:pre-wrap;font-size:12px;margin:6px 0 0;max-height:120px;overflow:auto;color:var(--muted)">${esc(e.stack)}</pre>` : ''}<div class="small muted">${esc(e.ua || '')}</div></div></div>`).join('') || '<div class="empty">No errors reported. Good news.</div>'}</div>`;
  else if (tab === 'real') body = adminReal();
  else if (tab === 'market') body = adminMarket();
  else if (tab === 'metrics') body = adminMetrics();
  else if (tab === 'clubdocs') body = adminClubDocs();
  else if (tab === 'requests') body = adminRequests();
  else if (tab === 'adminlog') body = adminLogView();
  else if (tab === 'testacct') body = adminTestAccounts();
  else if (tab === 'replication') body = adminReplication();
  else body = `<section class="panel" style="padding:18px 20px"><h2>Invite only</h2><p class="muted small">When on, new accounts need an invite code. Admins listed in ADMIN_USERNAMES can always sign up.</p><div class="seg"><button class="${A.inviteOnly ? 'on' : ''}" data-act="adm-io" data-k="1">On</button><button class="${A.inviteOnly ? '' : 'on'}" data-act="adm-io" data-k="0">Off</button></div></section>
    <section class="panel" style="padding:18px 20px;margin-top:16px"><h2>Announcement</h2><p class="muted small">Shown at the top of every screen until each tester dismisses it.</p><textarea class="input" id="adm-ann" maxlength="300" placeholder="e.g. New version: please test buy-at-open today">${esc((A.announcement || {}).text || '')}</textarea><div style="display:flex;gap:10px;margin-top:10px"><button class="btn" data-act="adm-ann">Post</button>${A.announcement ? '<button class="btn ghost" data-act="adm-annclear">Remove</button>' : ''}</div></section>
    <section class="panel" style="padding:18px 20px;margin-top:16px"><h2>Market events</h2><p class="muted small">Dates to know that show in Explore under "Coming up": a product or game launch, a big conference, an IPO. Keep descriptions factual.</p>
      <div class="grid2"><div class="field"><label for="ev-d">Date</label><input class="input" id="ev-d" type="date"></div><div class="field"><label for="ev-s">Stocks (comma separated)</label><input class="input" id="ev-s" placeholder="e.g. TTWO, SONY"></div></div>
      <div class="field"><label for="ev-t">Title</label><input class="input" id="ev-t" maxlength="120" placeholder="e.g. Major video game launch"></div><div class="field"><label for="ev-n">Note (optional)</label><input class="input" id="ev-n" maxlength="300"></div>
      <button class="btn" data-act="adm-event">Add event</button>
      <div class="list" style="margin-top:12px">${((exploreData().events) || []).map(e => `<div class="row"><div class="grow"><b>${esc(e.title)}</b> <span class="small muted">${String(e.date).slice(0, 10)} · ${(e.syms || []).join(', ')}</span></div><button class="btn sm ghost" data-act="adm-evdel" data-id="${e.id}">Remove</button></div>`).join('')}</div></section>
    <section class="panel" style="padding:18px 20px;margin-top:16px"><h2>Read-only mode</h2><p class="muted small">Blocks trades, transfers, approvals and other changes for everyone except admins, with a banner explaining why. Use it while fixing an issue.</p>
      ${(Store.maintenance || {}).on ? `<p><b>Read-only mode is on.</b></p><button class="btn" data-act="adm-ro" data-k="0">Turn it off</button>` : `<input class="input" id="adm-ro-m" aria-label="Read-only message" maxlength="300" placeholder="Optional message, e.g. We're fixing a delay with deposits."><p style="margin-top:10px"><button class="btn ghost" data-act="adm-ro" data-k="1">Turn on read-only mode</button></p>`}</section>`;
  return `<div class="pagehead"><div><h1>Beta admin</h1><p class="muted">Beta metrics, testers, invite codes, feedback and error reports.</p></div><button class="btn ghost sm" data-act="adm-refresh">Refresh</button></div>
    <nav class="tabs">${T.map(([k, l]) => `<a href="#/admin" class="${tab === k ? 'on' : ''}" data-act="adm-tab" data-k="${k}">${l}</a>`).join('')}</nav>${body}${opsPanel()}${legalDraftsPanel()}${insightsPanel()}${badgesPanel()}${reportsPanel()}`;
}

function adminLogView(){
  const X = ui.alog; if (!X){ ui.alog = 'loading'; Store.http('GET', '/api/admin/log').then(r => { ui.alog = r.log; render(); }, e => { ui.alog = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>'; if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  return `<p class="muted small" style="margin-top:0">Every admin change, newest first.</p><div class="panel mtable"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th><th>Result</th></tr></thead><tbody>${X.map(l => `<tr><td>${ago(new Date(l.ts).getTime())} ago</td><td>${esc(l.username || '')}</td><td>${esc(l.action)}</td><td style="max-width:420px;white-space:normal">${esc(l.detail || '')}</td><td>${l.status < 400 ? 'OK' : 'Refused (' + l.status + ')'}</td></tr>`).join('') || '<tr><td colspan="5">Nothing yet.</td></tr>'}</tbody></table></div>`;
}

function adminRequests(){
  const X = ui.areq;
  if (!X){ ui.areq = 'loading'; Store.http('GET', '/api/admin/waitlist').then(r => { ui.areq = r.requests; render(); }, e => { ui.areq = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>';
  if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const HOW = { own: 'On their own', copy: 'Copying investors', group: 'With friends or family', club: 'With an investment club' };
  const waiting = X.filter(r => !r.invited_code), done = X.filter(r => r.invited_code);
  const row = r => `<div class="row" style="flex-wrap:wrap;align-items:flex-start"><div class="grow" style="min-width:220px"><b>${esc(r.name || '')}</b> <span class="small muted">${esc(r.email)}</span>
    <div class="small">${esc(HOW[r.how] || 'Not given')}${r.club_size ? ', ' + esc(r.club_size) + ' people' : ''} · ${ago(new Date(r.created_at).getTime())} ago${r.source && r.source !== 'website' ? ' · ' + esc(r.source) : ''}</div>${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}
    ${r.invited_code ? `<div class="small">Invited with <b>${esc(r.invited_code)}</b> ${ago(new Date(r.invited_at).getTime())} ago</div>` : ''}</div>
    ${r.invited_code ? `<button class="btn sm ghost" data-act="adm-reqcopy" data-id="${r.id}">Copy invite message</button>` : `<button class="btn sm" data-act="adm-reqinvite" data-id="${r.id}">Create invite</button>`}</div>`;
  return `<p class="muted small" style="margin-top:0">People who asked for an invite on pocketinvesting.com. Creating an invite makes a one-time code; copy the message and email it to them.</p>
    <section class="block"><header><h2>Waiting (${waiting.length})</h2></header><div class="list">${waiting.map(row).join('') || '<div class="empty">No new requests.</div>'}</div></section>
    ${done.length ? `<section class="block"><header><h2>Invited (${done.length})</h2></header><div class="list">${done.map(row).join('')}</div></section>` : ''}`;
}

function adminClubDocs(){
  const X = ui.adocs;
  if (!X){ ui.adocs = 'loading'; Store.http('GET', '/api/admin/club-docs').then(r => { ui.adocs = r.docs; render(); }, e => { ui.adocs = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>';
  if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const pend = X.filter(d => d.status === 'pending'), done = X.filter(d => d.status !== 'pending');
  const row = d => `<div class="row" style="flex-wrap:wrap;align-items:flex-start"><div class="grow" style="min-width:220px"><b>${esc(d.docType)}</b> · ${esc(d.groupName)} <span class="tag ${STATUS[d.status][1]}" style="font-size:11px">${{ pending: 'Waiting', confirmed: 'Verified', declined: 'Needs changes' }[d.status]}</span>
    <div class="small muted">Sent ${ago(d.ts)} ago by ${esc(Store.displayName(d.pid))}${d.note ? ' · ' + esc(d.note) : ''} · <a href="/api/club/${d.gid}/file/${d.fileId}" target="_blank" rel="noopener">Open file</a></div>${d.reviewNote ? `<div class="small"><b>Note:</b> ${esc(d.reviewNote)}</div>` : ''}</div>
    ${d.status === 'pending' ? `<button class="btn sm" data-act="adm-docreview" data-id="${d.id}" data-k="confirmed">Verify</button><button class="btn sm ghost" data-act="adm-docreview" data-id="${d.id}" data-k="declined">Needs changes</button>` : ''}</div>`;
  return `<p class="muted small" style="margin-top:0">Documents pooled clubs send for verification before opening a real business account. Check the entity name, members and tax ID match the club.</p>
    <section class="block"><header><h2>Waiting for review (${pend.length})</h2></header><div class="list">${pend.map(row).join('') || '<div class="empty">Nothing waiting.</div>'}</div></section>
    ${done.length ? `<section class="block"><header><h2>Reviewed</h2></header><div class="list">${done.slice(0, 30).map(row).join('')}</div></section>` : ''}`;
}

function adminMetrics(){
  const M = ui.ametrics;
  if (!M){ ui.ametrics = 'loading'; Store.http('GET', '/api/admin/metrics').then(r => { ui.ametrics = r; render(); }, e => { ui.ametrics = { error: e.message }; render(); }); return '<div class="loading" style="min-height:20vh">Loading…</div>'; }
  if (M === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>';
  if (M.error) return `<div class="panel empty">${esc(M.error)}</div>`;
  const rate = v => v == null ? '—' : (v * 100).toFixed(v < 0.1 ? 2 : 1) + '%';
  const fmt = (k, v) => k === 'cps' ? (v == null ? '—' : usd(v)) : rate(v);
  const col = { on: 'var(--gain)', mid: 'var(--ember)', off: 'var(--loss)', none: 'var(--muted)' }, word = { on: 'On target', mid: 'Between base case and target', off: 'Below the base case', none: 'No data yet' };
  const card = k => { const C = M.cards[k], T = M.targets[k], wp = C.wouldPay;
    return `<div class="panel mcard"><div class="small muted">${esc(T.label)}</div><div class="v" style="color:${col[C.status]}">${fmt(k, C.value)}</div>
      <div class="small" style="color:${col[C.status]};font-weight:600">${word[C.status]}</div>
      <div class="small muted" style="margin-top:6px">Target ${fmt(k, T.target)}${T.base !== T.target ? ` · base case ${fmt(k, T.base)}` : ''}</div>
      <div class="small" style="margin-top:8px">${esc(C.detail)}</div>
      ${wp ? `<div class="small" style="margin-top:8px"><b>Would keep Pro at $9.99:</b> ${wp.asked ? `yes ${wp.yes}, maybe ${wp.maybe}, no ${wp.no} (of ${wp.asked} asked)` : 'nobody asked yet'}</div>` : ''}</div>`; };
  const rows = M.rows.slice().reverse();
  const TPL = { club: 'Investment club', family: 'Family fund', friends: 'Friends group', custom: 'Custom' };
  return `${M.smallSample ? `<div class="banner" style="margin-bottom:14px"><div style="flex:1"><b>Small sample</b><div class="small">${M.active30} active tester${M.active30 === 1 ? '' : 's'} in the last 30 days. Read these as early signals, not results.</div></div></div>` : ''}
    <p class="muted small" style="margin-top:0">Real testers only; sample investors and groups are left out. Cards cover the last 30 days. Targets come from the plan case in the financial model.</p>
    <div class="mcards">${['groupStarts','proGroup','cps','wom','activation'].map(card).join('')}</div>
    <section class="block"><header><h2>Ad spend</h2></header><div class="panel" style="padding:16px 18px">
      <p class="small muted" style="margin-top:0">Enter what you spent on ads each month. Cost per signup divides it by signups that came from paid campaign links.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="field" style="margin:0"><label for="ms-m">Month</label><select class="input" id="ms-m">${M.rows.slice().reverse().map(r => `<option value="${r.month}">${r.month}${r.adSpend ? ' (' + usd(r.adSpend, 0) + ')' : ''}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label for="ms-a">Amount ($)</label><input class="input num" id="ms-a" inputmode="decimal" placeholder="0" style="width:140px"></div><button class="btn" data-act="adm-spend">Save</button></div>
      <h3 style="margin:18px 0 6px;font-size:15px">Make a tracked link</h3><p class="small muted" style="margin-top:0">Use these in ads and posts so signups are credited to the right source.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="input" id="mu-s" aria-label="Campaign source" placeholder="Source, e.g. instagram" style="width:200px"><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mu-p" checked> Paid ad</label><button class="btn ghost sm" data-act="adm-utm">Create and copy</button></div>
      <input class="input" id="mu-l" aria-label="Campaign link" readonly placeholder="Your link appears here" style="margin-top:8px;font-size:13px"></div></section>
    <section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>By month</h2><a class="btn ghost sm" href="/api/admin/metrics.csv" download>Download CSV</a></header>
      <div class="panel mtable"><table><thead><tr><th>Month</th><th>Active users</th><th>Signups</th><th>From invite links</th><th>From ads</th><th>Groups started</th><th>Group start rate</th><th>Pro in groups</th><th>Cost per ad signup</th><th>Activation</th><th>Churn</th><th>Members per group</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.month}${r.partial ? ' <span class="muted">(so far)</span>' : ''}</td><td>${r.activeUsers}</td><td>${r.signups}</td><td>${r.fromGroupInvites}</td><td>${r.fromAds}</td><td>${r.groupStarts}</td><td>${rate(r.groupStartRate)}</td><td>${rate(r.proGroupRate)}</td><td>${r.costPerSignup == null ? '—' : usd(r.costPerSignup)}</td><td>${rate(r.activation)}</td><td>${rate(r.churn)}</td><td>${r.membersPerGroup == null ? '—' : r.membersPerGroup.toFixed(1)}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="block"><header><h2>Groups by template</h2></header><div class="panel" style="padding:14px 18px">${Object.keys(M.templates).length ? Object.entries(M.templates).map(([k, n]) => `<span class="tag" style="margin:0 6px 6px 0">${esc(TPL[k] || k)}: ${n}</span>`).join('') : '<span class="muted small">No groups started by testers yet.</span>'}</div></section>`;
}

async function loadAdmin(){ try { ui.admin = await Store.http('GET', '/api/admin/overview'); } catch(e){ errToast(e); ui.admin = { users:[], invites:[], feedback:[], errors:[], inviteOnly:true, announcement:null }; } render(); }

function adminReal(){
  const X = ui.areal;
  if (!X){ ui.areal = 'loading'; Store.http('GET', '/api/admin/real').then(r => { ui.areal = r; render(); }, e => { ui.areal = { error: e.message }; render(); }); return '<div class="loading" style="min-height:20vh">Loading…</div>'; }
  if (X === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>';
  if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const I = X.instant;
  return `<section class="panel" style="padding:18px 20px"><h2>Brokerage connection</h2><p class="small muted">Alpaca ${esc(X.env)}${X.configured ? '' : ' (keys not set: add ALPACA_KEY and ALPACA_SECRET)'}</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><b>Real-money trading</b><div class="seg"><button class="${X.paused ? '' : 'on'}" data-act="arpause" data-k="0">Running</button><button class="${X.paused ? 'on' : ''}" data-act="arpause" data-k="1">Paused</button></div><span class="hint">Pausing blocks new orders and instant deposits right away.</span></div></section>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:16px">
      <div class="panel" style="padding:14px 16px"><div class="small muted">Accounts</div><div class="num" style="font-size:24px;font-weight:700">${X.accounts.reduce((a, b) => a + b.n, 0)}</div><div class="small muted">${X.accounts.map(a => esc(a.status) + ' ' + a.n).join(', ') || 'None yet'}</div></div>
      <div class="panel" style="padding:14px 16px"><div class="small muted">Open orders</div><div class="num" style="font-size:24px;font-weight:700">${X.openOrders}</div></div>
      <div class="panel" style="padding:14px 16px"><div class="small muted">Filled this week</div><div class="num" style="font-size:24px;font-weight:700">${X.filled7.n}</div><div class="small muted">${usd(X.filled7.value, 0)}</div></div></div>
    <section class="panel" style="padding:18px 20px;margin-top:16px"><h2>Instant deposits <span class="tag ${I.enabled ? 'blue' : ''}">${I.enabled ? 'On' : 'Off: future feature'}</span></h2>
      <p class="small muted">Pro members get up to ${usd(I.perDeposit, 0)} of a deposit right away, fronted from Pocket's account until the bank transfer clears. Company-wide cap ${usd(I.totalCap, 0)}; accounts must be ${I.minAccountDays} days old with one cleared deposit. Turn on with INSTANT_DEPOSITS=true${I.firmAccount ? '' : ' and ALPACA_FIRM_ACCOUNT_ID'}.</p>
      ${I.byStatus.length ? `<div class="list">${I.byStatus.map(b => `<div class="row"><div class="grow">${esc(b.status)}</div><b class="num">${b.n}, ${usd(b.amount)}</b></div>`).join('')}</div>` : ''}
      ${I.shortfalls.length ? `<div class="banner ember" style="margin-top:12px"><div><b>Needs attention:</b> ${I.shortfalls.map(x => '@' + esc(x.username) + ' ' + usd(x.amount)).join(', ')}. Their bank transfer was returned and their cash didn't cover the instant amount.</div></div>` : ''}</section>
    ${adminReconcile()}
    <section class="block"><header><h2>Brokerage errors</h2></header><div class="list">${X.log.map(l => `<div class="row"><div class="grow small"><b>${esc(l.method)} ${esc(l.path)}</b> <span class="muted">${l.status}</span><div class="muted">${esc(l.message || '')}</div></div><span class="small muted">${ago(new Date(l.created_at).getTime())}</span></div>`).join('') || '<div class="empty">No errors from the brokerage.</div>'}</div></section>`;
}

function adminReconcile(){
  const R = ui.recon;
  const head = `<section class="panel" style="padding:18px 20px;margin-top:16px"><h2>Reconciliation</h2><p class="small muted" style="margin:6px 0 12px">Checks every account's deposits, withdrawals, orders and holdings in the app against Alpaca's records, and flags anything that doesn't match.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="recon">Run reconciliation</button>${R && R.accounts && R.accounts.some(a => a.issues.some(i => i.fix)) ? '<button class="btn ghost" data-act="reconfix">Update app records from Alpaca</button>' : ''}</div>
    ${R && R.accounts && R.accounts.some(a => a.issues.some(i => i.fix)) ? '<p class="hint" style="margin:8px 0 0">Updating only copies statuses (pending, completed, filled) from Alpaca. It never creates, deletes or moves money.</p>' : ''}</section>`;
  if (!R) return head;
  if (R === 'loading') return head + '<div class="panel empty" style="margin-top:12px">Comparing with Alpaca…</div>';
  if (R.error) return head + `<div class="panel empty" style="margin-top:12px">${esc(R.error)}</div>`;
  return head + `<div class="banner ${R.issues ? 'ember' : ''}" style="margin-top:12px"><b>${R.issues ? R.issues + ' item' + (R.issues === 1 ? '' : 's') + ' to review' : 'Everything matches'}</b>&nbsp;across ${R.accounts.length} account${R.accounts.length === 1 ? '' : 's'}, checked ${agoText(R.at)}.</div>
    ${R.firm ? `<p class="small" style="margin:10px 2px">Firm account: ${R.firm.error ? esc(R.firm.error) : 'cash ' + usd(R.firm.cash)}${R.instantOutstanding ? ' · instant deposits outstanding ' + usd(R.instantOutstanding) : ''}</p>` : ''}
    <div class="list" style="margin-top:10px">${R.accounts.map(a => `<div class="row" style="align-items:flex-start"><span class="tag ${a.issues.length || a.error ? 'ember' : 'blue'}" style="min-width:64px;text-align:center">${a.error ? 'Error' : a.issues.length ? a.issues.length + ' issue' + (a.issues.length === 1 ? '' : 's') : 'Matches'}</span>
      <div class="grow"><b>@${esc(a.username)}</b> <span class="muted small">#${esc(a.accountNumber || '—')} · ${esc(a.status)}</span>
        ${a.balances ? `<div class="small muted">Cash ${usd(a.balances.cash)} · value ${usd(a.balances.equity)} · ${a.counts.transfers || 0} transfers · ${a.counts.orders || 0} orders${a.positions && a.positions.length ? ' · holdings ' + a.positions.map(p => esc(p.sym) + ' ' + shs(p.alpaca)).join(', ') : ''}${a.instantOwed ? ' · owes ' + usd(a.instantOwed) + ' instant deposit' : ''}</div>` : ''}
        ${a.error ? `<div class="small" style="color:var(--loss)">${esc(a.error)}</div>` : ''}
        ${a.issues.map(i => `<div class="small" style="margin-top:4px">• ${esc(i.text)}${i.fix ? ' <span class="muted">(can be updated from Alpaca)</span>' : ''}</div>`).join('')}</div></div>`).join('') || '<div class="empty">No brokerage accounts yet.</div>'}</div>`;
}

function adminMarket(){
  const X = ui.amd;
  if (!X || X === 'loading'){ if (!X){ ui.amd = 'loading'; Store.http('GET', '/api/admin/marketdata').then(r => { ui.amd = r; render(); }, e => { ui.amd = { error: e.message }; render(); }); } return '<div class="loading" style="min-height:20vh">Loading…</div>'; }
  if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const when = t => t ? agoText(t) : 'never';
  const st = X.status || {}, N = st.news, A = st.assets;
  const C = ui.amdCheck;
  return `<section class="panel" style="padding:18px 20px"><h2>Market data <span class="tag ${X.on ? 'blue' : ''}">${X.on ? 'On' : 'Off: no Alpaca keys'}</span></h2>
      <p class="small muted" style="margin:6px 0 0">Alpaca ${esc(X.env)} · sign-in: ${X.authMode === 'legacy' ? 'older key pair' : 'Client ID + Secret (access token)'} · prices: ${X.realPrices ? 'real' : 'simulated'}</p>
      <p class="small muted" style="margin:4px 0 0;word-break:break-all">${esc(X.urls.auth)} · ${esc(X.urls.broker)} · ${esc(X.urls.data)}</p>
      <p class="small" style="margin:8px 0 0">SEC filings: ${X.sec.mode === 'off' ? 'off' : X.sec.active ? '<b>in use as the news source</b>' : X.sec.mode === 'auto' ? 'standing by (used only while Alpaca news is unavailable)' : 'on'}${st.sec && st.sec.at ? ` · last checked ${when(st.sec.at)}${st.sec.checked != null ? `, ${st.sec.checked} companies, ${st.sec.added || 0} new filings` : ''}` : ''}</p>
      ${st.sec && st.sec.error ? `<p class="small" style="color:var(--loss);margin:4px 0 0">SEC error${st.sec.error.status ? ' (HTTP ' + st.sec.error.status + ')' : ''}: ${esc(st.sec.error.message)}</p>` : ''}
      ${X.on ? '' : `<div class="why-not" id="amd-why" style="margin:14px 0 0">News isn't turned on, so it can't be fetched yet. Add the market data keys in Railway's settings for this service, then redeploy.</div>`}<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn" data-act="amdcheck">Run check</button><button class="btn ghost" data-act="amdfetch" ${X.on ? '' : 'disabled aria-describedby="amd-why" title="News is not turned on"'}>Fetch news now</button>${X.sec.mode !== 'off' ? '<button class="btn ghost" data-act="amdfilings">Fetch SEC filings now</button>' : ''}<button class="btn ghost" data-act="amdreload">Refresh</button></div></section>
    ${C ? `<section class="block"><header><h2>Check results</h2></header><div class="list">${C === 'loading' ? '<div class="empty">Checking each Alpaca service…</div>' : C.map(s => `<div class="row" style="align-items:flex-start"><span class="tag ${s.ok ? 'blue' : 'ember'}" style="min-width:52px;text-align:center">${s.ok ? 'OK' : 'Failed'}</span><div class="grow"><b>${esc(s.name)}</b> <span class="muted small">${s.ms} ms${s.status != null && !s.ok ? ', HTTP ' + s.status : ''}</span><div class="small ${s.ok ? 'muted' : ''}" style="margin-top:3px;word-break:break-word">${esc(s.detail || '')}</div></div></div>`).join('')}</div>
      ${Array.isArray(C) && C.some(s => !s.ok) ? '<p class="hint">Copy the failed lines and send them to Claude in the project chat. They contain Alpaca\u2019s exact response, never your keys.</p>' : ''}</section>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px">
      <div class="panel" style="padding:14px 16px"><div class="small muted">Stocks in the list</div><div class="num" style="font-size:24px;font-weight:700">${X.counts.assets.toLocaleString('en-US')}</div><div class="small muted">${X.counts.added} added to Pocket · synced ${A && A.at ? when(A.at) : 'at startup'}</div></div>
      <div class="panel" style="padding:14px 16px"><div class="small muted">Headlines stored</div><div class="num" style="font-size:24px;font-weight:700">${X.counts.news}</div><div class="small muted">Newest ${when(X.counts.newest)}</div></div>
      <div class="panel" style="padding:14px 16px"><div class="small muted">Last news fetch</div><div class="num" style="font-size:24px;font-weight:700">${N && N.at ? (N.error && !N.received ? 'Failed' : (N.added || 0) + ' new') : '—'}</div><div class="small muted">${N && N.at ? when(N.at) + (N.requests ? `, ${N.requests - (N.failed || 0)} of ${N.requests} requests worked` : '') : 'Not run yet'}</div></div></div>
    ${N && N.error ? `<div class="banner ember" style="margin-top:14px"><div><b>Last news error${N.error.status != null ? ' (HTTP ' + N.error.status + ')' : ''}:</b> ${esc(N.error.message)}</div></div>` : ''}
    ${A && A.error ? `<div class="banner ember" style="margin-top:14px"><div><b>Stock list error${A.error.status != null ? ' (HTTP ' + A.error.status + ')' : ''}:</b> ${esc(A.error.message)}</div></div>` : ''}
    <section class="block"><header><h2>Recent Alpaca errors</h2></header><div class="list">${(X.log || []).map(l => `<div class="row"><div class="grow small"><b>${esc(l.method)} ${esc(l.path)}</b> <span class="muted">${l.status}</span><div class="muted" style="word-break:break-word">${esc(l.message || '')}</div></div><span class="small muted">${ago(new Date(l.created_at).getTime())}</span></div>`).join('') || '<div class="empty">No errors from Alpaca.</div>'}</div></section>`;
}

function adminTestAccounts(){
  const X = ui.atest; if (!X){ ui.atest = 'loading'; Store.http('GET', '/api/admin/test-accounts').then(r => { ui.atest = r; render(); }, e => { ui.atest = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>'; if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  if (!X.sandbox) return `<div class="panel" style="padding:18px 20px"><h2>Test accounts</h2><div class="why-not why-under">Test accounts are only available on the real-money site while it uses the broker's sandbox, so nothing here can touch real customers or real money.</div></div>`;
  const STEP = { account: 'Waiting for brokerage approval', bank: 'Linking test bank and depositing', done: 'Ready' };
  return `<section class="panel" style="padding:18px 20px"><h2>Create test accounts</h2><p class="muted small">Each gets a sandbox brokerage account with test identity details, a test bank, and an optional starting deposit. Use "Act as" to trade, deposit, withdraw, post and join groups as them, and to check that copying works.</p>
      <div class="grid2"><div class="field"><label for="tt-n">How many</label><input class="input" id="tt-n" type="number" min="1" max="10" value="3"></div><div class="field"><label for="tt-d">Starting deposit each ($)</label><input class="input" id="tt-d" type="number" min="0" max="50000" value="10000"></div></div>
      <button class="btn" data-act="adm-mktest">Create test accounts</button></section>
    <section class="block"><header><h2>Test accounts (${X.accounts.length})</h2><button class="linkbtn small" data-act="adm-tab" data-k="testacct">Refresh</button></header><div class="list">${X.accounts.map(a => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><b>${esc(a.display_name)}</b> <span class="small muted">@${esc(a.username)}</span>
        <div class="small">${esc(a.status || 'No brokerage account')} · ${esc(STEP[a.step] || '')}${a.deposit > 0 ? ' · $' + Number(a.deposit).toLocaleString() + ' deposit' : ''}${a.note ? ` · <span class="loss">${esc(a.note)}</span>` : ''}</div></div>
        <button class="btn sm" data-act="adm-actas" data-id="${a.id}">Act as</button></div>`).join('') || '<div class="empty">No test accounts yet.</div>'}</div></section>
    <p class="hint">"Act as" lasts 30 minutes, works only for test accounts and only in the sandbox, and every action is recorded in the admin log under your name.</p>`;
}
function adminReplication(){
  const X = ui.arepl; if (!X){ ui.arepl = 'loading'; Store.http('GET', '/api/admin/replication').then(r => { ui.arepl = r.trades; render(); }, e => { ui.arepl = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>'; if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const S = { pending: 'Waiting', placed: 'Order placed', filled: 'Filled', declined: 'Declined', expired: 'Expired', failed: 'Failed', skipped: 'Skipped' };
  return `<p class="muted small" style="margin-top:0">Each real-money trade by someone with followers, and what happened for every follower: request, decision, order and fill. Slippage compares each fill with the leader's price.</p>
    ${X.map(t => { const n = t.followers.length, f = t.followers.filter(x => x.status === 'filled').length, bad = t.followers.filter(x => ['failed'].includes(x.status)).length;
      return `<section class="block"><header style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2>${esc(t.leader)} ${t.side === 'buy' ? 'bought' : 'sold'} ${shs(t.qty)} ${esc(t.sym)} at ${usd(t.price)}</h2><span class="small muted">${ago(t.ts)} ago · ${f} of ${n} filled${bad ? ` · <span class="loss">${bad} failed</span>` : ''}</span></header>
        <div class="panel mtable"><table><thead><tr><th>Follower</th><th>Status</th><th>Suggested</th><th>Filled</th><th>Fill price</th><th>Slippage</th><th>Note</th></tr></thead><tbody>${t.followers.map(x => `<tr><td>${esc(x.follower)}${x.gid ? ' <span class="small muted">(group)</span>' : ''}</td><td class="${x.status === 'failed' ? 'loss' : ''}">${S[x.status] || x.status}</td><td>${x.suggested ? shs(x.suggested) : ''}</td><td>${x.filledQty != null ? shs(x.filledQty) : ''}</td><td>${x.fillPrice ? usd(x.fillPrice) : ''}</td><td>${x.slip != null ? (x.slip * 100).toFixed(2) + '%' : ''}</td><td style="white-space:normal">${esc(x.reason || '')}</td></tr>`).join('')}</tbody></table></div></section>`; }).join('') || '<div class="panel empty">No copied real-money trades yet. Have a test account trade while others copy it.</div>'}`;
}

/* Badges the Pocket team manages. */
function badgesPanel(){
  const all = Store.all('badges').filter(b => !b.builtin).sort((x, y) => (x.retired ? 1 : 0) - (y.retired ? 1 : 0) || (y.createdTs || 0) - (x.createdTs || 0));
  const f = Store.get('badges', 'founding') || {}, held = id => Store.all('profiles').filter(p => (p.badges || []).includes(id)).length;
  const colors = [['blue', 'Blue'], ['ember', 'Orange'], ['green', 'Green'], ['purple', 'Purple'], ['gray', 'Gray']];
  return `<section class="panel" style="padding:20px;margin-top:16px"><h2>Badges</h2><p class="muted small">Badges show on profiles and next to names in member lists. Stick to membership and roles; badges that suggest skill or results should be cleared with counsel first.</p>
    <div class="row" style="flex-wrap:wrap;gap:10px"><div class="grow" style="min-width:200px"><span class="tag ember">Founding member</span><div class="small muted">${f.cutoff ? 'Accounts created before ' + esc(f.cutoff) : 'Every account, until you set a cutoff date'}</div></div>
      <input class="input" type="date" id="bd-cut" aria-label="Founding member cutoff date" value="${esc(f.cutoff || '')}" style="width:auto"><button class="btn sm" data-act="badgefounding">Save cutoff</button></div>
    <h3 style="margin-top:16px">New badge</h3><div class="grid2"><div class="field"><label for="bd-n">Name</label><input class="input" id="bd-n" maxlength="24" placeholder="e.g. Beta tester"></div><div class="field"><label for="bd-c">Color</label><select class="input" id="bd-c">${colors.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
    <div class="field"><label for="bd-d">Description, shown when tapped</label><input class="input" id="bd-d" maxlength="120" placeholder="e.g. Helped test Pocket during the beta."></div><button class="btn sm" data-act="badgecreate">Create badge</button>
    <div class="list" style="margin-top:14px">${all.map(b => `<div class="row" style="flex-wrap:wrap;gap:8px;${b.retired ? 'opacity:.6' : ''}"><div class="grow" style="min-width:180px"><span class="tag ${b.color || 'blue'}">${esc(b.name)}</span> <span class="small muted">${held(b.id)} member${held(b.id) === 1 ? '' : 's'}${b.retired ? ' · retired' : ''}</span><div class="small muted">${esc(b.desc || '')}</div></div>
      <input class="input" id="bd-u-${b.id}" aria-label="Username to award or remove" placeholder="username" style="width:130px"><button class="btn sm ghost" data-act="badgeaward" data-id="${b.id}">Award</button><button class="btn sm ghost" data-act="badgeaward" data-id="${b.id}" data-k="remove">Remove</button>
      <input class="input" type="date" id="bd-b-${b.id}" style="width:auto" aria-label="Joined before"><button class="btn sm ghost" data-act="badgebulk" data-id="${b.id}">Award to all who joined before</button>
      <button class="btn sm ghost" data-act="badgeretire" data-id="${b.id}" data-k="${b.retired ? 'restore' : 'retire'}">${b.retired ? 'Restore' : 'Retire'}</button></div>`).join('') || '<div class="empty">No badges yet.</div>'}</div></section>`;
}

/* Beta insights: would-you-pay answers, the onboarding funnel, the one-week check-in, referrals, and groups with away leaders. */
function insightsPanel(){
  const real = Store.all('profiles').filter(p => p.kind !== 'demo' && String(p.id).startsWith('u_'));
  const seg = { 'Everyone': real, 'Leaders (copied by others)': real.filter(p => Store.all('copies').some(c => c.to === p.id)), 'Group owners': real.filter(p => Store.all('groups').some(g => g.ownerPid === p.id)), 'Copying someone': real.filter(p => Store.all('copies').some(c => c.from === p.id)) };
  const row = (label, list) => { const n = k => list.filter(p => p.wouldPay === k).length, tot = n('yes') + n('maybe') + n('no');
    return `<tr><td>${label}</td><td class="num">${tot}</td>${['yes', 'maybe', 'no'].map(k => `<td class="num">${n(k)}${tot ? ` <span class="muted small">(${Math.round(n(k) / tot * 100)}%)</span>` : ''}</td>`).join('')}</tr>`; };
  const weeks = {}; real.filter(p => p.wouldPay && p.wouldPayTs).forEach(p => { const d = new Date(p.wouldPayTs); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); const k = d.toISOString().slice(0, 10); (weeks[k] = weeks[k] || { yes: 0, maybe: 0, no: 0 })[p.wouldPay]++; });
  const I = ui.insights; if (!I){ ui.insights = 'loading'; Store.http('GET', '/api/admin/insights').then(r => { ui.insights = r; render(); }, e => { ui.insights = { error: e.message }; render(); }); }
  const R = leaderRule(), away = Store.all('groups').filter(g => !(g.vacation && g.vacation.until > Date.now()) && [g.ownerPid, g.leadPid].some(pid => pid && isAway(pid)));
  const tbl = (head, rows) => `<div style="overflow-x:auto"><table class="tbl" style="width:100%;font-size:14px"><thead><tr>${head.map(h => `<th style="text-align:left">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  let ins = '<div class="loading">Loading…</div>';
  if (I && I !== 'loading'){ if (I.error) ins = `<div class="empty">${esc(I.error)}</div>`; else {
    const F = I.funnel || [], pc = (a, b) => b ? ` <span class="muted small">${Math.round(a / b * 100)}%</span>` : '';
    ins = `<h3>Onboarding funnel</h3><p class="muted small">By week of sign-up (test accounts excluded). "Came back" means a visit between day 2 and day 7; visits are counted from this release on.</p>
      ${F.length ? tbl(['Week of', 'Signed up', 'First trade', 'Followed someone', 'Joined a group', 'Came back'], F.map(w => `<tr><td>${w.week}</td><td class="num">${w.signed_up}</td><td class="num">${w.traded}${pc(w.traded, w.signed_up)}</td><td class="num">${w.followed}${pc(w.followed, w.signed_up)}</td><td class="num">${w.joined_group}${pc(w.joined_group, w.signed_up)}</td><td class="num">${w.came_back}${pc(w.came_back, w.signed_up)}</td></tr>`).join('')) : '<div class="empty">No sign-ups in the last 10 weeks.</div>'}
      <h3 style="margin-top:18px">One-week check-in</h3><p class="small">${I.checkins.answered} answered, ${I.checkins.skipped} skipped${I.checkins.nps != null ? ` · recommend score <b>${I.checkins.nps}</b> <span class="muted">(share scoring 9–10 minus share scoring 0–6)</span>` : ''}</p>
      <div class="list">${I.checkins.comments.map(c => `<div class="row"><span class="tag">${c.score}</span><div class="grow small">${esc(c.comment)}</div><span class="small muted">${ago(new Date(c.ts).getTime())} ago</span></div>`).join('') || '<div class="empty">No comments yet.</div>'}</div>
      <h3 style="margin-top:18px">Referrals</h3>${I.referrals.length ? tbl(['Inviter', 'Friend', 'Deposit', 'Result', 'Withdrawn within 30 days'], I.referrals.map(r => `<tr><td>${esc(r.referrer || '')}</td><td>${esc(r.referred || '')}</td><td class="num">${usd(r.amount)}</td><td>${r.status === 'rewarded' ? '3 months of Pro' : esc(r.reason || r.status)}</td><td>${r.withdrawn30 > 0 ? `<span class="tag ember">${usd(r.withdrawn30)} withdrawn: review</span>` : '—'}</td></tr>`).join('')) : '<div class="empty">No qualifying referrals yet.</div>'}`; } }
  return `<section class="panel" style="padding:20px;margin-top:16px"><h2>Beta insights</h2>
    <h3>Would you pay for Pro?</h3>${tbl(['Members', 'Answered', 'Yes', 'Maybe', 'No'], Object.entries(seg).map(([k, v]) => row(k, v)).join(''))}
    ${Object.keys(weeks).length ? `<p class="small muted" style="margin:8px 0 0">By week answered: ${Object.entries(weeks).sort().map(([k, w]) => `${k}: ${w.yes} yes, ${w.maybe} maybe, ${w.no} no`).join(' · ')}</p>` : ''}
    <div style="margin-top:18px">${ins}</div>
    <h3 style="margin-top:18px">Pocket Leader milestone</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end"><div class="field" style="margin:0"><label for="lr-c">People copying them</label><input class="input num" id="lr-c" type="number" min="1" value="${R.copiers}" style="width:120px"></div><div class="field" style="margin:0"><label for="lr-m">Or members in a group they lead</label><input class="input num" id="lr-m" type="number" min="2" value="${R.members}" style="width:120px"></div><button class="btn sm" data-act="leaderrule">Save</button></div>
    <h3 style="margin-top:18px">Groups with an away leader</h3><p class="muted small">Owner or Lead Trader inactive for 30+ days, with no vacation mode set. Use this when members can't hold a vote.</p>
    <div class="list">${away.map(g => `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow" style="min-width:180px"><b>${esc(g.name)}</b><div class="small muted">Owner ${esc(Store.displayName(g.ownerPid))}${isAway(g.ownerPid) ? ' (away)' : ''} · Lead Trader ${esc(Store.displayName(g.leadPid))}${isAway(g.leadPid) ? ' (away)' : ''}</div></div>
      <select class="input" id="ar-${g.id}" style="width:auto">${Store.membersOf(g.id).filter(m => m.role !== 'observer' && !isAway(m.pid)).map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))}</option>`).join('')}</select>
      <button class="btn sm ghost" data-act="adminrole" data-gid="${g.id}" data-k="owner">Make Owner</button><button class="btn sm ghost" data-act="adminrole" data-gid="${g.id}" data-k="lead">Make Lead Trader</button></div>`).join('') || '<div class="empty">None right now.</div>'}</div></section>`;
}

/* Support inbox, complaints log, status incidents, idea statuses and outlook settings. */
function opsPanel(){
  const S = ui.admSupport, ST = ui.admStatus; if (!S){ ui.admSupport = 'loading'; Store.http('GET', '/api/admin/support').then(r => { ui.admSupport = r; render(); }, e => { ui.admSupport = { error: e.message }; }); }
  if (ST === undefined){ ui.admStatus = null; Store.http('GET', '/api/status').then(r => { ui.admStatus = r; render(); }, () => {}); }
  const reqs = S && S.requests ? S.requests : [], open = reqs.filter(r => r.status !== 'closed'), comp = reqs.filter(r => r.complaint);
  const fb = ((ui.admin || {}).feedback || []), STAT = [['received', 'Received'], ['considering', 'Under consideration'], ['planned', 'Planned'], ['live', 'Live'], ['notplanned', 'Not planned'], ['confirmed', 'Confirmed (bug)']];
  const what = f => { if (f.kind === 'badge'){ try { const b = JSON.parse(f.body); return `<b>Badge idea: ${esc(b.name)}</b> · ${esc(b.why)}${b.earn ? ' · Earn: ' + esc(b.earn) : ''}`; } catch(e){} } return `${f.kind === 'bug' ? '<b>Bug:</b> ' : ''}${esc(String(f.body || '').slice(0, 220))}`; };
  const O = Store.get('badges', 'outlookRule') || {}, n = (k, d) => O[k] != null ? O[k] : d;
  return `<section class="panel" style="padding:20px;margin-top:16px"><h2>Support</h2>${S && S.error ? `<div class="empty">${esc(S.error)}</div>` : ''}
    <div class="list">${open.map(r => `<details class="row" style="display:block"><summary style="cursor:pointer"><b>${esc(r.ref)}</b> · @${esc(r.username || '?')} · ${esc(r.topic)} <span class="tag">${esc(r.status)}</span>${r.complaint ? ' <span class="tag ember">Complaint</span>' : ''} <span class="small muted">${ago(new Date(r.updated_at).getTime())} ago</span></summary>
      <p class="small">${esc(r.body)}</p>${r.has_shot ? `<p class="small"><a href="/api/admin/support/${r.id}/screenshot" target="_blank">View screenshot</a></p>` : ''}${r.replies.map(x => `<div class="small" style="margin:4px 0"><b>${x.from_admin ? 'Pocket' : 'Member'}:</b> ${esc(x.body)}</div>`).join('')}
      <div class="field" style="margin-top:8px"><label for="as-r-${r.id}">Reply</label><textarea class="input" id="as-r-${r.id}" rows="2"></textarea></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button class="btn sm" data-act="admsup" data-id="${r.id}" data-k="answered">Send reply</button><button class="btn sm ghost" data-act="admsup" data-id="${r.id}" data-k="closed">Close</button><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="as-c-${r.id}" ${r.complaint ? 'checked' : ''}> Brokerage complaint</label><input class="input" id="as-o-${r.id}" placeholder="Outcome (for complaints)" value="${esc(r.outcome || '')}" style="flex:1;min-width:160px" aria-label="Outcome"></div></details>`).join('') || '<div class="empty">No open requests.</div>'}</div>
    <h3 style="margin-top:16px">Brokerage complaints log</h3><p class="muted small">Every request marked as a brokerage complaint, with dates and outcomes, ready to share with Alpaca.</p>
    <div class="list">${comp.map(r => `<div class="row"><div class="grow small"><b>${esc(r.ref)}</b> · @${esc(r.username || '?')} · received ${new Date(r.created_at).toLocaleDateString()} · ${esc(r.status)}<div class="muted">${esc(String(r.body).slice(0, 140))}</div><div>Outcome: ${esc(r.outcome || 'not recorded yet')}</div></div></div>`).join('') || '<div class="empty">No complaints.</div>'}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Status</h2><p class="muted small">Shown on the public <a href="/status" target="_blank">status page</a>, and as a banner in the app while active.</p>
    ${(ST && ST.active || []).map(i => `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow" style="min-width:200px"><b>${esc(i.title)}</b> <span class="tag ember">${esc(i.status)}</span><div class="small muted">${esc((i.updates[0] || {}).body || '')}</div></div><select class="input" id="in-s-${i.id}" style="width:auto"><option value="investigating">Investigating</option><option value="identified">Cause found</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></select><input class="input" id="in-b-${i.id}" placeholder="Update" style="flex:1;min-width:160px" aria-label="Update"><button class="btn sm" data-act="incupdate" data-id="${i.id}">Post update</button></div>`).join('') || '<p class="small">All systems working.</p>'}
    <h3>Post an incident</h3><div class="field"><label for="in-t">Title</label><input class="input" id="in-t" maxlength="120" placeholder="e.g. Prices are delayed"></div><div class="field"><label for="in-b">What's happening</label><input class="input" id="in-b" maxlength="1000"></div><button class="btn sm" data-act="inccreate">Post</button></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Ideas, bug reports and badge ideas</h2><p class="muted small">Members see these statuses in Help and are notified when they change.</p>
    <div class="list">${fb.slice(0, 60).map(f => `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow small" style="min-width:200px">${what(f)}<div class="muted">${f.username ? '@' + esc(f.username) + ' · ' : ''}${f.created_at ? ago(new Date(f.created_at).getTime()) + ' ago' : ''}</div></div><select class="input" id="fs-${f.id}" style="width:auto" aria-label="Status">${STAT.map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input" id="fn-${f.id}" placeholder="Note (optional)" value="${esc(f.note || '')}" style="width:160px" aria-label="Note"><button class="btn sm ghost" data-act="ideastatus" data-id="${f.id}">Save</button>${f.kind === 'badge' ? `<button class="btn sm ghost" data-act="ideatobadge" data-id="${f.id}">Create badge</button>` : ''}</div>`).join('') || '<div class="empty">Nothing yet.</div>'}</div></section>
  <section class="panel" style="padding:20px;margin-top:16px"><h2>Weekly outlook badges</h2><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    ${[['ob-wr', 'Weeks in a row (Weekly caller)', 'weeklyRun', 4], ['ob-rg', 'Weeks of the last 13 (Outlook regular)', 'regular', 12], ['ob-gc', 'Group polls (Group caller)', 'groupCalls', 10], ['ob-st', 'Correct in a row (Hot streak)', 'streak', 5], ['ob-sp', 'Sharp eye: % right', 'sharpPct', 70], ['ob-sm', 'Sharp eye: minimum calls', 'sharpMin', 20], ['ob-xp', 'Sector: % right', 'sectorPct', 70], ['ob-xm', 'Sector: minimum calls', 'sectorMin', 10], ['ob-xr', 'Sector regular: weeks of 10', 'sectorRegular', 8]].map(([id, l, k, d]) => `<div class="field" style="margin:0"><label for="${id}">${l}</label><input class="input num" id="${id}" type="number" value="${n(k, d)}" style="width:110px"></div>`).join('')}
    <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ob-acc" ${n('accuracyOn', true) ? 'checked' : ''}> Accuracy badges on</label><button class="btn sm" data-act="outlookrule">Save</button></div></section>`;
}

function legalDraftsPanel(){ const D = [['Terms of Service: proposed updates', 'terms-updates'], ['Privacy Policy: proposed updates', 'privacy-updates'], ['Referral program terms', 'referral-terms'], ['Subscription terms', 'subscription-terms']];
  return `<section class="panel" style="padding:20px;margin-top:16px"><h2>Legal drafts</h2><p class="muted small">Starting points for counsel. Not linked from the site, hidden from search engines, and marked "Draft. Not in effect."</p><div class="list">${D.map(([t, s]) => `<a class="row" href="/site/drafts/${s}.html" target="_blank"><div class="grow">${t}</div><span class="muted">↗</span></a>`).join('')}<a class="row" href="/site/guidelines.html" target="_blank"><div class="grow">Community guidelines (published, pending review)</div><span class="muted">↗</span></a><a class="row" href="/site/disclosures.html" target="_blank"><div class="grow">Disclosures (published, pending review)</div><span class="muted">↗</span></a></div></section>`; }
