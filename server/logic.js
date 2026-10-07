/* Every action a user can take. Each runs inside a database transaction,
   checks permissions, and prices trades on the server. */
const Market = require('./market');

class UserError extends Error { constructor(m){ super(m); this.userFacing = true; } }
const fail = m => new UserError(m);
const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;
const f3 = n => Math.floor(n * 1000 + 1e-6) / 1000;
const START_CASH = 100000;
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const num = v => { const n = Number(v); if (!Number.isFinite(n)) throw fail('Enter a valid number.'); return n; };
const sym = v => { if (!Market.MAP[v]) throw fail("That stock isn't in this demo."); return v; };
const side = v => { if (v !== 'buy' && v !== 'sell') throw fail('Choose buy or sell.'); return v; };

const canTradeFor = r => ['owner','admin','lead'].includes(r);
const canPropose = r => ['owner','admin','lead'].includes(r);
const canVote = r => !!r && r !== 'observer';
const canManage = r => ['owner','admin'].includes(r);

const clockMode = tx => tx.getSetting('clock', 'live');
function pv(pf, now = Date.now()){ if (!pf) return 0; let v = pf.cash || 0; for (const [s, p] of Object.entries(pf.positions || {})) v += p.shares * Market.price(s, now); return v; }
function requestState(r, now = Date.now()){ if (r.status === 'pending' && now > r.expiresTs) return 'expired'; return r.status; }
async function isPro(tx, pid){ const p = await tx.get('profiles', pid); return !!p && (p.kind === 'demo' || p.plan === 'pro'); }
async function isDemo(tx, pid){ const p = await tx.get('profiles', pid); return !!p && p.kind === 'demo'; }
async function roleIn(tx, gid, pid){ const m = await tx.get('memberships', gid + '__' + pid); return m && m.role; }
async function needProfile(tx, ctx){ if (!ctx.pid) throw fail('Sign in first.'); const p = await tx.get('profiles', ctx.pid); if (!p) throw fail('Your account has no profile yet.'); return p; }
const needAdmin = ctx => { if (!ctx.isAdmin) throw fail('Only demo admins can do that.'); };

