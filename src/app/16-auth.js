/* Sign in, sign up and password reset. */

function signupSource(){ try { return JSON.parse(localStorage.getItem('pi_src') || 'null'); } catch(e){ return null; } }

function authSheet(mode){
  if (Store.site.demoSite && mode === 'signup') mode = 'signin';
  if (mode === 'adminsignup') mode = 'signup'; /* the demo's admin-only sign-up; the server allows only ADMIN_USERNAMES */
  const signup = mode === 'signup', reset = mode === 'reset';
  const inviteFromLink = (() => { try { return sessionStorage.getItem('pi_invite_code') || ''; } catch(e){ return ''; } })();
  openModal(`<header><h2>${signup ? 'Create your account' : reset ? 'Reset your password' : 'Sign in'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    ${signup ? `<p class="muted" style="margin-top:0">${Store.site.realMoney ? `After you sign up, you'll open your brokerage account and add money when you're ready. Your account starts at $0.` : `You'll start with ${usd(Store.START_CASH, 0)} in simulated cash. No real money is involved.`}</p>
      <div class="field"><label for="a-n">Your name</label><input class="input" id="a-n" maxlength="40" autocomplete="name" placeholder="How others will see you"></div>` : ''}
    ${reset ? '<p class="muted" style="margin-top:0">Ask the Pocket team for a reset code, then choose a new password.</p>' : ''}
    <div class="field"><label for="a-u">Username</label><input class="input" id="a-u" maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    ${reset ? '<div class="field"><label for="a-c">Reset code</label><input class="input" id="a-c" maxlength="12" autocapitalize="characters" spellcheck="false"></div>' : ''}
    <div class="field"><label for="a-p">${reset ? 'New password' : 'Password'}</label><input class="input" id="a-p" type="password" autocomplete="${signup || reset ? 'new-password' : 'current-password'}">${signup || reset ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
    ${signup && Store.inviteOnly && ui.inviteFor && Store.get('groups', ui.inviteFor) ? `<div class="est" style="display:block;margin-bottom:14px"><b>You're invited to ${esc(Store.get('groups', ui.inviteFor).name)}</b><div class="small muted" style="margin-top:4px">Your invite link gets you into the beta. No code needed.</div></div>` : ''}
    ${signup && Store.inviteOnly && !ui.inviteFor ? `<div class="field"><label for="a-i">Invite code</label><input class="input" id="a-i" maxlength="16" autocapitalize="characters" spellcheck="false" value="${esc(inviteFromLink)}"><span class="hint">The beta is invite only.</span></div>` : ''}
    ${signup ? '<div class="field"><label style="display:flex;gap:10px;align-items:flex-start;font-weight:500"><input type="checkbox" id="a-18" style="margin-top:4px"> <span>I\'m 18 or older.</span></label></div>' : ''}${signup ? '<div class="field"><label style="display:flex;gap:10px;align-items:flex-start;font-weight:500"><input type="checkbox" id="a-t" style="margin-top:4px"> <span>I agree to the <a href="#/terms" target="_blank">Terms</a> and <a href="#/privacy" target="_blank">Privacy Policy</a>, and understand ' + (Store.site.realMoney ? 'practice portfolios use simulated money' : 'Pocket Investing uses simulated money during the beta') + '.</span></label></div>' : ''}
    ${!signup && !reset ? '<div class="field" id="a-2fa-f" style="display:none"><label for="a-2fa">6-digit code from your authenticator app</label><input class="input num" id="a-2fa" autocomplete="one-time-code" maxlength="9" autocapitalize="characters" spellcheck="false"><div class="hint">Lost your phone? Enter one of your backup codes instead.</div></div>' : ''}
    <div class="hint" id="a-err" style="color:var(--loss);min-height:1.2em;margin-bottom:8px"></div>
    <button class="btn" id="a-go" style="width:100%">${signup ? 'Create account' : reset ? 'Set new password' : 'Sign in'}</button>
    <p class="small" style="text-align:center;margin-top:12px">${signup ? 'Already have an account? <button class="linkbtn" data-sw="login">Sign in</button>' : reset ? '<button class="linkbtn" data-sw="login">Back to sign in</button>' : (Store.site.demoSite ? 'The demo doesn\'t create accounts. <a href="https://www.pocketinvesting.com/#invite">Request an invite</a> to the beta.<br><button class="linkbtn small" data-sw="adminsignup">Pocket team sign-up</button><br>' : 'New here? <button class="linkbtn" data-sw="signup">Create an account</button><br>') + '<button class="linkbtn" data-sw="reset">Forgot your password?</button>'}</p>`, sh => {
    const v = id => (sh.querySelector('#' + id) || {}).value || '';
    const go = async () => {
      const b = sh.querySelector('#a-go'); b.disabled = true; sh.querySelector('#a-err').textContent = '';
      try {
        if (signup) await Store.signupFull({ username: v('a-u'), password: v('a-p'), name: v('a-n'), risk: ui.risk, invite: v('a-i'), terms: sh.querySelector('#a-t').checked, adult: sh.querySelector('#a-18').checked, groupInvite: ui.inviteFor ? ui.inviteCode : undefined, source: signupSource() });
        else if (reset) await Store.resetPassword(v('a-u'), v('a-c'), v('a-p'));
        else await Store.login(v('a-u'), v('a-p'), v('a-2fa'));
        closeModal(); ui.seenReqs = null; toast(signup ? (Store.site.realMoney ? 'You\'re signed up. Next, open your brokerage account from Portfolio.' : `Your account is ready with $100,000 in practice ${Store.site.realPrices ? 'money' : 'cash'}.`) : reset ? 'Password updated. You are signed in.' : 'Welcome back.');
        const back = (() => { try { return sessionStorage.getItem('pi_after_auth'); } catch(e){ return null; } })();
        try { sessionStorage.removeItem('pi_after_auth'); } catch(e){}
        location.hash = back || '#/home'; render();
      } catch(e){ b.disabled = false; sh.querySelector('#a-err').textContent = e.userFacing ? e.message : 'Something went wrong. Try again.';
        if (e.locked){ sh.querySelector('#a-err').insertAdjacentHTML('beforeend', ' <button class="linkbtn" id="a-unlock">Request unlock</button>'); sh.querySelector('#a-unlock').onclick = () => unlockSheet(v('a-u')); } if (e.need2fa && sh.querySelector('#a-2fa-f')){ sh.querySelector('#a-2fa-f').style.display = ''; sh.querySelector('#a-2fa').focus(); } }
    };
    sh.querySelector('#a-go').onclick = go;
    sh.querySelectorAll('input:not([type=checkbox])').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
    sh.querySelectorAll('[data-sw]').forEach(a => a.onclick = e => { e.preventDefault(); authSheet(a.dataset.sw); });
  });
}

/* Cloudflare Turnstile bot check: shown only when the site has its keys. Resolves to a function that returns the token. */
let turnstileLoad = null;
function botCheck(el){
  const key = Store.site && Store.site.turnstileSite; if (!key || !el) return Promise.resolve(() => null);
  turnstileLoad = turnstileLoad || new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = () => ok(); s.onerror = () => { turnstileLoad = null; no(new Error('Bot check could not load')); }; document.head.appendChild(s); });
  return turnstileLoad.then(() => { const id = window.turnstile.render(el, { sitekey: key, theme: 'auto' }); return () => window.turnstile.getResponse(id) || null; }, () => () => null);
}
/* Locked accounts: a request to the Pocket team, sent without signing in. */
function unlockSheet(username){
  openModal(`<header><h2>Request an unlock</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Your account was locked after repeated wrong passwords or codes. The Pocket team will contact you to confirm it's really you, then unlock it.</p>
    <div class="field"><label for="ul-u">Username</label><input class="input" id="ul-u" maxlength="24" autocapitalize="none" spellcheck="false" value="${esc(username || '')}"></div>
    <div class="field"><label for="ul-c">Email or phone we can reach you at</label><input class="input" id="ul-c" maxlength="200" autocomplete="email"></div>
    <div class="field"><label for="ul-n">Anything we should know? <span class="muted">(optional)</span></label><textarea class="input" id="ul-n" rows="3" maxlength="1000"></textarea></div>
    <div id="ul-bot" style="margin-bottom:10px"></div>
    <div class="hint" id="ul-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="ul-go" style="width:100%">Send request</button>`, sh => {
    let token = () => null; botCheck(sh.querySelector('#ul-bot')).then(f => { token = f; });
    sh.querySelector('#ul-go').onclick = async () => { const b = sh.querySelector('#ul-go'); b.disabled = true; sh.querySelector('#ul-e').textContent = '';
      try { const r = await fetch('/api/unlock-request', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: sh.querySelector('#ul-u').value, contact: sh.querySelector('#ul-c').value, note: sh.querySelector('#ul-n').value, botToken: token() }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
        closeModal(); toast(j.message || 'Request sent.'); }
      catch(e){ sh.querySelector('#ul-e').textContent = e.message; b.disabled = false; if (window.turnstile) try { window.turnstile.reset(); } catch(x){} } };
  });
}
