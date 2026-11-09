/* Beta metrics: the four numbers the financial model depends on, measured on real testers only
   (sample investors and groups are excluded), plus the supporting numbers and a monthly CSV. */
const TARGETS = {
  groupStarts: { target: 0.008, base: 0.005, label: 'Users starting a group each month' },
  proGroup:    { target: 0.45,  base: 0.35,  label: 'Pro subscribers among group members' },
  cps:         { target: 15,    base: 35,    label: 'Cost per paid signup', lowerIsBetter: true },
  wom:         { target: 0.03,  base: 0.02,  label: 'New users from members’ invite links' },
  activation:  { target: 0.6,   base: 0.6,   label: 'Signups who become active' }
};
const DAY = 86400000;
const monthKey = t => { const d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
function lastMonths(n){ const out = [], d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); for (let i = n - 1; i >= 0; i--){ const x = new Date(d); x.setUTCMonth(d.getUTCMonth() - i); const end = new Date(x); end.setUTCMonth(x.getUTCMonth() + 1); out.push({ key: monthKey(x), start: x.getTime(), end: end.getTime() }); } return out; }
function status(k, v){ const T = TARGETS[k]; if (v == null) return 'none'; if (T.lowerIsBetter) return v <= T.target ? 'on' : v <= T.base ? 'mid' : 'off'; return v >= T.target ? 'on' : v >= T.base ? 'mid' : 'off'; }

