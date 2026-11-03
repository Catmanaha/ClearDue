import { pool } from '@/server/db';
import { json } from '@/server/http';
export async function GET() {
  try {
    await pool().query('SELECT 1 FROM schema_migrations LIMIT 1');
    return json({ status: 'ready' });
  } catch {
    return json({ status: 'database-unavailable' }, 503);
  }
}
