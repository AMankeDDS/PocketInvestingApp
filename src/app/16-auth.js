/* Sign in, sign up and password reset. */

function signupSource(){ try { return JSON.parse(localStorage.getItem('pi_src') || 'null'); } catch(e){ return null; } }

function authSheet(mode){
  if (Store.site.demoSite && mode === 'signup') mode = 'signin';
  const signup = mode === 'signup', reset = mode === 'reset';
  const inviteFromLink = (() => { try { return sessionStorage.getItem('pi_invite_code') || ''; } catch(e){ return ''; } })();
  openModal(`<header><h2>${signup ? 'Create your account' : reset ? 'Reset your password' : 'Sign in'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    ${signup ? `<p class="muted" style="margin-top:0">${Store.site.realMoney ? `You'll start with a ${usd(Store.START_CASH, 0)} practice portfolio. You can open a real brokerage account whenever you're ready.` : `You'll start with ${usd(Store.START_CASH, 0)} in simulated cash. No real money is involved.`}</p>
      <div class="field"><label for="a-n">Your name</label><input class="input" id="a-n" maxlength="40" autocomplete="name" placeholder="How others will see you"></div>` : ''}
    ${reset ? '<p class="muted" style="margin-top:0">Ask the Pocket team for a reset code, then choose a new password.</p>' : ''}
    <div class="field"><label for="a-u">Username</label><input class="input" id="a-u" maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    ${reset ? '<div class="field"><label for="a-c">Reset code</label><input class="input" id="a-c" maxlength="12" autocapitalize="characters" spellcheck="false"></div>' : ''}
    <div class="field"><label for="a-p">${reset ? 'New password' : 'Password'}</label><input class="input" id="a-p" type="password" autocomplete="${signup || reset ? 'new-password' : 'current-password'}">${signup || reset ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
    ${signup && Store.inviteOnly && ui.inviteFor && Store.get('groups', ui.inviteFor) ? `<div class="est" style="display:block;margin-bottom:14px"><b>You're invited to ${esc(Store.get('groups', ui.inviteFor).name)}</b><div class="small muted" style="margin-top:4px">Your invite link gets you into the beta. No code needed.</div></div>` : ''}
    ${signup && Store.inviteOnly && !ui.inviteFor ? `<div class="field"><label for="a-i">Invite code</label><input class="input" id="a-i" maxlength="16" autocapitalize="characters" spellcheck="false" value="${esc(inviteFromLink)}"><span class="hint">The beta is invite only.</span></div>` : ''}
    ${signup ? '<div class="field"><label style="display:flex;gap:10px;align-items:flex-start;font-weight:500"><input type="checkbox" id="a-t" style="margin-top:4px"> <span>I agree to the <a href="#/terms" target="_blank">Terms</a> and <a href="#/privacy" target="_blank">Privacy Policy</a>, and understand ' + (Store.site.realMoney ? 'practice portfolios use simulated money' : 'Pocket Investing uses simulated money during the beta') + '.</span></label></div>' : ''}
    ${!signup && !reset ? '<div class="field" id="a-2fa-f" style="display:none"><label for="a-2fa">6-digit code from your authenticator app</label><input class="input num" id="a-2fa" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>' : ''}
    <div class="hint" id="a-err" style="color:var(--loss);min-height:1.2em;margin-bottom:8px"></div>
    <button class="btn" id="a-go" style="width:100%">${signup ? 'Create account' : reset ? 'Set new password' : 'Sign in'}</button>
    <p class="small" style="text-align:center;margin-top:12px">${signup ? 'Already have an account? <button class="linkbtn" data-sw="login">Sign in</button>' : reset ? '<button class="linkbtn" data-sw="login">Back to sign in</button>' : (Store.site.demoSite ? 'The demo doesn\'t create accounts. <a href="https://www.pocketinvesting.com/#invite">Request an invite</a> to the beta.<br>' : 'New here? <button class="linkbtn" data-sw="signup">Create an account</button><br>') + '<button class="linkbtn" data-sw="reset">Forgot your password?</button>'}</p>`, sh => {
    const v = id => (sh.querySelector('#' + id) || {}).value || '';
    const go = async () => {
      const b = sh.querySelector('#a-go'); b.disabled = true; sh.querySelector('#a-err').textContent = '';
      try {
        if (signup) await Store.signupFull({ username: v('a-u'), password: v('a-p'), name: v('a-n'), risk: ui.risk, invite: v('a-i'), terms: sh.querySelector('#a-t').checked, groupInvite: ui.inviteFor ? ui.inviteCode : undefined, source: signupSource() });
        else if (reset) await Store.resetPassword(v('a-u'), v('a-c'), v('a-p'));
        else await Store.login(v('a-u'), v('a-p'), v('a-2fa'));
        closeModal(); ui.seenReqs = null; toast(signup ? 'Your account is ready with $100,000 in simulated cash.' : reset ? 'Password updated. You are signed in.' : 'Welcome back.');
        const back = (() => { try { return sessionStorage.getItem('pi_after_auth'); } catch(e){ return null; } })();
        try { sessionStorage.removeItem('pi_after_auth'); } catch(e){}
        location.hash = back || '#/home'; render();
      } catch(e){ b.disabled = false; sh.querySelector('#a-err').textContent = e.userFacing ? e.message : 'Something went wrong. Try again.'; if (e.need2fa && sh.querySelector('#a-2fa-f')){ sh.querySelector('#a-2fa-f').style.display = ''; sh.querySelector('#a-2fa').focus(); } }
    };
    sh.querySelector('#a-go').onclick = go;
    sh.querySelectorAll('input:not([type=checkbox])').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
    sh.querySelectorAll('[data-sw]').forEach(a => a.onclick = e => { e.preventDefault(); authSheet(a.dataset.sw); });
  });
}
