/* Site settings. The same code runs the public demo (app.pocketinvesting.com)
   and the real-money site (my.pocketinvesting.com); environment variables decide which. */
const bool = (v, d) => v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : d; };

const MODE = (process.env.SITE_MODE || 'demo').toLowerCase() === 'live' ? 'live' : 'demo';
const config = {
  mode: MODE,                                              // 'demo' or 'live'
  sampleData: bool(process.env.SAMPLE_DATA, MODE === 'demo'),
  demoTools: bool(process.env.DEMO_TOOLS, MODE === 'demo'), // Demo controls, presenter, reset
  broker: (process.env.BROKER || (MODE === 'live' ? 'alpaca' : 'sim')).toLowerCase(),
  alpaca: {
    env: (process.env.ALPACA_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox',
    key: process.env.ALPACA_KEY || '',
    secret: process.env.ALPACA_SECRET || '',
    baseUrl: process.env.ALPACA_BASE_URL || '',            // override, e.g. for testing
    dataUrl: process.env.ALPACA_DATA_URL || '',
    firmAccountId: process.env.ALPACA_FIRM_ACCOUNT_ID || '', // Pocket's own account, used for instant deposits
    authUrl: process.env.ALPACA_AUTH_URL || '',
    authMode: (process.env.ALPACA_AUTH_MODE || 'token').toLowerCase() === 'legacy' ? 'legacy' : 'token' // 'token' = Client ID + Client Secret
  },
  require2fa: bool(process.env.REQUIRE_2FA, MODE === 'live'),
  adminRequire2fa: bool(process.env.ADMIN_REQUIRE_2FA, true), // admins must use two-step sign-in
  sessionIdleMin: Number(process.env.SESSION_IDLE_MIN || (MODE === 'live' ? 30 : 0)), // sign out after inactivity (0 = off)
  appSecret: process.env.APP_SECRET || '',                 // encrypts two-step sign-in secrets
  maxOrderUsd: num(process.env.MAX_ORDER_USD, 25000),
  /* Instant deposits: built, off until switched on. Pro members only, with guardrails. */
  instant: {
    enabled: bool(process.env.INSTANT_DEPOSITS, false),
    perDeposit: num(process.env.INSTANT_LIMIT, 1000),
    totalCap: num(process.env.INSTANT_TOTAL_CAP, 25000),
    minAccountDays: num(process.env.INSTANT_MIN_ACCOUNT_DAYS, 30)
  }
};
config.alpaca.baseUrl = config.alpaca.baseUrl || (config.alpaca.env === 'live' ? 'https://broker-api.alpaca.markets' : 'https://broker-api.sandbox.alpaca.markets');
config.alpaca.dataUrl = config.alpaca.dataUrl || (config.alpaca.env === 'live' ? 'https://data.alpaca.markets' : 'https://data.sandbox.alpaca.markets');
config.alpaca.authUrl = config.alpaca.authUrl || (config.alpaca.env === 'live' ? 'https://authx.alpaca.markets' : 'https://authx.sandbox.alpaca.markets');
config.realMoney = MODE === 'live' && config.broker === 'alpaca';
/* real market data (news, stock list, prices) is used whenever Alpaca keys are set, on either site */
config.marketData = !!(config.alpaca.key && config.alpaca.secret);
/* Real prices on the real-money site, and on the beta when REAL_PRICES is on; the demo keeps simulated prices. */
config.realPrices = config.marketData && (config.realMoney || bool(process.env.REAL_PRICES, false));
config.demoSite = bool(process.env.DEMO_SITE, false); /* the public demo: banner, no sign-ups */
/* Company filings from SEC EDGAR as a news source. 'auto' = only while Alpaca news isn't available,
   'on' = always (works without Alpaca keys), 'off' = never. The SEC asks for a contact in every request. */
config.sec = {
  mode: ['on','off','auto'].includes(String(process.env.SEC_FILINGS || '').toLowerCase()) ? String(process.env.SEC_FILINGS).toLowerCase() : 'auto',
  contact: process.env.SEC_CONTACT || 'Pocket Investing admin@pocketinvesting.com',
  dataUrl: process.env.SEC_DATA_URL || 'https://data.sec.gov',
  wwwUrl: process.env.SEC_WWW_URL || 'https://www.sec.gov'
};
config.logoKey = /^pk_[A-Za-z0-9_-]{6,80}$/.test(process.env.LOGO_DEV_KEY || '') ? process.env.LOGO_DEV_KEY : '';
config.publicInfo = () => ({ logoKey: config.logoKey || null, demoSite: config.demoSite, mode: config.mode, news: config.marketData || config.sec.mode === 'on', realMoney: config.realMoney, marketData: config.marketData, realPrices: config.realPrices, alpacaEnv: config.realMoney ? config.alpaca.env : null, demoTools: config.demoTools, require2fa: config.require2fa,
  instantDeposits: { enabled: config.instant.enabled, perDeposit: config.instant.perDeposit } });
module.exports = config;
