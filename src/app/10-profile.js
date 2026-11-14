/* Profiles, following, track records and risk scores. */

function statsFor(kind, id){
  const k = kind + ':' + id; ui.stats = ui.stats || {};
  if (!ui.stats[k]){ ui.stats[k] = 'loading'; Store.http('GET', `/api/stats/${kind}/${encodeURIComponent(id)}`).then(r => { ui.stats[k] = r.stats || { none: true }; render(); }, () => { ui.stats[k] = { none: true }; render(); }); }
  return ui.stats[k] === 'loading' ? null : ui.stats[k];
}

function riskBadge(S){ if (S && !S.none && S.thin) return `<span class="tag" title="Risk scores need a few weeks of trading history">Not enough history yet</span>`; return S && !S.none ? `<span class="tag ${S.riskScore >= 5 ? 'ember' : 'blue'}" title="Risk score from 1 (lowest) to 7, based on how much the value swings">Risk ${S.riskScore} of 7 · ${RISK_WORD(S.riskScore)}</span>` : ''; }

function trackRecord(kind, id){
  const S = statsFor(kind, id);
  if (!S) return '<section class="block"><header><h2>Track record</h2></header><div class="panel loading" style="min-height:120px">Loading…</div></section>';
  if (S.none) return '';
  const heldTxt = S.avgHoldDays != null ? Math.round(S.avgHoldDays) + ' days' : S.openPositionAgeDays != null ? 'Still holding (' + Math.round(S.openPositionAgeDays) + ' days so far)' : '—';
  const period = S.sinceStart ? (kind === 'group' ? 'Since the group started' : 'Since they started') : 'Past year';
  const mo = S.monthly.map(m => { const v = m.ret, bg = v == null ? 'var(--surface-2)' : v >= 0 ? `color-mix(in srgb, var(--gain) ${Math.min(45, 8 + Math.abs(v) * 400)}%, var(--surface))` : `color-mix(in srgb, var(--loss) ${Math.min(45, 8 + Math.abs(v) * 400)}%, var(--surface))`;
    const lab = new Date(m.month + '-15').toLocaleDateString('en-US', { month: 'short' }); return `<div style="background:${bg};border-radius:8px;padding:6px 4px;text-align:center"><div class="small muted">${lab}${m.partial ? '*' : ''}</div><div class="small num"><b>${v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'}</b></div></div>`; }).join('');
  return `<section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2>Track record</h2>${riskBadge(S)}</header>
    <div class="panel" style="padding:18px 20px">
      <div class="kv"><div><span>${period}</span><b class="${sgn(S.totalReturn)}">${pct(S.totalReturn)}</b></div><div><span>Worst drop</span><b class="${S.maxDrawdown < 0 ? 'loss' : ''}">${(S.maxDrawdown * 100).toFixed(1)}%</b></div>
        <div><span>Yearly swings (volatility)</span><b>${(S.volatility * 100).toFixed(1)}%</b></div><div><span>Typical holding time</span><b>${heldTxt}</b></div><div><span>Trades a month</span><b>${S.tradesPerMonth.toFixed(1)}</b></div></div>
      ${S.series && S.series.length > 2 ? ichart('tr:' + kind + ':' + id, S.series, '1y', { h: 120, label: period, aria: 'Track record chart' }) : ''}
      ${S.monthly.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(62px, 1fr));gap:6px;margin-top:14px">${mo}</div>` : ''}
      <p class="hint" style="margin-top:12px">${kind === 'group' ? "The Lead Trader's practice portfolio since the group started. " : 'Practice-money results. '}Rebuilt from every trade over ${S.days} day${S.days === 1 ? '' : 's'}; * marks a partial month. The risk score uses the standard 1 to 7 volatility bands used to rate funds.${S.approximate ? ' Some history is estimated.' : ''} Past results don't predict future returns.</p></div></section>`;
}