/* ---------- trading ---------- */
async function executeTrade(tx, pid, s, sd, shares, opt = {}){
  const pf = await tx.get('portfolios', pid, { lock: true }); if (!pf) throw fail('No portfolio found for this account.');
  pf.positions = pf.positions || {};
  const price = Market.price(s); shares = r3(shares);
  if (!(shares > 0)) throw fail('Enter an amount above zero.');
  const pos = pf.positions[s] || { shares: 0, cost: 0 };
  if (sd === 'buy'){
    const cost = r2(shares * price);
    if (cost > pf.cash + 0.01) throw fail('Not enough cash for this order.');
    pf.cash = r2(pf.cash - cost); pos.cost = r2(pos.cost + cost); pos.shares = r3(pos.shares + shares);
  } else {
    if (shares > pos.shares + 0.0005) throw fail("You can't sell more shares than you hold.");
    const avg = pos.shares ? pos.cost / pos.shares : 0;
    pos.cost = r2(pos.cost - avg * shares); pos.shares = r3(pos.shares - shares); pf.cash = r2(pf.cash + shares * price);
  }
  if (pos.shares <= 0.0005) delete pf.positions[s]; else pf.positions[s] = pos;
  pf.updatedTs = Date.now();
  await tx.set('portfolios', pid, pf);
  const id = tx.newId();
  const trade = { pid, sym: s, side: sd, shares, price, ts: Date.now(), groupId: opt.groupId || null, copyOf: opt.copyOf || null };
  await tx.set('trades', id, trade);
  if (opt.share) await tx.set('posts', tx.newId(), { pid, ts: Date.now(), groupId: opt.groupId || null, text: str(opt.note, 500), trade: { sym: s, side: sd, shares, price } });
  return Object.assign({ id }, trade);
}
async function before(tx, pid, s){ const pf = await tx.get('portfolios', pid); return { leaderValue: pv(pf), heldBefore: (((pf || {}).positions || {})[s] || {}).shares || 0 }; }
async function fanOut(tx, leaderPid, t, { gid = null, leaderValue, heldBefore }){
  const now = Date.now(), win = Market.approvalWindow(await clockMode(tx), now);
  const recips = gid
    ? (await tx.find('memberships', { gid })).filter(m => m.pid !== leaderPid && m.role !== 'observer').map(m => ({ pid: m.pid, pct: m.copyPct ?? 1 }))
    : (await tx.find('copies', { to: leaderPid })).filter(c => c.from !== leaderPid).map(c => ({ pid: c.from, pct: c.copyPct ?? 1 }));
  let sent = 0;
  for (const rc of recips){
    const mpf = await tx.get('portfolios', rc.pid); if (!mpf) continue;
    let sh;
    if (t.side === 'buy'){ const frac = (t.shares * t.price) / (leaderValue || 1); sh = f3(frac * pv(mpf) * rc.pct / t.price); }
    else { const held = ((mpf.positions || {})[t.sym] || {}).shares || 0; sh = f3(held * Math.min(1, heldBefore ? t.shares / heldBefore : 1)); }
    if (!(sh > 0)) continue;
    await tx.set('copyRequests', tx.newId(), { gid, kind: gid ? 'group' : 'investor', tradeId: t.id, leaderPid, memberPid: rc.pid, sym: t.sym, side: t.side,
      leaderShares: t.shares, leaderPrice: t.price, shares: sh, status: 'pending', mode: win.mode, createdTs: now, expiresTs: win.expiresTs,
      leaderFrac: t.side === 'sell' && heldBefore ? Math.min(1, t.shares / heldBefore) : null });
    sent++;
  }
  return sent;
}
async function personalTrade(tx, pid, s, sd, shares, opt){
  const b = await before(tx, pid, s);
  const t = await executeTrade(tx, pid, s, sd, shares, opt);
  const sent = await fanOut(tx, pid, t, b);
  return Object.assign(t, { sent });
}
async function groupTrade(tx, gid, leaderPid, s, sd, shares, note){
  const b = await before(tx, leaderPid, s);
  const t = await executeTrade(tx, leaderPid, s, sd, shares, { groupId: gid });
  const sent = await fanOut(tx, leaderPid, t, Object.assign({ gid }, b));
  await tx.set('posts', tx.newId(), { pid: leaderPid, groupId: gid, ts: Date.now(), text: str(note, 500), trade: { sym: s, side: sd, shares: t.shares, price: t.price }, groupTrade: true });
  return { trade: t, sent };
}
async function fillRequest(tx, r, frac){
  frac = Math.max(0.01, Math.min(1, Number(frac) || r.frac || 1));
  const mpf = await tx.get('portfolios', r.memberPid, { lock: true }); const px = Market.price(r.sym);
  const target = f3(r.shares * frac); let shares = target;
  if (r.side === 'buy'){ const cash = (mpf && mpf.cash) || 0; if (shares * px > cash) shares = f3(cash / px); }
  else { const held = (((mpf && mpf.positions) || {})[r.sym] || {}).shares || 0; shares = Math.min(shares, held); }
  if (!(shares > 0)){ await tx.update('copyRequests', r.id, { status: 'declined', note: 'Not enough cash or shares', decidedTs: Date.now() }); return null; }
  const t = await executeTrade(tx, r.memberPid, r.sym, r.side, shares, { groupId: r.gid, copyOf: r.id });
  const partial = t.shares < target - 0.0005;
  await tx.update('copyRequests', r.id, Object.assign({ status: 'filled', fillPrice: t.price, fillShares: t.shares, decidedTs: Date.now(), frac },
    partial ? { partial: true, note: r.side === 'buy' ? 'Not enough cash for the full amount' : 'You held fewer shares' } : {}));
  return Object.assign(t, { partial, requested: target, frac });
}

