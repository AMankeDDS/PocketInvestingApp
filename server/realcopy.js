/* Real-money copying (sandbox for now). When a leader's own real order fills, everyone copying them, and the
   members of groups they lead, get an approval request sized to their own account. Approving places a real
   order in the follower's brokerage account; nothing is placed without the follower's approval.
   Also: the replication report for admins, and the bank-and-deposit setup for admin-made test accounts. */
const crypto = require('crypto');
const alpaca = require('./alpaca');
const config = require('./config');
const Market = require('./market');
const OPEN = ['QUEUED', 'SENT_TO_CLEARING', 'APPROVAL_PENDING', 'PENDING', 'SUBMITTED'];
const newId = () => crypto.randomBytes(10).toString('hex');
const r6 = x => Math.floor(Number(x) * 1e6) / 1e6;

async function migrate(q){
  await q(`CREATE TABLE IF NOT EXISTS real_copy_requests (id text PRIMARY KEY, leader_user text NOT NULL, leader_order text NOT NULL, follower_user text NOT NULL, gid text,
    sym text NOT NULL, side text NOT NULL, leader_price numeric, leader_qty numeric, suggested_qty numeric, fraction numeric, status text NOT NULL, reason text, order_id text,
    filled_qty numeric, fill_price numeric, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz)`);
  await q(`CREATE INDEX IF NOT EXISTS real_copy_follower ON real_copy_requests (follower_user, created_at DESC)`);
  await q(`CREATE TABLE IF NOT EXISTS test_setup (user_id text PRIMARY KEY, deposit numeric NOT NULL DEFAULT 0, step text NOT NULL DEFAULT 'account', note text, updated_at timestamptz NOT NULL DEFAULT now())`);
}

