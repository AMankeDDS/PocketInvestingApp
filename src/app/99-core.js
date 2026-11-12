/* Startup code: app state, the Store, constants and event wiring.
   It loads last, after every function above is defined: the same order the app had as one file. */

/* =====================================================================
   MARKET — simulated prices (deterministic, same for every viewer)
   ===================================================================== */
const Market = (() => {
  const LIST = [
    ['AAPL','Apple',232],['MSFT','Microsoft',448],['NVDA','NVIDIA',182],['AMZN','Amazon',214],
    ['GOOGL','Alphabet',196],['META','Meta Platforms',612],['TSLA','Tesla',298],['JPM','JPMorgan Chase',262],
    ['V','Visa',334],['KO','Coca-Cola',69],['COST','Costco',912],['NFLX','Netflix',1085],
    ['DIS','Disney',114],['AMD','AMD',198],['XOM','ExxonMobil',116],['JNJ','Johnson & Johnson',164],
    ['SPY','S&P 500 ETF',652],['QQQ','Nasdaq-100 ETF',578],['SCHD','US Dividend Equity ETF',28],['O','Realty Income',58]
  ].map(([s,n,b]) => ({s,n,b}));
  const MAP = Object.fromEntries(LIST.map(t => [t.s, t]));
  function hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rnd(seed){ let t = (seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function priceAt(sym, ms){
    const T = MAP[sym]; if (!T) return 0;
    const m = ms / 60000, h = hash(sym);
    const p1 = rnd(h) * 6.283, p2 = rnd(h + 1) * 6.283, p3 = rnd(h + 2) * 6.283, vol = 0.6 + rnd(h + 3);
    let x = 0.035 * vol * Math.sin(2 * Math.PI * m / (1440 * 9) + p1)
          + 0.018 * vol * Math.sin(2 * Math.PI * m / (1440 * 2.3) + p2)
          + 0.007 * vol * Math.sin(2 * Math.PI * m / (60 * 5.1) + p3);
    const k = Math.floor(m / 15), f = m / 15 - k;
    const n0 = rnd((h + k * 7919) | 0) - 0.5, n1 = rnd((h + (k + 1) * 7919) | 0) - 0.5;
    x += 0.006 * vol * (n0 + (n1 - n0) * f);
    return Math.round(T.b * Math.exp(x) * 100) / 100;
  }
  /* extra stocks and real quotes: same rules as the server (server/market.js) */
  const QUOTES = {};
  function add(s, n, b){ if (!s || MAP[s] || !(b > 0)) return false; const t = { s, n: n || s, b: Math.round(b * 100) / 100, extra: true }; LIST.push(t); MAP[s] = t; return true; }
  function setBases(map){ for (const [s, b] of Object.entries(map || {})) if (MAP[s] && b > 0) MAP[s].b = Math.round(b * 10000) / 10000; }
  function setQuotes(q){ const now = Date.now(); for (const [s, v] of Object.entries(q || {})) if (v && v.p > 0) QUOTES[s] = { p: v.p, prev: v.prev || null, t: v.t || now }; }
  const liveQuote = s => { const q = QUOTES[s]; return q && Date.now() - q.t < 15 * 60000 ? q : null; };
  function price(sym, ms = Date.now()){
    const q = liveQuote(sym);
    if (q){ if (Math.abs(ms - Date.now()) < 180000) return q.p; const a = priceAt(sym, ms), b = priceAt(sym, Date.now()); return a && b ? Math.round(a * q.p / b * 100) / 100 : q.p; }
    return priceAt(sym, ms);
  }
  const dayChange = (sym, now = Date.now()) => { const q = liveQuote(sym); if (q && q.prev) return q.p / q.prev - 1; const a = price(sym, now - 86400000), b = price(sym, now); return a ? b / a - 1 : 0; };
  function series(sym, spanMs, points = 60, now = Date.now()){
    const out = []; for (let i = points - 1; i >= 0; i--) out.push(price(sym, now - spanMs * i / (points - 1))); return out;
  }
  const isReal = s => !!liveQuote(s);
  return { LIST, MAP, ETFS_UI: ['SPY','QQQ','SCHD'], price, dayChange, series, hash, add, setBases, setQuotes, isReal };
})();


/* =====================================================================
   CLOCK — the demo clock is a server setting so everyone sees the same market
   ===================================================================== */
const Clock = (() => {
  let current = 'live';
  function et(ms){
    const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', hourCycle:'h23', weekday:'short', hour:'2-digit', minute:'2-digit', second:'2-digit' }).formatToParts(new Date(ms));
    const o = {}; for (const p of parts) o[p.type] = p.value; return { wd:o.weekday, mins: (+o.hour % 24) * 60 + (+o.minute) + (+o.second) / 60 };
  }
  function session(now = Date.now()){
    const m = current;
    if (m === 'open') return { open:true, closeAt: now + 3 * 3600000, label:'Market open', demo:true };
    if (m === 'late') return { open:true, closeAt: now + 3 * 60000, label:'3:57 PM ET', demo:true };
    const e = et(now); const weekday = !['Sat','Sun'].includes(e.wd);
    const open = weekday && e.mins >= 570 && e.mins < 960;
    return { open, closeAt: open ? now + (960 - e.mins) * 60000 : null, label: open ? 'Market open' : 'Market closed', demo:false };
  }
  function canFillNow(now = Date.now()){ const s = session(now); return s.open && s.closeAt - now > 5 * 60000; }
  return { mode: () => current, _set: m => { current = m || 'live'; }, session, canFillNow };
})();


/* =====================================================================
   STORE — talks to the Pocket Investing server. Reads come from a local
   cache kept live over a WebSocket; every action is checked and executed
   on the server, which prices trades and enforces permissions.
   ===================================================================== */
const Store = (() => {
  const COLS = ['profiles','portfolios','groups','memberships','posts','reactions','comments','follows','proposals','votes','copyRequests','trades','copies','reports','joinRequests','reviews','suggestions','dividends','meetings','groupWatch','studies','recurring'];
  const cache = Object.fromEntries(COLS.map(c => [c, new Map()]));
  const listeners = new Set(), realListeners = new Set(), newsCache = new Map();
  let settings = { announcement:null, inviteOnly:true }, me = { signedIn:false }, myPid = null, canWrite = false, canEdit = false, ready = false, hasDb = false, viewSaved = null, ws = null;
  const START_CASH = 100000;
  const fail = msg => { const e = new Error(msg); e.userFacing = true; return e; };
  let lastChange = Date.now();
  const emit = () => { lastChange = Date.now(); listeners.forEach(fn => { try { fn(); } catch(e){ console.error(e); } }); };

  function applyChanges(ch){
    for (const c of ch || []){
      if (c.setting){ if (c.setting === 'clock') Clock._set(c.value); else settings[c.setting] = c.value; continue; }
      if (c.wipe){ if (cache[c.col]) cache[c.col] = new Map(); continue; }
      if (!cache[c.col]) continue;
      if (c.data) cache[c.col].set(c.id, c.data); else cache[c.col].delete(c.id);
    }
    emit();
  }
  async function loadState(){
    const r = await fetch('/api/state', { cache:'no-store' }); if (!r.ok) throw new Error('state ' + r.status);
    const j = await r.json();
    for (const c of COLS) cache[c] = new Map((j.collections[c] || []).map(d => [d.id, d]));
    Clock._set(j.settings && j.settings.clock); settings = Object.assign(settings, j.settings || {});
    if (j.market){ (j.market.extras || []).forEach(x => Market.add(x.s, x.n, x.b)); Market.setBases(j.market.bases || {}); Market.setQuotes(j.market.quotes || {}); }
  }
  async function loadMe(){
    me = await fetch('/api/me', { cache:'no-store', credentials:'same-origin' }).then(r => r.json());
    if (!viewSaved){ myPid = me.signedIn ? me.pid : null; canWrite = !!me.signedIn; canEdit = !!me.isAdmin; }
    else viewSaved = { myPid: me.signedIn ? me.pid : null, canWrite: !!me.signedIn, canEdit: !!me.isAdmin };
  }
  function connect(){
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch(e){ return; }
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'changes') applyChanges(m.changes); else if (m.type === 'real' && m.what === 'copyreq'){ ui.realReq = null; emit(); } else if (m.type === 'real' && m.what === 'paused'){ ui.real = null; emit(); } else if (m.type === 'notice'){ loadMe().then(emit, () => {}); } else if (m.type === 'resync'){ loadState().then(emit, () => {}); } else if (m.type === 'real') realListeners.forEach(fn => { try { fn(m); } catch(x){} });
      else if (m.type === 'market'){ (m.extras || []).forEach(x => Market.add(x.s, x.n, x.b)); if (m.bases) Market.setBases(m.bases); if (m.quotes) Market.setQuotes(m.quotes); if (m.extras || m.bases) emit(); }
      else if (m.type === 'news'){ newsCache.clear(); emit(); } } catch(err){} };
    ws.onclose = () => setTimeout(async () => { try { await loadState(); emit(); } catch(e){} connect(); }, 2000 + Math.random() * 2000);
  }
  /* After signing in or out, reopen the live channel so private updates reach the right person. */
  /* Put a document the server sent separately (like an invite preview) into the local store. */
  function inject(col, d){ if (cache[col] && d && d.id && !cache[col].has(d.id)) cache[col].set(d.id, d); }
  function reconnect(){
    if (ws){ ws.onclose = null; try { ws.close(); } catch(e){} }
    connect();
  }
  async function init(){
    try { await Promise.all([loadMe(), loadState()]); hasDb = true; } catch(e){ console.error(e); hasDb = false; }
    ready = true; emit(); if (hasDb) connect();
  }
  async function api(name, args = {}){
    let r, j;
    try { r = await fetch('/api/action/' + name, { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body: JSON.stringify(args) }); j = await r.json(); }
    catch(e){ throw fail('Connection problem. Check your internet and try again.'); }
    if (!r.ok) throw fail(j.error || 'Something went wrong. Try again.');
    applyChanges(j.changes);
    return j.result;
  }
  async function auth(path, body){
    let r, j;
    try { r = await fetch(path, { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body || {}) }); j = await r.json(); }
    catch(e){ throw fail('Connection problem. Check your internet and try again.'); }
    if (!r.ok){ const e = fail(j.error || 'Something went wrong. Try again.'); e.need2fa = !!j.need2fa; throw e; }
    await loadMe(); await loadState(); emit(); reconnect();
  }
  /* Tour: render the app as a sample member, read-only, without touching data. */
  function setViewAs(pid){
    if (pid){ if (!viewSaved) viewSaved = { myPid, canWrite, canEdit }; myPid = pid; canWrite = false; canEdit = false; }
    else if (viewSaved){ myPid = viewSaved.myPid; canWrite = viewSaved.canWrite; canEdit = viewSaved.canEdit; viewSaved = null; }
    emit();
  }

  /* ---------- reads / derived ---------- */
  const all = c => [...cache[c].values()];
  const get = (c, id) => cache[c].get(id);
  function displayName(pid){
    const p = get('profiles', pid); if (!p) return 'Member';
    return p.name || (pid === myPid ? 'You' : 'Member');
  }
  function portfolioValue(pf, now = Date.now()){
    if (!pf) return 0; let v = pf.cash || 0;
    for (const [s, pos] of Object.entries(pf.positions || {})) v += pos.shares * Market.price(s, now);
    return v;
  }
  function membersOf(gid){ return all('memberships').filter(m => m.gid === gid); }
  function membership(gid, pid = myPid){ return get('memberships', gid + '__' + pid); }
  function myGroups(){ return all('memberships').filter(m => m.pid === myPid).map(m => get('groups', m.gid)).filter(Boolean); }
  const ROLE_LABEL = { owner:'Owner', admin:'Admin', lead:'Lead Trader', junior:'Junior Trader', analyst:'Analyst', risk:'Risk Manager', moderator:'Moderator', treasurer:'Treasurer', asstTreasurer:'Assistant Treasurer', member:'Member', observer:'Observer' };
  const ROLE_INFO = { owner:'Runs the group: settings, members and roles', admin:'Helps manage settings and members', lead:'Trades for the group; members approve each trade', junior:'Suggests trades for the Lead Trader to approve',
    analyst:'Creates trade proposals for the group to vote on', risk:'Reviews group trades before members see them, and can pause one for a vote', moderator:'Keeps discussion on track and removes posts', treasurer:'Keeps the club books: dues, withdrawals and valuations', asstTreasurer:'Second approver for club money: withdrawals, payments and the monthly close', member:'Votes and copies group trades with approval', observer:'Follows along without voting or copying' };
  const DEFAULT_RULES = { joinMode:'open', maxMembers:null, minAccount:0, rulesText:'', proposeRoles:['owner','admin','lead','analyst'], quorum:0, passRule:'majority', votingDays:3, voteWaitDays:0, maxPositionPct:null, allowed:'any', allowedList:[], approvalMinutes:30, riskReview:false, defaultCopyPct:1, hidden:false, feeMonthly:null };
  function rulesOf(g){ const r = Object.assign({}, DEFAULT_RULES, (g && g.rules) || {}); if (!(g && g.rules && g.rules.joinMode) && g && g.membership === 'invite') r.joinMode = 'request'; return r; }
  const votingAge = (m, rules) => !rules.voteWaitDays || Date.now() - (m.joinedTs || 0) >= rules.voteWaitDays * 86400000;
  const canTradeFor = role => ['owner','admin','lead'].includes(role);
  const canPropose = (role, rules) => !!role && (rules || DEFAULT_RULES).proposeRoles.includes(role);
  const canModerate = role => ['owner','admin','moderator'].includes(role);
  const canReview = role => ['risk','owner'].includes(role);
  const canVote = role => !!role && role !== 'observer';
  const canManage = role => ['owner','admin'].includes(role);
  function tally(prid){
    const pr = get('proposals', prid); if (!pr) return null;
    const rules = rulesOf(get('groups', pr.gid));
    const eligibleM = membersOf(pr.gid).filter(m => canVote(m.role) && votingAge(m, rules)); const eligible = eligibleM.map(m => m.pid);
    const vs = all('votes').filter(v => v.prid === prid && eligible.includes(v.pid));
    const c = { yes:0, no:0, abstain:0 }; vs.forEach(v => c[v.vote] = (c[v.vote] || 0) + 1);
    const allVoted = vs.length >= eligible.length && eligible.length > 0;
    const closed = pr.status !== 'open' || Date.now() > pr.deadlineTs || allVoted;
    const quorumMet = !rules.quorum || (eligible.length && vs.length / eligible.length >= rules.quorum - 1e-9);
    const decided = c.yes + c.no, ratio = decided ? c.yes / decided : 0;
    const passes = quorumMet && decided > 0 && (rules.passRule === 'two-thirds' ? ratio >= 2 / 3 - 1e-9 : ratio > 0.5);
    const myM = membership(pr.gid);
    return { ...c, eligible: eligible.length, cast: vs.length, closed, quorumMet, rules, result: pr.status !== 'open' ? pr.status : (passes ? 'passed' : 'failed'), mine: (get('votes', prid + '__' + myPid) || {}).vote,
      waitDays: myM && canVote(myM.role) && !votingAge(myM, rules) ? Math.ceil((rules.voteWaitDays * 86400000 - (Date.now() - myM.joinedTs)) / 86400000) : 0 };
  }
  function requestState(r, now = Date.now()){
    if (r.status === 'pending' && r.mode === 'window' && now > r.expiresTs) return 'expired';
    if (r.status === 'pending' && r.mode === 'open' && now > r.expiresTs) return 'expired';
    return r.status;
  }
  const myPending = () => all('copyRequests').filter(r => r.memberPid === myPid && requestState(r) === 'pending').sort((a,b) => b.createdTs - a.createdTs);

  const isPro = (pid = myPid) => { const p = get('profiles', pid); return !!p && (p.kind === 'demo' || p.plan === 'pro'); };
  const isCopying = pid => !!get('copies', myPid + '__' + pid);
  const copiersOf = pid => all('copies').filter(c => c.to === pid);
  const isFollowing = pid => !!get('follows', myPid + '__' + pid);
  const isDemo = pid => (get('profiles', pid) || {}).kind === 'demo';
  /* ---------- performance: you vs the group since you joined ---------- */
  function performance(gid, pid = myPid){
    const m = membership(gid, pid); if (!m) return null;
    const now = Date.now();
    const trades = all('posts').filter(p => p.groupId === gid && p.groupTrade && p.trade && p.pid !== pid && p.ts >= m.joinedTs - 1000).sort((a, b) => b.ts - a.ts);
    const rows = trades.map(p => {
      const req = all('copyRequests').find(r => r.gid === gid && r.memberPid === pid && r.sym === p.trade.sym && r.leaderPid === p.pid && Math.abs(r.createdTs - p.ts) < 120000);
      const dir = p.trade.side === 'buy' ? 1 : -1, px = Market.price(p.trade.sym, now);
      const state = req ? requestState(req, now) : 'not sent';
      const lead = dir * (px / p.trade.price - 1);
      const mine = state === 'filled' ? dir * (px / req.fillPrice - 1) : null;
      return { p, req, state, lead, mine };
    });
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const spy = Market.price('SPY', now) / Market.price('SPY', m.joinedTs) - 1;
    return { rows, leadAvg: avg(rows.map(r => r.lead)), mineAvg: avg(rows.map(r => r.mine ?? 0)), copied: rows.filter(r => r.state === 'filled').length, spy, since: m.joinedTs };
  }

  /* ---------- notifications (derived from activity) ---------- */
  function notifications(){
    const me = myPid; if (!me) return [];
    const nm = displayName, out = [];
    const myG = new Set(all('memberships').filter(m => m.pid === me).map(m => m.gid));
    const manage = new Set(all('memberships').filter(m => m.pid === me && canManage(m.role)).map(m => m.gid));
    const myPosts = new Set(all('posts').filter(p => p.pid === me).map(p => p.id));
    const gname = gid => (get('groups', gid) || {}).name || 'a group';
    for (const r of all('copyRequests').filter(r => r.memberPid === me))
      out.push({ ts: r.createdTs, tone:'ember', text: `${nm(r.leaderPid)} ${r.side === 'buy' ? 'bought' : 'sold'} ${r.sym}${r.gid ? ' for ' + gname(r.gid) : ''}. ${requestState(r) === 'pending' ? 'Waiting for your approval.' : 'You ' + ({ filled:'copied it', declined:'declined it', expired:'missed it', queued:'approved it for the open', cancelled:'cancelled it before the open' }[requestState(r)] || 'handled it') + '.'}`, href:'#/inbox' });
    for (const pr of all('proposals').filter(p => myG.has(p.gid))){
      if (pr.authorPid !== me) out.push({ ts: pr.createdTs, text: `New vote in ${gname(pr.gid)}: ${pr.title}`, href: `#/group/${pr.gid}/proposals` });
      if (pr.closedTs) out.push({ ts: pr.closedTs, text: `Vote ${pr.status === 'passed' ? 'passed' : 'did not pass'} in ${gname(pr.gid)}: ${pr.title}`, href: `#/group/${pr.gid}/proposals` });
      if (pr.executedTs) out.push({ ts: pr.executedTs, text: `${nm(pr.executedBy)} executed the group's decision: ${pr.title}`, href: `#/group/${pr.gid}/activity` });
    }
    for (const c of all('comments').filter(c => myPosts.has(c.postId) && c.pid !== me)) out.push({ ts: c.ts, text: `${nm(c.pid)} commented on your post`, href:'#/u/' + me });
    for (const r of all('reactions').filter(r => myPosts.has(r.postId) && r.pid !== me)) out.push({ ts: r.ts, text: `${nm(r.pid)} liked your post`, href:'#/u/' + me });
    for (const f of all('follows').filter(f => f.to === me)) out.push({ ts: f.ts, text: `${nm(f.from)} started following you`, href:'#/u/' + f.from });
    for (const c of all('copies').filter(c => c.to === me)) out.push({ ts: c.ts, text: `${nm(c.from)} started copying your trades`, href:'#/u/' + c.from });
    for (const j of all('joinRequests')){
      if (j.pid === me && j.decidedTs) out.push({ ts: j.decidedTs, text: `Your request to join ${gname(j.gid)} was ${j.status}`, href:'#/group/' + j.gid });
      if (manage.has(j.gid) && j.status === 'pending') out.push({ ts: j.ts, text: `${nm(j.pid)} asked to join ${gname(j.gid)}`, href:`#/group/${j.gid}/members` });
    }
    for (const m of all('memberships').filter(m => m.invitedBy === me)) out.push({ ts: m.joinedTs, text: `${nm(m.pid)} joined ${gname(m.gid)} from your invite`, href:`#/group/${m.gid}/members` });
    return out.sort((a, b) => b.ts - a.ts).slice(0, 80);
  }
  const unreadCount = () => { const seen = (get('profiles', myPid) || {}).notifSeenTs || 0; return notifications().filter(n => n.ts > seen).length; };

  /* ---------- pilot metrics (computed live from the demo) ---------- */
  function metrics(){
    const now = Date.now(), week = now - 7 * 86400000;
    const prof = all('profiles'), pro = prof.filter(p => isPro(p.id)).length;
    const groups = all('groups'), mem = all('memberships');
    const reqs = all('copyRequests'), st = r => requestState(r, now);
    const decided = reqs.filter(r => st(r) !== 'pending');
    const approved = decided.filter(r => ['filled','queued'].includes(st(r))).length;
    const times = reqs.filter(r => ['filled','queued'].includes(r.status) && r.decidedTs).map(r => r.decidedTs - r.createdTs).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : null;
    const props = all('proposals');
    const part = props.map(p => { const t = tally(p.id); return t && t.eligible ? t.cast / t.eligible : null; }).filter(x => x != null);
    const groupPro = groups.filter(g => g.groupPro).length;
    return {
      accounts: prof.length, pro, proRate: prof.length ? pro / prof.length : 0,
      groups: groups.length, perGroup: groups.length ? mem.length / groups.length : 0, invites: mem.filter(m => m.invitedBy).length,
      requests: reqs.length, approvalRate: decided.length ? approved / decided.length : null, expiredRate: decided.length ? decided.filter(r => st(r) === 'expired').length / decided.length : null, medianApprove: median,
      groupTrades7: all('posts').filter(p => p.groupTrade && p.ts > week).length, proposals: props.length, participation: part.length ? part.reduce((a, b) => a + b, 0) / part.length : null,
      posts7: all('posts').filter(p => p.ts > week && !p.groupTrade).length, comments7: all('comments').filter(c => c.ts > week).length,
      copies: all('copies').length, reportsOpen: all('reports').filter(r => r.status === 'open').length,
      runRate: pro * 9.99 * 12 + groupPro * 19.99 * 12, groupPro
    };
  }


  async function http(method, path, body){
    let r, j;
    try { r = await fetch(path, { method, credentials:'same-origin', headers:{ 'content-type':'application/json' }, body: body ? JSON.stringify(body) : undefined }); j = await r.json(); }
    catch(e){ throw fail('Connection problem. Check your internet and try again.'); }
    if (!r.ok) throw fail(j.error || 'Something went wrong. Try again.');
    return j;
  }
  /* ---------- actions (all run on the server) ---------- */
  const isMe = pid => !pid || pid === myPid;
  return {
    init, subscribe: fn => (listeners.add(fn), () => listeners.delete(fn)),
    get ready(){ return ready; }, get myPid(){ return myPid; }, get canWrite(){ return canWrite; }, get canEdit(){ return canEdit; }, get viewing(){ return !!viewSaved; }, get hasDb(){ return hasDb; },
    get lastChange(){ return lastChange; }, get signedIn(){ return !!me.signedIn; }, get username(){ return me.username; }, get settings(){ return settings; }, get pushKey(){ return me.pushKey; }, get inviteOnly(){ return me.inviteOnly !== false; }, setViewAs,
    rulesOf, ROLE_INFO, canModerate, canReview, http,
    signupFull: o => auth('/api/signup', o), resetPassword: (username, code, password) => auth('/api/reset-password', { username, code, password }),
    changePassword: (current, password) => http('POST', '/api/change-password', { current, password }),
    deleteAccount: async password => { await http('POST', '/api/delete-account', { password }); await loadMe(); await loadState(); emit(); reconnect(); },
    feedback: (text, screen) => http('POST', '/api/feedback', { text, screen }),
    updateGroup: (gid, o) => api('updateGroup', Object.assign({ gid }, o)), removeMember: (gid, pid) => api('removeMember', { gid, pid }), transferOwnership: (gid, pid) => api('transferOwnership', { gid, pid }),
    copyPortfolio: o => api('copyPortfolio', o),
    clubContribute: (gid, amount) => api('clubContribute', { gid, amount }), clubRequestExit: (gid, pid, note) => api('clubRequestExit', { gid, pid, note }), clubLiquidate: gid => api('clubLiquidate', { gid }), clubDistribute: gid => api('clubDistribute', { gid }), clubRequestWithdrawal: (gid, amount, note) => api('clubRequestWithdrawal', { gid, amount, note }), clubDecideWithdrawal: (id, decision, note) => api('clubDecideWithdrawal', { id, decision, note }),
    createMeeting: o => api('createMeeting', o), meetingStatus: o => api('meetingStatus', o), meetingCheckIn: id => api('meetingCheckIn', { id }), meetingNote: (id, text) => api('meetingNote', { id, text }),
    addGroupWatch: (gid, sym, reason) => api('addGroupWatch', { gid, sym, reason }), removeGroupWatch: id => api('removeGroupWatch', { id }), saveStudy: o => api('saveStudy', o),
    setRecurring: o => api('setRecurring', o), pauseRecurring: (sym, paused) => api('pauseRecurring', { sym, paused }), deleteRecurring: sym => api('deleteRecurring', { sym }),
    newInviteCode: gid => api('newInviteCode', { gid }), setInviteLink: (gid, on) => api('setInviteLink', { gid, on }), groupByCode: code => api('groupByCode', { code }),
    releaseReview: id => api('releaseReview', { id }), pauseReview: (id, reason) => api('pauseReview', { id, reason }), demoReview: (gid, op) => api('demoReview', { gid, op }),
    suggestTrade: o => api('suggestTrade', o), decideSuggestion: (id, approve) => api('decideSuggestion', { id, approve }),
    setNotifPrefs: o => api('setNotifPrefs', o),
    searchStocks: q => http('GET', '/api/assets/search?q=' + encodeURIComponent(q)).then(r => r.results),
    ensureStock: async sym => { const r = await http('POST', '/api/assets/ensure', { sym }); Market.add(r.stock.s, r.stock.n, r.stock.b); return r.stock; },
    bars: (sym, span) => http('GET', `/api/bars?sym=${encodeURIComponent(sym)}&span=${span}`).then(r => r.bars),
    /* news: cached for two minutes, refreshed when the server says new headlines arrived */
    news: (symbols, limit = 10) => { const key = (symbols || []).slice().sort().join(',') + '|' + limit, hit = newsCache.get(key);
      if (hit && (hit.loading || Date.now() - hit.t < 120000)) return hit.v;
      newsCache.set(key, { loading: true, t: Date.now(), v: hit ? hit.v : null });
      http('GET', `/api/news?limit=${limit}&symbols=${encodeURIComponent((symbols || []).join(','))}`).then(r => { newsCache.set(key, { t: Date.now(), v: r.news }); emit(); }, () => { newsCache.set(key, { t: Date.now(), v: [] }); });
      return hit ? hit.v : null; },
    addSampleData: () => api('demoAddSampleData'),
    toggleWatch: sym => api('toggleWatch', { sym }), setTags: tags => api('setTags', { tags }), setPinned: (gid, text) => api('setPinned', { gid, text }),
    featureGroup: (gid, featured) => api('featureGroup', { gid, featured }), setSampleActivity: o => api('setSampleActivity', o),
    refreshMe: async () => { await loadMe(); emit(); }, inject, all, get, displayName, portfolioValue, membersOf, membership, myGroups, tally, requestState, myPending, ROLE_LABEL,
    canTradeFor, canPropose, canVote, canManage, ROLE_INFO_KEYS: ['owner','admin','lead','junior','analyst','risk','moderator','treasurer','asstTreasurer','member','observer'], isFollowing, isDemo, isPro, isCopying, copiersOf, performance, notifications, unreadCount, START_CASH,
    signup: (username, password, name, risk) => auth('/api/signup', { username, password, name, risk }),
    login: (username, password, code) => auth('/api/login', { username, password, code: code || undefined }),
    get site(){ return me.site || { mode:'demo', realMoney:false, demoTools:true, instantDeposits:{ enabled:false } }; }, get twofa(){ return !!me.twofa; }, get adminAccount(){ return !!me.adminAccount; }, get actingAs(){ return me.actingAs || null; }, get isTest(){ return !!me.isTest; }, get adminNeeds2fa(){ return !!me.adminNeeds2fa; }, get maintenance(){ return me.maintenance || null; }, get accountNumber(){ return me.accountNumber || null; },
    onReal: fn => (realListeners.add(fn), () => realListeners.delete(fn)),
    twofaSetup: () => http('POST', '/api/2fa/setup'),
    twofaEnable: async code => { await http('POST', '/api/2fa/enable', { code }); await loadMe(); emit(); },
    twofaDisable: async code => { await http('POST', '/api/2fa/disable', { code }); await loadMe(); emit(); },
    real: {
      copyRequests: () => http('GET', '/api/real/copy-requests'), decideCopy: (id, decision, fraction) => http('POST', `/api/real/copy/${id}/decide`, { decision, fraction }),
      summary: () => http('GET', '/api/real/summary'), open: f => http('POST', '/api/real/account', f),
      bank: o => http('POST', '/api/real/bank', o), unbank: id => http('POST', '/api/real/bank/remove', { id }),
      transfer: (direction, amount, code) => http('POST', '/api/real/transfer', { direction, amount, code }),
      order: o => http('POST', '/api/real/order', o), cancel: id => http('POST', '/api/real/cancel', { id }),
      docs: () => http('GET', '/api/real/documents'), quotes: syms => http('GET', '/api/real/quotes?symbols=' + encodeURIComponent(syms.join(',')))
    },
    logout: async () => { await fetch('/api/logout', { method:'POST', credentials:'same-origin' }); await loadMe(); emit(); reconnect(); },
    ensureMe: async () => { if (!myPid) throw fail('Create an account first.'); },
    resetMe: () => api('resetMe'), updateBio: bio => api('updateBio', { bio }), setRisk: risk => api('setRisk', { risk }),
    markSeen: () => canWrite && get('profiles', myPid) ? api('markSeen').catch(() => {}) : null,
    trade: (sym, side, shares, opt = {}) => api('trade', { sym, side, shares, share: !!opt.share, note: opt.note || '' }),
    personalTrade: (pid, sym, side, shares, opt = {}) => isMe(pid) ? api('trade', { sym, side, shares, share: !!opt.share, note: opt.note || '' }) : api('demoInvestorTrade', { pid, sym, side, shares, note: opt.note || '' }),
    groupTrade: (gid, leaderPid, sym, side, shares, note) => isMe(leaderPid) ? api('groupTrade', { gid, sym, side, shares, note }) : api('demoGroupTrade', { gid, sym, side, shares, note }),
    approve: (id, frac = 1) => api('approve', { id, frac }), decline: id => api('decline', { id }), cancelQueued: id => api('cancelQueued', { id }),
    housekeeping: () => {},
    createGroup: o => api('createGroup', o), join: (gid, role, extra) => api('join', Object.assign({ gid, role }, extra || {})), leave: gid => api('leave', { gid }),
    setRole: (gid, pid, role) => api('setRole', { gid, pid, role }), setCopyPct: (gid, pct) => api('setCopyPct', { gid, pct }),
    propose: (gid, o) => api('propose', Object.assign({ gid }, o)), vote: (prid, v) => api('vote', { prid, vote: v }), closeProposal: prid => api('closeProposal', { prid }),
    executeProposal: (prid, leaderPid) => leaderPid && leaderPid === myPid ? api('executeProposal', { prid }) : api('demoExec', { prid }),
    post: (text, groupId) => api('post', { text, groupId: groupId || null }), toggleLike: postId => api('toggleLike', { postId }), comment: (postId, text) => api('comment', { postId, text }),
    deletePost: id => api('deletePost', { id }), deleteComment: id => api('deleteComment', { id }),
    follow: pid => api('follow', { pid }), unfollow: pid => api('unfollow', { pid }),
    upgradePro: wouldPay => api('upgradePro', wouldPay ? { wouldPay } : {}), cancelPro: () => api('cancelPro'), copyInvestor: pid => api('copyInvestor', { pid }), stopCopying: pid => api('stopCopying', { pid }),
    report: (gid, reason, details) => api('report', { gid, reason, details }), resolveReport: id => api('resolveReport', { id }),
    requestJoin: (gid, acceptRules) => api('requestJoin', { gid, acceptRules }), decideJoin: (id, approve) => api('decideJoin', { id, approve }),
    simulateJoinDecisions: () => api('demoJoins'), simulateInviteJoins: gid => api('demoInvites', { gid }),
    simulateApprovals: gid => api('demoApprovals', { gid: gid || null }), simulateVotes: (prid, yes) => api('demoVotes', { prid, yes }),
    resetAll: () => api('resetAll'), setClock: mode => api('setClock', { mode }), metrics
  };
})();

