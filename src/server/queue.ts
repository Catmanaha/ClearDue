import { PgBoss } from 'pg-boss';
import { config } from './config';
const g = globalThis as typeof globalThis & { clearDueBoss?: Promise<PgBoss> };
export const queueNames = ['investigate', 'execute', 'reconcile'] as const;
export function queue() {
  if (!g.clearDueBoss)
    g.clearDueBoss = (async () => {
      const boss = new PgBoss({
        connectionString: config().databaseUrl,
        max: 3,
        supervise: true,
        migrate: true,
      });
      boss.on('error', () =>
        console.error(
          JSON.stringify({
            event: 'queue_error',
            message: 'Queue service failed; inspect database availability.',
          }),
        ),
      );
      await boss.start();
      for (const name of queueNames)
        await boss.createQueue(name, {
          retryLimit: 2,
          retryDelay: 5,
          retryBackoff: true,
          expireInSeconds: 120,
        });
      return boss;
    })().catch((e) => {
      g.clearDueBoss = undefined;
      throw e;
    });
  return g.clearDueBoss;
}
export async function closeQueue() {
  if (g.clearDueBoss) await (await g.clearDueBoss).stop({ graceful: true });
  g.clearDueBoss = undefined;
}
