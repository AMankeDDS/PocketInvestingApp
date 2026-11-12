/* Price alerts, watchlist big-move alerts, the weekly group recap, and the practice copy stop-loss check. */
const Market = require('./market');
const crypto = require('crypto');
const newId = () => crypto.randomBytes(8).toString('hex');
async function migrate(q){
  await q(`CREATE TABLE IF NOT EXISTS price_alerts (id text PRIMARY KEY, user_id text NOT NULL, sym text NOT NULL, kind text NOT NULL, value numeric NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), triggered_at timestamptz, triggered_price numeric)`);
  await q(`CREATE TABLE IF NOT EXISTS alert_prefs (user_id text PRIMARY KEY, watch_moves boolean NOT NULL DEFAULT false, threshold numeric NOT NULL DEFAULT 5)`);
  await q(`CREATE TABLE IF NOT EXISTS alert_marks (user_id text NOT NULL, key text NOT NULL, day date NOT NULL DEFAULT current_date, PRIMARY KEY (user_id, key, day))`);
}
const dayChange = sym => { const qt = Market.QUOTES[sym]; if (qt && qt.prev && Date.now() - qt.t < 15 * 60000) return qt.p / qt.prev - 1; const a = Market.price(sym, Date.now() - 86400000), b = Market.price(sym); return a ? b / a - 1 : 0; };
const pctTxt = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
function mount(app, d){
  const { q, wrap, ok, bad, needUser, sendTo, push, db } = d;
  const say = (uid, title, body, url) => { push.send(db.pool, ['u_' + uid], { title, body, url, tag: 'alert-' + title }).catch(() => {}); sendTo(uid, { type: 'alert', text: title + '. ' + body }); };
  app.get('/api/alerts', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const pref = (await q('SELECT watch_moves, threshold FROM alert_prefs WHERE user_id = $1', [u.id])).rows[0] || { watch_moves: false, threshold: 5 };
    ok(res, { alerts: (await q('SELECT id, sym, kind, value, active, created_at, triggered_at, triggered_price FROM price_alerts WHERE user_id = $1 ORDER BY active DESC, created_at DESC LIMIT 100', [u.id])).rows.map(a => ({ ...a, value: Number(a.value), triggered_price: a.triggered_price == null ? null : Number(a.triggered_price) })), watchMoves: pref.watch_moves, threshold: Number(pref.threshold) }); }));
  app.post('/api/alerts', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    if (req.body.remove){ await q('DELETE FROM price_alerts WHERE id = $1 AND user_id = $2', [String(req.body.remove), u.id]); return ok(res); }
    if (req.body.prefs){ const th = [3, 5, 10].includes(Number(req.body.threshold)) ? Number(req.body.threshold) : 5;
      await q('INSERT INTO alert_prefs (user_id, watch_moves, threshold) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET watch_moves = EXCLUDED.watch_moves, threshold = EXCLUDED.threshold', [u.id, !!req.body.watchMoves, th]); return ok(res); }
    const sym = String(req.body.sym || '').toUpperCase(), kind = ['above', 'below', 'move'].includes(req.body.kind) ? req.body.kind : null, value = Number(req.body.value);
    if (!Market.MAP[sym]) return bad(res, "That stock isn't available."); if (!kind || !(value > 0)) return bad(res, kind === 'move' ? 'Enter a percentage above zero.' : 'Enter a price above zero.');
    if (kind === 'above' && value <= Market.price(sym)) return bad(res, `${sym} is already at or above that price. Pick a higher price.`);
    if (kind === 'below' && value >= Market.price(sym)) return bad(res, `${sym} is already at or below that price. Pick a lower price.`);
    if ((await q('SELECT count(*)::int AS n FROM price_alerts WHERE user_id = $1 AND active', [u.id])).rows[0].n >= 50) return bad(res, 'You can have up to 50 active alerts. Remove one to add another.');
    await q('INSERT INTO price_alerts (id, user_id, sym, kind, value) VALUES ($1, $2, $3, $4, $5)', [newId(), u.id, sym, kind, value]); ok(res); }));
  /* Check alerts every minute. */
  async function checkAlerts(){
    for (const a of (await q('SELECT * FROM price_alerts WHERE active')).rows){
      if (!Market.MAP[a.sym]) continue; const p = Market.price(a.sym), v = Number(a.value), c = dayChange(a.sym);
      const hit = a.kind === 'above' ? p >= v : a.kind === 'below' ? p <= v : Math.abs(c) * 100 >= v; if (!hit) continue;
      await q('UPDATE price_alerts SET active = false, triggered_at = now(), triggered_price = $2 WHERE id = $1', [a.id, p]);
      say(a.user_id, a.kind === 'move' ? `${a.sym} moved ${pctTxt(c)} today` : `${a.sym} is ${a.kind === 'above' ? 'above' : 'below'} $${v.toFixed(2)}`, `Now $${p.toFixed(2)}. This alert is done; set a new one any time.`, '/#/stock/' + a.sym);
    }
    for (const pr of (await q('SELECT * FROM alert_prefs WHERE watch_moves')).rows){
      const w = (((await q('SELECT data FROM doc_profiles WHERE id = $1', ['u_' + pr.user_id])).rows[0] || {}).data || {}).watchlist || [];
      for (const sym of w){ if (!Market.MAP[sym]) continue; const c = dayChange(sym); if (Math.abs(c) * 100 < Number(pr.threshold)) continue;
        const ins = await q('INSERT INTO alert_marks (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [pr.user_id, 'watch:' + sym]); if (!ins.rows.length) continue;
        say(pr.user_id, `${sym} moved ${pctTxt(c)} today`, `A big move for a stock on your watchlist. Now $${Market.price(sym).toFixed(2)}.`, '/#/stock/' + sym); }
    }
  }
  setInterval(() => checkAlerts().catch(e => console.error('alerts', e.message)), 60000);
  /* Weekly group recap: Monday mornings (13:00 UTC), one push per member per group, linking to the 7-day digest. */
  async function weeklyRecap(){
    const now = new Date(); if (now.getUTCDay() !== 1 || now.getUTCHours() < 13) return;
    const wk = now.toISOString().slice(0, 10); if ((await d.getSetting('recapWeek', null)) === wk) return; await d.setSetting('recapWeek', wk);
    const since = Date.now() - 7 * 86400000;
    for (const g of (await q('SELECT id, data FROM doc_groups')).rows){
      const ms = (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [g.id])).rows.map(r => r.data); if (!ms.length) continue;
      const trades = Number((await q(`SELECT count(*)::int AS n FROM doc_trades WHERE data->>'groupId' = $1 AND (data->>'ts')::bigint > $2`, [g.id, since])).rows[0].n);
      const props = (await q(`SELECT data FROM doc_proposals WHERE data->>'gid' = $1`, [g.id]).catch(() => ({ rows: [] }))).rows.map(r => r.data);
      const opened = props.filter(p => (p.createdTs || 0) > since).length, joined = ms.filter(m => (m.joinedTs || 0) > since).length;
      if (!trades && !opened && !joined) continue;
      const body = [trades ? `${trades} trade${trades === 1 ? '' : 's'}` : '', opened ? `${opened} vote${opened === 1 ? '' : 's'} opened` : '', joined ? `${joined} new member${joined === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') + '. See the week.';
      for (const m of ms){ const p = ((await q('SELECT data FROM doc_profiles WHERE id = $1', [m.pid])).rows[0] || {}).data || {}, n = p.notif || {};
        if (n.weeklyRecap === false || (n.mutedGroups || []).includes(g.id) || !String(m.pid).startsWith('u_')) continue;
        push.send(db.pool, [m.pid], { title: `Your week in ${g.data.name || 'your group'}`, body, url: '/#/digest', tag: 'recap-' + g.id }).catch(() => {}); }
    }
  }
  setInterval(() => weeklyRecap().catch(e => console.error('recap', e.message)), 15 * 60000);
  /* Practice copy stop-loss, every two minutes. */
  setInterval(async () => { try { let made = 0; const { changes } = await db.withTx(async tx => { made = await d.logic.copyStopCheck(tx); }); if (made) d.broadcast(changes); } catch (e){ console.error('stop-loss', e.message); } }, 120000);
}
module.exports = { migrate, mount };