/* =====================================================================
   UI
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);

const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const usd = (n, d = 2) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const pct = (n, d = 2) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n * 100).toFixed(d) + '%';

const sgn = n => n > 0.00005 ? 'gain' : n < -0.00005 ? 'loss' : 'muted';

const shs = n => (+n).toLocaleString('en-US', { maximumFractionDigits: 3 });

const AV = ['#2f6fe4','#0f8a72','#7a4fd6','#c2413a','#b8660f','#14213d','#2b7a9b','#8a3f7a'];

const nameLink = pid => `<a href="#/u/${esc(pid)}" style="color:inherit;font-weight:600">${esc(Store.displayName(pid))}${pid === Store.myPid ? ' <span class="muted" style="font-weight:400">(you)</span>' : ''}</a>`;

const linkify = t => esc(t).replace(/\$([A-Z]{1,5})\b/g, (m, s) => Market.MAP[s] ? `<a href="#/stock/${s}">$${s}</a>` : m);

const ICON = {
  portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M21 12a9 9 0 0 0-9-9v9z" fill="currentColor" opacity=".18"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  feed:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14v10H9l-4 4z"/></svg>',
  groups:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="10" r="2.6"/><path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6s4.9 1.6 5.5 4.6M14.5 15.2c.8-.5 1.6-.7 2.5-.7 2 0 3.6 1.3 4 3.8"/></svg>',
  inbox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/></svg>',
  me:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-4 4-5.8 7.5-5.8s6.5 1.8 7.5 5.8"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  metrics:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  demo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>'
};

(function captureSource(){ try { const p = new URLSearchParams(location.search), s = p.get('utm_source');
  if (s && !localStorage.getItem('pi_src')){ const med = (p.get('utm_medium') || '').toLowerCase(); localStorage.setItem('pi_src', JSON.stringify({ kind: /^(paid|cpc|ppc|ad|ads|paid_social|paidsocial)$/.test(med) ? 'ad' : 'campaign', detail: [s, med, p.get('utm_campaign')].filter(Boolean).join('/').slice(0, 120) })); } } catch(e){} })();

const ui = { ametrics: null, ichSel: {}, pfSpan: '1d', spTab: null, spRange: 'all', recon: null, anchorInfo: null, ensuring: {}, bars: {}, search: null, searchQ: '', feedLimit: 30, lastSeenPost: Date.now(), lastRoute: null, groupCat: 'all', homeTab:'practice', real:null, realLoading:false, rquotes:null, openForm:null, openStep:0, sec:null, docs:null, areal:null, adminTab:'metrics', admin:null, usage:null, pushState:null, inviteFor:null, inviteCode:null, inviteBy:null, feedTab:'everyone', openComments:new Set(), drafts:{}, chartSpan:'1d', seenReqs:null, onb:0, presenter:null, risk:'balanced', tour:null, copyFrac:{} };

const SECTOR = { AAPL:'Technology', MSFT:'Technology', NVDA:'Technology', AMD:'Technology', GOOGL:'Communication', META:'Communication', NFLX:'Communication', DIS:'Communication',
  AMZN:'Consumer', TSLA:'Consumer', KO:'Consumer staples', COST:'Consumer staples', JPM:'Financials', V:'Financials', XOM:'Energy', JNJ:'Health care', O:'Real estate', SPY:'Broad market ETF', QQQ:'Broad market ETF', SCHD:'Dividend ETF' };

const SECTOR_COLOR = { 'Technology':'#2f6fe4', 'Communication':'#7a4fd6', 'Consumer':'#b8660f', 'Consumer staples':'#0f8a72', 'Financials':'#14213d', 'Energy':'#c2413a', 'Health care':'#2b7a9b', 'Real estate':'#8a3f7a', 'Broad market ETF':'#5b6577', 'Dividend ETF':'#12805a' };

const CATS = [['growth','Growth'],['dividends','Dividends'],['value','Value'],['beginners','Beginners'],['index','Index'],['consumer','Consumer brands']];

const STYLE_WATCH = { conservative:['SCHD','KO','JNJ'], balanced:['SPY','V','COST'], growth:['NVDA','MSFT','AMZN'] };

const MIN_TREND_MEMBERS = 3, SMALL_CAPS = new Set();

const EXPLAINERS = [
  ['etf', 'What is an ETF?', 'An ETF is one investment that holds many companies at once. SPY, for example, holds the 500 largest US companies, so you own a little of each.'],
  ['approvals', 'Why approvals matter', 'When your group or an investor you copy trades, nothing happens in your account until you approve it. You stay in control of every trade.'],
  ['lead', 'What does a Lead Trader do?', 'The Lead Trader places trades for the group. Members get a request sized to their own account and decide whether to copy it.'],
  ['diversify', 'Why not put it all in one stock?', 'Spreading money across companies and industries means one bad result does less damage. Many groups cap any single position at 10 to 15%.'],
  ['dividend', 'What is a dividend?', 'Some companies pay shareholders a share of their profits, usually every quarter. Many investors reinvest dividends to buy more shares.'],
  ['half', 'Copying half', 'You can approve half of a suggested trade. It is a good way to follow a group while keeping your own positions smaller.'],
  ['vote', 'How group votes work', 'Bigger decisions go to a vote. Each group sets how many members must vote and how many must agree before a proposal passes.'],
  ['risk', 'What is a Risk Manager?', 'Some groups have a Risk Manager who reviews trades before members see them, and can pause one so the group votes first.']
];

const isSample = pid => (Store.get('profiles', pid) || {}).kind === 'demo';

const sampleTag = pid => isSample(pid) ? ' <span class="tag" style="font-size:10px;padding:1px 6px;vertical-align:1px">Sample</span>' : '';

const newsNote = () => Store.site.realPrices ? '' : '<p class="hint" style="margin:8px 2px 0">Prices are simulated. News is real.</p>';

const DISCLOSE = "Copying a trade doesn't guarantee the same price or result. Investing involves risk, including loss of principal. Simulated results don't reflect real trading.";

const fracWord = f => f >= 0.995 ? 'all' : Math.abs(f - 0.5) < 0.02 ? 'half' : Math.abs(f - 0.25) < 0.02 ? 'a quarter' : Math.abs(f - 0.75) < 0.02 ? 'three-quarters' : Math.round(f * 100) + '%';

const RISK = { conservative:['Steady income','Dividends and stability first'], balanced:['Balanced','A mix of growth and income'], growth:['Growth','Higher growth, bigger swings'] };


/* ---------- small pieces ---------- */
/* Interactive line charts: touch or hover shows the date and amount at that point; click-and-drag
   (or press, hold and drag on a phone) selects a range and shows its start, end and gain or loss.
   With nothing selected, the header shows the same figures for the whole period. */
