/* Demo site only: keeps the sample history current.
   The sample data is generated once with dates relative to that moment, so it slowly ages. Every few
   hours this checks how long it has been since the dates were last moved, and once a day moves every
   generated sample record forward by that much. The newest sample posts stay a few hours to a day old
   and the months of history keep their shape. Activity added later (the daily sample activity) and
   anything real people did is never moved. Prices inside old sample trades stay as they were, so a
   trade marker can sit a little off the simulated chart; that's accepted for the demo. */
const { COLS, table } = require('./db');

const DAY = 86400000;
const isTime = k => k === 'ts' || /Ts$/.test(k);
/* Records belonging only to sample investors and sample groups. */
const isSample = (id, data) => { const s = String(id) + JSON.stringify(data); return s.includes('demo_') && !s.includes('"u_') && !/(^|_)u_/.test(String(id)); };
/* When the record was made, for telling generated records from later activity. */
const madeAt = data => Number(data.ts || data.createdTs || data.joinedTs || data.decidedTs || 0);
/* The generator always writes this post 50 hours before "now", which dates an existing demo's sample data. */
const ANCHOR = { pid: 'demo_lena', text: 'Nine years running our club on spreadsheets. Never going back.', age: 50 * 3600000 };

function shift(o, d){
  let changed = false;
  if (Array.isArray(o)){ for (const x of o) if (x && typeof x === 'object' && shift(x, d)) changed = true; return changed; }
  for (const [k, v] of Object.entries(o)){
    if (typeof v === 'number' && isTime(k) && v > 1.5e12){ o[k] = v + d; changed = true; }
    else if (v && typeof v === 'object' && shift(v, d)) changed = true;
  }
  return changed;
}

async function align(pool, { now = Date.now(), minGap = DAY } = {}){
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const setting = async k => { const r = (await client.query('SELECT value FROM settings WHERE key = $1', [k])).rows[0]; return r ? r.value : null; };
    const save = (k, v) => client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, JSON.stringify(v)]);
    let at = await setting('demoAlignedAt');
    if (at == null){
      /* First run on an existing demo: date its sample data from the anchor post and mark the generated records. */
      const a = (await client.query(`SELECT data FROM doc_posts WHERE data->>'pid' = $1 AND data->>'text' = $2 ORDER BY (data->>'ts')::bigint DESC LIMIT 1`, [ANCHOR.pid, ANCHOR.text])).rows[0];
      if (!a){ await save('demoAlignedAt', now); await client.query('COMMIT'); return { moved: 0, note: 'no sample data to date' }; }
      at = Number(a.data.ts) + ANCHOR.age;
      for (const c of COLS){
        const rows = (await client.query(`SELECT id, data FROM ${table(c)}`)).rows;
        for (const r of rows) if (isSample(r.id, r.data) && madeAt(r.data) <= at + 60000)
          await client.query(`UPDATE ${table(c)} SET data = data || '{"seedDoc": true}'::jsonb WHERE id = $1`, [r.id]);
      }
    }
    const delta = now - Number(at);
    if (delta < minGap){ await client.query('COMMIT'); return { moved: 0, waitMs: minGap - delta }; }
    let moved = 0;
    for (const c of COLS){
      const rows = (await client.query(`SELECT id, data FROM ${table(c)} WHERE data->>'seedDoc' = 'true'`)).rows;
      for (const r of rows) if (shift(r.data, delta)){ await client.query(`UPDATE ${table(c)} SET data = $2, updated_at = now() WHERE id = $1`, [r.id, r.data]); moved++; }
    }
    await save('demoAlignedAt', now);
    await client.query('COMMIT');
    return { moved, byMs: delta };
  } catch (e){ await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

/* Startup: catch up if the dates are more than an hour behind; then check every 3 hours and move once a day. */
function start(pool, onMoved){
  const run = minGap => align(pool, { minGap }).then(r => { if (r.moved){ console.log(`Demo dates moved forward ${(r.byMs / 3600000).toFixed(1)} hours (${r.moved} records).`); if (onMoved) onMoved(); } }).catch(e => console.error('demo dates', e.message));
  run(3600000);
  setInterval(() => run(DAY), 3 * 3600000).unref();
}

module.exports = { align, start, shift, isSample };
