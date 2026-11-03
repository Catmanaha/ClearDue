import { readFile, readdir } from 'node:fs/promises';
import { pool, closeDb } from '../src/server/db';
const client = await pool().connect();
try {
  await client.query('SELECT pg_advisory_lock(41702026)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
      continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(`migrations/${name}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(41702026)');
  client.release();
  await closeDb();
}
