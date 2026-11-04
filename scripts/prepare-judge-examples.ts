import { config } from '../src/server/config';
import { pool, closeDb } from '../src/server/db';
import { prepareJudgeExamples } from '../src/server/judge-examples';

try {
  const cfg = config();
  if (
    !process.argv.includes('--confirm-synthetic-examples') ||
    !cfg.readOnlyJudgeEmail ||
    !cfg.ownerEmails.includes(cfg.readOnlyJudgeEmail)
  )
    throw new Error('Explicit preparation and an allowlisted judge account are required.');
  const {
    rows: [judge],
  } = await pool().query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = $1', [
    cfg.readOnlyJudgeEmail,
  ]);
  if (!judge) throw new Error('Provision the judge account first.');
  const examples = await prepareJudgeExamples(judge.id);
  console.log(
    `Prepared ${examples.length} saved examples with simulated invoices and example analysis.`,
  );
} catch {
  console.error(
    'Judge example preparation refused or failed. Inspect the saved examples and use an explicit fixture profile.',
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
