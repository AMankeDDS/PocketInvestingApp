/* Web push: approval requests and other alerts reach phones even when the app is closed.
   VAPID keys come from env vars, or are generated once and stored in the database. */
const webpush = require('web-push');
let publicKey = null, ready = false;

async function init(pool){
  let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } : null;
  if (!keys){
    const r = await pool.query(`SELECT value FROM settings WHERE key = 'vapid'`);
    keys = r.rows[0] && r.rows[0].value;
    if (!keys){ keys = webpush.generateVAPIDKeys(); await pool.query(`INSERT INTO settings (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(keys)]); }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@pocketinvesting.com', keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey; ready = true;
}

function minutesNow(tz){
  try { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()); const o = {}; p.forEach(x => o[x.type] = x.value); return (+o.hour % 24) * 60 + (+o.minute); }
  catch (e){ return null; }
}
const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function inQuiet(q, tz){
  if (!q || !q.on) return false; const a = toMin(q.start), b = toMin(q.end), n = minutesNow(tz); if (a == null || b == null || n == null) return false;
  return a <= b ? n >= a && n < b : n >= a || n < b;
}
/* kind: 'approvals' | 'votes' | 'social'. Approvals ignore quiet hours unless the user chose otherwise. */
function allowed(profile, kind, gid){
  const n = (profile && profile.notif) || {};
  if (n[kind] === false) return false;
  if (gid && (n.mutedGroups || []).includes(gid)) return false;
  if (kind === 'approvals' && n.approvalsInQuiet !== false) return true;
  return !inQuiet(n.quiet, n.tz);
}

async function send(pool, pids, payload){
  if (!ready || !pids.length) return 0;
  const ids = [...new Set(pids.filter(p => p && p.startsWith('u_')).map(p => p.slice(2)))]; if (!ids.length) return 0;
  const subs = await pool.query('SELECT endpoint, sub FROM push_subs WHERE user_id = ANY($1)', [ids]);
  let n = 0;
  await Promise.all(subs.rows.map(async row => {
    try { await webpush.sendNotification(row.sub, JSON.stringify(payload), { TTL: 1800 }); n++; }
    catch (e){ if (e.statusCode === 404 || e.statusCode === 410) await pool.query('DELETE FROM push_subs WHERE endpoint = $1', [row.endpoint]).catch(() => {}); }
  }));
  return n;
}

/* Turn committed changes into notifications. */
async function fromChanges(pool, changes){
  if (!ready) return;
  const now = Date.now(), fresh = d => d && (d.createdTs || d.ts) && now - (d.createdTs || d.ts) < 15000;
  const prof = async pid => { const r = await pool.query('SELECT data FROM doc_profiles WHERE id = $1', [pid]); return r.rows[0] && r.rows[0].data; };
  const name = async pid => ((await prof(pid)) || {}).name || 'Someone';
  const group = async gid => { const r = await pool.query('SELECT data FROM doc_groups WHERE id = $1', [gid]); return (r.rows[0] && r.rows[0].data) || {}; };
  const members = async gid => (await pool.query(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [gid])).rows.map(r => r.data);
  const out = [];
  for (const c of changes){
    const d = c.data; if (!d || !c.col) continue;
    try {
      if (c.col === 'copyRequests' && d.status === 'pending' && !d.decidedTs && fresh(d)){
        const g = d.gid ? await group(d.gid) : null;
        out.push({ pids: [d.memberPid], kind: 'approvals', gid: d.gid, payload: { title: `${await name(d.leaderPid)} ${d.side === 'buy' ? 'bought' : 'sold'} ${d.sym}${g ? ' for ' + g.name : ''}`, body: d.mode === 'open' ? 'Approve to copy at the next market open.' : 'Approve within the window to copy it.', url: '/#/inbox', tag: 'req-' + c.id } });
      } else if (c.col === 'proposals' && d.status === 'open' && fresh(d)){
        const g = await group(d.gid);
        out.push({ pids: (await members(d.gid)).filter(m => m.pid !== d.authorPid && m.role !== 'observer').map(m => m.pid), kind: 'votes', gid: d.gid, payload: { title: `New vote in ${g.name || 'your group'}`, body: d.title, url: `/#/group/${d.gid}/proposals`, tag: 'prop-' + c.id } });
      } else if (c.col === 'reviews' && d.status === 'pending' && fresh(d)){
        const g = await group(d.gid);
        out.push({ pids: (await members(d.gid)).filter(m => ['risk','owner'].includes(m.role)).map(m => m.pid), kind: 'approvals', gid: d.gid, payload: { title: `Trade waiting for review in ${g.name || 'your group'}`, body: `${await name(d.leaderPid)} ${d.side === 'buy' ? 'bought' : 'sold'} ${d.sym}. Release it to members or pause it for a vote.`, url: `/#/group/${d.gid}/activity`, tag: 'rev-' + c.id } });
      } else if (c.col === 'suggestions' && d.status === 'pending' && fresh(d)){
        const g = await group(d.gid);
        out.push({ pids: (await members(d.gid)).filter(m => ['lead','owner','admin'].includes(m.role)).map(m => m.pid), kind: 'approvals', gid: d.gid, payload: { title: `Trade suggestion in ${g.name || 'your group'}`, body: `${await name(d.pid)} suggests ${d.side === 'buy' ? 'buying' : 'selling'} ${d.sym}.`, url: `/#/group/${d.gid}/activity`, tag: 'sug-' + c.id } });
      } else if (c.col === 'joinRequests' && d.status === 'pending' && fresh(d)){
        const g = await group(d.gid);
        out.push({ pids: (await members(d.gid)).filter(m => ['owner','admin'].includes(m.role)).map(m => m.pid), kind: 'social', gid: d.gid, payload: { title: `Request to join ${g.name || 'your group'}`, body: `${await name(d.pid)} asked to join.`, url: `/#/group/${d.gid}/members`, tag: 'jr-' + c.id } });
      } else if ((c.col === 'follows' || c.col === 'copies') && fresh(d)){
        out.push({ pids: [d.to], kind: 'social', payload: { title: c.col === 'copies' ? 'New copier' : 'New follower', body: `${await name(d.from)} ${c.col === 'copies' ? 'started copying your trades' : 'started following you'}.`, url: '/#/u/' + d.from, tag: c.col + '-' + c.id } });
      }
    } catch (e){ /* never let notifications break an action */ }
  }
  for (const o of out){
    const keep = [];
    for (const pid of o.pids){ if (!pid || !pid.startsWith('u_')) continue; if (allowed(await prof(pid), o.kind, o.gid)) keep.push(pid); }
    await send(pool, keep, o.payload);
  }
}
module.exports = { init, send, fromChanges, get publicKey(){ return publicKey; } };
