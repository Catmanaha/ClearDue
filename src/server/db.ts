import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from './config';
import * as schema from './schema';
const g = globalThis as typeof globalThis & { clearDuePool?: Pool };
export function pool() {
  if (!g.clearDuePool)
    g.clearDuePool = new Pool({
      connectionString: config().databaseUrl,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      application_name: 'cleardue',
    });
  return g.clearDuePool;
}
export const db = () => drizzle(pool(), { schema });
export async function closeDb() {
  await g.clearDuePool?.end();
  g.clearDuePool = undefined;
}
