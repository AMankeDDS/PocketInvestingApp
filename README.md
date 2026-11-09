# Pocket Investing: investor demo

A working demo of Pocket Investing: individual trading, the social feed, copying an investor, and investing together as a group with roles, votes, and approval-based copying. All money and prices are simulated.

One Node service serves the app, the API, live updates (WebSockets), and background jobs. Data lives in Postgres.

## Deploy on Railway (about an hour)

1. **Put the code on GitHub.** Create a new private repository and upload everything in this folder (not `node_modules`).
2. **Create the Railway project.** In Railway: New Project, then Deploy from GitHub repo, and pick the repository. Railway detects Node and runs `npm start`.
3. **Add the database.** In the same project: New, then Database, then PostgreSQL.
4. **Set the app's variables** (open the app service, then Variables):
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway offers this as a reference variable)
   - `ADMIN_USERNAMES` = the username you'll sign up with, for example `andrew`
   - `NODE_ENV` = `production`
   Railway sets `PORT` automatically. Push notification keys are created automatically on first start and stored in the database.
5. **Deploy and test.** In the app service's Settings, under Networking, generate a Railway domain and open it. On first start the app creates its tables and loads the sample data.
6. **Create your admin account.** Sign up with the username you put in `ADMIN_USERNAMES`. You'll see Demo controls and Pilot metrics in the menu.
7. **Use your domain.** In Settings, under Networking, add the custom domain `app.pocketinvesting.com`. Railway shows a DNS record (usually a CNAME). Add it at your domain registrar. HTTPS is set up automatically once DNS updates, which can take from minutes to a few hours.
8. **Put it on your phone.** Open app.pocketinvesting.com in Safari (iPhone) or Chrome (Android), then Share or the menu, then Add to Home Screen. It opens full-screen with the Pocket icon.

Railway's menus change from time to time, so labels may differ slightly from the above.

## Two sites from one codebase

The same code runs two separate sites. Environment variables decide which one a Railway service is.

| | Demo: app.pocketinvesting.com | Real money: my.pocketinvesting.com |
|---|---|---|
| `SITE_MODE` | `demo` (default) | `live` |
| Money | Simulated only | Practice portfolio plus a real brokerage account through Alpaca |
| Sample investors, tour, presenter, Demo controls, Reset | Yes | No |
| Two-step sign-in | Optional | Required for real money |
| Database | Its own | Its own (never shared with the demo) |

### Setting up my.pocketinvesting.com (Alpaca sandbox first)

