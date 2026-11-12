/* Real money through Alpaca: account opening, bank links, deposits and withdrawals,
   orders, statements, background syncing, and instant deposits (built, off by default).
   Only active when SITE_MODE=live and BROKER=alpaca. Real balances are private to each user
   and never go into the shared live feed. */
const config = require('./config');
const alpaca = require('./alpaca');
const Market = require('./market');
const totp = require('./totp');
const qrcode = require('qrcode');

const OPEN_ORDER = ['new','accepted','pending_new','partially_filled','accepted_for_bidding','held','pending_cancel','pending_replace','calculated','done_for_day'];
const DONE_TRANSFER = ['COMPLETE','RETURNED','CANCELED','REJECTED'];
const ACCOUNT_LABEL = { SUBMITTED:'Submitted', ACTION_REQUIRED:'Action required', APPROVAL_PENDING:'Under review', APPROVED:'Approved', ACTIVE:'Active', REJECTED:'Not approved', DISABLED:'Disabled', ACCOUNT_CLOSED:'Closed', ONBOARDING:'Submitted', EDITED:'Under review' };

async function migrate(q){
  for (const col of ['totp_secret text', 'totp_pending text', 'totp_enabled boolean NOT NULL DEFAULT false'])
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`);
  await q(`CREATE TABLE IF NOT EXISTS broker_accounts (user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, alpaca_id text UNIQUE NOT NULL, account_number text, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), active_since timestamptz)`);
  await q(`CREATE TABLE IF NOT EXISTS real_orders (id text PRIMARY KEY, user_id text NOT NULL, alpaca_order_id text, sym text NOT NULL, side text NOT NULL, qty numeric, notional numeric, status text NOT NULL, filled_qty numeric, filled_avg_price numeric, source text NOT NULL DEFAULT 'personal', ref text, message text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS real_orders_user ON real_orders (user_id, created_at DESC)`);
  await q(`ALTER TABLE real_orders ADD COLUMN IF NOT EXISTS order_type text, ADD COLUMN IF NOT EXISTS limit_price numeric, ADD COLUMN IF NOT EXISTS tif text`);
  await q(`CREATE TABLE IF NOT EXISTS real_transfers (id text PRIMARY KEY, user_id text NOT NULL, direction text NOT NULL, amount numeric NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS instant_credits (id text PRIMARY KEY, user_id text NOT NULL, transfer_id text NOT NULL, journal_id text, amount numeric NOT NULL, status text NOT NULL, repay_journal_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS broker_log (id bigserial PRIMARY KEY, method text, path text, status int, message text, created_at timestamptz NOT NULL DEFAULT now())`);
}

function mount(app, d){
  /* Sensitive money actions need a fresh code from the authenticator app, even when already signed in. */
  async function stepUp(req, res, userId){
    if (config.alpaca.env === 'sandbox' && (await d.q('SELECT is_test FROM users WHERE id = $1', [userId])).rows.some(r => r.is_test)) return true; /* sandbox test accounts used through Act as */
    const row = (await d.q('SELECT totp_enabled, totp_secret FROM users WHERE id = $1', [userId])).rows[0];
    if (!row || !row.totp_enabled){ res.status(403).json({ error: 'Turn on two-step sign-in first.' }); return false; }
    const secret = totp.open(row.totp_secret, config.appSecret);
    if (!req.body.code){ res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app to confirm.', needCode: true }); return false; }
    if (!secret || !totp.verify(secret, req.body.code)){ res.status(401).json({ error: "That code didn't match. Try the newest code.", needCode: true }); return false; }
    return true;
  }
  const { q, wrap, ok, bad, needUser, needAdmin, sendTo, newId, isPro, getSetting, setSetting, appUserFromReq } = d;
  alpaca.setLogger(e => q('INSERT INTO broker_log (method, path, status, message) VALUES ($1, $2, $3, $4)', [e.method, e.path, e.status, e.message]).catch(() => {}));

  /* ---------- two-step sign-in (both sites) ---------- */
  app.post('/api/2fa/setup', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const secret = totp.newSecret();
    await q('UPDATE users SET totp_pending = $1 WHERE id = $2', [totp.seal(secret, config.appSecret), u.id]);
    const uri = totp.uri(secret, u.username);
    ok(res, { secret, uri, qr: await qrcode.toDataURL(uri, { margin: 1, width: 220 }) });
  }));
  app.post('/api/2fa/enable', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const row = (await q('SELECT totp_pending FROM users WHERE id = $1', [u.id])).rows[0];
    const secret = row && totp.open(row.totp_pending, config.appSecret);
    if (!secret) return bad(res, 'Start the setup again.');
    if (!totp.verify(secret, req.body.code)) return bad(res, "That code didn't match. Check the time on your phone and try the newest code.");
    await q('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = true WHERE id = $1', [u.id]);
    if (d.securityEvent) d.securityEvent(req, u.id, 'two-step', 'Two-step sign-in turned on', 'Two-step sign-in was turned on for your account.');
    ok(res);
  }));
  app.post('/api/2fa/disable', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    if (config.require2fa) return bad(res, 'Two-step sign-in is required on this site.');
    const row = (await q('SELECT totp_secret FROM users WHERE id = $1', [u.id])).rows[0];
    const secret = row && totp.open(row.totp_secret, config.appSecret);
    if (!secret || !totp.verify(secret, req.body.code)) return bad(res, "That code didn't match.");
    if (d.securityEvent) d.securityEvent(req, u.id, 'two-step', 'Two-step sign-in turned off', 'Two-step sign-in was turned off for your account. If this wasn\'t you, change your password now.');
    await q('UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1', [u.id]);
    ok(res);
  }));

  /* ---------- real money (live site only) ---------- */
  const realOnly = (req, res, next) => config.realMoney ? next() : bad(res, "Real money isn't available on this site.", 404);
  app.use('/api/real', realOnly);
  app.use('/api/admin/real', realOnly);
  async function needReal(req, res){
    const u = await needUser(req, res); if (!u) return null;
    if (config.require2fa && !(u.is_test && config.alpaca.env === 'sandbox')){ const r = (await q('SELECT totp_enabled FROM users WHERE id = $1', [u.id])).rows[0]; if (!r || !r.totp_enabled){ bad(res, 'Turn on two-step sign-in to use real money.', 403); return null; } }
    return u;
  }
  const acctOf = async userId => (await q('SELECT * FROM broker_accounts WHERE user_id = $1', [userId])).rows[0];
  async function needActive(req, res){
    const u = await needReal(req, res); if (!u) return null;
    const a = await acctOf(u.id); if (!a || a.status !== 'ACTIVE'){ bad(res, 'Your brokerage account is not active yet.'); return null; }
    return { u, a };
  }
  async function outstanding(userId){ return Number((await q(`SELECT coalesce(sum(amount), 0) AS s FROM instant_credits WHERE user_id = $1 AND status = 'outstanding'`, [userId])).rows[0].s); }
  const orderView = o => ({ type: o.order_type || 'market', limitPrice: o.limit_price == null ? null : Number(o.limit_price), tif: o.tif || 'day', id: o.id, sym: o.sym, side: o.side, qty: o.qty == null ? null : Number(o.qty), notional: o.notional == null ? null : Number(o.notional), status: o.status, filledQty: o.filled_qty == null ? 0 : Number(o.filled_qty),
    filledPrice: o.filled_avg_price == null ? null : Number(o.filled_avg_price), source: o.source, message: o.message, createdAt: o.created_at, updatedAt: o.updated_at });

  async function instantInfo(userId, pid, a){
    const c = config.instant;
    const out = await outstanding(userId);
    const info = { enabled: c.enabled, perDeposit: c.perDeposit, outstanding: out, eligible: false, reason: null };
    if (!c.enabled){ info.reason = 'Coming soon'; return info; }
    if (!config.alpaca.firmAccountId){ info.reason = 'Not set up'; return info; }
    if (!(await isPro(pid))){ info.reason = 'Pro members only'; return info; }
    const days = a.active_since ? (Date.now() - new Date(a.active_since).getTime()) / 86400000 : 0;
    if (days < c.minAccountDays){ info.reason = `Available after your account is ${c.minAccountDays} days old`; return info; }
    const cleared = (await q(`SELECT 1 FROM real_transfers WHERE user_id = $1 AND direction = 'INCOMING' AND status = 'COMPLETE' LIMIT 1`, [userId])).rows.length;
    if (!cleared){ info.reason = 'Available after your first deposit clears'; return info; }
    if (out > 0){ info.reason = 'Available once your current instant deposit clears'; return info; }
    const total = Number((await q(`SELECT coalesce(sum(amount), 0) AS s FROM instant_credits WHERE status = 'outstanding'`)).rows[0].s);
    if (total + c.perDeposit > c.totalCap){ info.reason = 'Temporarily unavailable'; return info; }
    info.eligible = true; return info;
  }

  app.get('/api/real/summary', wrap(async (req, res) => {
    const u = await needUser(req, res); if (!u) return;
    const tf = (await q('SELECT totp_enabled FROM users WHERE id = $1', [u.id])).rows[0];
    const base = { twofa: !!(tf && tf.totp_enabled), require2fa: config.require2fa && !(u.is_test && config.alpaca.env === 'sandbox'), alpacaEnv: config.alpaca.env, paused: !!(await getSetting('realPaused', false)) };
    let a = await acctOf(u.id);
    if (!a) return ok(res, Object.assign(base, { account: null }));
    if (a.status !== 'ACTIVE' && Date.now() - new Date(a.updated_at).getTime() > 15000){
      try { const r = await alpaca.getAccount(a.alpaca_id); if (r && r.status && r.status !== a.status){ await q(`UPDATE broker_accounts SET status = $1, updated_at = now(), active_since = CASE WHEN $1 = 'ACTIVE' THEN now() ELSE active_since END WHERE user_id = $2`, [r.status, u.id]); a = await acctOf(u.id); } else await q('UPDATE broker_accounts SET updated_at = now() WHERE user_id = $1', [u.id]); } catch (e){}
    }
    const account = { status: a.status, label: ACCOUNT_LABEL[a.status] || a.status, accountNumber: a.account_number, openedAt: a.created_at };
    if (a.status !== 'ACTIVE') return ok(res, Object.assign(base, { account }));
    const [trading, positions, banks] = await Promise.all([alpaca.tradingAccount(a.alpaca_id), alpaca.positions(a.alpaca_id), alpaca.listAch(a.alpaca_id).catch(() => [])]);
    const orders = (await q('SELECT * FROM real_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id])).rows.map(orderView);
    const transfers = (await q('SELECT * FROM real_transfers WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [u.id])).rows.map(t => ({ id: t.id, direction: t.direction, amount: Number(t.amount), status: t.status, createdAt: t.created_at }));
    const out = await outstanding(u.id);
    const cash = Number(trading.cash || 0);
    const withdrawable = Math.max(0, Math.min(cash, Number(trading.cash_withdrawable != null ? trading.cash_withdrawable : cash)) - out);
    ok(res, Object.assign(base, { account,
      balances: { equity: Number(trading.equity || 0), lastEquity: Number(trading.last_equity || 0), cash, buyingPower: Number(trading.buying_power || 0), withdrawable },
      positions: (positions || []).map(p => ({ sym: p.symbol, qty: Number(p.qty), avgPrice: Number(p.avg_entry_price), price: Number(p.current_price), value: Number(p.market_value), pl: Number(p.unrealized_pl), plPct: Number(p.unrealized_plpc) })),
      banks: (banks || []).filter(b => !['CANCELED'].includes(b.status)).map(b => ({ id: b.id, nickname: b.nickname, status: b.status, type: b.bank_account_type, last4: String(b.bank_account_number || '').slice(-4) })),
      orders, transfers, instant: await instantInfo(u.id, 'u_' + u.id, a) }));
  }));

  const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  app.post('/api/real/account', wrap(async (req, res) => {
    const u = await needReal(req, res); if (!u) return;
    if (await acctOf(u.id)) return bad(res, 'You already have a brokerage account application.');
    const b = req.body || {};
    const ssn = String(b.ssn || '').replace(/\D/g, '');
    const need = { 'first name': b.givenName, 'last name': b.familyName, 'date of birth': b.dob, email: b.email, phone: b.phone, street: b.street, city: b.city, state: b.state, 'ZIP code': b.postal };
    for (const [k, v] of Object.entries(need)) if (!clean(v, 200)) return bad(res, `Add your ${k}.`);
    if (ssn.length !== 9) return bad(res, 'Enter your 9-digit Social Security number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dob)) return bad(res, 'Enter your date of birth.');
    const age = (Date.now() - new Date(b.dob + 'T00:00:00Z').getTime()) / (365.25 * 86400000); if (!(age >= 18)) return bad(res, 'You must be at least 18 to open an account.');
    if (!/^[A-Za-z]{2}$/.test(b.state)) return bad(res, 'Use the two-letter state code.');
    if (!/^\d{5}(-\d{4})?$/.test(String(b.postal))) return bad(res, 'Enter a valid ZIP code.');
    if (!b.agree) return bad(res, 'Please accept the account agreements to continue.');
    const emp = ['employed','unemployed','retired','student'].includes(b.employment) ? b.employment : 'employed';
    const funding = (Array.isArray(b.funding) ? b.funding : ['employment_income']).filter(x => ['employment_income','investments','inheritance','business_income','savings','family'].includes(x));
    const now = new Date().toISOString(), ip = req.ip || '0.0.0.0';
    const body = {
      contact: { email_address: clean(b.email, 120), phone_number: clean(b.phone, 30), street_address: [clean(b.street, 120), clean(b.unit, 40)].filter(Boolean), city: clean(b.city, 60), state: clean(b.state, 2).toUpperCase(), postal_code: clean(b.postal, 10), country: 'USA' },
      identity: { given_name: clean(b.givenName, 60), family_name: clean(b.familyName, 60), date_of_birth: b.dob, tax_id: `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`, tax_id_type: 'USA_SSN',
        country_of_citizenship: clean(b.citizenship || 'USA', 3), country_of_birth: clean(b.birthCountry || b.citizenship || 'USA', 3), country_of_tax_residence: 'USA', funding_source: funding.length ? funding : ['employment_income'] },
      disclosures: { is_control_person: !!b.controlPerson, is_affiliated_exchange_or_finra: !!b.finraAffiliated, is_politically_exposed: !!b.politicallyExposed, immediate_family_exposed: !!b.familyExposed,
        employment_status: emp, employer_name: emp === 'employed' ? clean(b.employer, 80) || undefined : undefined, employment_position: emp === 'employed' ? clean(b.position, 80) || undefined : undefined },
      agreements: [{ agreement: 'customer_agreement', signed_at: now, ip_address: ip }, { agreement: 'account_agreement', signed_at: now, ip_address: ip }],
      enabled_assets: ['us_equity']
    };
    const r = await alpaca.createAccount(body);
    await q('INSERT INTO broker_accounts (user_id, alpaca_id, account_number, status, active_since) VALUES ($1, $2, $3, $4, $5)', [u.id, r.id, r.account_number || null, r.status || 'SUBMITTED', r.status === 'ACTIVE' ? new Date() : null]);
    ok(res, { status: r.status || 'SUBMITTED', label: ACCOUNT_LABEL[r.status] || 'Submitted' });
  }));

  app.post('/api/real/bank', wrap(async (req, res) => {
    const x = await needActive(req, res); if (!x) return;
    if (!(await stepUp(req, res, x.u.id))) return;
    const b = req.body || {};
    let body;
    if (b.processorToken) body = { processor_token: clean(b.processorToken, 200) };
    else {
      if (config.alpaca.env === 'live') return bad(res, 'Link your bank with the secure bank login.');
      const routing = String(b.routing || '').replace(/\D/g, ''), acct = String(b.account || '').replace(/\D/g, '');
      if (routing.length !== 9) return bad(res, 'Enter the 9-digit routing number.');
      if (acct.length < 4 || acct.length > 17) return bad(res, 'Enter the account number.');
      body = { account_owner_name: clean(b.owner, 100), bank_account_type: b.type === 'SAVINGS' ? 'SAVINGS' : 'CHECKING', bank_account_number: acct, bank_routing_number: routing, nickname: clean(b.nickname, 40) || 'Bank account' };
      if (!body.account_owner_name) return bad(res, "Add the account owner's name.");
    }
    const r = await alpaca.createAch(x.a.alpaca_id, body);
    ok(res, { id: r.id, status: r.status });
  }));
  app.post('/api/real/bank/remove', wrap(async (req, res) => { const x = await needActive(req, res); if (!x) return; await alpaca.deleteAch(x.a.alpaca_id, String(req.body.id || '')); ok(res); }));

  app.post('/api/real/transfer', wrap(async (req, res) => {
    const x = await needActive(req, res); if (!x) return;
    const dir = req.body.direction === 'out' ? 'OUTGOING' : 'INCOMING';
    if (dir === 'OUTGOING' && !(await stepUp(req, res, x.u.id))) return;
    const amount = Math.round(Number(req.body.amount) * 100) / 100;
    if (!(amount >= 1) || amount > 50000) return bad(res, 'Enter an amount between $1 and $50,000.');
    const banks = (await alpaca.listAch(x.a.alpaca_id)) || [];
    const bank = banks.find(b => ['APPROVED','QUEUED','SUBMITTED','PENDING'].includes(b.status) && b.status !== 'CANCELED');
    if (!bank) return bad(res, 'Link a bank account first.');
    if (dir === 'OUTGOING'){
      const t = await alpaca.tradingAccount(x.a.alpaca_id);
      const cash = Number(t.cash || 0), out = await outstanding(x.u.id);
      const withdrawable = Math.max(0, Math.min(cash, Number(t.cash_withdrawable != null ? t.cash_withdrawable : cash)) - out);
      if (amount > withdrawable + 0.001) return bad(res, `You can withdraw up to $${withdrawable.toFixed(2)} right now.` + (out ? ' Instant deposit money becomes withdrawable once your bank transfer clears.' : ''));
    }
    const instant = dir === 'INCOMING' ? await instantInfo(x.u.id, 'u_' + x.u.id, x.a) : null;
    const t = await alpaca.createTransfer(x.a.alpaca_id, { transfer_type: 'ach', relationship_id: bank.id, amount: amount.toFixed(2), direction: dir });
    await q('INSERT INTO real_transfers (id, user_id, direction, amount, status) VALUES ($1, $2, $3, $4, $5)', [t.id, x.u.id, dir, amount, t.status || 'QUEUED']);
    let instantAmount = 0;
    if (instant && instant.eligible && !(await getSetting('realPaused', false))){
      instantAmount = Math.min(amount, config.instant.perDeposit);
      try {
        const j = await alpaca.journal({ from_account: config.alpaca.firmAccountId, to_account: x.a.alpaca_id, entry_type: 'JNLC', amount: instantAmount.toFixed(2), description: 'Pocket instant deposit' });
        await q(`INSERT INTO instant_credits (id, user_id, transfer_id, journal_id, amount, status) VALUES ($1, $2, $3, $4, $5, 'outstanding')`, [newId(), x.u.id, t.id, j.id, instantAmount]);
      } catch (e){ instantAmount = 0; }
    }
    ok(res, { id: t.id, status: t.status, instant: instantAmount });
  }));

  app.post('/api/real/order', wrap(async (req, res) => {
    const x = await needActive(req, res); if (!x) return;
    if (await getSetting('realPaused', false)) return bad(res, 'Real-money trading is paused right now. Please try again later.');
    const sym = String(req.body.sym || ''); if (!Market.MAP[sym]) return bad(res, "That stock isn't available yet.");
    const side = req.body.side === 'sell' ? 'sell' : 'buy';
    const qty = req.body.qty != null ? Math.floor(Number(req.body.qty) * 1e6) / 1e6 : null, notional = req.body.notional != null ? Math.floor(Number(req.body.notional) * 100) / 100 : null;
    if ((qty == null) === (notional == null)) return bad(res, 'Enter either a dollar amount or a number of shares.');
    if (qty != null && !(qty > 0)) return bad(res, 'Enter a number of shares above zero.');
    if (notional != null && !(notional >= 1)) return bad(res, 'The minimum order is $1.');
    const est = notional != null ? notional : qty * (await priceOf(sym));
    const limit = req.body.type === 'limit', lp = limit ? Math.round(Number(req.body.limitPrice) * 100) / 100 : null, tif = limit && req.body.tif === 'gtc' ? 'gtc' : 'day';
    if (limit){ if (qty == null) return bad(res, 'Limit orders are placed in shares. Switch to Shares to set a limit price.'); if (!(lp > 0)) return bad(res, 'Enter a limit price.');
      if (tif === 'gtc' && Math.abs(qty - Math.round(qty)) > 1e-9) return bad(res, 'Good till canceled orders need whole shares. Use Day for fractional shares.'); }
    if ((limit ? qty * lp : est) > config.maxOrderUsd) return bad(res, `Orders are limited to $${config.maxOrderUsd.toLocaleString('en-US')} during the beta.`);
    const id = newId();
    const o = limit ? { symbol: sym, side, type: 'limit', limit_price: lp.toFixed(2), time_in_force: tif, client_order_id: id } : { symbol: sym, side, type: 'market', time_in_force: 'day', client_order_id: id };
    if (qty != null) o.qty = String(qty); else o.notional = notional.toFixed(2);
    await q('INSERT INTO real_orders (id, user_id, sym, side, qty, notional, status, source, ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [id, x.u.id, sym, side, qty, notional, 'sending', String(req.body.source || 'personal').slice(0, 20), req.body.ref ? String(req.body.ref).slice(0, 60) : null]);
    if (limit) await q('UPDATE real_orders SET order_type = $2, limit_price = $3, tif = $4 WHERE id = $1', [id, 'limit', lp, tif]);
    try {
      const r = await alpaca.createOrder(x.a.alpaca_id, o);
      await q('UPDATE real_orders SET alpaca_order_id = $1, status = $2, filled_qty = $3, filled_avg_price = $4, updated_at = now() WHERE id = $5', [r.id, r.status || 'new', r.filled_qty || 0, r.filled_avg_price || null, id]);
    } catch (e){
      await q(`UPDATE real_orders SET status = 'rejected', message = $1, updated_at = now() WHERE id = $2`, [e.message, id]);
      throw e;
    }
    const row = (await q('SELECT * FROM real_orders WHERE id = $1', [id])).rows[0];
    if (row.status === 'filled' && d.onOrderUpdate) d.onOrderUpdate(row, 'filled', Number(row.filled_qty || 0), Number(row.filled_avg_price || 0)).catch(e => console.error('copy hook', e.message));
    ok(res, { order: orderView(row) });
  }));
  app.post('/api/real/cancel', wrap(async (req, res) => {
    const x = await needActive(req, res); if (!x) return;
    const o = (await q('SELECT * FROM real_orders WHERE id = $1 AND user_id = $2', [String(req.body.id || ''), x.u.id])).rows[0];
    if (!o || !o.alpaca_order_id) return bad(res, 'Order not found.');
    if (!OPEN_ORDER.includes(o.status)) return bad(res, 'This order can no longer be canceled.');
    await alpaca.cancelOrder(x.a.alpaca_id, o.alpaca_order_id);
    await q(`UPDATE real_orders SET status = 'pending_cancel', updated_at = now() WHERE id = $1`, [o.id]);
    ok(res);
  }));

  /* prices: real quotes on the live site, simulated prices as a fallback */
  const quoteCache = new Map();
  async function priceOf(sym){ const q2 = await quotes([sym]); return q2[sym] || Market.price(sym); }
  async function quotes(symbols){
    const out = {}, missing = [];
    for (const s of symbols){ const c = quoteCache.get(s); if (c && Date.now() - c.t < 15000) out[s] = c.p; else missing.push(s); }
    if (missing.length && alpaca.configured()){
      try { const r = await alpaca.snapshots(missing); for (const s of missing){ const x = r && r[s]; const p = x && ((x.latestTrade && x.latestTrade.p) || (x.minuteBar && x.minuteBar.c) || (x.dailyBar && x.dailyBar.c)); if (p){ out[s] = p; quoteCache.set(s, { p, t: Date.now() }); } } } catch (e){}
    }
    return out;
  }
  app.get('/api/real/quotes', wrap(async (req, res) => {
    const syms = String(req.query.symbols || '').split(',').filter(s => Market.MAP[s]).slice(0, 25);
    ok(res, { quotes: await quotes(syms) });
  }));

  app.get('/api/real/documents', wrap(async (req, res) => {
    const x = await needActive(req, res); if (!x) return;
    const docs = (await alpaca.listDocuments(x.a.alpaca_id)) || [];
    ok(res, { documents: docs.slice(0, 60).map(d => ({ id: d.id, type: d.type, date: d.date || d.created_at, name: d.name || d.type })) });
  }));
  app.get('/api/real/documents/:docId', wrap(async (req, res) => {
    const x = await needActive(req, res); if (!x) return;
    const r = await alpaca.downloadDocument(x.a.alpaca_id, String(req.params.docId).replace(/[^a-zA-Z0-9-]/g, ''));
    if (!r.ok) return bad(res, "That document isn't available.");
    res.set('Content-Type', r.headers.get('content-type') || 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="pocket-statement.pdf"');
    res.send(Buffer.from(await r.arrayBuffer()));
  }));

  /* ---------- admin ---------- */
  app.get('/api/admin/real', wrap(async (req, res) => {
    if (!(await needAdmin(req, res))) return;
    const by = (await q('SELECT status, count(*)::int AS n FROM broker_accounts GROUP BY status')).rows;
    const open = (await q(`SELECT count(*)::int AS n FROM real_orders WHERE status = ANY($1)`, [OPEN_ORDER])).rows[0].n;
    const orders7 = (await q(`SELECT count(*)::int AS n, coalesce(sum(coalesce(filled_qty * filled_avg_price, notional, 0)), 0) AS v FROM real_orders WHERE created_at > now() - interval '7 days' AND status = 'filled'`)).rows[0];
    const credits = (await q(`SELECT status, count(*)::int AS n, coalesce(sum(amount), 0) AS s FROM instant_credits GROUP BY status`)).rows;
    const log = (await q('SELECT method, path, status, message, created_at FROM broker_log ORDER BY id DESC LIMIT 40')).rows;
    const shortfalls = (await q(`SELECT c.*, u.username FROM instant_credits c JOIN users u ON u.id = c.user_id WHERE c.status = 'shortfall' ORDER BY c.updated_at DESC`)).rows;
    ok(res, { env: config.alpaca.env, configured: alpaca.configured(), paused: !!(await getSetting('realPaused', false)), accounts: by, openOrders: open, filled7: { n: orders7.n, value: Number(orders7.v) },
      instant: Object.assign({}, config.instant, { firmAccount: !!config.alpaca.firmAccountId, byStatus: credits.map(c => ({ status: c.status, n: c.n, amount: Number(c.s) })), shortfalls: shortfalls.map(s => ({ username: s.username, amount: Number(s.amount), at: s.updated_at })) }), log });
  }));
  /* Reconciliation: the app's records next to Alpaca's for each account, with mismatches flagged.
     Balances and holdings always come from Alpaca; this checks that every deposit, withdrawal and
     order the app recorded matches what Alpaca has, and that holdings match the app's filled orders. */
  async function reconcileAll(){
    const rows = (await q(`SELECT b.*, u.username FROM broker_accounts b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 50`)).rows;
    const out = [];
    for (const a of rows){
      const r = { username: a.username, accountNumber: a.account_number, status: a.status, issues: [], counts: {} };
      try {
        const remote = await alpaca.getAccount(a.alpaca_id); if (remote.status && remote.status !== a.status) r.issues.push({ kind: 'status', text: `Account status: app shows ${a.status}, Alpaca shows ${remote.status}`, fix: { type: 'account', status: remote.status } });
        if (a.status !== 'ACTIVE' && remote.status !== 'ACTIVE'){ out.push(r); continue; }
        const [tr, pos, trs, ords] = await Promise.all([alpaca.tradingAccount(a.alpaca_id), alpaca.positions(a.alpaca_id), alpaca.listTransfers(a.alpaca_id), alpaca.listOrders(a.alpaca_id, 'all', 200)]);
        r.balances = { cash: Number(tr.cash || 0), equity: Number(tr.equity || 0) };
        /* transfers */
        const mine = (await q('SELECT * FROM real_transfers WHERE user_id = $1', [a.user_id])).rows, theirs = new Map((trs || []).map(t => [t.id, t]));
        r.counts.transfers = mine.length;
        for (const t of mine){
          const x = theirs.get(t.id);
          if (!x){ r.issues.push({ kind: 'transfer', text: `${t.direction === 'INCOMING' ? 'Deposit' : 'Withdrawal'} of $${Number(t.amount).toFixed(2)} is in the app but not at Alpaca` }); continue; }
          if (Math.abs(Number(x.amount) - Number(t.amount)) > 0.005) r.issues.push({ kind: 'transfer', text: `Transfer amount: app $${Number(t.amount).toFixed(2)}, Alpaca $${Number(x.amount).toFixed(2)}` });
          if (x.status !== t.status) r.issues.push({ kind: 'transfer', text: `${t.direction === 'INCOMING' ? 'Deposit' : 'Withdrawal'} of $${Number(t.amount).toFixed(2)}: app shows ${t.status}, Alpaca shows ${x.status}`, fix: { type: 'transfer', id: t.id, status: x.status } });
        }
        const mineIds = new Set(mine.map(t => t.id));
        (trs || []).filter(x => !mineIds.has(x.id)).forEach(x => r.issues.push({ kind: 'transfer', text: `${x.direction === 'INCOMING' ? 'Deposit' : 'Withdrawal'} of $${Number(x.amount).toFixed(2)} (${x.status}) is at Alpaca but not in the app, for example made from the Alpaca dashboard` }));
        /* orders */
        const myOrders = (await q('SELECT * FROM real_orders WHERE user_id = $1', [a.user_id])).rows, theirOrders = new Map((ords || []).map(o => [o.id, o]));
        r.counts.orders = myOrders.length;
        for (const o of myOrders){
          if (!o.alpaca_order_id){ if (o.status !== 'rejected') r.issues.push({ kind: 'order', text: `${o.side} ${o.sym} was never accepted by Alpaca (app shows ${o.status})` }); continue; }
          const x = theirOrders.get(o.alpaca_order_id);
          if (!x){ r.issues.push({ kind: 'order', text: `${o.side} ${o.sym} order is in the app but not in Alpaca's recent orders` }); continue; }
          const fq = Number(x.filled_qty || 0);
          if (x.status !== o.status || Math.abs(fq - Number(o.filled_qty || 0)) > 1e-6) r.issues.push({ kind: 'order', text: `${o.side} ${o.sym}: app shows ${o.status} (${Number(o.filled_qty || 0)} filled), Alpaca shows ${x.status} (${fq} filled)`, fix: { type: 'order', id: o.id, status: x.status, filledQty: fq, filledPrice: x.filled_avg_price || null } });
        }
        const myOrderIds = new Set(myOrders.map(o => o.alpaca_order_id));
        (ords || []).filter(x => !myOrderIds.has(x.id)).forEach(x => r.issues.push({ kind: 'order', text: `${x.side} ${x.symbol} (${x.status}) is at Alpaca but not in the app` }));
        /* holdings: Alpaca's positions vs. what the app's filled orders add up to */
        const expect = {};
        myOrders.forEach(o => { const fq = Number(o.filled_qty || 0); if (fq) expect[o.sym] = (expect[o.sym] || 0) + (o.side === 'buy' ? fq : -fq); });
        const have = {}; (pos || []).forEach(p => { have[p.symbol] = Number(p.qty); });
        r.positions = Object.keys(Object.assign({}, expect, have)).map(sym => ({ sym, app: Math.round((expect[sym] || 0) * 1e6) / 1e6, alpaca: have[sym] || 0 }));
        r.positions.filter(p => Math.abs(p.app - p.alpaca) > 1e-6).forEach(p => r.issues.push({ kind: 'holding', text: `${p.sym}: the app's filled orders add up to ${p.app} shares, Alpaca holds ${p.alpaca}` }));
        /* instant deposits still owed back to Pocket */
        const owed = Number((await q(`SELECT coalesce(sum(amount), 0) AS s FROM instant_credits WHERE user_id = $1 AND status IN ('outstanding','shortfall')`, [a.user_id])).rows[0].s);
        if (owed) r.instantOwed = owed;
      } catch (e){ r.error = e.message; }
      out.push(r);
    }
    let firm = null;
    if (config.alpaca.firmAccountId){ try { const f = await alpaca.tradingAccount(config.alpaca.firmAccountId); firm = { cash: Number(f.cash || 0) }; } catch (e){ firm = { error: e.message }; } }
    const credits = Number((await q(`SELECT coalesce(sum(amount), 0) AS s FROM instant_credits WHERE status = 'outstanding'`)).rows[0].s);
    return { at: Date.now(), accounts: out, firm, instantOutstanding: credits, issues: out.reduce((n, r) => n + r.issues.length + (r.error ? 1 : 0), 0) };
  }
  app.get('/api/admin/real/reconcile', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; ok(res, await reconcileAll()); }));
  /* Update the app's records to match Alpaca, for statuses only. Nothing is ever created or deleted. */
  app.post('/api/admin/real/reconcile/apply', wrap(async (req, res) => {
    if (!(await needAdmin(req, res))) return;
    const R = await reconcileAll(); let fixed = 0;
    for (const a of R.accounts) for (const i of a.issues) {
      const f = i.fix; if (!f) continue;
      if (f.type === 'transfer'){ await q('UPDATE real_transfers SET status = $1, updated_at = now() WHERE id = $2', [f.status, f.id]); fixed++; }
      if (f.type === 'order'){ await q('UPDATE real_orders SET status = $1, filled_qty = $2, filled_avg_price = $3, updated_at = now() WHERE id = $4', [f.status, f.filledQty, f.filledPrice, f.id]); fixed++; }
      if (f.type === 'account'){ await q(`UPDATE broker_accounts SET status = $1, updated_at = now(), active_since = CASE WHEN $1 = 'ACTIVE' THEN coalesce(active_since, now()) ELSE active_since END WHERE account_number = $2`, [f.status, a.accountNumber]); fixed++; }
    }
    ok(res, { fixed });
  }));
  app.post('/api/admin/real/pause', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; await setSetting('realPaused', !!req.body.paused); if (d.broadcastRaw) d.broadcastRaw({ type: 'real', what: 'paused' }); ok(res); }));
}

