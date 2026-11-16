/* Profile and group photos: two sizes, stored in the database (backed up with it), served by a versioned link. */
async function migrate(q){ await q(`CREATE TABLE IF NOT EXISTS photos (key text PRIMARY KEY, big bytea NOT NULL, small bytea NOT NULL, mime text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`); }
/* The phone already resizes photos and drops location data; the server checks again: the file must really be a
   JPEG or WebP, and JPEG metadata segments (EXIF, which can hold location, and XMP/IPTC) are removed. */
const isJpeg = b => b.length > 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
const isWebp = b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
function stripJpeg(b){
  const out = [b.subarray(0, 2)]; let i = 2;
  while (i + 4 <= b.length && b[i] === 0xFF){
    const m = b[i + 1]; if (m === 0xDA) { out.push(b.subarray(i)); return Buffer.concat(out); } /* start of image data: keep the rest */
    const len = b.readUInt16BE(i + 2); if (len < 2 || i + 2 + len > b.length) return null;
    if (!(m === 0xE1 || m === 0xED || (m >= 0xE3 && m <= 0xEF) || m === 0xFE)) out.push(b.subarray(i, i + 2 + len)); /* drop EXIF/XMP, IPTC, other app data and comments */
    i += 2 + len;
  }
  return null;
}
function cleanImage(x){ if (!x) return null; if (x.mime === 'image/jpeg'){ if (!isJpeg(x.b)) return null; const b = stripJpeg(x.b); return b ? { mime: x.mime, b } : null; }
  if (x.mime === 'image/webp'){ if (!isWebp(x.b)) return null; /* WebP metadata chunks (EXIF/XMP) are dropped */ return { mime: x.mime, b: stripWebp(x.b) }; } return null; }
function stripWebp(b){ try { if (b.toString('ascii', 12, 16) !== 'VP8X') return b; const parts = [], keep = []; let i = 12; while (i + 8 <= b.length){ const id = b.toString('ascii', i, i + 4), n = b.readUInt32LE(i + 4), end = i + 8 + n + (n & 1); if (end > b.length) return b; if (id !== 'EXIF' && id !== 'XMP ') keep.push(b.subarray(i, end)); i = end; }
  const body = Buffer.concat(keep); const vp8x = Buffer.from(body.subarray(0, 18)); vp8x[8] &= ~(0x08 | 0x04); const rest = body.subarray(18); const head = Buffer.alloc(12); head.write('RIFF', 0); head.writeUInt32LE(4 + vp8x.length + rest.length, 4); head.write('WEBP', 8); return Buffer.concat([head, vp8x, rest]); } catch (e){ return b; } }
const uploadLimit = require('express-rate-limit').rateLimit({ windowMs: 10 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many uploads. Try again in a few minutes.' } });
function mount(app, d){
  const { q, wrap, ok, bad, needUser, needAdmin, db, broadcast } = d;
  const decode = (s, max) => { const m = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(s || '')); if (!m) return null; const b = Buffer.from(m[2], 'base64'); return b.length > 0 && b.length <= max ? { mime: 'image/' + m[1], b } : null; };
  async function target(req, res, u){
    if (req.body.target === 'group'){ const gid = String(req.body.gid || ''); const m = (await q(`SELECT data FROM doc_memberships WHERE id = $1`, [gid + '__u_' + u.id])).rows[0];
      if (!m || !['owner', 'admin'].includes(m.data.role)){ bad(res, 'Only the Owner or an Admin can change the group photo.'); return null; } return { key: 'g_' + gid, col: 'groups', id: gid }; }
    return { key: 'u_' + u.id, col: 'profiles', id: 'u_' + u.id };
  }
  const bump = async (t, v) => { const { changes } = await db.withTx(async tx => { if (await tx.get(t.col, t.id)) await tx.update(t.col, t.id, { photoV: v }); }); broadcast(changes); };
  app.post('/api/photo', uploadLimit, wrap(async (req, res) => { const u = await needUser(req, res); if (!u) return; if (u.acting_admin) return bad(res, "You can't change photos while acting as a test account.");
    const t = await target(req, res, u); if (!t) return;
    const big = cleanImage(decode(req.body.big, 400 * 1024)), small = cleanImage(decode(req.body.small, 60 * 1024)); if (!big || !small) return bad(res, "That image couldn't be used. Try a JPEG or PNG photo.");
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

module.exports.cleanImage = cleanImage; module.exports.stripJpeg = stripJpeg;
