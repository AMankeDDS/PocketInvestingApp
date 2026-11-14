/* Vacation mode, away leaders, the Pocket Leader milestone, referrals, the one-week check-in and the home-screen prompt. */
const DAY = 86400000, fmtDate = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const isAway = pid => { const p = Store.get('profiles', pid); return !!p && !!p.away; }; /* the server works this out, so activity times stay private */
function groupLeaderPanel(g){
  const v = g.vacation && g.vacation.until > Date.now() ? g.vacation : null, me = Store.myPid, my = Store.membership(g.id);
  if (v) return `<div class="banner text" style="margin-top:12px;font-size:14px"><b>${esc(Store.displayName(v.byPid))} is away until ${fmtDate(v.until)}.</b> ${esc(Store.displayName(v.standIn))} is in charge as ${v.role === 'owner' ? 'Owner' : 'Lead Trader'} until then.${[v.byPid, v.standIn].includes(me) ? ` <button class="linkbtn small" data-act="vacationend" data-gid="${g.id}">End vacation mode</button>` : ''}</div>`;
  let out = '';
  if (Store.canWrite && (g.ownerPid === me || g.leadPid === me)) out += `<div style="margin-top:10px"><button class="linkbtn small" data-act="vacation" data-gid="${g.id}">Going away? Turn on vacation mode</button></div>`;
  const away = [['owner', g.ownerPid], ['lead', g.leadPid]].filter(([, pid], i, a) => pid && isAway(pid) && a.findIndex(x => x[1] === pid) === i);
  if (away.length && my && my.role !== 'observer' && !away.some(([, pid]) => pid === me)) out += `<div class="banner text ember" style="margin-top:12px;font-size:14px"><b>${esc(Store.displayName(away[0][1]))} hasn't been active for over 30 days.</b> Members can vote on a new ${away[0][0] === 'owner' ? 'Owner' : 'Lead Trader'}. <button class="linkbtn small" data-act="awaypropose" data-gid="${g.id}" data-k="${away[0][0]}">Propose a replacement</button></div>`;
  return out;
}
function vacationSheet(gid){
  const g = Store.get('groups', gid), me = Store.myPid, roles = [g.ownerPid === me ? ['owner', 'Owner'] : null, g.leadPid === me ? ['lead', 'Lead Trader'] : null].filter(Boolean);
  const ms = Store.membersOf(gid).filter(m => m.pid !== me && m.role !== 'observer'), max = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10), min = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  openModal(`<header><h2>Vacation mode</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Pick someone to stand in while you're away. They get your role's powers until your return date, then it switches back automatically. Members are notified.</p>
    ${roles.length > 1 ? `<div class="field"><label for="va-r">Role to hand over</label><select class="input" id="va-r">${roles.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>` : `<input type="hidden" id="va-r" value="${roles[0][0]}">`}
    <div class="field"><label for="va-s">Stand-in</label><select class="input" id="va-s">${ms.map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))}</option>`).join('') || '<option value="">No other members yet</option>'}</select></div>
    <div class="field"><label for="va-u">Back on</label><input class="input" type="date" id="va-u" min="${min}" max="${max}" value="${new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10)}"></div>
    <div class="hint" id="va-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="va-go" style="width:100%" ${ms.length ? '' : 'disabled'}>Turn on vacation mode</button>`, sh => {
    sh.querySelector('#va-go').onclick = async () => { const b = sh.querySelector('#va-go'); b.disabled = true; try { await Store.http('POST', '/api/action/startVacation', { gid, role: sh.querySelector('#va-r').value, standIn: sh.querySelector('#va-s').value, until: sh.querySelector('#va-u').value }); closeModal(); toast('Vacation mode is on.'); } catch(e){ sh.querySelector('#va-e').textContent = e.message; b.disabled = false; } };
  });
}
function awaySheet(gid, role){
  const g = Store.get('groups', gid), holder = role === 'owner' ? g.ownerPid : g.leadPid, ms = Store.membersOf(gid).filter(m => m.pid !== holder && m.role !== 'observer'), rl = role === 'owner' ? 'Owner' : 'Lead Trader';
  openModal(`<header><h2>Propose a new ${rl}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">${esc(Store.displayName(holder))} hasn't been active for over 30 days. Members vote using the group's usual rules; if it passes, any member can carry it out.</p>
    <div class="field"><label for="aw-p">New ${rl}</label><select class="input" id="aw-p">${ms.map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))}</option>`).join('')}</select></div>
    <div class="hint" id="aw-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="aw-go" style="width:100%">Start the vote</button>`, sh => {
    sh.querySelector('#aw-go').onclick = async () => { const b = sh.querySelector('#aw-go'); b.disabled = true; const pid = sh.querySelector('#aw-p').value;
      try { await Store.http('POST', '/api/action/propose', { gid, type: 'role', roleName: role, rolePid: pid, away: true, title: `Make ${Store.displayName(pid)} ${rl} (${Store.displayName(holder)} is away)` }); closeModal(); toast('Vote started.'); } catch(e){ sh.querySelector('#aw-e').textContent = e.message; b.disabled = false; } };
  });
}
/* Pocket Leader: enough people copying you, or leading a group with enough members. */
function leaderRule(){ const r = Store.get('badges', 'leaderRule') || {}; return { copiers: r.copiers || 25, members: r.members || 10 }; }
function leaderProgress(pid){ const R = leaderRule(), copiers = Store.all('copies').filter(c => c.to === pid).length, groupMax = Math.max(0, ...Store.all('groups').filter(g => g.leadPid === pid).map(g => Store.membersOf(g.id).filter(m => m.role !== 'observer').length));
  return { copiers, groupMax, R, earned: copiers >= R.copiers || groupMax >= R.members }; }
