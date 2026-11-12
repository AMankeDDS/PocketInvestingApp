/* Onboarding, the getting-started checklist, Help and legal pages. */

/* ---------- help ---------- */
function vHelp(){
  const Q = [
    ['Is this real money?', Store.site.realMoney ? 'Your practice account uses simulated money. Your real-money account is held at our brokerage partner, and every real trade and transfer is shown separately.' : 'No. The beta uses practice money, so you can try everything with nothing at risk.'],
    ['Will anyone trade in my account?', "No. When someone you copy or your group's Lead Trader trades, you get a request sized to your account. Nothing happens until you approve it."],
    ['How do groups work?', 'Groups have roles, proposals and votes. Join one from Groups, or start your own from a template. Members approve each copied trade; a pooled club trades its shared account only by member vote.'],
    ['What are club books and statements?', 'Clubs can track dues, withdrawals and valuations with unit values, run meetings, and send members monthly statements. Find them on the Club books tab of a group, and your statements in Profile, Statements.'],
    ['How do I protect my account?', 'Turn on two-step sign-in in your Profile. It adds a code from an authenticator app when you sign in, and it is required for club officers and real-money withdrawals.'],
    ['I found a problem or have an idea', 'Use the Feedback button on any screen. It sends your note straight to the Pocket team, with the page you were on.']
  ];
  return `<div class="pagehead"><div><h1>Help</h1><p class="muted">Quick answers about the beta.</p></div></div>
    <div class="list">${Q.map(([q, a]) => `<details class="row" style="display:block"><summary style="cursor:pointer;font-weight:600">${esc(q)}</summary><p class="muted" style="margin:8px 0 0">${esc(a)}</p></details>`).join('')}</div>
    <p class="hint" style="margin-top:16px">Still stuck? Email <a href="mailto:admin@pocketinvesting.com">admin@pocketinvesting.com</a>. See also the <a href="#/terms">Terms of use</a> and <a href="#/privacy">Privacy policy</a>.</p>`;
}

/* ---------- getting started checklist (beta testers) ---------- */
function gettingStarted(){
  if (!Store.signedIn || !Store.canWrite) return '';
  let off = ''; try { off = localStorage.getItem('pi_onb_off') || ''; } catch(e){}
  if (off === Store.myPid) return '';
  const p = Store.get('profiles', Store.myPid) || {}, me = Store.myPid;
  const items = [['Add a short bio to your profile', !!(p.bio && p.bio.trim()), '#/u/' + me], Store.site.realMoney ? ['Open your brokerage account and make a first trade', !!(ui.real && ui.real.orders && ui.real.orders.length), '#/portfolio'] : ['Make a practice trade', Store.all('trades').some(t => t.pid === me), '#/markets'],
    ['Follow an investor', Store.all('follows').some(f => f.from === me), '#/discover'], ['Join or start a group', Store.myGroups().length > 0, '#/groups'], ['Turn on two-step sign-in', Store.twofa, '#/u/' + me]];
  const done = items.filter(i => i[1]).length; if (done === items.length) return '';
  return `<section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Getting started</h2><span class="small muted">${done} of ${items.length} done · <button class="linkbtn small" data-act="onboff">Hide</button></span></header>
    <div class="list">${items.map(([t, ok, href]) => `<a class="row" href="${href}"><span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;${ok ? 'background:var(--gain);color:#fff' : 'border:1.5px solid var(--line)'}">${ok ? '✓' : ''}</span><div class="grow" style="${ok ? 'color:var(--muted);text-decoration:line-through' : ''}">${t}</div></a>`).join('')}</div>
    <p class="hint">Questions? See <a href="#/help">Help</a>.</p></section>`;
}

function securityActivity(){
  if (!ui.secEv){ ui.secEv = 'loading'; Store.http('GET', '/api/security-events').then(r => { ui.secEv = r.events; render(); }, () => { ui.secEv = []; }); }
  const E = Array.isArray(ui.secEv) ? ui.secEv : []; if (!E.length) return '';
  const W = { 'sign-in': 'Signed in', password: 'Password', 'two-step': 'Two-step sign-in', lockout: 'Sign-in paused' };
  return `<section class="block"><header><h2>Recent security activity</h2></header><div class="list">${E.slice(0, 8).map(e => `<div class="row"><div class="grow"><b>${esc(W[e.kind] || e.kind)}</b> <span class="small muted">${esc(e.detail || '')}</span></div><span class="small muted">${ago(new Date(e.ts).getTime())} ago</span></div>`).join('')}</div>
    <p class="hint">Don't recognize something? Change your password, which signs out every other device.</p></section>`;
}


