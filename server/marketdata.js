/* Real market data from Alpaca, used whenever Alpaca keys are set:
   - the full US stock list (with search), so any listed stock can be added to Pocket
   - news headlines, stored and served to the app, plus optional news alerts
   - on the real-money site only: real prices every 30 seconds and real price history.
   The demo keeps simulated prices. Extra stocks on the demo start from their real last close. */
const config = require('./config');
const alpaca = require('./alpaca');
const Market = require('./market');

const EXCHANGES = new Set(['NYSE', 'NASDAQ', 'ARCA', 'AMEX', 'BATS']); /* no over-the-counter stocks */
const MIN_PRICE = 0.01;                                                /* any price; stocks under $5 are labeled in the app */
let deps = null;
/* what happened last time each job ran, shown in Beta admin → Market data */
const status = { assets: null, news: null, quotes: null, sec: null, anchors: null };
const errInfo = e => ({ status: e.status == null ? null : e.status, message: String(e.detail || e.message || e).slice(0, 400) });

async function migrate(q){
  await q(`CREATE TABLE IF NOT EXISTS assets (sym text PRIMARY KEY, name text NOT NULL, exchange text, fractionable boolean, in_use boolean NOT NULL DEFAULT false, ref_price numeric, ref_ts timestamptz, updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS assets_name ON assets (lower(name))`);
  await q(`CREATE TABLE IF NOT EXISTS company_info (sym text PRIMARY KEY, sic int, industry text, sector text, updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS market_events (id text PRIMARY KEY, date date NOT NULL, title text NOT NULL, syms text[] NOT NULL DEFAULT '{}', note text, created_by text, created_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS earnings (sym text PRIMARY KEY, next_date date NOT NULL, last_date date, updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS news (id text PRIMARY KEY, ts timestamptz NOT NULL, headline text NOT NULL, summary text, url text, source text, symbols text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS news_ts ON news (ts DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS news_symbols ON news USING gin (symbols)`);
  await q(`CREATE TABLE IF NOT EXISTS news_alerts (user_id text NOT NULL, day text NOT NULL, n int NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`);
}

/* ---------- stock list ---------- */
async function syncAssets(){
  const { q } = deps;
  const list = (await alpaca.assets()) || [];
  status.assets = { at: Date.now(), received: list.length };
  const ok = list.filter(a => a.tradable && EXCHANGES.has(a.exchange) && /^[A-Z]{1,5}(\.[A-Z])?$/.test(a.symbol) && a.name);
  for (let i = 0; i < ok.length; i += 1000){
    const part = ok.slice(i, i + 1000);
    await q(`INSERT INTO assets (sym, name, exchange, fractionable, updated_at) SELECT * , now() FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[])
             ON CONFLICT (sym) DO UPDATE SET name = EXCLUDED.name, exchange = EXCLUDED.exchange, fractionable = EXCLUDED.fractionable, updated_at = now()`,
      [part.map(a => a.symbol), part.map(a => cleanName(a.name)), part.map(a => a.exchange), part.map(a => !!a.fractionable)]);
  }
  status.assets.kept = ok.length;
  return ok.length;
}
const cleanName = n => String(n).replace(/\s+(Common Stock|Class [A-C] Common Stock|Ordinary Shares|Inc\.? Common Stock|American Depositary Shares.*)$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80);

async function loadExtras(){
  const rows = (await deps.q(`SELECT sym, name, ref_price FROM assets WHERE in_use AND ref_price IS NOT NULL`)).rows;
  rows.forEach(r => Market.add(r.sym, r.name, Number(r.ref_price)));
}
const extras = () => Market.LIST.filter(t => t.extra).map(t => ({ s: t.s, n: t.n, b: t.b }));

async function search(text){
  const t = String(text || '').trim(); if (!t) return [];
  const core = Market.LIST.filter(x => x.s.startsWith(t.toUpperCase()) || x.n.toLowerCase().includes(t.toLowerCase())).slice(0, 8).map(x => ({ s: x.s, n: x.n, added: true }));
  if (!config.marketData) return core;
  const rows = (await deps.q(`SELECT sym, name FROM assets WHERE sym = upper($1) OR sym LIKE upper($1) || '%' OR lower(name) LIKE '%' || lower($1) || '%'
     ORDER BY (sym = upper($1)) DESC, (sym LIKE upper($1) || '%') DESC, length(sym) LIMIT 15`, [t])).rows;
  const seen = new Set(), out = [];
  for (const r of rows.map(r => ({ s: r.sym, n: r.name, added: !!Market.MAP[r.sym] })).concat(core)) if (!seen.has(r.s)){ seen.add(r.s); out.push(r); }
  return out.slice(0, 15);
}

