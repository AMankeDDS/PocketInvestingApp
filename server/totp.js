/* Two-step sign-in with an authenticator app (TOTP, RFC 6238). No external service needed. */
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf){ let bits = 0, val = 0, out = ''; for (const b of buf){ val = (val << 8) | b; bits += 8; while (bits >= 5){ out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function unbase32(s){ s = s.replace(/=+$/, '').toUpperCase(); let bits = 0, val = 0; const out = []; for (const c of s){ const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8){ out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function code(secret, t = Date.now(), step = 30){
  const counter = Math.floor(t / 1000 / step); const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', unbase32(secret)).update(buf).digest(); const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
}
const verify = (secret, input) => { const c = String(input || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false; const now = Date.now(); return [-1, 0, 1].some(w => crypto.timingSafeEqual(Buffer.from(code(secret, now + w * 30000)), Buffer.from(c))); };
const newSecret = () => base32(crypto.randomBytes(20));
const uri = (secret, label) => `otpauth://totp/${encodeURIComponent('Pocket Investing:' + label)}?secret=${secret}&issuer=${encodeURIComponent('Pocket Investing')}&algorithm=SHA1&digits=6&period=30`;

/* Secrets are encrypted at rest with APP_SECRET (AES-256-GCM). */
function key(appSecret){ return crypto.createHash('sha256').update(appSecret || 'pocket-dev-only-key').digest(); }
function seal(plain, appSecret){ const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(appSecret), iv); const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'); }
function open(sealed, appSecret){ if (!sealed || !sealed.startsWith('v1:')) return null; const b = Buffer.from(sealed.slice(3), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key(appSecret), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
module.exports = { code, verify, newSecret, uri, seal, open };