/* ---------- views ---------- */
function vOnboard(){
  const steps = [
    { h:'Invest on your own, or together.', p:`Trade, follow investors, and join groups where members vote on strategy and copy the Lead Trader's trades. You start with ${usd(Store.START_CASH, 0)} in simulated cash.` },
    { h:'Nothing trades without your approval.', p:'When a Lead Trader or an investor you copy makes a trade, you get a request sized to your own capital. You have 30 minutes to approve or decline. Late-day trades can be bought at the next open.' },
    { h:'How do you like to invest?', p:'We use this to suggest groups that fit your style. You can change it any time.' },
    { h:'Practice first. Real money at launch.', p:'Everything here runs in simulated mode. At launch you connect a brokerage account through our registered broker partner, which holds your money and verifies your identity.' }
  ];
  const i = Math.min(ui.onb, steps.length - 1), s = steps[i];
  return `<div class="panel" style="padding:28px;max-width:580px">
    <div class="mark" style="width:48px;height:48px;font-size:22px;border-radius:14px">P</div>
    <div class="small muted" style="margin-top:18px">Step ${i + 1} of ${steps.length}</div>
    <h1 style="margin-top:6px">${s.h}</h1><p class="muted">${s.p}</p>
    ${i === 2 ? `<div class="list" style="margin:16px 0">${Object.entries(RISK).map(([k, [a, b]]) => `<button class="row" data-act="risk" data-k="${k}" style="width:100%;text-align:left;border:0;border-top:1px solid var(--line);background:${ui.risk === k ? 'var(--blue-soft)' : 'transparent'}" aria-pressed="${ui.risk === k}"><div class="grow"><b>${a}</b><div class="small muted">${b}</div></div>${ui.risk === k ? '<span class="tag blue">Selected</span>' : ''}</button>`).join('')}</div>` : ''}
    ${i === 3 ? `<div class="list" style="margin:16px 0"><div class="row"><div class="grow"><b>Simulated account</b><div class="small muted">${usd(Store.START_CASH, 0)} to practice with</div></div><span class="tag blue">Ready</span></div>
      <div class="row"><div class="grow"><b>Brokerage account</b><div class="small muted">Held by our broker partner, with identity verification</div></div><button class="btn sm ghost" disabled>Available at launch</button></div></div>` : ''}
    <div style="display:flex;gap:10px;margin-top:8px">${i > 0 ? `<button class="btn ghost" data-act="onb" data-k="${i - 1}">Back</button>` : ''}
    ${i < steps.length - 1 ? `<button class="btn" data-act="onb" data-k="${i + 1}">Next</button>` : `<button class="btn" data-act="start">Create my account</button>`}</div>
    <p class="small" style="margin-top:14px">Already have an account? <button class="linkbtn" data-act="signin">Sign in</button></p>
    <p class="hint" style="margin-top:14px">Prices are simulated for this demo. No real money is involved.</p></div>`;
}

