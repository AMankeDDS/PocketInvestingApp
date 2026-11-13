/* Real-money accounts on the broker (opening, transfers, orders, documents). */

function loadReal(){ if (ui.realLoading) return; ui.realLoading = true; Store.real.summary().then(r => { ui.real = r; ui.realTs = Date.now(); }, e => { ui.real = { error: e.userFacing ? e.message : "Couldn't load your account." }; }).finally(() => { ui.realLoading = false; render(); }); }

function brokerLine(){ return `<p class="hint" style="margin-top:22px">Brokerage services are provided by Alpaca Securities LLC, member FINRA/SIPC. ${ui.real && ui.real.alpacaEnv === 'sandbox' ? '<b>Test environment: no real money moves.</b> ' : ''}Investing involves risk, including loss of principal. <span class="muted">[Final wording to be confirmed with Alpaca and counsel.]</span></p>`; }

function vReal(){
  const R = ui.real;
  if (!R){ loadReal(); return '<div class="loading" style="min-height:30vh">Loading your account…</div>'; }
  if (R.error) return `<div class="panel empty">${esc(R.error)} <button class="linkbtn" data-act="realrefresh">Try again</button></div>`;
  const env = R.alpacaEnv === 'sandbox' ? '<div class="banner text" style="margin-bottom:14px"><b>Test environment.</b>&nbsp;Accounts, deposits and orders here are simulated by the brokerage. No real money moves.</div>' : '';
  if (R.require2fa && !R.twofa) return env + `<div class="panel" style="padding:24px"><h2>Turn on two-step sign-in first</h2><p class="muted">Real-money accounts need a second step when you sign in: a 6-digit code from an authenticator app such as Google Authenticator or 1Password.</p><a class="btn" href="#/security">Set up two-step sign-in</a></div>`;
  if (!R.account) return env + `<div class="panel" style="padding:24px"><h2>Open your brokerage account</h2><p class="muted">It takes about five minutes. Your account is held at our brokerage partner, Alpaca, and you approve every trade that touches it. You'll need your Social Security number and address.</p><a class="btn" href="#/open">Open an account</a></div>${brokerLine()}`;
  if (R.account.status !== 'ACTIVE'){
    const msg = { REJECTED:"The brokerage couldn't approve this application. Contact the Pocket team and we'll help you understand why.", ACTION_REQUIRED:'The brokerage needs more information. Contact the Pocket team and we will help.', DISABLED:'This account is disabled. Contact the Pocket team.', ACCOUNT_CLOSED:'This account is closed.' }[R.account.status] || "Your application is being reviewed. Most are approved within a few minutes; some take a business day. We'll update this screen automatically.";
    return env + `<div class="panel" style="padding:24px"><span class="tag ${R.account.status === 'REJECTED' ? '' : 'ember'}">${esc(R.account.label)}</span><h2 style="margin-top:12px">Brokerage account</h2><p class="muted">${msg}</p><button class="btn ghost sm" data-act="realrefresh">Refresh</button></div>${brokerLine()}`;
  }
  const B = R.balances, dayCh = B.lastEquity ? B.equity / B.lastEquity - 1 : 0, bank = (R.banks || [])[0];
  const openOrders = R.orders.filter(o => ROPEN.includes(o.status));
  const inst = R.instant || {};
  return env + realCopySection() + `${R.paused ? '<div class="banner ember" style="margin-bottom:14px">Real-money trading is paused right now. Deposits and withdrawals still work.</div>' : ''}
  <div class="panel hero" style="border-color:color-mix(in srgb, var(--blue) 40%, var(--line))"><div style="display:flex;justify-content:space-between;align-items:center"><span class="muted">Real account value</span><span class="tag blue">Real money</span></div>
    <div class="value num">${usd(B.equity)}</div>
    <div class="num"><span class="${sgn(dayCh)}">${pct(dayCh)}</span> <span class="muted">today</span></div>
    <div class="kv" style="padding:14px 0 0"><div><span>Buying power</span><b>${usd(B.buyingPower)}</b></div><div><span>Cash</span><b>${usd(B.cash)}</b></div><div><span>Withdrawable</span><b>${usd(B.withdrawable)}</b></div></div>
    <div class="actions"><button class="btn" data-act="rtrade">Trade</button><button class="btn ghost" data-act="rdeposit">Deposit</button><button class="btn ghost" data-act="rwithdraw">Withdraw</button></div>
    ${inst.outstanding ? `<p class="hint" style="margin:10px 0 0">${usd(inst.outstanding)} of instant deposit is available to invest and becomes withdrawable when your bank transfer clears.</p>` : ''}</div>
  <section class="block"><header><h2>Holdings</h2></header><div class="list">${R.positions.length ? R.positions.map(p => `<div class="row"><div class="grow"><div class="sym">${esc(p.sym)}</div><div class="small muted">${shs(p.qty)} shares, average ${usd(p.avgPrice)}</div></div><div class="r"><div class="num">${usd(p.value)}</div><div class="small num ${sgn(p.plPct)}">${pct(p.plPct)}</div></div></div>`).join('') : '<div class="empty">No holdings yet. Deposit money, then place your first trade.</div>'}</div></section>
  ${openOrders.length ? `<section class="block"><header><h2>Open orders</h2></header><div class="list">${openOrders.map(o => orderRow(o, true)).join('')}</div></section>` : ''}
  <section class="block"><header><h2>Bank account</h2></header><div class="list">${bank ? `<div class="row"><div class="grow"><b>${esc(bankLabel(bank))}</b><div class="small muted">${esc(bank.status === 'APPROVED' ? 'Linked' : bank.status)}</div></div><button class="btn sm ghost" data-act="runbank" data-id="${esc(bank.id)}">Remove</button></div>`
    : `<div class="row"><div class="grow"><b>No bank linked</b><div class="small muted">Link a bank account to deposit and withdraw.</div></div><button class="btn sm" data-act="rbank">Link a bank</button></div>`}</div></section>
  <section class="block"><header><h2>Activity</h2><a class="small" href="#/documents">Brokerage statements and tax documents</a></header><div class="list">
    ${R.transfers.map(t => `<div class="row"><div class="grow"><b>${t.direction === 'INCOMING' ? 'Deposit' : 'Withdrawal'}</b><div class="small muted">${new Date(t.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric' })}, ${esc(TSTATUS[t.status] || t.status)}</div></div><b class="num">${t.direction === 'INCOMING' ? '+' : '−'}${usd(t.amount)}</b></div>`).join('')}
    ${R.orders.filter(o => !ROPEN.includes(o.status)).slice(0, 15).map(o => orderRow(o, false)).join('')}
    ${!R.transfers.length && !R.orders.length ? '<div class="empty">No activity yet.</div>' : ''}</div></section>
  ${brokerLine()}`;
}

function vOpenAccount(){
  if (!Store.site.realMoney) return '<div class="empty">Real money is available on my.pocketinvesting.com.</div>';
  if (!Store.signedIn) return vProfile(null);
  if (Store.site.require2fa && !Store.twofa) return `<div class="panel" style="padding:24px"><h2>Turn on two-step sign-in first</h2><a class="btn" href="#/security">Set up two-step sign-in</a></div>`;
  const f = ui.openForm = ui.openForm || { citizenship:'USA', employment:'employed', funding:['employment_income'] }, st = ui.openStep || 0;
  const inp = (k, label, attrs = '', hint = '') => `<div class="field"><label for="o-${k}">${label}</label><input class="input" id="o-${k}" data-of="${k}" value="${esc(f[k] || '')}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const yn = (k, q) => `<div class="row"><div class="grow small">${q}</div><div class="seg"><button class="${f[k] ? 'on' : ''}" data-act="ofyn" data-k="${k}" data-v="1">Yes</button><button class="${f[k] ? '' : 'on'}" data-act="ofyn" data-k="${k}" data-v="0">No</button></div></div>`;
  const steps = ['About you', 'Contact', 'Work and money', 'Agreements'];
  let body = '';
  if (st === 0) body = `<div class="grid2">${inp('givenName', 'Legal first name', 'autocomplete="given-name"')}${inp('familyName', 'Legal last name', 'autocomplete="family-name"')}</div>
    <div class="grid2">${inp('dob', 'Date of birth', 'type="date"')}${inp('ssn', 'Social Security number', 'inputmode="numeric" autocomplete="off" maxlength="11" placeholder="123-45-6789"', "Sent securely to the brokerage to verify your identity. Pocket doesn't store it.")}</div>
    <div class="field"><label for="o-citizenship">Citizenship</label><select class="input" id="o-citizenship" data-of="citizenship"><option value="USA">United States</option></select><span class="hint">US citizens and residents only during the beta.</span></div>`;
  else if (st === 1) body = `${inp('email', 'Email', 'type="email" autocomplete="email"')}${inp('phone', 'Mobile phone', 'type="tel" autocomplete="tel"')}${inp('street', 'Street address', 'autocomplete="address-line1"')}${inp('unit', 'Apartment or unit (optional)', 'autocomplete="address-line2"')}
    <div class="grid2">${inp('city', 'City', 'autocomplete="address-level2"')}<div class="grid2" style="gap:12px">${inp('state', 'State', 'maxlength="2" autocapitalize="characters" placeholder="CT" autocomplete="address-level1"')}${inp('postal', 'ZIP code', 'inputmode="numeric" autocomplete="postal-code" maxlength="10"')}</div></div>`;
  else if (st === 2) body = `<div class="field"><label for="o-employment">Employment</label><select class="input" id="o-employment" data-of="employment">${[['employed','Employed'],['unemployed','Not employed'],['retired','Retired'],['student','Student']].map(([k, l]) => `<option value="${k}" ${f.employment === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${f.employment === 'employed' ? `<div class="grid2">${inp('employer', 'Employer')}${inp('position', 'Job title')}</div>` : ''}
    <div class="field"><label>Where will the money you invest come from?</label><div>${[['employment_income','Job income'],['savings','Savings'],['investments','Investments'],['business_income','Business income'],['inheritance','Inheritance'],['family','Family']].map(([k, l]) => `<label style="display:inline-flex;gap:6px;align-items:center;margin:0 14px 8px 0"><input type="checkbox" class="of-fund" value="${k}" ${(f.funding || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>`;
  else body = `<div class="list" style="margin-bottom:14px">${yn('controlPerson', 'Are you a director, officer or 10% shareholder of a publicly traded company?')}${yn('finraAffiliated', 'Are you, or an immediate family member, affiliated with a stock exchange or FINRA member firm?')}${yn('politicallyExposed', 'Are you a senior political figure?')}${yn('familyExposed', 'Is an immediate family member a senior political figure?')}</div>
    <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px"><input type="checkbox" id="o-agree" ${f.agree ? 'checked' : ''} style="margin-top:4px"> <span class="small">I agree to the brokerage's customer and account agreements and the Pocket Investing Terms, and confirm the information above is accurate. <span class="muted">[Links to the final agreements go here.]</span></span></label>`;
  return `<div class="pagehead"><div><a href="#/portfolio" class="small">← Back</a><h1 style="margin-top:6px">Open your brokerage account</h1><p class="muted">Step ${st + 1} of ${steps.length}: ${steps[st]}</p></div>
    ${Store.site.alpacaEnv === 'sandbox' ? '<button class="btn ghost sm" data-act="oftest">Fill test details</button>' : ''}</div>
    ${Store.site.alpacaEnv === 'sandbox' ? '<div class="banner text" style="margin-bottom:14px;max-width:640px;font-size:14px"><b>Test environment.</b>&nbsp;Use made-up details here, never your real Social Security number. "Fill test details" does it for you.</div>' : ''}
    <div class="panel" style="padding:20px;max-width:640px">${body}<div class="hint" id="o-err" style="color:var(--loss);min-height:1.2em;margin:6px 0"></div>
    <div style="display:flex;gap:10px">${st > 0 ? '<button class="btn ghost" data-act="ofback">Back</button>' : ''}<button class="btn" data-act="${st < 3 ? 'ofnext' : 'ofsubmit'}">${st < 3 ? 'Continue' : 'Submit application'}</button></div></div>${brokerLine()}`;
}

function readOpenForm(){
  const f = ui.openForm || {};
  $$('[data-of]').forEach(e => { f[e.dataset.of] = e.value; });
  if ($$('.of-fund').length) f.funding = $$('.of-fund').filter(c => c.checked).map(c => c.value);
  const ag = $('#o-agree'); if (ag) f.agree = ag.checked;
  ui.openForm = f; return f;
}

function vStatements(){
  if (!Store.site.realMoney || !Store.signedIn) return '<div class="empty">Statements are available for real-money accounts.</div>';
  if (!ui.docs){ ui.docs = 'loading'; Store.real.docs().then(r => { ui.docs = r.documents; render(); }, e => { ui.docs = []; errToast(e); render(); }); }
  const D = Array.isArray(ui.docs) ? ui.docs : null;
  return `<div class="pagehead"><div><a href="#/portfolio" class="small">← Back</a><h1 style="margin-top:6px">Statements and tax documents</h1><p class="muted">Monthly statements, trade confirmations and tax forms from the brokerage.</p></div></div>
  <div class="list">${D ? (D.map(d => `<div class="row"><div class="grow"><b>${esc(d.name || d.type)}</b><div class="small muted">${esc(String(d.date || '').slice(0, 10))}</div></div><a class="btn sm ghost" href="/api/real/documents/${encodeURIComponent(d.id)}" download>Download</a></div>`).join('') || '<div class="empty">No documents yet. Your first monthly statement arrives after your first month.</div>') : '<div class="empty">Loading…</div>'}</div>`;
}

function rTradeSheet(sym, side){
  const R = ui.real; if (!R || !R.balances) return;
  const st = { sym: sym || 'AAPL', side: side || 'buy', by: side === 'sell' ? 'shares' : 'dollars', amt: '', step: 'edit', type: 'market', lp: '', tif: 'day' };
  const held = () => ((R.positions || []).find(p => p.sym === st.sym) || {}).qty || 0;
  const px = () => (ui.rquotes && ui.rquotes[st.sym]) || Market.price(st.sym);
  openModal('<div id="rts"></div>', sh => {
    const root = sh.querySelector('#rts'), q = id => root.querySelector('#' + id);
    const refreshQuote = () => Store.real.quotes([st.sym]).then(r => { ui.rquotes = Object.assign(ui.rquotes || {}, r.quotes); if (st.step === 'edit') upd(); }).catch(() => {});
    function upd(){
      const lim = st.type === 'limit' ? parseFloat(st.lp) || 0 : 0, a = parseFloat(st.amt) || 0, p = lim > 0 ? lim : px(), shares = st.by === 'dollars' ? a / p : a, dollars = st.by === 'dollars' ? a : a * p;
      q('r-est').textContent = st.by === 'dollars' ? '≈ ' + shs(Math.floor(shares * 1000) / 1000) + ' shares at ' + usd(p) : '≈ ' + usd(dollars);
      let ok = a > 0, after = '';
      const bp = R.balances.buyingPower || 0, pendIn = (R.transfers || []).filter(t => t.direction === 'INCOMING' && ['QUEUED', 'SENT_TO_CLEARING', 'APPROVAL_PENDING', 'PENDING', 'SUBMITTED'].includes(t.status)).reduce((s, t) => s + Number(t.amount || 0), 0);
      let why = a > 0 ? '' : 'Enter an amount to continue.';
      if (st.side === 'buy'){ const left = bp - dollars; after = 'Buying power left: ' + usd(Math.max(0, left));
        if (left < -0.01){ ok = false; why = why || (bp < 0.01 ? (pendIn > 0 ? `Your ${usd(pendIn)} deposit is still on its way, so you don't have buying power yet. You can trade as soon as it arrives, usually within 1 to 3 business days.` : "You don't have any buying power yet. Add money to your account to start trading.")
          : `That's more than your ${usd(bp)} of buying power. Lower the amount, or tap Max to use all of it.` + (pendIn > 0 ? ` Your ${usd(pendIn)} deposit is still on its way and will add to it.` : '')); } if (st.by === 'dollars' && a > 0 && a < 1){ ok = false; after = 'The minimum order is $1.'; } }
      else { const h = held(); if (!h){ ok = false; why = `You don't own any ${st.sym} in your real account, so there's nothing to sell. Switch to Buy, or pick a stock you own.`; } else if (shares > h + 1e-6){ ok = false; why = why || `You own ${shs(h)} shares of ${st.sym}. Lower the amount, or tap Max to sell all of them.`; } else after = "You'll keep " + shs(Math.max(0, h - shares)) + ' shares.'; }
      if (st.type === 'limit' && st.by === 'dollars'){ ok = false; why = why || 'Limit orders are placed in shares. Switch to Shares to continue.'; }
      if (st.type === 'limit' && !(lim > 0)){ ok = false; why = why || 'Enter a limit price to continue.'; }
      if (st.type === 'limit' && st.tif === 'gtc' && a > 0 && Math.abs(a - Math.round(a)) > 1e-9){ ok = false; why = why || 'Good till canceled orders need whole shares. Enter a whole number, or choose Day for fractional shares.'; }
      whyNot(q('r-after'), q('r-rev'), ok && !why ? '' : (why || after), after);
    }
    function draw(){
      root.innerHTML = `<header><h2>Real-money order</h2><button class="x" data-close aria-label="Close">×</button></header>
        <div class="banner text" style="margin-bottom:12px;font-size:14px"><b>Real money.</b> ${R.alpacaEnv === 'sandbox' ? 'Test environment: no real money moves.' : 'This order uses your brokerage account.'}</div>
        <div class="field"><label for="r-sym">Stock</label><select class="input" id="r-sym">${Market.LIST.map(t => `<option value="${t.s}" ${t.s === st.sym ? 'selected' : ''}>${t.s} — ${esc(t.n)}</option>`).join('')}</select></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div class="seg" id="r-side"><button data-k="buy" class="${st.side === 'buy' ? 'on' : ''}">Buy</button><button data-k="sell" class="${st.side === 'sell' ? 'on' : ''}">Sell</button></div><div class="seg" id="r-by"><button data-k="dollars" class="${st.by === 'dollars' ? 'on' : ''}">Dollars</button><button data-k="shares" class="${st.by === 'shares' ? 'on' : ''}">Shares</button></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" id="r-chips">${(st.side === 'buy' ? [['100','$100'],['500','$500'],['1000','$1,000'],['max','Max']] : [['0.25','25%'],['0.5','50%'],['0.75','75%'],['1','All']]).map(([k, l]) => `<button class="btn sm ghost" data-k="${k}">${l}</button>`).join('')}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div class="seg" id="r-type"><button data-k="market" class="${st.type === 'market' ? 'on' : ''}">Market</button><button data-k="limit" class="${st.type === 'limit' ? 'on' : ''}">Limit</button></div>${st.type === 'limit' ? `<div class="seg" id="r-tif"><button data-k="day" class="${st.tif === 'day' ? 'on' : ''}">Day</button><button data-k="gtc" class="${st.tif === 'gtc' ? 'on' : ''}">Good till canceled</button></div>` : ''}</div>
        ${st.type === 'limit' ? `<div class="field"><label for="r-lp">Limit price ($)</label><input class="input num" id="r-lp" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(st.lp)}"><div class="hint">${st.side === 'buy' ? 'Buys only at this price or lower.' : 'Sells only at this price or higher.'} ${st.tif === 'gtc' ? 'Stays open until it fills or you cancel it.' : 'Cancels at the end of the day if it hasn\'t filled.'}</div></div>` : ''}
        <div class="field"><label for="r-amt">${st.by === 'dollars' ? 'Amount in dollars' : 'Number of shares'}</label><input class="input num" id="r-amt" type="number" min="0" step="any" inputmode="decimal" value="${esc(st.amt)}"></div>
        <div class="est"><span>Estimate</span><b class="num" id="r-est">—</b></div><div class="hint" id="r-after" style="margin:-6px 0 14px"></div>
        <button class="btn" id="r-rev" style="width:100%">Review order</button>`;
      q('r-sym').onchange = () => { st.sym = q('r-sym').value; refreshQuote(); upd(); };
      q('r-side').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.side = b.dataset.k; st.by = st.side === 'sell' ? 'shares' : 'dollars'; st.amt = ''; draw(); };
      q('r-by').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.by = b.dataset.k; st.amt = ''; draw(); };
      q('r-chips').onclick = e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
        if (st.side === 'buy'){ st.by = 'dollars'; st.amt = k === 'max' ? String(Math.floor(R.balances.buyingPower * 100) / 100) : k; } else { st.by = 'shares'; st.amt = String(Math.floor(held() * +k * 1e6) / 1e6); } draw(); };
      q('r-amt').oninput = () => { st.amt = q('r-amt').value; upd(); };
      q('r-type').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.type = b.dataset.k; if (st.type === 'limit'){ st.by = 'shares'; if (!st.lp) st.lp = px().toFixed(2); } draw(); };
      if (q('r-tif')) q('r-tif').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.tif = b.dataset.k; draw(); };
      if (q('r-lp')) q('r-lp').oninput = () => { st.lp = q('r-lp').value; upd(); };
      q('r-rev').onclick = review; upd();
    }
    function review(){
      const a = parseFloat(st.amt) || 0, p = px();
      st.step = 'review';
      root.innerHTML = `<header><h2>Review order</h2><button class="x" data-close aria-label="Close">×</button></header>
        <div class="list">${[['Account', 'Real money' + (R.alpacaEnv === 'sandbox' ? ' (test)' : '')], ['Order', (st.side === 'buy' ? 'Buy ' : 'Sell ') + st.sym + (st.type === 'limit' ? ` with a limit of ${usd(parseFloat(st.lp))} (${st.tif === 'gtc' ? 'good till canceled' : 'day'})` : ' at market')], [st.by === 'dollars' ? 'Amount' : 'Shares', st.by === 'dollars' ? usd(a) : shs(a)], ['Latest price', usd(p)], ['Estimated ' + (st.by === 'dollars' ? 'shares' : (st.side === 'buy' ? 'cost' : 'proceeds')), st.by === 'dollars' ? shs(Math.floor(a / p * 1000) / 1000) : usd(a * p)]].map(([x, y]) => `<div class="row"><div class="grow muted">${x}</div><b class="num">${y}</b></div>`).join('')}</div>
        <p class="hint" style="margin:14px 0">Market orders fill at the next available price, which can differ from the estimate. Orders placed while the market is closed fill after it opens. ${DISCLOSE}</p>
        <div style="display:flex;gap:10px"><button class="btn ghost" id="r-back">Back</button><button class="btn" id="r-place" style="flex:1">Place ${st.side} order</button></div>`;
      q('r-back').onclick = () => { st.step = 'edit'; draw(); };
      q('r-place').onclick = async () => {
        q('r-place').disabled = true;
        try { const o = { sym: st.sym, side: st.side }; if (st.by === 'dollars') o.notional = a; else o.qty = a; if (st.type === 'limit'){ o.type = 'limit'; o.limitPrice = parseFloat(st.lp); o.tif = st.tif; }
          await Store.real.order(o); closeModal(); toast(`Order sent: ${st.side === 'buy' ? 'buy' : 'sell'} ${st.by === 'dollars' ? usd(a) + ' of' : shs(a)} ${st.sym}. We'll tell you when it fills.`); loadReal();
        } catch(e){ q('r-place').disabled = false; errToast(e); }
      };
    }
    draw(); refreshQuote();
    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
  });
}

function rTransferSheet(dir){
  const R = ui.real, inst = R.instant || {}, out = dir === 'out';
  if (!(R.banks || []).length) return rBankSheet();
  openModal(`<header><h2>${out ? 'Withdraw to your bank' : 'Deposit from your bank'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="tr-a">Amount</label><input class="input num" id="tr-a" type="number" min="1" step="0.01" inputmode="decimal" placeholder="0.00"><span class="hint">${out ? 'Available to withdraw: ' + usd(R.balances.withdrawable) : 'From ' + esc(R.banks[0].nickname || 'your bank') + ' ending ' + esc(R.banks[0].last4)}</span></div>
    ${!out ? (inst.enabled ? (inst.eligible ? `<div class="banner" style="margin-bottom:12px;font-size:14px">Pro: up to ${usd(inst.perDeposit, 0)} of this deposit is available to invest right away. The rest is available when the transfer clears.</div>` : `<p class="hint">Instant deposits: ${esc(inst.reason || 'not available')}.</p>`) : '<p class="hint">Deposits usually take 1 to 3 business days to clear. Instant deposits for Pro members are coming soon.</p>') : '<p class="hint">Withdrawals usually arrive in 1 to 3 business days.</p>'}
    <button class="btn" id="tr-go" style="width:100%">${out ? 'Withdraw' : 'Deposit'}</button>`, sh => {
    sh.querySelector('#tr-go').onclick = async () => { const b = sh.querySelector('#tr-go'); b.disabled = true;
      try { const r = await Store.real.transfer(dir, Number(sh.querySelector('#tr-a').value), out ? askCode('Enter the 6-digit code from your authenticator app to confirm this withdrawal.') : undefined); closeModal(); toast(out ? 'Withdrawal requested.' : (r.instant ? `Deposit started. ${usd(r.instant)} is available to invest now.` : 'Deposit started. It usually clears in 1 to 3 business days.')); loadReal(); }
      catch(e){ b.disabled = false; errToast(e); } };
  });
}

function rBankSheet(){
  const sandbox = ui.real && ui.real.alpacaEnv === 'sandbox';
  openModal(`<header><h2>Link your bank</h2><button class="x" data-close aria-label="Close">×</button></header>
    ${sandbox ? `<p class="muted" style="margin-top:0">Test environment: enter test bank details. In the live app, you'll sign in to your bank securely through Plaid instead.</p>
      <div class="field"><label for="bk-o">Account owner's name</label><input class="input" id="bk-o" value="${esc(Store.displayName(Store.myPid))}"></div>
      <div class="grid2"><div class="field"><label for="bk-r">Routing number</label><input class="input num" id="bk-r" inputmode="numeric" maxlength="9" value="121000358"></div><div class="field"><label for="bk-a">Account number</label><input class="input num" id="bk-a" inputmode="numeric" maxlength="17" value="32131231abc"></div></div>
      <div class="field"><label for="bk-t">Account type</label><select class="input" id="bk-t"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></div>
      <button class="btn" id="bk-go" style="width:100%">Link bank</button>`
    : `<p class="muted" style="margin-top:0">You'll sign in to your bank through Plaid, a secure service used by most finance apps. Pocket never sees your bank password.</p><button class="btn" disabled style="width:100%">Connect with Plaid (coming next)</button>`}`, sh => {
    const go = sh.querySelector('#bk-go'); if (!go) return;
    sh.querySelector('#bk-a').value = '123456789';
    go.onclick = async () => { go.disabled = true; try { await Store.real.bank({ code: askCode('Enter the 6-digit code from your authenticator app to confirm this bank account.'), owner: sh.querySelector('#bk-o').value, routing: sh.querySelector('#bk-r').value, account: sh.querySelector('#bk-a').value, type: sh.querySelector('#bk-t').value, nickname: 'Checking' }); closeModal(); toast('Bank linked.'); loadReal(); } catch(e){ go.disabled = false; errToast(e); } };
  });
}

/* Real-money copy requests: nothing is placed until the member approves. */
/* "Checking ending 6789"; a nickname or bank name is added only when it says something new. */
function bankLabel(b){ if (!b) return 'Bank account'; const ty = String(b.type || '').toLowerCase(), Ty = ty ? ty[0].toUpperCase() + ty.slice(1) : 'Account', core = `${b.bankName ? esc(b.bankName) + ' ' + ty : Ty} ending ${b.last4 || ''}`.trim(), nick = String(b.nickname || '').trim();
  return nick && nick.toLowerCase() !== ty && nick.toLowerCase() !== 'bank account' ? `${nick} · ${core}` : core; }
function realCopySection(pendingOnly){
  if (ui.realReq == null){ ui.realReq = 'loading'; Store.real.copyRequests().then(r => { ui.realReq = r.requests; render(); }, () => { ui.realReq = []; }); }
  const L = Array.isArray(ui.realReq) ? ui.realReq : [], pend = L.filter(r => r.status === 'pending'), recent = L.filter(r => r.status !== 'pending').slice(0, 5);
  const S = { placed: 'Order placed', filled: 'Filled', declined: 'Declined', expired: 'Expired', failed: "Couldn't place" };
  if (pendingOnly && !pend.length) return ''; if (!pend.length && !recent.length) return '';
  return `${pend.length ? `<section class="block"><header><h2>Waiting for your approval</h2><span class="tag ember">Real money</span></header>${pend.map(r => `<article class="post" style="border-color:var(--ember)">
      <div class="meta"><div class="grow"><b>${esc(r.leader)} ${r.side === 'buy' ? 'bought' : 'sold'} ${esc(r.sym)}</b> <span class="small muted">at ${usd(r.leaderPrice)}${r.gid ? ' for ' + esc((Store.get('groups', r.gid) || {}).name || 'your group') : ''}</span></div><span class="tag ember">${timeLeft(r.expiresTs)}</span></div>
      <p style="margin:8px 0">Approve to ${r.side} <b>${shs(r.suggested)}</b> shares of ${esc(r.sym)} in your brokerage account (about ${usd(r.suggested * Market.price(r.sym))}), sized to your account. Nothing happens unless you approve.</p>
      <div class="acts"><button class="btn ember" data-act="rcopy" data-id="${r.id}" data-k="full">Approve</button><button class="btn ghost" data-act="rcopy" data-id="${r.id}" data-k="half">Half size</button><button class="btn ghost" data-act="rcopy" data-id="${r.id}" data-k="decline">Decline</button></div></article>`).join('')}</section>` : ''}
    ${recent.length && !pendingOnly ? `<section class="block"><header><h2>Recent copies</h2></header><div class="list">${recent.map(r => `<div class="row"><div class="grow"><b>${r.side === 'buy' ? 'Buy' : 'Sell'} ${esc(r.sym)}</b> <span class="small muted">copying ${esc(r.leader)}</span>${r.reason ? `<div class="small muted">${esc(r.reason)}</div>` : ''}</div><span class="small">${S[r.status] || r.status}${r.fillPrice ? ' at ' + usd(r.fillPrice) : ''}</span></div>`).join('')}</div></section>` : ''}`;
}
