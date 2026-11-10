/* Who can see what. Every collection sent to a browser, at load and in live updates, passes
   through here. Group content (posts, proposals, votes, meetings, studies, copy requests) is for
   that group's members; a pooled club's money is for its full members; personal settings are for
   their owner. Admins see everything. On the demo site, sample groups stay public so the tour works. */
const GROUP_COLS = { proposals: 'gid', reviews: 'gid', suggestions: 'gid', meetings: 'gid', groupWatch: 'gid', studies: 'gid' };
const MANAGE = ['owner', 'admin'];
function makeCtx({ pid, isAdmin }, memberships, groups, sampleOn){
  const role = {}, gmap = {}; groups.forEach(g => { gmap[g.id] = g; });
  memberships.forEach(m => { if (m.pid === pid) role[m.gid] = m.role; });
  const sample = new Set(sampleOn ? groups.filter(g => String(g.ownerPid || '').startsWith('demo_')).map(g => g.id) : []);
  const openGroup = gid => { const g = gmap[gid]; return !!g && !g.pooled && !((g.rules || {}).hidden) && ((g.rules || {}).joinMode || 'open') !== 'invite' && g.membership !== 'invite'; };
  return { pid, isAdmin, role, gmap, sample, openGroup,
    seeGroup: gid => isAdmin || !!role[gid] || sample.has(gid),
    seeMoney: gid => isAdmin || (!!role[gid] && role[gid] !== 'observer') || sample.has(gid),
    manages: gid => isAdmin || MANAGE.includes(role[gid]),
    listsGroup: gid => { const g = gmap[gid]; return isAdmin || !!role[gid] || sample.has(gid) || (!!g && !((g.rules || {}).hidden)); },
    postGid: {}, propGid: {} };
}
/* Returns the document as this viewer may see it, or null. lookup(col, id) fetches a document the context doesn't know. */
async function view(ctx, col, d, lookup){
  if (!d) return d;
  const me = ctx.pid, A = ctx.isAdmin;
  switch (col){
    case 'profiles': { if (A || d.id === me) return d; const x = Object.assign({}, d); delete x.notif; delete x.wouldPay; delete x.wouldPayTs; return x; }
    case 'portfolios': return d.kind === 'club' ? (ctx.seeMoney(d.gid) ? d : null) : d;
    case 'groups': { if (!ctx.listsGroup(d.id)) return null; if (A || ctx.role[d.id]) return d; const x = Object.assign({}, d); delete x.inviteCode; return x; }
    case 'memberships': return d.pid === me || ctx.seeGroup(d.gid) || ctx.openGroup(d.gid) ? d : null;
    case 'posts': return !d.groupId || ctx.seeGroup(d.groupId) ? d : null;
    case 'reactions': case 'comments': {
      let gid = ctx.postGid[d.postId]; if (gid === undefined && lookup){ const p = await lookup('posts', d.postId); gid = p ? (p.groupId || null) : null; ctx.postGid[d.postId] = gid; }
      return !gid || ctx.seeGroup(gid) ? d : null; }
    case 'votes': {
      let gid = ctx.propGid[d.prid]; if (gid === undefined && lookup){ const p = await lookup('proposals', d.prid); gid = p ? p.gid : null; ctx.propGid[d.prid] = gid; }
      return gid && ctx.seeGroup(gid) ? d : (A ? d : null); }
    case 'copyRequests': return d.memberPid === me || (d.gid ? ctx.seeGroup(d.gid) : d.leaderPid === me) || A ? d : null;
    case 'trades': return String(d.pid || '').startsWith('club_') ? (ctx.seeMoney(String(d.pid).slice(5)) ? d : null) : d;
    case 'reports': return A || d.reporterPid === me ? d : null;
    case 'joinRequests': return d.pid === me || ctx.manages(d.gid) ? d : null;
    case 'dividends': return d.pid === me || A || (String(d.pid || '').startsWith('club_') && ctx.seeMoney(String(d.pid).slice(5))) ? d : null;
    case 'recurring': return d.pid === me || A ? d : null;
    default: return GROUP_COLS[col] ? (ctx.seeGroup(d[GROUP_COLS[col]]) ? d : null) : d;
  }
}
async function filterCollections(ctx, cols, lookup){
  (cols.posts || []).forEach(p => { ctx.postGid[p.id] = p.groupId || null; });
  (cols.proposals || []).forEach(p => { ctx.propGid[p.id] = p.gid; });
  const out = {};
  for (const [c, list] of Object.entries(cols)){ const kept = []; for (const d of list){ const v = await view(ctx, c, d, lookup); if (v) kept.push(v); } out[c] = kept; }
  return out;
}
async function filterChanges(ctx, changes, lookup){
  const out = [];
  for (const ch of changes){
    if (ch.wipe || !ch.data){ out.push(ch); continue; }
    if (ch.col === 'posts') ctx.postGid[ch.id] = ch.data.groupId || null;
    if (ch.col === 'proposals') ctx.propGid[ch.id] = ch.data.gid;
    const v = await view(ctx, ch.col, ch.data, lookup);
    out.push(v ? Object.assign({}, ch, { data: v }) : { col: ch.col, id: ch.id, data: null });
  }
  return out;
}
module.exports = { makeCtx, view, filterCollections, filterChanges };