/* ---------- proposals ---------- */
async function tally(tx, prid){
  const pr = await tx.get('proposals', prid); if (!pr) return null;
  const eligible = (await tx.find('memberships', { gid: pr.gid })).filter(m => canVote(m.role)).map(m => m.pid);
  const vs = (await tx.find('votes', { prid })).filter(v => eligible.includes(v.pid));
  const c = { yes: 0, no: 0, abstain: 0 }; vs.forEach(v => c[v.vote] = (c[v.vote] || 0) + 1);
  const allVoted = vs.length >= eligible.length && eligible.length > 0;
  const closed = pr.status !== 'open' || Date.now() > pr.deadlineTs || allVoted;
  return Object.assign(c, { closed, result: pr.status !== 'open' ? pr.status : (c.yes > c.no ? 'passed' : 'failed'), pr });
}
async function executeProposal(tx, prid, leaderPid){
  const t = await tally(tx, prid); if (!t) throw fail('Proposal not found.');
  const pr = t.pr;
  if (!(t.closed && t.result === 'passed')) throw fail('Only a passed proposal can be executed.');
  if (pr.executed) throw fail('This proposal was already executed.');
  if (!pr.tradeSym) throw fail('This proposal has no trade attached.');
  const lpf = await tx.get('portfolios', leaderPid); const val = pv(lpf), px = Market.price(pr.tradeSym);
  let shares;
  if (pr.tradeSide === 'sell'){ const held = (((lpf || {}).positions || {})[pr.tradeSym] || {}).shares || 0; shares = f3(held * Math.min(1, pr.tradePct * val / Math.max(1e-9, held * px))); }
  else shares = f3(val * pr.tradePct / px);
  if (pr.status === 'open') await tx.update('proposals', prid, { status: 'passed', closedTs: Date.now() });
  const res = await groupTrade(tx, pr.gid, leaderPid, pr.tradeSym, pr.tradeSide || 'buy', shares, `Executing the group's decision: ${pr.title}`);
  await tx.update('proposals', prid, { executed: true, executedTs: Date.now(), executedBy: leaderPid });
  return res;
}
async function vote(tx, prid, pid, v){
  if (!['yes','no','abstain'].includes(v)) throw fail('Choose yes, no or abstain.');
  const t = await tally(tx, prid); if (!t) throw fail('Proposal not found.');
  if (!canVote(await roleIn(tx, t.pr.gid, pid))) throw fail('Only members can vote.');
  if (t.pr.status !== 'open' || Date.now() > t.pr.deadlineTs) throw fail('Voting has closed.');
  await tx.set('votes', prid + '__' + pid, { prid, pid, vote: v, ts: Date.now() });
}

