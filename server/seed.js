/* Sample data for the demo: about 20 sample investors, 8 groups and roughly four months
   of back-filled history (trades, group trades with member approvals, posts, comments,
   likes and votes). Generated the same way every time, with timestamps relative to now,
   so a reset always looks lived-in. Every sample investor has kind:'demo' and is labeled
   as a sample in the app. */
const Market = require('./market');

const PEOPLE = [
  ['demo_maya','Maya Chen','Lead Trader at Tech Momentum Crew. Growth stocks, disciplined exits.','growth'],
  ['demo_marcus','Marcus Reed','Dividend investor. Slow and steady, reinvest everything.','dividend'],
  ['demo_priya','Priya Patel','Former analyst. I write up every trade I make.','growth'],
  ['demo_dan','Dan Okafor','Weekend investor, learning from the clubs here.','index'],
  ['demo_sofia','Sofia Alvarez','Value hunter. Patient buyer of good businesses on sale.','value'],
  ['demo_jake','Jake Morrison','Index core, a few high-conviction picks on top.','index'],
  ['demo_lena','Lena Fischer','Investment club treasurer for 9 years.','dividend'],
  ['demo_aisha','Aisha Rahman','Teacher. Started investing two years ago. Index funds first, questions always.','index'],
  ['demo_tom','Tom Becker','Retired engineer. Dividends pay for my fishing trips.','dividend'],
  ['demo_kenji','Kenji Watanabe','Semiconductor nerd. I read earnings calls for fun.','growth'],
  ['demo_rachel','Rachel Moreno','I buy what I use. Brands with loyal customers.','consumer'],
  ['demo_ben','Ben Carter','Nurse on night shifts. Long-term index plus a few picks.','index'],
  ['demo_elena','Elena Petrova','Ex-auditor. Balance sheets first, stories second.','value'],
  ['demo_luis','Luis Ortega','Small business owner investing for my kids\u2019 college.','dividend'],
  ['demo_hannah','Hannah Lee','Grad student learning alongside the Beginners Circle.','index'],
  ['demo_sam','Sam Whitfield','Energy and cash flow. I like businesses that pay you back.','value'],
  ['demo_zoe','Zoe Clarke','Product manager. Curious about everything, mostly growth.','growth'],
  ['demo_derek','Derek Owens','Dad of three. ETFs and dividends, nothing fancy.','dividend'],
  ['demo_mei','Mei Lin','Data scientist. Mostly index, testing a few ideas.','index'],
  ['demo_victor','Victor Hale','Former trader, now mentoring new investors.','value']
];
const STYLE_SYMS = {
  growth: ['NVDA','MSFT','AMD','META','AMZN','GOOGL','TSLA','NFLX','AAPL','QQQ'],
  dividend: ['SCHD','KO','JNJ','O','XOM','V','COST','JPM','SPY'],
  value: ['JPM','DIS','XOM','GOOGL','JNJ','KO','V','COST'],
  index: ['SPY','QQQ','SCHD','AAPL','MSFT'],
  consumer: ['KO','COST','DIS','NFLX','AMZN','AAPL','TSLA']
};
const BASE_RULES = { joinMode:'open', maxMembers:null, minAccount:0, rulesText:'', proposeRoles:['owner','admin','lead','analyst'], quorum:0, passRule:'majority', votingDays:3, voteWaitDays:0, maxPositionPct:null, allowed:'any', allowedList:[], approvalMinutes:30, riskReview:false, defaultCopyPct:1, hidden:false, feeMonthly:null };
const R = o => Object.assign({}, BASE_RULES, o);
/* id, name, description, strategy, category, risk level, owner, lead, age (days), invite code, featured, rules, goals, pinned */
const GROUPS = [
  ['g_techmomentum','Tech Momentum Crew','Growth and AI leaders, with clear rules for trimming winners. We vote on every new position.','Growth and AI leaders','growth','growth','demo_maya','demo_maya',140,'TECHCREW',true,
    R({ maxMembers:25, minAccount:1000, rulesText:'1. Every new position goes to a vote unless it is under 10% of the portfolio.\n2. Be respectful: debate ideas, not people.\n3. No promoting stocks you are paid to talk about.', quorum:0.5, maxPositionPct:0.10, riskReview:true }),
    'Beat the market over five years with a focused set of growth leaders, without letting any one position run the portfolio.', 'Earnings week: Maya posts a short note before each trade. Vote on the AMD proposal by Friday.'],
  ['g_dividend','Dividend Builders Club','A long-running investment club focused on growing income. Monthly meetings, quarterly rebalancing.','Dividend growth','dividends','conservative','demo_lena','demo_marcus',150,'DIVCLUB1',true,
    R({ maxMembers:40, minAccount:5000, rulesText:'We invest for income. Positions must pay a dividend or be a broad index fund. Monthly review of every holding.', quorum:0.5, passRule:'two-thirds', votingDays:7, voteWaitDays:7, maxPositionPct:0.15, allowed:'list', allowedList:['SCHD','KO','JNJ','O','XOM','V','COST','SPY','JPM'], approvalMinutes:60, defaultCopyPct:0.5 }),
    'Grow our dividend income every year and never sell in a panic.', 'Monthly meeting this Sunday at 7pm. Bring one idea and one holding you would trim.'],
  ['g_value','Value Hunters','Patient buyers of quality businesses trading below fair value.','Deep value','value','balanced','demo_sofia','demo_sofia',120,'VALUEHNT',false,
    R({ joinMode:'request', maxMembers:15, minAccount:2500, rulesText:'Write up your thesis before proposing a position. We hold for at least a year.', quorum:0.6, votingDays:5, voteWaitDays:14, maxPositionPct:0.12 }),
    'Buy great businesses at fair prices and hold them through the noise.', ''],
  ['g_beginners','Beginners Circle','A friendly group for people new to investing. We start with index funds and a few well-known companies, and explain every trade.','Learn by doing','beginners','balanced','demo_aisha','demo_victor',110,'BEGINNER',true,
    R({ rulesText:'1. No question is a dumb question.\n2. Every trade comes with a plain-English reason.\n3. Small positions only while we learn.', quorum:0.4, votingDays:5, maxPositionPct:0.08, allowed:'list', allowedList:['SPY','QQQ','SCHD','AAPL','MSFT','KO','JNJ','COST','V'], approvalMinutes:60, defaultCopyPct:0.5 }),
    'Learn how investing works with real decisions and small, sensible positions.', 'New here? Start with the pinned explainer posts, then say hi in the Activity tab.'],
  ['g_index','Index and Chill','Low-cost index funds, rebalanced quarterly. Boring on purpose.','ETF core','index','conservative','demo_mei','demo_ben',100,'INDEXCHL',false,
    R({ rulesText:'ETFs only. We rebalance once a quarter and otherwise leave it alone.', allowed:'etf', approvalMinutes:60, maxPositionPct:0.25 }),
    'Match the market at the lowest cost, with as little effort as possible.', ''],
  ['g_brands','Brand Loyalists','We invest in the brands we love and use every day.','Consumer brands','consumer','balanced','demo_rachel','demo_rachel',90,'BRANDFAN',false,
    R({ rulesText:'Pitch a brand you actually use. Tell us why customers keep coming back.', allowed:'list', allowedList:['KO','COST','DIS','NFLX','AMZN','AAPL','TSLA','V'], maxPositionPct:0.12 }),
    'Own great consumer brands for the long run.', ''],
  ['g_semis','Chip Watchers','Semiconductors and the companies building AI infrastructure.','Semiconductors and AI','growth','growth','demo_kenji','demo_kenji',80,'CHIPWTCH',false,
    R({ joinMode:'request', maxMembers:20, minAccount:2000, rulesText:'Bring data. Every proposal includes a downside case.', quorum:0.5, maxPositionPct:0.15 }),
    'Understand the chip cycle and invest through it with discipline.', ''],
  ['g_family','Kitchen Table Investors','Parents investing for the long term: college funds, retirement, and teaching our kids along the way.','Family long-term','dividends','conservative','demo_derek','demo_luis',95,'KITCHENT',false,
    R({ rulesText:'Long term only. No trades based on headlines.', allowed:'list', allowedList:['SPY','SCHD','KO','JNJ','COST','V','AAPL','MSFT','JPM'], approvalMinutes:60, defaultCopyPct:0.5 }),
    'Build steady wealth for our families and teach our kids how it works.', '']
];
/* group, member, role, days ago joined (null = random) */
const MEMBERS = [
  ['g_techmomentum','demo_maya','owner',140],['g_techmomentum','demo_priya','analyst',120],['g_techmomentum','demo_dan','member',90],['g_techmomentum','demo_jake','risk',110],['g_techmomentum','demo_sofia','observer',60],
  ['g_techmomentum','demo_zoe','member',70],['g_techmomentum','demo_kenji','member',75],['g_techmomentum','demo_mei','member',40],
  ['g_dividend','demo_lena','owner',150],['g_dividend','demo_marcus','lead',148],['g_dividend','demo_dan','member',85],['g_dividend','demo_priya','member',100],['g_dividend','demo_tom','member',130],['g_dividend','demo_derek','member',80],['g_dividend','demo_luis','analyst',90],
  ['g_value','demo_sofia','owner',120],['g_value','demo_jake','member',100],['g_value','demo_elena','analyst',110],['g_value','demo_sam','member',95],['g_value','demo_victor','member',90],
  ['g_beginners','demo_aisha','owner',110],['g_beginners','demo_victor','lead',109],['g_beginners','demo_hannah','member',100],['g_beginners','demo_ben','member',90],['g_beginners','demo_dan','member',60],['g_beginners','demo_mei','moderator',95],['g_beginners','demo_zoe','observer',30],
  ['g_index','demo_mei','owner',100],['g_index','demo_ben','lead',99],['g_index','demo_jake','member',90],['g_index','demo_hannah','member',70],['g_index','demo_derek','member',60],
  ['g_brands','demo_rachel','owner',90],['g_brands','demo_zoe','member',80],['g_brands','demo_tom','member',70],['g_brands','demo_luis','member',60],
  ['g_semis','demo_kenji','owner',80],['g_semis','demo_maya','member',78],['g_semis','demo_zoe','member',60],['g_semis','demo_sam','observer',40],
  ['g_family','demo_derek','owner',95],['g_family','demo_luis','lead',94],['g_family','demo_tom','member',85],['g_family','demo_ben','member',70],['g_family','demo_rachel','member',50]
];

