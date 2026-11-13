/* Weekly outlook: "Will SYM end the week higher or lower than last Friday's close?"
   Voting from Monday's open to Wednesday 12:00 PM Eastern; Friday's close (or the week's last trading day) settles it.
   Also works out every automatic badge (outlook, sector and contribution) into profile.autoBadges. */
const Market = require('./market');
const DAY = 86400000;
const HOL = new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25','2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24']);
const F = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' });
const et = ts => { const p = Object.fromEntries(F.formatToParts(new Date(ts)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, h: +p.hour, m: +p.minute }; };
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function etToUtc(date, h, m){ const [y, mo, d] = date.split('-').map(Number); let t = Date.UTC(y, mo - 1, d, h, m); for (let i = 0; i < 2; i++){ const e = et(t); const diff = (Date.UTC(...e.date.split('-').map((v, k) => k === 1 ? v - 1 : +v), e.h, e.m) - t); t = Date.UTC(y, mo - 1, d, h, m) - diff; } return t; }
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
function weekOf(ts = Date.now()){ const e = et(ts); return addDays(e.date, -WD[e.wd]); }
function windowFor(week){ const monOpen = HOL.has(week) ? etToUtc(addDays(week, 1), 0, 0) : etToUtc(week, 9, 30); return { opens: monOpen, closes: etToUtc(addDays(week, 2), 12, 0), settles: etToUtc(addDays(week, 4), 16, 0), base: etToUtc(addDays(week, -3), 16, 0) }; }
async function migrate(q){
  await q(`CREATE TABLE IF NOT EXISTS outlook_votes (week text NOT NULL, sym text NOT NULL, user_id text NOT NULL, gid text NOT NULL DEFAULT '', dir text NOT NULL, ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (week, sym, user_id, gid))`);
  await q(`CREATE TABLE IF NOT EXISTS outlook_peeks (week text NOT NULL, sym text NOT NULL, user_id text NOT NULL, gid text NOT NULL DEFAULT '', PRIMARY KEY (week, sym, user_id, gid))`);
  await q(`CREATE TABLE IF NOT EXISTS outlook_results (week text NOT NULL, sym text NOT NULL, base numeric, close numeric, result text, settled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (week, sym))`);
}
function mount(app, d){
  const { q, wrap, ok, bad, needUser, db, broadcast } = d;
  const rule = async () => Object.assign({ accuracyOn: true, weeklyRun: 4, regular: 12, groupCalls: 10, streak: 5, sharpPct: 70, sharpMin: 20, sectorPct: 70, sectorMin: 10, sectorRegular: 8 }, ((await q(`SELECT data FROM doc_badges WHERE id = 'outlookRule'`)).rows[0] || {}).data || {});
  const minVotes = gid => gid ? 3 : 10;
  async function eligible(u){ const r = (await q('SELECT created_at FROM users WHERE id = $1', [u.id])).rows[0]; return r && Date.now() - new Date(r.created_at).getTime() >= 7 * DAY; }
  async function counts(week, sym, gid){ const r = (await q(`SELECT dir, count(*)::int AS n FROM outlook_votes WHERE week = $1 AND sym = $2 AND gid = $3 GROUP BY dir`, [week, sym, gid])).rows; const up = (r.find(x => x.dir === 'up') || {}).n || 0, down = (r.find(x => x.dir === 'down') || {}).n || 0; return { up, down, total: up + down }; }
  app.get('/api/outlook/:sym', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const sym = String(req.params.sym).toUpperCase(), gid = String(req.query.gid || ''), week = weekOf(), w = windowFor(week), now = Date.now();
    const open = now >= w.opens && now < w.closes, mine = (await q('SELECT dir FROM outlook_votes WHERE week = $1 AND sym = $2 AND user_id = $3 AND gid = $4', [week, sym, u.id, gid])).rows[0];
    const peeked = !!(await q('SELECT 1 FROM outlook_peeks WHERE week = $1 AND sym = $2 AND user_id = $3 AND gid = $4', [week, sym, u.id, gid])).rows.length;
    const show = !!mine || peeked || now >= w.closes, c = await counts(week, sym, gid);
    const hist = (await q(`SELECT r.week, r.result, r.base, r.close, (SELECT count(*) FILTER (WHERE v.dir = 'up')::int FROM outlook_votes v WHERE v.week = r.week AND v.sym = r.sym AND v.gid = $2) AS up, (SELECT count(*)::int FROM outlook_votes v WHERE v.week = r.week AND v.sym = r.sym AND v.gid = $2) AS total FROM outlook_results r WHERE r.sym = $1 ORDER BY r.week DESC LIMIT 10`, [sym, gid])).rows.filter(h => h.total >= minVotes(gid));
    const last = hist[0] && hist[0].week === addDays(week, -7) ? hist[0] : null;
    ok(res, { week, open, opens: w.opens, closes: w.closes, settles: w.settles, eligible: await eligible(u), myVote: mine ? mine.dir : null, peeked, show,
      counts: show ? (c.total >= minVotes(gid) ? c : { total: c.total, few: true }) : null,
      last: last ? { result: last.result, change: last.base > 0 ? last.close / last.base - 1 : 0, pctUp: last.total ? last.up / last.total : 0, total: last.total, myVote: ((await q('SELECT dir FROM outlook_votes WHERE week = $1 AND sym = $2 AND user_id = $3 AND gid = $4', [last.week, sym, u.id, gid])).rows[0] || {}).dir || null } : null,
      history: { weeks: hist.length, right: hist.filter(h => (h.up * 2 >= h.total ? 'up' : 'down') === h.result).length } }); }));
  app.post('/api/outlook/:sym', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const sym = String(req.params.sym).toUpperCase(), gid = String(req.body.gid || ''), dir = req.body.dir === 'down' ? 'down' : 'up', week = weekOf(), w = windowFor(week), now = Date.now();
    if (!Market.MAP[sym]) return bad(res, "That stock isn't available."); if (!(now >= w.opens && now < w.closes)) return bad(res, 'Voting is open from Monday\'s open until Wednesday at 12:00 PM Eastern.');
    if (!(await eligible(u))) return bad(res, 'You can vote once your account is 7 days old.');
    if (gid && !(await q(`SELECT 1 FROM doc_memberships WHERE id = $1 AND data->>'role' <> 'observer'`, [gid + '__u_' + u.id])).rows.length) return bad(res, 'Join the group to vote in its outlook.');
    if ((await q('SELECT 1 FROM outlook_peeks WHERE week = $1 AND sym = $2 AND user_id = $3 AND gid = $4', [week, sym, u.id, gid])).rows.length) return bad(res, 'You looked at the results this week, so you can\'t vote on this stock until next week.');
    await q(`INSERT INTO outlook_votes (week, sym, user_id, gid, dir) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (week, sym, user_id, gid) DO UPDATE SET dir = EXCLUDED.dir, ts = now()`, [week, sym, u.id, gid, dir]);
    computeFor(u.id).catch(() => {}); ok(res); }));
  app.post('/api/outlook/:sym/peek', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    await q(`INSERT INTO outlook_peeks (week, sym, user_id, gid) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [weekOf(), String(req.params.sym).toUpperCase(), u.id, String(req.body.gid || '')]); ok(res); }));
  app.get('/api/outlook-summary', wrap(async (req, res) => { const week = weekOf(), w = windowFor(week);
    if (Date.now() < w.closes) return ok(res, { week, ready: false, closes: w.closes });
    const r = (await q(`SELECT sym, count(*) FILTER (WHERE dir = 'up')::int AS up, count(*)::int AS total FROM outlook_votes WHERE week = $1 AND gid = '' GROUP BY sym HAVING count(*) >= 10`, [week])).rows.filter(x => Market.MAP[x.sym] && Market.price(x.sym) >= 5).map(x => ({ sym: x.sym, pctUp: x.up / x.total, total: x.total }));
    ok(res, { week, ready: true, optimistic: r.slice().sort((a, b) => b.pctUp - a.pctUp).slice(0, 5), pessimistic: r.slice().sort((a, b) => a.pctUp - b.pctUp).slice(0, 5) }); }));
  /* A member's record: private unless they choose to show it. */
  async function record(userId){
    const rows = (await q(`SELECT v.week, v.sym, v.dir, v.gid, r.result FROM outlook_votes v LEFT JOIN outlook_results r ON r.week = v.week AND r.sym = v.sym WHERE v.user_id = $1 ORDER BY v.week`, [userId])).rows;
    const settled = rows.filter(r => r.result && !r.gid), right = settled.filter(r => r.dir === r.result).length; let streak = 0; for (let i = settled.length - 1; i >= 0 && settled[i].dir === settled[i].result; i--) streak++;
    return { rows, calls: settled.length, right, streak, pending: rows.filter(r => !r.result && !r.gid).length };
  }
  app.get('/api/outlook-record/:pid', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; const pid = String(req.params.pid), uid = pid.replace(/^u_/, '');
    const p = ((await q('SELECT data FROM doc_profiles WHERE id = $1', [pid])).rows[0] || {}).data || {}; if (pid !== 'u_' + u.id && !p.outlookPublic) return ok(res, { private: true });
    const r = await record(uid); ok(res, { calls: r.calls, right: r.right, streak: r.streak, pending: r.pending, public: !!p.outlookPublic }); }));
  app.post('/api/outlook-public', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; const { changes } = await db.withTx(async tx => { await tx.update('profiles', 'u_' + u.id, { outlookPublic: !!req.body.on }); }); broadcast(changes); computeFor(u.id).catch(() => {}); ok(res); }));
  /* Settle the previous week once Friday's close has passed (checked every hour). */
  async function settle(){ for (let back = 1; back <= 3; back++){ const week = addDays(weekOf(), -7 * back), w = windowFor(week); if (Date.now() < w.settles + 30 * 60000) continue;
      const syms = (await q(`SELECT DISTINCT sym FROM outlook_votes WHERE week = $1 AND sym NOT IN (SELECT sym FROM outlook_results WHERE week = $1)`, [week])).rows.map(r => r.sym); if (!syms.length) continue;
      const md = require('./marketdata');
      for (const sym of syms){ if (!Market.MAP[sym]) continue; try { if (md.bars) await md.bars(sym, '3m'); } catch (e){}
        const base = Market.price(sym, w.base), close = Market.price(sym, w.settles); if (!(base > 0 && close > 0)) continue;
        await q('INSERT INTO outlook_results (week, sym, base, close, result) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [week, sym, base, close, close >= base ? 'up' : 'down']); }
      const users = (await q('SELECT DISTINCT user_id FROM outlook_votes WHERE week = $1', [week])).rows; for (const x of users) await computeFor(x.user_id).catch(() => {}); } }
  /* Automatic badges, saved on the profile so every app can show them. */
  async function computeFor(userId){ if (!userId) return; const R = await rule(), pid = 'u_' + userId, keys = [];
    const p = ((await q('SELECT data FROM doc_profiles WHERE id = $1', [pid])).rows[0] || {}).data; if (!p) return;
    const rec = await record(userId), wk = weekOf(), weeksVoted = new Set(rec.rows.filter(r => !r.gid).map(r => r.week));
    let run = 0; for (let i = 0; i < 52 && weeksVoted.has(addDays(wk, -7 * i)); i++) run++;
    if (run < R.weeklyRun){ run = 0; for (let i = 1; i < 53 && weeksVoted.has(addDays(wk, -7 * i)); i++) run++; }
    if (run >= R.weeklyRun) keys.push('weekly_caller');
    if ([...Array(13).keys()].filter(i => weeksVoted.has(addDays(wk, -7 * i))).length >= R.regular) keys.push('outlook_regular');
    if (rec.rows.filter(r => r.gid).length >= R.groupCalls) keys.push('group_caller');
    if (R.accuracyOn && p.outlookPublic){ if (rec.streak >= R.streak) keys.push('hot_streak'); if (rec.calls >= R.sharpMin && rec.right / rec.calls * 100 >= R.sharpPct) keys.push('sharp_eye');
      const md = require('./marketdata'), by = {}; rec.rows.filter(r => !r.gid).forEach(r => { const s = (md.sectorOf && md.sectorOf(r.sym)) || null; if (!s) return; const b = by[s] = by[s] || { calls: 0, right: 0, weeks: new Set() }; b.weeks.add(r.week); if (r.result){ b.calls++; if (r.dir === r.result) b.right++; } });
      const sec = []; for (const [s, b] of Object.entries(by)){ if (b.calls >= R.sectorMin && b.right / b.calls * 100 >= R.sectorPct) sec.push(['sharp:' + s, 2, b.calls]); else if ([...Array(10).keys()].filter(i => b.weeks.has(addDays(wk, -7 * i))).length >= R.sectorRegular) sec.push(['regular:' + s, 1, b.weeks.size]); }
      sec.sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, 3).forEach(x => keys.push(x[0])); }
    else { const md = require('./marketdata'), by = {}; rec.rows.filter(r => !r.gid).forEach(r => { const s = (md.sectorOf && md.sectorOf(r.sym)) || null; if (s) (by[s] = by[s] || new Set()).add(r.week); });
      Object.entries(by).filter(([, w]) => [...Array(10).keys()].filter(i => w.has(addDays(wk, -7 * i))).length >= R.sectorRegular).sort((a, b) => b[1].size - a[1].size).slice(0, 3).forEach(([s]) => keys.push('regular:' + s)); }
    /* contribution */
    const fb = (await q('SELECT kind, status, created_at FROM feedback WHERE user_id = $1', [userId])).rows;
    if (fb.some(f => ['considering', 'planned', 'live'].includes(f.status))) keys.push('idea_maker');
    if (fb.some(f => f.status === 'live')) keys.push('idea_shipped');
    if (fb.some(f => f.kind === 'bug' && ['confirmed', 'planned', 'live'].includes(f.status))) keys.push('bug_spotter');
    const launch = ((await q(`SELECT value FROM settings WHERE key = 'fullLaunch'`).catch(() => ({ rows: [] }))).rows[0] || {}).value, launchTs = launch ? Date.parse(String(launch).replace(/"/g, '')) : null;
    const ck = (await q('SELECT ts FROM checkins WHERE user_id = $1 AND NOT skipped', [userId]).catch(() => ({ rows: [] }))).rows;
    if (fb.concat(ck.map(c => ({ created_at: c.ts }))).some(f => !launchTs || new Date(f.created_at).getTime() < launchTs) && (fb.length || ck.length)) keys.push('beta_tester');
    const refs = Number((await q(`SELECT count(*)::int AS n FROM referrals WHERE referrer_user = $1 AND status = 'rewarded'`, [userId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
    if (refs >= 1) keys.push('connector'); if (refs >= 4) keys.push('ambassador');
    if (Number((await q(`SELECT count(*)::int AS n FROM doc_votes WHERE data->>'pid' = $1`, [pid])).rows[0].n) >= 10) keys.push('voter');
    const books = (await q(`SELECT b.gid, b.data FROM club_books b JOIN doc_memberships m ON m.id = b.gid || '__' || $1 WHERE m.data->>'role' IN ('treasurer', 'asstTreasurer')`, [pid]).catch(() => ({ rows: [] }))).rows;
    if (books.reduce((n, b) => n + ((b.data.closes || []).filter(c => c.preparedBy === pid).length), 0) >= 3) keys.push('club_treasurer');
    if ((await q(`SELECT 1 FROM doc_groups g WHERE g.data->>'ownerPid' = $1 AND (SELECT count(*) FROM doc_memberships m WHERE m.data->>'gid' = g.id AND m.data->>'role' <> 'observer') >= 5 LIMIT 1`, [pid])).rows.length) keys.push('group_builder');
    if (Number((await q(`SELECT count(*)::int AS n FROM doc_posts p WHERE p.data->>'pid' = $1 AND EXISTS (SELECT 1 FROM doc_comments c WHERE c.data->>'postId' = p.id AND c.data->>'pid' <> $1)`, [pid])).rows[0].n) >= 5) keys.push('conversation_starter');
    const prev = JSON.stringify(p.autoBadges || []), next = JSON.stringify(keys); if (prev === next) return;
    const { changes } = await db.withTx(async tx => { await tx.update('profiles', pid, { autoBadges: keys }); });
    const fresh = keys.filter(k => !(p.autoBadges || []).includes(k)); if (fresh.length) changes.push({ col: '_notify', pids: [pid], payload: { title: 'You earned a badge', body: 'See it on your profile and the badges page.', url: '/#/badges', tag: 'badge-' + Date.now() } });
    broadcast(changes); }
  global.__contrib = computeFor;
  app.get('/api/badge-progress', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; const rec = await record(u.id), wk = weekOf(), weeksVoted = new Set(rec.rows.filter(r => !r.gid).map(r => r.week)); let run = 0; for (let i = 0; i < 52 && weeksVoted.has(addDays(wk, -7 * i)); i++) run++;
    ok(res, { run, last13: [...Array(13).keys()].filter(i => weeksVoted.has(addDays(wk, -7 * i))).length, groupCalls: rec.rows.filter(r => r.gid).length, calls: rec.calls, right: rec.right, streak: rec.streak, rule: await rule(),
      votes: Number((await q(`SELECT count(*)::int AS n FROM doc_votes WHERE data->>'pid' = $1`, ['u_' + u.id])).rows[0].n),
      convo: Number((await q(`SELECT count(*)::int AS n FROM doc_posts p WHERE p.data->>'pid' = $1 AND EXISTS (SELECT 1 FROM doc_comments c WHERE c.data->>'postId' = p.id AND c.data->>'pid' <> $1)`, ['u_' + u.id])).rows[0].n),
      referrals: Number((await q(`SELECT count(*)::int AS n FROM referrals WHERE referrer_user = $1 AND status = 'rewarded'`, [u.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n) }); }));
  setInterval(() => settle().catch(e => console.error('outlook settle', e.message)), 3600000); setTimeout(() => settle().catch(() => {}), 60000);
  setInterval(async () => { try { for (const r of (await q(`SELECT id FROM users WHERE NOT coalesce(disabled, false)`)).rows) await computeFor(r.id).catch(() => {}); } catch (e){} }, 3 * 3600000);
}
module.exports = { migrate, mount, weekOf, windowFor };
