/* Trading: the trade sheet, recurring buys and Copy once. */

function recurringList(){
  const rs = Store.all('recurring').filter(r => r.pid === Store.myPid); if (!rs.length) return '';
  const F = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };
  return `<section class="block"><header><h2>Recurring investments</h2></header><div class="list">${rs.map(r => `<div class="row">${logo(r.sym)}<div class="grow"><b>${usd(r.amount)} of ${r.sym}</b> <span class="small muted">${F[r.freq]}</span>
    <div class="small muted">${r.paused ? 'Paused' : 'Next buy ' + new Date(r.nextTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${r.runs ? ` · ${r.runs} buy${r.runs === 1 ? '' : 's'} so far` : ''}${r.lastError ? ` · <span class="loss">Last try: ${esc(r.lastError)}</span>` : ''}</div></div>
    ${Store.canWrite ? `<button class="btn sm ghost" data-act="recpause" data-k="${r.sym}" data-v="${r.paused ? '0' : '1'}">${r.paused ? 'Resume' : 'Pause'}</button><button class="btn sm ghost" data-act="recdel" data-k="${r.sym}">Stop</button>` : ''}</div>`).join('')}</div>
    <p class="hint">Recurring buys use your practice cash and run during market hours.</p></section>`;
}

function recurringSheet(sym){
  const cur = Store.get('recurring', Store.myPid + '__' + sym);
  openModal(`<header><h2>Invest in ${sym} automatically</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Buy a set dollar amount on a schedule, whatever the price. Uses your practice cash.</p>
    <div class="grid2"><div class="field"><label for="rc-a">Amount each time</label><input class="input num" id="rc-a" inputmode="decimal" value="${cur ? cur.amount : 100}"></div>
    <div class="field"><label for="rc-f">How often</label><select class="input" id="rc-f">${[['weekly','Every week'],['biweekly','Every 2 weeks'],['monthly','Every month']].map(([k, l]) => `<option value="${k}" ${(cur ? cur.freq : 'biweekly') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <button class="btn" id="rc-go" style="width:100%">${cur ? 'Update schedule' : 'Start investing'}</button><p class="hint" style="text-align:center;margin-top:10px">The first buy happens at the next market open. Pause or stop anytime from Home.</p>`, sh => {
    sh.querySelector('#rc-go').onclick = async () => { try { await Store.setRecurring({ sym, amount: Number(sh.querySelector('#rc-a').value), freq: sh.querySelector('#rc-f').value }); closeModal(); toast('Recurring investment set.'); } catch(e){ errToast(e); } };
  });
}


/* ---------- Copy once: buy an investor's or group's current mix in one approved step ---------- */
function copyOnceSheet(o){
  const g = o.gid ? Store.get('groups', o.gid) : null, src = g ? g.leadPid : o.pid;
  const spf = Store.get('portfolios', src), mine = Store.get('portfolios', Store.myPid);
  const held = Object.entries((spf && spf.positions) || {}).map(([s, p]) => [s, p.shares * Market.price(s)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!held.length) return toast(g ? "The group doesn't hold any stocks right now." : `${Store.displayName(src)} doesn't hold any stocks right now.`);
  const tot = held.reduce((a, [, v]) => a + v, 0), cash = (mine && mine.cash) || 0;
  const dflt = Math.max(10, Math.min(cash, Math.round(Store.portfolioValue(mine) * 0.1 / 10) * 10));
  const who = g ? esc(g.name) : esc(Store.displayName(src)), S = statsFor(g ? 'group' : 'investor', g ? g.id : src);
  openModal(`<header><h2>${g ? 'Catch up with ' + who : 'Copy ' + who + "'s portfolio"}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">${g ? "Buy the group's current holdings in the same proportions, so you're in step with trades made before you joined." : `Buy ${who}'s current holdings in the same proportions, scaled to the amount you choose.`} ${S && !S.none ? riskBadge(S) : ''}</p>
    <div class="field"><label for="co-a">Amount to invest</label><input class="input num" id="co-a" inputmode="decimal" value="${dflt}"><span class="hint">You have ${usd(cash)} in cash.</span></div>
    <div class="list" id="co-list" style="margin:10px 0"></div>
    ${g || Store.isCopying(src) ? '' : `<label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:10px 0"><input type="checkbox" id="co-f" checked style="margin-top:3px"> <span>Also copy their new trades. Each one asks for your approval.</span></label>`}
    ${!Clock.canFillNow() ? '<div class="banner" style="margin-bottom:10px">Markets are closed. You can review this now and buy during market hours.</div>' : ''}
    <button class="btn" id="co-go" style="width:100%">Approve and buy</button>
    <p class="hint" style="text-align:center;margin-top:10px">${esc(DISCLOSE)}</p>`, sh => {
    const draw = () => { const amt = Number(sh.querySelector('#co-a').value) || 0;
      sh.querySelector('#co-list').innerHTML = held.map(([s, v]) => { const d = amt * v / tot; return `<div class="row">${logo(s)}<div class="grow"><b>${s}</b> <span class="small muted">${(v / tot * 100).toFixed(1)}%</span></div><b class="num">${d < 1 ? '<span class="small muted">under $1, skipped</span>' : usd(d)}</b></div>`; }).join(''); };
    sh.querySelector('#co-a').oninput = draw; draw();
    sh.querySelector('#co-go').onclick = async () => { const b = sh.querySelector('#co-go'); b.disabled = true;
      try { const f = sh.querySelector('#co-f'); const r = await Store.copyPortfolio(Object.assign({ amount: Number(sh.querySelector('#co-a').value) }, g ? { gid: g.id } : { pid: src, follow: !!(f && f.checked) }));
        closeModal(); toast(`Bought ${r.filled.length} stock${r.filled.length === 1 ? '' : 's'}${r.skipped.length ? ` (skipped ${r.skipped.join(', ')}: under $1)` : ''}.${f && f.checked ? ' New trades will ask for your approval.' : ''}`); }
      catch(e){ errToast(e); b.disabled = false; } };
  });
}

function orderRow(o, open){
  const what = `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.notional != null ? usd(o.notional) + ' of' : shs(o.qty)} ${esc(o.sym)}${o.type === 'limit' && o.limitPrice ? ` · limit ${usd(o.limitPrice)}${o.tif === 'gtc' ? ', good till canceled' : ''}` : ''}`;
  const fill = o.filledQty ? `${shs(o.filledQty)} shares at ${usd(o.filledPrice)}` : '';
  return `<div class="row"><div class="grow"><b>${what}</b><div class="small muted">${esc(RSTATUS[o.status] || o.status)}${fill ? ', ' + fill : ''}${o.message ? ', ' + esc(o.message) : ''}</div></div>${open && o.status !== 'pending_cancel' && o.status !== 'sending' ? `<button class="btn sm ghost" data-act="rcancel" data-id="${esc(o.id)}">Cancel</button>` : `<span class="small muted">${new Date(o.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric' })}</span>`}</div>`;
}

function tradeSheet({ sym = 'AAPL', side = 'buy', gid = null } = {}){
  const me = Store.myPid;
  const tradeGroups = Store.myGroups().filter(g => Store.canTradeFor((Store.membership(g.id) || {}).role));
  const st = { sym: sym || 'AAPL', side: side || 'buy', by: side === 'sell' ? 'shares' : 'dollars', amt: side === 'sell' ? '' : '100', acct: gid || 'me', q:'', step:'edit', chip: side === 'sell' ? null : '100' };
  const pf = () => Store.get('portfolios', me);
  const held = () => (((pf() || {}).positions || {})[st.sym] || {}).shares || 0;
  const calc = () => { const px = Market.price(st.sym), a = parseFloat(st.amt) || 0; const shares = Math.floor((st.by === 'dollars' ? a / px : a) * 1000) / 1000; return { px, shares, dollars: shares * px }; };
  const grp = () => st.acct !== 'me';
  const recipients = () => grp() ? Store.membersOf(st.acct).filter(m => m.pid !== me && m.role !== 'observer').length : Store.copiersOf(me).length;
  openModal('<div id="ts"></div>', sh => {
    const root = sh.querySelector('#ts'); const q = id => root.querySelector('#' + id);
    const chips = () => st.side === 'buy'
      ? [['100','$100'],['500','$500'],['1000','$1,000'],['max','Max']]
      : [['0.25','25%'],['0.5','50%'],['0.75','75%'],['1','All']];
    function drawEdit(focusAmt){
      const T = Market.MAP[st.sym];
      root.innerHTML = `<header><h2>${grp() ? 'Trade for ' + esc((Store.get('groups', st.acct) || {}).name || 'the group') : 'Place an order'}</h2><button class="x" data-close aria-label="Close">×</button></header>
        ${tradeGroups.length ? `<div class="field"><label for="t-acct">Account</label><select class="input" id="t-acct"><option value="me">Personal</option>${tradeGroups.map(g => `<option value="${g.id}" ${st.acct === g.id ? 'selected' : ''}>Trade for ${esc(g.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label for="t-q">Stock</label>
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)"><span class="sym">${st.sym}</span><span class="grow muted ellip" style="flex:1">${esc(T.n)}</span><b class="num" data-px="${st.sym}">${usd(Market.price(st.sym))}</b></div>
          <input class="input" id="t-q" data-nofocus placeholder="Search another stock, e.g. Apple or MSFT" autocomplete="off" value="${esc(st.q)}" style="margin-top:8px"><div id="t-res" class="list" style="display:none;margin-top:6px"></div></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div class="seg" id="t-side"><button data-k="buy" class="${st.side === 'buy' ? 'on' : ''}">Buy</button><button data-k="sell" class="${st.side === 'sell' ? 'on' : ''}">Sell</button></div>
          <div class="seg" id="t-by"><button data-k="dollars" class="${st.by === 'dollars' ? 'on' : ''}">Dollars</button><button data-k="shares" class="${st.by === 'shares' ? 'on' : ''}">Shares</button></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" id="t-chips">${chips().map(([k, l]) => `<button class="btn sm ${st.chip === k ? '' : 'ghost'}" data-k="${k}" ${st.side === 'sell' && !held() ? `disabled title="You don't own any ${st.sym} to sell"` : ''}>${l}</button>`).join('')}</div>
        <div class="field"><label for="t-amt" id="t-amt-l">${st.by === 'dollars' ? 'Amount in dollars' : 'Number of shares'}</label><input class="input num" id="t-amt" type="number" min="0" step="any" inputmode="decimal" value="${esc(st.amt)}"><span class="hint" id="t-have"></span></div>
        <div class="est"><span id="t-est-l"></span><b class="num" id="t-est">—</b></div>
        <div class="hint" id="t-after" style="margin:-6px 0 14px"></div>
        ${grp() ? '' : `<div class="field"><label style="display:flex;gap:10px;align-items:center;font-weight:500"><input type="checkbox" id="t-share" ${st.share ? 'checked' : ''}> Share this trade to the feed</label></div>`}
        <div class="field" id="t-note-f" style="${grp() || st.share ? '' : 'display:none'}"><label for="t-note">${grp() ? 'Note to the group (optional)' : 'Note (optional)'}</label><input class="input" id="t-note" value="${esc(st.note || '')}" placeholder="Why this trade"></div>
        <button class="btn ${grp() ? 'ember' : ''}" id="t-rev" style="width:100%">Review order</button>
        <p class="hint" style="text-align:center;margin-top:10px">Market order at the current ${Store.site.realPrices ? 'market' : 'simulated'} price, with practice money. Investing involves risk, including loss of principal.</p>`;
      wireEdit(); upd();
      if (focusAmt){ const a = q('t-amt'); a.focus(); const v = a.value; a.value = ''; a.value = v; }
    }
    function upd(){
      const c = calc(), cash = (pf() || {}).cash || 0, h = held();
      q('t-est-l').textContent = st.by === 'dollars' ? 'Estimated shares' : 'Estimated ' + (st.side === 'buy' ? 'cost' : 'proceeds');
      q('t-est').textContent = st.by === 'dollars' ? shs(c.shares) + ' @ ' + usd(c.px) : usd(c.dollars);
      q('t-have').textContent = st.side === 'buy' ? 'Cash available: ' + usd(cash) : (h ? 'You own ' + shs(h) + ' shares (' + usd(h * c.px) + ')' : "You don't own any " + st.sym + '.');
      let after = '', ok = c.shares > 0, why = '';
      if (!(parseFloat(st.amt) > 0)) why = 'Enter an amount to continue.';
      else if (!(c.shares > 0)) why = 'That amount buys less than 0.001 of a share. Enter a larger amount.';
      if (st.side === 'buy'){ const left = cash - c.dollars; after = 'Cash left after this order: ' + usd(Math.max(0, left)); if (left < -0.01){ ok = false; why = why || (cash < 0.01 ? "You don't have any practice cash left. Sell something first to free up cash." : `That's more than your ${usd(cash)} of cash. Lower the amount, or tap Max to use all of it.`); } }
      else { const keep = Math.max(0, Math.round((h - c.shares) * 1000) / 1000); if (c.shares > h + 0.0005){ after = "That's more shares than you own."; ok = false; } else after = keep > 0 ? "You'll keep " + shs(keep) + ' shares (' + usd(keep * c.px) + ')' : "You'll sell your whole position."; if (!h) ok = false; }
      if (st.side === 'sell' && !h) why = `You don't own any ${st.sym}, so there's nothing to sell. Switch to Buy, or pick a stock you own.`;
      else if (st.side === 'sell' && c.shares > h + 0.0005) why = `You own ${shs(h)} shares of ${st.sym}. Lower the amount, or tap Max to sell all of them.`;
      whyNot(q('t-after'), q('t-rev'), ok && !why ? '' : (why || after), after);
      $$('#t-chips button', root).forEach(b => b.className = 'btn sm ' + (st.chip === b.dataset.k ? '' : 'ghost'));
    }
    function wireEdit(){
      const acct = q('t-acct'); if (acct) acct.onchange = () => { st.acct = acct.value; drawEdit(); };
      q('t-side').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.k === st.side) return; st.side = b.dataset.k; st.by = st.side === 'sell' ? 'shares' : 'dollars'; st.amt = ''; st.chip = null; drawEdit(true); };
      q('t-by').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.k === st.by) return; const c = calc(); st.by = b.dataset.k; st.amt = c.shares ? String(st.by === 'dollars' ? Math.round(c.dollars * 100) / 100 : c.shares) : ''; st.chip = null; drawEdit(true); };
      q('t-chips').onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return; const k = b.dataset.k; st.chip = k;
        if (st.side === 'buy'){ st.by = 'dollars'; st.amt = k === 'max' ? String(Math.floor(((pf() || {}).cash || 0) * 100) / 100) : k; }
        else { st.by = 'shares'; st.amt = String(Math.floor(held() * +k * 1000) / 1000); }
        drawEdit(); };
      q('t-amt').oninput = () => { st.amt = q('t-amt').value; st.chip = null; upd(); };
      const sc = q('t-share'); if (sc) sc.onchange = () => { st.share = sc.checked; q('t-note-f').style.display = sc.checked ? '' : 'none'; };
      const nt = q('t-note'); if (nt) nt.oninput = () => { st.note = nt.value; };
      const qi = q('t-q'), res = q('t-res');
      let tq = null;
      qi.oninput = () => { st.q = qi.value; const t = st.q.trim().toLowerCase();
        if (!t){ res.style.display = 'none'; return; }
        /* also search the full stock list when market data is on */
        if (Store.site.marketData){ clearTimeout(tq); tq = setTimeout(() => Store.searchStocks(t).then(list => { if (st.q.trim().toLowerCase() !== t) return;
          const have = new Set([...res.querySelectorAll('[data-s]')].map(b => b.dataset.s));
          res.insertAdjacentHTML('beforeend', list.filter(x => !have.has(x.s) && !x.added).slice(0, 6).map(x => `<button class="row" data-s="${esc(x.s)}" data-new="1" style="width:100%;text-align:left;border:0;border-top:1px solid var(--line);background:none"><span class="sym" style="width:60px">${esc(x.s)}</span><span class="grow ellip">${esc(x.n)}</span><span class="small muted">Add</span></button>`).join(''));
          res.style.display = ''; }).catch(() => {}), 250); }
        const hits = Market.LIST.filter(x => x.s.toLowerCase().startsWith(t) || x.n.toLowerCase().includes(t)).slice(0, 6);
        res.style.display = ''; res.innerHTML = hits.map(x => `<button class="row" data-s="${x.s}" style="width:100%;text-align:left;border:0;border-top:1px solid var(--line);background:none"><span class="sym" style="width:60px">${x.s}</span><span class="grow ellip">${esc(x.n)}</span><span class="num muted">${usd(Market.price(x.s))}</span></button>`).join('') || '<div class="empty">No matching stock in this demo.</div>'; };
      res.onclick = async e => { const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.new){ b.disabled = true; try { await Store.ensureStock(b.dataset.s); } catch(err){ b.disabled = false; return errToast(err); } }
        st.sym = b.dataset.s; st.q = ''; if (st.side === 'sell'){ st.amt = ''; st.chip = null; } drawEdit(true); };
      q('t-rev').onclick = () => drawReview();
    }
    function drawReview(){
      const c = calc(), cash = (pf() || {}).cash || 0, h = held(), n = recipients();
      const rows = [['Account', grp() ? 'Trade for ' + esc(Store.get('groups', st.acct).name) : 'Personal (simulated)'], ['Order', (st.side === 'buy' ? 'Buy ' : 'Sell ') + st.sym + ' at market'], ['Shares', shs(c.shares)], ['Estimated price', usd(c.px)], ['Estimated ' + (st.side === 'buy' ? 'cost' : 'proceeds'), usd(c.dollars)],
        st.side === 'buy' ? ['Cash after', usd(Math.max(0, cash - c.dollars))] : ['Shares after', shs(Math.max(0, Math.round((h - c.shares) * 1000) / 1000))]];
      const frac = st.side === 'sell' && h ? c.shares / h : null;
      const who = grp() ? (n ? `${n} member${n === 1 ? '' : 's'} will get an approval request${frac ? ` to sell ${fracWord(frac)} of their position` : ', sized to their own capital'}.` : 'No members will be asked to copy this yet.')
        : (n ? `${n} ${n === 1 ? 'person copies' : 'people copy'} you and will get an approval request.` : '');
      root.innerHTML = `<header><h2>Review order</h2><button class="x" data-close aria-label="Close">×</button></header>
        <div class="list">${rows.map(([a, b]) => `<div class="row"><div class="grow muted">${a}</div><b class="num">${b}</b></div>`).join('')}</div>
        ${who ? `<div class="banner ember" style="margin:14px 0 0">${who}</div>` : ''}
        <p class="hint" style="margin:14px 0">The price may move slightly before the order fills. ${DISCLOSE}</p>
        <div style="display:flex;gap:10px"><button class="btn ghost" id="t-back">Back</button><button class="btn ${grp() ? 'ember' : ''}" id="t-place" style="flex:1">${grp() ? 'Place group trade' : 'Place order'}</button></div>`;
      root.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
      q('t-back').onclick = () => drawEdit();
      q('t-place').onclick = async () => {
        const c2 = calc(); q('t-place').disabled = true;
        try {
          if (grp()){ const res = await Store.groupTrade(st.acct, me, st.sym, st.side, c2.shares, st.note || ''); closeModal(); toast(`Group trade placed: ${st.side === 'buy' ? 'bought' : 'sold'} ${shs(res.trade.shares)} ${st.sym}. ${res.sent} member${res.sent === 1 ? '' : 's'} asked to approve.`); }
          else { const t = await Store.trade(st.sym, st.side, c2.shares, { share: !!st.share, note: st.note || '' }); closeModal(); toast(`Order filled: ${st.side === 'buy' ? 'bought' : 'sold'} ${shs(t.shares)} ${st.sym} at ${usd(t.price)}.${t.sent ? ` ${t.sent} copier${t.sent === 1 ? '' : 's'} asked to approve.` : ''}`); }
        } catch(e){ q('t-place').disabled = false; errToast(e); }
      };
    }
    drawEdit();
    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
  });
}
