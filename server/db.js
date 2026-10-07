/* Postgres access. Each app collection is its own table (id + JSONB document),
   which keeps the demo flexible; the real product would use fully normalized tables. */
const { Pool } = require('pg');
const crypto = require('crypto');

const COLS = ['profiles','portfolios','groups','memberships','posts','reactions','comments','follows','proposals','votes',
  'copyRequests','trades','copies','reports','joinRequests'];
const LIMITED = { posts: 400, trades: 400, comments: 400 };
const table = col => 'doc_' + col.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10
});

async function migrate(){
  for (const c of COLS){
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table(c)} (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, username text UNIQUE NOT NULL, display_name text NOT NULL, pass_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS doc_memberships_gid ON doc_memberships ((data->>'gid'))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS doc_copy_requests_member ON doc_copy_requests ((data->>'memberPid'))`);
}

const newId = () => crypto.randomBytes(10).toString('hex');
const withId = (id, data) => Object.assign({ id }, data);

/* Run fn inside a transaction. Every write is recorded so it can be
   broadcast to connected browsers after the commit. */
async function withTx(fn){
  const client = await pool.connect();
  const changes = [];
  const tx = {
    newId,
    async get(col, id, opt = {}){
      const r = await client.query(`SELECT data FROM ${table(col)} WHERE id = $1${opt.lock ? ' FOR UPDATE' : ''}`, [id]);
      return r.rows[0] ? withId(id, r.rows[0].data) : null;
    },
    async find(col, where = {}){
      const keys = Object.keys(where);
      const sql = `SELECT id, data FROM ${table(col)}` + (keys.length ? ' WHERE ' + keys.map((k, i) => `data->>'${k.replace(/[^a-zA-Z]/g, '')}' = $${i + 1}`).join(' AND ') : '');
      const r = await client.query(sql, keys.map(k => String(where[k])));
      return r.rows.map(x => withId(x.id, x.data));
    },
    async set(col, id, data){
      const clean = Object.assign({}, data); delete clean.id;
      await client.query(`INSERT INTO ${table(col)} (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [id, clean]);
      changes.push({ col, id, data: withId(id, clean) });
      return withId(id, clean);
    },
    async update(col, id, patch){
      const cur = await tx.get(col, id, { lock: true });
      if (!cur) throw Object.assign(new Error('Missing document ' + col + '/' + id), { userFacing: true });
      return tx.set(col, id, Object.assign(cur, patch));
    },
    async del(col, id){
      await client.query(`DELETE FROM ${table(col)} WHERE id = $1`, [id]);
      changes.push({ col, id, data: null });
    },
    async wipe(col){ await client.query(`DELETE FROM ${table(col)}`); changes.push({ col, wipe: true }); },
    async getSetting(key, dflt){ const r = await client.query('SELECT value FROM settings WHERE key = $1', [key]); return r.rows[0] ? r.rows[0].value : dflt; },
    async setSetting(key, value){ await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]); changes.push({ setting: key, value }); },
    query: (sql, params) => client.query(sql, params)
  };
  try {
    await client.query('BEGIN');
    const out = await fn(tx);
    await client.query('COMMIT');
    return { out, changes };
  } catch (e){
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function snapshot(){
  const out = {};
  for (const c of COLS){
    const lim = LIMITED[c];
    const r = await pool.query(`SELECT id, data FROM ${table(c)}` + (lim ? ` ORDER BY (data->>'ts')::bigint DESC NULLS LAST LIMIT ${lim}` : ''));
    out[c] = r.rows.map(x => withId(x.id, x.data));
  }
  const s = await pool.query(`SELECT value FROM settings WHERE key = 'clock'`);
  return { collections: out, settings: { clock: s.rows[0] ? s.rows[0].value : 'live' } };
}

module.exports = { pool, COLS, table, migrate, withTx, snapshot, newId };
