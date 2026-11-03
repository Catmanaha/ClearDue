import { config } from '../src/server/config';
import { pool, closeDb } from '../src/server/db';
import { provisionOwner } from '../src/server/provision-owner';
import { seed } from '../src/server/seed';

// Operator-only, explicit initialization; never called by web/worker startup.
let failed = false;
try {
  if (
    !process.argv.includes('--confirm-empty-synthetic-db') ||
    config().mode !== 'demo' ||
    !process.env.CLEARDUE_OWNER_EMAIL ||
    !process.env.CLEARDUE_OWNER_PASSWORD
  )
    throw new Error('SETUP');
  const client = await pool().connect();
  try {
    await client.query('SELECT pg_advisory_lock(41702027)');
    const result = await client.query<{ occupied: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM "user") OR EXISTS(SELECT 1 FROM cases) AS occupied',
    );
    if (result.rows[0]?.occupied) throw new Error('NOT_EMPTY');
    const owner = await provisionOwner(
      process.env.CLEARDUE_OWNER_EMAIL,
      process.env.CLEARDUE_OWNER_PASSWORD,
    );
    await seed(owner.user.id);
    console.log('Synthetic judge workspace initialized for its authenticated owner.');
  } finally {
    await client.query('SELECT pg_advisory_unlock(41702027)');
    client.release();
  }
} catch {
  failed = true;
  console.error(
    'Judge initialization refused or failed. Use an empty, migrated demo database, explicit confirmation, allowlisted owner credentials and a random auth secret. Existing data is never reset. Inspect setup privately before retrying.',
  );
} finally {
  delete process.env.CLEARDUE_OWNER_PASSWORD;
  await closeDb();
}
if (failed) process.exitCode = 1;