/* ---------- action table: name -> (tx, ctx, args) ---------- */
const A = {};
A.setRisk = async (tx, ctx, a) => { await needProfile(tx, ctx); if (!['conservative','balanced','growth'].includes(a.risk)) throw fail('Pick a style.'); await tx.update('profiles', ctx.pid, { riskProfile: a.risk }); };
A.markSeen = async (tx, ctx) => { await needProfile(tx, ctx); await tx.update('profiles', ctx.pid, { notifSeenTs: Date.now() }); };
A.updateBio = async (tx, ctx, a) => { await needProfile(tx, ctx); await tx.update('profiles', ctx.pid, { bio: str(a.bio, 200) }); };
A.resetMe = async (tx, ctx) => {
  await needProfile(tx, ctx);
  await tx.set('portfolios', ctx.pid, { cash: START_CASH, startValue: START_CASH, positions: {}, updatedTs: Date.now() });
  for (const r of await tx.find('copyRequests', { memberPid: ctx.pid })) await tx.del('copyRequests', r.id);
};
A.trade = async (tx, ctx, a) => { await needProfile(tx, ctx); return personalTrade(tx, ctx.pid, sym(a.sym), side(a.side), num(a.shares), { share: !!a.share, note: a.note }); };
A.groupTrade = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  if (!canTradeFor(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners, Admins and Lead Traders can trade for the group.');
  return groupTrade(tx, a.gid, ctx.pid, sym(a.sym), side(a.side), num(a.shares), a.note);
};
A.approve = async (tx, ctx, a) => {
  const r = await tx.get('copyRequests', a.id, { lock: true }); if (!r) throw fail('This request no longer exists.');
  if (r.memberPid !== ctx.pid) throw fail('This request belongs to someone else.');
  const st = requestState(r);
  if (st === 'expired'){ await tx.update('copyRequests', r.id, { status: 'expired' }); throw fail('This request expired before it was approved.'); }
  if (st !== 'pending') throw fail('This request was already handled.');
  const frac = Math.max(0.01, Math.min(1, Number(a.frac) || 1));
  if (r.mode === 'open' && !Market.canFillNow(await clockMode(tx))){ await tx.update('copyRequests', r.id, { status: 'queued', frac, decidedTs: Date.now() }); return { queued: true }; }
  return { trade: await fillRequest(tx, r, frac) };
};
A.decline = async (tx, ctx, a) => { const r = await tx.get('copyRequests', a.id); if (!r || r.memberPid !== ctx.pid) throw fail('Request not found.'); if (r.status !== 'pending') throw fail('This request was already handled.'); await tx.update('copyRequests', r.id, { status: 'declined', decidedTs: Date.now() }); };
A.cancelQueued = async (tx, ctx, a) => { const r = await tx.get('copyRequests', a.id); if (!r || r.memberPid !== ctx.pid) throw fail('Order not found.'); if (r.status !== 'queued') throw fail('This order has already been filled or cancelled.'); await tx.update('copyRequests', r.id, { status: 'cancelled', cancelledTs: Date.now(), decidedTs: Date.now() }); };
A.createGroup = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  const name = str(a.name, 60).trim(); if (!name) throw fail('Give the group a name.');
  const id = tx.newId();
  await tx.set('groups', id, { name, description: str(a.description, 300), strategy: str(a.strategy, 120), membership: a.membership === 'invite' ? 'invite' : 'open',
    ownerPid: ctx.pid, leadPid: ctx.pid, groupPro: true, groupProSince: Date.now(), createdTs: Date.now(), riskLevel: ['conservative','balanced','growth'].includes(a.riskLevel) ? a.riskLevel : null });
  await tx.set('memberships', id + '__' + ctx.pid, { gid: id, pid: ctx.pid, role: 'owner', copyPct: 1, joinedTs: Date.now() });
  return id;
};
A.join = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.');
  const cur = await roleIn(tx, a.gid, ctx.pid);
  if (g.membership === 'invite' && !cur) throw fail('This group is invite only. Request to join instead.');
  let role = a.role === 'observer' ? 'observer' : 'member';
  if (role === 'member' && !(await isPro(tx, ctx.pid))) throw fail('Full membership is part of Pro.');
  if (cur && cur !== 'observer') return;
  await tx.set('memberships', a.gid + '__' + ctx.pid, { gid: a.gid, pid: ctx.pid, role, copyPct: 1, joinedTs: Date.now() });
};
A.leave = async (tx, ctx, a) => { const r = await roleIn(tx, a.gid, ctx.pid); if (!r) return; if (r === 'owner') throw fail("Owners can't leave their own group."); await tx.del('memberships', a.gid + '__' + ctx.pid); };
A.setRole = async (tx, ctx, a) => {
  if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can change roles.');
  if (!['admin','lead','member','observer'].includes(a.role)) throw fail('Unknown role.');
  const m = await tx.get('memberships', a.gid + '__' + a.pid); if (!m) throw fail('Member not found.'); if (m.role === 'owner') throw fail("The Owner's role can't be changed.");
  await tx.update('memberships', a.gid + '__' + a.pid, { role: a.role });
};
A.setCopyPct = async (tx, ctx, a) => { if (!(await roleIn(tx, a.gid, ctx.pid))) throw fail('Join the group first.'); await tx.update('memberships', a.gid + '__' + ctx.pid, { copyPct: Math.max(0.1, Math.min(1, num(a.pct))) }); };
A.propose = async (tx, ctx, a) => {
  if (!canPropose(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners, Admins and Lead Traders can create proposals.');
  const title = str(a.title, 120).trim(); if (!title) throw fail('Give the proposal a title.');
  const now = Date.now(), type = ['trade','strategy','policy','role'].includes(a.type) ? a.type : 'trade';
  const extra = type === 'trade' && a.sym ? { tradeSym: sym(a.sym), tradeSide: a.side === 'sell' ? 'sell' : 'buy', tradePct: Math.max(0.005, Math.min(0.5, Number(a.pct) || 0.05)) } : {};
  const id = tx.newId();
  await tx.set('proposals', id, Object.assign({ gid: a.gid, authorPid: ctx.pid, type, title, details: str(a.details, 800), createdTs: now, deadlineTs: now + Math.max(1, Math.min(14, Number(a.days) || 3)) * 86400000, status: 'open' }, extra));
  return id;
};
A.vote = async (tx, ctx, a) => vote(tx, a.prid, ctx.pid, a.vote);
A.closeProposal = async (tx, ctx, a) => {
  const t = await tally(tx, a.prid); if (!t) throw fail('Proposal not found.');
  if (!canManage(await roleIn(tx, t.pr.gid, ctx.pid)) && !ctx.isAdmin) throw fail('Only Owners and Admins can close a vote.');
  if (t.pr.status !== 'open') return;
  await tx.update('proposals', a.prid, { status: t.yes > t.no ? 'passed' : 'failed', closedTs: Date.now() });
};
A.executeProposal = async (tx, ctx, a) => {
  const pr = await tx.get('proposals', a.prid); if (!pr) throw fail('Proposal not found.');
  if (!canTradeFor(await roleIn(tx, pr.gid, ctx.pid))) throw fail('Only Owners, Admins and Lead Traders can execute a decision.');
  return executeProposal(tx, a.prid, ctx.pid);
};
A.post = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  const text = str(a.text, 500).trim(); if (!text) throw fail('Write something first.');
  if (a.groupId && !(await roleIn(tx, a.groupId, ctx.pid))) throw fail('Join the group to post there.');
  await tx.set('posts', tx.newId(), { pid: ctx.pid, text, ts: Date.now(), groupId: a.groupId || null });
};
A.toggleLike = async (tx, ctx, a) => { await needProfile(tx, ctx); const id = a.postId + '__' + ctx.pid; if (await tx.get('reactions', id)) await tx.del('reactions', id); else await tx.set('reactions', id, { postId: a.postId, pid: ctx.pid, ts: Date.now() }); };
A.comment = async (tx, ctx, a) => { await needProfile(tx, ctx); const text = str(a.text, 400).trim(); if (!text) throw fail('Write a comment first.'); if (!(await tx.get('posts', a.postId))) throw fail('Post not found.'); await tx.set('comments', tx.newId(), { postId: a.postId, pid: ctx.pid, text, ts: Date.now() }); };
A.deletePost = async (tx, ctx, a) => { const p = await tx.get('posts', a.id); if (!p) return; if (p.pid !== ctx.pid && !ctx.isAdmin) throw fail('You can only delete your own posts.'); await tx.del('posts', a.id); for (const c of await tx.find('comments', { postId: a.id })) await tx.del('comments', c.id); };
A.deleteComment = async (tx, ctx, a) => { const c = await tx.get('comments', a.id); if (!c) return; if (c.pid !== ctx.pid && !ctx.isAdmin) throw fail('You can only delete your own comments.'); await tx.del('comments', a.id); };
A.follow = async (tx, ctx, a) => { await needProfile(tx, ctx); if (a.pid === ctx.pid) return; await tx.set('follows', ctx.pid + '__' + a.pid, { from: ctx.pid, to: a.pid, ts: Date.now() }); };
A.unfollow = async (tx, ctx, a) => tx.del('follows', ctx.pid + '__' + a.pid);
A.upgradePro = async (tx, ctx) => { await needProfile(tx, ctx); await tx.update('profiles', ctx.pid, { plan: 'pro', proSince: Date.now() }); };
A.cancelPro = async (tx, ctx) => {
  await needProfile(tx, ctx); await tx.update('profiles', ctx.pid, { plan: 'free' });
  for (const m of (await tx.find('memberships', { pid: ctx.pid })).filter(m => m.role === 'member')) await tx.update('memberships', m.id, { role: 'observer' });
  for (const c of await tx.find('copies', { from: ctx.pid })) await tx.del('copies', c.id);
};
A.copyInvestor = async (tx, ctx, a) => { await needProfile(tx, ctx); if (!(await isPro(tx, ctx.pid))) throw fail('Copying investors is part of Pro.'); if (a.pid === ctx.pid) throw fail("You can't copy yourself."); await tx.set('copies', ctx.pid + '__' + a.pid, { from: ctx.pid, to: a.pid, copyPct: 1, ts: Date.now() }); };
A.stopCopying = async (tx, ctx, a) => tx.del('copies', ctx.pid + '__' + a.pid);
A.report = async (tx, ctx, a) => { await needProfile(tx, ctx); await tx.set('reports', tx.newId(), { gid: a.gid, reporterPid: ctx.pid, reason: str(a.reason, 40), details: str(a.details, 500), status: 'open', ts: Date.now() }); };
A.requestJoin = async (tx, ctx, a) => { await needProfile(tx, ctx); await tx.set('joinRequests', a.gid + '__' + ctx.pid, { gid: a.gid, pid: ctx.pid, status: 'pending', ts: Date.now() }); };
async function decideJoin(tx, id, approve){
  const r = await tx.get('joinRequests', id); if (!r) return;
  if (approve) await tx.set('memberships', r.gid + '__' + r.pid, { gid: r.gid, pid: r.pid, role: (await isPro(tx, r.pid)) ? 'member' : 'observer', copyPct: 1, joinedTs: Date.now() });
  await tx.update('joinRequests', id, { status: approve ? 'approved' : 'declined', decidedTs: Date.now() });
}
A.decideJoin = async (tx, ctx, a) => { const r = await tx.get('joinRequests', a.id); if (!r) return; if (!canManage(await roleIn(tx, r.gid, ctx.pid))) throw fail('Only Owners and Admins can decide.'); await decideJoin(tx, a.id, !!a.approve); };

/* ---------- admin: demo controls ---------- */
A.setClock = async (tx, ctx, a) => { needAdmin(ctx); if (!['live','open','late'].includes(a.mode)) throw fail('Unknown clock mode.'); await tx.setSetting('clock', a.mode); };
A.demoGroupTrade = async (tx, ctx, a) => { needAdmin(ctx); const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.'); return groupTrade(tx, a.gid, g.leadPid, sym(a.sym), side(a.side), num(a.shares), a.note); };
A.demoInvestorTrade = async (tx, ctx, a) => { needAdmin(ctx); if (!(await isDemo(tx, a.pid))) throw fail('Pick a sample investor.'); return personalTrade(tx, a.pid, sym(a.sym), side(a.side), num(a.shares), { share: true, note: a.note }); };
A.demoApprovals = async (tx, ctx, a) => {
  needAdmin(ctx); let n = 0; const mode = await clockMode(tx);
  const reqs = (await tx.find('copyRequests', { status: 'pending' })).filter(r => (r.gid || null) === (a.gid || null));
  for (const r of reqs){
    if (!(await isDemo(tx, r.memberPid)) || requestState(r) !== 'pending') continue;
    const roll = Math.random();
    if (roll < 0.75){ if (r.mode === 'open' && !Market.canFillNow(mode)) await tx.update('copyRequests', r.id, { status: 'queued', decidedTs: Date.now() }); else await fillRequest(tx, r); n++; }
    else if (roll < 0.9){ await tx.update('copyRequests', r.id, { status: 'declined', decidedTs: Date.now() }); n++; }
  }
  return n;
};
A.demoVotes = async (tx, ctx, a) => {
  needAdmin(ctx); const pr = await tx.get('proposals', a.prid); if (!pr) return 0;
  const yes = a.yes == null ? 0.65 : Math.max(0, Math.min(1, Number(a.yes))); let n = 0;
  for (const m of await tx.find('memberships', { gid: pr.gid })){
    if (!canVote(m.role) || !(await isDemo(tx, m.pid)) || (await tx.get('votes', a.prid + '__' + m.pid))) continue;
    const x = Math.random(); await vote(tx, a.prid, m.pid, x < yes ? 'yes' : x < yes + (1 - yes) * 0.7 ? 'no' : 'abstain'); n++;
  }
  return n;
};
A.demoExec = async (tx, ctx, a) => { needAdmin(ctx); const pr = await tx.get('proposals', a.prid); if (!pr) throw fail('Proposal not found.'); const g = await tx.get('groups', pr.gid); return executeProposal(tx, a.prid, g.leadPid); };
A.demoJoins = async (tx, ctx) => {
  needAdmin(ctx); let n = 0;
  for (const r of await tx.find('joinRequests', { status: 'pending' })){ const g = await tx.get('groups', r.gid); if (g && (await isDemo(tx, g.ownerPid))){ await decideJoin(tx, r.id, true); n++; } }
  return n;
};
const FRIENDS = [['Chris Walsh','Saw the group in action and wanted in.'],['Nina Brooks','Investing with friends for the first time.'],['Omar Haddad','Here for the dividend ideas.'],['Grace Kim','Learning by approving trades.'],['Theo Martin','Long-term index investor trying groups.'],['Rosa Diaz',"Joined from a friend's invite."]];
A.demoInvites = async (tx, ctx, a) => {
  needAdmin(ctx); if (!(await roleIn(tx, a.gid, ctx.pid))) throw fail('Join the group first.');
  const used = new Set((await tx.find('profiles')).map(p => p.name)); let k = 0;
  for (const [name, bio] of FRIENDS){
    if (k >= 2) break; if (used.has(name)) continue;
    const pid = 'demo_inv_' + tx.newId().slice(0, 10);
    await tx.set('profiles', pid, { kind: 'demo', name, bio, invited: true, createdTs: Date.now() });
    await tx.set('portfolios', pid, { cash: START_CASH, startValue: START_CASH, positions: {}, updatedTs: Date.now() });
    await tx.set('memberships', a.gid + '__' + pid, { gid: a.gid, pid, role: 'member', copyPct: 1, joinedTs: Date.now(), invitedBy: ctx.pid });
    k++;
  }
  return k;
};
A.resolveReport = async (tx, ctx, a) => { needAdmin(ctx); await tx.update('reports', a.id, { status: 'reviewed', reviewedTs: Date.now() }); };
A.resetAll = async (tx, ctx) => { needAdmin(ctx); return require('./seed').reset(tx); };

/* background job: expire stale requests and fill buy-at-open orders */
async function housekeeping(tx){
  const mode = await clockMode(tx), now = Date.now(); let n = 0;
  for (const r of await tx.find('copyRequests', { status: 'pending' })) if (requestState(r, now) === 'expired'){ await tx.update('copyRequests', r.id, { status: 'expired' }); n++; }
  if (Market.canFillNow(mode, now)) for (const r of await tx.find('copyRequests', { status: 'queued' })){ try { await fillRequest(tx, r); n++; } catch (e){ if (!e.userFacing) throw e; await tx.update('copyRequests', r.id, { status: 'declined', note: e.message, decidedTs: Date.now() }); } }
  return n;
}

module.exports = { actions: A, housekeeping, UserError, START_CASH };
