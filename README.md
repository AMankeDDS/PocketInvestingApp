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
   Railway sets `PORT` automatically.
5. **Deploy and test.** In the app service's Settings, under Networking, generate a Railway domain and open it. On first start the app creates its tables and loads the sample data.
6. **Create your admin account.** Sign up with the username you put in `ADMIN_USERNAMES`. You'll see Demo controls and Pilot metrics in the menu.
7. **Use your domain.** In Settings, under Networking, add the custom domain `app.pocketinvesting.com`. Railway shows a DNS record (usually a CNAME). Add it at your domain registrar. HTTPS is set up automatically once DNS updates, which can take from minutes to a few hours.
8. **Put it on your phone.** Open app.pocketinvesting.com in Safari (iPhone) or Chrome (Android), then Share or the menu, then Add to Home Screen. It opens full-screen with the Pocket icon.

Railway's menus change from time to time, so labels may differ slightly from the above.

## Running it locally

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/pocket ADMIN_USERNAMES=andrew npm start
```
Then open http://localhost:3000.

## How it's built

- `server/index.js`: Express server, sign-up and sign-in, the API, WebSocket live updates, and a background job every 30 seconds that expires approval requests and fills buy-at-open orders.
- `server/logic.js`: every user action. Each runs in a database transaction, checks permissions, and prices trades on the server, so the browser can't be used to fake trades or act for someone else.
- `server/seed.js`: the sample investors, groups, posts and proposals, plus the reset used by Demo controls.
- `server/market.js`: the simulated prices and the market clock (shared with the browser so prices always match).
- `server/db.js`: Postgres access. Each collection is a table of JSON documents, which keeps the demo flexible. The real product would use fully normalized tables.
- `public/`: the app itself, the home-screen manifest, the service worker and icons.

## Accounts and safety

- Passwords are hashed with bcrypt; sessions are secure, HTTP-only cookies lasting 30 days.
- Sign-in and actions are rate limited per IP address.
- Anyone can browse and take the tour without an account. Creating an account is required to trade, post or join groups.
- Admins (from `ADMIN_USERNAMES`) can delete any post or comment, run Demo controls, view Pilot metrics and reset the demo. Members can delete their own posts.
- There's no password reset yet. Someone who forgets their password can create a new account. Email-based reset can be added later with an email service such as Resend or Postmark.

## Moving toward the real product

The real Pocket Investing app is a native build with a broker partner. This demo's rules in `server/logic.js` are a good reference for that build: approval windows, buy-at-open, proportional copy sizing, partial fills, roles, voting and executing a passed proposal.