function leaderBadge(pid){ const p = Store.get('profiles', pid); if (!p || p.kind === 'demo') return null; return leaderProgress(pid).earned ? { n: 'Pocket Leader', c: 'purple', d: 'Leads a following on Pocket.' } : null; }
function leaderCard(pid){
  const L = leaderProgress(pid);
  if (L.earned) return `<section class="panel" style="padding:16px 18px;margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div class="grow"><span class="tag purple">Pocket Leader</span><div class="small muted" style="margin-top:6px">You've reached the Pocket Leader milestone. Free Pro comes with it once Pro becomes paid.</div></div><button class="btn sm ghost" data-act="shareleader">Share</button></section>`;
  return `<section class="panel" style="padding:16px 18px;margin-top:16px"><b>Pocket Leader milestone</b><div class="small muted" style="margin:4px 0 10px">Reach ${L.R.copiers} people copying you, or lead a group with ${L.R.members} members. Comes with free Pro once Pro becomes paid.</div>
    <div class="small">${L.copiers} of ${L.R.copiers} copiers</div><div style="height:6px;border-radius:3px;background:var(--surface-2);margin:4px 0 10px"><div style="height:6px;border-radius:3px;background:var(--blue);width:${Math.min(100, L.copiers / L.R.copiers * 100)}%"></div></div>
    <div class="small">Largest group you lead: ${L.groupMax} of ${L.R.members} members</div><div style="height:6px;border-radius:3px;background:var(--surface-2);margin-top:4px"><div style="height:6px;border-radius:3px;background:var(--blue);width:${Math.min(100, L.groupMax / L.R.members * 100)}%"></div></div></section>`;
}
/* Referrals (real-money site): a personal link; 3 months of Pro credit when a friend's first deposit over $100 settles, up to 4. */
function referralCard(){
  if (!Store.site.realMoney) return ''; const R = ui.refInfo;
  if (!R){ ui.refInfo = 'loading'; Store.http('GET', '/api/referral').then(r => { ui.refInfo = r; render(); }, () => { ui.refInfo = { error: true }; }); }
  if (!R || R === 'loading' || R.error) return '';
  const link = location.origin + '/r/' + R.code, pro = (Store.get('profiles', Store.myPid) || {}).proCreditMonths || 0;
  return `<section class="panel" style="padding:16px 18px;margin-top:16px"><b>Invite friends</b><div class="small muted" style="margin:4px 0 10px">Earn 3 months of Pro when a friend you invite opens a brokerage account and deposits more than $100. Up to ${R.max} friends.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" readonly value="${esc(link)}" style="flex:1;min-width:180px" aria-label="Your invite link"><button class="btn sm" data-act="sharelink" data-k="${esc(link)}">Share link</button></div>
    <div class="small" style="margin-top:10px">${R.rewarded} of ${R.max} referrals rewarded${pro ? ` · ${pro} months of Pro credit, applied when Pro becomes paid` : ''}${R.joined > R.rewarded ? ` · ${R.joined - R.rewarded} joined and haven't deposited yet` : ''}</div></section>`;
}
function vRef(code){
  try { if (code) localStorage.setItem('pi_ref', String(code).toUpperCase()); } catch(e){}
  const R = ui.refLanding && ui.refLanding.code === code ? ui.refLanding : null;
  if (!R){ ui.refLanding = { code, loading: true }; Store.http('GET', '/api/ref/' + encodeURIComponent(code || '')).then(r => { ui.refLanding = Object.assign({ code }, r); render(); }, () => { ui.refLanding = { code, valid: false }; render(); }); }
  if (Store.signedIn) return `<div class="panel empty">You're already signed in. <a href="#/home">Go to Home</a></div>`;
  if (!R || R.loading) return '<div class="loading">Loading your invite…</div>';
  return `<section class="panel" style="padding:24px;max-width:520px"><h1 style="margin-top:0">${R.valid ? esc(R.name) + ' invited you to Pocket' : 'Join Pocket'}</h1><p class="muted">Invest on your own, follow investors you trust, or invest together with a group, with your approval on every trade.</p>
    ${R.valid ? '' : '<p class="small muted">That invite link has expired, but you can still request an invite.</p>'}<button class="btn" data-act="signup">Create your account</button></section>`;
}
/* One-week check-in, shown once on Home. */
function checkinCard(){
  const p = Store.get('profiles', Store.myPid); if (!p || p.kind === 'demo' || p.checkinTs || Store.site.demoSite || ui.checkinHidden || Date.now() - (p.createdTs || Date.now()) < 7 * DAY) return '';
  return `<section class="panel" style="padding:16px 18px;margin-bottom:16px"><b>Quick question</b><p class="small" style="margin:6px 0 10px">How likely are you to recommend Pocket to a friend?</p>
    <div style="display:flex;gap:4px;flex-wrap:wrap" role="group" aria-label="0 to 10">${[...Array(11).keys()].map(n => `<button class="btn sm ${ui.ciScore === n ? '' : 'ghost'}" data-act="ciscore" data-k="${n}" style="min-width:36px;padding:0">${n}</button>`).join('')}</div>
    <div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>Not likely</span><span>Very likely</span></div>
    <div class="field" style="margin-top:10px"><label for="ci-t">What's one thing we should fix? <span class="muted">(optional)</span></label><input class="input" id="ci-t" maxlength="1000"></div>
    <div style="display:flex;gap:8px"><button class="btn sm" data-act="cisend" ${ui.ciScore == null ? 'disabled' : ''}>Send</button><button class="btn sm ghost" data-act="ciskip">Not now</button></div></section>`;
}
/* Add to Home Screen: iPhone steps, or Android's install button. Shown from the second visit, until dismissed. */
let a2hsEvent = null; window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); a2hsEvent = e; });
function installCard(){
  let st = false; try { st = matchMedia('(display-mode: standalone)').matches || navigator.standalone; if (localStorage.getItem('pi_a2hs_off') || +(localStorage.getItem('pi_visits') || 0) < 2) return ''; } catch(e){ return ''; }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent); if (st || !(ios || a2hsEvent)) return '';
  return `<section class="panel" style="padding:16px 18px;margin-bottom:16px;display:flex;gap:12px;align-items:flex-start"><span class="mark" aria-hidden="true" style="flex:none">P</span><div class="grow"><b>Add Pocket to your Home Screen</b>
    <div class="small muted" style="margin-top:4px">${ios ? 'Opens full screen like an app, and turns on notifications for approvals and alerts. In Safari, tap the Share button, then <b>Add to Home Screen</b>.' : 'Opens full screen like an app, with notifications for approvals and alerts.'}</div>
    <div class="small muted" style="margin-top:4px">iPhone and Android apps are coming soon.</div>
    ${ios ? '' : '<button class="btn sm" data-act="a2hs" style="margin-top:8px">Install Pocket</button>'}</div><button class="x" data-act="a2hsoff" aria-label="Dismiss">×</button></section>`;
}
try { const k = 'pi_visit_day', d = new Date().toISOString().slice(0, 10); if (localStorage.getItem(k) !== d){ localStorage.setItem(k, d); localStorage.setItem('pi_visits', String(+(localStorage.getItem('pi_visits') || 0) + 1)); } } catch(e){}