const SPANS = { '1d':[86400000, 'Past 24 hours', 96], '5d':[5 * 86400000, 'Past 5 days', 120], '1m':[30 * 86400000, 'Past month', 90], '3m':[90 * 86400000, 'Past 3 months', 90], '1y':[365 * 86400000, 'Past year', 120] };

const ICH = {};

const ichState = { el: null, selecting: false, anchor: null, timer: null, moved: false, pointer: null };

document.addEventListener('pointerdown', e => {
  const el = e.target.closest && e.target.closest('.ich');
  if (!el){ if (Object.keys(ui.ichSel).length && !(e.target.closest && e.target.closest('[data-act="ichclear"]'))){ ui.ichSel = {}; document.querySelectorAll('.ich').forEach(x => ichPaint(x, null)); } return; }
  if (e.target.closest('[data-act]')) return;
  const idx = ichIndex(el, e.clientX); ichState.el = el; ichState.moved = false; ichState.pointer = e.pointerType || 'mouse'; ichState.anchor = idx;
  if (ichState.pointer === 'mouse'){ ichState.selecting = true; ui.ichSel[el.dataset.ich] = [idx, idx]; ichPaint(el, idx); }
  else { ichState.selecting = false; ichPaint(el, idx); clearTimeout(ichState.timer);
    ichState.timer = setTimeout(() => { ichState.selecting = true; ichState.anchor = ichIndex(el, ichState.lastX != null ? ichState.lastX : e.clientX); ui.ichSel[el.dataset.ich] = [ichState.anchor, ichState.anchor]; if (navigator.vibrate) try { navigator.vibrate(15); } catch(x){} ichPaint(el, ichState.anchor); }, 350); }
  ichState.lastX = e.clientX;
});

