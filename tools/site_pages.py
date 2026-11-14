"""Builds the website's extra pages from the homepage's styles, header and footer.
Run: python3 tools/site_pages.py   (writes public/site/*.html and public/site/drafts/*.html)"""
import re, os
SITE = os.path.join(os.path.dirname(__file__), '..', 'public', 'site')
home = open(os.path.join(SITE, 'index.html')).read()
style = home[home.index('<style>'):home.index('</style>') + 8]
FOOT_LINKS = [('Pricing', '/site/pricing.html'), ('FAQ', '/site/faq.html'), ('About', '/site/about.html'), ('Security', '/site/security.html'), ('Disclosures', '/site/disclosures.html'), ('Community guidelines', '/site/guidelines.html'), ('Status', '/status'), ('Privacy', 'https://app.pocketinvesting.com/#/privacy'), ('Terms', 'https://app.pocketinvesting.com/#/terms')]
FOOTER = '''<footer><div class="wrap">
  <div class="row"><a class="brand" href="/"><img src="/icons/icon-192.png" alt="">Pocket Investing</a><span><a href="https://demo.pocketinvesting.com">Try the demo</a> &nbsp; <a href="/#invite">Request an invite</a> &nbsp; <a href="https://app.pocketinvesting.com">Beta sign in</a></span></div>
  <nav class="footlinks" aria-label="Site">''' + ' '.join(f'<a href="{h}">{l}</a>' for l, h in FOOT_LINKS) + '''</nav>
  <p class="legal">Pocket Investing is in beta, and beta accounts use practice money only. Pocket Investing is not a broker-dealer or investment adviser and does not provide investment, legal or tax advice. Brokerage services for real-money accounts will be provided by Alpaca Securities LLC, member FINRA/SIPC. Investing involves risk, including the possible loss of principal. Past performance does not guarantee future results.</p>
  <p class="legal">© 2026 Pocket Investing</p>
</div></footer>'''
EXTRA_CSS = '''<style>
.footlinks{display:flex;flex-wrap:wrap;gap:6px 16px;margin:14px 0 4px;font-size:14px}.footlinks a{color:inherit;opacity:.85}
.page{max-width:820px;margin:0 auto;padding:36px 20px 56px}.page h1{font-family:var(--f-head);font-size:clamp(30px,5vw,42px);margin:0 0 10px}.page h2{font-family:var(--f-head);margin:32px 0 10px;font-size:22px}
.page p,.page li{color:var(--text);line-height:1.6}.page .lead{color:var(--muted);font-size:18px}.page .card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin:12px 0}
.tbl{width:100%;border-collapse:collapse;font-size:15px}.tbl th,.tbl td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}.tbl th{font-family:var(--f-head)}
.draft{background:#b3541e;color:#fff;font-weight:700;text-align:center;padding:10px 14px;position:sticky;top:0;z-index:50}.pending{display:inline-block;font-size:13px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ember) 20%,transparent);color:var(--ember-ink)}
@media (prefers-color-scheme: dark){.pending{color:var(--ember)}}
details.q{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0}details.q summary{cursor:pointer;font-weight:600}
</style>'''
def header():
    h = home[home.index('<header class="top">'):home.index('</header>') + 9]
    h = re.sub(r'href="#(\w+)"', lambda m: f'href="/#{m.group(1)}"', h)
    return h.replace('href="/#top"', 'href="/"')