/* Members who joined before the 18+ question confirm once. */
function adultSheet(){
  openModal(`<header><h2>One quick confirmation</h2></header><p class="muted" style="margin-top:0">Pocket is for adults. Please confirm your age to keep using it.</p>
    <label style="display:flex;gap:10px;align-items:flex-start;margin:6px 0 14px"><input type="checkbox" id="ad-k" style="margin-top:4px"><span>I'm 18 or older.</span></label>
    <div class="hint" id="ad-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="ad-go" style="width:100%" disabled>Continue</button>
    <p class="small muted" style="margin:12px 0 0">If you're under 18, please <a href="#/u/me" data-act="adultno">contact us</a> and we'll close your account.</p>`, sh => {
    sh.querySelector('#ad-k').onchange = e => { sh.querySelector('#ad-go').disabled = !e.target.checked; };
    sh.querySelector('#ad-go').onclick = async () => { try { await Store.http('POST', '/api/confirm-adult', { adult: true }); closeModal(); toast('Thanks.'); } catch(e){ sh.querySelector('#ad-e').textContent = e.message; } };
  });
}

/* Blocking and reporting. */
const iBlocked = pid => !!Store.signedIn && Store.all('blocks').some(b => b.from === Store.myPid && b.to === pid);
const REPORT_REASONS = { post: [['spam', 'Spam'], ['hype', 'Misleading or hype'], ['harassment', 'Harassment'], ['other', 'Something else']], comment: [['spam', 'Spam'], ['hype', 'Misleading or hype'], ['harassment', 'Harassment'], ['other', 'Something else']], member: [['impersonation', 'Pretending to be someone else'], ['harassment', 'Harassment'], ['fake', 'Fake or spam account'], ['other', 'Something else']] };
function reportSheet(kind, id){
  const what = kind === 'member' ? 'this member' : kind === 'comment' ? 'this comment' : 'this post';
  openModal(`<header><h2>Report ${what}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">The Pocket team reviews every report. ${kind === 'member' ? 'They won\'t know who reported them.' : 'The author won\'t know who reported it.'} <a href="/site/guidelines.html" target="_blank">Community guidelines</a></p>
    <div class="field" role="radiogroup" aria-label="Reason">${REPORT_REASONS[kind].map(([k, l], i) => `<label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="radio" name="rp-r" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="field"><label for="rp-d">Anything else we should know? <span class="muted">(optional)</span></label><textarea class="input" id="rp-d" maxlength="500" rows="3"></textarea></div>
    <div class="hint" id="rp-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="rp-go" style="width:100%">Send report</button>`, sh => {
    sh.querySelector('#rp-go').onclick = async () => { const b = sh.querySelector('#rp-go'); b.disabled = true;
      const body = { kind, reason: (sh.querySelector('input[name=rp-r]:checked') || {}).value, details: sh.querySelector('#rp-d').value };
      if (kind === 'post') body.postId = id; else if (kind === 'comment') body.commentId = id; else body.pid = id;
      try { await Store.http('POST', '/api/action/report', body); closeModal(); toast('Thanks. The Pocket team will review it.'); } catch(e){ sh.querySelector('#rp-e').textContent = e.message; b.disabled = false; } };
  });
}
function blockedList(){ const bl = Store.all('blocks').filter(b => b.from === Store.myPid); if (!bl.length) return '';
  return `<section class="block"><header><h2>Blocked members</h2></header><div class="list">${bl.map(b => `<div class="row">${avatar(b.to, 'sm')}<div class="grow">${esc(Store.displayName(b.to))}</div><button class="btn sm ghost" data-act="unblock" data-id="${b.to}">Unblock</button></div>`).join('')}</div></section>`; }