/* post templates: {S} is a ticker */
const TPL = {
  buy: ['Started a small position in ${S}. Will add if it dips.','Added to ${S} today. The thesis hasn\u2019t changed.','Bought ${S}. Long-term hold, not a trade.','Picked up more ${S}. Steady compounder.','Opened ${S} at a size I can sleep with.'],
  sell: ['Trimmed ${S} after a strong run. Rules over feelings.','Took some profit on ${S}. Still own most of it.','Sold part of ${S} to rebalance.'],
  growth: ['Earnings season is when ${S} either proves it or doesn\u2019t. Watching margins.','Everyone talks about AI. ${S} is one of the few actually getting paid for it.','Volatility in ${S} is the price of admission for growth.'],
  dividend: ['Dividend raise from ${S} hit today. Reinvesting all of it.','${S} isn\u2019t exciting, which is exactly why I own it.','Checked my dividend tracker: ${S} is now my top income source.'],
  value: ['${S} looks cheap against its cash flow. Doing more homework this week.','The market hates ${S} right now. That\u2019s usually when I start reading.','Patience with ${S} is paying off slowly.'],
  index: ['Automatic monthly buy of ${S} went through. Boring is good.','Rebalanced back to target. ${S} is still the core.','Reminder to myself: time in the market beats timing it.'],
  consumer: ['Every store I visit is packed. Long ${S}.','${S} keeps raising prices and customers keep coming back.','Bought ${S} because I can\u2019t stop using their product.'],
  general: ['What\u2019s everyone\u2019s plan for the rest of the quarter?','Approving each group trade makes me actually read the reasoning. Underrated feature.','Down week, but nothing in the thesis changed. Holding.','First time voting on a group proposal. Felt more involved than any app I\u2019ve used.','Writing my reasons down before each trade has made me a calmer investor.'],
  group: ['Reminder: vote on the open proposal before it closes.','Great discussion this week. Notes are pinned.','Welcome to the new members! Introduce yourselves.','Quarter review: we stuck to our rules and it showed.','Question for the group: trim winners now or let them run?']
};
const COMMENTS = ['Agree. What\u2019s your exit plan?','Thanks for explaining the reasoning.','I copied half of this one.','Watching this too.','How big is your position?','Good call. I was on the fence.','I\u2019d wait for earnings first, but makes sense.','This is why I joined the group.','Smart to size it small.','Interesting take. Do you have a target price?'];