function vSecurity(){
  if (!Store.signedIn) return vProfile(null);
  const S = ui.sec || {};
  return `<div class="pagehead"><div>${backLink('#/u/' + Store.myPid, 'Profile')}<h1 style="margin-top:6px">Two-step sign-in</h1><p class="muted">After your password, you'll enter a 6-digit code from an authenticator app.${Store.site.require2fa ? ' Required for brokerage accounts.' : ''}</p></div></div>
  <div class="panel" style="padding:20px;max-width:560px">${Store.twofa ? `<span class="tag blue">On</span><p>Two-step sign-in is on for your account.</p>${backupRow()}${Store.site.require2fa ? '' : '<div class="field"><label for="tf-off">Enter a current code to turn it off</label><input class="input num" id="tf-off" inputmode="numeric" maxlength="6"></div><button class="btn ghost" data-act="tfoff">Turn off</button>'}`
    : S.qr ? `<ol class="small" style="padding-left:18px;margin-top:0"><li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar).</li><li>Scan this code, or enter the key by hand.</li><li>Type the 6-digit code it shows.</li></ol>
      <img src="${S.qr}" alt="QR code for your authenticator app" width="200" height="200" style="display:block;margin:10px 0;border-radius:12px;background:#fff;padding:6px">
      <div class="small muted" style="word-break:break-all">Key: <b class="num">${esc(S.secret)}</b></div>
      <div class="field" style="margin-top:14px"><label for="tf-code">6-digit code</label><input class="input num" id="tf-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><button class="btn" data-act="tfenable">Turn on</button>`
    : '<p>Not set up yet.</p><button class="btn" data-act="tfsetup">Set up two-step sign-in</button>'}</div>`;
}

function personRow(p){
  const pf = Store.get('portfolios', p.id), ret = pf ? Store.portfolioValue(pf) / (pf.startValue || Store.START_CASH) - 1 : 0;
  const f = Store.isFollowing(p.id);
  return `<div class="row">${avatar(p.id)}<div class="grow"><div>${nameLink(p.id)}${sampleTag(p.id)}</div><div class="small muted ellip">${esc(p.bio || '')}</div></div><div class="small num ${sgn(ret)}" style="margin-right:6px">${pct(ret)}</div>${Store.canWrite && Store.get('profiles', Store.myPid) && p.id !== Store.myPid ? `<button class="btn sm ${f ? 'ghost' : ''}" data-act="${f ? 'unfollow' : 'follow'}" data-id="${p.id}">${f ? 'Following' : 'Follow'}</button>` : ''}</div>`;
}

function perfView(gid, role){
  if (!role) return `<div class="panel empty">Join the group to see how your results compare with the Lead Trader's.</div>`;
  if (!Store.isPro()) return `<div class="panel" style="padding:22px"><h2>See how you track your group</h2><p class="muted">Pro compares your copied trades with the Lead Trader's and the S&amp;P 500, trade by trade.</p><button class="btn" data-act="upgrade">See Pro</button></div>`;
  const P = Store.performance(gid); const g = Store.get('groups', gid);
  if (!P || !P.rows.length) return `<div class="panel empty">No group trades since you joined. When ${esc(Store.displayName(g.leadPid))} trades, your results appear here.</div>`;
  const bars = [['Your copies', P.mineAvg, 'var(--ember)'], ["Lead Trader's trades", P.leadAvg, 'var(--blue)'], ['S&P 500', P.spy, 'var(--muted)']];
  const mx = Math.max(0.005, ...bars.map(b => Math.abs(b[1])));
  const TAG = { cancelled:['Cancelled',''], filled:['Copied','blue'], declined:['Declined',''], expired:['Missed',''], pending:['Waiting','ember'], queued:['At open','ember'], 'not sent':['Not sent',''] };
  return `<div class="panel" style="padding:20px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><h2>Since you joined</h2><span class="tag">You copied ${P.copied} of ${P.rows.length} trades</span></div>
    <p class="muted small" style="margin:6px 0 16px">Average return per group trade. Trades you skip count as zero, so gaps from the Lead Trader show up here.</p>
    ${bars.map(([l, v, c]) => `<div style="display:grid;grid-template-columns:150px 1fr 70px;gap:12px;align-items:center;margin:10px 0"><span class="small">${l}</span>
      <div style="height:14px;background:var(--surface-2);border-radius:7px;position:relative;overflow:hidden"><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line)"></div><div style="position:absolute;top:0;bottom:0;${v >= 0 ? 'left:50%' : 'right:50%'};width:${Math.abs(v) / mx * 50}%;background:${c};border-radius:7px"></div></div>
      <b class="num small ${sgn(v)}" style="text-align:right">${pct(v)}</b></div>`).join('')}</div>
  <section class="block"><header><h2>Trade by trade</h2></header><div class="list">${P.rows.map(r => `<div class="row"><div class="grow"><div><span class="sym">${esc(r.p.trade.sym)}</span> <span class="muted small">${r.p.trade.side === 'buy' ? 'Bought' : 'Sold'} ${ago(r.p.ts)} ago at ${usd(r.p.trade.price)}</span></div>
    <div class="small muted">${r.state === 'filled' ? 'Your fill ' + usd(r.req.fillPrice) : 'Lead Trader return ' + pct(r.lead)}</div></div>
    <div class="r"><span class="tag ${TAG[r.state][1]}">${TAG[r.state][0]}</span><div class="small num ${sgn(r.mine ?? 0)}" style="margin-top:4px">${r.mine == null ? '—' : pct(r.mine)}</div></div></div>`).join('')}</div></section>`;
}