/* Two-step backup codes. */
function backupRow(){ if (ui.bkLeft == null){ ui.bkLeft = '…'; Store.http('GET', '/api/2fa/backup').then(r => { ui.bkLeft = r.left; render(); }, () => {}); }
  return `<div class="panel" style="padding:12px 14px;margin:10px 0;background:var(--surface-2)"><b>Backup codes</b><div class="small muted" style="margin:4px 0 8px">${ui.bkLeft} unused. Each works once to sign in if you lose your phone.</div><div class="field" style="margin:0 0 8px"><label for="tf-bk">Current code from your app</label><input class="input num" id="tf-bk" inputmode="numeric" maxlength="6"></div><button class="btn sm ghost" data-act="tfbackup">Get new backup codes</button></div>`; }
function backupCodesSheet(codes, first){
  openModal(`<header><h2>${first ? 'Two-step sign-in is on' : 'New backup codes'}</h2></header><p class="muted" style="margin-top:0">Save these somewhere safe, like a password manager. If you lose your phone, each code lets you sign in once. ${first ? '' : 'Your old codes no longer work.'}</p>
    <div class="panel num" style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:16px;letter-spacing:1px">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" id="bk-copy" style="flex:1">Copy codes</button><button class="btn" id="bk-done" style="flex:1">I've saved them</button></div>`, sh => {
    sh.querySelector('#bk-copy').onclick = () => { try { navigator.clipboard.writeText(codes.join('\n')); toast('Copied.'); } catch(e){} };
    sh.querySelector('#bk-done').onclick = () => closeModal();
  });
}
