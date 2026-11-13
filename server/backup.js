/* Two-step backup codes: 10 single-use codes for signing in when the phone is lost. Stored hashed. */
const crypto = require('crypto');
const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = c => crypto.createHash('sha256').update('pocket-backup:' + norm(c)).digest('hex');
async function issue(q, userId){
  const codes = Array.from({ length: 10 }, () => { const s = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8); return s.slice(0, 4) + '-' + s.slice(4); });
  await q('DELETE FROM totp_backup WHERE user_id = $1', [userId]);
  for (const c of codes) await q('INSERT INTO totp_backup (user_id, code_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, hash(c)]);
  return codes;
}
async function use(q, userId, code){ if (norm(code).length !== 8) return false; const r = await q('UPDATE totp_backup SET used = true WHERE user_id = $1 AND code_hash = $2 AND NOT used RETURNING 1', [userId, hash(code)]); return r.rows.length > 0; }
async function left(q, userId){ return Number((await q('SELECT count(*)::int AS n FROM totp_backup WHERE user_id = $1 AND NOT used', [userId])).rows[0].n); }
module.exports = { issue, use, left };