1. **Alpaca sandbox:** sign up for Alpaca's Broker API sandbox and create sandbox API keys. Keep them private: they go only into Railway variables, never into GitHub.
2. **Railway:** in the same project, add a **second service** from the same GitHub repo, and a **second PostgreSQL database** for it.
3. **Variables on the new service:**
   - `DATABASE_URL` = `${{Postgres-2.DATABASE_URL}}` (use the new database's name)
   - `SITE_MODE` = `live`
   - `ALPACA_KEY` and `ALPACA_SECRET` = your sandbox keys
   - `ALPACA_ENV` = `sandbox`
   - `APP_SECRET` = a long random string (30+ characters). It encrypts two-step sign-in secrets. Don't change it later, or everyone has to set up two-step sign-in again.
   - `ADMIN_USERNAMES` = `andrew`
   - `NODE_ENV` = `production`
4. **Domain:** add `my.pocketinvesting.com` as a custom domain on the new service and create the DNS record Railway shows.
5. **First sign-in:** create your account (admins don't need an invite code), turn on two-step sign-in under Profile, then open the Real money tab.

When counsel and Alpaca approve going live: replace the keys with live keys and set `ALPACA_ENV=live`. Nothing else changes.

### Optional settings for the real-money site

- `MAX_ORDER_USD` (default 25000): largest single order during the beta.
- `REQUIRE_2FA` (default on for the live site).
- **Instant deposits (built, off):** `INSTANT_DEPOSITS=true` turns it on. Also needs `ALPACA_FIRM_ACCOUNT_ID` (Pocket's own Alpaca account that fronts the money). Limits: `INSTANT_LIMIT` (default 1000 per deposit), `INSTANT_TOTAL_CAP` (default 25000 outstanding across everyone), `INSTANT_MIN_ACCOUNT_DAYS` (default 30). Pro members only, after one deposit has cleared normally. Uncleared instant money can be invested but not withdrawn. If a bank transfer bounces, the app recovers the fronted amount from the account's cash, or flags it in Beta admin → Real money if the cash doesn't cover it.

### What the real-money site does today

- Opening a brokerage account in the app: identity, contact, employment and funding source, the standard disclosure questions, and agreements. The Social Security number and date of birth are passed straight to Alpaca and never stored or logged by Pocket.
- Linking a bank. The sandbox uses test bank details; the live version will use Plaid (next round).
- Deposits and withdrawals, with status updates. Withdrawals are limited to settled cash.
- Real orders in dollars or shares (fractional supported), with Sent, Partly filled and Filled states, cancel for open orders, and a private notification when an order fills.
- Holdings, balances, activity, and statements and tax documents from Alpaca.
- **Beta admin → Real money:** accounts by status, open orders, a switch to pause all real-money trading instantly, instant-deposit status, and recent brokerage errors.

**Important:** this was built against Alpaca's documented API and tested against a stand-in that mimics it, because the build environment couldn't reach Alpaca directly. Expect a round of small fixes the first time it runs against the real sandbox. Brokerage errors appear in Beta admin → Real money with Alpaca's exact message, which makes them quick to fix.

**Not yet connected to real money (next rounds):** copying and group trades, buy-at-open orders, Plaid bank linking, nightly reconciliation, and the final Alpaca-approved disclosure wording (placeholders are marked in the app).

## Alpaca keys and market data

Alpaca's Broker dashboard gives you a **Client ID** and a **Client Secret**. Put them in Railway as `ALPACA_KEY` (Client ID) and `ALPACA_SECRET` (Client Secret). Never commit them to GitHub or paste them anywhere else. The app exchanges them for a 15-minute access token, reuses it, and renews it automatically. (Older Alpaca key pairs still work with `ALPACA_AUTH_MODE=legacy`.)

Set the keys on **both** Railway services:

| | Demo (app.) | Real money (my.) |
|---|---|---|
| News on stock pages, Home and the market brief | Yes | Yes |
| Full US stock list with search | Yes (practice prices start from each stock's real last close) | Yes |
| Real prices and price history | No: simulated, labeled "Prices are simulated. News is real." | Yes, updated every 30 seconds |
| Real trading | Never | Yes, with two-step sign-in and a brokerage account |

Without keys, both sites work as before with the 20 built-in stocks and no news.

**Troubleshooting: Beta admin → Market data.** Shows the Alpaca settings in use, how many stocks and headlines are stored, when news was last fetched, and the last error. **Run check** tests sign-in, the stock list, a price quote and news live, and shows Alpaca's exact response for each. **Fetch news now** pulls headlines immediately. Failed news and price requests are also written to the Railway logs (`news fetch failed: …`).

- **Stock list:** synced from Alpaca once a day. Only stocks on major US exchanges are included (no over-the-counter stocks), and stocks under $5 can't be added. A stock joins Pocket the first time someone opens, searches and picks, or trades it; then everyone sees it.
- **News:** headlines (Benzinga, via Alpaca) are fetched every 5 minutes and kept for 30 days. Each one shows its source and time and links to the full story.
- **News alerts:** off by default. People can turn on "News about stocks I own or watch" in Notifications: at most 3 a day, never in quiet hours, only for headlines under 2 hours old.
- **Market brief:** a short daily summary on Home (the S&P 500 and Nasdaq-100, the biggest movers, top headlines), built from a fixed template, never AI-written, and labeled as information, not a recommendation.
- Confirm news display rights and the market data plan with Alpaca before a public launch.

## Demo content

- **Sample data:** about 20 sample investors and 8 groups (Tech Momentum Crew, Dividend Builders Club, Value Hunters, Beginners Circle, Index and Chill, Brand Loyalists, Chip Watchers and Kitchen Table Investors), with roughly four months of back-filled trades, group trades and member approvals, posts, comments, likes and votes. It loads automatically on an empty demo database, and **Reset the demo** restores it with fresh dates.
- **Daily sample activity:** between 8am and 9pm Eastern, sample investors post, like, comment and make practice trades every so often, so the demo never feels frozen. Turn each kind on or off in **Demo controls → Sample activity**. Group trades by sample Lead Traders are off by default, because they send approval requests to real testers in those groups.
- Every sample investor shows a **Sample** label on posts and a **Sample investor** badge on their profile.
- **Add new sample data** (Demo controls) loads the sample investors, groups and history alongside existing data without deleting anything. Your groups, posts and testers' activity stay; existing groups keep their members and rules and gain the new details. Running it again adds nothing new. **Reset the demo** still wipes everything except accounts.
- The real-money site never loads sample data or runs sample activity.

## Running the beta

- **Invite only.** New accounts need an invite code. Create codes in **Beta admin → Invites** (one per tester or per group of testers), then use **Copy sign-up link** and send it. The link fills in the code. Usernames in `ADMIN_USERNAMES` can always sign up. You can turn invite-only off in Beta admin → Settings.
- **Beta admin** (menu, admins only): testers and when they were last seen, one-time password reset codes (for anyone who forgets their password), making someone an admin, turning accounts off, invite codes, feedback, error reports, invite-only, and an announcement banner.
- **Feedback** button on every screen for signed-in testers. Messages note which screen they were on.
- **Error reports** from testers' browsers arrive automatically in Beta admin → Errors.
- **Pilot metrics** shows real tester activity (active users, 7-day retention, most-used features and screens) above the product metrics.
- **Phone notifications**: testers open Profile → Notifications → Turn on notifications. On iPhone (iOS 16.4 or later), they must first add Pocket to the Home Screen and open it from there. Android and desktop browsers work directly.

## Updating the app

Replace the files in your GitHub repository with the new version and commit. Railway redeploys automatically, and the server updates the database tables on start. Existing accounts and data are kept.

## Running it locally

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/pocket ADMIN_USERNAMES=andrew npm start
```
Then open http://localhost:3000.

## How it's built

- `server/index.js`: Express server, sign-up and sign-in, invite codes, password resets, the API, beta admin endpoints, feedback and error reports, usage events, CSV export, WebSocket live updates, and a background job every 30 seconds that expires approval requests, releases held trades and fills buy-at-open orders.
- `server/config.js`: the site settings (demo vs real money, Alpaca keys, two-step sign-in, limits, instant deposits).
- `server/alpaca.js`: every call to Alpaca's Broker API in one place.
- `server/real.js`: real-money accounts, bank links, deposits and withdrawals, orders, statements, background syncing with Alpaca, instant deposits, and the trading pause switch. Real balances are private to each person and never go into the shared live feed.
- `server/totp.js`: two-step sign-in with authenticator apps; secrets encrypted with `APP_SECRET`.
- `server/push.js`: phone notifications for approval requests, Risk Manager reviews, trade suggestions, new votes, join requests, followers and copiers, respecting each person's notification settings and quiet hours.
- `server/logic.js`: every user action, including group roles and rules (join requirements, quorum and pass thresholds, voting waiting periods, position limits, allowed investments, approval window length, Risk Manager review and Junior Trader suggestions). Each runs in a database transaction, checks permissions, and prices trades on the server, so the browser can't be used to fake trades or act for someone else.
- `server/seed.js`: the sample investors, groups, posts and proposals, plus the reset used by Demo controls.
- `server/market.js`: the simulated prices and the market clock (shared with the browser so prices always match).
- `server/db.js`: Postgres access. Each collection is a table of JSON documents, which keeps the demo flexible. The real product would use fully normalized tables.
- `public/`: the app itself, the home-screen manifest, the service worker and icons.

## Accounts and safety

- Passwords are hashed with bcrypt; sessions are secure, HTTP-only cookies lasting 30 days.
- Sign-in and actions are rate limited per IP address.
- Anyone can browse and take the tour without an account. Creating an account is required to trade, post or join groups.
- Admins (from `ADMIN_USERNAMES`) can delete any post or comment, run Demo controls, view Pilot metrics and reset the demo. Members can delete their own posts.
- Password reset works through a one-time code an admin creates in Beta admin (no email needed). Email-based reset can be added later with an email service such as Resend or Postmark.
- Members can change their password, download their trade history as CSV, and delete their account (owners must transfer group ownership first).
- The Terms and Privacy pages are drafts for the beta. Replace them with counsel's versions before a public launch (search for `vLegal` in `public/index.html`).

## Moving toward the real product

The real Pocket Investing app is a native build with a broker partner. This demo's rules in `server/logic.js` are a good reference for that build: approval windows, buy-at-open, proportional copy sizing, partial fills, roles, voting and executing a passed proposal.
