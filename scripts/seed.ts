import { seed } from '../src/server/seed';
import { closeDb } from '../src/server/db';
await seed();
await closeDb();
