/* Sample investors, groups, posts and proposals. Timestamps are relative to now. */
function seed(now){
  const D = 86400000, H = 3600000;
  const people = [
    ['demo_maya','Maya Chen','Lead Trader at Tech Momentum Crew. Growth stocks, disciplined exits.'],
    ['demo_marcus','Marcus Reed','Dividend investor. Slow and steady, reinvest everything.'],
    ['demo_priya','Priya Patel','Former analyst. I write up every trade I make.'],
    ['demo_dan','Dan Okafor','Weekend investor, learning from the clubs here.'],
    ['demo_sofia','Sofia Alvarez','Value hunter. Patient buyer of good businesses on sale.'],
    ['demo_jake','Jake Morrison','Index core, a few high-conviction picks on top.'],
    ['demo_lena','Lena Fischer','Investment club treasurer for 9 years.'],
  ];
  const docs = {};
  const put = (c, id, d) => { docs[c + '/' + id] = d; };
  people.forEach(([id, name, bio], i) => put('profiles', id, { kind:'demo', name, bio, createdTs: now - (60 - i) * D }));
  const pos = {
    demo_maya:{ NVDA:[60,9300], MSFT:[28,11900], AMD:[45,8200], META:[12,6900], AMZN:[40,8100] },
    demo_marcus:{ SCHD:[900,23400], KO:[150,9800], JNJ:[60,9500], O:[200,11200], XOM:[70,7600] },
    demo_priya:{ GOOGL:[55,10100], V:[30,9600], COST:[9,7900], AAPL:[40,8800], MSFT:[4,1782] },
    demo_dan:{ SPY:[25,15500], AAPL:[20,4500], TSLA:[10,2800], MSFT:[3.9,1739.4], SCHD:[75,2096.25] },
    demo_sofia:{ JPM:[45,11200], DIS:[90,10600], XOM:[60,6700], GOOGL:[30,5500] },
    demo_jake:{ QQQ:[30,16500], NVDA:[40,6800], SPY:[20,12600] },
    demo_lena:{ SCHD:[700,18900], V:[25,8000], COST:[8,7000], JNJ:[40,6400] },
  };
  for (const [pid, p] of Object.entries(pos)){
    let spent = 0; const positions = {};
    for (const [s, [sh, cost]] of Object.entries(p)){ positions[s] = { shares: sh, cost }; spent += cost; }
    put('portfolios', pid, { cash: Math.round((100000 - spent) * 100) / 100, startValue: 100000, positions, updatedTs: now - D });
  }
  const groups = [
    ['g_techmomentum','Tech Momentum Crew','Growth and AI leaders, with clear rules for trimming winners. We vote on every new position.','Growth and AI leaders','open','demo_maya','demo_maya', 40],
    ['g_dividend','Dividend Builders Club','A long-running investment club focused on growing income. Monthly meetings, quarterly rebalancing.','Dividend growth','open','demo_lena','demo_marcus', 55],
    ['g_value','Value Hunters','Patient buyers of quality businesses trading below fair value.','Deep value','invite','demo_sofia','demo_sofia', 30],
  ];
  const RL = { g_techmomentum:'growth', g_dividend:'conservative', g_value:'balanced' };
  const RULES = {
    g_techmomentum: { joinMode:'open', maxMembers:25, minAccount:1000, rulesText:'1. Every new position goes to a vote unless it is under 10% of the portfolio.\n2. Be respectful: debate ideas, not people.\n3. No promoting stocks you are paid to talk about.',
      proposeRoles:['owner','admin','lead','analyst'], quorum:0.5, passRule:'majority', votingDays:3, voteWaitDays:0, maxPositionPct:0.10, allowed:'any', allowedList:[], approvalMinutes:30, riskReview:true, defaultCopyPct:1, hidden:false, feeMonthly:null },
    g_dividend: { joinMode:'open', maxMembers:40, minAccount:5000, rulesText:'We invest for income. Positions must pay a dividend or be a broad index fund. Monthly review of every holding.',
      proposeRoles:['owner','admin','lead','analyst'], quorum:0.5, passRule:'two-thirds', votingDays:7, voteWaitDays:7, maxPositionPct:0.15, allowed:'list', allowedList:['SCHD','KO','JNJ','O','XOM','V','COST','SPY','JPM'], approvalMinutes:60, riskReview:false, defaultCopyPct:0.5, hidden:false, feeMonthly:null },
    g_value: { joinMode:'request', maxMembers:15, minAccount:2500, rulesText:'Write up your thesis before proposing a position. We hold for at least a year.', proposeRoles:['owner','admin','lead','analyst'], quorum:0.6, passRule:'majority', votingDays:5, voteWaitDays:14, maxPositionPct:0.12, allowed:'any', allowedList:[], approvalMinutes:30, riskReview:false, defaultCopyPct:1, hidden:false, feeMonthly:null }
  };
  const CODES = { g_techmomentum:'TECHCREW', g_dividend:'DIVCLUB1', g_value:'VALUEHNT' };
  groups.forEach(([id, name, description, strategy, membership, ownerPid, leadPid, age]) => put('groups', id, { name, description, strategy, ownerPid, leadPid, riskLevel: RL[id], groupPro: true, createdTs: now - age * D, rules: RULES[id], inviteCode: CODES[id] }));
  const mem = [
    ['g_techmomentum','demo_maya','owner'],['g_techmomentum','demo_priya','analyst'],['g_techmomentum','demo_dan','member'],['g_techmomentum','demo_jake','risk'],['g_techmomentum','demo_sofia','observer'],
    ['g_dividend','demo_lena','owner'],['g_dividend','demo_marcus','lead'],['g_dividend','demo_dan','member'],['g_dividend','demo_priya','member'],
    ['g_value','demo_sofia','owner'],['g_value','demo_jake','member'],
  ];
  mem.forEach(([gid, pid, role], i) => put('memberships', gid + '__' + pid, { gid, pid, role, copyPct: gid === 'g_dividend' ? 0.5 : 1, joinedTs: now - (35 - i) * D, rulesAcceptedTs: now - (35 - i) * D }));
  const posts = [
    ['p1','demo_priya', null, 'Wrote up my case for $GOOGL: search is fine, cloud margins are the story. Adding on weakness.', 2*H, { sym:'GOOGL', side:'buy', shares:10, price:194.2 }],
    ['p2','demo_marcus', null, 'Dividend raise season. $KO and $JNJ both delivered. Reinvesting every penny.', 5*H, null],
    ['p3','demo_sofia', null, '$DIS looks too cheap against its parks cash flow. Starting a position, will add if it dips.', 9*H, { sym:'DIS', side:'buy', shares:30, price:112.8 }],
    ['p4','demo_jake', null, 'Rebalanced: trimmed $QQQ, topped up $SPY. Keeping the core boring.', 20*H, null],
    ['p5','demo_dan', null, 'First month in a group. Approving each trade makes me actually read the reasoning. Learning a lot.', 26*H, null],
    ['p6','demo_maya', null, 'Trimmed $NVDA after a big run. Rules over feelings: we take profits at 25% overweight.', 30*H, { sym:'NVDA', side:'sell', shares:15, price:186.4 }],
    ['p7','demo_lena', null, 'Nine years running our club on spreadsheets. Never going back.', 50*H, null],
    ['p8','demo_maya','g_techmomentum', 'Adding to $MSFT. Cloud demand plus AI pricing power. Sized at 2% for each of you.', 22*H, { sym:'MSFT', side:'buy', shares:4, price:445.1 }],
    ['p9','demo_priya','g_techmomentum', 'Reminder: vote on the $AMD proposal before Friday.', 10*H, null],
    ['p10','demo_marcus','g_dividend', 'Bought more $SCHD for the club. Yield still attractive here.', 30*H, { sym:'SCHD', side:'buy', shares:80, price:27.9 }],
  ];
  posts.forEach(([id, pid, groupId, text, agoMs, trade]) => put('posts', id, Object.assign({ pid, groupId, text, ts: now - agoMs }, trade ? { trade } : {}, groupId && trade ? { groupTrade: true } : {})));
  const reacts = [['p1','demo_dan'],['p1','demo_jake'],['p1','demo_maya'],['p3','demo_marcus'],['p5','demo_lena'],['p5','demo_priya'],['p6','demo_dan'],['p6','demo_jake'],['p7','demo_marcus']];
  reacts.forEach(([postId, pid]) => put('reactions', postId + '__' + pid, { postId, pid, ts: now - H }));
  const comms = [['c1','p1','demo_maya','Agree on cloud. Watching capex closely though.', 90*60000],['c2','p5','demo_lena','That is exactly the point of approvals. Glad it helps.', 20*H],['c3','p3','demo_jake','What is your exit price?', 7*H]];
  comms.forEach(([id, postId, pid, text, a]) => put('comments', id, { postId, pid, text, ts: now - a }));
  const fol = [['demo_dan','demo_maya'],['demo_dan','demo_priya'],['demo_jake','demo_maya'],['demo_marcus','demo_lena'],['demo_lena','demo_marcus'],['demo_priya','demo_sofia'],['demo_sofia','demo_priya'],['demo_jake','demo_sofia']];
  fol.forEach(([a, b]) => put('follows', a + '__' + b, { from: a, to: b, ts: now - 10 * D }));
  put('proposals','pr_amd', { gid:'g_techmomentum', authorPid:'demo_maya', type:'trade', title:'Add $AMD at 5% of the portfolio', details:'Data center share gains and a cheaper multiple than peers. If this passes, I buy at the next open and each of you gets an approval request.', createdTs: now - 20*H, deadlineTs: now + 2*D, status:'open', tradeSym:'AMD', tradeSide:'buy', tradePct:0.05 });
  put('proposals','pr_trim', { gid:'g_techmomentum', authorPid:'demo_priya', type:'policy', title:'Trim any position above 25% of the portfolio', details:'A standing rule so we take profits without debating every time.', createdTs: now - 9*D, deadlineTs: now - 6*D, status:'passed', closedTs: now - 6*D });
  put('proposals','pr_reit', { gid:'g_dividend', authorPid:'demo_lena', type:'strategy', title:'Allow REITs up to 15% of holdings', details:'Adds $O and similar income names to our universe.', createdTs: now - 1*D, deadlineTs: now + 3*D, status:'open' });
  const votes = [['pr_amd','demo_priya','yes'],['pr_amd','demo_jake','no'],['pr_trim','demo_maya','yes'],['pr_trim','demo_dan','yes'],['pr_trim','demo_jake','yes'],['pr_trim','demo_priya','yes'],['pr_reit','demo_marcus','yes']];
  votes.forEach(([prid, pid, vote]) => put('votes', prid + '__' + pid, { prid, pid, vote, ts: now - 5*H }));
  const reqs = [
    ['rq1','g_techmomentum','demo_maya','demo_dan','MSFT',4,445.1,3.9,'filled',446.0,22*H,4*60000],
    ['rq2','g_techmomentum','demo_maya','demo_priya','MSFT',4,445.1,4.0,'filled',445.5,22*H,9*60000],
    ['rq3','g_techmomentum','demo_maya','demo_jake','MSFT',4,445.1,3.8,'declined',null,22*H,12*60000],
    ['rq4','g_dividend','demo_marcus','demo_dan','SCHD',80,27.9,75,'filled',27.95,30*H,6*60000],
    ['rq5','g_dividend','demo_marcus','demo_priya','SCHD',80,27.9,74,'expired',null,30*H,null],
  ];
  reqs.forEach(([id, gid, leaderPid, memberPid, sym, ls, lp, sh, status, fp, a, dec]) => put('copyRequests', id, Object.assign({ gid, kind:'group', tradeId:null, leaderPid, memberPid, sym, side:'buy', leaderShares: ls, leaderPrice: lp, shares: sh, status, mode:'window', createdTs: now - a, expiresTs: now - a + 30*60000 },
    status === 'filled' ? { fillPrice: fp, fillShares: sh, decidedTs: now - a + dec } : status === 'declined' ? { decidedTs: now - a + dec } : {})));
  return docs;
}