async function compute(d){
  const { q, getSetting } = d;
  const users = (await q(`SELECT id, created_at, signup_source, disabled FROM users`)).rows.filter(u => !u.disabled);
  const real = new Set(users.map(u => 'u_' + u.id));
  const profiles = {}; (await q(`SELECT id, data FROM doc_profiles WHERE id LIKE 'u\\_%'`)).rows.forEach(r => { profiles[r.id] = r.data; });
  const groups = (await q(`SELECT id, data FROM doc_groups`)).rows.map(r => Object.assign({ id: r.id }, r.data)).filter(g => real.has(g.ownerPid));
  const gids = new Set(groups.map(g => g.id));
  const members = (await q(`SELECT data FROM doc_memberships`)).rows.map(r => r.data).filter(m => gids.has(m.gid) && real.has(m.pid));
  const since = Date.now() - 200 * DAY;
  const act = (await q(`SELECT DISTINCT user_id, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM events WHERE user_id IS NOT NULL AND ts > to_timestamp($1 / 1000.0)`, [since])).rows;
  const active30 = new Set((await q(`SELECT DISTINCT user_id FROM events WHERE user_id IS NOT NULL AND ts > now() - interval '30 days'`)).rows.map(r => r.user_id));
  const activated = new Set((await q(`SELECT DISTINCT u.id FROM users u JOIN events e ON e.user_id = u.id AND e.name LIKE 'action:%' AND e.ts < u.created_at + interval '14 days'`)).rows.map(r => r.id));
  const adSpend = (await getSetting('adSpend', {})) || {};
  const byMonth = {}; act.forEach(r => { (byMonth[r.m] = byMonth[r.m] || new Set()).add(r.user_id); });
  const months = lastMonths(6);
  const rows = months.map((M, i) => {
    const mau = (byMonth[M.key] || new Set()).size, prev = i ? (byMonth[months[i - 1].key] || new Set()) : null;
    const cur = byMonth[M.key] || new Set();
    const signups = users.filter(u => { const t = new Date(u.created_at).getTime(); return t >= M.start && t < M.end; });
    const src = k => signups.filter(u => (u.signup_source || 'direct') === k).length;
    const gStarts = groups.filter(g => g.createdTs >= M.start && g.createdTs < M.end).length;
    const memEnd = members.filter(m => (m.joinedTs || 0) < M.end);
    const proEnd = memEnd.filter(m => { const p = profiles[m.pid] || {}; return p.plan === 'pro' && (p.proSince || 0) < M.end; }).length;
    const spend = Number(adSpend[M.key]) || 0, ads = src('ad');
    const groupsEnd = groups.filter(g => g.createdTs < M.end);
    const sizes = groupsEnd.map(g => memEnd.filter(m => m.gid === g.id).length);
    const cohort = signups.length ? signups.filter(u => activated.has(u.id)).length / signups.length : null;
    return { month: M.key, partial: i === months.length - 1, activeUsers: mau, signups: signups.length,
      fromGroupInvites: src('group-invite'), fromAds: ads, fromCampaigns: src('campaign'), fromBetaCodes: src('beta-code'), direct: src('direct'),
      groupStarts: gStarts, groupStartRate: mau ? gStarts / mau : null,
      groupMembers: memEnd.length, proGroupMembers: proEnd, proGroupRate: memEnd.length ? proEnd / memEnd.length : null,
      adSpend: spend, costPerSignup: spend && ads ? spend / ads : null,
      womRate: mau ? src('group-invite') / mau : null,
      activation: cohort, churn: prev && prev.size ? [...prev].filter(x => !cur.has(x)).length / prev.size : null,
      activeGroups: groupsEnd.filter((g, j) => sizes[j] >= 2).length, membersPerGroup: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null };
  });
  /* Cards use the last 30 days so early beta numbers aren't split across calendar months. */
  const t30 = Date.now() - 30 * DAY;
  const signups30 = users.filter(u => new Date(u.created_at).getTime() >= t30);
  const gStarts30 = groups.filter(g => g.createdTs >= t30).length;
  const proNow = members.filter(m => (profiles[m.pid] || {}).plan === 'pro');
  const spend2 = months.slice(-2).reduce((a, M) => a + (Number(adSpend[M.key]) || 0), 0), ads2 = months.slice(-2).reduce((a, M, i) => a + rows[rows.length - 2 + i].fromAds, 0);
  const asked = Object.entries(profiles).filter(([pid, p]) => real.has(pid) && p.wouldPay);
  const pay = k => asked.filter(([, p]) => p.wouldPay === k).length;
  const older = users.filter(u => new Date(u.created_at).getTime() < Date.now() - 14 * DAY);
  const cards = {
    groupStarts: { value: active30.size ? gStarts30 / active30.size : null, detail: `${gStarts30} group${gStarts30 === 1 ? '' : 's'} started by ${active30.size} active user${active30.size === 1 ? '' : 's'} in the last 30 days` },
    proGroup: { value: members.length ? proNow.length / members.length : null, detail: `${proNow.length} of ${members.length} group members on Pro. Pro is free during the beta.`,
      wouldPay: { asked: asked.length, yes: pay('yes'), maybe: pay('maybe'), no: pay('no') } },
    cps: { value: spend2 && ads2 ? spend2 / ads2 : null, detail: spend2 ? `$${spend2.toLocaleString('en-US')} ad spend, ${ads2} signup${ads2 === 1 ? '' : 's'} from ads, this month and last` : 'Enter ad spend below once ads are running' },
    wom: { value: active30.size ? signups30.filter(u => u.signup_source === 'group-invite').length / active30.size : null, detail: `${signups30.filter(u => u.signup_source === 'group-invite').length} new users joined through members’ invite links in the last 30 days` },
    activation: { value: older.length ? older.filter(u => activated.has(u.id)).length / older.length : null, detail: `Did something within 14 days of signing up (accounts older than 14 days: ${older.length})` }
  };
  for (const k of Object.keys(cards)) cards[k].status = status(k, cards[k].value);
  const templates = {}; groups.forEach(g => { templates[g.template || 'custom'] = (templates[g.template || 'custom'] || 0) + 1; });
  return { targets: TARGETS, cards, rows, templates, testers: users.length, active30: active30.size, smallSample: active30.size < 50, adSpend, generated: Date.now() };
}
const pctS = v => v == null ? '' : (v * 100).toFixed(2) + '%';
function toCsv(m){
  const cols = [['month','Month'],['activeUsers','Active users'],['signups','Signups'],['fromGroupInvites','From group invite links'],['fromAds','From ads'],['fromCampaigns','From other campaign links'],['fromBetaCodes','From beta codes'],['direct','Direct'],
    ['groupStarts','Groups started'],['groupStartRate','Group start rate'],['groupMembers','Group members'],['proGroupMembers','Pro group members'],['proGroupRate','Pro among group members'],['adSpend','Ad spend'],['costPerSignup','Cost per ad signup'],
    ['womRate','Invite-link signups / active users'],['activation','Activation'],['churn','Churn'],['activeGroups','Active groups'],['membersPerGroup','Members per group']];
  const rate = new Set(['groupStartRate','proGroupRate','womRate','activation','churn']);
  const cell = (k, v) => v == null ? '' : rate.has(k) ? pctS(v) : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  return [cols.map(c => c[1]).join(',')].concat(m.rows.map(r => cols.map(([k]) => cell(k, r[k]) + (k === 'month' && r.partial ? ' (so far)' : '')).join(','))).join('\n') + '\n';
}
function mount(app, d){
  const { wrap, ok, bad, needAdmin, getSetting, setSetting } = d;
  app.get('/api/admin/metrics', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; ok(res, await compute(d)); }));
  app.get('/api/admin/metrics.csv', wrap(async (req, res) => {
    if (!(await needAdmin(req, res))) return;
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="pocket-beta-metrics.csv"'); res.send(toCsv(await compute(d)));
  }));
  app.post('/api/admin/metrics/adspend', wrap(async (req, res) => {
    if (!(await needAdmin(req, res))) return;
    const month = String(req.body.month || ''), amount = Number(req.body.amount);
    if (!/^\d{4}-\d{2}$/.test(month)) return bad(res, 'Pick a month.');
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return bad(res, 'Enter the amount spent on ads, in dollars.');
    const cur = (await getSetting('adSpend', {})) || {}; cur[month] = Math.round(amount * 100) / 100; await setSetting('adSpend', cur); ok(res, { adSpend: cur });
  }));
}
module.exports = { mount, compute, toCsv, TARGETS };