function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r2 = n => Math.round(n * 100) / 100, r3 = n => Math.round(n * 1000) / 1000;

function seed(now, opt = {}){
  const D = 86400000, H = 3600000, rand = rng(20261109), PFX = opt.prefix || '';
  const pick = a => a[Math.floor(rand() * a.length)];
  const docs = {}; const put = (c, id, d) => { docs[c + '/' + id] = d; };
  let seq = 0; const nid = p => PFX + p + (++seq).toString(36);
  const style = Object.fromEntries(PEOPLE.map(p => [p[0], p[3]]));
  PEOPLE.forEach(([id, name, bio, st], i) => put('profiles', id, { kind:'demo', name, bio, createdTs: now - (160 - i) * D, tags: { growth:['Growth','Tech'], dividend:['Dividends','Long-term'], value:['Value','Long-term'], index:['Index','Learning'], consumer:['Consumer brands','Long-term'] }[st] }));
  /* portfolios are built by replaying every trade from $100,000 in cash */
  const pf = Object.fromEntries(PEOPLE.map(p => [p[0], { cash: 100000, positions: {} }]));
  const pv = (pid, ts) => { const p = pf[pid]; let v = p.cash; for (const [s, x] of Object.entries(p.positions)) v += x.shares * Market.price(s, ts); return v; };
  function exec(pid, sym, side, shares, ts, extra){
    const p = pf[pid], price = Market.price(sym, ts); shares = r3(shares); if (!(shares > 0)) return null;
    const pos = p.positions[sym] || { shares: 0, cost: 0 };
    if (side === 'buy'){ const cost = r2(shares * price); if (cost > p.cash) { shares = r3(Math.floor(p.cash / price * 1000) / 1000); if (!(shares > 0)) return null; } p.cash = r2(p.cash - shares * price); pos.cost = r2(pos.cost + shares * price); pos.shares = r3(pos.shares + shares); }
    else { shares = Math.min(shares, pos.shares); if (!(shares > 0)) return null; const avg = pos.cost / pos.shares; pos.cost = r2(pos.cost - avg * shares); pos.shares = r3(pos.shares - shares); p.cash = r2(p.cash + shares * price); }
    if (pos.shares <= 0.0005) delete p.positions[sym]; else p.positions[sym] = pos;
    const id = nid('t'); put('trades', id, Object.assign({ pid, sym, side, shares, price, ts }, extra || {}, { groupId: (extra && extra.groupId) || null, copyOf: (extra && extra.copyOf) || null }));
    return { id, shares, price };
  }
  /* groups and memberships */
  const joined = {};
  GROUPS.forEach(([id, name, description, strategy, category, risk, owner, lead, age, code, featured, rules, goals, pinned]) => {
    put('groups', id, Object.assign({ name, description, strategy, category, ownerPid: owner, leadPid: lead, riskLevel: risk, groupPro: true, createdTs: now - age * D, rules, inviteCode: code, goals, featured: !!featured },
      pinned ? { pinned: { text: pinned, by: owner, ts: now - 2 * D } } : {}));
  });
  MEMBERS.forEach(([gid, pid, role, days]) => { const ts = now - days * D; joined[gid + '__' + pid] = ts; put('memberships', gid + '__' + pid, { gid, pid, role, copyPct: GROUPS.find(g => g[0] === gid)[11].defaultCopyPct, joinedTs: ts, rulesAcceptedTs: ts }); });
  const groupOf = gid => GROUPS.find(g => g[0] === gid);
  const allowedFor = gid => { const r = groupOf(gid)[11]; return r.allowed === 'etf' ? ['SPY','QQQ','SCHD'] : r.allowed === 'list' ? r.allowedList : STYLE_SYMS[{ growth:'growth', dividends:'dividend', value:'value', beginners:'index', index:'index', consumer:'consumer' }[groupOf(gid)[4]] || 'growth']; };
  /* likes and comments on a post */
  function engage(postId, author, ts){
    const n = Math.floor(rand() * 7);
    for (let i = 0; i < n; i++){ const who = pick(PEOPLE)[0]; if (who === author || docs['reactions/' + postId + '__' + who]) continue; put('reactions', postId + '__' + who, { postId, pid: who, ts: ts + Math.floor(rand() * 6 * H) }); }
    const c = rand() < 0.45 ? 1 + Math.floor(rand() * 3) : 0;
    for (let i = 0; i < c; i++){ const who = pick(PEOPLE)[0]; if (who === author) continue; put('comments', nid('c'), { postId, pid: who, text: pick(COMMENTS), ts: ts + Math.floor((1 + rand() * 20) * H) }); }
  }
  const fill = (tpl, s) => tpl.replace(/\$\{S\}/g, '$' + s);
  /* walk forward one day at a time through the last 120 days */
  for (let day = 120; day >= 1; day--){
    const dayStart = now - day * D;
    const at = () => dayStart + Math.floor((9.6 + rand() * 6) * H); /* during market hours, roughly */
    /* personal trades and posts */
    for (const [pid, , , st] of PEOPLE){
      if (rand() < 0.055){
        const ts = at(), held = Object.keys(pf[pid].positions);
        const sell = held.length > 2 && rand() < 0.28;
        const sym = sell ? pick(held) : pick(STYLE_SYMS[st]);
        const shares = sell ? pf[pid].positions[sym].shares * (0.25 + rand() * 0.35) : (pv(pid, ts) * (0.03 + rand() * 0.06)) / Market.price(sym, ts);
        const t = exec(pid, sym, sell ? 'sell' : 'buy', shares, ts);
        if (t && rand() < 0.45){ const id = nid('p'); put('posts', id, { pid, ts: ts + 60000, groupId: null, text: fill(pick(sell ? TPL.sell : TPL.buy), sym), trade: { sym, side: sell ? 'sell' : 'buy', shares: t.shares, price: t.price } }); engage(id, pid, ts); }
      }
      if (rand() < 0.06){ const ts = at(), id = nid('p'); const sym = pick(STYLE_SYMS[st]); put('posts', id, { pid, ts, groupId: null, text: rand() < 0.3 ? pick(TPL.general) : fill(pick(TPL[st]), sym) }); engage(id, pid, ts); }
    }
    /* group trades by each Lead Trader, with member approvals */
    for (const g of GROUPS){
      const [gid, , , , , , , lead, age] = g; if (day >= age - 2) continue;
      if (rand() < 0.085){
        const ts = at(), held = Object.keys(pf[lead].positions).filter(s => allowedFor(gid).includes(s));
        const sell = held.length > 1 && rand() < 0.25;
        const sym = sell ? pick(held) : pick(allowedFor(gid));
        const maxPct = g[11].maxPositionPct || 0.1;
        const heldBefore = (pf[lead].positions[sym] || {}).shares || 0, leadValue = pv(lead, ts);
        const shares = sell ? heldBefore * (0.3 + rand() * 0.4) : (leadValue * Math.min(maxPct, 0.04 + rand() * 0.05)) / Market.price(sym, ts);
        const t = exec(lead, sym, sell ? 'sell' : 'buy', shares, ts, { groupId: gid }); if (!t) continue;
        const postId = nid('p');
        put('posts', postId, { pid: lead, groupId: gid, ts, groupTrade: true, text: fill(pick(sell ? TPL.sell : TPL.buy), sym), trade: { sym, side: sell ? 'sell' : 'buy', shares: t.shares, price: t.price } });
        engage(postId, lead, ts);
        for (const [mg, mp, role] of MEMBERS){
          if (mg !== gid || mp === lead || role === 'observer' || (joined[mg + '__' + mp] || now) > ts) continue;
          const frac = (pf[mp] && (sell ? (((pf[mp].positions[sym] || {}).shares || 0) * Math.min(1, heldBefore ? t.shares / heldBefore : 1)) : (t.shares * t.price / leadValue) * pv(mp, ts) * g[11].defaultCopyPct / t.price)) || 0;
          const want = Math.floor(frac * 1000) / 1000; if (!(want > 0)) continue;
          const roll = rand(), rid = nid('r'), base = { gid, kind:'group', tradeId: t.id, leaderPid: lead, memberPid: mp, sym, side: sell ? 'sell' : 'buy', leaderShares: t.shares, leaderPrice: t.price, shares: want, mode:'window', createdTs: ts, expiresTs: ts + g[11].approvalMinutes * 60000, leaderFrac: sell && heldBefore ? Math.min(1, t.shares / heldBefore) : null };
          if (roll < 0.72){ const half = rand() < 0.15 ? 0.5 : 1; const fts = ts + Math.floor((2 + rand() * 20) * 60000); const f = exec(mp, sym, base.side, want * half, fts, { groupId: gid, copyOf: rid });
            if (f) put('copyRequests', rid, Object.assign(base, { status:'filled', fillPrice: f.price, fillShares: f.shares, decidedTs: fts, frac: half }));
            else put('copyRequests', rid, Object.assign(base, { status:'declined', note:'Not enough cash or shares', decidedTs: fts })); }
          else if (roll < 0.87) put('copyRequests', rid, Object.assign(base, { status:'declined', decidedTs: ts + Math.floor((3 + rand() * 15) * 60000) }));
          else put('copyRequests', rid, Object.assign(base, { status:'expired' }));
        }
      }
      if (rand() < 0.05){ const ts = at(), who = pick(MEMBERS.filter(m => m[0] === gid && (joined[m[0] + '__' + m[1]] || now) < ts))[1]; if (who){ const id = nid('p'); put('posts', id, { pid: who, groupId: gid, ts, text: pick(TPL.group) }); engage(id, who, ts); } }
    }
  }
  /* closed proposals with votes, one roughly every month per group */
  const PROPS = ['Trim any position above 25% of the portfolio','Add a monthly review of every holding','Raise the approval window to 60 minutes','Allow one speculative position at 3%','Require a written thesis for every new position','Rebalance to targets every quarter'];
  for (const g of GROUPS){
    const [gid, , , , , , owner, lead, age] = g;
    for (let k = 1; k * 30 < age - 5; k++){
      const created = now - (k * 30 + 3) * D, prid = nid('pr'), title = pick(PROPS);
      const voters = MEMBERS.filter(m => m[0] === gid && m[2] !== 'observer' && (joined[m[0] + '__' + m[1]] || now) < created);
      let yes = 0, no = 0;
      voters.forEach(([, pid]) => { const v = rand() < 0.68 ? 'yes' : rand() < 0.8 ? 'no' : 'abstain'; if (v === 'yes') yes++; else if (v === 'no') no++; put('votes', prid + '__' + pid, { prid, pid, vote: v, ts: created + Math.floor(rand() * 2 * D) }); });
      const ratio = yes + no ? yes / (yes + no) : 0, passes = g[11].passRule === 'two-thirds' ? ratio >= 2 / 3 : ratio > 0.5;
      put('proposals', prid, { gid, authorPid: rand() < 0.5 ? owner : lead, type: 'policy', title, details: 'Proposed to keep us disciplined. Discussion in the Activity tab.', createdTs: created, deadlineTs: created + g[11].votingDays * D, status: passes ? 'passed' : 'failed', closedTs: created + g[11].votingDays * D });
    }
  }
  /* the open proposals the tour and presenter use */
  put('proposals','pr_amd', { gid:'g_techmomentum', authorPid:'demo_maya', type:'trade', title:'Add $AMD at 5% of the portfolio', details:'Data center share gains and a cheaper multiple than peers. If this passes, I buy at the next open and each of you gets an approval request.', createdTs: now - 20*H, deadlineTs: now + 2*D, status:'open', tradeSym:'AMD', tradeSide:'buy', tradePct:0.05 });
  put('proposals','pr_reit', { gid:'g_dividend', authorPid:'demo_lena', type:'strategy', title:'Allow REITs up to 15% of holdings', details:'Adds $O and similar income names to our universe.', createdTs: now - 1*D, deadlineTs: now + 3*D, status:'open' });
  put('proposals','pr_starter', { gid:'g_beginners', authorPid:'demo_victor', type:'trade', title:'Start a core position in $SPY at 8%', details:'The simplest foundation there is. Everyone gets an approval request if this passes, and you can copy half if you prefer.', createdTs: now - 6*H, deadlineTs: now + 4*D, status:'open', tradeSym:'SPY', tradeSide:'buy', tradePct:0.08 });
  [['pr_amd','demo_priya','yes'],['pr_amd','demo_jake','no'],['pr_amd','demo_zoe','yes'],['pr_reit','demo_marcus','yes'],['pr_reit','demo_tom','yes'],['pr_starter','demo_hannah','yes']].forEach(([prid, pid, vote]) => put('votes', prid + '__' + pid, { prid, pid, vote, ts: now - 4*H }));
  /* a few recent posts so the feed opens on something current */
  [['demo_priya','Wrote up my case for $GOOGL: search is fine, cloud margins are the story. Adding on weakness.', 2*H],['demo_marcus','Dividend raise season. $KO and $JNJ both delivered. Reinvesting every penny.', 5*H],
   ['demo_dan','A few months in a group now. Approving each trade makes me actually read the reasoning. Learning a lot.', 26*H],['demo_aisha','Beginners Circle question of the week: what made you buy your first stock?', 8*H],
   ['demo_kenji','Chip Watchers note: $NVDA and $AMD both report soon. Expect volatility either way.', 12*H],['demo_lena','Nine years running our club on spreadsheets. Never going back.', 50*H]]
   .forEach(([pid, text, a]) => { const id = nid('p'); put('posts', id, { pid, groupId: null, text, ts: now - a }); engage(id, pid, now - a); });
  /* follows: everyone follows a handful of people, leads more often */
  const leads = GROUPS.map(g => g[7]);
  for (const [pid] of PEOPLE){ const n = 3 + Math.floor(rand() * 5); for (let i = 0; i < n; i++){ const to = rand() < 0.5 ? pick(leads) : pick(PEOPLE)[0]; if (to !== pid) put('follows', pid + '__' + to, { from: pid, to, ts: now - Math.floor(rand() * 100) * D }); } }
  /* final portfolios */
  for (const [pid] of PEOPLE) put('portfolios', pid, { cash: r2(pf[pid].cash), startValue: 100000, positions: pf[pid].positions, updatedTs: now - D });
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
/* Add the sample investors, groups and history alongside existing data without deleting
   anything. Existing sample investors get the new history and portfolios; existing groups
   keep their members and rules and gain the new details; real people's data is untouched.
   Running it again adds nothing new. */
async function merge(tx){
  const docs = seed(Date.now(), { prefix: 's2' });
  let added = 0, updated = 0;
  /* Sample investors' portfolios are replaced below, so their trade history is replaced with them;
     otherwise old and new trades pile up and no longer add up to their holdings. Testers' trades are kept. */
  for (const [pid] of PEOPLE) for (const t of await tx.find('trades', { pid })) await tx.del('trades', t.id);
  for (const [path, data] of Object.entries(docs)){
    const [c, id] = path.split('/');
    if (c === 'trades' && String(data.pid || '').startsWith('demo_')){ await tx.set(c, id, data); updated++; continue; }
    const cur = await tx.get(c, id);
    if (c === 'portfolios'){ if (id.startsWith('demo_')){ await tx.set(c, id, data); updated++; } continue; }
    if (!cur){ await tx.set(c, id, data); added++; continue; }
    if (c === 'groups'){ const patch = {}; ['category','goals','featured'].forEach(k => { if (cur[k] == null && data[k] != null) patch[k] = data[k]; }); if (!cur.pinned && data.pinned) patch.pinned = data.pinned; if (Object.keys(patch).length){ await tx.update(c, id, patch); updated++; } }
    if (c === 'profiles' && cur.kind === 'demo' && !cur.tags && data.tags){ await tx.update(c, id, { tags: data.tags }); updated++; }
  }
  return { added, updated };
}
async function createAccount(tx, userId, name, risk){
  const pid = 'u_' + userId;
  await tx.set('profiles', pid, { kind: 'real', userId, name, bio: '', plan: 'free', riskProfile: risk || 'balanced', createdTs: Date.now() });
  await tx.set('portfolios', pid, { cash: START_CASH, startValue: START_CASH, positions: {}, updatedTs: Date.now() });
  return pid;
}
/* One-time repair for databases where "Add new sample data" left sample trade histories that
   don't add up to the sample portfolios. Rebuilds sample data the same way the button does. */
async function repairSampleTrades(withTx){
  const { pool } = require('./db');
  const done = await pool.query(`SELECT 1 FROM settings WHERE key = 'sampleTradesRepaired'`); if (done.rows.length) return false;
  let broken = 0;
  for (const [pid] of PEOPLE){
    const pf = ((await pool.query('SELECT data FROM doc_portfolios WHERE id = $1', [pid])).rows[0] || {}).data; if (!pf) continue;
    const pos = {}; (await pool.query(`SELECT data FROM doc_trades WHERE data->>'pid' = $1`, [pid])).rows.forEach(({ data: t }) => { pos[t.sym] = (pos[t.sym] || 0) + (t.side === 'buy' ? t.shares : -t.shares); });
    const syms = new Set([...Object.keys(pos), ...Object.keys(pf.positions || {})]);
    if ([...syms].some(sym => Math.abs((pos[sym] || 0) - (((pf.positions || {})[sym] || {}).shares || 0)) > 0.01)) broken++;
  }
  if (broken) await withTx(tx => merge(tx));
  await pool.query(`INSERT INTO settings (key, value) VALUES ('sampleTradesRepaired', 'true') ON CONFLICT (key) DO NOTHING`);
  return broken;
}
async function seedIfEmpty(withTx){
  const { pool } = require('./db');
  const r = await pool.query('SELECT count(*)::int AS n FROM doc_profiles');
  if (r.rows[0].n > 0) return false;
  await withTx(tx => reset(tx));
  return true;
}
module.exports = { seed, reset, merge, createAccount, seedIfEmpty, repairSampleTrades, PEOPLE, STYLE_SYMS, TPL, COMMENTS };
