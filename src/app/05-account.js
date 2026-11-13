/* Account sheets: password, profile details, tags, upgrade and delete. */

function tagsSheet(){
  const cur = (Store.get('profiles', Store.myPid) || {}).tags || [];
  const ALL = ['Growth','Dividends','Value','Index','Tech','Consumer brands','Long-term','Active','Learning','Income','ETFs'];
  openModal(`<header><h2>Your style tags</h2><button class="x" data-close aria-label="Close">×</button></header><p class="muted" style="margin-top:0">Pick up to three. They show on your profile and help others find you.</p>
    <div class="chips">${ALL.map(t => `<label style="display:inline-flex;gap:6px;align-items:center;margin:0 12px 8px 0"><input type="checkbox" class="tg" value="${t}" ${cur.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <button class="btn" id="tg-go" style="width:100%">Save</button>`, sh => {
    sh.querySelector('#tg-go').onclick = async () => { const tags = $$('.tg', sh).filter(c => c.checked).map(c => c.value); if (tags.length > 3) return toast('Pick up to three tags.'); try { await Store.setTags(tags); closeModal(); toast('Tags saved.'); } catch(e){ errToast(e); } };
  });
}

function wireWouldPay(sh){ let v = null; sh.querySelectorAll('[data-wpk]').forEach(b => b.onclick = () => { v = b.dataset.wpk; sh.querySelectorAll('[data-wpk]').forEach(x => x.classList.toggle('on', x === b)); }); return () => v; }

function upgradeSheet(then){
  openModal(`<header><h2>Pocket Investing Pro</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Everything in Free, plus the features that let you invest alongside others.</p>
    <div class="list" style="margin:14px 0">
      ${[['Join groups as a full member','Vote on proposals and copy the Lead Trader'],['Copy individual investors','Each of their trades asks for your approval'],['Performance vs your group','See how your copies track the Lead Trader and the S&P 500'],['Advanced analytics','Coming with the native app']].map(([a, b]) => `<div class="row"><div class="grow"><b>${a}</b><div class="small muted">${b}</div></div></div>`).join('')}
    </div>
    <div class="est"><span>$9.99 a month, or $99 a year</span><b class="num">Free plan stays free</b></div>
    ${ui.tour == null && Store.canWrite ? wouldPayHTML() : ''}${ui.tour != null || !Store.canWrite ? `<div class="why-not" id="u-why">${ui.tour != null ? "Starting Pro is turned off during the tour, so nothing changes in the demo." : "You're viewing the app as another member. Switch back to your own account to start Pro."}</div>` : ''}<button class="btn" id="u-go" style="width:100%" ${ui.tour != null || !Store.canWrite ? 'disabled aria-describedby="u-why"' : ''}>Start Pro</button>
    <p class="hint" style="text-align:center;margin-top:10px">Simulated subscription for this demo. Nothing is charged.</p>`, sh => {
    const wp = wireWouldPay(sh);
    sh.querySelector('#u-go').onclick = async () => { try { await Store.upgradePro(wp()); closeModal(); toast("You're on Pro."); if (then) await then(); } catch(e){ errToast(e); } };
  });
}

function pwSheet(){
  openModal(`<header><h2>Change password</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="pw-c">Current password</label><input class="input" id="pw-c" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="pw-n">New password</label><input class="input" id="pw-n" type="password" autocomplete="new-password"><span class="hint">At least 8 characters. Other devices will be signed out.</span></div>
    <div class="hint" id="pw-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="pw-go" style="width:100%">Update password</button>`, sh => {
    sh.querySelector('#pw-go').onclick = async () => { try { await Store.changePassword(sh.querySelector('#pw-c').value, sh.querySelector('#pw-n').value); closeModal(); toast('Password updated.'); } catch(e){ sh.querySelector('#pw-e').textContent = e.userFacing ? e.message : 'Something went wrong.'; } };
  });
}

function deleteSheet(){
  const real = Store.site.realMoney;
  openModal(`<header><h2>Delete your account</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p>This permanently removes your profile, portfolio, posts, votes and activity. If you own a group with other members, transfer ownership first.</p>
    ${real ? '<div class="banner text" style="margin-bottom:12px;font-size:14px"><b>Brokerage account.</b> Sell your holdings and withdraw your full balance first. Deleting then closes your brokerage account; the broker keeps the records the law requires.</div>' : ''}
    <div class="field"><label for="del-p">Your password</label><input class="input" id="del-p" type="password" autocomplete="current-password"></div>
    ${Store.twofa ? '<div class="field"><label for="del-c">Code from your authenticator app</label><input class="input num" id="del-c" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>' : ''}
    <div class="field"><label for="del-t">Type DELETE to confirm</label><input class="input" id="del-t" autocomplete="off" autocapitalize="characters"></div>
    <label style="display:flex;gap:10px;align-items:flex-start;margin:0 0 12px"><input type="checkbox" id="del-k" style="margin-top:4px"><span>I understand this can't be undone.</span></label>
    <div class="hint" id="del-e" style="color:var(--loss);min-height:1.2em"></div><button class="btn" id="del-go" style="width:100%;background:var(--loss)" disabled>Delete my account</button>`, sh => {
    const q = id => sh.querySelector('#' + id), go = q('del-go');
    const upd = () => { go.disabled = !(q('del-p').value && q('del-t').value.trim() === 'DELETE' && q('del-k').checked && (!q('del-c') || /^\d{6}$/.test(q('del-c').value.trim()))); };
    ['del-p', 'del-t', 'del-c'].forEach(id => { if (q(id)) q(id).oninput = upd; }); q('del-k').onchange = upd;
    go.onclick = async () => { go.disabled = true; q('del-e').textContent = '';
      try { await Store.http('POST', '/api/delete-account', { password: q('del-p').value, code: q('del-c') ? q('del-c').value.trim() : undefined, confirm: q('del-t').value.trim() }); closeModal(); toast('Your account has been deleted.'); setTimeout(() => location.reload(), 800); }
      catch(e){ q('del-e').textContent = e.message; upd(); } };
  });
}

function bioSheet(){
  const p = Store.get('profiles', Store.myPid) || {};
  openModal(`<header><h2>Edit bio</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="b-t">Bio</label><textarea class="input" id="b-t" maxlength="200">${esc(p.bio || '')}</textarea></div><button class="btn" id="b-go" style="width:100%">Save bio</button>`, sh => {
    sh.querySelector('#b-go').onclick = async () => { try { await Store.updateBio(sh.querySelector('#b-t').value); closeModal(); toast('Bio saved.'); } catch(e){ errToast(e); } };
  });
}
