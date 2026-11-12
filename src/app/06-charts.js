/* Interactive price charts (drag to measure, range buttons). */

/* Load real bars for a stock (once every 10 minutes per range), then redraw. */
function needBars(sym, span = '1d'){
  if (!Market.isReal(sym)) return; const k = sym + ':' + span; ui.barsReq = ui.barsReq || {};
  if (ui.barsReq[k] && Date.now() - ui.barsReq[k] < 600000) return; ui.barsReq[k] = Date.now();
  Store.bars(sym, span).then(b => { if (b && b.length){ Market.addHist(sym, b); schedule(); } }).catch(() => {});
}
function seriesPts(fn, spanKey){ const [span, , n] = SPANS[spanKey], now = Date.now(), out = []; for (let i = n - 1; i >= 0; i--){ const t = now - span * i / (n - 1); out.push({ t, v: fn(t) }); } return out; }

function ichDate(t, spanKey){
  const d = new Date(t);
  if (spanKey === '1d') return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  if (spanKey === '5d') return d.toLocaleDateString('en-US', { weekday:'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  if (spanKey === '1y') return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function ichart(id, pts, spanKey, opt = {}){
  if (!pts || pts.length < 2) return '';
  const w = 600, h = opt.h || 180, vals = pts.map(p => p.v), min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const up = vals[vals.length - 1] >= vals[0], color = opt.color || (up ? 'var(--gain)' : 'var(--loss)');
  const xy = pts.map((p, i) => [i / (pts.length - 1) * w, h - 8 - (p.v - min) / rng * (h - 16)]);
  const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  ICH[id] = { pts, xy, w, h, spanKey, label: opt.label || SPANS[spanKey][1], color, what: opt.what || 'value' };
  return `<div class="ich" data-ich="${esc(id)}"><div class="ich-head" data-ich-head aria-live="polite">${ichSummary(id)}</div>
    <svg class="ich-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px" role="img" aria-label="${esc(opt.aria || 'Chart')}">
      <rect class="ich-sel" x="0" y="0" width="0" height="${h}" style="display:none"/>
      <path d="${d} L ${w} ${h} L 0 ${h} Z" fill="${color}" opacity=".08"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
      <line class="ich-x" x1="0" x2="0" y1="0" y2="${h}" vector-effect="non-scaling-stroke" style="display:none"/>
      <circle class="ich-dot" r="4" stroke="${color}" vector-effect="non-scaling-stroke" style="display:none"/>
    </svg><div class="ich-tip" style="display:none"></div></div>`;
}

function ichChange(a, b){ const ch = b - a, p = a ? ch / a : 0; return `<span class="${sgn(ch)}"><b class="${sgn(ch)}">${ch >= 0 ? '+' : '−'}${usd(Math.abs(ch))}</b> (${pct(p)})</span>`; }

function ichSummary(id){
  const C = ICH[id]; if (!C) return '';
  const sel = ui.ichSel[id];
  if (sel && sel[0] !== sel[1]){
    const [i, j] = sel[0] < sel[1] ? sel : [sel[1], sel[0]], A = C.pts[i], B = C.pts[j];
    return `<span>${esc(ichDate(A.t, C.spanKey))} → ${esc(ichDate(B.t, C.spanKey))}:</span> <b>${usd(A.v)}</b> → <b>${usd(B.v)}</b> ${ichChange(A.v, B.v)} <button class="linkbtn small" data-act="ichclear" data-k="${esc(id)}">Clear</button>`;
  }
  const A = C.pts[0], B = C.pts[C.pts.length - 1];
  return `<span>${esc(C.label)}:</span> <b>${usd(A.v)}</b> → <b>${usd(B.v)}</b> ${ichChange(A.v, B.v)}`;
}

function ichPaint(el, hoverIdx){
  const id = el.dataset.ich, C = ICH[id]; if (!C) return;
  const svg = el.querySelector('svg'), selR = svg.querySelector('.ich-sel'), line = svg.querySelector('.ich-x'), dot = svg.querySelector('.ich-dot'), tip = el.querySelector('.ich-tip'), head = el.querySelector('[data-ich-head]');
  const sel = ui.ichSel[id];
  if (sel && sel[0] !== sel[1]){ const a = Math.min(sel[0], sel[1]), b = Math.max(sel[0], sel[1]); selR.setAttribute('x', C.xy[a][0]); selR.setAttribute('width', C.xy[b][0] - C.xy[a][0]); selR.style.display = ''; }
  else selR.style.display = 'none';
  if (hoverIdx != null){
    const [x, y] = C.xy[hoverIdx], P = C.pts[hoverIdx];
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.style.display = ''; dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.display = '';
    tip.textContent = ichDate(P.t, C.spanKey) + ' · ' + usd(P.v); tip.style.left = (x / C.w * 100) + '%'; tip.style.display = '';
    /* with a range selected, the header keeps the range summary and the tooltip shows the hovered point */
    head.innerHTML = sel && sel[0] !== sel[1] ? ichSummary(id) : `<span>${esc(ichDate(P.t, C.spanKey))}:</span> <b>${usd(P.v)}</b> ${ichChange(C.pts[0].v, P.v)} <span class="muted">since start of period</span>`;
  } else { line.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; head.innerHTML = ichSummary(id); }
}

function ichIndex(el, clientX){ const C = ICH[el.dataset.ich], r = el.querySelector('svg').getBoundingClientRect(); const f = r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0; return Math.round(f * (C.pts.length - 1)); }

function ichEnd(e){
  const el = ichState.el; clearTimeout(ichState.timer); if (!el) return;
  const id = el.dataset.ich, s = ui.ichSel[id];
  if (ichState.selecting && (!s || s[0] === s[1])) delete ui.ichSel[id];
  ichState.el = null; ichState.selecting = false;
  ichPaint(el, ichState.pointer === 'mouse' ? ichIndex(el, e.clientX) : null);
}

function ichRestore(){ document.querySelectorAll('.ich').forEach(el => ichPaint(el, null)); }

function spark(values, w = 600, h = 96, color = 'var(--blue)'){
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values), rng = max - min || 1;
  const pts = values.map((v, i) => [i / (values.length - 1) * w, h - 6 - (v - min) / rng * (h - 12)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark" aria-hidden="true"><path d="${d} L ${w} ${h} L 0 ${h} Z" fill="${color}" opacity=".08"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>`;
}
