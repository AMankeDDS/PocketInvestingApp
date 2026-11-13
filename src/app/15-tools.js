/* Search (stocks, people, groups), price alerts, and copy protection (stop-loss). */
function searchSheet(){
  let recent = []; try { recent = JSON.parse(localStorage.getItem('pi_recent') || '[]'); } catch(e){}
  openModal(`<header><h2>Search</h2><button class="x" data-close aria-label="Close">×</button></header>
    <div class="field"><label for="sq">Stocks, people and groups</label><input class="input" id="sq" type="search" autocomplete="off" placeholder="e.g. Apple, KO, Maya, Tech Momentum"></div>
    <div id="sr" aria-live="polite"></div>`, sh => {
    const box = sh.querySelector('#sq'), out = sh.querySelector('#sr');
    const row = (href, title, sub, key) => `<a class="row" href="${href}" data-recent="${key || ''}"><div class="grow"><b>${title}</b><div class="small muted">${sub}</div></div><span class="muted">›</span></a>`;
    let draw = () => {
      const t = box.value.trim().toLowerCase();
      if (!t){ out.innerHTML = recent.length ? `<p class="small muted" style="margin:6px 0">Recent</p><div class="list">${recent.filter(s => Market.MAP[s]).map(s => row('#/stock/' + s, s, esc(Market.MAP[s].n), s)).join('')}</div>` : '<p class="hint">Search by company name or ticker, a member\'s name, or a group.</p>'; return; }
      const stocks = Market.LIST.filter(x => x.s.toLowerCase().startsWith(t) || x.n.toLowerCase().includes(t)).sort((a, b) => (b.s.toLowerCase() === t) - (a.s.toLowerCase() === t) || (b.s.toLowerCase().startsWith(t)) - (a.s.toLowerCase().startsWith(t))).slice(0, 8);
      const people = Store.all('profiles').filter(p => p.name && p.name.toLowerCase().includes(t) && p.id !== Store.myPid).slice(0, 5);
      const groups = Store.all('groups').filter(g => !Store.rulesOf(g).hidden && ((g.name || '').toLowerCase().includes(t) || groupTags(g).some(x => x.toLowerCase().includes(t)))).slice(0, 5);
      out.innerHTML = (stocks.length ? `<p class="small muted" style="margin:6px 0">Stocks</p><div class="list">${stocks.map(x => row('#/stock/' + x.s, x.s + ' <span class="muted" style="font-weight:400">' + esc(x.n) + '</span>', `${usd(Market.price(x.s))} · <span class="${Market.dayChange(x.s) >= 0 ? 'gain' : 'loss'}">${pct(Market.dayChange(x.s))}</span> today`, x.s)).join('')}</div>` : '')
        + (people.length ? `<p class="small muted" style="margin:10px 0 6px">People</p><div class="list">${people.map(p => row('#/u/' + p.id, esc(p.name), p.kind === 'demo' ? 'Sample investor' : 'Member')).join('')}</div>` : '')
        + (groups.length ? `<p class="small muted" style="margin:10px 0 6px">Groups</p><div class="list">${groups.map(g => row('#/group/' + g.id, esc(g.name), esc(groupTags(g).join(' · ') || (g.tagline || g.goal || '').slice(0, 70)))).join('')}</div>` : '')
        || '<div class="panel empty">No matches. Try a ticker like AAPL, or part of a name.</div>';
    };
    /* Stocks not yet on Pocket come from the full list of US-listed stocks; tapping one adds it. */
    const remote = {}; let tmr = 0;
    const fetchRemote = t => { if (!Store.site.marketData || !t || remote[t]) return; clearTimeout(tmr); tmr = setTimeout(() => { remote[t] = 'loading'; Store.searchStocks(t).then(r => { remote[t] = r || []; if (box.value.trim().toLowerCase() === t) draw(); }, () => { remote[t] = []; }); }, 250); };
    const base = draw; draw = () => { base(); const t = box.value.trim().toLowerCase(); if (!t) return; fetchRemote(t);
      const R = Array.isArray(remote[t]) ? remote[t].filter(x => !Market.MAP[x.s]).slice(0, 6) : [];
      if (R.length){ const html = `<p class="small muted" style="margin:10px 0 6px">More US stocks</p><div class="list">${R.map(x => row('#/stock/' + x.s, x.s + ' <span class="muted" style="font-weight:400">' + esc(x.n) + '</span>', 'Tap to add it to Pocket', x.s)).join('')}</div>`;
        if (out.querySelector('.panel.empty')) out.innerHTML = html; else out.insertAdjacentHTML('beforeend', html); }
      else if (remote[t] === 'loading' && out.querySelector('.panel.empty')) out.innerHTML = '<div class="loading">Searching all US stocks…</div>'; };
    box.oninput = draw; draw(); setTimeout(() => box.focus(), 50);
    out.onclick = e => { const a = e.target.closest('a[data-recent]'); if (!a) return; const k = a.dataset.recent;
      if (k){ recent = [k].concat(recent.filter(x => x !== k)).slice(0, 6); try { localStorage.setItem('pi_recent', JSON.stringify(recent)); } catch(err){} } closeModal(); };
  });
}
function vAlerts(){
  if (!Store.signedIn) return vProfile(null);
  const X = ui.alerts; if (!X){ ui.alerts = 'loading'; Store.http('GET', '/api/alerts').then(r => { ui.alerts = r; render(); }, e => { ui.alerts = { error: e.message }; render(); }); }
  if (!X || X === 'loading') return '<div class="loading">Loading your alerts…</div>'; if (X.error) return `<div class="panel empty">${esc(X.error)}</div>`;
  const W = { above: 'Rises above', below: 'Falls below', move: 'Moves more than' }, fmt = a => a.kind === 'move' ? a.value + '% in a day' : usd(a.value);
  const act = X.alerts.filter(a => a.active), done = X.alerts.filter(a => !a.active);
  return `<div class="pagehead"><div><a href="#/u/${Store.myPid}" class="small">← Profile</a><h1 style="margin-top:6px">Price alerts</h1><p class="muted">Push and in-app notifications, checked every minute. Each alert fires once.</p></div></div>
    <section class="panel" style="padding:16px 18px"><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="al-w" ${X.watchMoves ? 'checked' : ''} style="margin-top:4px"><span><b>Big moves in my watchlist</b><span class="small muted" style="display:block">Once a day per stock, when it moves more than the amount below.</span></span></label>
      <div class="field" style="margin:10px 0 0;max-width:220px"><label for="al-t">Move size</label><select class="input" id="al-t">${[3, 5, 10].map(v => `<option value="${v}" ${X.threshold == v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
      <button class="btn sm" data-act="alertprefs" style="margin-top:10px">Save</button></section>
    <section class="block"><header><h2>Active (${act.length})</h2></header><div class="list">${act.map(a => `<div class="row"><div class="grow"><a href="#/stock/${a.sym}"><b class="sym">${a.sym}</b></a> <span class="small">${W[a.kind]} ${fmt(a)}</span><div class="small muted">Now ${usd(Market.price(a.sym))}</div></div><button class="btn sm ghost" data-act="alertdel" data-id="${a.id}">Remove</button></div>`).join('') || '<div class="empty">No active alerts. Open any stock and choose Set alert.</div>'}</div></section>
    ${done.length ? `<section class="block"><header><h2>Triggered</h2></header><div class="list">${done.slice(0, 20).map(a => `<div class="row"><div class="grow"><b class="sym">${a.sym}</b> <span class="small muted">${W[a.kind]} ${fmt(a)}${a.triggered_price ? ', at ' + usd(a.triggered_price) : ''}</span></div><span class="small muted">${a.triggered_at ? ago(new Date(a.triggered_at).getTime()) + ' ago' : ''}</span></div>`).join('')}</div></section>` : ''}`;
}
function alertSheet(sym){
  const p = Market.price(sym);
  openModal(`<header><h2>Alert for ${esc(sym)}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">Now ${usd(p)}. We'll notify you once when this happens.</p>
    <div class="field"><label for="as-k">When ${esc(sym)}</label><select class="input" id="as-k"><option value="above">rises above a price</option><option value="below">falls below a price</option><option value="move">moves more than a % in a day</option></select></div>
    <div class="field"><label for="as-v" id="as-vl">Price ($)</label><input class="input num" id="as-v" type="number" step="any" min="0" inputmode="decimal" value="${(p * 1.05).toFixed(2)}"></div>
    <div class="hint" id="as-why" style="margin:-6px 0 14px"></div><button class="btn" id="as-go" style="width:100%">Set alert</button>`, sh => {
    const k = sh.querySelector('#as-k'), v = sh.querySelector('#as-v'), go = sh.querySelector('#as-go'), why = sh.querySelector('#as-why');
    const upd = () => { const val = parseFloat(v.value);
      whyNot(why, go, !(val > 0) ? 'Enter a value to continue.' : k.value === 'above' && val <= p ? `${sym} is already at ${usd(p)}. Pick a price above that.` : k.value === 'below' && val >= p ? `${sym} is already at ${usd(p)}. Pick a price below that.` : '', ''); };
    k.onchange = () => { sh.querySelector('#as-vl').textContent = k.value === 'move' ? 'Move size (%)' : 'Price ($)'; v.value = k.value === 'move' ? '5' : (p * (k.value === 'above' ? 1.05 : 0.95)).toFixed(2); upd(); };
    v.oninput = upd; upd();
    go.onclick = async () => { go.disabled = true; try { await Store.http('POST', '/api/alerts', { sym, kind: k.value, value: parseFloat(v.value) }); ui.alerts = null; closeModal(); toast('Alert set. Manage alerts in Profile.'); } catch(e){ errToast(e); go.disabled = false; } };
  });
}
function copyStopSheet(o){
  const rel = o.gid ? Store.membership(o.gid) || {} : Store.all('copies').find(c => c.from === Store.myPid && c.to === o.pid) || {};
  const who = o.gid ? ((Store.get('groups', o.gid) || {}).name || 'this group') : Store.displayName(o.pid);
  openModal(`<header><h2>Protect your copies</h2><button class="x" data-close aria-label="Close">×</button></header>
    <p class="muted" style="margin-top:0">For stocks you got by copying ${esc(who)}: if one falls far enough below what you paid, Pocket steps in. Applies to practice and real money.</p>
    ${rel.copyPaused ? `<div class="why-not">Copies from ${esc(who)} are paused because a stock passed your limit. Save to resume them.</div>` : ''}
    <div class="field"><label for="cs-p">If a copied stock falls below what I paid by</label><select class="input" id="cs-p"><option value="">Off</option>${[10, 15, 20, 25, 30].map(v => `<option value="${v}" ${rel.stopPct == v ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
    <div class="field"><label for="cs-a">Then</label><select class="input" id="cs-a"><option value="ask" ${rel.stopAction !== 'stop' ? 'selected' : ''}>Ask me to sell it (you approve, as always)</option><option value="stop" ${rel.stopAction === 'stop' ? 'selected' : ''}>Stop copying ${esc(who)} (keep what I have)</option></select></div>
    <p class="hint">Nothing is sold without your approval. Checked every couple of minutes while the market is open.</p>
    <button class="btn" id="cs-go" style="width:100%">Save</button>`, sh => {
    sh.querySelector('#cs-go').onclick = async () => { const b = sh.querySelector('#cs-go'); b.disabled = true;
      try { await Store.setCopyStop({ gid: o.gid || null, pid: o.pid || null, pct: sh.querySelector('#cs-p').value || null, action: sh.querySelector('#cs-a').value, resume: true }); closeModal(); toast('Saved.'); } catch(e){ errToast(e); b.disabled = false; } };
  });
}
/* Appearance: Automatic (follows the phone), Light or Dark; saved on this device. */
function themePref(){ try { return localStorage.getItem('pi_theme') || 'auto'; } catch(e){ return 'auto'; } }
function applyTheme(){ const t = themePref(); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
try { applyTheme(); } catch(e){}
/* Group tags: stored as a list; groups from before tags keep their category as a tag. */
const STD_TAGS = ['Growth', 'Dividends', 'Value', 'Beginners', 'Index', 'Consumer brands'];
function groupTags(g){ if (!g) return []; if (Array.isArray(g.tags)) return g.tags; const c = CATS.find(x => x[0] === g.category); return c ? [c[1]] : []; }
function popularTags(min = 3){ const n = {}; Store.all('groups').forEach(g => groupTags(g).forEach(t => { if (!STD_TAGS.includes(t)) { const k = t.toLowerCase(); n[k] = n[k] || { t, c: 0 }; n[k].c++; } })); return Object.values(n).filter(x => x.c >= min).sort((a, b) => b.c - a.c).map(x => x.t); }
function tagField(id, initial){ return `<div class="field"><label for="${id}-in">Tags <span class="muted small" style="font-weight:400">up to 3</span></label><div class="taginput" id="${id}" data-tags="${esc(JSON.stringify(initial || []))}"><span class="tagchips"></span><input class="input" id="${id}-in" maxlength="20" placeholder="Add a tag, e.g. Meme stocks" autocomplete="off"></div><div class="tagsugs" id="${id}-sug"></div><div class="hint" id="${id}-why" style="color:var(--loss);min-height:1em"></div></div>`; }
function mountTagField(sh, id){
  const box = sh.querySelector('#' + id), inp = sh.querySelector('#' + id + '-in'), sug = sh.querySelector('#' + id + '-sug'), why = sh.querySelector('#' + id + '-why');
  let tags = JSON.parse(box.dataset.tags || '[]');
  const known = () => { const m = new Map(); STD_TAGS.concat(Store.all('groups').flatMap(groupTags)).forEach(t => { if (!m.has(t.toLowerCase())) m.set(t.toLowerCase(), t); }); return m; };
  const draw = () => { box.dataset.tags = JSON.stringify(tags);
    box.querySelector('.tagchips').innerHTML = tags.map((t, i) => `<span class="tagchip">${esc(t)}<button type="button" data-i="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join('');
    box.querySelectorAll('.tagchip button').forEach(b => b.onclick = () => { tags.splice(+b.dataset.i, 1); why.textContent = ''; draw(); });
    const t = inp.value.trim().toLowerCase(), pool = STD_TAGS.concat(popularTags(1)).filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i);
    sug.innerHTML = tags.length >= 3 ? '' : pool.filter(x => !tags.some(y => y.toLowerCase() === x.toLowerCase()) && (!t || x.toLowerCase().includes(t))).slice(0, 8).map(x => `<button type="button">${esc(x)}</button>`).join('');
    sug.querySelectorAll('button').forEach(b => b.onclick = () => add(b.textContent)); };
  const add = raw => { const t = String(raw || '').replace(/\s+/g, ' ').trim(); if (!t) return;
    if (tags.length >= 3){ why.textContent = 'Up to 3 tags. Remove one to add another.'; return; }
    if (t.length > 20){ why.textContent = 'Tags can be up to 20 characters.'; return; }
    if (!/^[A-Za-z0-9 ]+$/.test(t)){ why.textContent = 'Tags can only use letters, numbers and spaces.'; return; }
    if (tags.some(x => x.toLowerCase() === t.toLowerCase())) { inp.value = ''; draw(); return; }
    tags.push(known().get(t.toLowerCase()) || t); inp.value = ''; why.textContent = ''; draw(); };
  inp.onkeydown = e => { if (e.key === 'Enter' || e.key === ','){ e.preventDefault(); add(inp.value); } else if (e.key === 'Backspace' && !inp.value && tags.length){ tags.pop(); draw(); } };
  inp.oninput = draw; inp.onblur = () => { if (inp.value.trim()) add(inp.value); };
  draw();
}
const getTags = (sh, id) => { const inp = sh.querySelector('#' + id + '-in'); const t = JSON.parse(sh.querySelector('#' + id).dataset.tags || '[]'); const extra = inp && inp.value.replace(/\s+/g, ' ').trim(); return extra && t.length < 3 && !t.some(x => x.toLowerCase() === extra.toLowerCase()) ? t.concat([extra]) : t; };
/* Group icon: the group's photo, or its first letter. */
function gAvatar(g, size){ const st = size ? `width:${size}px;height:${size}px;` : ''; return g && g.photoV ? `<div class="avatar" style="${st}border-radius:12px"><img src="/api/photo/g_${esc(g.id)}?s=small&v=${g.photoV}" alt="" loading="lazy"></div>` : `<div class="avatar" style="${st}background:${AV[Market.hash(g.id) % AV.length]};border-radius:12px">${esc((g.name || '?').slice(0, 1))}</div>`; }
/* Photo picker: choose, position with a zoom slider, then save a large and a small copy. Re-encoding drops location data. */
function photoSheet(o){
  const isG = o.target === 'group', g = isG ? Store.get('groups', o.gid) : null, has = isG ? !!(g && g.photoV) : !!((Store.get('profiles', Store.myPid) || {}).photoV);
  openModal(`<header><h2>${isG ? 'Group photo' : 'Your photo'}</h2><button class="x" data-close aria-label="Close">×</button></header>
    <canvas class="phprev" id="ph-c" width="400" height="400" aria-label="Photo preview"></canvas>
    <div class="field"><label for="ph-f">Choose a photo</label><input class="input" id="ph-f" type="file" accept="image/*" data-nofocus></div>
    <div class="field" id="ph-zw" hidden><label for="ph-z">Zoom</label><input id="ph-z" type="range" min="1" max="3" step="0.01" value="1" style="width:100%"></div>
    <p class="hint">${isG ? 'Shown on the group page and in group lists.' : 'Shown on your profile, posts and groups.'} No logos you don't own, no photos of other people without permission. Location data is removed.</p>
    <div class="hint" id="ph-e" style="color:var(--loss);min-height:1.2em"></div>
    <button class="btn" id="ph-go" style="width:100%" disabled>Save photo</button>${has ? '<button class="btn ghost" id="ph-rm" style="width:100%;margin-top:8px">Remove photo</button>' : ''}`, sh => {
    const c = sh.querySelector('#ph-c'), x = c.getContext('2d'), z = sh.querySelector('#ph-z'); let img = null, ox = 0, oy = 0, drag = null;
    const draw = () => { x.fillStyle = '#ddd'; x.fillRect(0, 0, 400, 400); if (!img) return; const s0 = Math.min(img.width, img.height) / +z.value, sx = Math.min(Math.max(0, (img.width - s0) / 2 + ox), img.width - s0), sy = Math.min(Math.max(0, (img.height - s0) / 2 + oy), img.height - s0); x.drawImage(img, sx, sy, s0, s0, 0, 0, 400, 400); };
    sh.querySelector('#ph-f').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { img = await createImageBitmap(f); ox = oy = 0; z.value = 1; sh.querySelector('#ph-zw').hidden = false; sh.querySelector('#ph-go').disabled = false; sh.querySelector('#ph-e').textContent = ''; draw(); } catch(err){ sh.querySelector('#ph-e').textContent = "That file couldn't be opened. Try a JPEG or PNG photo."; } };
    z.oninput = draw;
    c.onpointerdown = e => { drag = [e.clientX, e.clientY, ox, oy]; c.setPointerCapture(e.pointerId); };
    c.onpointermove = e => { if (!drag || !img) return; const k = Math.min(img.width, img.height) / +z.value / 200; ox = drag[2] - (e.clientX - drag[0]) * k; oy = drag[3] - (e.clientY - drag[1]) * k; draw(); };
    c.onpointerup = () => { drag = null; };
    const out = size => { const o2 = document.createElement('canvas'); o2.width = o2.height = size; o2.getContext('2d').drawImage(c, 0, 0, size, size); return o2.toDataURL('image/jpeg', size > 200 ? 0.85 : 0.8); };
    sh.querySelector('#ph-go').onclick = async () => { const b = sh.querySelector('#ph-go'); b.disabled = true; try { await Store.http('POST', '/api/photo', { target: o.target, gid: o.gid, big: out(400), small: out(96) }); closeModal(); toast('Photo saved.'); } catch(err){ sh.querySelector('#ph-e').textContent = err.message; b.disabled = false; } };
    const rm = sh.querySelector('#ph-rm'); if (rm) rm.onclick = async () => { try { await Store.http('POST', '/api/photo/remove', { target: o.target, gid: o.gid }); closeModal(); toast('Photo removed.'); } catch(err){ sh.querySelector('#ph-e').textContent = err.message; } };
    draw();
  });
}

function lowPriceNote(sym){ const p = Market.price(sym); return p > 0 && p < 5 ? '<div class="banner text ember" style="margin:10px 0;font-size:14px"><b>Low-priced stock.</b> Stocks under $5 can be very volatile and easier to manipulate.</div>' : ''; }
/* Badges: Founding member (accounts before the cutoff, or every account if no cutoff is set), automatic role badges, and badges the Pocket team awards. */
function memberBadges(p, extra = []){
  if (!p) return []; const out = [];
  if (p.kind === 'demo') out.push({ n: 'Sample investor', c: '', d: 'A sample account used to show how Pocket works.' });
  else { const f = Store.get('badges', 'founding') || {}; if (!f.cutoff || (p.createdTs || 0) < Date.parse(f.cutoff + 'T00:00:00Z')) out.push({ n: 'Founding member', c: 'ember', d: f.desc || 'Joined Pocket before its public launch.' }); }
  extra.forEach(x => x && out.push(x)); { const lb = typeof leaderBadge === 'function' ? leaderBadge(p.id) : null; if (lb) out.push(lb); }
  (p.badges || []).map(id => Store.get('badges', id)).filter(b => b && !b.retired && !b.builtin).forEach(b => out.push({ n: b.name, c: b.color || 'blue', d: b.desc || '' }));
  if (typeof autoBadges === 'function') autoBadges(p).forEach(b => out.push(b));
  return out;
}
