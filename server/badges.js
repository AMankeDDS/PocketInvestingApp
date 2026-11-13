/* Badges the Pocket team manages: create, edit, retire, award (one member or everyone who joined before a date).
   Founding member is a built-in badge for accounts created before a cutoff date. Admin routes are recorded in the admin log. */
const COLORS = ['blue', 'ember', 'green', 'purple', 'gray'];
function mount(app, d){
  const { wrap, ok, bad, needAdmin, db, broadcast, q } = d;
  const tx = async fn => { let out; const { changes } = await db.withTx(async t => { out = await fn(t); }); broadcast(changes); return out; };
  const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  app.post('/api/admin/badges', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return; const b = req.body || {};
    if (b.op === 'founding'){ const c = b.cutoff ? String(b.cutoff).slice(0, 10) : null; if (c && !/^\d{4}-\d{2}-\d{2}$/.test(c)) return bad(res, 'Pick a date.');
      await tx(t => t.set('badges', 'founding', { builtin: true, name: 'Founding member', color: 'ember', desc: 'Joined Pocket before its public launch.', cutoff: c })); return ok(res); }
    if (b.op === 'outlook'){ const n = (k, def, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(b[k]) || def)));
      await tx(t => t.set('badges', 'outlookRule', { builtin: true, name: 'Outlook rules', accuracyOn: b.accuracyOn !== false, weeklyRun: n('weeklyRun', 4, 1, 52), regular: n('regular', 12, 1, 13), groupCalls: n('groupCalls', 10, 1, 500), streak: n('streak', 5, 2, 50), sharpPct: n('sharpPct', 70, 50, 100), sharpMin: n('sharpMin', 20, 5, 500), sectorPct: n('sectorPct', 70, 50, 100), sectorMin: n('sectorMin', 10, 3, 500), sectorRegular: n('sectorRegular', 8, 1, 10) })); return ok(res); }
    if (b.op === 'leader'){ const c = Math.max(1, Math.min(10000, Math.round(Number(b.copiers) || 25))), m = Math.max(2, Math.min(10000, Math.round(Number(b.members) || 10)));
      await tx(t => t.set('badges', 'leaderRule', { builtin: true, name: 'Pocket Leader', copiers: c, members: m })); return ok(res); }
    const name = clean(b.name, 24), color = COLORS.includes(b.color) ? b.color : 'blue', desc = clean(b.desc, 120);
    if (b.op === 'create'){ if (!name) return bad(res, 'Give the badge a name.'); const id = await tx(async t => { const id = t.newId(); await t.set('badges', id, { name, color, desc, createdTs: Date.now(), retired: false }); return id; }); return ok(res, { id }); }
    const id = String(b.id || ''); if (!id || id === 'founding') return bad(res, 'Badge not found.');
    if (b.op === 'update'){ if (!name) return bad(res, 'Give the badge a name.'); await tx(async t => { if (!(await t.get('badges', id))) throw Object.assign(new Error('Badge not found.'), { user: true }); await t.update('badges', id, { name, color, desc }); }); return ok(res); }
    if (b.op === 'retire'){ await tx(t => t.update('badges', id, { retired: b.retired !== false })); return ok(res); }
    bad(res, 'Unknown request.'); }));
  app.post('/api/admin/badges/award', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
    const id = String(req.body.id || ''), uname = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
    const u = (await q('SELECT id FROM users WHERE lower(username) = $1', [uname])).rows[0]; if (!u) return bad(res, `No member with the username "${uname}".`);
    const r = await tx(async t => { if (!(await t.get('badges', id))) return 'nobadge'; const p = await t.get('profiles', 'u_' + u.id); if (!p) return 'noprofile';
      const set = new Set(p.badges || []); if (req.body.remove) set.delete(id); else set.add(id); await t.update('profiles', 'u_' + u.id, { badges: [...set] }); return 'ok'; });
    if (r === 'nobadge') return bad(res, 'Badge not found.'); if (r === 'noprofile') return bad(res, "That member hasn't finished signing up."); ok(res); }));
  app.post('/api/admin/badges/bulk', wrap(async (req, res) => { if (!(await needAdmin(req, res))) return;
    const id = String(req.body.id || ''), before = Date.parse(String(req.body.joinedBefore || '') + 'T00:00:00Z'); if (!(before > 0)) return bad(res, 'Pick a date.');
    const n = await tx(async t => { if (!(await t.get('badges', id))) return -1; let n = 0;
      for (const p of await t.find('profiles', {})){ if (!String(p.id || '').startsWith('u_') || !(p.createdTs < before)) continue; const set = new Set(p.badges || []); if (set.has(id)) continue; set.add(id); await t.update('profiles', p.id, { badges: [...set] }); n++; }
      return n; });
    if (n < 0) return bad(res, 'Badge not found.'); ok(res, { awarded: n }); }));
}
module.exports = { mount };