function starterCard(prof, groups){
  let off = false; try { off = localStorage.getItem('pi_starter_off') === '1'; } catch(e){}
  const me = Store.myPid, following = Store.all('follows').filter(f => f.from === me).map(f => f.to);
  const watch = prof.watchlist || [];
  if (off || !Store.canWrite || (following.length && groups.length && watch.length)) return '';
  const style = prof.riskProfile || 'balanced';
  const tagFor = { conservative:['Index','Long-term','Value'], balanced:['Index','Value','Long-term'], growth:['Growth','Tech'], dividends:['Dividends','Income','Long-term'] }[style];
  const people = Store.all('profiles').filter(p => p.id !== me && !following.includes(p.id)).map(p => ({ p, f: Store.all('follows').filter(x => x.to === p.id).length + ((p.tags || []).some(t => tagFor.includes(t)) ? 3 : 0) })).sort((a, b) => b.f - a.f).slice(0, 3).map(x => x.p);
  const g = groups.length ? null : Store.all('groups').filter(x => !Store.rulesOf(x).hidden && (x.riskLevel === style || (style === 'dividends' && divHeavy(x.leadPid))) && Store.rulesOf(x).joinMode === 'open').sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))[0];
  const syms = STYLE_WATCH[style].filter(sym => !watch.includes(sym));
  return `<section class="panel" style="padding:18px 20px;margin-bottom:18px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Picks for you</h2><button class="linkbtn small" data-act="starteroff">Hide</button></div>
    <p class="muted small" style="margin:4px 0 12px">A few picks to fill your feed, based on your ${esc(RISK[style][0].toLowerCase())} style.</p>
    ${people.length && !following.length ? `<div class="small muted" style="margin:0 0 6px">Investors to follow</div><div class="list" style="margin-bottom:12px">${people.map(personRow).join('')}</div>` : ''}
    ${g ? `<div class="small muted" style="margin:0 0 6px">A group to try</div><div class="list" style="margin-bottom:12px">${groupRow(g)}</div>` : ''}
    ${syms.length && !watch.length ? `<div class="small muted" style="margin:0 0 6px">Stocks to watch</div><div class="list">${syms.map(sym => stockRow(sym, `<button class="btn sm" data-act="watch" data-k="${sym}">Watch</button>`)).join('')}</div>` : ''}
  </section>`;
}

function explainerCard(){
  let done = []; try { done = JSON.parse(localStorage.getItem('pi_explain_off') || '[]'); } catch(e){}
  const left = EXPLAINERS.filter(x => !done.includes(x[0])); if (!left.length) return '';
  const x = left[Math.floor(Date.now() / 86400000) % left.length];
  return `<section class="block"><div class="panel" style="padding:16px 18px;display:flex;gap:14px;align-items:flex-start"><span class="avatar" style="background:var(--blue-soft);color:var(--blue);border-radius:12px">?</span>
    <div style="flex:1"><b>${esc(x[1])}</b><div class="small" style="margin-top:4px">${esc(x[2])}</div></div><button class="linkbtn small" data-act="explainoff" data-k="${x[0]}">Got it</button></div></section>`;
}

function showInstallTip(){
  let off = false; try { off = localStorage.getItem('pi_install_tip') === 'off'; } catch(e){}
  const mobile = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  let visits = 0; try { visits = +localStorage.getItem('pi_visits') || 0; } catch(e){}
  if (off || !mobile || standalone || visits < 2) return '';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  return `<div class="banner" style="margin-bottom:16px"><div style="flex:1"><b>Keep Pocket on your home screen</b><div class="small">${ios ? 'Tap Share, then Add to Home Screen.' : 'Open your browser menu, then Add to Home screen.'} It opens with one tap during meetings.</div></div><button class="btn sm ghost" data-act="tipoff">Got it</button></div>`;
}

function vLegal(kind){
  const terms = kind === 'terms';
  return `<div class="panel" style="padding:24px;max-width:720px"><span class="tag ember">Draft for the beta. Final version to come from counsel.</span>
    <h1 style="margin-top:14px">${terms ? 'Terms of use' : 'Privacy policy'}</h1>
    ${terms ? `<p>Pocket Investing is in a private beta. All money, prices and returns in the app are simulated. Nothing in the app is investment advice or a recommendation to buy or sell any security.</p>
      <p>Trades shown by other members, Lead Traders and groups reflect their own practice activity. Copying a trade doesn't guarantee the same price or result, and past simulated results don't predict future results.</p>
      <p>Be respectful. Don't post anything unlawful, misleading or promotional, and don't coordinate trading to move a price. We may remove content or turn off accounts that break these rules.</p>
      <p>The beta is provided as is. Features may change or be removed, and data may be reset.</p>`
    : `<p>We collect what you give us (your name, username and password, which is stored hashed), what you do in the app (posts, votes, simulated trades and settings), basic usage events so we can improve the product, and technical details when something goes wrong.</p>
      <p>Other members can see your name, posts, group activity and simulated portfolio returns. We don't sell your information or show you ads.</p>
      <p>You can download your trade history and delete your account at any time from your profile. Deleting your account removes your profile, posts and activity.</p>
      <p>If you turn on notifications, your device's push address is stored so we can send alerts. You can turn them off in Settings.</p>`}
    <p class="hint">Questions: contact the Pocket Investing team.</p></div>`;
}
