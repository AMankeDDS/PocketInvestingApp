/* Referrals, the one-week check-in, and the onboarding funnel.
   Referral reward: 3 months of Pro credit when an invited member's real-money deposit over $100 settles; up to 4 per member. */
const crypto = require('crypto');
let D = null;
async function migrate(q){
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code text UNIQUE, ADD COLUMN IF NOT EXISTS referred_by text`);
  await q(`CREATE TABLE IF NOT EXISTS referrals (referred_user text PRIMARY KEY, referrer_user text NOT NULL, status text NOT NULL, amount numeric, reason text, created_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS checkins (user_id text PRIMARY KEY, score int, comment text, skipped boolean NOT NULL DEFAULT false, ts timestamptz NOT NULL DEFAULT now())`);
}
async function onDeposit(userId, amount){
  if (!D || !(amount > 100)) return; const { q, db } = D;
  const u = (await q('SELECT referred_by FROM users WHERE id = $1', [userId])).rows[0]; if (!u || !u.referred_by) return;
  if ((await q('SELECT 1 FROM referrals WHERE referred_user = $1', [userId])).rows.length) return;
  const by = u.referred_by; let status = 'rewarded', reason = null;
  if (by === userId){ status = 'blocked'; reason = 'Self-referral'; }
  else {
    try { const alp = require('./alpaca'), a1 = (await q('SELECT alpaca_id FROM broker_accounts WHERE user_id = $1', [by])).rows[0], a2 = (await q('SELECT alpaca_id FROM broker_accounts WHERE user_id = $1', [userId])).rows[0];
      if (a1 && a2){ const key = b => String(b.bank_routing_number || '') + ':' + String(b.bank_account_number || '').slice(-4); const k1 = new Set(((await alp.listAch(a1.alpaca_id)) || []).map(key)); if (((await alp.listAch(a2.alpaca_id)) || []).some(b => k1.has(key(b)))){ status = 'blocked'; reason = 'Same bank account as the inviter'; } } } catch (e){}
    if (status === 'rewarded' && Number((await q(`SELECT count(*)::int AS n FROM referrals WHERE referrer_user = $1 AND status = 'rewarded'`, [by])).rows[0].n) >= 4){ status = 'over_cap'; reason = 'Already earned the maximum of 4 rewards'; }
  }
  await q('INSERT INTO referrals (referred_user, referrer_user, status, amount, reason) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [userId, by, status, amount, reason]);
  if (status !== 'rewarded') return;
  const { changes } = await db.withTx(async tx => { const p = await tx.get('profiles', 'u_' + by); if (p) await tx.update('profiles', 'u_' + by, { proCreditMonths: (p.proCreditMonths || 0) + 3, referralsRewarded: (p.referralsRewarded || 0) + 1 }); }); D.broadcast(changes);
  D.push.send(db.pool, ['u_' + by], { title: 'You earned 3 months of Pro', body: 'A friend you invited opened their account. Thanks for spreading the word.', url: '/#/u/u_' + by, tag: 'ref-' + userId }).catch(() => {});
}
function mount(app, d){
  D = d; const { q, wrap, ok, bad, needUser, needAdmin } = d;
  const code = () => crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7);
  app.get('/api/referral', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    let r = (await q('SELECT ref_code FROM users WHERE id = $1', [u.id])).rows[0].ref_code;
    for (let i = 0; !r && i < 5; i++){ const c = code(); try { await q('UPDATE users SET ref_code = $2 WHERE id = $1 AND ref_code IS NULL', [u.id, c]); r = (await q('SELECT ref_code FROM users WHERE id = $1', [u.id])).rows[0].ref_code; } catch (e){} }
    const rows = (await q('SELECT status FROM referrals WHERE referrer_user = $1', [u.id])).rows, joined = Number((await q('SELECT count(*)::int AS n FROM users WHERE referred_by = $1', [u.id])).rows[0].n);
    ok(res, { code: r, joined, rewarded: rows.filter(x => x.status === 'rewarded').length, max: 4 }); }));
  app.get('/api/ref/:code', wrap(async (req, res) => { const r = (await q('SELECT display_name FROM users WHERE ref_code = $1', [String(req.params.code || '').toUpperCase()])).rows[0]; ok(res, { valid: !!r, name: r ? r.display_name : null }); }));
  app.post('/api/checkin', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return;
    const skip = !!req.body.skip, score = skip ? null : Math.round(Number(req.body.score)); if (!skip && !(score >= 0 && score <= 10)) return bad(res, 'Pick a number from 0 to 10.');
    await q('INSERT INTO checkins (user_id, score, comment, skipped) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING', [u.id, score, skip ? null : String(req.body.comment || '').slice(0, 1000), skip]);
    const { changes } = await d.db.withTx(async tx => { if (await tx.get('profiles', 'u_' + u.id)) await tx.update('profiles', 'u_' + u.id, { checkinTs: Date.now() }); }); d.broadcast(changes); ok(res); }));
  /* Beta admin: check-in results, referrals, and the onboarding funnel by week of sign-up. */
  app.get('/api/admin/insights', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
    const ci = (await q('SELECT score, comment, skipped, ts FROM checkins ORDER BY ts DESC')).rows, scored = ci.filter(x => x.score != null);
    const nps = scored.length ? Math.round(100 * (scored.filter(x => x.score >= 9).length - scored.filter(x => x.score <= 6).length) / scored.length) : null;
    const refs = (await q(`SELECT r.*, a.username AS referrer, b.username AS referred, (SELECT coalesce(sum(amount), 0) FROM real_transfers t WHERE t.user_id = r.referred_user AND t.direction = 'OUTGOING' AND t.created_at < r.created_at + interval '30 days' AND t.created_at >= r.created_at) AS out30 FROM referrals r LEFT JOIN users a ON a.id = r.referrer_user LEFT JOIN users b ON b.id = r.referred_user ORDER BY r.created_at DESC LIMIT 200`).catch(() => ({ rows: [] }))).rows;
    const fun = (await q(`WITH u AS (SELECT id, created_at FROM users WHERE coalesce(is_test, false) = false AND created_at > now() - interval '10 weeks')
      SELECT to_char(date_trunc('week', u.created_at), 'YYYY-MM-DD') AS week, count(*)::int AS signed_up,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM doc_trades t WHERE t.data->>'pid' = 'u_' || u.id))::int AS traded,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM doc_follows f WHERE f.data->>'from' = 'u_' || u.id))::int AS followed,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM doc_memberships m WHERE m.data->>'pid' = 'u_' || u.id))::int AS joined_group,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name = 'visit' AND e.ts > u.created_at + interval '1 day' AND e.ts <= u.created_at + interval '7 days'))::int AS came_back
      FROM u GROUP BY 1 ORDER BY 1 DESC`).catch(e => ({ rows: [], error: e.message }))).rows;
    ok(res, { checkins: { answered: scored.length, skipped: ci.filter(x => x.skipped).length, nps, comments: scored.filter(x => x.comment).slice(0, 30).map(x => ({ score: x.score, comment: x.comment, ts: x.ts })) },
      referrals: refs.map(r => ({ referrer: r.referrer, referred: r.referred, status: r.status, reason: r.reason, amount: Number(r.amount || 0), ts: r.created_at, withdrawn30: Number(r.out30 || 0) })), funnel: fun }); }));
}
module.exports = { migrate, mount, onDeposit };
