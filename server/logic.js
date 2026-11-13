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

const ROLES = ['owner','admin','lead','junior','analyst','risk','moderator','treasurer','asstTreasurer','member','observer'];
const ROLE_NAME = { owner:'Owner', admin:'Admin', lead:'Lead Trader', junior:'Junior Trader', analyst:'Analyst', risk:'Risk Manager', moderator:'Moderator', treasurer:'Treasurer', asstTreasurer:'Assistant Treasurer', member:'Member', observer:'Observer' };
/* Club money controls: officers who can approve, roles that change only by member vote in a pooled
   club, and a 7-day wait before someone newly given a money role can approve anything. */
const MONEY_OFFICERS = ['owner','admin','treasurer','asstTreasurer'];
const VOTED_ROLES = ['owner','admin','lead','treasurer','asstTreasurer'];
const ROLE_WAIT = 3 * 86400000;
function needTwoStep(ctx){ if (!ctx.twoStep) throw fail('Club money actions need two-step sign-in. Turn it on in your Profile, then try again.'); }
/* Notifications ride along with the transaction's changes and are sent after it commits. */
function notify(tx, pids, payload){ const p = [...new Set((pids || []).filter(Boolean))]; if (p.length) tx.__notes = (tx.__notes || []).concat([{ pids: p, payload }]); }
async function eligibleApprovers(tx, gid, exclude){ const A = await approvers(tx, gid, exclude); return A.fallback ? A.others : A.officers; }
const canTradeFor = r => ['owner','admin','lead'].includes(r);
const canVote = r => !!r && r !== 'observer';
const canManage = r => ['owner','admin'].includes(r);
const canModerate = r => ['owner','admin','moderator'].includes(r);
const canReview = r => ['risk','owner'].includes(r);
const DEFAULT_RULES = { joinMode: 'open', maxMembers: null, minAccount: 0, rulesText: '', proposeRoles: ['owner','admin','lead','analyst'], quorum: 0, passRule: 'majority',
  votingDays: 3, voteWaitDays: 0, maxPositionPct: null, allowed: 'any', allowedList: [], approvalMinutes: 30, riskReview: false, defaultCopyPct: 1, hidden: false, feeMonthly: null };
function rulesOf(g){ const r = Object.assign({}, DEFAULT_RULES, (g && g.rules) || {}); if (!(g && g.rules && g.rules.joinMode) && g && g.membership === 'invite') r.joinMode = 'request'; return r; }
const canPropose = (r, rules) => !!r && (rules ? rules.proposeRoles : DEFAULT_RULES.proposeRoles).includes(r);
function checkAllowed(rules, s){
  if (rules.allowed === 'etf' && !Market.ETFS.includes(s)) throw fail(`This group only invests in ETFs (${Market.ETFS.join(', ')}).`);
  if (rules.allowed === 'list' && !(rules.allowedList || []).includes(s)) throw fail(`${s} isn't on this group's list of allowed investments.`);
}
const votingAge = (m, rules) => !rules.voteWaitDays || Date.now() - (m.joinedTs || 0) >= rules.voteWaitDays * 86400000;

const clockMode = tx => tx.getSetting('clock', 'live');
function pv(pf, now = Date.now()){ if (!pf) return 0; let v = pf.cash || 0; for (const [s, p] of Object.entries(pf.positions || {})) v += p.shares * Market.price(s, now); return v; }
function requestState(r, now = Date.now()){ if (r.status === 'pending' && now > r.expiresTs) return 'expired'; return r.status; }
async function isPro(tx, pid){ const p = await tx.get('profiles', pid); return !!p && (p.kind === 'demo' || p.plan === 'pro'); }
async function isDemo(tx, pid){ const p = await tx.get('profiles', pid); return !!p && p.kind === 'demo'; }
async function roleIn(tx, gid, pid){ const m = await tx.get('memberships', gid + '__' + pid); return m && m.role; }
async function needProfile(tx, ctx){ if (!ctx.pid) throw fail('Sign in first.'); const p = await tx.get('profiles', ctx.pid); if (!p) throw fail('Your account has no profile yet.'); return p; }
const needAdmin = ctx => { if (!ctx.isAdmin) throw fail(ctx.adminPending ? 'Turn on two-step sign-in in your Profile to use admin tools.' : 'Only demo admins can do that.'); };

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
  const g = gid ? await tx.get('groups', gid) : null;
  const now = Date.now(), win = Market.approvalWindow(await clockMode(tx), now, g ? rulesOf(g).approvalMinutes : 30);
  const recips = gid
    ? (await tx.find('memberships', { gid })).filter(m => m.pid !== leaderPid && m.role !== 'observer' && !m.copyPaused).map(m => ({ pid: m.pid, pct: m.copyPct ?? 1 }))
    : (await tx.find('copies', { to: leaderPid })).filter(c => c.from !== leaderPid && !c.copyPaused).map(c => ({ pid: c.from, pct: c.copyPct ?? 1 }));
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
/* opt.voted: the trade came from a passed proposal, so position limits and review are already satisfied */
async function groupTrade(tx, gid, leaderPid, s, sd, shares, note, opt = {}){
  const g = await tx.get('groups', gid); if (!g) throw fail('Group not found.');
  const rules = rulesOf(g);
  checkAllowed(rules, s);
  const b = await before(tx, leaderPid, s);
  if (!opt.voted && sd === 'buy' && rules.maxPositionPct && b.leaderValue){
    const pctOf = shares * Market.price(s) / b.leaderValue;
    if (pctOf > rules.maxPositionPct + 1e-9) throw fail(`This trade is ${(pctOf * 100).toFixed(1)}% of the portfolio, above the group's ${Math.round(rules.maxPositionPct * 100)}% limit. Create a trade proposal so members can vote on it.`);
  }
  const t = await executeTrade(tx, leaderPid, s, sd, shares, { groupId: gid });
  const reviewer = !opt.voted && rules.riskReview && (await tx.find('memberships', { gid })).some(m => m.role === 'risk');
  let sent = 0, reviewId = null;
  if (reviewer){
    reviewId = tx.newId();
    await tx.set('reviews', reviewId, { gid, tradeId: t.id, leaderPid, sym: s, side: sd, shares: t.shares, price: t.price, leaderValue: b.leaderValue, heldBefore: b.heldBefore,
      status: 'pending', createdTs: Date.now(), expiresTs: Date.now() + 15 * 60000 });
  } else sent = await fanOut(tx, leaderPid, t, Object.assign({ gid }, b));
  await tx.set('posts', tx.newId(), Object.assign({ pid: leaderPid, groupId: gid, ts: Date.now(), text: str(note, 500), trade: { sym: s, side: sd, shares: t.shares, price: t.price }, groupTrade: true }, reviewId ? { reviewId } : {}));
  return { trade: t, sent, held: !!reviewId, reviewId };
}
async function releaseReview(tx, rv, how, by){
  const t = { id: rv.tradeId, sym: rv.sym, side: rv.side, shares: rv.shares, price: rv.price };
  const sent = await fanOut(tx, rv.leaderPid, t, { gid: rv.gid, leaderValue: rv.leaderValue, heldBefore: rv.heldBefore });
  await tx.update('reviews', rv.id, { status: 'released', how, decidedBy: by || null, decidedTs: Date.now(), sent });
  return sent;
}
/* Paused trades go to a vote; settle them once the vote closes. */
async function settleReviews(tx){
  for (const rv of await tx.find('reviews', { status: 'paused' })){
    if (!rv.proposalId) continue;
    const t = await tally(tx, rv.proposalId); if (!t || !t.closed) continue;
    if (t.pr.status === 'open') await tx.update('proposals', rv.proposalId, { status: t.result, closedTs: Date.now() });
    if (t.result === 'passed') await releaseReview(tx, rv, 'vote');
    else await tx.update('reviews', rv.id, { status: 'blocked', decidedTs: Date.now() });
  }
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
  const g = await tx.get('groups', pr.gid); const rules = rulesOf(g);
  const eligible = (await tx.find('memberships', { gid: pr.gid })).filter(m => canVote(m.role) && votingAge(m, rules)).map(m => m.pid);
  const vs = (await tx.find('votes', { prid })).filter(v => eligible.includes(v.pid));
  const c = { yes: 0, no: 0, abstain: 0 }; vs.forEach(v => c[v.vote] = (c[v.vote] || 0) + 1);
  const allVoted = vs.length >= eligible.length && eligible.length > 0;
  const closed = pr.status !== 'open' || Date.now() > pr.deadlineTs || allVoted;
  const quorumMet = !rules.quorum || (eligible.length && vs.length / eligible.length >= rules.quorum - 1e-9);
  const decided = c.yes + c.no, ratio = decided ? c.yes / decided : 0;
  const passes = quorumMet && decided > 0 && (rules.passRule === 'two-thirds' ? ratio >= 2 / 3 - 1e-9 : ratio > 0.5);
  return Object.assign(c, { closed, quorumMet, result: pr.status !== 'open' ? pr.status : (passes ? 'passed' : 'failed'), pr, rules });
}
async function executeProposal(tx, prid, leaderPid){
  const t = await tally(tx, prid); if (!t) throw fail('Proposal not found.');
  const pr = t.pr;
  if (!(t.closed && t.result === 'passed')) throw fail('Only a passed proposal can be executed.');
  if (pr.executed) throw fail('This proposal was already executed.');
  if (pr.type === 'windDown'){
    const wg = await tx.get('groups', pr.gid); if (wg.windDown) throw fail('The club is already winding down.');
    if (pr.status === 'open') await tx.update('proposals', prid, { status: 'passed', closedTs: Date.now() });
    await tx.update('groups', pr.gid, { windDown: { ts: Date.now(), by: leaderPid, prid } });
    await tx.update('proposals', prid, { executed: true, executedTs: Date.now(), executedBy: leaderPid });
    await tx.set('posts', tx.newId(), { pid: leaderPid, ts: Date.now(), groupId: pr.gid, text: 'Members voted to close the club. Next: sell all holdings, then pay everyone out by their units.' });
    await clubLog(tx, pr.gid, leaderPid, 'Members voted to wind down the club');
    notify(tx, (await tx.find('memberships', { gid: pr.gid })).map(m => m.pid), { title: wg.name + ' is closing', body: 'Members voted to wind down the club. Holdings will be sold and everyone paid out.', url: '/#/group/' + pr.gid + '/club', tag: 'club-' + pr.gid });
    return { windDown: true };
  }
  if (pr.rolePid){
    const tm = await tx.get('memberships', pr.gid + '__' + pr.rolePid); if (!tm) throw fail('That person is no longer in the group.');
    if (pr.status === 'open') await tx.update('proposals', prid, { status: 'passed', closedTs: Date.now() });
    if (pr.roleName === 'owner'){ const g = await tx.get('groups', pr.gid); await tx.update('memberships', pr.gid + '__' + g.ownerPid, { role: 'admin', roleChangedTs: Date.now() }); await tx.update('groups', pr.gid, { ownerPid: pr.rolePid }); }
    await applyRole(tx, pr.gid, pr.rolePid, tm.role, pr.roleName, leaderPid, prid);
    const g2 = await tx.get('groups', pr.gid);
    if (pr.roleName === 'lead') await tx.update('groups', pr.gid, { leadPid: pr.rolePid }); else if (g2.leadPid === pr.rolePid) await tx.update('groups', pr.gid, { leadPid: g2.ownerPid });
    await tx.update('proposals', prid, { executed: true, executedTs: Date.now(), executedBy: leaderPid });
    return { role: pr.roleName, pid: pr.rolePid };
  }
  if (!pr.tradeSym) throw fail('This proposal has no trade attached.');
  const pg = await tx.get('groups', pr.gid);
  if (pg && pg.pooled){
    if (!Market.canFillNow(await clockMode(tx))) throw fail('Markets are closed. Execute this during market hours.');
    const cp = await tx.get('portfolios', clubPid(pr.gid)), cval = pv(cp), cpx = Market.price(pr.tradeSym);
    let sh = pr.tradeSide === 'sell' ? Math.min(((cp.positions || {})[pr.tradeSym] || {}).shares || 0, f3(cval * pr.tradePct / cpx)) : f3(Math.min(cp.cash, cval * pr.tradePct) / cpx);
    if (!(sh > 0)) throw fail(pr.tradeSide === 'sell' ? "The club doesn't hold this stock." : "The club doesn't have enough cash. Members can add money first.");
    if (pr.status === 'open') await tx.update('proposals', prid, { status: 'passed', closedTs: Date.now() });
    const t = await executeTrade(tx, clubPid(pr.gid), pr.tradeSym, pr.tradeSide || 'buy', sh, { groupId: pr.gid });
    await tx.set('posts', tx.newId(), { pid: leaderPid, ts: Date.now(), groupId: pr.gid, groupTrade: true, text: `Executed the club's decision: ${pr.title}`, trade: { sym: t.sym, side: t.side, shares: t.shares, price: t.price } });
    await tx.update('proposals', prid, { executed: true, executedTs: Date.now(), executedBy: leaderPid });
    return { trade: t };
  }
  const lpf = await tx.get('portfolios', leaderPid); const val = pv(lpf), px = Market.price(pr.tradeSym);
  let shares;
  if (pr.tradeSide === 'sell'){ const held = (((lpf || {}).positions || {})[pr.tradeSym] || {}).shares || 0; shares = f3(held * Math.min(1, pr.tradePct * val / Math.max(1e-9, held * px))); }
  else shares = f3(val * pr.tradePct / px);
  if (pr.status === 'open') await tx.update('proposals', prid, { status: 'passed', closedTs: Date.now() });
  const res = await groupTrade(tx, pr.gid, leaderPid, pr.tradeSym, pr.tradeSide || 'buy', shares, `Executing the group's decision: ${pr.title}`, { voted: true });
  await tx.update('proposals', prid, { executed: true, executedTs: Date.now(), executedBy: leaderPid });
  return res;
}
async function vote(tx, prid, pid, v){
  if (!['yes','no','abstain'].includes(v)) throw fail('Choose yes, no or abstain.');
  const t = await tally(tx, prid); if (!t) throw fail('Proposal not found.');
  const m = await tx.get('memberships', t.pr.gid + '__' + pid);
  if (!m || !canVote(m.role)) throw fail('Only members can vote.');
  if (!votingAge(m, t.rules)) throw fail(`New members can vote after ${t.rules.voteWaitDays} days in the group.`);
  if (t.pr.status !== 'open' || Date.now() > t.pr.deadlineTs) throw fail('Voting has closed.');
  await tx.set('votes', prid + '__' + pid, { prid, pid, vote: v, ts: Date.now() });
  await settleReviews(tx);
}

