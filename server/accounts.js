/* Account numbers. Personal practice accounts: P-XXXX-XXXX-XXXX, all random, last digit a check digit.
   Clubs: C-XXXX-XXXX-0000 for the club's own account (8-digit base, last digit a check digit), and
   -0001, -0002... for each member's stake, in the order they join. Numbers never change and are never
   reused; someone who rejoins a club gets their old number back. They identify accounts; they never
   grant access on their own. */
const crypto = require('crypto');
function luhn(d){ let sum = 0, dbl = true; for (let i = d.length - 1; i >= 0; i--){ let n = +d[i]; if (dbl){ n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; } return String((10 - sum % 10) % 10); }
const rnd = n => { let s = ''; while (s.length < n){ const b = crypto.randomBytes(1)[0]; if (b < 250) s += b % 10; } return s; };
const groups4 = s => s.match(/.{4}/g).join('-');
function valid(num){ const m = /^([PC])-(\d{4})-(\d{4})-(\d{4})$/.exec(String(num || '').trim().toUpperCase()); if (!m) return false; const d = m[1] === 'P' ? m[2] + m[3] + m[4] : m[2] + m[3]; return luhn(d.slice(0, -1)) === d.slice(-1); }
const mask = num => num ? num.replace(/^([PC])-\d{4}-/, '$1-••••-') : '';
let q = null;
async function migrate(query){
  q = query;
  await q(`CREATE TABLE IF NOT EXISTS account_numbers (number text PRIMARY KEY, kind text NOT NULL, pid text, gid text, seq int, created_at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS account_numbers_personal ON account_numbers (pid) WHERE kind = 'personal'`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS account_numbers_club ON account_numbers (gid) WHERE kind = 'club'`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS account_numbers_member ON account_numbers (gid, pid) WHERE kind = 'member'`);
}
async function insertUnique(make, kind, pid, gid, seq){
  for (let i = 0; i < 20; i++){ const num = make(); const r = await q(`INSERT INTO account_numbers (number, kind, pid, gid, seq) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING number`, [num, kind, pid, gid, seq]); if (r.rows.length) return num; const ex = await existing(kind, pid, gid); if (ex) return ex; }
  throw new Error('Could not issue an account number');
}
async function existing(kind, pid, gid){ const r = kind === 'personal' ? await q(`SELECT number FROM account_numbers WHERE kind = 'personal' AND pid = $1`, [pid]) : kind === 'club' ? await q(`SELECT number FROM account_numbers WHERE kind = 'club' AND gid = $1`, [gid]) : await q(`SELECT number FROM account_numbers WHERE kind = 'member' AND gid = $1 AND pid = $2`, [gid, pid]); return r.rows[0] ? r.rows[0].number : null; }
async function personal(pid){ return (await existing('personal', pid)) || insertUnique(() => { const d = rnd(11); return 'P-' + groups4(d + luhn(d)); }, 'personal', pid, null, null); }
async function club(gid){ return (await existing('club', null, gid)) || insertUnique(() => { const d = rnd(7); return 'C-' + groups4(d + luhn(d)) + '-0000'; }, 'club', null, gid, 0); }
async function member(gid, pid){
  const ex = await existing('member', pid, gid); if (ex) return ex;
  const base = (await club(gid)).slice(0, 11);
  for (let i = 0; i < 5; i++){
    const seq = ((await q(`SELECT max(seq) AS m FROM account_numbers WHERE kind = 'member' AND gid = $1`, [gid])).rows[0].m || 0) + 1;
    const num = base + '-' + String(seq).padStart(4, '0');
    const r = await q(`INSERT INTO account_numbers (number, kind, pid, gid, seq) VALUES ($1, 'member', $2, $3, $4) ON CONFLICT DO NOTHING RETURNING number`, [num, pid, gid, seq]); if (r.rows.length) return num;
    const again = await existing('member', pid, gid); if (again) return again;
  }
  throw new Error('Could not issue a member number');
}
/* Clubs are groups that keep club books or pool money. */
async function ensureAll(){
  for (const r of (await q(`SELECT id FROM doc_profiles WHERE id LIKE 'u\\_%' OR id LIKE 'demo\\_%'`)).rows) await personal(r.id);
  const clubs = new Set((await q('SELECT gid FROM club_books')).rows.map(r => r.gid).concat((await q(`SELECT id FROM doc_groups WHERE (data->>'pooled')::boolean`)).rows.map(r => r.id)));
  for (const gid of clubs){ await club(gid); for (const m of (await q(`SELECT data FROM doc_memberships WHERE data->>'gid' = $1`, [gid])).rows.map(r => r.data)) if (m.role !== 'observer') await member(gid, m.pid); }
  for (const r of (await q(`SELECT DISTINCT gid, data->>'pid' AS pid FROM club_entries WHERE data->>'pid' IS NOT NULL`)).rows) await member(r.gid, r.pid);
}
async function clubNumbers(gid){ const rows = (await q(`SELECT number, kind, pid FROM account_numbers WHERE gid = $1`, [gid])).rows; const out = { club: null, members: {} }; rows.forEach(r => { if (r.kind === 'club') out.club = r.number; else out.members[r.pid] = r.number; }); return out; }
async function find(num){ const r = (await q(`SELECT number, kind, pid, gid FROM account_numbers WHERE number = $1`, [String(num || '').trim().toUpperCase()])).rows[0]; return r || null; }
module.exports = { migrate, personal, club, member, ensureAll, clubNumbers, find, valid, mask, luhn };