const { COLS } = require('./db');
const START_CASH = 100000;

/* Wipe every collection, restore the sample data, and give each registered
   user a fresh account. Users stay signed in. */
async function reset(tx){
  for (const c of COLS) await tx.wipe(c);
  const docs = seed(Date.now());
  for (const [path, data] of Object.entries(docs)){ const [c, id] = path.split('/'); await tx.set(c, id, data); }
  const users = (await tx.query('SELECT id, display_name FROM users')).rows;
  for (const u of users) await createAccount(tx, u.id, u.display_name, 'balanced');
  await tx.setSetting('clock', 'live');
  return Object.keys(docs).length;
}
async function createAccount(tx, userId, name, risk){
  const pid = 'u_' + userId;
  await tx.set('profiles', pid, { kind: 'real', userId, name, bio: '', plan: 'free', riskProfile: risk || 'balanced', createdTs: Date.now() });
  await tx.set('portfolios', pid, { cash: START_CASH, startValue: START_CASH, positions: {}, updatedTs: Date.now() });
  return pid;
}
async function seedIfEmpty(withTx){
  const { pool } = require('./db');
  const r = await pool.query('SELECT count(*)::int AS n FROM doc_profiles');
  if (r.rows[0].n > 0) return false;
  await withTx(tx => reset(tx));
  return true;
}
module.exports = { seed, reset, createAccount, seedIfEmpty };