def page(slug, title, desc, body, draft=False, folder=''):
    meta = f'<meta name="robots" content="noindex,nofollow">' if draft else ''
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} · Pocket Investing</title><meta name="description" content="{desc}">{meta}
<meta property="og:title" content="{title} · Pocket Investing"><meta property="og:description" content="{desc}"><meta property="og:image" content="https://pocketinvesting.com/site/img/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icons/favicon.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
{style}{EXTRA_CSS}</head><body>{'<div class="draft">DRAFT. Not in effect. Pending legal review.</div>' if draft else ''}{header()}<main class="page">{body}</main>{FOOTER}</body></html>'''
    d = os.path.join(SITE, folder); os.makedirs(d, exist_ok=True); open(os.path.join(d, slug + '.html'), 'w').write(html)
P = 'Pending legal review'
PAGES = {}
PAGES['pricing'] = ('Pricing', 'Free, Pro and Group Pro plans on Pocket Investing.', '''<h1>Pricing</h1><p class="lead">Free for beta members. Paid plans start at launch.</p>
<div class="card"><b>Founding member offer.</b> Members who join before launch get 50% off their first year of Pro or Group Pro, if they subscribe within 90 days of launch.</div>
<table class="tbl"><thead><tr><th></th><th>Free</th><th>Pro</th><th>Group Pro</th></tr></thead><tbody>
<tr><td>Price at launch</td><td>$0</td><td>$9.99 a month, or $99 a year</td><td>$19.99 per group, per month</td></tr>
<tr><td>Practice trading</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Your own real-money account: deposit, withdraw, buy and sell</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Follow investors, watchlists, alerts, posting</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Observe groups</td><td>✓</td><td>✓</td><td>✓</td></tr>
<tr><td>Copy investors, with your approval on every trade</td><td></td><td>✓</td><td>✓</td></tr>
<tr><td>Full group membership: vote and get copy requests</td><td></td><td>✓</td><td>✓</td></tr>
<tr><td>Recurring buys and advanced statements</td><td></td><td>✓</td><td>✓</td></tr>
<tr><td>Run a group: rules, voting, pooled club books, K-1 worksheets</td><td></td><td></td><td>✓</td></tr>
</tbody></table>
<h2>Good to know</h2><ul><li>If a subscription ends, you keep everything on the Free plan, including your money, statements, tax documents and club records.</li><li>Cancel any time from Profile. Pro stays on until the end of the period you paid for.</li><li>Group Pro can be split among a group's members.</li><li>Prices are planned and may change before launch.</li></ul>''')
PAGES['faq'] = ('FAQ', 'Answers about Pocket Investing: money, copying, groups, plans and security.', f'''<h1>Frequently asked questions</h1>
<h2>Your money</h2>
<details class="q"><summary>Who holds my money?</summary><p>During the beta, accounts use practice money only. For real-money accounts, your money and investments will be held by Alpaca Securities LLC, a registered broker-dealer and member of FINRA and SIPC, in an account in your name. Pocket doesn't hold customer money.</p></details>
<details class="q"><summary>How do deposits and withdrawals work?</summary><p>You link a bank account and move money by bank transfer (ACH), which usually takes 1 to 3 business days. Withdrawals go back to your linked bank.</p></details>
<details class="q"><summary>What happens to my account if Pocket closes?</summary><p>Your brokerage account is at Alpaca, in your name, so your money and investments stay there. You'd be able to access or transfer them through Alpaca.</p></details>
<details class="q"><summary>Can I use my existing brokerage account?</summary><p>Not yet. Connecting an account you already have at another brokerage is coming soon. For now, you open an account through Pocket with our brokerage partner, Alpaca.</p></details>
<h2>Copying and approvals</h2>
<details class="q"><summary>Does anything trade without my OK?</summary><p>No. When someone you copy trades, or your group decides on a trade, you get a request. Nothing happens in your account until you approve it.</p></details>
<details class="q"><summary>How big is a copied trade?</summary><p>Copies are sized to your account, in proportion to the leader's trade. You can approve the full size, half, or decline.</p></details>
<h2>Groups and clubs</h2>
<details class="q"><summary>What's the difference between a group and a pooled club?</summary><p>In a group, each member invests in their own account and approves copies of the group's trades. In a pooled club, members put money into one shared account and own units of it; trades happen only by member vote, and Pocket keeps the books. Pooled clubs use practice money during the beta.</p></details>
<h2>Plans and fees</h2>
<details class="q"><summary>What does Pocket cost?</summary><p>It's free during the beta. See <a href="/site/pricing.html">Pricing</a> for the plans planned at launch.</p></details>
<h2>Security</h2>
<details class="q"><summary>How is my account protected?</summary><p>Two-step sign-in (required for real money), approval on every copied trade, fresh codes for withdrawals and bank changes, and alerts for sign-ins and security changes. See <a href="/site/security.html">Security</a>.</p></details>
<details class="q"><summary>How is Pocket regulated? <span class="pending">{P}</span></summary><p>This answer is being reviewed with our lawyers and will be published before real-money accounts open.</p></details>
<h2>The app</h2>
<details class="q"><summary>Is there an app?</summary><p>Pocket works in your phone's browser today. Add it to your Home Screen and it opens full screen, with notifications for approvals and alerts. iPhone and Android apps are coming soon.</p></details>
<h2>Your account</h2>
<details class="q"><summary>How do I delete my account?</summary><p>In Profile, choose Delete account. If you have a real-money account, sell your holdings and withdraw your balance first. Records the law requires us or our brokerage partner to keep are kept; your profile, posts and activity are removed.</p></details>''')
PAGES['about'] = ('About', 'What Pocket Investing is and why it exists.', '''<h1>About Pocket</h1><p class="lead">Investing is more fun, and often wiser, with other people. Pocket makes that easy without giving up control.</p>
<h2>What Pocket is</h2><p>Pocket is a social investing app. You can invest on your own, follow investors you trust and copy their trades with your approval, or invest together with friends, family or an investment club that votes on what to buy.</p>
<h2>What we believe</h2><ul><li><b>Your account, your decision.</b> Nothing trades without your approval.</li><li><b>Groups need structure.</b> Clear roles, voting rules and shared records keep groups fair.</li><li><b>Honesty about risk.</b> No hype, no promises, and sample data is always labeled.</li></ul>
<h2>Contact</h2><p>Questions, ideas or press: <a href="mailto:andrew@pocketinvesting.com">andrew@pocketinvesting.com</a>. Pocket is based in Connecticut.</p>''')
PAGES['security'] = ('Security', 'How Pocket Investing protects your account.', '''<h1>Security</h1><p class="lead">How we protect your account, and what you can do.</p>
<div class="card"><b>Approval on every copied trade.</b> Nothing trades in your account without your OK.</div>
<div class="card"><b>Two-step sign-in.</b> Use an authenticator app for a code at sign-in. It's required for real-money accounts and Pocket admins, and you get backup codes in case you lose your phone.</div>
<div class="card"><b>Extra checks for money.</b> Withdrawals and bank changes need a fresh code. If two-step sign-in is ever reset, money moves are paused for 48 hours.</div>
<div class="card"><b>Alerts and an activity log.</b> You're told about new sign-ins, password and two-step changes, and lockouts, and you can review recent security events in Profile.</div>
<div class="card"><b>Brokerage custody.</b> For real-money accounts, your money and investments will be held by Alpaca Securities LLC, member FINRA/SIPC, in your name. Pocket doesn't hold customer money.</div>
<div class="card"><b>Encryption.</b> Connections to Pocket are encrypted, and sensitive settings like two-step secrets are stored encrypted.</div>
<h2>What you can do</h2><ul><li>Use a unique password and turn on two-step sign-in.</li><li>Save your backup codes somewhere safe.</li><li>Pocket will never ask for your password or codes by email, text or phone.</li></ul>''')
PAGES['disclosures'] = ('Disclosures', 'Important disclosures about investing with Pocket.', f'''<h1>Disclosures <span class="pending">{P}</span></h1>
<p><b>Risk.</b> Investing involves risk, including the possible loss of principal. Past performance does not guarantee future results.</p>
<p><b>No advice.</b> Pocket Investing is not a broker-dealer or investment adviser and does not provide investment, legal or tax advice. Posts, group discussions, member votes and the weekly outlook are member opinions, not recommendations.</p>
<p><b>Copying.</b> Copying a trade doesn't guarantee the same price or result. Copies are sized to your account and placed only when you approve them, so fills can differ from the leader's.</p>
<p><b>Practice money.</b> Beta and practice accounts use simulated money. Practice results don't reflect real trading.</p>
<p><b>Sample data.</b> The demo and screenshots use sample people and sample data, which aren't real investors or real results.</p>
<p><b>Brokerage.</b> Brokerage services for real-money accounts will be provided by Alpaca Securities LLC, member FINRA/SIPC. Alpaca's own disclosures and official statements apply to those accounts.</p>
<p><b>Low-priced stocks.</b> Stocks under $5 can be very volatile and easier to manipulate.</p>''')
PAGES['guidelines'] = ('Community guidelines', 'The rules for posts, comments, groups and profiles on Pocket Investing.', '''<h1>Community guidelines</h1><p class="lead">Pocket works when people can trust what they read. These rules apply to posts, comments, groups, profiles and photos.</p>
<h2>Don't</h2><ul>
<li><b>Hype or pump.</b> No "guaranteed" gains, "to the moon," coordinated buying, or anything meant to push a price.</li>
<li><b>Mislead.</b> Don't present opinions as facts, or sample or practice results as real ones.</li>
<li><b>Impersonate.</b> Don't pretend to be another person, a company or Pocket.</li>
<li><b>Harass.</b> No insults, threats, hate or pile-ons.</li>
<li><b>Share private information.</b> Not yours, not anyone else's: account numbers, addresses, phone numbers.</li>
<li><b>Spam or sell.</b> No ads, paid signals, or links to schemes.</li></ul>
<h2>Do</h2><ul><li>Explain your reasoning, and say when something is your opinion.</li><li>Disagree about ideas, not people.</li><li>Report anything that breaks these rules. Reports are anonymous.</li></ul>
<h2>What happens</h2><p>The Pocket team reviews reports. Content that breaks the rules is removed, and the author is told why. Repeat or serious problems can lead to a pause on posting, or closing an account.</p>
<p class="pending">This page is being reviewed with our lawyers.</p>''')
DRAFTS = {}
DRAFTS['terms-updates'] = ('Terms of Service: proposed updates', f'''<h1>Terms of Service: proposed updates</h1><p class="lead">Plain-language starting points for counsel. Not legal advice and not in effect.</p>
<h2>Eligibility</h2><p>You must be at least 18 years old to use Pocket. By creating an account, you confirm you are 18 or older. We may close accounts of anyone under 18.</p>
<h2>Profile and group photos</h2><p>You may upload a profile photo, and Owners and Admins may upload a group photo. You must own the photo or have permission to use it. Photos may not show other people without their permission, logos you don't own, or anything offensive. We may remove any photo that breaks these terms or the <a href="/site/guidelines.html">community guidelines</a>. We remove location data from photos.</p>
<h2>Community content</h2><p>Posts, comments, group tags, badge ideas and votes are member opinions, not investment advice. You're responsible for what you post. We may remove content, limit posting for a period, or close accounts that break the community guidelines.</p>
<h2>Badges and tags</h2><p>Badges describe participation and roles and don't reflect investment skill or results, except where a badge says otherwise. We may create, change, retire or remove badges and tags at any time.</p>
<h2>Groups: vacation mode and role changes</h2><p>An Owner or Lead Trader may name a stand-in for up to 90 days. If an Owner or Lead Trader is inactive for 30 days, members may vote to replace them, and Pocket may reassign the role if a vote isn't possible.</p>
<h2>Weekly outlook</h2><p>The weekly outlook collects member opinions for fun and discussion. There are no prizes, and it is not a prediction market or a recommendation.</p>
<h2>Deleting your account</h2><p>You may delete your account at any time. We remove your profile, posts and activity. We and our brokerage partner keep records we are required by law to keep. If you have a real-money account, you must sell your holdings and withdraw your balance first.</p>
<h2>Pro credits from referrals</h2><p>Pro credits earned through referrals have no cash value, can't be transferred, and apply only to Pocket subscriptions.</p>''')
DRAFTS['privacy-updates'] = ('Privacy Policy: proposed updates', '''<h1>Privacy Policy: proposed updates</h1><p class="lead">Plain-language starting points for counsel. Not legal advice and not in effect.</p>
<h2>What we collect</h2><ul><li><b>Photos</b> you upload, stored in two sizes, with location data removed.</li><li><b>Visits:</b> one record per day that you use Pocket, to understand how the beta is going.</li><li><b>Check-in answers:</b> your recommend score and comment, if you choose to answer.</li><li><b>Referrals:</b> who invited you, and whether a qualifying deposit settled.</li><li><b>Weekly outlook votes</b> and your call record. Your record is private unless you choose to show it.</li><li><b>Support requests,</b> including screenshots you attach, and reports you send.</li><li><b>Age confirmation</b> (that you're 18 or older).</li></ul>
<h2>What other members see</h2><p>Your name, photo, bio, badges, posts and group activity. Not your survey answers, credits, activity times, blocks or reports.</p>
<h2>After you delete your account</h2><p>We remove your profile, posts and activity. We keep records required by law, such as brokerage and transaction records, for the time the law requires.</p>
<h2>Service providers</h2><p>We share information only as needed with providers who help run Pocket: Alpaca (brokerage), Railway (hosting), and, when added, Stripe (payments), RevenueCat (app subscriptions), and an email service.</p>''')
DRAFTS['referral-terms'] = ('Referral program terms', '''<h1>Referral program terms</h1><p class="lead">Plain-language starting points for counsel. Not legal advice and not in effect.</p>
<ul><li><b>Who can take part:</b> members in good standing with a personal invite link.</li><li><b>Qualifying referral:</b> a friend who signs up through your link, opens a real-money account, and makes a deposit of more than $100 that settles.</li><li><b>Reward:</b> 3 months of Pro per qualifying referral, up to 4 referrals (12 months). Rewards are Pro credits with no cash value and apply when Pro becomes paid.</li><li><b>Not eligible:</b> referring yourself, accounts using the same bank account as yours, or deposits that are returned or reversed.</li><li><b>Abuse:</b> we may withhold or remove rewards for referrals that appear fraudulent or abusive, including deposits withdrawn shortly after the reward.</li><li><b>Changes:</b> we may change or end the program at any time. Rewards already earned remain.</li></ul>''')
DRAFTS['subscription-terms'] = ('Subscription terms', '''<h1>Subscription terms</h1><p class="lead">Plain-language starting points for counsel. Not legal advice and not in effect.</p>
<ul><li><b>Automatic renewal:</b> Pro and Group Pro renew automatically each month or year until you cancel. We'll show the price and renewal terms before you subscribe, and remind you before an annual renewal.</li><li><b>Cancel any time:</b> in Profile, in two taps. Your plan stays on until the end of the period you paid for. App store subscriptions are managed in your phone's settings.</li><li><b>Failed payments:</b> Pro renewals have a 5-day grace period and Group Pro a 10-day grace period to update your card. A first payment that fails doesn't start a subscription.</li><li><b>Refunds:</b> [to be decided with counsel].</li><li><b>Founding member offer:</b> members who joined before launch get 50% off their first year if they subscribe within 90 days of the full launch date.</li><li><b>Free trial:</b> new members after launch may get a 14-day trial; you won't be charged if you cancel before it ends.</li><li><b>Group Pro splits:</b> a group's owner may split the cost with members who opt in, with a minimum share of $3 a month per member.</li><li><b>Price changes:</b> we'll tell you before a price change takes effect, and you can cancel before it applies.</li><li><b>Prices:</b> may differ between the website and the app stores.</li></ul>''')
for slug, (t, d, b) in PAGES.items(): page(slug, t, d, b)
for slug, (t, b) in DRAFTS.items(): page(slug, t, 'Draft, not in effect.', b, draft=True, folder='drafts')
print('pages:', len(PAGES), 'drafts:', len(DRAFTS))