const snapPrice = x => x && ((x.latestTrade && x.latestTrade.p) || (x.dailyBar && x.dailyBar.c) || (x.prevDailyBar && x.prevDailyBar.c)) || 0;
const snapPrev = x => x && x.prevDailyBar && x.prevDailyBar.c || null;

/* Add a listed stock to Pocket so it can be viewed, watched and traded. */
async function ensure(symIn){
  const sym = String(symIn || '').toUpperCase().trim();
  if (Market.MAP[sym]) return { s: sym, n: Market.MAP[sym].n, b: Market.MAP[sym].b, existed: true };
  if (!config.marketData) throw userErr("That stock isn't available yet.");
  const a = (await deps.q('SELECT sym, name FROM assets WHERE sym = $1', [sym])).rows[0];
  if (!a) throw userErr("That stock isn't available on Pocket. Only stocks listed on major US exchanges are supported.");
  const snap = (await alpaca.snapshots([sym])) || {};
  const p = snapPrice(snap[sym]);
  if (!(p >= MIN_PRICE)) throw userErr("We couldn't get a price for that stock right now. Try again later.");
  await deps.q('UPDATE assets SET in_use = true, ref_price = $2, ref_ts = now() WHERE sym = $1', [sym, p]);
  Market.add(sym, a.name, p);
  if (config.realPrices) Market.setQuotes({ [sym]: { p, prev: snapPrev(snap[sym]) } });
  deps.broadcastMsg({ type: 'market', extras: [{ s: sym, n: a.name, b: Market.MAP[sym].b }], quotes: config.realPrices ? { [sym]: Market.QUOTES[sym] } : undefined });
  return { s: sym, n: a.name, b: Market.MAP[sym].b };
}
function userErr(m){ const e = new Error(m); e.userFacing = true; return e; }

/* ---------- real prices (real-money site only) ---------- */
async function refreshQuotes(){
  const syms = Market.LIST.map(t => t.s), out = {};
  for (let i = 0; i < syms.length; i += 100){
    const snap = (await alpaca.snapshots(syms.slice(i, i + 100))) || {};
    for (const [s, x] of Object.entries(snap)){ const p = snapPrice(x); if (p > 0) out[s] = { p, prev: snapPrev(x), t: Date.now() }; }
  }
  Market.setQuotes(out); status.quotes = { at: Date.now(), count: Object.keys(out).length };
  if (Object.keys(out).length) deps.broadcastMsg({ type: 'market', quotes: out });
}
const barCache = new Map();
let sipOk = null;
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' });
function regularHours(ms){ const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map(x => [x.type, x.value])); if (p.weekday === 'Sat' || p.weekday === 'Sun') return false; const m = (+p.hour) * 60 + (+p.minute); return m >= 570 && m < 960; }
async function bars(sym, span){
  const key = sym + ':' + span, c = barCache.get(key); if (c && Date.now() - c.t < 5 * 60000) return c.v;
  const cfg = { '1d': ['5Min', 1.5], '5d': ['30Min', 7], '1m': ['1Day', 32], '3m': ['1Day', 95], '1y': ['1Day', 370] }[span] || ['5Min', 1.5];
  /* Consolidated (SIP) data, which the free plan allows when it's over 15 minutes old; falls back to IEX if the plan refuses. */
  const start = new Date(Date.now() - cfg[1] * 86400000).toISOString(); let r = null;
  if (sipOk !== false){ try { r = await alpaca.bars(sym, cfg[0], start, 1000, 'sip', new Date(Date.now() - 16 * 60000).toISOString()); sipOk = true; } catch (e){ if ([401, 403, 422].includes(e.status)) sipOk = false; r = null; } }
  if (!r) r = await alpaca.bars(sym, cfg[0], start, 1000);
  let v = ((r && r.bars) || []).map(b => ({ t: Date.parse(b.t), c: b.c }));
  if (cfg[0] !== '1Day') v = v.filter(b => regularHours(b.t)); /* intraday charts: regular hours only (9:30 to 4:00 Eastern) */
  barCache.set(key, { t: Date.now(), v }); Market.addHist(sym, v, cfg[0] === '1Day'); return v;
}
/* A year of real daily closes for every tracked or held stock, so past valuations (statements, track records, group performance) use real prices. */
async function loadHistory(){
  if (!config.realPrices) return 0;
  const set = new Set(await trackedSymbols());
  (await deps.q(`SELECT DISTINCT jsonb_object_keys(data->'positions') AS s FROM doc_portfolios WHERE jsonb_typeof(data->'positions') = 'object'`).catch(() => ({ rows: [] }))).rows.forEach(r => set.add(r.s));
  let n = 0; for (const sym of set){ if (!Market.MAP[sym]) continue; try { await bars(sym, '1y'); n++; } catch (e){} await new Promise(r => setTimeout(r, 300)); }
  return n;
}

