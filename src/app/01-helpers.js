/* Small shared helpers: formatting, time, avatars and rows. */

/* When a button can't be used, say why right above it: a highlighted note with what to do next,
   linked to the button for screen readers. With no reason, the note returns to a normal hint. */
function whyNot(note, btn, reason, hint){
  if (!note) return;
  if (reason){ note.className = 'why-not'; note.textContent = reason; note.style.color = ''; }
  else { note.className = 'hint'; note.textContent = hint || ''; }
  if (btn){ btn.disabled = !!reason; if (reason){ btn.setAttribute('aria-describedby', note.id); btn.title = reason; } else { btn.removeAttribute('aria-describedby'); btn.removeAttribute('title'); } }
}
function ago(ts){ const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }

function left(ms){ if (ms <= 0) return '0:00'; const m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000); if (m >= 60) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; return m + ':' + String(s).padStart(2, '0'); }

function timeLeft(ts){ const d = ts - Date.now(); if (d <= 0) return 'Voting closed'; const h = d / 3600000; return h >= 24 ? Math.ceil(h / 24) + ' days left' : h >= 1 ? Math.floor(h) + ' hours left' : Math.ceil(d / 60000) + ' minutes left'; }

function avatar(pid, cls = ''){ const pp = Store.get('profiles', pid); if (pp && pp.photoV) return `<span class="avatar ${cls}" aria-hidden="true"><img src="/api/photo/${esc(pid)}?s=${/lg|xl|big/.test(cls) ? 'big' : 'small'}&v=${pp.photoV}" alt="" loading="lazy"></span>`; const n = Store.displayName(pid); const ini = n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·'; return `<span class="avatar ${cls}" style="background:${AV[Market.hash(pid) % AV.length]}" aria-hidden="true">${esc(ini)}</span>`; }

function mini(sym){ needBars(sym, '1d'); let v = Market.series(sym, 86400000, 24); /* real prices: the latest session from yesterday's close, so the line agrees with "% today" */ if (Market.isReal(sym)){ const c = Market.dayChange(sym), px = Market.price(sym), S = Market.sessionPts(sym); if (S.length >= 2){ const st = Math.max(1, Math.ceil(S.length / 40)); v = [px / (1 + (c || 0))].concat(S.filter((_, i) => i % st === 0).map(b => b.c), [px]); } else if (c) v[0] = px / (1 + c); } const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1, up = v[v.length - 1] >= v[0];
  return `<svg class="mini" viewBox="0 0 64 22" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${up ? 'var(--gain)' : 'var(--loss)'}" stroke-width="1.6" points="${v.map((x, i) => (i / (v.length - 1) * 64).toFixed(1) + ',' + (20 - (x - mn) / rg * 18).toFixed(1)).join(' ')}"/></svg>`; }

function stackOf(pids, max = 3){ const show = pids.slice(0, max); const names = show.map(p => Store.displayName(p).split(' ')[0]);
  const label = pids.length <= max ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : names.join(', ') + ' and ' + (pids.length - max) + ' others';
  return { html: `<span class="stack">${show.map(p => avatar(p, 'sm')).join('')}</span>`, label }; }

function agoText(t){ const a = ago(t); return a === 'now' ? 'just now' : a + ' ago'; }

function stockRow(sym, right){ const t = Market.MAP[sym], c = Market.dayChange(sym); return `<a class="row" href="#/stock/${sym}">${logo(sym)}<div class="grow"><div class="sym">${sym}</div><div class="small muted ellip">${esc(t ? t.n : '')}</div></div>${mini(sym)}<div class="r" style="min-width:86px">${right || `<div class="num" data-px="${sym}">${usd(Market.price(sym))}</div><div class="small num ${sgn(c)}" data-chg="${sym}">${pct(c)}</div>`}</div></a>`; }

function nextDividend(sym){ const y = DIV_YIELDS[sym]; if (!y) return null; const monthly = sym === 'O', off = Market.hash(sym) % 3, d = new Date(); d.setUTCHours(12, 0, 0, 0);
  for (let i = 0; i < 400; i++){ if (d.getUTCDate() === 15 && (monthly || d.getUTCMonth() % 3 === off) && d.getTime() > Date.now() - 86400000) return d; d.setUTCDate(d.getUTCDate() + 1); } return null; }

function reportError(message, stack){ if (++errCount > 8) return; try { fetch('/api/client-error', { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 4000), url: location.hash }) }).catch(() => {}); } catch(e){} }

function logView(){ const n = route().name; if (!/^[a-z]+$/.test(n) || ui.tour != null) return; const now = Date.now(); if (seenViews[n] && now - seenViews[n] < 60000) return; seenViews[n] = now; fetch('/api/event', { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ name: 'view:' + n }) }).catch(() => {}); }
