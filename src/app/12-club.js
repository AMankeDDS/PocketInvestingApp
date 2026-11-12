/* Investment clubs: books, pooled accounts, money controls, meetings, ideas and uploads. */

function clubWaiting(){ if (!Store.signedIn) return []; if (!ui.cwait || Date.now() - ui.cwait.at > 60000){ const prev = ui.cwait; ui.cwait = Object.assign({ list: [] }, prev, { at: Date.now() }); Store.http('GET', '/api/club-waiting').then(r => { ui.cwait = { at: Date.now(), list: r.waiting || [] }; render(); }, () => {}); } return ui.cwait.list || []; }

function mayApprove(gid, pid, exclude){
  if (exclude.includes(pid)) return false;
  const ms = Store.membersOf(gid).filter(m => m.role !== 'observer' && !exclude.includes(m.pid));
  const officers = ms.filter(m => MONEY_OFFICERS.includes(m.role) && !(m.roleChangedTs && Date.now() - m.roleChangedTs < 3 * 86400000)).map(m => m.pid);
  return officers.length ? officers.includes(pid) : ms.some(m => m.pid === pid);
}

function moneyControls(gid, C){
  const B = C.book, closes = B.closes || [], cur = new Date().toISOString().slice(0, 7), start = (C.entries[0] || {}).date || cur;
  const months = []; for (let d = new Date(start.slice(0, 7) + '-15T12:00:00Z'); d.toISOString().slice(0, 7) < cur; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const locked = closes.filter(x => x.signedBy).map(x => x.month).sort().slice(-1)[0] || '', next = months.find(m => m > locked && !closes.some(x => x.month === m));
  const pend = closes.filter(x => !x.signedBy), nm = p => esc(Store.displayName(p)), fmt = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<section class="block"><header><h2>Monthly close</h2></header><div class="panel" style="padding:14px 18px">
    <p class="small muted" style="margin-top:0">An officer closes each month after checking the books against the account. A different person signs off, and the month is locked: corrections go in as new entries.</p>
    <div class="list">${closes.slice().reverse().slice(0, 6).map(x => `<div class="row"><div class="grow"><b>${fmt(x.month)}</b><div class="small muted">Closed by ${nm(x.preparedBy)} ${ago(x.preparedTs)} ago${x.signedBy ? ` · signed off by ${nm(x.signedBy)}` : ''}</div></div>
      ${x.signedBy ? '<span class="tag blue">Locked</span>' : mayApprove(gid, Store.myPid, [x.preparedBy]) && Store.canWrite ? `<button class="btn sm" data-act="cbsign" data-gid="${gid}" data-k="${x.month}">Sign off</button>` : '<span class="tag ember">Waiting for sign-off</span>'}</div>`).join('') || '<div class="empty">No months closed yet.</div>'}</div>
    ${C.canEdit && next && !pend.length && Store.canWrite ? `<p style="margin:10px 0 0"><button class="btn ghost sm" data-act="cbclose" data-gid="${gid}" data-k="${next}">Close ${fmt(next)}</button></p>` : ''}</div></section>
    <section class="block"><header><h2>Money log</h2></header><div class="list">${(C.log || []).slice(0, ui.clubLogAll ? 100 : 12).map(l => `<div class="row"><div class="grow small">${esc(l.text)}<div class="muted">${l.pid ? nm(l.pid) + ', ' : ''}${ago(l.ts)} ago</div></div></div>`).join('') || '<div class="empty">No money activity yet.</div>'}</div>
      ${(C.log || []).length > 12 && !ui.clubLogAll ? '<p style="margin-top:8px"><button class="linkbtn small" data-act="cblogall">Show all</button></p>' : ''}
      <p class="hint">Every addition, payment, withdrawal, approval, correction and money-role change is recorded here. Only club members can see it.</p></section>`;
}

/* ---------- voting participation: passive members are the risk in a pooled club ---------- */
function participation(gid, m){
  const since = Math.max(m.joinedTs || 0, Date.now() - 120 * 86400000), prs = Store.all('proposals').filter(p => p.gid === gid && p.createdTs >= since);
  if (!prs.length) return '';
  const voted = prs.filter(p => Store.get('votes', p.id + '__' + m.pid)).length, low = prs.length >= 3 && voted / prs.length < 0.5;
  return ` · voted on ${voted} of ${prs.length}${low ? ' <span class="tag ember" style="font-size:11px;padding:1px 6px">Mostly not voting</span>' : ''}`;
}

function ideasView(g, role){
  const full = role && role !== 'observer' && Store.canWrite, R = Store.rulesOf(g);
  const ws = Store.all('groupWatch').filter(w => w.gid === g.id).sort((a, b) => b.ts - a.ts), st = Store.all('studies').filter(s => s.gid === g.id).sort((a, b) => b.updatedTs - a.updatedTs);
  return `<p class="hint" style="margin-top:0">Stocks the group is considering, with research behind them. Turn a good idea into a proposal for a vote.</p>
    ${full ? `<div class="panel" style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="field" style="margin:0;flex:0 0 130px"><label for="gw-s">Stock</label><input class="input" id="gw-s" list="gw-list" placeholder="e.g. COST" autocapitalize="characters"><datalist id="gw-list">${Market.LIST.map(t => `<option value="${t.s}">${esc(t.n)}</option>`).join('')}</datalist></div>
      <div class="field" style="margin:0;flex:1;min-width:180px"><label for="gw-r">Why it's interesting</label><input class="input" id="gw-r" maxlength="200" placeholder="One line on the idea"></div><button class="btn" data-act="gwadd" data-gid="${g.id}">Add to watchlist</button></div>` : ''}
    <section class="block"><header><h2>Group watchlist</h2></header><div class="list">${ws.map(w => { const ch = Market.price(w.sym) / (w.price || Market.price(w.sym)) - 1, ns = st.filter(s => s.sym === w.sym).length;
      return `<div class="row" style="flex-wrap:wrap">${logo(w.sym)}<div class="grow" style="min-width:180px"><a href="#/stock/${w.sym}"><b>${w.sym}</b></a> <span class="small num ${sgn(ch)}">${pct(ch)} since added</span>
        <div class="small">${esc(w.reason || '')}</div><div class="small muted">Added by ${esc(Store.displayName(w.pid))} ${ago(w.ts)} ago${ns ? ` · ${ns} stud${ns === 1 ? 'y' : 'ies'}` : ''}</div></div>
        ${full ? `<button class="btn sm ghost" data-act="study" data-gid="${g.id}" data-k="${w.sym}">Write a study</button>${Store.canPropose(role, R) ? `<button class="btn sm ghost" data-act="propsym" data-gid="${g.id}" data-k="${w.sym}">Propose</button>` : ''}${w.pid === Store.myPid || Store.canManage(role) ? `<button class="btn sm ghost" data-act="gwdel" data-id="${w.id}" aria-label="Remove ${w.sym}">Remove</button>` : ''}` : ''}</div>`; }).join('') || '<div class="empty">Nothing on the watchlist yet.</div>'}</div></section>
    <section class="block"><header><h2>Stock studies</h2></header><div class="list">${st.map(s => `<details class="row" style="display:block"><summary style="cursor:pointer;display:flex;gap:10px;align-items:center">${logo(s.sym)}<div class="grow"><b>${s.sym}</b> <span class="tag ${VERDICT[s.verdict][1]}">${VERDICT[s.verdict][0]}</span><div class="small muted">by ${esc(Store.displayName(s.pid))}, ${ago(s.updatedTs)} ago, at ${usd(s.price)}</div></div></summary>
      <div class="small" style="margin:10px 0 0 4px;display:grid;gap:8px">${[['The business', s.business], ['Growth', s.growth], ['Valuation', s.valuation], ['Risks', s.risks]].filter(x => x[1]).map(([h, t]) => `<div><b>${h}</b><div style="white-space:pre-wrap">${esc(t)}</div></div>`).join('')}
      ${s.pid === Store.myPid && Store.canWrite ? `<div><button class="btn sm ghost" data-act="study" data-gid="${g.id}" data-k="${s.sym}" data-id="${s.id}">Edit</button></div>` : ''}</div></details>`).join('') || '<div class="empty">No studies yet. Pick a stock from the watchlist and write one.</div>'}</div></section>`;
}

function studySheet(gid, sym, id){
  const s = id ? Store.get('studies', id) : null;
  const f = (k, label, hint) => `<div class="field"><label for="st-${k}">${label}</label><textarea class="input" id="st-${k}" maxlength="1200" placeholder="${hint}">${esc((s && s[k]) || '')}</textarea></div>`;
  openModal(`<header><h2>Study: ${sym}</h2><button class="x" data-close aria-label="Close">×</button></header>
    ${f('business', 'The business', 'What it sells, to whom, and how it makes money')}${f('growth', 'Growth', 'Sales and earnings trend, and what drives it')}${f('valuation', 'Valuation', 'Is the price reasonable for that growth?')}${f('risks', 'Risks', 'What could go wrong')}
    <div class="field"><label for="st-v">Your view</label><select class="input" id="st-v">${Object.entries(VERDICT).map(([k, v]) => `<option value="${k}" ${(s ? s.verdict : 'watch') === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
    <button class="btn" id="st-go" style="width:100%">Save study</button><p class="hint" style="text-align:center;margin-top:10px">Studies are research for your group, not advice.</p>`, sh => {
    sh.querySelector('#st-go').onclick = async () => { const v = k => sh.querySelector('#st-' + k).value;
      try { await Store.saveStudy({ id, gid, sym, business: v('business'), growth: v('growth'), valuation: v('valuation'), risks: v('risks'), verdict: v('v') }); closeModal(); toast('Study saved.'); } catch(e){ errToast(e); } };
  });
}

function meetingsView(g, role){
  const runs = MEET_ROLES.includes(role) && Store.canWrite, ms = Store.all('meetings').filter(m => m.gid === g.id);
  const live = ms.filter(m => m.status === 'live'), up = ms.filter(m => m.status === 'scheduled').sort((a, b) => a.scheduledTs - b.scheduledTs), past = ms.filter(m => m.status === 'ended').sort((a, b) => b.endedTs - a.endedTs);
  const sel = Store.get('meetings', ui.meetingId) && Store.get('meetings', ui.meetingId).gid === g.id ? Store.get('meetings', ui.meetingId) : live[0] || up[0] || null;
  const when = m => new Date(m.scheduledTs).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const row = m => `<button class="row" style="width:100%;text-align:left;background:none;border:0;font:inherit;color:inherit;cursor:pointer" data-act="openmeeting" data-id="${m.id}"><div class="grow"><b>${esc(m.title)}</b><div class="small muted">${when(m)}</div></div><span class="tag ${m.status === 'live' ? 'ember' : ''}">${{ live: 'Live now', scheduled: 'Upcoming', ended: 'Ended' }[m.status]}</span></button>`;
  return `${runs ? `<div class="panel" style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="field" style="margin:0;flex:1;min-width:160px"><label for="mt-t">Meeting</label><input class="input" id="mt-t" maxlength="80" placeholder="e.g. November meeting"></div><div class="field" style="margin:0"><label for="mt-d">When</label><input class="input" id="mt-d" type="datetime-local"></div><button class="btn" data-act="newmeeting" data-gid="${g.id}">Schedule</button></div>` : ''}
    ${sel ? meetingDetail(sel, g, role) : '<div class="panel empty" style="margin-top:14px">No meetings scheduled.</div>'}
    ${live.concat(up).filter(m => !sel || m.id !== sel.id).length ? `<section class="block"><header><h2>Upcoming</h2></header><div class="list">${live.concat(up).filter(m => !sel || m.id !== sel.id).map(row).join('')}</div></section>` : ''}
    ${past.filter(m => !sel || m.id !== sel.id).length ? `<section class="block"><header><h2>Past meetings</h2></header><div class="list">${past.filter(m => !sel || m.id !== sel.id).slice(0, 12).map(row).join('')}</div></section>` : ''}`;
}

function meetingDetail(m, g, role){
  const runs = MEET_ROLES.includes(role) && Store.canWrite, full = role && role !== 'observer';
  const members = Store.membersOf(g.id).filter(x => x.role !== 'observer'), here = Object.keys(m.attendance || {});
  const prev = Store.all('meetings').filter(x => x.gid === g.id && x.status === 'ended' && x.id !== m.id && x.endedTs < (m.startedTs || m.scheduledTs)).sort((a, b) => b.endedTs - a.endedTs)[0];
  const since = prev ? prev.endedTs : (g.createdTs || 0), until = m.endedTs || Date.now();
  const open = Store.all('proposals').filter(p => p.gid === g.id && !Store.tally(p.id).closed);
  const trades = Store.all('posts').filter(p => p.groupId === g.id && p.groupTrade && p.trade && p.ts > since && p.ts <= until);
  const watch = Store.all('groupWatch').filter(w => w.gid === g.id && w.ts > since && w.ts <= until), studies = Store.all('studies').filter(s => s.gid === g.id && s.updatedTs > since && s.updatedTs <= until);
  const pot = g.pooled ? Store.get('portfolios', 'club_' + g.id) : null;
  return `<div class="panel" style="padding:18px 20px;margin-top:14px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><h2 style="margin:0">${esc(m.title)}</h2><div class="small muted">${new Date(m.scheduledTs).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${full && m.status !== 'ended' && !m.attendance[Store.myPid] && Store.canWrite ? `<button class="btn sm" data-act="checkin" data-id="${m.id}">I'm here</button>` : ''}${runs && m.status === 'scheduled' ? `<button class="btn sm ember" data-act="meetstart" data-id="${m.id}">Start meeting</button>` : ''}${runs && m.status === 'live' ? `<button class="btn sm ghost" data-act="meetend" data-id="${m.id}">End meeting</button>` : ''}</div></div>
    <p class="small" style="margin:12px 0 0"><b>Attendance:</b> ${here.length} of ${members.length} members${here.length ? ': ' + here.map(p => esc(Store.displayName(p))).join(', ') : ''}</p></div>
    <section class="block"><header><h2>1. Votes</h2></header><div class="list">${open.map(p => proposalCard(p, role)).join('') || '<div class="empty">No open proposals.</div>'}</div></section>
    <section class="block"><header><h2>2. Since the last meeting</h2></header><div class="panel" style="padding:14px 18px" class="small">
      <div class="small"><b>Trades:</b> ${trades.length ? trades.map(t => `${t.trade.side === 'sell' ? 'Sold' : 'Bought'} ${t.trade.sym}`).join(', ') : 'none'}</div>
      <div class="small" style="margin-top:6px"><b>Added to the watchlist:</b> ${watch.length ? watch.map(w => w.sym).join(', ') : 'none'}</div>
      <div class="small" style="margin-top:6px"><b>New studies:</b> ${studies.length ? studies.map(s => `${s.sym} (${esc(Store.displayName(s.pid))})`).join(', ') : 'none'}</div>
      ${pot ? `<div class="small" style="margin-top:6px"><b>Club account:</b> ${usd(Store.portfolioValue(pot))}, of which ${usd(pot.cash)} cash</div>` : `<div class="small" style="margin-top:6px"><b>Club money:</b> see <a href="#/group/${g.id}/club">Club books</a></div>`}</div></section>
    <section class="block"><header><h2>3. Other business</h2></header><div class="list">${(m.notes || []).map(n => `<div class="row"><div class="grow">${esc(n.text)}<div class="small muted">${esc(Store.displayName(n.by))}</div></div></div>`).join('') || '<div class="empty">Nothing else on the agenda.</div>'}</div>
      ${runs && m.status !== 'ended' ? `<div style="display:flex;gap:8px;margin-top:10px"><input class="input" id="mn-t" maxlength="200" placeholder="Add an agenda item"><button class="btn sm ghost" data-act="meetnote" data-id="${m.id}">Add</button></div>` : ''}</section>
    <section class="block"><header><h2>Minutes</h2></header>${runs ? `<textarea class="input" id="mm-t" maxlength="5000" style="min-height:120px" placeholder="Decisions, who's doing what, and next steps">${esc(m.minutes || '')}</textarea><p style="margin-top:8px"><button class="btn sm" data-act="meetsave" data-id="${m.id}">Save minutes</button></p>` : `<div class="panel" style="padding:14px 18px;white-space:pre-wrap" class="small">${esc(m.minutes || 'No minutes yet.')}</div>`}</section>`;
}

function uploadSheet(gid, kind){
  const doc = kind === 'document';
  openModal(`<header><h2>${doc ? 'Send a club document' : 'Send proof of payment'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">${doc ? 'The Pocket team reviews club documents before a pooled club can open a real account. Files stay private to your club and the Pocket team.' : "Upload a receipt or screenshot of your payment to the club. Your Treasurer reviews it, and once it's confirmed it's added to the club books."}</p>
    ${doc ? `<div class="field"><label for="up-t">Document</label><select class="input" id="up-t">${DOC_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>` : `<div class="grid2"><div class="field"><label for="up-a">Amount paid ($)</label><input class="input num" id="up-a" inputmode="decimal"></div><div class="field"><label for="up-d">Date paid</label><input class="input" id="up-d" type="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>`}
    <div class="field"><label for="up-f">File (photo or PDF, up to 5 MB)</label><input class="input" id="up-f" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
    <div class="field"><label for="up-n">Note (optional)</label><input class="input" id="up-n" maxlength="300" placeholder="${doc ? 'Anything the Pocket team should know' : 'e.g. November dues, paid by Zelle'}"></div>
    <button class="btn" id="up-go" style="width:100%">Send</button>`, sh => {
    sh.querySelector('#up-go').onclick = async () => { const b = sh.querySelector('#up-go'); b.disabled = true;
      try { const file = await readFile64(sh.querySelector('#up-f').files[0]); const body = { kind, file, note: sh.querySelector('#up-n').value };
        if (doc) body.docType = sh.querySelector('#up-t').value; else { body.amount = Number(sh.querySelector('#up-a').value); body.date = sh.querySelector('#up-d').value; }
        ui.club[gid] = await Store.http('POST', `/api/club/${gid}/submit`, body); closeModal(); toast(doc ? 'Sent to the Pocket team for review.' : 'Sent to your Treasurer for review.'); render(); }
      catch(e){ errToast(e); b.disabled = false; } };
  });
}

function submissionRow(gid, x, editor){
  const st = STATUS[x.status], fileLink = x.fileId ? ` · <a href="/api/club/${gid}/file/${x.fileId}" target="_blank" rel="noopener">View file</a>` : '';
  const what = x.kind === 'document' ? esc(x.docType) : x.kind === 'distribution' ? `Final payout to all members (${usd(x.amount)})` : x.exit ? `Exit payout, leaving the club (about ${usd(x.amount)})` : x.kind === 'withdrawal' ? `Withdrawal of ${usd(x.amount)}` : `Payment of ${usd(x.amount)} on ${esc(x.date)}`;
  return `<div class="row" style="flex-wrap:wrap;align-items:flex-start"><div class="grow" style="min-width:200px"><b>${what}</b>${x.kind !== 'document' && editor ? ' · ' + esc(Store.displayName(x.pid)) : ''} <span class="tag ${st[1]}" style="font-size:11px">${x.kind === 'document' ? { pending: 'Waiting for Pocket review', confirmed: 'Verified by Pocket', declined: 'Needs changes' }[x.status] : st[0]}</span>
    <div class="small muted">${ago(x.ts)} ago${x.note ? ' · ' + esc(x.note) : ''}${fileLink}</div>${x.reviewNote ? `<div class="small" style="margin-top:4px"><b>Note:</b> ${esc(x.reviewNote)}</div>` : ''}</div>
    ${['withdrawal', 'distribution'].includes(x.kind) && x.status === 'pending' ? `<div class="small" style="width:100%;margin-top:4px">Approvals: ${(x.approvals || []).length} of ${x.needed || 2}${(x.approvals || []).length ? ' (' + x.approvals.map(a => esc(Store.displayName(a.pid))).join(', ') + ')' : ''}</div>` : ''}
    ${editor && x.status === 'pending' && x.kind !== 'document' && mayApprove(gid, Store.myPid, (x.kind === 'distribution' ? [] : [x.pid]).concat(x.initiatedBy ? [x.initiatedBy] : []).concat((x.approvals || []).map(a => a.pid))) ? `<button class="btn sm" data-act="cbreview" data-gid="${gid}" data-id="${x.id}" data-k="confirmed" data-v="${x.kind === 'distribution' ? 'withdrawal' : x.kind}">${x.kind === 'payment' ? 'Confirm' : 'Approve'}</button><button class="btn sm ghost" data-act="cbreview" data-gid="${gid}" data-id="${x.id}" data-k="declined" data-v="${x.kind === 'distribution' ? 'withdrawal' : x.kind}">Decline</button>` : ''}</div>`;
}

function clubRequests(gid, C){
  const subs = C.submissions || [], editor = C.canEdit || mayApprove(gid, Store.myPid, []), mine = subs.filter(x => x.pid === Store.myPid && x.kind !== 'document'), queue = editor ? subs.filter(x => x.kind !== 'document' && x.status === 'pending' && (x.kind === 'distribution' || x.pid !== Store.myPid)) : [];
  const docs = subs.filter(x => x.kind === 'document');
  const meR = (Store.membership(gid) || {}).role;
  return `${MONEY_OFFICERS.includes(meR) && !Store.twofa ? `<div class="banner ember" style="margin-top:14px"><div style="flex:1"><b>Turn on two-step sign-in</b><div class="small">Officers need it to approve or record club money.</div></div><a class="btn sm" href="#/u/${Store.myPid}">Set it up</a></div>` : ''}
    ${C.roleWaitUntil && C.roleWaitUntil > Date.now() ? `<div class="banner" style="margin-top:14px">Your new money role can approve things from ${new Date(C.roleWaitUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Until then, other officers approve.</div>` : ''}
    ${queue.length ? `<section class="block"><header><h2>Waiting for review</h2></header><div class="list">${queue.map(x => submissionRow(gid, x, true)).join('')}</div></section>` : ''}
    ${mine.length ? `<section class="block"><header><h2>Your requests</h2></header><div class="list">${mine.slice(0, 10).map(x => submissionRow(gid, x, false)).join('')}</div></section>` : ''}
    <section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Club documents</h2>${editor ? `<button class="btn ghost sm" data-act="cbupload" data-gid="${gid}" data-k="document">Send a document</button>` : ''}</header>
      <div class="list">${docs.map(x => submissionRow(gid, x, false)).join('') || '<div class="empty">No documents yet. A pooled club needs its LLC or partnership papers and tax ID letter verified before it can open a real account.</div>'}</div></section>`;
}

function pooledClub(gid, C){
  const pot = Store.get('portfolios', 'club_' + gid) || { cash: 0, positions: {} }, V = Store.portfolioValue(pot), uv = C.units > 1e-9 ? V / C.units : C.book.startUnitValue;
  const me = C.members.find(m => m.pid === Store.myPid), mineV = me ? me.units * uv : 0, full = Store.canWrite;
  const held = Object.entries(pot.positions || {}).map(([s, p]) => [s, p.shares, p.shares * Market.price(s)]).sort((a, b) => b[2] - a[2]);
  return `<div class="panel" style="padding:18px 20px"><div class="kv"><div><span>Club account</span><b>${usd(V)}</b></div><div><span>Cash</span><b>${usd(pot.cash)}</b></div><div><span>Unit value</span><b>${usd(uv)}</b></div><div><span>Units</span><b>${u3(C.units)}</b></div></div>
      <div class="est" style="display:block;margin-top:12px"><b>Your share: ${usd(mineV)} (${C.units > 1e-9 && me ? (me.units / C.units * 100).toFixed(1) : '0.0'}%)</b><div class="small muted" style="margin-top:4px">${me ? u3(me.units) : '0.000'} units · added ${usd(me ? me.paid : 0)} · withdrawn ${usd(me ? me.withdrawn : 0)}</div></div>
      ${(() => { const g = Store.get('groups', gid) || {}, my = (Store.membership(gid) || {}).role, officer = MONEY_OFFICERS.includes(my);
        if (g.closed) return `<div class="banner" style="margin-top:12px">The club closed ${new Date(g.closed.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Every member was paid out their share.</div>`;
        if (g.windDown) return `<div class="banner ember" style="margin-top:12px;display:block"><b>Closing the club.</b> Members voted to wind it down: sell all holdings, then pay everyone out by their units (two approvals).
          ${full && (officer || my === 'lead') ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${held.length ? `<button class="btn sm" data-act="potsellall" data-gid="${gid}">Sell all holdings</button>` : ''}${!held.length && officer ? `<button class="btn sm" data-act="potdistribute" data-gid="${gid}">Pay everyone out</button>` : ''}</div>` : ''}</div>`;
        return full ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" data-act="potadd" data-gid="${gid}">Add money</button><button class="btn ghost" data-act="potwd" data-gid="${gid}">Request a withdrawal</button>${my && my !== 'owner' ? `<button class="btn ghost" data-act="potexit" data-gid="${gid}">Leave and get paid out</button>` : ''}</div>` : ''; })()}
      <p class="hint" style="margin-top:10px">Practice money. The club trades only after a member vote: create a trade proposal, and once it passes the Lead Trader, Owner or an Admin executes it for the club.</p></div>
    <section class="block"><header><h2>Club holdings</h2></header><div class="list">${held.map(([s, sh, v]) => `<a class="row" href="#/stock/${s}">${logo(s)}<div class="grow"><b>${s}</b> <span class="small muted">${shs(sh)} shares</span></div><b class="num">${usd(v)}</b></a>`).join('') || '<div class="empty">The club holds only cash so far.</div>'}</div></section>`;
}

function potSheet(gid, kind){
  const mine = Store.get('portfolios', Store.myPid) || { cash: 0 };
  openModal(`<header><h2>${kind === 'add' ? 'Add money to the club' : 'Request a withdrawal'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">${kind === 'add' ? `Moves practice cash from your portfolio into the club, buying units at today's unit value. You have ${usd(mine.cash)} in cash.` : "The Treasurer, Owner or an Admin approves withdrawals. The club needs enough cash; members can vote to sell holdings first."}</p>
    <div class="field"><label for="pt-a">Amount ($)</label><input class="input num" id="pt-a" inputmode="decimal"></div>
    ${kind === 'add' ? '' : '<div class="field"><label for="pt-n">Note (optional)</label><input class="input" id="pt-n" maxlength="300"></div>'}
    <button class="btn" id="pt-go" style="width:100%">${kind === 'add' ? 'Add to the club' : 'Send request'}</button>`, sh => {
    sh.querySelector('#pt-go').onclick = async () => { const amt = Number(sh.querySelector('#pt-a').value);
      try { if (kind === 'add') await Store.clubContribute(gid, amt); else await Store.clubRequestWithdrawal(gid, amt, sh.querySelector('#pt-n').value);
        ui.club[gid] = null; closeModal(); toast(kind === 'add' ? 'Added to the club.' : 'Request sent.'); render(); } catch(e){ errToast(e); } };
  });
}


/* ---------- club books (unit value accounting; private to full members) ---------- */
function clubView(gid, role){
  ui.club = ui.club || {}; const C = ui.club[gid];
  if (!C){ ui.club[gid] = 'loading'; Store.http('GET', '/api/club/' + gid).then(r => { ui.club[gid] = r; render(); }, e => { ui.club[gid] = { error: e.message }; render(); }); }
  if (!C || C === 'loading') return '<div class="loading" style="min-height:20vh">Loading…</div>';
  if (C.error) return `<div class="panel empty">${esc(C.error)}</div>`;
  const today = new Date().toISOString().slice(0, 10), nm = pid => esc(Store.displayName(pid));
  if (!C.book) return `<div class="panel" style="padding:22px"><h2>Club books</h2><p class="muted">Keep your club's money records here: monthly dues, withdrawals, and the club's value, with each member's share worked out using the unit value system that investment clubs use.</p>
    ${C.canEdit ? `<div class="grid2"><div class="field"><label for="cb-d">Books start on</label><input class="input" id="cb-d" type="date" value="${today}"></div><div class="field"><label for="cb-u">Monthly dues per member (optional)</label><input class="input num" id="cb-u" inputmode="decimal" placeholder="e.g. 50"></div></div>
      <p class="hint">Already have club money? After setup, record each member's current balance as an opening payment, then enter valuations as usual.</p><button class="btn" data-act="cbsetup" data-gid="${gid}">Start the club books</button>`
      : '<p class="hint">Ask your Treasurer, Owner or an Admin to start the club books.</p>'}</div>`;
  const numLine = C.numbers && C.numbers.club ? `<p class="small muted" style="margin:0 0 10px">Club account <b class="num">${esc(C.numbers.club)}</b>${C.numbers.mine ? ` · Your stake <b class="num">${esc(C.numbers.mine)}</b>` : ''} · <a href="#/statements">Statements</a></p>` : '';
  if (C.pooled) return numLine + pooledClub(gid, C) + clubRequests(gid, C) + clubLedgerTables(gid, C, true) + moneyControls(gid, C);
  const me = C.members.find(m => m.pid === Store.myPid), lastVal = C.entries.filter(e => e.kind === 'valuation').slice(-1)[0];
  const years = Object.keys(C.years).sort().reverse(), yr = ui.clubYear && C.years[ui.clubYear] ? ui.clubYear : years[0];
  const kindWord = { valuation: 'Valuation', payment: 'Payment', withdrawal: 'Withdrawal' };
  return `${numLine}${C.problem ? '<div class="banner" style="margin-bottom:14px">One withdrawal is larger than that member owned. Check the ledger.</div>' : ''}
    <div class="panel" style="padding:18px 20px"><div class="kv"><div><span>Club value (latest valuation plus payments since)</span><b>${usd(C.value)}</b></div><div><span>Unit value</span><b>${usd(C.unitValue)}</b></div><div><span>Units</span><b>${u3(C.units)}</b></div><div><span>Last valuation</span><b>${lastVal ? esc(lastVal.date) : '—'}</b></div></div>
      ${me ? `<div class="est" style="display:block;margin-top:12px"><b>Your share: ${usd(me.value)} (${(me.share * 100).toFixed(1)}%)</b><div class="small muted" style="margin-top:4px">${u3(me.units)} units · paid in ${usd(me.paid)} · withdrawn ${usd(me.withdrawn)} · gain <span class="${sgn(me.gain)}">${me.gain >= 0 ? '+' : '−'}${usd(Math.abs(me.gain))}</span></div></div>` : ''}</div>
    ${Store.canWrite ? `<div style="margin:14px 0 0"><button class="btn ghost sm" data-act="cbupload" data-gid="${gid}" data-k="payment">Send proof of payment</button></div>` : ''}
    ${clubRequests(gid, C)}
    ${C.canEdit ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0"><button class="btn" data-act="cbentry" data-gid="${gid}" data-k="dues">Record dues for everyone</button><button class="btn ghost sm" data-act="cbentry" data-gid="${gid}" data-k="payment">Payment</button><button class="btn ghost sm" data-act="cbentry" data-gid="${gid}" data-k="withdrawal">Withdrawal</button><button class="btn ghost sm" data-act="cbentry" data-gid="${gid}" data-k="valuation">Valuation</button></div>` : '<p class="hint" style="margin:12px 0">The Treasurer, Owner and Admins keep these books. Every full member can see them.</p>'}
    ${clubLedgerTables(gid, C, false)}${moneyControls(gid, C)}`;
}

function clubLedgerTables(gid, C, pooled){
  const nm = pid => esc(Store.displayName(pid)), kindWord = { valuation: 'Valuation', payment: pooled ? 'Added' : 'Payment', withdrawal: 'Withdrawal' };
  const years = Object.keys(C.years).sort().reverse(), yr = ui.clubYear && C.years[ui.clubYear] ? ui.clubYear : years[0];
  const pot = pooled ? Store.get('portfolios', 'club_' + gid) : null, liveUV = pot && C.units > 1e-9 ? Store.portfolioValue(pot) / C.units : null;
  const M = C.members.map(m => liveUV ? Object.assign({}, m, { value: m.units * liveUV, gain: m.units * liveUV + m.withdrawn - m.paid }) : m);
  C = Object.assign({}, C, { members: M, canEdit: C.canEdit && !pooled });
  return `<section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Members</h2><a class="btn ghost sm" href="/api/club/${gid}/csv" download>Download CSV</a></header><div class="panel mtable"><table><thead><tr><th>Member</th>${C.numbers && Object.keys(C.numbers.members || {}).length ? '<th>Account</th>' : ''}<th>Units</th><th>Value</th><th>Share</th><th>Paid in</th><th>Withdrawn</th><th>Gain</th></tr></thead>
      <tbody>${C.members.map(m => `<tr><td>${nm(m.pid)}${m.former ? ' <span class="muted">(former)</span>' : ''}</td>${C.numbers && Object.keys(C.numbers.members || {}).length ? `<td class="num">${esc((C.numbers.members || {})[m.pid] || '')}</td>` : ''}<td>${u3(m.units)}</td><td>${usd(m.value)}</td><td>${(m.share * 100).toFixed(1)}%</td><td>${usd(m.paid)}</td><td>${usd(m.withdrawn)}</td><td class="${sgn(m.gain)}">${m.gain >= 0 ? '+' : '−'}${usd(Math.abs(m.gain))}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="block"><header><h2>Ledger</h2></header><div class="list">${C.entries.slice().reverse().map(e => `<div class="row"><div class="grow"><b style="${e.voided ? 'text-decoration:line-through' : ''}">${kindWord[e.kind]}</b>${e.pid ? ' · ' + nm(e.pid) : ''} <span class="small muted">${esc(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</span>${e.voided ? ` <span class="tag" style="font-size:11px">Voided: ${esc(e.voided.reason)}</span>` : ''}
      <div class="small muted">${e.voided ? usd(e.amount) + ' (not counted)' : e.kind === 'valuation' ? `Club value ${usd(e.amount)}, unit value ${usd(e.unitValue)}` : `${usd(e.amount)} at ${usd(e.unitValue)} a unit = ${u3(e.units)} units`}</div></div>
      ${C.canEdit && e.note !== 'Books started' && !e.voided && Store.canWrite ? `<button class="btn sm ghost" data-act="cbvoid" data-gid="${gid}" data-id="${e.id}" aria-label="Void entry">Void</button>` : ''}</div>`).join('')}</div></section>
    ${years.length ? `<section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Year-end summary</h2><div class="seg">${years.map(y => `<button class="${y === yr ? 'on' : ''}" data-act="cbyear" data-k="${y}">${y}</button>`).join('')}</div></header>
      <div class="panel mtable"><table><thead><tr><th>Member</th><th>Start of year</th><th>Paid in</th><th>Withdrawn</th><th>End of year</th><th>Gain</th></tr></thead><tbody>${(C.years[yr] || []).map(r => `<tr><td>${nm(r.pid)}</td><td>${usd(r.startValue)}</td><td>${usd(r.paid)}</td><td>${usd(r.withdrawn)}</td><td>${usd(r.endValue)}</td><td class="${sgn(r.gain)}">${r.gain >= 0 ? '+' : '−'}${usd(Math.abs(r.gain))}</td></tr>`).join('')}</tbody></table></div>
      ${(() => { const rv = (C.book.yearReviews || {})[yr], me = Store.membership(gid); return rv ? `<p class="small" style="margin:10px 0 0"><span class="tag blue">Reviewed</span> by ${nm(rv.pid)} ${ago(rv.ts)} ago${rv.note ? ': ' + esc(rv.note) : ''}</p>`
        : me && !MONEY_OFFICERS.includes(me.role) && me.role !== 'observer' && Store.canWrite ? `<p style="margin:10px 0 0"><button class="btn ghost sm" data-act="cbyrrev" data-gid="${gid}" data-k="${yr}">Mark ${yr} reviewed</button> <span class="hint">A member who isn't a money officer checks the year's books.</span></p>` : '<p class="hint" style="margin-top:10px">Not yet reviewed. A member who isn\'t a money officer reviews each year.</p>'; })()}
      <p style="margin:10px 0 0;display:flex;gap:8px;flex-wrap:wrap">${C.canEdit || MONEY_OFFICERS.includes((Store.membership(gid) || {}).role) ? `<a class="btn ghost sm" href="/api/club/${gid}/tax-packet.pdf?year=${yr}" download>Tax packet for your preparer (PDF)</a><a class="btn ghost sm" href="/api/club/${gid}/tax-packet.csv?year=${yr}" download>Tax packet (CSV)</a>` : `<a class="btn ghost sm" href="/api/club/${gid}/tax-packet.pdf?year=${yr}" download>Your K-1 worksheet (PDF)</a>`}</p>
      <p class="hint">Most investment clubs are taxed as partnerships, which file a partnership return and give each member a Schedule K-1. Share these figures with whoever prepares the club's taxes; this summary isn't a tax form.</p></section>` : ''}
    <details style="margin-top:16px"><summary class="small">How unit values work</summary><p class="small muted">Each payment buys units at the latest unit value, so members who join later or pay different amounts are treated fairly. A valuation sets the club's total value; dividing by all units gives the new unit value. Your share is your units times the unit value.</p></details>`;
}

function clubEntrySheet(gid, kind){
  const C = ui.club[gid], today = new Date().toISOString().slice(0, 10);
  const ms = Store.membersOf(gid).filter(m => m.role !== 'observer');
  const title = { dues: 'Record dues for everyone', payment: 'Record a payment', withdrawal: 'Record a withdrawal', valuation: 'Record a valuation' }[kind];
  openModal(`<header><h2>${title}</h2><button class="x" data-close aria-label="Close">×</button></header>
    ${kind === 'valuation' ? '<p class="muted" style="margin-top:0">Enter the total value of the club account on this date: cash plus holdings, from your brokerage statement.</p>' : kind === 'dues' ? `<p class="muted" style="margin-top:0">Adds a payment for each of the ${ms.length} full members. You can delete any that didn't pay.</p>` : ''}
    ${kind === 'payment' || kind === 'withdrawal' ? `<div class="field"><label for="ce-p">Member</label><select class="input" id="ce-p">${ms.map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))}</option>`).join('')}</select></div>` : ''}
    <div class="grid2"><div class="field"><label for="ce-a">${kind === 'valuation' ? 'Club value ($)' : 'Amount ($)'}</label><input class="input num" id="ce-a" inputmode="decimal" value="${kind === 'dues' && C.book.dues ? C.book.dues : ''}"></div><div class="field"><label for="ce-d">Date</label><input class="input" id="ce-d" type="date" value="${today}"></div></div>
    ${kind === 'dues' ? '' : '<div class="field"><label for="ce-n">Note (optional)</label><input class="input" id="ce-n" maxlength="200" placeholder="e.g. Opening balance"></div>'}
    <button class="btn" id="ce-go" style="width:100%">Save</button>`, sh => {
    sh.querySelector('#ce-go').onclick = async () => { const v = id => (sh.querySelector('#' + id) || {}).value;
      try { const body = { amount: Number(v('ce-a')), date: v('ce-d') };
        ui.club[gid] = kind === 'dues' ? await Store.http('POST', `/api/club/${gid}/dues`, body) : await Store.http('POST', `/api/club/${gid}/entry`, Object.assign(body, { kind, pid: v('ce-p'), note: v('ce-n') || '' }));
        ui.club[gid].canEdit = true; closeModal(); toast('Saved.'); render(); } catch(e){ errToast(e); } };
  });
}

function pfSeries(pf, span = 86400000, n = 48){
  const now = Date.now(), out = [];
  for (let i = n - 1; i >= 0; i--){ const t = now - span * i / (n - 1); let v = pf.cash || 0; for (const [s, p] of Object.entries(pf.positions || {})) v += p.shares * Market.price(s, t); out.push(v); }
  return out;
}