/* ---------- demo prices anchored to real closes (button in Demo controls, optional daily) ---------- */
let anchors = { at: null, bases: {} };
async function applySavedAnchors(){ anchors = (await deps.getSetting('priceAnchors', null)) || { at: null, bases: {} }; Market.setBases(anchors.bases); }
async function anchorPrices(){
  if (!config.marketData) throw userErr('Add ALPACA_KEY and ALPACA_SECRET to this service first.');
  if (config.realPrices) throw userErr('This site already uses real prices.');
  const syms = Market.LIST.map(t => t.s), bases = {}, closes = {};
  for (let i = 0; i < syms.length; i += 100){
    const snap = (await alpaca.snapshots(syms.slice(i, i + 100))) || {};
    for (const [sym, x] of Object.entries(snap)){
      const close = (x.prevDailyBar && x.prevDailyBar.c) || (x.dailyBar && x.dailyBar.c) || (x.latestTrade && x.latestTrade.p);
      const T = Market.MAP[sym], cur = Market.simPrice(sym);
      if (close > 0 && T && cur > 0){ bases[sym] = close * T.b / cur; closes[sym] = close; } /* simulated price right now = the real close */
    }
  }
  Market.setBases(bases);
  anchors = { at: Date.now(), bases: Object.assign({}, anchors.bases, bases), count: Object.keys(bases).length };
  await deps.setSetting('priceAnchors', anchors);
  status.anchors = { at: anchors.at, count: anchors.count };
  deps.broadcastMsg({ type: 'market', bases });
  return { count: anchors.count, sample: Object.entries(closes).slice(0, 3).map(([k, v]) => `${k} $${v}`).join(', ') };
}
async function autoAnchor(){
  if (!config.marketData || config.realPrices || !(await deps.getSetting('priceAnchorAuto', false))) return;
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});
  const today = `${et.year}-${et.month}-${et.day}`, last = anchors.at ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(anchors.at)) : null;
  if (+et.hour >= 9 && last !== today) await anchorPrices();
}