function mount(app, d){
  const { q, wrap, ok, bad, needUser, needAdmin, sendTo, push, getSetting } = d;
  const acct = async userId => (await q('SELECT * FROM broker_accounts WHERE user_id = $1', [userId])).rows[0];
  const name = async userId => ((((await q('SELECT data FROM doc_profiles WHERE id = $1', ['u_' + userId])).rows[0]) || {}).data || {}).name || 'Someone';
  const notify = (userId, payload) => { try { push.send(d.pool, ['u_' + userId], payload); } catch (e){} sendTo(userId, { type: 'real', what: 'copyreq' }); };

  /* Called by the order sync whenever a real order changes status. */
  d.onOrderUpdate = async (o, status, filledQty, filledPrice) => {
    if (status === 'filled' && o.source === 'copy' && o.ref){
      await q(`UPDATE real_copy_requests SET status = 'filled', filled_qty = $2, fill_price = $3 WHERE id = $1`, [o.ref, filledQty, filledPrice]);
      sendTo(o.user_id, { type: 'real', what: 'copyreq' });
    } else if (['rejected', 'canceled', 'expired'].includes(status) && o.source === 'copy' && o.ref){
      await q(`UPDATE real_copy_requests SET status = 'failed', reason = $2 WHERE id = $1`, [o.ref, 'The brokerage ' + status + ' the order.']);
    } else if (status === 'filled' && (o.source || 'personal') === 'personal') await leaderFilled(o, Number(filledQty), Number(filledPrice));
  };

  async function leaderFilled(o, qty, px){
    if (!(qty > 0) || !(px > 0)) return;
    const leaderPid = 'u_' + o.user_id, la = await acct(o.user_id); if (!la) return;
    let lEquity = 0, lHeldAfter = 0;
    try { lEquity = Number((await alpaca.tradingAccount(la.alpaca_id)).equity || 0); lHeldAfter = Number((((await alpaca.positions(la.alpaca_id)) || []).find(p => p.symbol === o.sym) || {}).qty || 0); } catch (e){}
    /* What share of the leader's account this trade was (buys), or of their position (sells). */
    const fraction = o.side === 'buy' ? Math.min(1, lEquity > 0 ? qty * px / lEquity : 0) : Math.min(1, qty / Math.max(qty, lHeldAfter + qty));
    if (!(fraction > 0)) return;
    const followers = new Map();
    for (const r of (await q(`SELECT data FROM doc_copies WHERE data->>'to' = $1`, [leaderPid])).rows) { if (!r.data.copyPaused) followers.set(r.data.from, { pct: r.data.copyPct ?? 1, gid: null }); }
    const groups = (await q(`SELECT id, data FROM doc_groups WHERE data->>'leadPid' = $1`, [leaderPid])).rows;
    for (const g of groups) for (const m of (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [g.id])).rows.map(r => r.data))
      if (m.pid !== leaderPid && m.role !== 'observer' && !m.copyPaused && !followers.has(m.pid)) followers.set(m.pid, { pct: m.copyPct ?? 1, gid: g.id, mins: Number((g.data.rules || {}).approvalMinutes) || 30 });
    const lname = await name(o.user_id);
    for (const [pid, f] of followers){
      const uid = pid.replace(/^u_/, ''), fa = await acct(uid), id = newId();
      const base = [id, o.user_id, o.id, uid, f.gid, o.sym, o.side, px, qty];
      if (!fa || fa.status !== 'ACTIVE'){ await q(`INSERT INTO real_copy_requests (id, leader_user, leader_order, follower_user, gid, sym, side, leader_price, leader_qty, fraction, status, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'skipped',$11)`, [...base, fraction, 'No active brokerage account']); continue; }
      let suggested = 0, reason = null;
      try {
        if (o.side === 'buy'){ const eq = Number((await alpaca.tradingAccount(fa.alpaca_id)).equity || 0); suggested = r6(fraction * eq * f.pct / px); if (!(suggested > 0)) reason = 'No money in the account to copy with'; }
        else { const held = Number((((await alpaca.positions(fa.alpaca_id)) || []).find(p => p.symbol === o.sym) || {}).qty || 0); suggested = r6(fraction * held * f.pct); if (!(suggested > 0)) reason = `Doesn't own any ${o.sym} to sell`; }
      } catch (e){ reason = 'Could not read the account: ' + e.message; }
      if (reason){ await q(`INSERT INTO real_copy_requests (id, leader_user, leader_order, follower_user, gid, sym, side, leader_price, leader_qty, fraction, status, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'skipped',$11)`, [...base, fraction, reason]); continue; }
      const mins = f.gid ? f.mins : 30;
      await q(`INSERT INTO real_copy_requests (id, leader_user, leader_order, follower_user, gid, sym, side, leader_price, leader_qty, suggested_qty, fraction, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending', now() + ($12 || ' minutes')::interval)`, [...base, suggested, fraction, String(mins)]);
      notify(uid, { title: `${lname} ${o.side === 'buy' ? 'bought' : 'sold'} ${o.sym}`, body: `Real money: approve to ${o.side} ${suggested} shares in your account. Nothing happens until you approve.`, url: '/#/portfolio', tag: 'realcopy-' + id });
    }
  }

  const view = async r => ({ id: r.id, leader: await name(r.leader_user), gid: r.gid, sym: r.sym, side: r.side, leaderPrice: Number(r.leader_price), suggested: Number(r.suggested_qty || 0), status: r.status, reason: r.reason,
    expiresTs: r.expires_at ? new Date(r.expires_at).getTime() : null, createdTs: new Date(r.created_at).getTime(), fillPrice: r.fill_price ? Number(r.fill_price) : null, filledQty: r.filled_qty ? Number(r.filled_qty) : null });
  app.get('/api/real/copy-requests', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const rows = (await q(`SELECT * FROM real_copy_requests WHERE follower_user = $1 AND status <> 'skipped' ORDER BY created_at DESC LIMIT 30`, [u.id])).rows;
    const out = []; for (const r of rows) out.push(await view(r)); ok(res, { requests: out });
  }));
  app.post('/api/real/copy/:id/decide', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const r = (await q('SELECT * FROM real_copy_requests WHERE id = $1 AND follower_user = $2', [req.params.id, u.id])).rows[0];
    if (!r) return bad(res, 'That request is no longer available.');
    if (r.status !== 'pending') return bad(res, 'This request was already ' + r.status + '.');
    if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()){ await q(`UPDATE real_copy_requests SET status = 'expired' WHERE id = $1`, [r.id]); return bad(res, 'The approval window for this trade has closed.'); }
    if (req.body.decision !== 'approve'){ await q(`UPDATE real_copy_requests SET status = 'declined', decided_at = now() WHERE id = $1`, [r.id]); return ok(res, { status: 'declined' }); }
    if (await getSetting('realPaused', false)) return bad(res, 'Real-money trading is paused right now. Please try again later.');
    const a = await acct(u.id); if (!a || a.status !== 'ACTIVE') return bad(res, 'Your brokerage account is not active yet.');
    const qty = r6(Number(r.suggested_qty) * (req.body.fraction === 'half' ? 0.5 : 1)); if (!(qty > 0)) return bad(res, 'That amount is too small to place.');
    if (r.side === 'buy'){ const bp = Number((await alpaca.tradingAccount(a.alpaca_id)).buying_power || 0), est = qty * (Market.price(r.sym) || Number(r.leader_price));
      if (est > bp + 0.01) return bad(res, `This copy needs about $${est.toFixed(2)} and you have $${bp.toFixed(2)} of buying power. Try half size, or add money first.`); }
    else { const held = Number((((await alpaca.positions(a.alpaca_id)) || []).find(p => p.symbol === r.sym) || {}).qty || 0); if (qty > held + 1e-6) return bad(res, `You own ${held} shares of ${r.sym} now, fewer than this copy would sell.`); }
    const oid = newId();
    await q('INSERT INTO real_orders (id, user_id, sym, side, qty, notional, status, source, ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [oid, u.id, r.sym, r.side, qty, null, 'sending', 'copy', r.id]);
    try {
      const o = await alpaca.createOrder(a.alpaca_id, { symbol: r.sym, side: r.side, type: 'market', time_in_force: 'day', qty: String(qty), client_order_id: oid });
      await q('UPDATE real_orders SET alpaca_order_id = $1, status = $2, filled_qty = $3, filled_avg_price = $4, updated_at = now() WHERE id = $5', [o.id, o.status || 'new', o.filled_qty || 0, o.filled_avg_price || null, oid]);
      await q(`UPDATE real_copy_requests SET status = 'placed', order_id = $2, decided_at = now() WHERE id = $1`, [r.id, oid]);
      if (o.status === 'filled') await q(`UPDATE real_copy_requests SET status = 'filled', filled_qty = $2, fill_price = $3 WHERE id = $1`, [r.id, Number(o.filled_qty || qty), Number(o.filled_avg_price || 0)]);
    } catch (e){
      await q(`UPDATE real_orders SET status = 'rejected', message = $1, updated_at = now() WHERE id = $2`, [e.message, oid]);
      await q(`UPDATE real_copy_requests SET status = 'failed', reason = $2, decided_at = now() WHERE id = $1`, [r.id, e.message]); throw e;
    }
    ok(res, { status: 'placed' });
  }));
  /* Replication report: every leader fill with what happened for each follower. */
  app.get('/api/admin/replication', wrap(async (req, res) => {
    if (!(await needAdmin(req, res))) return;
    const rows = (await q(`SELECT c.*, u.username AS follower, l.username AS leader, o.filled_qty AS lq, o.filled_avg_price AS lp, o.updated_at AS lts FROM real_copy_requests c
      JOIN users u ON u.id = c.follower_user JOIN users l ON l.id = c.leader_user LEFT JOIN real_orders o ON o.id = c.leader_order ORDER BY c.created_at DESC LIMIT 300`)).rows;
    const by = new Map();
    for (const r of rows){ const k = r.leader_order; if (!by.has(k)) by.set(k, { leader: r.leader, sym: r.sym, side: r.side, qty: Number(r.lq || r.leader_qty), price: Number(r.lp || r.leader_price), ts: new Date(r.lts || r.created_at).getTime(), followers: [] });
      by.get(k).followers.push({ follower: r.follower, gid: r.gid, status: r.status, reason: r.reason, suggested: Number(r.suggested_qty || 0), filledQty: r.filled_qty ? Number(r.filled_qty) : null, fillPrice: r.fill_price ? Number(r.fill_price) : null,
        slip: r.fill_price && r.leader_price ? Number(r.fill_price) / Number(r.leader_price) - 1 : null }); }
    ok(res, { trades: [...by.values()] });
  }));
  /* Real-money copy stop-loss: same settings as practice; asks to sell or pauses copying. */
  async function realStopCheck(){
    const rels = (await q(`SELECT data FROM doc_copies WHERE (data->>'stopPct') IS NOT NULL`)).rows.map(r => ({ coll: 'copies', id: r.data.from + '__' + r.data.to, follower: r.data.from, leaderUser: String(r.data.to).replace(/^u_/, ''), gid: null, d: r.data }))
      .concat((await q(`SELECT data FROM doc_memberships WHERE (data->>'stopPct') IS NOT NULL`)).rows.map(r => ({ coll: 'memberships', id: r.data.gid + '__' + r.data.pid, follower: r.data.pid, leaderUser: null, gid: r.data.gid, d: r.data })));
    for (const r of rels){
      if (r.d.copyPaused || !r.d.stopPct) continue; const uid = r.follower.replace(/^u_/, ''), fa = await acct(uid); if (!fa || fa.status !== 'ACTIVE') continue;
      const rows = (await q(`SELECT * FROM real_copy_requests WHERE follower_user = $1 AND status = 'filled' AND leader_order <> 'stop' AND ${r.gid ? 'gid = $2' : 'gid IS NULL AND leader_user = $2'}`, [uid, r.gid || r.leaderUser])).rows;
      const by = {}; for (const x of rows){ const b = by[x.sym] = by[x.sym] || { sh: 0, cost: 0, bought: 0 }; const sh = Number(x.filled_qty || 0); if (x.side === 'buy'){ b.sh += sh; b.bought += sh; b.cost += sh * Number(x.fill_price || 0); } else b.sh -= sh; }
      let pos = []; try { pos = (await alpaca.positions(fa.alpaca_id)) || []; } catch (e){ continue; }
      for (const [sym, b] of Object.entries(by)){
        const held = Number((pos.find(p => p.symbol === sym) || {}).qty || 0), copied = Math.min(held, b.sh); if (!(copied > 1e-6) || !(b.bought > 0)) continue;
        const avg = b.cost / b.bought, px = Market.price(sym), drop = 1 - px / avg; if (!(drop >= r.d.stopPct / 100)) continue;
        if ((await q(`SELECT 1 FROM real_copy_requests WHERE follower_user = $1 AND sym = $2 AND leader_order = 'stop' AND (status = 'pending' OR created_at > now() - interval '1 day')`, [uid, sym])).rows.length) continue;
        if (r.d.stopAction === 'stop'){ const doc = r.d; doc.copyPaused = true; await q(`UPDATE doc_${r.coll} SET data = $2 WHERE id = $1`, [r.id, JSON.stringify(doc)]).catch(() => {});
          notify(uid, { title: 'Copying paused', body: `${sym} fell ${Math.round(drop * 100)}% below what you paid, past your ${r.d.stopPct}% limit.`, url: '/#/portfolio', tag: 'rstop-' + r.id }); break; }
        await q(`INSERT INTO real_copy_requests (id, leader_user, leader_order, follower_user, gid, sym, side, leader_price, leader_qty, suggested_qty, fraction, status, reason, expires_at) VALUES ($1,$2,'stop',$3,$4,$5,'sell',$6,0,$7,1,'pending',$8, now() + interval '30 minutes')`,
          [newId(), r.leaderUser || uid, uid, r.gid, sym, px, r6(copied), `Stop-loss: down ${Math.round(drop * 100)}% from what you paid (limit ${r.d.stopPct}%)`]);
        notify(uid, { title: `${sym} is down ${Math.round(drop * 100)}% from your copy`, body: 'Real money: past your limit. Approve to sell, or decline to keep it.', url: '/#/portfolio', tag: 'rstop-' + r.id + sym });
      }
    }
  }
  setInterval(() => realStopCheck().catch(e => console.error('real stop-loss', e.message)), 120000);
  /* Expire requests nobody answered. */
  setInterval(() => q(`UPDATE real_copy_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`).catch(() => {}), 60000);
}

