/* Items 102–110: app version, @mentions, editing, saved posts, plain-English terms, goals, interests,
   one-click unsubscribe and "Download my data". */

/* ---------- 102. version ---------- */
function appVersion(){ const m = document.querySelector('meta[name="pi-version"]'); return (m && m.content) || 'dev'; }
function versionLabel(){ const v = appVersion(), [d, h] = v.split('-'); return h ? `Version ${d} (${h})` : 'Version ' + v; }

/* ---------- 104. @mentions ---------- */
/* Who you picked from the list, per text box: name -> pid. Only names still in the text are sent. */
const MENTIONS = {};
function mentionKey(el){ return el.dataset.draft || el.id || 'x'; }
function mentionsFor(key, text){ const m = MENTIONS[key] || {}; return [...new Set(Object.entries(m).filter(([n]) => String(text || '').includes('@' + n)).map(([, pid]) => pid))]; }
function clearMentions(key){ delete MENTIONS[key]; }
function seedMentions(key, pids){ MENTIONS[key] = {}; (pids || []).forEach(pid => { const n = (Store.get('profiles', pid) || {}).name; if (n) MENTIONS[key][n] = pid; }); }
/* Text with $TICKER links and @Name links for the people actually mentioned. */
function richText(text, mentions){
  let h = linkify(text || '');
  for (const pid of (mentions || [])){ const n = (Store.get('profiles', pid) || {}).name; if (!n) continue;
    h = h.split('@' + esc(n)).join(`<a href="#/u/${esc(pid)}" class="mention">@${esc(n)}</a>`); }
  return h;
}
function mentionPeople(q, gid){
  const me = Store.myPid, ql = q.toLowerCase();
  const fol = new Set(Store.all('follows').filter(f => f.from === me).map(f => f.to));
  const mates = new Set(Store.all('memberships').filter(m => Store.myGroups().some(g => g.id === m.gid)).map(m => m.pid));
  const inGroup = gid ? new Set(Store.all('memberships').filter(m => m.gid === gid).map(m => m.pid)) : null;
  return Store.all('profiles').filter(p => p.id !== me && p.name && !iBlocked(p.id) && !p.blockedYou && (!inGroup || inGroup.has(p.id)))
    .filter(p => { const n = p.name.toLowerCase(); return !ql || n.startsWith(ql) || n.split(/\s+/).some(w => w.startsWith(ql)); })
    .map(p => [p, (fol.has(p.id) ? 2 : 0) + (mates.has(p.id) ? 1 : 0)]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).slice(0, 6).map(x => x[0]);
}
let mentionState = null;
function mentionClose(){ const p = document.getElementById('mention-pop'); if (p) p.remove(); if (mentionState && mentionState.el) mentionState.el.removeAttribute('aria-activedescendant'); mentionState = null; }
function mentionQuery(el){
  const v = el.value, c = el.selectionStart == null ? v.length : el.selectionStart, before = v.slice(0, c), at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && /[\w@]/.test(before[at - 1]))) return null;
  const q = before.slice(at + 1); if (q.length > 30 || /[\n@]/.test(q) || /\s{2}/.test(q)) return null;
  return { at, q, end: c };
}
function mentionOpen(el){
  const mq = mentionQuery(el); if (!mq){ mentionClose(); return; }
  const people = mentionPeople(mq.q.trim(), el.dataset.mentions || el.dataset.gid || null); if (!people.length){ mentionClose(); return; }
  let pop = document.getElementById('mention-pop');
  if (!pop){ pop = document.createElement('div'); pop.id = 'mention-pop'; pop.className = 'mention-pop'; pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', 'People to mention'); document.body.appendChild(pop); }
  const sel = mentionState && mentionState.el === el ? Math.min(mentionState.sel, people.length - 1) : 0;
  mentionState = { el, mq, people, sel };
  pop.innerHTML = people.map((p, i) => `<button type="button" role="option" id="mo-${i}" aria-selected="${i === sel}" class="${i === sel ? 'on' : ''}" data-i="${i}">${avatar(p.id, 'sm')}<span>${esc(p.name)}</span></button>`).join('');
  el.setAttribute('aria-activedescendant', 'mo-' + sel);
  const r = el.getBoundingClientRect(), below = innerHeight - r.bottom > 240;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 268)) + 'px';
  pop.style.top = below ? (r.bottom + 4) + 'px' : ''; pop.style.bottom = below ? '' : (innerHeight - r.top + 4) + 'px';
  pop.querySelectorAll('button').forEach(b => { b.onmousedown = e => { e.preventDefault(); mentionPick(+b.dataset.i); }; });
}
function mentionPick(i){
  const st = mentionState; if (!st) return; const p = st.people[i]; if (!p) return;
  const el = st.el, v = el.value, ins = '@' + p.name + ' ';
  el.value = v.slice(0, st.mq.at) + ins + v.slice(st.mq.end);
  const pos = st.mq.at + ins.length; try { el.setSelectionRange(pos, pos); } catch(e){}
  const key = mentionKey(el); MENTIONS[key] = MENTIONS[key] || {}; MENTIONS[key][p.name] = p.id;
  if (el.dataset.draft) ui.drafts[el.dataset.draft] = el.value;
  mentionClose(); el.focus();
}
document.addEventListener('input', e => { const el = e.target; if (el && el.matches && el.matches('[data-mentions]')) mentionOpen(el); });
document.addEventListener('keydown', e => {
  const st = mentionState; if (!st || e.target !== st.el) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); st.sel = (st.sel + (e.key === 'ArrowDown' ? 1 : st.people.length - 1)) % st.people.length; mentionOpen(st.el); }
  else if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); e.stopPropagation(); mentionPick(st.sel); }
  else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); mentionClose(); }
}, true);
document.addEventListener('focusout', e => { if (mentionState && e.target === mentionState.el) setTimeout(() => { if (mentionState && document.activeElement !== mentionState.el) mentionClose(); }, 150); });
window.addEventListener('scroll', () => { if (mentionState) mentionClose(); }, { passive: true });

