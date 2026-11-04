import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { provisionOwner } from '../src/server/provision-owner';
import { closeDb } from '../src/server/db';
import { config } from '../src/server/config';
import { createIntakeCase } from '../src/server/intake';
import { runInvestigation } from '../src/server/workflow';
import { fixtures } from '../src/domain/fixtures';
import { prepareJudgeExamples } from '../src/server/judge-examples';

try {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    database.pathname !== '/cleardue_test' ||
    process.env.CLEARDUE_PRODUCTION_TEST !== 'true' ||
    process.env.PAYMENT_MODE !== 'demo' ||
    process.env.AI_MODE !== 'fixture' ||
    process.env.LIVE_AI_ENABLED !== 'false'
  )
    throw new Error('Test boundary');
  const { ownerEmails, readOnlyJudgeEmail } = config();
  const email = ownerEmails.find((candidate) => candidate !== readOnlyJudgeEmail);
  if (!email || !readOnlyJudgeEmail) throw new Error('Test access settings');
  const password = randomBytes(32).toString('base64url');
  await provisionOwner(email, password);
  const judgePassword = randomBytes(32).toString('base64url');
  const judge = await provisionOwner(readOnlyJudgeEmail, judgePassword);
  const fixture = fixtures()[0];
  const saved = await createIntakeCase(judge.user.id, {
    customer: fixture.customer,
    title: 'Saved judge case',
    documents: fixture.docs.map(({ label, kind, text }) => ({ label, kind, text })),
  });
  await runInvestigation(judge.user.id, saved.id);
  const examples = await prepareJudgeExamples(judge.user.id);
  await mkdir('.local/production-test', { recursive: true });
  await writeFile('.local/production-test/credentials.json', JSON.stringify({ email, password }), {
    mode: 0o600,
  });
  await writeFile(
    '.local/production-test/judge-credentials.json',
    JSON.stringify({
      email: readOnlyJudgeEmail,
      password: judgePassword,
      caseId: saved.id,
      exampleIds: examples.map((example) => example.id),
    }),
    { mode: 0o600 },
  );
  console.log('Isolated synthetic production-test owner and judge prepared.');
} catch {
  console.error(
    'Production test preparation refused or failed. Use the migrated dedicated cleardue_test database and explicit fixture profile. Credentials are redacted.',
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