/* Test accounts: once the sandbox approves the brokerage account, link a test bank and make the starting deposit. */
async function testSetupTick(q){
  for (const t of (await q(`SELECT s.*, b.alpaca_id, b.status FROM test_setup s JOIN broker_accounts b ON b.user_id = s.user_id WHERE s.step <> 'done'`)).rows){
    if (t.status !== 'ACTIVE') continue;
    try {
      if (t.step === 'account'){ let bank = ((await alpaca.listAch(t.alpaca_id)) || [])[0];
        if (!bank) bank = await alpaca.createAch(t.alpaca_id, { account_owner_name: 'Test User', bank_account_type: 'CHECKING', bank_account_number: '123456789', bank_routing_number: '121000358', nickname: 'Test bank' });
        await q(`UPDATE test_setup SET step = 'bank', updated_at = now() WHERE user_id = $1`, [t.user_id]); continue; }
      if (t.step === 'bank'){ const bank = ((await alpaca.listAch(t.alpaca_id)) || []).find(b => b.status === 'APPROVED' || b.status === 'QUEUED') || ((await alpaca.listAch(t.alpaca_id)) || [])[0];
        if (!bank) continue;
        if (Number(t.deposit) > 0){ const x = await alpaca.createTransfer(t.alpaca_id, { transfer_type: 'ach', relationship_id: bank.id, amount: Number(t.deposit).toFixed(2), direction: 'INCOMING' });
          await q('INSERT INTO real_transfers (id, user_id, direction, amount, status) VALUES ($1, $2, $3, $4, $5)', [x.id, t.user_id, 'INCOMING', Number(t.deposit), x.status || 'QUEUED']); }
        await q(`UPDATE test_setup SET step = 'done', updated_at = now() WHERE user_id = $1`, [t.user_id]); }
    } catch (e){ await q(`UPDATE test_setup SET note = $2, updated_at = now() WHERE user_id = $1`, [t.user_id, String(e.message).slice(0, 200)]); }
  }
}

module.exports = { migrate, mount, testSetupTick, OPEN };