/* ---------- company filings from SEC EDGAR ---------- */
let cikMap = null, cikAt = 0;
const secHeaders = () => ({ 'User-Agent': config.sec.contact, Accept: 'application/json' });
async function secJson(url){
  const r = await fetch(url, { headers: secHeaders(), signal: AbortSignal.timeout(15000) });
  if (!r.ok){ const e = new Error(`SEC returned HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
async function loadCiks(){
  if (cikMap && Date.now() - cikAt < 86400000) return cikMap;
  const j = await secJson(config.sec.wwwUrl + '/files/company_tickers.json');
  cikMap = {}; for (const v of Object.values(j || {})) if (v && v.ticker) cikMap[String(v.ticker).toUpperCase()] = { cik: v.cik_str, title: v.title };
  cikAt = Date.now(); return cikMap;
}
/* Plain-language names for SEC filing types and Form 8-K items. */
const ITEMS = { '1.01': 'new material agreement', '1.02': 'material agreement ended', '1.03': 'bankruptcy or receivership', '1.05': 'cybersecurity incident',
  '2.01': 'acquisition or sale completed', '2.02': 'quarterly results', '2.03': 'new debt or financing', '2.04': 'debt obligation triggered', '2.05': 'restructuring costs', '2.06': 'asset write-down',
  '3.01': 'exchange listing notice', '3.02': 'unregistered share sale', '3.03': 'change to shareholder rights', '4.01': 'auditor change', '4.02': 'past financial statements no longer reliable',
  '5.01': 'change in control', '5.02': 'officer or director change', '5.03': 'bylaws or fiscal year change', '5.07': 'shareholder vote results', '7.01': 'investor update', '8.01': 'other company news' };
const FORMS = { '10-Q': 'quarterly report', '10-K': 'annual report', '20-F': 'annual report', '6-K': 'company update' };
function filingHeadline(name, form, items){
  if (form === '8-K'){ const its = String(items || '').split(',').map(x => x.trim()).filter(x => ITEMS[x]);
    if (!its.length) return `${name}: current report (Form 8-K)`;
    return `${name}: ${its.slice(0, 2).map(x => ITEMS[x]).join('; ')} (Form 8-K, item${its.length > 1 ? 's' : ''} ${its.slice(0, 2).join(', ')})`; }
  return `${name}: ${FORMS[form] || 'SEC filing'} (Form ${form})`;
}
const secActive = () => config.sec.mode === 'on' || (config.sec.mode === 'auto' && config.marketData && status.news && status.news.error && [401, 403].includes(status.news.error.status) && !status.news.received);
/* Earnings calendar: estimated from each company's own past earnings releases on SEC EDGAR
   (Form 8-K, item 2.02). The next date is projected one year on from the matching release a
   year earlier, or about a quarter after the latest one. Always labeled as an estimate. */
async function pullEarnings(){
  if (config.sec.mode === 'off') return 0;
  const map = await loadCiks(), syms = (await trackedSymbols()).filter(s => !Market.ETFS.includes(s) && map[s]).slice(0, 60); let n = 0;
  for (const sym of syms){
    let j; try { j = await secJson(`${config.sec.dataUrl}/submissions/CIK${String(map[sym].cik).padStart(10, '0')}.json`); } catch (e){ continue; }
    await saveIndustry(sym, j).catch(() => {});
    const R = (j && j.filings && j.filings.recent) || {}, dates = [];
    for (let i = 0; i < (R.form || []).length && i < 400; i++) if (R.form[i] === '8-K' && String((R.items || [])[i] || '').split(',').includes('2.02')) dates.push(R.filingDate[i]);
    if (!dates.length) continue;
    dates.sort(); const last = dates[dates.length - 1], DAY = 86400000, now = Date.now();
    const proj = dates.map(d => Date.parse(d + 'T12:00:00Z') + 364 * DAY).filter(t => t > now - DAY).sort((a, b) => a - b);
    let next = proj[0] || Date.parse(last + 'T12:00:00Z') + 91 * DAY; while (next < now - DAY) next += 91 * DAY;
    await deps.q(`INSERT INTO earnings (sym, next_date, last_date, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (sym) DO UPDATE SET next_date = EXCLUDED.next_date, last_date = EXCLUDED.last_date, updated_at = now()`, [sym, new Date(next).toISOString().slice(0, 10), last]);
    n++; await new Promise(r => setTimeout(r, 150));
  }
  return n;
}
/* Sectors, from the industry code each company files with the SEC (an approximation of standard sectors). */
function sectorOf(sic){
  const R = [[100, 999, 'Consumer staples'], [1000, 1299, 'Materials'], [1300, 1399, 'Energy'], [1400, 1499, 'Materials'], [1500, 1799, 'Industrials'], [2000, 2199, 'Consumer staples'], [2200, 2599, 'Consumer'],
    [2600, 2699, 'Materials'], [2700, 2799, 'Communication'], [2800, 2829, 'Materials'], [2830, 2836, 'Health care'], [2840, 2899, 'Consumer staples'], [2900, 2999, 'Energy'], [3000, 3399, 'Materials'],
    [3400, 3569, 'Industrials'], [3570, 3579, 'Technology'], [3580, 3599, 'Industrials'], [3600, 3699, 'Technology'], [3700, 3716, 'Consumer'], [3717, 3799, 'Industrials'], [3800, 3839, 'Technology'],
    [3840, 3851, 'Health care'], [3852, 3999, 'Consumer'], [4000, 4799, 'Industrials'], [4800, 4899, 'Communication'], [4900, 4999, 'Utilities'], [5000, 5199, 'Industrials'], [5400, 5499, 'Consumer staples'],
    [5912, 5912, 'Consumer staples'], [5200, 5999, 'Consumer'], [6000, 6499, 'Financials'], [6500, 6599, 'Real estate'], [6798, 6798, 'Real estate'], [6700, 6799, 'Financials'], [7000, 7299, 'Consumer'],
    [7370, 7379, 'Technology'], [7300, 7399, 'Industrials'], [7800, 7989, 'Communication'], [7990, 7999, 'Consumer'], [8000, 8099, 'Health care'], [8100, 8999, 'Industrials']];
  const n = Number(sic); if (!n) return null; const hit = R.find(([a, b]) => n >= a && n <= b); return hit ? hit[2] : null;
}
async function saveIndustry(sym, j){
  if (!j || !j.sic) return;
  await deps.q(`INSERT INTO company_info (sym, sic, industry, sector, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (sym) DO UPDATE SET sic = EXCLUDED.sic, industry = EXCLUDED.industry, sector = EXCLUDED.sector, updated_at = now()`,
    [sym, Number(j.sic), String(j.sicDescription || '').slice(0, 120), sectorOf(j.sic)]);
}
async function pullIndustries(){
  if (config.sec.mode === 'off') return 0;
  const map = await loadCiks(), have = new Set((await deps.q(`SELECT sym FROM company_info WHERE updated_at > now() - interval '30 days'`)).rows.map(r => r.sym));
  const syms = (await trackedSymbols()).filter(s => !Market.ETFS.includes(s) && map[s] && !have.has(s)).slice(0, 250); let n = 0;
  for (const sym of syms){ try { await saveIndustry(sym, await secJson(`${config.sec.dataUrl}/submissions/CIK${String(map[sym].cik).padStart(10, '0')}.json`)); n++; } catch (e){} await new Promise(r => setTimeout(r, 150)); }
  return n;
}
async function pullFilings(force){
  if (!force && !secActive()) return 0;
  const map = await loadCiks();
  const syms = (await trackedSymbols()).filter(s => !Market.ETFS.includes(s) && map[s]).slice(0, 60);
  const since = Date.now() - 14 * 86400000; let added = 0, checked = 0;
  for (const sym of syms){
    const cik = String(map[sym].cik).padStart(10, '0');
    let j; try { j = await secJson(`${config.sec.dataUrl}/submissions/CIK${cik}.json`); } catch (e){ status.sec = { at: Date.now(), error: { status: e.status || null, message: e.message } }; continue; }
    checked++;
    const R = (j && j.filings && j.filings.recent) || {}, name = (Market.MAP[sym] && Market.MAP[sym].n) || map[sym].title;
    for (let i = 0; i < (R.form || []).length && i < 40; i++){
      const form = R.form[i]; if (!['8-K','10-Q','10-K','6-K','20-F'].includes(form)) continue;
      const ts = Date.parse(R.acceptanceDateTime && R.acceptanceDateTime[i] || R.filingDate[i]); if (!(ts > since)) continue;
      const acc = R.accessionNumber[i], url = `${config.sec.wwwUrl}/Archives/edgar/data/${Number(map[sym].cik)}/${String(acc).replace(/-/g, '')}/${R.primaryDocument[i] || ''}`;
      const ins = await deps.q(`INSERT INTO news (id, ts, headline, summary, url, source, symbols) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        ['sec-' + acc, new Date(ts).toISOString(), filingHeadline(name, form, R.items && R.items[i]), `Form ${form} filed with the SEC on ${R.filingDate[i]}.`, url, 'SEC filing', [sym]]);
      if (ins.rows.length) added++; else await deps.q('UPDATE news SET headline = $2 WHERE id = $1 AND headline IS DISTINCT FROM $2', ['sec-' + acc, filingHeadline(name, form, R.items && R.items[i])]);
    }
    await new Promise(r => setTimeout(r, 150)); /* stay well under the SEC's 10 requests a second */
  }
  status.sec = Object.assign({ at: Date.now(), added, checked }, status.sec && status.sec.error && !checked ? { error: status.sec.error } : {});
  if (added) deps.broadcastMsg({ type: 'news', n: added });
  return added;
}

/* ---------- news ---------- */
async function trackedSymbols(){
  const { q } = deps; const set = new Set(Market.LIST.map(t => t.s));
  (await q(`SELECT data->'watchlist' AS w FROM doc_profiles WHERE data ? 'watchlist'`)).rows.forEach(r => (r.w || []).forEach(s => set.add(s)));
  return [...set];
}
async function pullNews(){
  const { q } = deps;
  const batches = [null]; const syms = await trackedSymbols();
  for (let i = 0; i < syms.length; i += 50) batches.push(syms.slice(i, i + 50));
  const fresh = [], errors = []; let received = 0;
  for (const b of batches){
    const r = await alpaca.news(b, 50).catch(e => { const x = errInfo(e); errors.push(x); console.error('news fetch failed:', x.status, x.message); return null; });
    received += ((r && r.news) || []).length;
    for (const n of (r && r.news) || []){
      if (!n.headline) continue;
      const ins = await q(`INSERT INTO news (id, ts, headline, summary, url, source, symbols) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [String(n.id), n.created_at || n.updated_at || new Date().toISOString(), String(n.headline).slice(0, 400), stripHtml(n.summary).slice(0, 500), n.url || null, n.source || n.author || null, (n.symbols || []).slice(0, 20)]);
      if (ins.rows.length) fresh.push({ id: String(n.id), headline: n.headline, symbols: n.symbols || [], ts: Date.parse(n.created_at || n.updated_at || Date.now()) });
    }
  }
  status.news = { at: Date.now(), received, added: fresh.length, requests: batches.length, failed: errors.length, error: errors[0] || null };
  await q(`DELETE FROM news WHERE ts < now() - interval '30 days'`);
  if (fresh.length) deps.broadcastMsg({ type: 'news', n: fresh.length });
  await newsAlerts(fresh).catch(e => console.error('news alerts', e.message));
  return fresh.length;
}
const stripHtml = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function listNews(symbols, limit){
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const syms = (symbols || []).filter(s => /^[A-Z.]{1,6}$/.test(s)).slice(0, 60);
  const r = syms.length ? await deps.q(`SELECT * FROM news WHERE symbols && $1::text[] ORDER BY ts DESC LIMIT $2`, [syms, lim]) : await deps.q(`SELECT * FROM news ORDER BY ts DESC LIMIT $1`, [lim]);
  return r.rows.map(n => ({ id: n.id, ts: new Date(n.ts).getTime(), headline: n.headline, summary: n.summary, url: n.url, source: n.source, symbols: n.symbols }));
}
/* Optional alerts: only for people who turned on news alerts, for stocks they own or watch,
   at most 3 a day, never during quiet hours, only for headlines under 2 hours old. */
async function newsAlerts(items){
  const { q, push } = deps; if (!items.length || !push.send) return 0;
  const recent = items.filter(i => Date.now() - i.ts < 2 * 3600000); if (!recent.length) return 0;
  const users = (await q('SELECT DISTINCT user_id FROM push_subs').catch(() => ({ rows: [] }))).rows.map(r => r.user_id);
  const day = new Date().toISOString().slice(0, 10); let sent = 0;
  for (const uid of users){
    const pid = 'u_' + uid;
    const prof = ((await q('SELECT data FROM doc_profiles WHERE id = $1', [pid])).rows[0] || {}).data;
    if (!prof || !prof.notif || prof.notif.news !== true || !push.allowed(prof, 'news')) continue;
    const pf = ((await q('SELECT data FROM doc_portfolios WHERE id = $1', [pid])).rows[0] || {}).data || {};
    const mine = new Set(Object.keys(pf.positions || {}).concat(prof.watchlist || []));
    const hit = recent.find(i => i.symbols.some(s => mine.has(s))); if (!hit) continue;
    const c = (await q(`INSERT INTO news_alerts (user_id, day, n) VALUES ($1, $2, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = news_alerts.n + 1 RETURNING n`, [uid, day])).rows[0].n;
    if (c > 3) continue;
    const sym = hit.symbols.find(s => mine.has(s));
    await push.send(q.pool || deps.pool, [pid], { title: sym + ' in the news', body: hit.headline.slice(0, 140), tag: 'news-' + hit.id, url: '/#/stock/' + sym });
    sent++;
  }
  return sent;
}

/* ---------- routes and jobs ---------- */
function mount(app, d){
  deps = d;
  const { wrap, ok, bad, needUser } = d;
  app.get('/api/assets/search', wrap(async (req, res) => ok(res, { results: await search(req.query.q) })));
  app.post('/api/assets/ensure', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; try { ok(res, { stock: await ensure(req.body.sym) }); } catch (e){ if (e.userFacing) return bad(res, e.message); throw e; } }));
  app.get('/api/news', wrap(async (req, res) => ok(res, { news: await listNews(String(req.query.symbols || '').split(',').filter(Boolean), req.query.limit), real: config.marketData })));
  /* Beta admin → Market data: settings, last results, and a live check of each Alpaca call */
  app.get('/api/admin/marketdata', wrap(async (req, res) => {
    if (!(await d.needAdmin(req, res))) return;
    const n = (await d.q(`SELECT (SELECT count(*)::int FROM assets) AS assets, (SELECT count(*)::int FROM assets WHERE in_use) AS added, (SELECT count(*)::int FROM news) AS news, (SELECT max(ts) FROM news) AS newest`)).rows[0];
    const log = (await d.q(`SELECT method, path, status, message, created_at FROM broker_log ORDER BY id DESC LIMIT 15`).catch(() => ({ rows: [] }))).rows;
    ok(res, { on: config.marketData, sec: { mode: config.sec.mode, active: secActive(), contact: config.sec.contact }, anchors: { at: anchors.at, count: Object.keys(anchors.bases || {}).length, auto: !!(await d.getSetting('priceAnchorAuto', false)) },
      env: config.alpaca.env, authMode: config.alpaca.authMode, urls: { auth: config.alpaca.authUrl, broker: config.alpaca.baseUrl, data: config.alpaca.dataUrl },
      realPrices: config.realPrices, counts: { assets: n.assets, added: n.added, news: n.news, newest: n.newest ? new Date(n.newest).getTime() : null }, status, log });
  }));
  app.post('/api/admin/marketdata/check', wrap(async (req, res) => {
    if (!(await d.needAdmin(req, res))) return;
    const steps = [];
    const step = async (name, fn) => { const t = Date.now(); try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t, detail }); } catch (e){ const x = errInfo(e); steps.push({ name, ok: false, ms: Date.now() - t, status: x.status, detail: x.message }); } };
    if (config.marketData) await step('Sign in to Alpaca', async () => { if (config.alpaca.authMode === 'legacy') return 'Using older key pair (no token needed)'; await alpaca.getToken(true); return 'Access token received'; });
    if (config.marketData) await step('Stock list (Broker API)', async () => { const a = await alpaca.asset('AAPL'); return `AAPL: ${a.name || 'found'}, ${a.exchange || ''}, tradable ${!!a.tradable}`; });
    if (config.marketData) await step('Price quote (Market Data)', async () => { const s = (await alpaca.snapshots(['AAPL'])) || {}; const p = snapPrice(s.AAPL); if (!p) throw new Error('No price returned for AAPL: ' + JSON.stringify(s).slice(0, 200)); return `AAPL last price $${p}`; });
    if (config.marketData) await step('News for AAPL', async () => { const r = await alpaca.news(['AAPL'], 3); const list = (r && r.news) || []; if (!list.length) throw new Error('Request worked but returned no headlines: ' + JSON.stringify(r).slice(0, 200)); return `${list.length} headlines, newest: "${String(list[0].headline).slice(0, 90)}"`; });
    if (config.marketData) await step('General news', async () => { const r = await alpaca.news(null, 3); const list = (r && r.news) || []; if (!list.length) throw new Error('Request worked but returned no headlines: ' + JSON.stringify(r).slice(0, 200)); return `${list.length} headlines`; });
    if (config.sec.mode !== 'off') await step('SEC filings (EDGAR)', async () => { const m = await loadCiks(); const a = m.AAPL; if (!a) throw new Error('Ticker list loaded but AAPL was missing'); const j = await secJson(`${config.sec.dataUrl}/submissions/CIK${String(a.cik).padStart(10, '0')}.json`); const n = ((j.filings && j.filings.recent && j.filings.recent.form) || []).length; return `${Object.keys(m).length.toLocaleString('en-US')} companies; Apple has ${n} recent filings` + (secActive() ? ' (in use as the news source)' : config.sec.mode === 'auto' ? ' (standing by: used only while Alpaca news is unavailable)' : ''); });
    ok(res, { steps });
  }));
  app.post('/api/admin/marketdata/filings', wrap(async (req, res) => { if (!(await d.needAdmin(req, res))) return; if (config.sec.mode === 'off') return bad(res, 'SEC filings are turned off (SEC_FILINGS=off).'); ok(res, { added: await pullFilings(true), status: status.sec }); }));
  app.post('/api/admin/prices/anchor', wrap(async (req, res) => { if (!(await d.needAdmin(req, res))) return; try { ok(res, await anchorPrices()); } catch (e){ if (e.userFacing) return bad(res, e.message); throw e; } }));
  app.post('/api/admin/prices/auto', wrap(async (req, res) => { if (!(await d.needAdmin(req, res))) return; await d.setSetting('priceAnchorAuto', !!req.body.on); ok(res); }));
  app.post('/api/admin/marketdata/fetch', wrap(async (req, res) => {
    if (!(await d.needAdmin(req, res))) return;
    if (!config.marketData) return bad(res, 'Add ALPACA_KEY and ALPACA_SECRET to this service first.');
    const added = await pullNews(); const filings = await pullFilings().catch(() => 0); ok(res, { added: added + filings, status: status.news });
  }));
  app.get('/api/earnings', wrap(async (req, res) => {
    const rows = (await deps.q(`SELECT sym, next_date, last_date FROM earnings WHERE next_date >= (now() - interval '2 days')::date`).catch(() => ({ rows: [] }))).rows;
    res.set('Cache-Control', 'public, max-age=600'); ok(res, { earnings: Object.fromEntries(rows.map(r => [r.sym, { next: String(r.next_date instanceof Date ? r.next_date.toISOString().slice(0, 10) : r.next_date).slice(0, 10), last: String(r.last_date instanceof Date ? r.last_date.toISOString().slice(0, 10) : r.last_date).slice(0, 10) }])) });
  }));
  app.get('/api/bars', wrap(async (req, res) => {
    const sym = String(req.query.sym || '').toUpperCase(); if (!config.realPrices || !Market.MAP[sym]) return ok(res, { bars: [] });
    try { ok(res, { bars: await bars(sym, String(req.query.span || '1d')) }); } catch (e){ ok(res, { bars: [] }); }
  }));
}
async function start(){
  await applySavedAnchors().catch(e => console.error('price anchors', e.message));
  const { q } = deps;
  if (config.realPrices){ const runHist = () => loadHistory().then(n => { if (n) console.log('Price history loaded for ' + n + ' stocks.'); }).catch(e => console.error('history', e.message)); setTimeout(runHist, 15000); setInterval(runHist, 6 * 3600000); }
  if (config.sec.mode !== 'off'){ const runInd = () => pullIndustries().then(n => { if (n) console.log('Industries saved for ' + n + ' stocks.'); }).catch(e => console.error('industries', e.message)); setTimeout(runInd, 90000); setInterval(runInd, 86400000); }
  if (config.sec.mode !== 'off'){ const runEarn = () => pullEarnings().then(n => { if (n) console.log('Earnings dates updated for ' + n + ' stocks.'); }).catch(e => console.error('earnings', e.message)); setTimeout(runEarn, 30000); setInterval(runEarn, 12 * 3600000); }
  if (config.sec.mode !== 'off'){ const runSec = () => pullFilings().catch(e => { status.sec = { at: Date.now(), error: { status: e.status || null, message: e.message } }; console.error('SEC filings failed:', e.message); }); setTimeout(runSec, 20000); setInterval(runSec, 30 * 60000); }
  if (!config.marketData) return;
  const run = (fn, label) => fn().catch(e => { const x = errInfo(e); console.error(label + ' failed:', x.status, x.message); if (label === 'asset sync') status.assets = { at: Date.now(), error: x }; if (label === 'quotes') status.quotes = { at: Date.now(), error: x }; if (label === 'news') status.news = { at: Date.now(), error: x }; });
  const n = (await q('SELECT count(*)::int AS n, max(updated_at) AS t FROM assets')).rows[0];
  if (!n.n || Date.now() - new Date(n.t).getTime() > 86400000) await run(async () => console.log('Stock list synced:', await syncAssets()), 'asset sync');
  setInterval(() => run(syncAssets, 'asset sync'), 24 * 3600000);
  await run(async () => { const n = await ensureSectorFunds(); if (n) console.log('Sector funds ready:', n); }, 'sector funds');
  await run(pullNews, 'news'); setInterval(() => run(pullNews, 'news'), 5 * 60000);
  if (config.realPrices){ await run(refreshQuotes, 'quotes'); setInterval(() => run(refreshQuotes, 'quotes'), 30000); }
  setInterval(() => run(autoAnchor, 'price anchors'), 60 * 60000); run(autoAnchor, 'price anchors');
}
/* Before creating sample people on a real-price site: real quotes and a year of daily closes for the sample stocks. */
async function warmForSeed(){ if (!config.realPrices) return; await refreshQuotes().catch(() => {}); for (const t of Market.LIST.slice(0, 40)){ await bars(t.s, '1y').catch(() => {}); } }
/* The 11 standard sector funds, so Explore can show every sector's move. */
const SECTOR_FUNDS = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
async function ensureSectorFunds(){ if (!config.marketData) return 0; let n = 0; for (const s of SECTOR_FUNDS){ try { await ensure(s); n++; } catch (e){} } return n; }
module.exports = { bars, ensureSectorFunds, warmForSeed, sectorOf, pullIndustries, pullEarnings, migrate, mount, start, loadExtras, extras, bases: () => anchors.bases || {}, anchorPrices, pullFilings, filingHeadline, ensure, search, pullNews, listNews, newsAlerts, syncAssets, refreshQuotes, MIN_PRICE };
