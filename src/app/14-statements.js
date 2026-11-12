/* Statements and tax documents. */

/* ---------- statements ---------- */
function stPeriod(){
  const P = ui.stP || (ui.stP = { type: 'month', month: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 7), year: String(new Date().getUTCFullYear()), q: String(Math.floor(new Date().getUTCMonth() / 3) || 1), from: '', to: '', asof: new Date().toISOString().slice(0, 10) });
  const pad = n => String(n).padStart(2, '0'), last = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (P.type === 'month'){ const [y, m] = P.month.split('-').map(Number); return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${last(y, m)}`, label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }; }
  if (P.type === 'quarter'){ const y = +P.year, qn = +P.q, m0 = (qn - 1) * 3 + 1; return { from: `${y}-${pad(m0)}-01`, to: `${y}-${pad(m0 + 2)}-${last(y, m0 + 2)}`, label: `Q${qn} ${y}` }; }
  if (P.type === 'year') return { from: P.year + '-01-01', to: P.year + '-12-31', label: 'Year ' + P.year };
  if (P.type === 'asof') return { from: P.asof, to: P.asof, label: 'As of ' + P.asof };
  return { from: P.from, to: P.to, label: '' };
}

function stQuery(acc, per){ return 'kind=' + acc.kind + (acc.gid ? '&gid=' + encodeURIComponent(acc.gid) : '') + (acc.pid ? '&pid=' + encodeURIComponent(acc.pid) : '') + '&from=' + per.from + '&to=' + per.to + (per.label ? '&label=' + encodeURIComponent(per.label) : ''); }

function stFmt(v, t){ if (v == null || v === '') return '—'; if (t === '$') return (v < 0 ? '−' : '') + usd(Math.abs(v)); if (t === '%') return (v * 100).toFixed(2) + '%'; if (t === 'n3') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 }); return esc(String(v)); }

function stView(S, links){
  return `<div class="panel" style="padding:20px 22px;margin-top:16px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h2 style="margin:0">${esc(S.title)}</h2>
      <div class="small" style="margin-top:6px">Account <b class="num">${esc(S.account)}</b> · ${esc(S.holder)} · ${esc(S.period.label)}</div></div>
      <div style="display:flex;gap:8px"><a class="btn sm" href="${links.pdf}" download>Download PDF</a><a class="btn ghost sm" href="${links.csv}" download>CSV</a></div></div>
    <p class="hint" style="margin:10px 0 0">${esc(S.note)}</p>
    ${S.summaryCols ? `<div class="mtable" style="margin-top:14px"><table><thead><tr><th></th><th>${esc(S.summaryCols[0])}</th><th>${esc(S.summaryCols[1])}</th></tr></thead><tbody>${S.summary.map(([k, v, t, y]) => `<tr><td>${esc(k)}</td><td class="${v < 0 ? 'loss' : ''}"><b>${stFmt(v, t)}</b></td><td>${y === undefined ? '' : stFmt(y, t)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="kv" style="margin-top:14px">${S.summary.map(([k, v, t]) => `<div><span>${esc(k)}</span><b class="${t === '$' || t === '%' ? (v < 0 ? 'loss' : '') : ''}">${stFmt(v, t)}</b></div>`).join('')}</div>`}</div>
    ${S.tables.map(T => `<section class="block"><header><h2>${esc(T.title)}</h2></header>${T.note ? `<p class="hint" style="margin-top:0">${esc(T.note)}</p>` : ''}${T.rows.length ? `<div class="panel mtable"><table><thead><tr>${T.columns.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${T.rows.map(r => `<tr>${r.map((v, i) => `<td>${T.types[i] === 's' ? esc(v == null ? '' : String(v)) : stFmt(v, T.types[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="panel empty">None in this period.</div>'}</section>`).join('')}${S.contact ? `<p class="hint" style="margin-top:16px">${esc(S.contact)}</p>` : ''}`;
}

function taxSection(L){
  const T = ui.taxDocs; if (!T){ ui.taxDocs = 'loading'; Store.http('GET', '/api/tax-docs').then(r => { ui.taxDocs = r.docs; render(); }, () => { ui.taxDocs = []; }); }
  if (Store.site.realMoney && ui.taxReal == null){ ui.taxReal = 'loading'; Store.real.docs().then(r => { ui.taxReal = (r.documents || r || []).filter(d => /tax|1099/i.test(String(d.type || d.name || ''))); render(); }, () => { ui.taxReal = []; render(); }); }
  const opened = new Date(((Store.get('profiles', Store.myPid) || {}).createdTs) || Date.now()).getUTCFullYear(), yrNow = new Date().getUTCFullYear(), yr = ui.taxYear || (opened >= yrNow ? yrNow : yrNow - 1), docs = Array.isArray(T) ? T : [];
  const clubs = L.accounts.filter(a => a.kind === 'member'), officerOf = new Set(L.accounts.filter(a => a.kind === 'club').map(a => a.gid));
  return `<section class="block"><header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Tax documents</h2><select class="input" id="tax-y" style="width:auto" aria-label="Tax year">${[yrNow, yrNow - 1, yrNow - 2].map(y => `<option ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}</select></header>
    <div class="list">
      ${Store.site.realMoney ? (Array.isArray(ui.taxReal) && ui.taxReal.length ? ui.taxReal.map(d => `<a class="row" href="/api/real/documents/${encodeURIComponent(d.id)}" target="_blank" rel="noopener"><div class="grow"><b>${esc(d.name || d.type)}</b><div class="small muted">From Alpaca, your broker · ${esc(String(d.date || '').slice(0, 10))}</div></div><span class="small">PDF</span></a>`).join('') : '<div class="row"><div class="grow small muted">Your official 1099 tax forms come from Alpaca, typically by mid-February. You\'ll get a notification when they\'re ready.</div></div>') : ''}
      <div class="row"><div class="grow"><b>Practice account year-end summary, ${yr}</b><div class="small muted">Practice accounts don't get tax forms. This summary of gains and dividends is for learning.</div></div><button class="btn sm ghost" data-act="taxsummary" data-k="${yr}">View</button></div>
      ${clubs.map(a => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><b>${esc(a.label.replace(': your stake', ''))}: your ${yr} K-1 worksheet</b><div class="small muted">For your tax preparer. Your club issues the actual K-1, usually by mid-March.</div></div><a class="btn sm ghost" href="/api/club/${a.gid}/tax-packet.pdf?year=${yr}" download>PDF</a>
        ${officerOf.has(a.gid) ? `<a class="btn sm ghost" href="/api/club/${a.gid}/tax-packet.pdf?year=${yr}" download>Full club packet</a><a class="btn sm ghost" href="/api/club/${a.gid}/tax-packet.csv?year=${yr}" download>CSV</a><button class="btn sm ghost" data-act="taxup" data-gid="${a.gid}">Post a K-1 or tax form</button>` : ''}</div>`).join('')}
      ${docs.filter(d => d.year === yr).map(d => `<a class="row" href="${d.url}" target="_blank" rel="noopener"><div class="grow"><b>${d.kind === 'k1' ? (d.mine ? 'Your K-1' : 'K-1 for ' + esc(Store.displayName(d.pid))) : d.kind === 'club-1099' ? 'Club 1099' : 'Club tax document'} · ${esc(d.club)}</b><div class="small muted">${esc(d.name || '')} · tax year ${d.year}</div></div><span class="small">PDF</span></a>`).join('')}
    </div></section>`;
}

function taxUploadSheet(gid){
  const yrNow = new Date().getUTCFullYear(), ms = Store.membersOf(gid).filter(m => m.role !== 'observer');
  openModal(`<header><h2>Post a tax document</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">A K-1 is visible only to that member and the club's officers. Club forms are visible to officers.</p>
    <div class="grid2"><div class="field"><label for="tu-k">Document</label><select class="input" id="tu-k"><option value="k1">K-1 for a member</option><option value="club-1099">Club 1099</option><option value="other">Other club tax document</option></select></div>
    <div class="field"><label for="tu-y">Tax year</label><select class="input" id="tu-y">${[yrNow - 1, yrNow].map(y => `<option>${y}</option>`).join('')}</select></div></div>
    <div class="field" id="tu-mf"><label for="tu-p">Member</label><select class="input" id="tu-p">${ms.map(m => `<option value="${m.pid}">${esc(Store.displayName(m.pid))}</option>`).join('')}</select></div>
    <div class="field"><label for="tu-f">PDF file (up to 5 MB)</label><input class="input" id="tu-f" type="file" accept="application/pdf"></div>
    <button class="btn" id="tu-go" style="width:100%">Post</button>`, sh => {
    const k = sh.querySelector('#tu-k'); k.onchange = () => { sh.querySelector('#tu-mf').style.display = k.value === 'k1' ? '' : 'none'; };
    sh.querySelector('#tu-go').onclick = async () => { const b = sh.querySelector('#tu-go'); b.disabled = true;
      try { const file = await readFile64(sh.querySelector('#tu-f').files[0]); await Store.http('POST', `/api/club/${gid}/taxdoc`, { kind: k.value, year: Number(sh.querySelector('#tu-y').value), pid: k.value === 'k1' ? sh.querySelector('#tu-p').value : null, file });
        ui.taxDocs = null; closeModal(); toast(k.value === 'k1' ? 'Posted. The member has been notified.' : 'Posted.'); render(); } catch(e){ errToast(e); b.disabled = false; } };
  });
}

function vPocketStatements(){
  if (!Store.signedIn) return vProfile(null);
  const L = ui.stList;
  if (!L){ ui.stList = 'loading'; Store.http('GET', '/api/statements').then(r => { ui.stList = r; if (ui.stAcc == null) ui.stAcc = 0; render(); }, e => { ui.stList = { error: e.message }; render(); }); }
  if (!L || L === 'loading') return '<div class="loading" style="min-height:30vh">Loading statements…</div>';
  if (L.error) return `<div class="panel empty">${esc(L.error)}</div>`;
  const P = ui.stP || (stPeriod(), ui.stP), acc = L.accounts[ui.stAcc || 0] || L.accounts[0], now = new Date().getUTCFullYear();
  const accLabel = s => { const a = L.accounts.find(x => x.kind === s.kind && (x.gid || null) === (s.gid || null) && (s.kind === 'club' || x.pid === s.pid)); return a ? a.label : s.kind === 'member' ? 'Member stake' : 'Account'; };
  const S = ui.stShown;
  return `<div class="pagehead"><div><a href="#/u/${Store.myPid}" class="small">← Profile</a><h1 style="margin-top:6px">Statements</h1><p class="muted">Statements are created automatically after each month, quarter and year. For clubs, they wait until the month is closed and signed off. You can also create one for any period.</p>${Store.site.realMoney ? '<p class="small"><a href="#/documents">Brokerage statements and tax documents from Alpaca</a></p>' : ''}</div></div>
    <div class="panel" style="padding:16px 18px"><h2 style="margin:0 0 10px;font-size:17px">Create a statement</h2>
      <div class="grid2"><div class="field"><label for="st-acc">Account</label><select class="input" id="st-acc">${L.accounts.map((a, i) => `<option value="${i}" ${i === (ui.stAcc || 0) ? 'selected' : ''}>${esc(a.label)} · ${esc(a.number)}</option>`).join('')}</select></div>
      <div class="field"><label for="st-type">Period</label><select class="input" id="st-type">${[['month','Month'],['quarter','Quarter'],['year','Year'],['custom','Custom dates'],['asof','As of a date']].map(([k, l]) => `<option value="${k}" ${P.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="grid2">${P.type === 'month' ? `<div class="field"><label for="st-m">Month</label><input class="input" id="st-m" type="month" value="${P.month}"></div>`
        : P.type === 'quarter' ? `<div class="field"><label for="st-q">Quarter</label><select class="input" id="st-q">${[1, 2, 3, 4].map(n => `<option value="${n}" ${+P.q === n ? 'selected' : ''}>Q${n}</option>`).join('')}</select></div><div class="field"><label for="st-y">Year</label><select class="input" id="st-y">${[now, now - 1, now - 2].map(y => `<option ${+P.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`
        : P.type === 'year' ? `<div class="field"><label for="st-y">Year</label><select class="input" id="st-y">${[now, now - 1, now - 2].map(y => `<option ${+P.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`
        : P.type === 'asof' ? `<div class="field"><label for="st-d">Date</label><input class="input" id="st-d" type="date" value="${P.asof}"></div>`
        : `<div class="field"><label for="st-f">From</label><input class="input" id="st-f" type="date" value="${P.from}"></div><div class="field"><label for="st-t">To</label><input class="input" id="st-t" type="date" value="${P.to}"></div>`}</div>
      <button class="btn" data-act="stbuild">View statement</button></div>
    ${S ? stView(S.data, S.links) : ''}
    ${taxSection(L)}
    <section class="block"><header><h2>Your statements</h2></header><div class="list">${L.statements.map(s => `<button class="row" style="width:100%;text-align:left;background:none;border:0;font:inherit;color:inherit;cursor:pointer" data-act="stopen" data-id="${s.id}"><div class="grow"><b>${esc(s.label)}</b><div class="small muted">${esc(accLabel(s))}</div></div><span class="small muted">${s.key[0] === 'M' ? 'Monthly' : s.key[0] === 'Q' ? 'Quarterly' : 'Yearly'}</span></button>`).join('') || '<div class="empty">None yet. The first monthly statement appears after this month ends.</div>'}</div></section>`;
}