/* ---------- action table: name -> (tx, ctx, args) ---------- */
const A = {};
A.setRisk = async (tx, ctx, a) => { await needProfile(tx, ctx); if (!['conservative','balanced','growth','dividends'].includes(a.risk)) throw fail('Pick a style.'); await tx.update('profiles', ctx.pid, { riskProfile: a.risk }); };
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
  const gg = await tx.get('groups', a.gid); if (gg && gg.pooled) throw fail('This is a pooled club, so trades happen by member vote. Create a trade proposal.');
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
const TEMPLATES = {
  club: { joinMode: 'request', proposeRoles: ['owner','admin','lead','analyst','member'], quorum: 0.5, passRule: 'majority', votingDays: 3, maxPositionPct: 0.10, riskReview: true, approvalMinutes: 60, defaultCopyPct: 1 },
  family: { joinMode: 'invite', proposeRoles: ['owner','admin','lead'], quorum: 0.5, passRule: 'majority', votingDays: 3, maxPositionPct: 0.10, riskReview: false, approvalMinutes: 60, defaultCopyPct: 1 },
  friends: { joinMode: 'invite', proposeRoles: ['owner','admin','lead','analyst','member'], quorum: 0, passRule: 'majority', votingDays: 2, maxPositionPct: null, riskReview: false, approvalMinutes: 30, defaultCopyPct: 0.5 },
  pool: { joinMode: 'request', proposeRoles: ['owner','admin','lead','analyst','treasurer','member'], quorum: 0.5, passRule: 'majority', votingDays: 3, maxPositionPct: null, riskReview: false, approvalMinutes: 60, defaultCopyPct: 1 }
};
const clubPid = gid => 'club_' + gid;
const today = () => new Date().toISOString().slice(0, 10);
async function clubEntry(tx, gid, e){ await tx.query('INSERT INTO club_entries (id, gid, data) VALUES ($1, $2, $3)', [tx.newId(), gid, JSON.stringify(Object.assign({ date: today(), ts: Date.now(), order: 5 }, e))]); }
async function clubState(tx, gid){
  const { summary } = require('./club');
  const B = (await tx.query('SELECT data FROM club_books WHERE gid = $1', [gid])).rows[0];
  const E = (await tx.query('SELECT id, data FROM club_entries WHERE gid = $1', [gid])).rows.map(r => Object.assign({ id: r.id }, r.data));
  const pids = (await tx.find('memberships', { gid })).filter(m => m.role !== 'observer').map(m => m.pid);
  return summary(E, B ? B.data.startUnitValue : 10, pids);
}
/* Group tags: up to 3, standard or custom. Cleaned up, matched regardless of capitalization, and never promising returns. */
const STD_TAGS = ['Growth', 'Dividends', 'Value', 'Beginners', 'Index', 'Consumer brands'];
const CAT_KEY = { growth: 'Growth', dividends: 'Dividends', value: 'Value', beginners: 'Beginners', index: 'Index', consumer: 'Consumer brands' };
const TAG_BAN = /guarantee|pump|dump|signal|get ?rich|rich ?quick|free ?money|can'?t ?lose|no ?risk|risk ?free|sure ?thing|insider|\b\d+x\b|moon ?shot|to the moon|double your/i;
const TAG_RUDE = /\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|nazi|porn|sex)/i;
async function cleanTags(tx, list){
  const raw = (Array.isArray(list) ? list : []).map(t => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (raw.length > 3) throw fail('Pick up to 3 tags.');
  const existing = new Map(); for (const g of await tx.find('groups', {})) for (const t of (g.tags || [])) existing.set(t.toLowerCase(), t);
  const out = [];
  for (const t of raw){
    if (t.length > 20) throw fail(`"${t.slice(0, 24)}" is too long. Tags can be up to 20 characters.`);
    if (!/^[A-Za-z0-9 ]+$/.test(t)) throw fail(`"${t}" can only use letters, numbers and spaces.`);
    if (TAG_BAN.test(t)) throw fail(`"${t}" can't be used: tags can't promise returns or suggest coordinated buying.`);
    if (TAG_RUDE.test(t)) throw fail(`"${t}" isn't allowed as a tag.`);
    const k = t.toLowerCase(), std = STD_TAGS.find(s => s.toLowerCase() === k), v = std || existing.get(k) || t;
    if (!out.some(x => x.toLowerCase() === k)) out.push(v);
  }
  return out;
}
const tagsToCategory = tags => { const t = (tags || []).find(x => STD_TAGS.includes(x)); return t ? Object.keys(CAT_KEY).find(k => CAT_KEY[k] === t) : null; };
A.createGroup = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  const name = str(a.name, 60).trim(); if (!name) throw fail('Give the group a name.');
  const id = tx.newId();
  await tx.set('groups', id, { name, description: str(a.description, 300), strategy: str(a.strategy, 120), membership: a.membership === 'invite' ? 'invite' : 'open',
    ownerPid: ctx.pid, leadPid: ctx.pid, groupPro: true, groupProSince: Date.now(), createdTs: Date.now(), riskLevel: ['conservative','balanced','growth','dividends'].includes(a.riskLevel) ? a.riskLevel : null,
    inviteCode: tx.newId().slice(0, 8).toUpperCase(), ...(await (async () => { const tags = Array.isArray(a.tags) ? await cleanTags(tx, a.tags) : (CAT_KEY[a.category] ? [CAT_KEY[a.category]] : []); return { tags, category: tagsToCategory(tags) }; })()), goals: str(a.goals, 300),
    template: TEMPLATES[a.template] ? a.template : 'custom', pooled: a.template === 'pool',
    rules: Object.assign({}, DEFAULT_RULES, TEMPLATES[a.template] || {}, ['open','request','invite'].includes(a.membership) ? { joinMode: a.membership } : {}) });
  await tx.set('memberships', id + '__' + ctx.pid, { gid: id, pid: ctx.pid, role: 'owner', copyPct: 1, joinedTs: Date.now() });
  if (a.template === 'pool'){
    /* The club's own practice pot. Members add practice cash; the club trades it only by member vote. */
    await tx.set('portfolios', clubPid(id), { kind: 'club', gid: id, cash: 0, startValue: 0, positions: {}, updatedTs: Date.now() });
    await tx.query('INSERT INTO club_books (gid, data) VALUES ($1, $2) ON CONFLICT (gid) DO NOTHING', [id, JSON.stringify({ startUnitValue: 10, createdTs: Date.now(), dues: null, pooled: true })]);
    await clubEntry(tx, id, { kind: 'valuation', amount: 0, note: 'Books started', by: ctx.pid, order: 0 });
  }
  return id;
};
/* ---------- meetings ---------- */
const MEET = ['owner','admin','treasurer'];
A.createMeeting = async (tx, ctx, a) => {
  if (!MEET.includes(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only the Owner, Admins or Treasurer can schedule meetings.');
  const when = Number(a.ts); if (!(when > Date.now() - 86400000)) throw fail('Pick a date and time.');
  const id = tx.newId(); await tx.set('meetings', id, { gid: a.gid, title: str(a.title, 80).trim() || 'Monthly meeting', scheduledTs: when, status: 'scheduled', notes: [], attendance: {}, minutes: '', createdBy: ctx.pid, createdTs: Date.now() }); return id;
};
A.meetingStatus = async (tx, ctx, a) => {
  const m = await tx.get('meetings', a.id); if (!m) throw fail('Meeting not found.');
  if (!MEET.includes(await roleIn(tx, m.gid, ctx.pid))) throw fail('Only the Owner, Admins or Treasurer can run meetings.');
  const patch = {};
  if (a.status === 'live' && m.status === 'scheduled'){ patch.status = 'live'; patch.startedTs = Date.now(); }
  if (a.status === 'ended' && m.status !== 'ended'){ patch.status = 'ended'; patch.endedTs = Date.now(); }
  if (a.minutes != null) patch.minutes = str(a.minutes, 5000);
  await tx.update('meetings', a.id, patch);
};
A.meetingCheckIn = async (tx, ctx, a) => {
  const m = await tx.get('meetings', a.id); if (!m) throw fail('Meeting not found.');
  const r = await roleIn(tx, m.gid, ctx.pid); if (!r || r === 'observer') throw fail('Only full members check in.');
  if (m.status === 'ended') throw fail('This meeting has ended.');
  await tx.update('meetings', a.id, { attendance: Object.assign({}, m.attendance, { [ctx.pid]: Date.now() }) });
};
A.meetingNote = async (tx, ctx, a) => {
  const m = await tx.get('meetings', a.id); if (!m) throw fail('Meeting not found.');
  if (!MEET.includes(await roleIn(tx, m.gid, ctx.pid))) throw fail('Only the Owner, Admins or Treasurer can edit the agenda.');
  const text = str(a.text, 200).trim(); if (!text) throw fail('Write the agenda item.');
  await tx.update('meetings', a.id, { notes: (m.notes || []).concat([{ text, by: ctx.pid, ts: Date.now() }]).slice(-30) });
};
/* ---------- shared group watchlist and stock studies ---------- */
A.addGroupWatch = async (tx, ctx, a) => {
  const r = await roleIn(tx, a.gid, ctx.pid); if (!r || r === 'observer') throw fail('Only full members can add to the group watchlist.');
  const s = sym(a.sym), id = a.gid + '__' + s; if (await tx.get('groupWatch', id)) throw fail(s + ' is already on the watchlist.');
  await tx.set('groupWatch', id, { gid: a.gid, sym: s, pid: ctx.pid, reason: str(a.reason, 200), price: Market.price(s), ts: Date.now() });
};
A.removeGroupWatch = async (tx, ctx, a) => {
  const w = await tx.get('groupWatch', a.id); if (!w) return;
  if (w.pid !== ctx.pid && !canManage(await roleIn(tx, w.gid, ctx.pid))) throw fail('Only the person who added it, an Owner or an Admin can remove it.');
  await tx.del('groupWatch', a.id);
};
A.saveStudy = async (tx, ctx, a) => {
  const r = await roleIn(tx, a.gid, ctx.pid); if (!r || r === 'observer') throw fail('Only full members can write studies.');
  const s = sym(a.sym), f = k => str(a[k], 1200).trim();
  if (!f('business') || !f('risks')) throw fail('Fill in at least the business and the risks.');
  const id = a.id && (await tx.get('studies', a.id)) ? a.id : tx.newId(), cur = await tx.get('studies', id);
  if (cur && cur.pid !== ctx.pid) throw fail('Only the author can edit this study.');
  await tx.set('studies', id, { gid: a.gid, sym: s, pid: ctx.pid, business: f('business'), growth: f('growth'), valuation: f('valuation'), risks: f('risks'),
    verdict: ['buy','watch','pass'].includes(a.verdict) ? a.verdict : 'watch', price: Market.price(s), ts: cur ? cur.ts : Date.now(), updatedTs: Date.now() });
  return id;
};
/* ---------- recurring investments (practice portfolios) ---------- */
const FREQ = { weekly: 7, biweekly: 14, monthly: 30 };
A.setRecurring = async (tx, ctx, a) => {
  await needProfile(tx, ctx); const s = sym(a.sym), amount = Math.round(Number(a.amount) * 100) / 100;
  if (!(amount >= 5) || amount > 100000) throw fail('Enter an amount from $5 to $100,000.');
  if (!FREQ[a.freq]) throw fail('Pick how often.');
  const first = Number(a.startTs) > Date.now() - 3600000 ? Number(a.startTs) : Date.now();
  await tx.set('recurring', ctx.pid + '__' + s, { pid: ctx.pid, sym: s, amount, freq: a.freq, nextTs: first, paused: false, createdTs: Date.now(), runs: 0 });
};
A.pauseRecurring = async (tx, ctx, a) => { const r = await tx.get('recurring', ctx.pid + '__' + sym(a.sym)); if (!r) throw fail('Not found.'); await tx.update('recurring', r.id, { paused: !!a.paused, nextTs: a.paused ? r.nextTs : Math.max(r.nextTs, Date.now()) }); };
A.deleteRecurring = async (tx, ctx, a) => tx.del('recurring', ctx.pid + '__' + sym(a.sym));
async function runRecurring(tx){
  if (!Market.canFillNow(await clockMode(tx))) return 0;
  let n = 0;
  for (const r of await tx.find('recurring')){
    if (r.paused || r.nextTs > Date.now()) continue;
    const next = r.nextTs + FREQ[r.freq] * 86400000 * Math.max(1, Math.ceil((Date.now() - r.nextTs + 1) / (FREQ[r.freq] * 86400000)));
    try { const pf = await tx.get('portfolios', r.pid); if (!pf || pf.cash < r.amount) throw fail('Not enough cash');
      await executeTrade(tx, r.pid, r.sym, 'buy', f3(r.amount / Market.price(r.sym)), {}); await tx.update('recurring', r.id, { nextTs: next, lastRunTs: Date.now(), lastError: null, runs: (r.runs || 0) + 1 }); n++; }
    catch (e){ await tx.update('recurring', r.id, { nextTs: next, lastRunTs: Date.now(), lastError: e.userFacing ? e.message : 'Could not buy' }); }
  }
  return n;
}
A.clubLiquidate = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g || !g.windDown) throw fail('Members have to vote to wind down the club first.');
  if (!MONEY_OFFICERS.concat(['lead']).includes(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only officers can sell the holdings.');
  needTwoStep(ctx); if (!Market.canFillNow(await clockMode(tx))) throw fail('Markets are closed. Try again during market hours.');
  const pot = await tx.get('portfolios', clubPid(a.gid)); let n = 0;
  for (const [s, p] of Object.entries(pot.positions || {})){ await executeTrade(tx, clubPid(a.gid), s, 'sell', p.shares, { groupId: a.gid }); n++; }
  await clubLog(tx, a.gid, ctx.pid, `Sold all ${n} holding${n === 1 ? '' : 's'} to close the club`); return { sold: n };
};
A.clubDistribute = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g || !g.windDown) throw fail('Members have to vote to wind down the club first.'); if (g.closed) throw fail('The club is already closed.');
  if (!MONEY_OFFICERS.includes(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only officers with a money role can start the final payout.');
  needTwoStep(ctx);
  const pot = await tx.get('portfolios', clubPid(a.gid)); if (Object.keys(pot.positions || {}).length) throw fail('Sell all the holdings first.');
  if ((await tx.query(`SELECT 1 FROM club_submissions WHERE gid = $1 AND data->>'kind' = 'distribution' AND data->>'status' = 'pending'`, [a.gid])).rows.length) throw fail('The final payout is already waiting for approval.');
  const others = (await tx.find('memberships', { gid: a.gid })).filter(m => m.role !== 'observer' && m.pid !== ctx.pid).length;
  await tx.query('INSERT INTO club_submissions (id, gid, pid, data) VALUES ($1, $2, $3, $4)', [tx.newId(), a.gid, ctx.pid, JSON.stringify({ kind: 'distribution', initiatedBy: ctx.pid, amount: pot.cash, note: 'Final payout to all members by units', status: 'pending', ts: Date.now(), approvals: [], needed: Math.max(1, Math.min(2, others)) })]);
  await clubLog(tx, a.gid, ctx.pid, `Final payout of $${pot.cash.toFixed(2)} to all members started; needs approval`);
  notify(tx, await eligibleApprovers(tx, a.gid, [ctx.pid]), { title: g.name + ': final payout to approve', body: 'The club is closing. Approve paying every member their share.', url: '/#/group/' + a.gid + '/club', tag: 'club-' + a.gid });
};
A.clubContribute = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g || !g.pooled) throw fail('This group is not a pooled club.');
  if (g.windDown) throw fail('The club is winding down, so it no longer takes new money.');
  const r = await roleIn(tx, a.gid, ctx.pid); if (!r || r === 'observer') throw fail('Only full members can add money to the club.');
  const amount = Math.round(Number(a.amount) * 100) / 100; if (!(amount >= 1)) throw fail('Enter at least $1.');
  const mine = await tx.get('portfolios', ctx.pid, { lock: true }); if (!mine || amount > mine.cash + 0.005) throw fail('Not enough cash in your practice portfolio.');
  const pot = await tx.get('portfolios', clubPid(a.gid), { lock: true }); if (!pot) throw fail('Club account not found.');
  await clubEntry(tx, a.gid, { kind: 'valuation', amount: Math.round(pv(pot) * 100) / 100, note: 'Automatic valuation', by: ctx.pid });
  await clubEntry(tx, a.gid, { kind: 'payment', pid: ctx.pid, amount, note: str(a.note, 120) || 'Added to the club', by: ctx.pid });
  await tx.update('portfolios', ctx.pid, { cash: Math.round((mine.cash - amount) * 100) / 100 });
  await tx.update('portfolios', clubPid(a.gid), { cash: Math.round((pot.cash + amount) * 100) / 100, updatedTs: Date.now() });
  await clubLog(tx, a.gid, ctx.pid, `Added $${amount.toFixed(2)} to the club`);
  return { amount };
};
A.clubRequestExit = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g || !g.pooled) throw fail('This group is not a pooled club.');
  if (g.windDown) throw fail('The club is winding down; everyone is paid out together.');
  const target = a.pid || ctx.pid, myRole = await roleIn(tx, a.gid, ctx.pid), tr = await roleIn(tx, a.gid, target);
  if (!tr) throw fail('Member not found.'); if (tr === 'owner') throw fail('The Owner hands over ownership by member vote before leaving.');
  if (target !== ctx.pid){ if (!['owner','admin','treasurer'].includes(myRole)) throw fail('Only the Owner, an Admin or the Treasurer can start an exit payout for someone else.'); needTwoStep(ctx); }
  const units = await unitsOf(tx, a.gid, target);
  if (units <= 1e-6){ await tx.del('memberships', a.gid + '__' + target); if (g.leadPid === target) await tx.update('groups', a.gid, { leadPid: g.ownerPid }); return { left: true }; }
  const open = (await tx.query(`SELECT 1 FROM club_submissions WHERE gid = $1 AND pid = $2 AND data->>'status' = 'pending' AND (data->>'exit')::boolean`, [a.gid, target])).rows.length; if (open) throw fail('An exit payout is already waiting for approval.');
  const pot = await tx.get('portfolios', clubPid(a.gid)), S = await clubState(tx, a.gid), share = units / S.units * pv(pot);
  const exclude = [target].concat(target === ctx.pid ? [] : [ctx.pid]);
  const others = (await tx.find('memberships', { gid: a.gid })).filter(m => m.role !== 'observer' && !exclude.includes(m.pid)).length; if (!others) throw fail('Another member has to approve the payout.');
  await tx.query('INSERT INTO club_submissions (id, gid, pid, data) VALUES ($1, $2, $3, $4)', [tx.newId(), a.gid, target, JSON.stringify({ kind: 'withdrawal', exit: true, initiatedBy: ctx.pid, amount: Math.round(share * 100) / 100, note: str(a.note, 300) || 'Leaving the club: full payout', status: 'pending', ts: Date.now(), approvals: [], needed: Math.min(2, others) })]);
  const name = ((await tx.get('profiles', target)) || {}).name || 'A member';
  await clubLog(tx, a.gid, ctx.pid, `Exit payout requested for ${name} (about $${share.toFixed(2)})`);
  notify(tx, await eligibleApprovers(tx, a.gid, exclude), { title: g.name + ': exit payout to approve', body: `${name} is leaving the club. Two approvals are needed to pay out their share.`, url: '/#/group/' + a.gid + '/club', tag: 'club-' + a.gid });
};
A.clubRequestWithdrawal = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g || !g.pooled) throw fail('This group is not a pooled club.');
  if (g.windDown) throw fail('The club is winding down; everyone is paid out together.');
  const r = await roleIn(tx, a.gid, ctx.pid); if (!r || r === 'observer') throw fail('Only full members can withdraw.');
  const amount = Math.round(Number(a.amount) * 100) / 100; if (!(amount >= 1)) throw fail('Enter at least $1.');
  const pot = await tx.get('portfolios', clubPid(a.gid)), S = await clubState(tx, a.gid), me = S.members.find(m => m.pid === ctx.pid);
  const share = me && S.units > 1e-9 ? me.units / S.units * pv(pot) : 0;
  if (amount > share + 0.005) throw fail(`Your share of the club is worth about $${share.toFixed(2)}.`);
  const others = (await tx.find('memberships', { gid: a.gid })).filter(m => m.role !== 'observer' && m.pid !== ctx.pid).length;
  if (!others) throw fail('Another member has to approve withdrawals, and you are the only member.');
  await tx.query('INSERT INTO club_submissions (id, gid, pid, data) VALUES ($1, $2, $3, $4)', [tx.newId(), a.gid, ctx.pid, JSON.stringify({ kind: 'withdrawal', amount, note: str(a.note, 300), status: 'pending', ts: Date.now(), approvals: [], needed: Math.min(2, others) })]);
  await clubLog(tx, a.gid, ctx.pid, `Withdrawal of $${amount.toFixed(2)} requested`);
  notify(tx, await eligibleApprovers(tx, a.gid, [ctx.pid]), { title: g.name + ': withdrawal to approve', body: `A $${amount.toFixed(2)} withdrawal needs two approvals.`, url: '/#/group/' + a.gid + '/club', tag: 'club-' + a.gid });
};
A.clubDecideWithdrawal = async (tx, ctx, a) => {
  const row = (await tx.query('SELECT id, gid, pid, data FROM club_submissions WHERE id = $1 FOR UPDATE', [a.id])).rows[0];
  if (!row || !['withdrawal', 'distribution'].includes(row.data.kind)) throw fail('Request not found.');
  if (row.data.status !== 'pending') throw fail('This request was already decided.');
  needTwoStep(ctx);
  if (row.data.kind === 'withdrawal' && row.pid === ctx.pid) throw fail("You can't approve your own withdrawal.");
  if (row.data.initiatedBy === ctx.pid) throw fail('You started this request, so someone else approves it.');
  const prior = (row.data.approvals || []).map(x => x.pid), base = (row.data.kind === 'withdrawal' ? [row.pid] : []).concat(row.data.initiatedBy ? [row.data.initiatedBy] : []);
  if (prior.includes(ctx.pid)) throw fail('You already approved this. It needs a different second approver.');
  if (!(await canApprove(tx, row.gid, ctx.pid, base.concat(prior)))) throw fail("You can't approve this one. Approvers are officers with a money role (after a 3-day wait if it's new), or any other member when no officer is available.");
  const note = str(a.note, 300), approvals = (row.data.approvals || []).concat(a.decision === 'confirmed' ? [{ pid: ctx.pid, ts: Date.now(), note }] : []);
  const needed = row.data.needed || 2;
  if (a.decision === 'confirmed' && approvals.length < needed){
    await tx.query('UPDATE club_submissions SET data = data || $2::jsonb WHERE id = $1', [a.id, JSON.stringify({ approvals })]);
    await clubLog(tx, row.gid, ctx.pid, `${row.data.kind === 'distribution' ? 'Final payout' : 'Withdrawal of $' + row.data.amount.toFixed(2)}: first approval`);
    const gg = await tx.get('groups', row.gid);
    notify(tx, await eligibleApprovers(tx, row.gid, base.concat(approvals.map(x => x.pid))), { title: gg.name + ': second approval needed', body: (row.data.kind === 'distribution' ? 'The final payout to all members' : `A $${row.data.amount.toFixed(2)} withdrawal`) + ' has one approval and needs a second.', url: '/#/group/' + row.gid + '/club', tag: 'club-' + row.gid });
    return { waiting: true };
  }
  const patch = { status: a.decision === 'confirmed' ? 'confirmed' : 'declined', reviewNote: note, reviewerPid: ctx.pid, reviewedTs: Date.now(), approvals };
  if (patch.status === 'declined' && !note) throw fail('Add a short note so the member knows why.');
  if (patch.status === 'confirmed' && row.data.kind === 'distribution'){
    const pot = await tx.get('portfolios', clubPid(row.gid), { lock: true });
    if (Object.keys(pot.positions || {}).length) throw fail('Sell all the holdings first.');
    const S = await clubState(tx, row.gid), uv = S.units > 1e-9 ? pv(pot) / S.units : 0; let left = pot.cash;
    await clubEntry(tx, row.gid, { kind: 'valuation', amount: Math.round(pv(pot) * 100) / 100, note: 'Final valuation', by: ctx.pid });
    const payees = S.members.filter(m => m.units > 1e-9);
    for (let i = 0; i < payees.length; i++){
      const m = payees[i], amt = i === payees.length - 1 ? Math.floor(left * 100) / 100 : Math.floor(m.units * uv * 100) / 100; if (amt <= 0) continue; left -= amt;
      await clubEntry(tx, row.gid, { kind: 'withdrawal', pid: m.pid, amount: amt, note: 'Final payout', by: ctx.pid });
      const mp = await tx.get('portfolios', m.pid, { lock: true }); if (mp) await tx.update('portfolios', m.pid, { cash: Math.round((mp.cash + amt) * 100) / 100 });
    }
    await tx.update('portfolios', clubPid(row.gid), { cash: Math.round(left * 100) / 100, updatedTs: Date.now() });
    await tx.update('groups', row.gid, { closed: { ts: Date.now(), by: ctx.pid } });
    await tx.set('posts', tx.newId(), { pid: ctx.pid, ts: Date.now(), groupId: row.gid, text: 'The club is closed. Every member was paid out their share.' });
  } else if (patch.status === 'confirmed' && row.data.exit){
    const pot = await tx.get('portfolios', clubPid(row.gid), { lock: true }), S = await clubState(tx, row.gid), mm = S.members.find(x => x.pid === row.pid);
    const amount = mm && S.units > 1e-9 ? Math.floor(mm.units / S.units * pv(pot) * 100) / 100 : 0;
    if (amount > pot.cash + 0.005) throw fail(`The club has $${pot.cash.toFixed(2)} in cash and the payout is $${amount.toFixed(2)}. Members can vote to sell holdings first.`);
    await clubEntry(tx, row.gid, { kind: 'valuation', amount: Math.round(pv(pot) * 100) / 100, note: 'Automatic valuation', by: ctx.pid });
    if (amount > 0) await clubEntry(tx, row.gid, { kind: 'withdrawal', pid: row.pid, amount, note: 'Exit payout', by: ctx.pid });
    const mem = await tx.get('portfolios', row.pid, { lock: true });
    await tx.update('portfolios', clubPid(row.gid), { cash: Math.round((pot.cash - amount) * 100) / 100, updatedTs: Date.now() });
    if (mem) await tx.update('portfolios', row.pid, { cash: Math.round((mem.cash + amount) * 100) / 100 });
    const gx = await tx.get('groups', row.gid); await tx.del('memberships', row.gid + '__' + row.pid); if (gx.leadPid === row.pid) await tx.update('groups', row.gid, { leadPid: gx.ownerPid });
    patch.amount = amount;
  } else if (patch.status === 'confirmed'){
    const pot = await tx.get('portfolios', clubPid(row.gid), { lock: true }), amount = row.data.amount;
    if (amount > pot.cash + 0.005) throw fail(`The club has $${pot.cash.toFixed(2)} in cash. Members can vote to sell holdings first.`);
    const S = await clubState(tx, row.gid), m = S.members.find(x => x.pid === row.pid), share = m && S.units > 1e-9 ? m.units / S.units * pv(pot) : 0;
    if (amount > share + 0.005) throw fail(`That member's share is now worth about $${share.toFixed(2)}.`);
    await clubEntry(tx, row.gid, { kind: 'valuation', amount: Math.round(pv(pot) * 100) / 100, note: 'Automatic valuation', by: ctx.pid });
    await clubEntry(tx, row.gid, { kind: 'withdrawal', pid: row.pid, amount, note: 'Withdrawal approved', by: ctx.pid });
    const mem = await tx.get('portfolios', row.pid, { lock: true });
    await tx.update('portfolios', clubPid(row.gid), { cash: Math.round((pot.cash - amount) * 100) / 100, updatedTs: Date.now() });
    await tx.update('portfolios', row.pid, { cash: Math.round((mem.cash + amount) * 100) / 100 });
  }
  await tx.query('UPDATE club_submissions SET data = data || $2::jsonb WHERE id = $1', [a.id, JSON.stringify(patch)]);
  const what = row.data.kind === 'distribution' ? 'Final payout to all members' : row.data.exit ? 'Exit payout' : `Withdrawal of $${row.data.amount.toFixed(2)}`;
  await clubLog(tx, row.gid, ctx.pid, `${what} ${patch.status === 'confirmed' ? 'approved and paid' : 'declined'}`);
  const gz = await tx.get('groups', row.gid), all = (await tx.find('memberships', { gid: row.gid })).map(m => m.pid).concat([row.pid]);
  notify(tx, row.data.kind === 'distribution' ? all : [row.pid], { title: gz.name + ': ' + (patch.status === 'confirmed' ? 'paid out' : 'request declined'), body: patch.status === 'confirmed' ? `${what} was approved and paid.` : `${what} was declined${note ? ': ' + note : '.'}`, url: '/#/group/' + row.gid + '/club', tag: 'club-' + row.gid });
};
async function checkJoin(tx, g, pid, rules){
  const ms = await tx.find('memberships', { gid: g.id });
  if (rules.maxMembers && ms.length >= rules.maxMembers) throw fail(`${g.name} is full (${rules.maxMembers} members).`);
  if (rules.minAccount && pv(await tx.get('portfolios', pid)) < rules.minAccount) throw fail(`${g.name} requires an account value of at least $${rules.minAccount.toLocaleString('en-US')} to join.`);
}
A.join = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.');
  const rules = rulesOf(g), cur = await tx.get('memberships', a.gid + '__' + ctx.pid);
  let invitedBy = null;
  if (!cur){
    if (rules.joinMode === 'request') throw fail('This group reviews new members. Request to join instead.');
    if (rules.joinMode === 'invite'){ if (!a.code || String(a.code).toUpperCase() !== g.inviteCode || g.inviteOff) throw fail(g.inviteOff ? "This group's invite link is turned off. Ask a member for a new one." : 'This group is invite only. Ask a member for an invite link.'); }
    if (a.by && a.by !== ctx.pid && (await tx.get('memberships', a.gid + '__' + a.by))) invitedBy = a.by;
    await checkJoin(tx, g, ctx.pid, rules);
    if (rules.rulesText && !a.acceptRules) throw fail("Please accept the group's rules to join.");
  }
  const role = a.role === 'observer' ? 'observer' : 'member';
  if (role === 'member' && !(await isPro(tx, ctx.pid))) throw fail('Full membership is part of Pro.');
  if (cur && cur.role !== 'observer') return;
  await tx.set('memberships', a.gid + '__' + ctx.pid, Object.assign({ gid: a.gid, pid: ctx.pid, role, copyPct: cur ? cur.copyPct : rules.defaultCopyPct, joinedTs: cur ? cur.joinedTs : Date.now(), rulesAcceptedTs: cur ? cur.rulesAcceptedTs || null : (rules.rulesText ? Date.now() : null) }, invitedBy ? { invitedBy } : cur && cur.invitedBy ? { invitedBy: cur.invitedBy } : {}));
};
A.groupByCode = async (tx, ctx, a) => { const g = (await tx.find('groups', { inviteCode: String(a.code || '').toUpperCase() }))[0]; if (!g || g.inviteOff) throw fail("That invite link isn't valid anymore."); return g.id; };
A.setInviteLink = async (tx, ctx, a) => { if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can change the invite link.'); await tx.update('groups', a.gid, { inviteOff: !a.on }); };
async function unitsOf(tx, gid, pid){ const S = await clubState(tx, gid), m = S.members.find(x => x.pid === pid); return m ? m.units : 0; }
A.leave = async (tx, ctx, a) => { const r = await roleIn(tx, a.gid, ctx.pid); if (!r) return; if (r === 'owner') throw fail("Owners can't leave their own group.");
  const lg = await tx.get('groups', a.gid); if (lg && lg.pooled && (await unitsOf(tx, a.gid, ctx.pid)) > 1e-6) throw fail('You still own part of the club. Use "Leave and get paid out" on the Club books tab.'); await tx.del('memberships', a.gid + '__' + ctx.pid); };
A.setRole = async (tx, ctx, a) => {
  if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can change roles.');
  if (!ROLES.includes(a.role) || a.role === 'owner') throw fail('Unknown role.');
  const m = await tx.get('memberships', a.gid + '__' + a.pid); if (!m) throw fail('Member not found.'); if (m.role === 'owner') throw fail("The Owner's role can't be changed. Transfer ownership instead.");
  if (a.role !== 'observer' && !(await isPro(tx, a.pid))) throw fail('That person needs Pro for this role.');
  const g0 = await tx.get('groups', a.gid);
  if (g0 && g0.pooled && (VOTED_ROLES.includes(a.role) || VOTED_ROLES.includes(m.role))) throw fail('In a pooled club, money roles change by member vote. Create a role proposal.');
  await applyRole(tx, a.gid, a.pid, m.role, a.role, ctx.pid, null);
  const g = await tx.get('groups', a.gid);
  if (a.role === 'lead') await tx.update('groups', a.gid, { leadPid: a.pid });
  else if (g.leadPid === a.pid) await tx.update('groups', a.gid, { leadPid: g.ownerPid });
};
async function applyRole(tx, gid, pid, from, to, by, prid){
  const money = VOTED_ROLES.includes(to) || VOTED_ROLES.includes(from);
  await tx.update('memberships', gid + '__' + pid, Object.assign({ role: to }, money ? { roleChangedTs: Date.now() } : {}));
  if (money){
    const name = ((await tx.get('profiles', pid)) || {}).name || 'A member';
    await tx.set('posts', tx.newId(), { pid: by, ts: Date.now(), groupId: gid, text: `${name} is now ${ROLE_NAME[to]}${prid ? ' by member vote' : ''}. New money roles wait 3 days before approving anything.` });
    await clubLog(tx, gid, by, `${name}: ${ROLE_NAME[from] || 'Member'} → ${ROLE_NAME[to]}${prid ? ' (member vote)' : ''}`);
    const gn = await tx.get('groups', gid); notify(tx, (await tx.find('memberships', { gid })).map(m => m.pid), { title: (gn ? gn.name : 'Your group') + ': role change', body: `${name} is now ${ROLE_NAME[to]}. New money roles wait 3 days before approving anything.`, url: '/#/group/' + gid + '/members', tag: 'roles-' + gid });
  }
}
async function clubLog(tx, gid, pid, text){ await tx.query('INSERT INTO club_log (gid, pid, text) VALUES ($1, $2, $3)', [gid, pid, String(text).slice(0, 300)]).catch(() => {}); }
/* Who may approve a money action: never the person it benefits or anyone who already approved it.
   Officers with a money role qualify (after the 7-day wait if their role changed); if no such officer
   is available, any other full member can approve, so small clubs are never blocked. */
async function approvers(tx, gid, exclude){
  const ms = (await tx.find('memberships', { gid })).filter(m => m.role !== 'observer' && !exclude.includes(m.pid));
  const officers = ms.filter(m => MONEY_OFFICERS.includes(m.role) && !(m.roleChangedTs && Date.now() - m.roleChangedTs < ROLE_WAIT));
  return { officers: officers.map(m => m.pid), others: ms.map(m => m.pid), fallback: !officers.length };
}
async function canApprove(tx, gid, pid, exclude){ if (exclude.includes(pid)) return false; const A = await approvers(tx, gid, exclude); return A.fallback ? A.others.includes(pid) : A.officers.includes(pid); }
A.removeMember = async (tx, ctx, a) => {
  if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can remove members.');
  const m = await tx.get('memberships', a.gid + '__' + a.pid); if (!m) return; if (m.role === 'owner') throw fail("The Owner can't be removed.");
  if (a.pid === ctx.pid) throw fail('Use Leave group instead.');
  const rg = await tx.get('groups', a.gid); if (rg && rg.pooled && (await unitsOf(tx, a.gid, a.pid)) > 1e-6) throw fail('They still own part of the club. Start an exit payout for them on the Club books tab first.');
  await tx.del('memberships', m.id);
  const g = await tx.get('groups', a.gid); if (g.leadPid === a.pid) await tx.update('groups', a.gid, { leadPid: g.ownerPid });
};
A.transferOwnership = async (tx, ctx, a) => {
  if ((await roleIn(tx, a.gid, ctx.pid)) !== 'owner') throw fail('Only the Owner can transfer ownership.');
  const gx = await tx.get('groups', a.gid); if (gx && gx.pooled) throw fail('In a pooled club, ownership changes by member vote. Create a role proposal.');
  const m = await tx.get('memberships', a.gid + '__' + a.pid); if (!m || a.pid === ctx.pid) throw fail('Pick another member.');
  if (!(await isPro(tx, a.pid))) throw fail('The new Owner needs Pro.');
  await tx.update('memberships', m.id, { role: 'owner' });
  await tx.update('memberships', a.gid + '__' + ctx.pid, { role: 'admin' });
  await tx.update('groups', a.gid, { ownerPid: a.pid });
};
A.updateGroup = async (tx, ctx, a) => {
  if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can change group settings.');
  const g = await tx.get('groups', a.gid); const r = Object.assign({}, rulesOf(g)); const n = a.rules || {};
  if (Array.isArray(a.tags)){ const tags = await cleanTags(tx, a.tags); await tx.update('groups', a.gid, { tags, category: tagsToCategory(tags) }); }
  const pick = (k, ok) => { if (k in n){ if (!ok(n[k])) throw fail('Check the value for ' + k + '.'); r[k] = n[k]; } };
  const numOrNull = v => v === null || (Number.isFinite(v) && v >= 0);
  pick('joinMode', v => ['open','request','invite'].includes(v));
  pick('maxMembers', v => v === null || (Number.isInteger(v) && v >= 2 && v <= 10000));
  pick('minAccount', v => Number.isFinite(v) && v >= 0 && v <= 10000000);
  pick('rulesText', v => typeof v === 'string' && v.length <= 2000);
  pick('proposeRoles', v => Array.isArray(v) && v.every(x => ROLES.includes(x)) && v.includes('owner'));
  pick('quorum', v => Number.isFinite(v) && v >= 0 && v <= 1);
  pick('passRule', v => ['majority','two-thirds'].includes(v));
  pick('votingDays', v => Number.isInteger(v) && v >= 1 && v <= 14);
  pick('voteWaitDays', v => Number.isInteger(v) && v >= 0 && v <= 60);
  pick('maxPositionPct', v => v === null || (Number.isFinite(v) && v > 0 && v <= 1));
  pick('allowed', v => ['any','etf','list'].includes(v));
  pick('allowedList', v => Array.isArray(v) && v.every(x => Market.MAP[x]));
  pick('approvalMinutes', v => [15, 30, 60].includes(v));
  pick('riskReview', v => typeof v === 'boolean');
  pick('defaultCopyPct', v => [0.5, 1].includes(v));
  pick('hidden', v => typeof v === 'boolean');
  pick('feeMonthly', numOrNull);
  const patch = { rules: r };
  if (a.name != null){ const nm = str(a.name, 60).trim(); if (!nm) throw fail('Give the group a name.'); patch.name = nm; }
  if (a.description != null) patch.description = str(a.description, 300);
  if (a.strategy != null) patch.strategy = str(a.strategy, 120);
  if (a.goals != null) patch.goals = str(a.goals, 300);
  if (a.category != null) patch.category = ['growth','dividends','value','beginners','index','consumer'].includes(a.category) ? a.category : null;
  await tx.update('groups', a.gid, patch);
};
A.newInviteCode = async (tx, ctx, a) => { if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can reset the invite link.'); await tx.update('groups', a.gid, { inviteCode: tx.newId().slice(0, 8).toUpperCase(), inviteOff: false }); };
A.setCopyPct = async (tx, ctx, a) => { if (!(await roleIn(tx, a.gid, ctx.pid))) throw fail('Join the group first.'); await tx.update('memberships', a.gid + '__' + ctx.pid, { copyPct: Math.max(0.1, Math.min(1, num(a.pct))) }); };
A.propose = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.'); const rules = rulesOf(g);
  if (!canPropose(await roleIn(tx, a.gid, ctx.pid), rules)) throw fail("Your role can't create proposals in this group.");
  if (a.type === 'trade' && a.sym) checkAllowed(rules, a.sym);
  const title = str(a.title, 120).trim(); if (!title) throw fail('Give the proposal a title.');
  const now = Date.now(), type = ['trade','strategy','policy','role','windDown'].includes(a.type) ? a.type : 'trade';
  if (type === 'windDown' && !g.pooled) throw fail('Only a pooled club can be wound down.');
  if (g.windDown && type === 'trade' && a.side !== 'sell') throw fail('The club is winding down, so it only sells.');
  let extra = type === 'trade' && a.sym ? { tradeSym: sym(a.sym), tradeSide: a.side === 'sell' ? 'sell' : 'buy', tradePct: Math.max(0.005, Math.min(0.5, Number(a.pct) || 0.05)) } : {};
  if (type === 'role' && a.rolePid){
    const tm = await tx.get('memberships', a.gid + '__' + a.rolePid); if (!tm) throw fail('Pick a member of the group.');
    if (!ROLES.includes(a.roleName) || a.roleName === tm.role) throw fail('Pick a new role for them.');
    if (a.roleName !== 'observer' && !(await isPro(tx, a.rolePid))) throw fail('That person needs Pro for this role.');
    extra = { rolePid: a.rolePid, roleName: a.roleName, roleFrom: tm.role };
  }
  const id = tx.newId();
  await tx.set('proposals', id, Object.assign({ gid: a.gid, authorPid: ctx.pid, type, title, details: str(a.details, 800), createdTs: now, deadlineTs: now + Math.max(1, Math.min(14, Number(a.days) || rules.votingDays)) * 86400000, status: 'open' }, extra));
  return id;
};
A.vote = async (tx, ctx, a) => vote(tx, a.prid, ctx.pid, a.vote);
A.closeProposal = async (tx, ctx, a) => {
  const t = await tally(tx, a.prid); if (!t) throw fail('Proposal not found.');
  if (!canManage(await roleIn(tx, t.pr.gid, ctx.pid)) && !ctx.isAdmin) throw fail('Only Owners and Admins can close a vote.');
  if (t.pr.status !== 'open') return;
  await tx.update('proposals', a.prid, { status: t.result, closedTs: Date.now() });
  await settleReviews(tx);
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
A.deletePost = async (tx, ctx, a) => { const p = await tx.get('posts', a.id); if (!p) return; if (p.pid !== ctx.pid && !ctx.isAdmin && !(p.groupId && canModerate(await roleIn(tx, p.groupId, ctx.pid)))) throw fail('You can only delete your own posts.'); await tx.del('posts', a.id); for (const c of await tx.find('comments', { postId: a.id })) await tx.del('comments', c.id); };
A.deleteComment = async (tx, ctx, a) => { const c = await tx.get('comments', a.id); if (!c) return; const p = await tx.get('posts', c.postId); if (c.pid !== ctx.pid && !ctx.isAdmin && !(p && p.groupId && canModerate(await roleIn(tx, p.groupId, ctx.pid)))) throw fail('You can only delete your own comments.'); await tx.del('comments', a.id); };
A.follow = async (tx, ctx, a) => { await needProfile(tx, ctx); if (a.pid === ctx.pid) return; await tx.set('follows', ctx.pid + '__' + a.pid, { from: ctx.pid, to: a.pid, ts: Date.now() }); };
A.unfollow = async (tx, ctx, a) => tx.del('follows', ctx.pid + '__' + a.pid);
A.upgradePro = async (tx, ctx, a) => { await needProfile(tx, ctx); const patch = { plan: 'pro', proSince: Date.now() }; if (a && ['yes','maybe','no'].includes(a.wouldPay)){ patch.wouldPay = a.wouldPay; patch.wouldPayTs = Date.now(); } await tx.update('profiles', ctx.pid, patch); };
A.cancelPro = async (tx, ctx) => {
  await needProfile(tx, ctx); await tx.update('profiles', ctx.pid, { plan: 'free' });
  for (const m of (await tx.find('memberships', { pid: ctx.pid })).filter(m => m.role === 'member')) await tx.update('memberships', m.id, { role: 'observer' });
  for (const c of await tx.find('copies', { from: ctx.pid })) await tx.del('copies', c.id);
};
/* Copy once: buy an investor's (or a group's) current mix of stocks in one approved step, scaled to the amount chosen. */
A.copyPortfolio = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  if (!(await isPro(tx, ctx.pid))) throw fail('Copying a portfolio is part of Pro.');
  let src, gid = null;
  if (a.gid){ const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.'); const r = await roleIn(tx, a.gid, ctx.pid);
    if (!r || r === 'observer') throw fail("Only full members can copy the group's holdings."); src = g.leadPid; gid = a.gid;
    if (src === ctx.pid) throw fail("You're the Lead Trader, so these are already your holdings."); }
  else { src = a.pid; if (!src || src === ctx.pid) throw fail('Pick another investor.'); }
  if (!Market.canFillNow(await clockMode(tx))) throw fail('Markets are closed. Try again during market hours.');
  const spf = await tx.get('portfolios', src); const held = Object.entries((spf && spf.positions) || {});
  if (!held.length) throw fail("They don't hold any stocks right now.");
  const amount = Number(a.amount); if (!(amount >= 10)) throw fail('Enter at least $10.');
  const mine = await tx.get('portfolios', ctx.pid); if (!mine || amount > mine.cash + 0.01) throw fail('Not enough cash for this amount.');
  const vals = held.map(([s, p]) => [s, p.shares * Market.price(s)]), tot = vals.reduce((x, [, v]) => x + v, 0);
  const filled = [], skipped = [];
  for (const [s, v] of vals){ const dollars = amount * v / tot, px = Market.price(s), sh = Math.floor(dollars / px * 1000) / 1000;
    if (dollars < 1 || sh <= 0){ skipped.push(s); continue; }
    const t = await executeTrade(tx, ctx.pid, s, 'buy', sh, { groupId: gid, copyOf: 'portfolio:' + src }); filled.push({ sym: s, shares: t.shares, price: t.price }); }
  if (a.follow && !gid) await tx.set('copies', ctx.pid + '__' + src, { from: ctx.pid, to: src, copyPct: 1, ts: Date.now() });
  return { filled, skipped };
};
A.copyInvestor = async (tx, ctx, a) => { await needProfile(tx, ctx); if (!(await isPro(tx, ctx.pid))) throw fail('Copying investors is part of Pro.'); if (a.pid === ctx.pid) throw fail("You can't copy yourself."); await tx.set('copies', ctx.pid + '__' + a.pid, { from: ctx.pid, to: a.pid, copyPct: 1, ts: Date.now() }); };
A.stopCopying = async (tx, ctx, a) => tx.del('copies', ctx.pid + '__' + a.pid);
A.report = async (tx, ctx, a) => { await needProfile(tx, ctx); await tx.set('reports', tx.newId(), { kind: a.kind === 'photo' ? 'photo' : 'group', pid: a.kind === 'photo' ? str(a.pid, 60) : null, gid: a.gid || null, reporterPid: ctx.pid, reason: str(a.reason, 40), details: str(a.details, 500), status: 'open', ts: Date.now() }); };
A.requestJoin = async (tx, ctx, a) => {
  await needProfile(tx, ctx); const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.'); const rules = rulesOf(g);
  await checkJoin(tx, g, ctx.pid, rules);
  if (rules.rulesText && !a.acceptRules) throw fail("Please accept the group's rules to request to join.");
  await tx.set('joinRequests', a.gid + '__' + ctx.pid, { gid: a.gid, pid: ctx.pid, status: 'pending', ts: Date.now(), acceptedRules: !!a.acceptRules });
};
async function decideJoin(tx, id, approve){
  const r = await tx.get('joinRequests', id); if (!r) return;
  if (approve){ const g = await tx.get('groups', r.gid); const rules = rulesOf(g); await checkJoin(tx, g, r.pid, rules);
    await tx.set('memberships', r.gid + '__' + r.pid, { gid: r.gid, pid: r.pid, role: (await isPro(tx, r.pid)) ? 'member' : 'observer', copyPct: rules.defaultCopyPct, joinedTs: Date.now(), rulesAcceptedTs: r.acceptedRules ? r.ts : null }); }
  await tx.update('joinRequests', id, { status: approve ? 'approved' : 'declined', decidedTs: Date.now() });
  const gg = await tx.get('groups', r.gid);
  if (gg) notify(tx, [r.pid], approve ? { title: "You're in: " + gg.name, body: 'Your request to join was approved. Say hello in the group.', url: '/#/group/' + r.gid, tag: 'join-' + r.gid }
    : { title: gg.name + ': request not approved', body: "The group's Owner didn't approve your request this time.", url: '/#/groups', tag: 'join-' + r.gid });
}
A.decideJoin = async (tx, ctx, a) => { const r = await tx.get('joinRequests', a.id); if (!r) return; if (!canManage(await roleIn(tx, r.gid, ctx.pid))) throw fail('Only Owners and Admins can decide.'); await decideJoin(tx, a.id, !!a.approve); };

/* ---------- Risk Manager review ---------- */
A.releaseReview = async (tx, ctx, a) => {
  const rv = await tx.get('reviews', a.id, { lock: true }); if (!rv) throw fail('Review not found.');
  if (!canReview(await roleIn(tx, rv.gid, ctx.pid))) throw fail('Only the Risk Manager or Owner can release a trade.');
  if (rv.status !== 'pending') throw fail('This trade has already been reviewed.');
  return releaseReview(tx, rv, 'released', ctx.pid);
};
async function pauseReview(tx, rv, by, reason){
  const pid = tx.newId(), now = Date.now();
  const leader = (await tx.get('profiles', rv.leaderPid)) || {};
  await tx.set('proposals', pid, { gid: rv.gid, authorPid: by, type: 'review', title: `Should members copy ${leader.name || 'the Lead Trader'}'s ${rv.side === 'buy' ? 'buy' : 'sale'} of ${rv.sym}?`,
    details: str(reason, 800) || 'The Risk Manager paused this trade for a group vote. If it passes, members get approval requests.', createdTs: now, deadlineTs: now + 86400000, status: 'open', reviewId: rv.id });
  await tx.update('reviews', rv.id, { status: 'paused', decidedBy: by, decidedTs: now, proposalId: pid });
  return pid;
}
A.pauseReview = async (tx, ctx, a) => {
  const rv = await tx.get('reviews', a.id, { lock: true }); if (!rv) throw fail('Review not found.');
  if (!canReview(await roleIn(tx, rv.gid, ctx.pid))) throw fail('Only the Risk Manager or Owner can pause a trade.');
  if (rv.status !== 'pending') throw fail('This trade has already been reviewed.');
  return pauseReview(tx, rv, ctx.pid, a.reason);
};

/* ---------- Junior Trader suggestions ---------- */
A.suggestTrade = async (tx, ctx, a) => {
  const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.');
  if ((await roleIn(tx, a.gid, ctx.pid)) !== 'junior') throw fail('Only Junior Traders suggest trades. Lead Traders trade directly.');
  const rules = rulesOf(g); checkAllowed(rules, sym(a.sym)); side(a.side);
  const pct = Math.max(0.005, Math.min(0.5, Number(a.pct) || 0.05));
  const id = tx.newId();
  await tx.set('suggestions', id, { gid: a.gid, pid: ctx.pid, sym: a.sym, side: a.side, pct, note: str(a.note, 500), status: 'pending', ts: Date.now() });
  return id;
};
A.decideSuggestion = async (tx, ctx, a) => {
  const sg = await tx.get('suggestions', a.id, { lock: true }); if (!sg) throw fail('Suggestion not found.');
  if (!canTradeFor(await roleIn(tx, sg.gid, ctx.pid))) throw fail('Only the Lead Trader, Owner or Admins can decide on suggestions.');
  if (sg.status !== 'pending') throw fail('This suggestion was already decided.');
  if (!a.approve){ await tx.update('suggestions', sg.id, { status: 'declined', decidedBy: ctx.pid, decidedTs: Date.now() }); return null; }
  const pf = await tx.get('portfolios', ctx.pid); const val = pv(pf), px = Market.price(sg.sym);
  let shares;
  if (sg.side === 'sell'){ const held = ((pf.positions || {})[sg.sym] || {}).shares || 0; if (!held) throw fail(`You don't hold any ${sg.sym} to sell.`); shares = f3(Math.min(held, val * sg.pct / px)); }
  else shares = f3(val * sg.pct / px);
  const sname = ((await tx.get('profiles', sg.pid)) || {}).name || 'a Junior Trader';
  const res = await groupTrade(tx, sg.gid, ctx.pid, sg.sym, sg.side, shares, `Suggested by ${sname}${sg.note ? ': ' + sg.note : ''}`);
  await tx.update('suggestions', sg.id, { status: 'approved', decidedBy: ctx.pid, decidedTs: Date.now() });
  return res;
};

/* ---------- notification settings ---------- */
/* Start over: practice cash back to $100,000 and positions cleared. Statements and the track record restart from now; posts and trades stay. */
A.startOver = async (tx, ctx) => {
  await needProfile(tx, ctx); const pf = await tx.get('portfolios', ctx.pid); if (!pf) throw fail('There is no practice account to reset.');
  await tx.update('portfolios', ctx.pid, { cash: START_CASH, positions: {}, startValue: START_CASH, resetTs: Date.now(), resets: (pf.resets || 0) + 1 });
  for (const r of await tx.find('copyRequests', { memberPid: ctx.pid })) if (r.status === 'pending' || r.status === 'queued') await tx.update('copyRequests', r.id, { status: 'expired' });
};
/* Copy stop-loss, per investor you copy or group you're in: past a drop, ask to sell or stop copying. */
A.setCopyStop = async (tx, ctx, a) => {
  await needProfile(tx, ctx); const pct = a.pct ? Math.max(5, Math.min(50, Math.round(Number(a.pct)))) : null, action = a.action === 'stop' ? 'stop' : 'ask';
  const patch = { stopPct: pct, stopAction: action }; if (a.resume) patch.copyPaused = false;
  if (a.gid){ const id = a.gid + '__' + ctx.pid; if (!(await tx.get('memberships', id))) throw fail('Join the group first.'); await tx.update('memberships', id, patch); }
  else { const id = ctx.pid + '__' + a.pid; if (!(await tx.get('copies', id))) throw fail("You aren't copying them."); await tx.update('copies', id, patch); }
};
async function copyStopCheck(tx){
  const mode = await clockMode(tx), now = Date.now(); let made = 0;
  const rels = (await tx.find('copies', {})).filter(c => c.stopPct).map(c => ({ kind: 'copies', id: c.from + '__' + c.to, follower: c.from, leader: c.to, gid: null, pct: c.stopPct, action: c.stopAction, paused: c.copyPaused }))
    .concat((await tx.find('memberships', {})).filter(m => m.stopPct).map(m => ({ kind: 'memberships', id: m.gid + '__' + m.pid, follower: m.pid, leader: null, gid: m.gid, pct: m.stopPct, action: m.stopAction, paused: m.copyPaused })));
  for (const r of rels){
    if (r.paused) continue;
    const pf = await tx.get('portfolios', r.follower); if (!pf) continue;
    const reqs = (await tx.find('copyRequests', { memberPid: r.follower })).filter(x => (r.gid ? x.gid === r.gid : (!x.gid && x.leaderPid === r.leader)) && (!pf.resetTs || x.createdTs > pf.resetTs));
    const by = {}; for (const x of reqs.filter(x => x.status === 'filled' && !x.stopLoss)){ const b = by[x.sym] = by[x.sym] || { sh: 0, cost: 0 }; const sh = x.fillShares || x.shares || 0;
      if (x.side === 'buy'){ b.sh += sh; b.cost += sh * (x.fillPrice || x.leaderPrice || 0); } else b.sh -= sh; }
    for (const [sym, b] of Object.entries(by)){
      const held = ((pf.positions || {})[sym] || {}).shares || 0, copied = Math.min(held, b.sh); if (!(copied > 0.0005) || !(b.cost > 0)) continue;
      const avg = b.cost / Math.max(0.0005, reqs.filter(x => x.sym === sym && x.side === 'buy' && x.status === 'filled' && !x.stopLoss).reduce((s, x) => s + (x.fillShares || x.shares || 0), 0)), px = Market.price(sym), drop = 1 - px / avg;
      if (!(drop >= r.pct / 100)) continue;
      if (reqs.some(x => x.stopLoss && x.sym === sym && (x.status === 'pending' || now - x.createdTs < 86400000))) continue;
      const who = r.gid ? ((await tx.get('groups', r.gid)) || {}).name || 'your group' : (((await tx.get('profiles', r.leader)) || {}).name || 'them');
      if (r.action === 'stop'){ await tx.update(r.kind, r.id, { copyPaused: true }); notify(tx, [r.follower], { title: `Stopped copying ${who}`, body: `${sym} fell ${Math.round(drop * 100)}% below what you paid, past your ${r.pct}% limit. Copies are paused; resume any time.`, url: r.gid ? '/#/group/' + r.gid : '/#/u/' + r.leader, tag: 'stop-' + r.id }); made++; break; }
      const win = Market.approvalWindow(mode, now, r.gid ? rulesOf((await tx.get('groups', r.gid)) || {}).approvalMinutes : 30);
      await tx.set('copyRequests', tx.newId(), { gid: r.gid, kind: r.gid ? 'group' : 'investor', stopLoss: true, tradeId: 'stop', leaderPid: r.leader || (((await tx.get('groups', r.gid)) || {}).leadPid), memberPid: r.follower, sym, side: 'sell',
        leaderShares: 0, leaderPrice: px, shares: Math.round(copied * 1000) / 1000, status: 'pending', mode: win.mode, createdTs: now, expiresTs: win.expiresTs, leaderFrac: null, stopDrop: drop });
      notify(tx, [r.follower], { title: `${sym} is down ${Math.round(drop * 100)}% from your copy`, body: `Past your ${r.pct}% limit for copies of ${who}. Approve to sell, or decline to keep it.`, url: '/#/portfolio', tag: 'stop-' + r.id + sym }); made++;
    }
  }
  return made;
}
A.setNotifPrefs = async (tx, ctx, a) => {
  await needProfile(tx, ctx);
  const hhmm = v => /^\d{1,2}:\d{2}$/.test(v || '') ? v : null;
  const q = a.quiet || {};
  await tx.update('profiles', ctx.pid, { notif: { weeklyRecap: a.weeklyRecap !== false, approvals: a.approvals !== false, votes: a.votes !== false, social: a.social !== false, news: a.news === true, approvalsInQuiet: a.approvalsInQuiet !== false,
    mutedGroups: Array.isArray(a.mutedGroups) ? a.mutedGroups.slice(0, 50).map(String) : [], quiet: { on: !!q.on, start: hhmm(q.start) || '22:00', end: hhmm(q.end) || '07:00' }, tz: str(a.tz, 60) || 'America/New_York' } });
};

/* ---------- watchlists, profile tags, pinned announcements ---------- */
const TAGS = ['Growth','Dividends','Value','Index','Tech','Consumer brands','Long-term','Active','Learning','Income','ETFs'];
A.toggleWatch = async (tx, ctx, a) => {
  const p = await needProfile(tx, ctx); const s = sym(a.sym);
  const list = Array.isArray(p.watchlist) ? p.watchlist.slice() : [];
  const i = list.indexOf(s); if (i >= 0) list.splice(i, 1); else { if (list.length >= 50) throw fail('Your watchlist is full (50 stocks).'); list.unshift(s); }
  await tx.update('profiles', ctx.pid, { watchlist: list });
  return { watching: i < 0 };
};
A.setTags = async (tx, ctx, a) => { await needProfile(tx, ctx); const tags = (Array.isArray(a.tags) ? a.tags : []).filter(t => TAGS.includes(t)).slice(0, 3); await tx.update('profiles', ctx.pid, { tags }); };
A.setPinned = async (tx, ctx, a) => {
  if (!canManage(await roleIn(tx, a.gid, ctx.pid))) throw fail('Only Owners and Admins can pin announcements.');
  const text = str(a.text, 400).trim();
  await tx.update('groups', a.gid, { pinned: text ? { text, by: ctx.pid, ts: Date.now() } : null });
};

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
  await settleReviews(tx);
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
A.demoReview = async (tx, ctx, a) => {
  needAdmin(ctx);
  const rv = (await tx.find('reviews', { status: 'pending' })).filter(r => !a.gid || r.gid === a.gid).sort((x, y) => y.createdTs - x.createdTs)[0];
  if (!rv) throw fail('No trades are waiting for review.');
  const risk = (await tx.find('memberships', { gid: rv.gid })).find(m => m.role === 'risk');
  if (a.op === 'pause') return { paused: await pauseReview(tx, rv, risk ? risk.pid : rv.leaderPid, 'Position looks large for current volatility. Group vote before members copy.') };
  return { sent: await releaseReview(tx, rv, 'released', risk ? risk.pid : null) };
};
A.demoAddSampleData = async (tx, ctx) => { needAdmin(ctx); return require('./seed').merge(tx); };
A.featureGroup = async (tx, ctx, a) => { needAdmin(ctx); const g = await tx.get('groups', a.gid); if (!g) throw fail('Group not found.'); await tx.update('groups', a.gid, { featured: !!a.featured }); };
A.setSampleActivity = async (tx, ctx, a) => { needAdmin(ctx); await tx.setSetting('sampleActivity', { posts: !!a.posts, trades: !!a.trades, groupTrades: !!a.groupTrades }); };
A.resolveReport = async (tx, ctx, a) => { needAdmin(ctx); await tx.update('reports', a.id, { status: 'reviewed', reviewedTs: Date.now() }); };
A.resetAll = async (tx, ctx) => { needAdmin(ctx); return require('./seed').reset(tx); };

/* background job: expire stale requests and fill buy-at-open orders */
async function housekeeping(tx){
  const mode = await clockMode(tx), now = Date.now(); let n = 0;
  for (const r of await tx.find('copyRequests', { status: 'pending' })) if (requestState(r, now) === 'expired'){ await tx.update('copyRequests', r.id, { status: 'expired' }); n++; }
  for (const rv of await tx.find('reviews', { status: 'pending' })) if (now > rv.expiresTs){ await releaseReview(tx, rv, 'auto'); n++; }
  await settleReviews(tx);
  n += await runRecurring(tx);
  if (Market.canFillNow(mode, now)) for (const r of await tx.find('copyRequests', { status: 'queued' })){ try { await fillRequest(tx, r); n++; } catch (e){ if (!e.userFacing) throw e; await tx.update('copyRequests', r.id, { status: 'declined', note: e.message, decidedTs: Date.now() }); } }
  return n;
}

/* Remove everything tied to an account (used by Delete account). */
async function deleteAccountDocs(tx, pid){
  for (const m of await tx.find('memberships', { pid })){
    if (m.role !== 'owner') continue;
    const others = (await tx.find('memberships', { gid: m.gid })).filter(x => x.pid !== pid);
    const g = await tx.get('groups', m.gid);
    if (others.length) throw fail(`Transfer ownership of ${g ? g.name : 'your group'} before deleting your account.`);
    for (const c of ['proposals','posts','reviews','suggestions','joinRequests','reports']) for (const d of await tx.find(c, { gid: m.gid })) await tx.del(c, d.id);
    for (const d of await tx.find('posts', { groupId: m.gid })) await tx.del('posts', d.id);
    await tx.del('groups', m.gid);
  }
  const by = async (col, field) => { for (const d of await tx.find(col, { [field]: pid })) await tx.del(col, d.id); };
  for (const p of await tx.find('posts', { pid })){ for (const c of await tx.find('comments', { postId: p.id })) await tx.del('comments', c.id); await tx.del('posts', p.id); }
  await by('memberships', 'pid'); await by('comments', 'pid'); await by('reactions', 'pid'); await by('votes', 'pid');
  await by('follows', 'from'); await by('follows', 'to'); await by('copies', 'from'); await by('copies', 'to');
  await by('copyRequests', 'memberPid'); await by('joinRequests', 'pid'); await by('suggestions', 'pid'); await by('reports', 'reporterPid'); await by('trades', 'pid');
  await tx.del('portfolios', pid); await tx.del('profiles', pid);
}
module.exports = { copyStopCheck, canApprove, approvers, MONEY_OFFICERS, actions: A, housekeeping, deleteAccountDocs, rulesOf, UserError, START_CASH, personalTrade, groupTrade, TAGS };
