/* Alpaca Broker API client. Every call to Alpaca goes through here.
   Personal data (SSN, date of birth) is passed straight through and never stored or logged. */
const config = require('./config');

class BrokerError extends Error { constructor(msg, status, detail){ super(msg); this.userFacing = true; this.status = status; this.detail = detail; } }
/* Sign-in: newer Alpaca credentials (Client ID + Client Secret) are exchanged for a
   15-minute access token, reused until shortly before it expires. Older key pairs
   (ALPACA_AUTH_MODE=legacy) are sent directly. */
let token = null, tokenExp = 0, tokenPending = null;
async function getToken(force){
  if (!force && token && Date.now() < tokenExp - 60000) return token;
  if (tokenPending) return tokenPending;
  tokenPending = (async () => {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: config.alpaca.key, client_secret: config.alpaca.secret });
    let r, j = null;
    try { r = await fetch(config.alpaca.authUrl + '/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(15000) }); j = await r.json().catch(() => null); }
    catch (e){ if (logFn) logFn({ method: 'POST', path: '/v1/oauth2/token', status: 0, message: e.message }); throw new BrokerError("We couldn't reach the brokerage. Try again in a moment.", 0); }
    if (!r.ok || !j || !j.access_token){ if (logFn) logFn({ method: 'POST', path: '/v1/oauth2/token', status: r.status, message: String((j && (j.error_description || j.error || j.message)) || 'token request failed').slice(0, 300) }); throw new BrokerError('The brokerage connection could not sign in. Check the Alpaca keys.', r.status); }
    token = j.access_token; tokenExp = Date.now() + (Number(j.expires_in) || 900) * 1000;
    return token;
  })().finally(() => { tokenPending = null; });
  return tokenPending;
}
async function auth(force){
  if (config.alpaca.authMode === 'legacy') return 'Basic ' + Buffer.from(config.alpaca.key + ':' + config.alpaca.secret).toString('base64');
  return 'Bearer ' + await getToken(force);
}
let logFn = null;
const setLogger = fn => { logFn = fn; };

async function call(method, path, body, opt = {}){
  if (!config.alpaca.key || !config.alpaca.secret) throw new BrokerError('The brokerage connection is not set up yet.', 503);
  const url = (opt.data ? config.alpaca.dataUrl : config.alpaca.baseUrl) + path;
  let r, text;
  try {
    const go = async force => fetch(url, { method, headers: { Authorization: await auth(force), 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(opt.timeout || 15000) });
    r = await go(false);
    if (r.status === 401 && config.alpaca.authMode !== 'legacy') r = await go(true); /* token expired early: sign in again once */
    text = await r.text();
  } catch (e){
    if (e.userFacing) throw e;
    if (logFn) logFn({ method, path, status: 0, message: e.message });
    throw new BrokerError("We couldn't reach the brokerage. Try again in a moment.", 0);
  }
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e){}
  if (!r.ok){
    const msg = (json && (json.message || json.error)) || text || ('HTTP ' + r.status);
    if (logFn) logFn({ method, path: path.replace(/\/accounts\/[^/]+/, '/accounts/:id'), status: r.status, message: String(msg).slice(0, 500) });
    throw new BrokerError(friendly(r.status, msg), r.status, msg);
  }
  return json;
}
function friendly(status, msg){
  const m = String(msg || '').toLowerCase();
  if (m.includes('insufficient') || m.includes('buying power')) return 'Not enough buying power for this order.';
  if (m.includes('not fractionable')) return "This stock can't be bought in fractions. Use whole shares.";
  if (m.includes('market') && m.includes('closed')) return 'The market is closed for this order type.';
  if (status === 422 || status === 400) return 'The brokerage rejected this request: ' + String(msg).slice(0, 160);
  if (status === 403) return 'The brokerage refused this request.';
  if (status === 429) return 'Too many requests to the brokerage. Try again shortly.';
  return 'The brokerage returned an error. Try again.';
}

const A = {
  /* accounts */
  createAccount: body => call('POST', '/v1/accounts', body),
  getAccount: id => call('GET', `/v1/accounts/${id}`),
  closeAccount: id => call('POST', `/v1/accounts/${id}/actions/close`),
  tradingAccount: id => call('GET', `/v1/trading/accounts/${id}/account`),
  positions: id => call('GET', `/v1/trading/accounts/${id}/positions`),
  /* orders */
  createOrder: (id, o) => call('POST', `/v1/trading/accounts/${id}/orders`, o),
  getOrder: (id, orderId) => call('GET', `/v1/trading/accounts/${id}/orders/${orderId}`),
  listOrders: (id, status = 'all', limit = 50) => call('GET', `/v1/trading/accounts/${id}/orders?status=${status}&limit=${limit}&direction=desc`),
  cancelOrder: (id, orderId) => call('DELETE', `/v1/trading/accounts/${id}/orders/${orderId}`),
  /* funding */
  createAch: (id, body) => call('POST', `/v1/accounts/${id}/ach_relationships`, body),
  listAch: id => call('GET', `/v1/accounts/${id}/ach_relationships`),
  deleteAch: (id, relId) => call('DELETE', `/v1/accounts/${id}/ach_relationships/${relId}`),
  createTransfer: (id, body) => call('POST', `/v1/accounts/${id}/transfers`, body),
  listTransfers: id => call('GET', `/v1/accounts/${id}/transfers`),
  journal: body => call('POST', '/v1/journals', body),
  /* documents */
  listDocuments: id => call('GET', `/v1/accounts/${id}/documents`),
  documentUrl: (id, docId) => `${config.alpaca.baseUrl}/v1/accounts/${id}/documents/${docId}/download`,
  downloadDocument: async (id, docId) => fetch(`${config.alpaca.baseUrl}/v1/accounts/${id}/documents/${docId}/download`, { headers: { Authorization: await auth() }, redirect: 'follow', signal: AbortSignal.timeout(20000) }),
  /* market data and reference data */
  snapshots: symbols => call('GET', `/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}`, null, { data: true }),
  bars: (sym, timeframe, startIso, limit = 400, feed = null, endIso = null) => call('GET', `/v2/stocks/${encodeURIComponent(sym)}/bars?timeframe=${timeframe}&start=${encodeURIComponent(startIso)}&limit=${limit}&adjustment=split${feed ? '&feed=' + feed : ''}${endIso ? '&end=' + encodeURIComponent(endIso) : ''}`, null, { data: true }),
  news: (symbols, limit = 50) => call('GET', `/v1beta1/news?limit=${limit}&sort=desc${symbols && symbols.length ? '&symbols=' + encodeURIComponent(symbols.join(',')) : ''}`, null, { data: true }),
  assets: () => call('GET', '/v1/assets?status=active&asset_class=us_equity', null, { timeout: 60000 }),
  asset: sym => call('GET', `/v1/assets/${encodeURIComponent(sym)}`)
};
module.exports = Object.assign(A, { BrokerError, setLogger, getToken, configured: () => !!(config.alpaca.key && config.alpaca.secret) });