document.addEventListener('pointermove', e => {
  const el = ichState.el || (e.target.closest && e.target.closest('.ich'));
  if (!el) return;
  if (!ichState.el && (e.pointerType || 'mouse') !== 'mouse') return;
  ichState.lastX = e.clientX;
  const idx = ichIndex(el, e.clientX);
  if (ichState.el && idx !== ichState.anchor) ichState.moved = true;
  if (ichState.selecting){ ui.ichSel[el.dataset.ich] = [ichState.anchor, idx]; }
  ichPaint(el, idx);
});

document.addEventListener('pointerup', ichEnd);

document.addEventListener('pointercancel', ichEnd);

document.addEventListener('pointerout', e => { if (!ichState.el && e.target.closest && e.target.closest('.ich') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.ich') === e.target.closest('.ich'))) ichPaint(e.target.closest('.ich'), null); });

/* ---------- practice dividends (estimates; real-money accounts get actual dividends) ---------- */
const DIV_YIELDS = { AAPL: 0.0045, MSFT: 0.0075, NVDA: 0.0003, GOOGL: 0.0045, META: 0.0035, JPM: 0.022, V: 0.007, KO: 0.029, COST: 0.005, DIS: 0.009, XOM: 0.035, JNJ: 0.031, SPY: 0.012, QQQ: 0.006, SCHD: 0.036, O: 0.055 };

const myDividends = (pid = Store.myPid, days = 365) => Store.all('dividends').filter(x => x.pid === pid && x.ts > Date.now() - days * 86400000);

const fmtDay = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const u3 = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

const askCode = msg => { const v = prompt(msg); return v ? v.trim() : ''; };

try { if (!sessionStorage.getItem('pi_visit')){ sessionStorage.setItem('pi_visit', '1'); localStorage.setItem('pi_visits', String((+localStorage.getItem('pi_visits') || 0) + 1)); } } catch(e){}

/* ---------- club money controls (mirrors the server rules; the server always decides) ---------- */
const MONEY_OFFICERS = ['owner', 'admin', 'treasurer', 'asstTreasurer'], VOTED_ROLES = ['owner', 'admin', 'lead', 'treasurer', 'asstTreasurer'];

/* ---------- Ideas: shared watchlist and stock studies ---------- */
const VERDICT = { buy: ['Worth buying', 'blue'], watch: ['Keep watching', ''], pass: ['Pass for now', 'ember'] };

/* ---------- Meetings ---------- */
const MEET_ROLES = ['owner', 'admin', 'treasurer'];

/* ---------- uploads (payment proofs, club documents) ---------- */
const DOC_TYPES = ['Articles of organization (LLC)', 'Partnership agreement', 'Tax ID (EIN) letter', 'Operating agreement', 'Bank or brokerage statement', 'Other'];

const readFile64 = file => new Promise((res, rej) => { if (!file) return rej(Object.assign(new Error('Choose a file to upload.'), { userFacing: true })); if (file.size > 5 * 1024 * 1024) return rej(Object.assign(new Error('Files can be up to 5 MB.'), { userFacing: true }));
  const r = new FileReader(); r.onload = () => res({ name: file.name, type: file.type, data: String(r.result).split(',')[1] }); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(file); });

const STATUS = { pending: ['Waiting for review', 'ember'], confirmed: ['Confirmed', 'blue'], declined: ['Declined', ''] };

/* ---------- track records ---------- */
const RISK_WORD = s => s <= 2 ? 'Low' : s <= 4 ? 'Moderate' : s <= 6 ? 'High' : 'Very high';

const RSTATUS = { new:'Sent', accepted:'Sent', pending_new:'Sent', accepted_for_bidding:'Sent', held:'Sent', calculated:'Sent', done_for_day:'Sent', partially_filled:'Partly filled', filled:'Filled', canceled:'Canceled', pending_cancel:'Canceling', expired:'Expired', rejected:'Rejected', sending:'Sending', replaced:'Replaced', stopped:'Stopped', suspended:'Paused' };

const ROPEN = ['new','accepted','pending_new','partially_filled','accepted_for_bidding','held','pending_cancel','calculated','done_for_day','sending'];

const TSTATUS = { QUEUED:'Pending', SENT_TO_CLEARING:'Pending', APPROVAL_PENDING:'Pending', PENDING:'Pending', SUBMITTED:'Pending', COMPLETE:'Completed', RETURNED:'Returned by your bank', CANCELED:'Canceled', REJECTED:'Rejected' };

const POST_RANGES = [['1h', 'Last hour', 3600000], ['1d', 'Day', 86400000], ['1w', 'Week', 7 * 86400000], ['1m', 'Month', 30 * 86400000], ['all', 'All', Infinity]];


/* ---------- render ---------- */
let rq = false;

let searchTimer = null;

document.addEventListener('input', e => {
  if (!e.target.matches || !e.target.matches('[data-search]')) return;
  ui.searchQ = e.target.value.trim(); clearTimeout(searchTimer);
  if (!ui.searchQ){ ui.search = null; render(); return refocus(); }
  searchTimer = setTimeout(() => { ui.search = 'loading'; Store.searchStocks(ui.searchQ).then(r => { ui.search = r; render(); refocus(); }, () => { ui.search = []; render(); refocus(); }); }, 250);
});

let tick = 0;

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

const GROUP_TEMPLATES = [
  ['club', 'Investment club', 'Members propose and vote. Majority rules.', 'request', ['Any member can propose trades and changes', 'Majority vote, with half of members voting', 'No stock above 10% of the portfolio without a vote', 'Risk Manager review on', 'New members approved by you', '60 minutes to approve each copied trade']],
  ['family', 'Family fund', 'One Lead Trader, members approve each trade.', 'invite', ['The Owner, Admins and Lead Trader propose', 'Majority vote, with half of members voting', 'No stock above 10% of the portfolio without a vote', 'Invite link only', '60 minutes to approve each copied trade']],
  ['friends', 'Friends group', 'Relaxed rules and open discussion.', 'invite', ['Anyone in the group can propose', 'Simple majority', 'No position limit', 'Invite link only', 'Members copy half-size trades by default', '30 minutes to approve each copied trade']],
  ['pool', 'Pooled club', 'Members add money to one shared account; every trade is voted on.', 'request', ['Practice money only during the beta', 'Members add money to the club and own units of it', 'Trades happen only after a member vote', 'Any member can propose', 'Withdrawals approved by the Treasurer, Owner or an Admin', 'Club books kept automatically']],
  ['custom', 'Custom', 'Start from the basics and set everything yourself.', 'open', ['Standard rules; change them anytime in Settings']]
];

const wouldPayHTML = () => `<div class="field" style="margin-top:14px"><label>After the beta, Pro will cost $9.99 a month. Would you keep it?</label><div class="seg" data-wp>${[['yes','Yes'],['maybe','Maybe'],['no','No']].map(([k, l]) => `<button type="button" data-wpk="${k}">${l}</button>`).join('')}</div><span class="hint">Pro is free while we test. Your answer helps us set the price.</span></div>`;

document.addEventListener('click', ev => { const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return; if (el.tagName === 'A') ev.preventDefault(); act(el, ev); });

document.addEventListener('change', ev => { const el = ev.target; if (el.id === 'st-type' && ui.stP){ ui.stP.type = el.value; return render(); } if (el.id === 'st-acc'){ ui.stAcc = +el.value || 0; return; } if (el.id === 'tax-y'){ ui.taxYear = +el.value; return render(); } if (el.dataset && el.dataset.act === 'setrisk'){ Store.setRisk(el.value).then(() => toast('Investing style updated.'), errToast); return; } if (el.dataset && el.dataset.act === 'role'){ Store.setRole(el.dataset.gid, el.dataset.pid, el.value).then(() => toast('Role updated.'), errToast); } });

document.addEventListener('input', ev => { const el = ev.target; if (el.dataset && el.dataset.draft) ui.drafts[el.dataset.draft] = el.value; });

window.addEventListener('hashchange', () => { ui.feedLimit = 30; ui.stats = {}; if (route().name !== 'markets'){ ui.searchQ = ''; ui.search = null; } if (ui.lastRoute === 'feed' || ui.lastRoute === 'home') ui.lastSeenPost = Date.now(); ui.lastRoute = route().name; closeModal(); window.scrollTo(0, 0); if (route().name !== 'admin') ui.admin = null; if (route().name !== 'metrics') ui.usage = null; if (route().name !== 'settings') ui.pushState = null; if (route().name !== 'statements') ui.docs = null; if (route().name !== 'security') ui.sec = null; render(); if (route().name === 'notifications') setTimeout(() => Store.markSeen(), 1500); });


/* ---------- viewer tour (read-only, nothing is written) ---------- */
const TOUR = [
  { t:"You're Dan, a group member", say:"Dan has a simulated portfolio and belongs to two investing groups. Everything here is sample data, and nothing you tap changes it.", go:'#/home' },
  { t:'An approval request', say:"Maya, the Lead Trader of Dan's group, just bought MSFT. Dan gets a request sized to his capital, on his phone too. He can copy half or the full amount, within the window his group sets: 30 minutes here. Nothing executes without him.", go:'#/inbox' },
  { t:'Inside a group', say:"The group's timeline mixes Lead Trader trades, member posts and votes. The bar under each trade shows how many members copied it.", go:'#/group/g_techmomentum/activity' },
  { t:'Risk Manager review', say:"This group holds every trade for its Risk Manager before members see it. Jake can release it, or pause it so the group votes on whether to copy it.", go:'#/group/g_techmomentum/activity', sampleReview: true },
  { t:'Group rules', say:"Each group sets its own rules: how people join, a minimum account value, trades above 10% of the portfolio need a vote, which investments are allowed, and rules members accept when they join.", go:'#/group/g_techmomentum/rules' },
  { t:'Members vote', say:"Trade ideas and rule changes go to a vote. Here, half the members must vote and a majority must agree. A passed trade idea becomes a trade every member can approve.", go:'#/group/g_techmomentum/proposals' },
  { t:'Roles', say:"Nine roles keep a group organized, from Owner and Lead Trader to Analysts who propose trades, Junior Traders who suggest them, and the Risk Manager.", go:'#/group/g_techmomentum/members' },
  { t:'How Dan tracks his group', say:"Dan's copied trades against the Lead Trader's and the S&P 500. Trades he skipped show up as drift.", go:'#/group/g_techmomentum/performance' },
  { t:'The social feed', say:'Investors share ideas and trades. Anyone can follow an investor, or copy their trades individually with the same approval step.', go:'#/feed' },
  { t:'Copying one investor', say:"Maya's profile: her return, top holdings and posts. Pro members can copy her trades, approving each one.", go:'#/u/demo_maya' },
  { t:'How Pocket makes money', say:'The app is free to start. Pro ($9.99 a month) unlocks full group membership, copying and performance tracking. Group owners pay $19.99 a month for Group Pro.', go:'#/home', after: () => upgradeSheet() },
  { t:"That's the tour", say:'Invest on your own, copy an investor, or invest together as a group, with approval on every trade and a weekly digest to keep up. The beta is invite only: ask the Pocket team for an invite code.', go:'#/home' }
];


/* ---------- presenter mode ---------- */
const until = async (fn, ms = 4000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 60)); };

const PRESENT = [
  { t:'Your portfolio', say:'Every user starts with simulated cash. This is the individual side of the app: a portfolio, holdings and markets.', go: async () => { if (!Store.get('profiles', Store.myPid)) await Store.ensureMe(); location.hash = '#/home'; } },
  { t:'The social feed', say:'Investors share ideas and trades. You can follow them, comment, and copy an individual investor.', go: async () => { location.hash = '#/feed'; } },
  { t:'A group', say:'Groups have roles: an Owner, Admins, a Lead Trader who trades for the group, and Members who vote and copy.', go: async () => { location.hash = '#/group/g_techmomentum'; } },
  { t:'The Pro upgrade', say:'Full membership is part of Pro, $9.99 a month. This is where the business model shows up in the product.', go: async () => { location.hash = '#/group/g_techmomentum'; await new Promise(r => setTimeout(r, 80)); if (!Store.membership('g_techmomentum') || Store.membership('g_techmomentum').role === 'observer'){ if (Store.isPro()) await Store.join('g_techmomentum', 'member', { acceptRules: true }); else joinSheet('g_techmomentum'); } } },
  { t:'The Lead Trader trades', say:"Maya buys for the group. Her order fills in her own account, and every member gets an approval request sized to their capital.", go: async () => {
      closeModal(); if (!Store.isPro()){ await Store.upgradePro(); } if (!Store.membership('g_techmomentum') || Store.membership('g_techmomentum').role === 'observer') await Store.join('g_techmomentum', 'member', { acceptRules: true });
      await until(() => Store.isPro() && (Store.membership('g_techmomentum') || {}).role === 'member');
      if (Clock.mode() === 'live' && !Clock.canFillNow()){ await Store.setClock('open'); await until(() => Clock.mode() === 'open'); }
      const g = Store.get('groups', 'g_techmomentum'); const sym = ['AAPL','MSFT','GOOGL','AMZN','NVDA'][Math.floor(Math.random() * 5)];
      if (!(Store.membership('g_techmomentum') || {}).rulesAcceptedTs && !(Store.membership('g_techmomentum'))) await Store.join('g_techmomentum', 'member', { acceptRules: true });
      await Store.groupTrade('g_techmomentum', g.leadPid, sym, 'buy', Math.floor(8000 / Market.price(sym) * 1000) / 1000, `Adding ${'$' + sym} at about 8% of the portfolio. Approve if it fits your plan.`);
      location.hash = '#/group/g_techmomentum/activity'; } },
  { t:'The Risk Manager reviews', say:"This group holds every trade for its Risk Manager before members see it. Jake can release it, or pause it for a group vote. He releases this one.", go: async () => {
      await until(() => Store.all('reviews').some(r => r.gid === 'g_techmomentum' && r.status === 'pending'), 3000);
      if (Store.all('reviews').some(r => r.gid === 'g_techmomentum' && r.status === 'pending')) await Store.demoReview('g_techmomentum', 'release');
      location.hash = '#/group/g_techmomentum/activity'; } },
  { t:'You approve', say:'Nothing executes without the member. Approve within 30 minutes, or 5 minutes before the close. Late-day trades can be bought at the next open.', go: async () => { location.hash = '#/inbox'; } },
  { t:'The group responds', say:'Other members approve or decline. The Lead Trader sees how many copied.', go: async () => { await Store.simulateApprovals('g_techmomentum'); location.hash = '#/group/g_techmomentum/activity'; } },
  { t:'Members vote', say:'Trade ideas and strategy changes go to a vote. Owners, Admins and Lead Traders propose; members decide.', go: async () => { const n = await Store.simulateVotes('pr_amd', 1); await until(() => Store.tally('pr_amd').cast >= 4 || n === 0, 3000); const pr = Store.get('proposals', 'pr_amd'); if (pr && pr.status === 'open'){ await Store.closeProposal('pr_amd'); await until(() => Store.get('proposals', 'pr_amd').status !== 'open'); } location.hash = '#/group/g_techmomentum/proposals'; } },
  { t:'The decision becomes a trade', say:'Once the vote passes, the Lead Trader executes it. Every member gets an approval request, so the group decides and each person still controls their own account.', go: async () => { await until(() => Store.tally('pr_amd') && Store.tally('pr_amd').closed); const pr = Store.get('proposals', 'pr_amd'); if (pr && !pr.executed && Store.tally('pr_amd').result === 'passed') await Store.executeProposal('pr_amd'); location.hash = '#/group/g_techmomentum/activity'; } },
  { t:'How you track the group', say:'Pro members see their copied trades against the Lead Trader and the S&P 500. Skipped trades show up as drift.', go: async () => { location.hash = '#/group/g_techmomentum/performance'; } },
  { t:"That's the product", say:'Invest on your own, follow and copy investors, or invest together in a group, all with member approval on every trade.', go: async () => { location.hash = '#/home'; } }
];


/* ---------- error reports and screen views for the beta ---------- */
let errCount = 0;

window.addEventListener('error', e => reportError(e.message || 'Error', e.error && e.error.stack));

window.addEventListener('unhandledrejection', e => { const r = e.reason || {}; if (r.userFacing) return; reportError('Unhandled: ' + (r.message || r), r.stack); });

const seenViews = {};

window.addEventListener('hashchange', logView);


/* ---------- real-money updates pushed privately from the server ---------- */
Store.onReal(m => {
  if (m.what === 'order' && m.status === 'filled') toast(`Filled: ${m.side === 'buy' ? 'bought' : 'sold'} ${shs(m.filledQty)} ${m.sym} at ${usd(m.filledPrice)}.`, { ms: 7000 });
  else if (m.what === 'order' && ['canceled','rejected','expired'].includes(m.status)) toast(`Your ${m.sym} order was ${m.status}.`, { ms: 7000 });
  else if (m.what === 'transfer') toast(`${m.direction === 'INCOMING' ? 'Deposit' : 'Withdrawal'} of ${usd(m.amount)}: ${(TSTATUS[m.status] || m.status).toLowerCase()}.`, { ms: 7000 });
  else if (m.what === 'account') toast(m.status === 'ACTIVE' ? 'Your brokerage account is approved and active.' : 'Your brokerage account status changed.', { ms: 7000 });
  if (route().name === 'portfolio' && ui.homeTab === 'real') loadReal(); else ui.real = null;
});


/* ---------- boot ---------- */
Store.subscribe(() => { watchRequests(); schedule(); });

render();

Store.init().then(() => { render(); logView(); }, e => { console.error(e); render(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

setInterval(() => { tick++; live(tick % 5 === 0); if (tick % 15 === 0){ Store.housekeeping(); renderNav(); } if (tick % 60 === 0) schedule(); }, 1000);
