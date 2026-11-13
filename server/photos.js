/* Profile and group photos: two sizes, stored in the database (backed up with it), served by a versioned link. */
async function migrate(q){ await q(`CREATE TABLE IF NOT EXISTS photos (key text PRIMARY KEY, big bytea NOT NULL, small bytea NOT NULL, mime text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`); }
function mount(app, d){
  const { q, wrap, ok, bad, needUser, needAdmin, db, broadcast } = d;
  const decode = (s, max) => { const m = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(s || '')); if (!m) return null; const b = Buffer.from(m[2], 'base64'); return b.length > 0 && b.length <= max ? { mime: 'image/' + m[1], b } : null; };
  async function target(req, res, u){
    if (req.body.target === 'group'){ const gid = String(req.body.gid || ''); const m = (await q(`SELECT data FROM doc_memberships WHERE id = $1`, [gid + '__u_' + u.id])).rows[0];
      if (!m || !['owner', 'admin'].includes(m.data.role)){ bad(res, 'Only the Owner or an Admin can change the group photo.'); return null; } return { key: 'g_' + gid, col: 'groups', id: gid }; }
    return { key: 'u_' + u.id, col: 'profiles', id: 'u_' + u.id };
  }
  const bump = async (t, v) => { const { changes } = await db.withTx(async tx => { if (await tx.get(t.col, t.id)) await tx.update(t.col, t.id, { photoV: v }); }); broadcast(changes); };
  app.post('/api/photo', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; if (u.acting_admin) return bad(res, "You can't change photos while acting as a test account.");
    const t = await target(req, res, u); if (!t) return;
    const big = decode(req.body.big, 400 * 1024), small = decode(req.body.small, 60 * 1024); if (!big || !small) return bad(res, "That image couldn't be used. Try a JPEG or PNG photo.");
    await q(`INSERT INTO photos (key, big, small, mime, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (key) DO UPDATE SET big = EXCLUDED.big, small = EXCLUDED.small, mime = EXCLUDED.mime, updated_at = now()`, [t.key, big.b, small.b, big.mime]);
    await bump(t, Date.now()); ok(res); }));
  app.post('/api/photo/remove', wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; const t = await target(req, res, u); if (!t) return;
    await q('DELETE FROM photos WHERE key = $1', [t.key]); await bump(t, null); ok(res); }));
  app.post('/api/admin/photo-remove', wrap(async (req, res) => { const u = await needAdmin(req, res); if (!u) return; const key = String(req.body.key || '');
    await q('DELETE FROM photos WHERE key = $1', [key]); await bump(key.startsWith('g_') ? { col: 'groups', id: key.slice(2) } : { col: 'profiles', id: key }, null); ok(res); }));
  app.get('/api/photo/:key', wrap(async (req, res) => {
    const r = (await q(`SELECT ${req.query.s === 'big' ? 'big' : 'small'} AS b, mime FROM photos WHERE key = $1`, [String(req.params.key)])).rows[0];
    if (!r) return res.status(404).end();
    res.set({ 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }); res.end(r.b); }));
}
module.exports = { migrate, mount };