/* ---------- 105. editing ---------- */
function editSheet(kind, id){
  const d = Store.get(kind === 'post' ? 'posts' : 'comments', id); if (!d) return;
  const post = kind === 'post' ? d : Store.get('posts', d.postId), gid = (post && post.groupId) || '', key = 'edit:' + id, max = kind === 'post' ? 500 : 400;
  seedMentions(key, d.mentions); clearMentions('ed-t');
  openModal(`<header><h2>Edit ${kind}</h2><button class="x" data-close aria-label="Close">×</button></header>
    ${d.trade ? `<p class="small muted" style="margin-top:0">The trade itself (${esc(d.trade.sym)}, ${shs(d.trade.shares)} @ ${usd(d.trade.price)}) can't be changed. You can edit your note.</p>` : ''}
    <div class="field"><label for="ed-t">Your ${kind}</label><textarea class="input" id="ed-t" data-mentions="${esc(gid)}" maxlength="${max}" style="min-height:120px">${esc(d.text || '')}</textarea><span class="hint">Edited ${kind}s show "edited". Type @ to mention someone.</span></div>
    <button class="btn" id="ed-go" style="width:100%">Save changes</button>`, sh => {
    const t = sh.querySelector('#ed-t');
    sh.querySelector('#ed-go').onclick = async () => { try { const text = t.value; await Store.act(kind === 'post' ? 'editPost' : 'editComment', { id, text, mentions: mentionsFor('ed-t', text).concat(mentionsFor(key, text)) }); clearMentions('ed-t'); clearMentions(key); closeModal(); toast('Saved.'); } catch(e){ errToast(e); } };
  });
}

/* ---------- 106. saved posts ---------- */
function vSaved(){
  if (!Store.signedIn) return vOnboard();
  const X = ui.saved; if (!X){ ui.saved = 'loading'; Store.http('GET', '/api/saved').then(r => { ui.saved = r.saved; render(); }, e => { ui.saved = { error: e.message }; render(); }); }
  const head = `<div class="pagehead"><div>${backLink('#/u/' + Store.myPid, 'Profile')}<h1 style="margin-top:6px">Saved posts</h1><p class="muted">Only you can see what you save.</p></div></div>`;
  if (!X || X === 'loading') return head + '<div class="loading" style="min-height:20vh">Loading…</div>';
  if (X.error) return head + `<div class="panel empty">${esc(X.error)}</div>`;
  const list = X.filter(x => Store.get('saves', Store.myPid + '__' + x.post.id)).map(x => Store.get('posts', x.post.id) || x.post);
  return head + `<div class="list">${list.map(p => postCard(p, { showGroup: true })).join('') || '<div class="empty">Nothing saved yet. Tap Save on any post to keep it here.</div>'}</div>`;
}

/* ---------- 107. plain-English terms ---------- */
const TERMS = {
  pe: ['P/E ratio', 'Price divided by a year of earnings per share. A P/E of 20 means investors pay $20 for each $1 the company earns. Higher often means people expect faster growth.'],
  yield: ['Dividend yield', "A year of dividends as a percent of the price. A $100 stock paying $3 a year yields 3%. It changes as the price moves."],
  dividend: ['Dividend', 'Cash a company pays shareholders out of its profits, usually every quarter. ETFs pass along the dividends of the stocks they hold.'],
  mcap: ['Market cap', "The company's total value on the stock market: the share price times the number of shares. Large caps are usually steadier than small caps."],
  eps: ['EPS', "Earnings per share: the company's profit divided by its number of shares."],
  beta: ['Beta', 'How much a stock tends to move compared with the whole market. 1 moves with the market; 1.5 swings about 50% more; 0.5 about half as much.'],
  range52: ['52-week range', 'The lowest and highest prices in the past year. It shows how much the price has swung.'],
  volume: ['Volume', 'How many shares changed hands. High volume means lots of buyers and sellers, which usually means fair prices.'],
  expense: ['Expense ratio', "The yearly fee an ETF or fund charges, as a percent of what you have in it. 0.03% is $3 a year on $10,000. It's taken out automatically."],
  etf: ['ETF', 'An exchange-traded fund: one share holds a basket of many stocks or bonds, so you spread your money out in one purchase.'],
  index: ['Index fund', 'A fund that holds every stock in an index, like the S&P 500, instead of picking. Low fees and broad diversification.'],
  market: ['Market order', 'Buy or sell right away at the best price available. Fast, but the price can be a little different from the last quote.'],
  limit: ['Limit order', 'Buy or sell only at your price or better. It may not fill if the price never gets there.'],
  fractional: ['Fractional shares', 'Part of a share. With $50 you can own a slice of a $500 stock.'],
  basis: ['Cost basis', 'What you paid for an investment, including any fees. Your gain or loss is the value now minus the cost basis.'],
  unrealized: ['Unrealized gain', "A gain (or loss) on paper: the investment went up, but you haven't sold. It becomes realized when you sell."],
  totalreturn: ['Total return', 'Everything you made or lost: price change plus dividends, as a percent of what you put in.'],
  diversify: ['Diversification', 'Spreading money across many investments so one bad pick hurts less.'],
  lead: ['Lead Trader', "The group member who places the group's trades. Members get an approval request for each one and decide whether to copy it."],
  risk: ['Risk Manager', 'A group role that can pause a Lead Trader\'s trade for a member vote before anyone gets an approval request.'],
  quorum: ['Quorum', 'The share of eligible members who must vote for a decision to count.'],
  approval: ['Approval request', "When someone you copy trades, you get a request sized to your account. Nothing happens in your account until you approve it."]
};
function term(k, label){ const t = TERMS[k]; if (!t) return esc(label || k); return `<button type="button" class="term" data-act="term" data-k="${k}" aria-label="${esc(label || t[0])}, what it means">${esc(label || t[0])}</button>`; }
function termSheet(k){ const t = TERMS[k]; if (!t) return;
  openModal(`<header><h2>${esc(t[0])}</h2><button class="x" data-close aria-label="Close">×</button></header><p style="margin-top:0">${esc(t[1])}</p><p class="small"><a href="#/glossary" data-close>All terms</a></p>`); }
function vGlossary(){
  return `<div class="pagehead"><div>${backLink('#/help', 'Help')}<h1 style="margin-top:6px">Investing terms</h1><p class="muted">Plain-English meanings. Tap a dotted word anywhere in Pocket to see these.</p></div></div>
  <div class="list">${Object.values(TERMS).sort((a, b) => a[0].localeCompare(b[0])).map(([n, d]) => `<div class="row" style="align-items:flex-start"><div class="grow"><b>${esc(n)}</b><div class="small muted" style="margin-top:2px">${esc(d)}</div></div></div>`).join('')}</div>`;
}

/* ---------- 108. goals ---------- */
function goalCurrent(){
  if (Store.site.realMoney && ui.real && ui.real.account && ui.real.account.equity != null) return Number(ui.real.account.equity) || 0;
  const pf = Store.get('portfolios', Store.myPid); return pf ? Store.portfolioValue(pf) : 0;
}
function goalMath(g, now = Date.now()){
  const cur = goalCurrent(), left = Math.max(0, g.target - cur), months = Math.max(1, Math.round((g.byTs - now) / (30.44 * 86400000)));
  return { cur, left, months, monthly: left / months, pct: Math.max(0, Math.min(1, cur / g.target)) };
}
function goalsCard(){
  if (!Store.signedIn || !Store.get('profiles', Store.myPid)) return '';
  const gs = Store.all('goals').filter(g => g.pid === Store.myPid).sort((a, b) => a.byTs - b.byTs);
  const real = Store.site.realMoney && ui.real && ui.real.account, when = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (!gs.length) return Store.canWrite ? `<a class="panel" href="#/home" data-act="goal" style="display:flex;gap:12px;align-items:center;padding:14px 18px;margin-bottom:18px;color:var(--text)"><span class="avatar" aria-hidden="true" style="background:var(--blue-soft,var(--line));color:var(--blue);border-radius:12px">◎</span><div class="grow"><b>Set a goal</b><div class="small muted">Like $10,000 by 2028. See your progress and what to put in each month.</div></div><span class="small">Add</span></a>` : '';
  return `<section class="block"><header><h2>Your goals</h2>${gs.length < 3 && Store.canWrite ? '<button class="linkbtn small" data-act="goal">Add a goal</button>' : ''}</header><div class="list">${gs.map(g => { const m = goalMath(g);
    return `<div class="row" style="flex-wrap:wrap;align-items:flex-start;row-gap:8px"><div class="grow" style="min-width:200px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(g.name)}</b><span class="small muted">${usd(m.cur, 0)} of ${usd(g.target, 0)}</span></div>
      <div class="goalbar" role="progressbar" aria-label="${esc(g.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m.pct * 100)}"><div style="width:${(m.pct * 100).toFixed(1)}%"></div></div>
      <div class="small muted">${m.left <= 0 ? 'Reached. Nice work.' : `About <b>${usd(m.monthly, 0)} a month</b> gets you there by ${when(g.byTs)}, before any market gains or losses.`}${real ? ' Uses your brokerage balance.' : Store.site.realMoney ? ' Uses your practice balance.' : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${m.left > 0 && Store.canWrite && !Store.site.realMoney ? `<button class="btn sm" data-act="goalrecur" data-id="${g.id}">Invest ${usd(Math.ceil(m.monthly), 0)} monthly</button>` : ''}${Store.canWrite ? `<button class="btn sm ghost" data-act="goal" data-id="${g.id}">Edit</button>` : ''}</div></div>`; }).join('')}</div></section>`;
}
function goalSheet(id){
  const g = id ? Store.get('goals', id) : null, d = g ? new Date(g.byTs) : new Date(Date.now() + 3 * 365 * 86400000);
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  openModal(`<header><h2>${g ? 'Edit goal' : 'Set a goal'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Only you can see your goals. Progress uses your ${Store.site.realMoney && ui.real && ui.real.account ? 'brokerage' : 'practice'} portfolio value.</p>
    <div class="field"><label for="gl-n">What it's for</label><input class="input" id="gl-n" maxlength="60" value="${esc(g ? g.name : '')}" placeholder="e.g. House down payment"></div>
    <div class="grid2"><div class="field"><label for="gl-t">Target amount</label><input class="input num" id="gl-t" inputmode="decimal" value="${g ? g.target : 10000}"></div>
    <div class="field"><label for="gl-d">By</label><input class="input" id="gl-d" type="month" value="${ym}"></div></div>
    <button class="btn" id="gl-go" style="width:100%">${g ? 'Save goal' : 'Add goal'}</button>${g ? '<button class="btn ghost" id="gl-del" style="width:100%;margin-top:10px">Remove goal</button>' : ''}`, sh => {
    sh.querySelector('#gl-go').onclick = async () => { try { const [y, mo] = (sh.querySelector('#gl-d').value || ym).split('-').map(Number); const byTs = new Date(y, mo, 0, 12).getTime();
      await Store.act('setGoal', { id: g ? g.id : undefined, name: sh.querySelector('#gl-n').value, target: Number(String(sh.querySelector('#gl-t').value).replace(/[$,\s]/g, '')), byTs }); closeModal(); toast(g ? 'Goal saved.' : 'Goal added.'); } catch(e){ errToast(e); } };
    const del = sh.querySelector('#gl-del'); if (del) del.onclick = async () => { if (!confirm('Remove this goal?')) return; try { await Store.act('deleteGoal', { id: g.id }); closeModal(); toast('Goal removed.'); } catch(e){ errToast(e); } };
  });
}

/* ---------- 110. interests ---------- */
const INTERESTS = ['Dividends', 'Growth', 'Tech', 'Index funds', 'Value', 'Beginners', 'ESG', 'Healthcare', 'Energy', 'Consumer brands', 'Banks and finance', 'Real estate'];
function myInterests(){ return ((Store.get('profiles', Store.myPid) || {}).interests || []).filter(x => INTERESTS.includes(x)); }
const INTEREST_MATCH = {
  Dividends: { words: /dividend|yield|income|payout/i, sectors: ['Dividend ETF'], tags: ['Dividends'] },
  Growth: { words: /growth|grow|compounding|long[- ]term/i, tags: ['Growth'] },
  Tech: { words: /\btech|\bAI\b|chip|software|cloud/i, sectors: ['Technology', 'Communication'] },
  'Index funds': { words: /index|S&P|\bETFs?\b|passive/i, sectors: ['Broad market ETF'], tags: ['Index'] },
  Value: { words: /value|undervalued|cheap|bargain|P\/E/i, tags: ['Value'] },
  Beginners: { words: /beginner|first (stock|trade)|learn|start(ed|ing)? invest/i, tags: ['Beginners'] },
  ESG: { words: /ESG|sustainab|clean energy|climate|green/i },
  Healthcare: { words: /health|pharma|biotech|medic/i, sectors: ['Health care'] },
  Energy: { words: /energy|oil|gas|solar|utilit/i, sectors: ['Energy'] },
  'Consumer brands': { words: /brand|retail|consumer|restaurant|shopping/i, sectors: ['Consumer', 'Consumer staples'], tags: ['Consumer brands'] },
  'Banks and finance': { words: /bank|financ|interest rate|credit/i, sectors: ['Financials'] },
  'Real estate': { words: /real estate|REIT|housing|property/i, sectors: ['Real estate'] }
};
function interestScore(text, syms, tags, ints){
  let n = 0; for (const k of ints){ const m = INTEREST_MATCH[k]; if (!m) continue;
    if (m.words && m.words.test(text || '')) n++;
    if (m.sectors && syms.some(s => m.sectors.includes(SECTOR[s]))) n++;
    if (m.tags && (tags || []).some(t => m.tags.includes(t))) n++; }
  return n;
}
function postSyms(p){ const out = new Set(); if (p.trade) out.add(p.trade.sym); String(p.text || '').replace(/\$([A-Z]{1,5})\b/g, (m, s) => { if (Market.MAP[s]) out.add(s); return m; }); return [...out]; }
/* For you: every public post, interest matches first, weighted by likes and freshness. Nothing is hidden. */
function forYou(posts, ints){
  const likes = {}; Store.all('reactions').forEach(r => { likes[r.postId] = (likes[r.postId] || 0) + 1; });
  const leads = {}; Store.all('memberships').filter(m => m.role === 'lead' || m.role === 'owner').forEach(m => { const g = Store.get('groups', m.gid); if (g) (leads[m.pid] = leads[m.pid] || []).push(...groupTags(g)); });
  const fol = new Set(Store.all('follows').filter(f => f.from === Store.myPid).map(f => f.to)), now = Date.now();
  return posts.map(p => { const age = (now - p.ts) / 86400000;
    const s = interestScore(p.text, postSyms(p), leads[p.pid], ints) * 3 + Math.log2(1 + (likes[p.id] || 0)) + (fol.has(p.pid) ? 1.5 : 0) - Math.min(6, age / 2);
    return [p, s]; }).sort((a, b) => b[1] - a[1] || b[0].ts - a[0].ts).map(x => x[0]);
}
function interestsSheet(after){
  const cur = new Set(myInterests());
  openModal(`<header><h2>What are you interested in?</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Pick a few. They shape your For you feed and the groups and investors we suggest. Only you can see them.</p>
    <div class="chips" role="group" aria-label="Interests" style="margin-bottom:16px">${INTERESTS.map(k => `<button type="button" class="${cur.has(k) ? 'on' : ''}" aria-pressed="${cur.has(k)}" data-int="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <button class="btn" id="in-go" style="width:100%">Save</button>`, sh => {
    sh.querySelectorAll('[data-int]').forEach(b => b.onclick = () => { const on = !cur.has(b.dataset.int); on ? cur.add(b.dataset.int) : cur.delete(b.dataset.int); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    sh.querySelector('#in-go').onclick = async () => { try { await Store.act('setInterests', { list: [...cur] }); closeModal(); toast(cur.size ? 'Saved. Your For you feed now follows these.' : 'Saved.'); if (after) after(); } catch(e){ errToast(e); } };
  });
}
/* Groups and Lead Traders that match your interests (used on Explore). */
function suggestedForInterests(n = 4){
  const ints = myInterests(); if (!ints.length) return { groups: [], leads: [] };
  const mine = new Set(Store.myGroups().map(g => g.id));
  const groups = Store.all('groups').filter(g => !mine.has(g.id) && !g.closed).map(g => [g, interestScore((g.name || '') + ' ' + (g.strategy || '') + ' ' + (g.description || '') + ' ' + (g.goals || ''), [], groupTags(g), ints)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  const fol = new Set(Store.all('follows').filter(f => f.from === Store.myPid).map(f => f.to));
  const scoreP = {}; Store.all('posts').filter(p => !p.groupId && p.pid !== Store.myPid && !fol.has(p.pid)).forEach(p => { scoreP[p.pid] = (scoreP[p.pid] || 0) + interestScore(p.text, postSyms(p), [], ints); });
  const leads = Object.entries(scoreP).filter(x => x[1] > 0 && Store.get('profiles', x[0])).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => Store.get('profiles', x[0]));
  return { groups, leads };
}
function interestSuggestions(){
  if (!Store.signedIn) return '';
  const { groups, leads } = suggestedForInterests(); if (!groups.length && !leads.length) return '';
  return `<section class="block"><header><h2>For your interests</h2><button class="linkbtn small" data-act="interests">Change interests</button></header><div class="list">
    ${groups.map(g => `<a class="row" href="#/group/${g.id}"><div class="grow"><b>${esc(g.name)}</b><div class="small muted ellip">${esc(groupTags(g).join(' · ') || g.strategy || '')}</div></div><span class="small">Group</span></a>`).join('')}
    ${leads.map(p => personRow(p)).join('')}</div></section>`;
}

/* ---------- 96. one-click unsubscribe page ---------- */
function vUnsub(token){
  ui.unsub = ui.unsub || {}; const S = ui.unsub[token];
  if (!S){ ui.unsub[token] = { state: 'loading' }; Store.http('GET', '/api/unsubscribe/' + encodeURIComponent(token)).then(r => { ui.unsub[token] = { state: 'ask', label: r.label }; render(); }, e => { ui.unsub[token] = { state: 'error', msg: e.message }; render(); }); }
  const v = ui.unsub[token];
  return `<div class="panel" style="padding:24px;max-width:520px;margin:30px auto">${v.state === 'loading' ? '<p>One moment…</p>'
    : v.state === 'ask' ? `<h1>Stop ${esc(v.label)} emails?</h1><p class="muted">You'll still see these in the app. Security emails, like password resets, always go out.</p><button class="btn" data-act="unsubgo" data-k="${esc(token)}">Turn off ${esc(v.label)} emails</button>`
    : v.state === 'done' ? `<h1>Done</h1><p class="muted">You won't get ${esc(v.label)} emails anymore. You can turn them back on any time in Profile, Notifications.</p><a class="btn ghost" href="#/home">Go to Pocket</a>`
    : `<h1>That link didn't work</h1><p class="muted">${esc(v.msg)}</p><a class="btn ghost" href="#/settings">Email settings</a>`}</div>`;
}

/* ---------- actions for the items above ---------- */
async function act2(a, el, ev, busy, id){
  switch (a){
    case 'savepost': return busy(async () => { const r = await Store.act('toggleSave', { postId: id }); toast(r && r.saved ? 'Saved. Find it in Profile, Saved posts.' : 'Removed from saved.'); if (ui.saved && Array.isArray(ui.saved) && !(r && r.saved)) ui.saved = ui.saved.filter(x => x.post.id !== id); });
    case 'editpost': return editSheet('post', id);
    case 'editcomment': return editSheet('comment', id);
    case 'term': ev && ev.preventDefault(); return termSheet(el.dataset.k);
    case 'goal': ev && ev.preventDefault(); return goalSheet(id);
    case 'goalrecur': { const g = Store.get('goals', id); if (!g) return; const m = goalMath(g); return recurringSheet('SPY', { amount: Math.ceil(m.monthly), freq: 'monthly' }); }
    case 'interests': ev && ev.preventDefault(); return interestsSheet(() => render());
    case 'unsubgo': return busy(async () => { const t = el.dataset.k; const r = await Store.http('POST', '/api/unsubscribe/' + encodeURIComponent(t)); ui.unsub[t] = { state: 'done', label: r.label }; if (Store.refreshMe) Store.refreshMe().catch(() => {}); render(); });
    case 'adm-quickinv': return busy(async () => { const r = await Store.http('POST', '/api/admin/invite', { label: 'Quick invite ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), maxUses: 1 }); if (typeof loadAdmin === 'function') await loadAdmin(); inviteReadySheet(r.code || (r.invite || {}).code); });
    case 'adm-shareinv': return shareInvite(el.dataset.k);
    case 'mydata': return busy(async () => { const r = await fetch('/api/export/my-data', { credentials: 'same-origin' }); if (!r.ok){ const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || 'Download failed.'), { userFacing: true }); }
      const blob = await r.blob(), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `pocket-investing-data-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Downloaded your data.'); });
  }
}
/* Admin log filter: re-render as you type, keeping the cursor in the box. */
document.addEventListener('input', e => { const el = e.target; if (!el || !el.matches || !el.matches('[data-filter="alog"]')) return; ui.alogQ = el.value; const c = el.selectionStart; render(); const n = document.getElementById('alog-q'); if (n){ n.focus(); try { n.setSelectionRange(c, c); } catch(x){} } });

/* Item 109: Tab stays inside an open sheet. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return; const sh = document.querySelector('#modal .sheet'); if (!sh) return;
  const f = [...sh.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
  if (!f.length) return; const first = f[0], last = f[f.length - 1];
  if (!sh.contains(document.activeElement)){ e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});

/* Item 120: an invite code ready to send in one or two taps. */
function inviteLink(code){ return location.origin + '/#/signup/' + encodeURIComponent(code); }
function inviteMessage(code){ return `You're invited to Pocket Investing${Store.site.realMoney ? '' : ' (beta, practice money)'}. Create your account here: ${inviteLink(code)}\nInvite code: ${code}`; }
async function shareInvite(code){
  const text = inviteMessage(code);
  if (navigator.share){ try { await navigator.share({ title: 'Pocket Investing invite', text }); return; } catch(e){ if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Invite message copied.'); } catch(e){ prompt('Copy this invite:', text); }
}
function inviteReadySheet(code){
  if (!code) return;
  openModal(`<header><h2>Invite ready</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Code <b class="num" style="font-size:20px">${esc(code)}</b> works on this site (${esc(location.host)}).</p>
    <div class="field"><label for="ir-l">Sign-up link</label><input class="input" id="ir-l" readonly value="${esc(inviteLink(code))}" data-nofocus></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="ir-share" style="flex:1">${navigator.share ? 'Share' : 'Copy invite message'}</button><button class="btn ghost" id="ir-copy" style="flex:1">Copy link</button></div>`, sh => {
    sh.querySelector('#ir-share').onclick = () => shareInvite(code);
    sh.querySelector('#ir-copy').onclick = async () => { try { await navigator.clipboard.writeText(inviteLink(code)); toast('Sign-up link copied.'); } catch(e){ sh.querySelector('#ir-l').select(); } };
  });
}