function suggestionCards(g, role){
  const sgs = Store.all('suggestions').filter(x => x.gid === g.id && (x.status === 'pending' || (x.pid === Store.myPid && Date.now() - (x.decidedTs || x.ts) < 3 * 86400000))).sort((a, b) => b.ts - a.ts);
  if (!sgs.length || !role) return '';
  return `<section style="margin-bottom:16px"><header class="pagehead" style="margin:0 0 10px"><h3>Trade suggestions</h3></header><div class="list">${sgs.map(x => `<div class="row">${avatar(x.pid, 'sm')}<div class="grow"><div>${nameLink(x.pid)} suggests <b>${x.side === 'buy' ? 'buying' : 'selling'} ${esc(x.sym)}</b> at ${Math.round(x.pct * 1000) / 10}% of the portfolio</div>${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}<div class="small muted">${ago(x.ts)} ago${x.status !== 'pending' ? ' — ' + (x.status === 'approved' ? 'approved and traded' : 'declined') : ''}</div></div>
    ${x.status === 'pending' && Store.canTradeFor(role) && Store.canWrite ? `<button class="btn sm ember" data-act="sgyes" data-id="${x.id}">Approve and trade</button><button class="btn sm ghost" data-act="sgno" data-id="${x.id}">Decline</button>` : x.status === 'pending' ? '<span class="tag">Waiting for the Lead Trader</span>' : ''}</div>`).join('')}</div></section>`;
}