/* ---------- background sync: orders every 5s, accounts and transfers every 20s ---------- */
function startSync(d){
  if (!config.realMoney) return;
  const { q, sendTo } = d;
  let busy = false;
  setInterval(async () => {
    if (busy || !alpaca.configured()) return; busy = true;
    try {
      if (d.testSetupTick && config.alpaca.env === 'sandbox') await d.testSetupTick().catch(e => console.error('test setup', e.message));
      const rows = (await q(`SELECT o.*, b.alpaca_id FROM real_orders o JOIN broker_accounts b ON b.user_id = o.user_id WHERE o.status = ANY($1) AND o.alpaca_order_id IS NOT NULL LIMIT 100`, [OPEN_ORDER])).rows;
      for (const o of rows){
        try {
          const r = await alpaca.getOrder(o.alpaca_id, o.alpaca_order_id);
          if (r.status !== o.status || String(r.filled_qty || 0) !== String(o.filled_qty || 0)){
            await q('UPDATE real_orders SET status = $1, filled_qty = $2, filled_avg_price = $3, updated_at = now() WHERE id = $4', [r.status, r.filled_qty || 0, r.filled_avg_price || null, o.id]);
            if (d.onOrderUpdate) try { await d.onOrderUpdate(o, r.status, Number(r.filled_qty || 0), Number(r.filled_avg_price || 0)); } catch (e){ console.error('copy hook', e.message); }
            sendTo(o.user_id, { type: 'real', what: 'order', id: o.id, status: r.status, sym: o.sym, side: o.side, filledQty: Number(r.filled_qty || 0), filledPrice: r.filled_avg_price ? Number(r.filled_avg_price) : null });
          }
        } catch (e){}
      }
    } catch (e){} finally { busy = false; }
  }, 5000);
  setInterval(async () => {
    if (!alpaca.configured()) return;
    try {
      for (const a of (await q(`SELECT * FROM broker_accounts WHERE status NOT IN ('ACTIVE','REJECTED','DISABLED','ACCOUNT_CLOSED')`)).rows){
        try { const r = await alpaca.getAccount(a.alpaca_id); if (r.status && r.status !== a.status){ await q(`UPDATE broker_accounts SET status = $1, updated_at = now(), active_since = CASE WHEN $1 = 'ACTIVE' THEN now() ELSE active_since END WHERE user_id = $2`, [r.status, a.user_id]); sendTo(a.user_id, { type: 'real', what: 'account', status: r.status }); } } catch (e){}
      }
      const pend = (await q(`SELECT t.*, b.alpaca_id FROM real_transfers t JOIN broker_accounts b ON b.user_id = t.user_id WHERE NOT (t.status = ANY($1))`, [DONE_TRANSFER])).rows;
      const byAcct = {}; pend.forEach(t => (byAcct[t.alpaca_id] = byAcct[t.alpaca_id] || []).push(t));
      for (const [aid, list] of Object.entries(byAcct)){
        let remote; try { remote = await alpaca.listTransfers(aid); } catch (e){ continue; }
        for (const t of list){
          const r = (remote || []).find(x => x.id === t.id); if (!r || r.status === t.status) continue;
          await q('UPDATE real_transfers SET status = $1, updated_at = now() WHERE id = $2', [r.status, t.id]);
          sendTo(t.user_id, { type: 'real', what: 'transfer', status: r.status, direction: t.direction, amount: Number(t.amount) });
          await settleInstant(q, t, r.status, aid);
        }
      }
    } catch (e){}
  }, 20000);
}
/* When the bank transfer behind an instant deposit finishes, repay Pocket's account. */
async function settleInstant(q, t, status, alpacaId){
  if (t.direction !== 'INCOMING' || !DONE_TRANSFER.includes(status)) return;
  const c = (await q(`SELECT * FROM instant_credits WHERE transfer_id = $1 AND status = 'outstanding'`, [t.id])).rows[0]; if (!c) return;
  const amt = Number(c.amount);
  if (status === 'COMPLETE'){
    try { const j = await alpaca.journal({ from_account: alpacaId, to_account: config.alpaca.firmAccountId, entry_type: 'JNLC', amount: amt.toFixed(2), description: 'Pocket instant deposit repayment' });
      await q(`UPDATE instant_credits SET status = 'repaid', repay_journal_id = $1, updated_at = now() WHERE id = $2`, [j.id, c.id]); } catch (e){}
    return;
  }
  /* returned, canceled or rejected: recover what we can from the account's cash */
  try {
    const tr = await alpaca.tradingAccount(alpacaId); const cash = Number(tr.cash || 0);
    if (cash >= amt){ const j = await alpaca.journal({ from_account: alpacaId, to_account: config.alpaca.firmAccountId, entry_type: 'JNLC', amount: amt.toFixed(2), description: 'Pocket instant deposit recovery' }); await q(`UPDATE instant_credits SET status = 'recovered', repay_journal_id = $1, updated_at = now() WHERE id = $2`, [j.id, c.id]); }
    else await q(`UPDATE instant_credits SET status = 'shortfall', updated_at = now() WHERE id = $1`, [c.id]);
  } catch (e){ await q(`UPDATE instant_credits SET status = 'shortfall', updated_at = now() WHERE id = $1`, [c.id]); }
}

module.exports = { migrate, mount, startSync, ACCOUNT_LABEL };