function vProfile(pid){
  if (!pid) return `<div class="panel" style="padding:24px;max-width:520px"><h1>Your profile</h1><p class="muted">Sign in or create a free account to trade, join groups and copy investors.</p><div style="display:flex;gap:10px"><a class="btn" href="#/join">Create a free account</a><button class="btn ghost" data-act="signin">Sign in</button></div></div>`;
  const p = Store.get('profiles', pid);
  if (!p) return pid === Store.myPid && Store.canWrite ? vOnboard() : `<div class="empty">Profile not found.</div>`;
  const pf = Store.get('portfolios', pid), ret = pf ? Store.portfolioValue(pf) / (pf.startValue || Store.START_CASH) - 1 : 0;
  const followers = Store.all('follows').filter(f => f.to === pid).length, following = Store.all('follows').filter(f => f.from === pid).length;
  const groups = Store.all('memberships').filter(m => m.pid === pid).map(m => Store.get('groups', m.gid)).filter(Boolean);
  const posts = Store.all('posts').filter(x => x.pid === pid && !x.groupId).sort((a, b) => b.ts - a.ts);
  const self = pid === Store.myPid, f = Store.isFollowing(pid);
  const top = pf ? Object.entries(pf.positions || {}).map(([s, x]) => ({ s, v: x.shares * Market.price(s) })).sort((a, b) => b.v - a.v).slice(0, 5) : [];
  return `<div class="panel" style="padding:22px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">${avatar(pid, 'lg')}
    <div style="flex:1;min-width:200px"><h1>${esc(Store.displayName(pid))}${self ? ' <span class="muted" style="font-size:16px">(you)</span>' : ''}</h1>
      <p class="muted" style="margin:6px 0 10px">${esc(p.bio || (self ? 'Add a short bio so others know your style.' : ''))}</p>
      ${(() => { const owns = Store.all('groups').some(g => g.ownerPid === pid), leads = Store.all('memberships').some(m => m.pid === pid && m.role === 'lead') || Store.all('groups').some(g => g.leadPid === pid);
        const badges = memberBadges(p, [owns ? { n: 'Group founder', c: 'blue', d: 'Started a group on Pocket.' } : null, leads ? { n: 'Lead Trader', c: 'blue', d: 'Lead Trader of a group.' } : null]);
        return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${badges.map(b => `<button class="tag ${b.c}" data-act="badgeinfo" data-k="${esc(b.n + (b.d ? ': ' + b.d : ''))}" style="cursor:pointer">${esc(b.n)}</button>`).join('')}${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${self && Store.canWrite ? '<button class="linkbtn small" data-act="tags">Edit style tags</button>' : ''}</div>`; })()}
      <div class="small muted" style="margin-bottom:8px">Member since ${new Date(p.createdTs || Date.now()).toLocaleDateString('en-US', { month:'long', year:'numeric' })}</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap" class="small"><span><b class="num">${followers}</b> followers</span><span><b class="num">${following}</b> following</span><span><b class="num">${Store.copiersOf(pid).length}</b> copying</span>${Store.site.realMoney ? '' : `<span class="num ${sgn(ret)}"><b>${pct(ret)}</b> all time</span>`}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${!self && Store.signedIn && !Store.isDemo(pid) ? `<span style="order:9;display:flex;gap:12px;align-items:center">${(Store.get('profiles', pid) || {}).photoV ? `<button class="linkbtn small" data-act="reportphoto" data-id="${pid}">Report photo</button>` : ''}<button class="linkbtn small" data-act="reportsheet" data-k="member" data-id="${pid}">Report member</button><button class="linkbtn small" data-act="${iBlocked(pid) ? 'unblock' : 'block'}" data-id="${pid}">${iBlocked(pid) ? 'Unblock' : 'Block'}</button></span>` : ''}${!self && (Store.get('profiles', pid) || {}).blockedYou ? '<span class="small muted">You can\'t interact with this member.</span>' : ''}${self ? (Store.canWrite ? `<button class="btn ghost sm" data-act="bio">Edit bio</button> <button class="btn ghost sm" data-act="featuredbadges">Badges</button> <button class="btn ghost sm" data-act="photo" data-k="me">${(Store.get('profiles', pid) || {}).photoV ? 'Change photo' : 'Add photo'}</button>` : '') : (Store.canWrite && Store.get('profiles', Store.myPid) ? `<button class="btn sm ${f ? 'ghost' : ''}" data-act="${f ? 'unfollow' : 'follow'}" data-id="${pid}">${f ? 'Following' : 'Follow'}</button>
      <button class="btn sm ${Store.isCopying(pid) ? 'ghost' : 'ember'}" data-act="${Store.isCopying(pid) ? 'uncopy' : 'copy'}" data-id="${pid}">${Store.isCopying(pid) ? 'Stop copying' : 'Copy trades'}</button>
      <button class="btn sm ghost" data-act="copyonce" data-id="${pid}" ${Store.site.realMoney ? 'hidden' : ''}>Copy their portfolio</button>` : '')}</div></div>
  ${!self && Store.isCopying(pid) ? `<div class="banner ember" style="margin-top:16px">You copy ${esc(Store.displayName(pid))}. Each of their trades sends you an approval request sized to your capital.</div>` : ''}
  ${Store.site.realMoney ? '<section class="block"><header><h2>Track record</h2></header><div class="panel empty">Track record starts with your first real trade.</div></section>' : trackRecord('investor', pid)}
  ${self && !Store.site.demoSite ? leaderCard(pid) + referralCard() : ''}
  ${outlookRecordCard(pid)}
  ${self ? securityActivity() + blockedList() : ''}
  ${self ? `<section class="block"><header><h2>Practice tools</h2></header><div class="list">
      <a class="row" href="#/alerts"><div class="grow"><b>Price alerts</b><div class="small muted">Get notified when a stock crosses a price or makes a big move</div></div><span class="muted">›</span></a>
      ${Store.site.realMoney ? '' : `<div class="row"><div class="grow"><b>Start over</b><div class="small muted">Reset your practice account to $100,000. Statements and your track record restart; posts stay.</div></div><button class="btn sm ghost" data-act="startover">Start over</button></div>`}</div></section>` : ''}
  ${self ? `<section class="block"><header><h2>Account</h2></header><div class="list">
    ${Store.accountNumber ? `<div class="row"><div class="grow"><b>Account number</b><div class="small muted">Your practice account</div></div><b class="num">${esc(Store.accountNumber)}</b></div>` : ''}
    <a class="row" href="#/help"><div class="grow"><b>Help</b><div class="small muted">Quick answers about the beta</div></div><span class="muted">›</span></a>
    <a class="row" href="#/statements"><div class="grow"><b>Statements</b><div class="small muted">Monthly, quarterly and yearly statements, or create one for any period</div></div><span class="muted">›</span></a>
    <div class="row"><div class="grow"><b>Plan</b><div class="small muted">${Store.isPro() ? 'Pro, $9.99 a month (simulated)' : 'Free: browse, trade, and observe groups'}</div></div>${Store.canWrite ? (Store.isPro() ? `<button class="btn sm ghost" data-act="cancelpro">Cancel Pro</button>` : `<button class="btn sm" data-act="upgrade">Upgrade to Pro</button>`) : ''}</div>
    <div class="row"><div class="grow"><b>Investing style</b><div class="small muted">Used to suggest groups</div></div>${Store.canWrite ? `<select class="input" style="width:auto;padding:7px 10px;font-size:14px" data-act="setrisk" aria-label="Investing style">${Object.entries(RISK).map(([k, [a]]) => `<option value="${k}" ${p.riskProfile === k ? 'selected' : ''}>${a}</option>`).join('')}</select>` : ''}</div>
    ${Store.site.realMoney ? `<a class="row" href="#/portfolio"><div class="grow"><b>Brokerage account</b><div class="small muted">${ui.real && ui.real.account ? 'Open: see your balance and statements in Portfolio' : 'Not opened yet: open it from Portfolio, starting at $0'}</div></div><span class="muted">›</span></a>` : ''}
    <div class="row" ${Store.site.realMoney ? 'hidden' : ''}><div class="grow"><b>Trading account</b><div class="small muted">${Store.site.realPrices ? 'Practice money, real market prices' : 'Simulated'}, with ${usd(Store.START_CASH, 0)} to start</div></div><span class="tag blue">Active</span></div>
    <div class="row"><div class="grow"><b>Brokerage account</b><div class="small muted">Connect through our broker partner, with identity verification</div></div><button class="btn sm ghost" disabled>Available at launch</button></div>
    ${Store.signedIn && !Store.viewing ? `<a class="row" href="#/settings"><div class="grow"><b>Notifications</b><div class="small muted">Phone alerts, what to notify you about, quiet hours</div></div><span class="small">Open</span></a>
      <div class="row"><div class="grow"><b>Trade history</b><div class="small muted">Download every trade and fill as a spreadsheet</div></div><a class="btn sm ghost" href="/api/export/trades.csv" download>Download CSV</a></div>
      <div class="row"><div class="grow"><b>Password</b></div><button class="btn sm ghost" data-act="chpw">Change password</button></div>
      <div class="row"><div class="grow"><b>Appearance</b><div class="small muted">Auto follows your phone's light or dark setting</div></div><div class="seg" style="flex:none">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button class="${themePref() === k ? 'on' : ''}" data-act="theme" data-k="${k}" aria-pressed="${themePref() === k}">${l}</button>`).join('')}</div></div>
      <a class="row" href="#/security"><div class="grow"><b>Two-step sign-in</b><div class="small muted">${Store.twofa ? 'On' : 'Off'}${Store.site.require2fa ? ', required for your brokerage account' : ''}</div></div><span class="small">${Store.twofa ? 'Manage' : 'Set up'}</span></a>
      <div class="row"><div class="grow"><b>Signed in as ${esc(Store.username || '')}</b></div><button class="btn sm ghost" data-act="signout">Sign out</button></div>
      <div class="row"><div class="grow"><b>Delete account</b><div class="small muted">Removes your profile, posts and activity</div></div><button class="btn sm ghost" data-act="delacct" style="color:var(--loss);border-color:var(--loss)">Delete</button></div>` : ''}
    ${Store.all('copies').filter(c => c.from === pid).map(c => `<div class="row"><div class="grow"><b>Copying ${esc(Store.displayName(c.to))}</b><div class="small muted">Each trade asks for your approval</div></div><button class="btn sm ghost" data-act="copystop" data-id="${c.to}">${c.stopPct ? 'Limit ' + c.stopPct + '%' : 'Protect'}</button> <button class="btn sm ghost" data-act="uncopy" data-id="${c.to}">Stop</button></div>`).join('')}
  </div></section>` : ''}
  ${top.length ? (() => { const tot = Object.entries(pf.positions || {}).reduce((a, [s, x]) => a + x.shares * Market.price(s), 0) || 1; const sec = {};
      Object.entries(pf.positions || {}).forEach(([s, x]) => { const k = SECTOR[s] || 'Other'; sec[k] = (sec[k] || 0) + x.shares * Market.price(s); });
      const parts = Object.entries(sec).sort((a, b) => b[1] - a[1]);
      return `<section class="block"><header><h2>Holdings by sector</h2></header><div class="panel" style="padding:16px 18px"><div class="secbar">${parts.map(([k, v]) => `<div style="width:${v / tot * 100}%;background:${SECTOR_COLOR[k] || '#888'}" title="${esc(k)}"></div>`).join('')}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap" class="small">${parts.map(([k, v]) => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${SECTOR_COLOR[k] || '#888'};margin-right:6px"></span>${esc(k)} ${Math.round(v / tot * 100)}%</span>`).join('')}</div></div></section>
      <section class="block"><header><h2>Top holdings</h2></header><div class="list">${top.map(h => `<a class="row" href="#/stock/${h.s}">${logo(h.s, 'sm')}<div class="grow sym">${h.s}</div><div class="num muted">${(h.v / Store.portfolioValue(pf) * 100).toFixed(1)}% of portfolio</div></a>`).join('')}</div></section>`; })() : ''}
  ${groups.length ? `<section class="block"><header><h2>Groups</h2></header><div class="list">${groups.map(groupRow).join('')}</div></section>` : ''}
  <section class="block"><header><h2>Posts</h2></header><div class="list">${posts.slice(0, ui.feedLimit).map(postCard).join('') || '<div class="empty">No posts yet.</div>'}</div>${posts.length > ui.feedLimit ? '<p style="text-align:center;margin-top:14px"><button class="btn ghost" data-act="more">Show more</button></p>' : ''}</section>`;
}
