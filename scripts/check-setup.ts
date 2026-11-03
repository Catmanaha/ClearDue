import { readdir } from 'node:fs/promises';
import { config, liveLimits } from '../src/server/config';
import { pool, closeDb } from '../src/server/db';

const checks: { name: string; status: 'ready' | 'warning' | 'failed'; detail: string }[] = [];
try {
  const c = config();
  checks.push({
    name: 'profile',
    status: 'ready',
    detail: `Payments: ${c.mode}; analysis: ${c.ai}.`,
  });
  const expected = (await readdir('migrations')).filter((n) => n.endsWith('.sql'));
  const applied = await pool().query<{ name: string }>('SELECT name FROM schema_migrations');
  const missing = expected.filter((n) => !applied.rows.some((r) => r.name === n));
  checks.push({
    name: 'database migrations',
    status: missing.length ? 'failed' : 'ready',
    detail: missing.length
      ? 'Run pnpm db:migrate.'
      : `${expected.length} expected migrations applied.`,
  });
  if (
    !c.demoAccess &&
    (!process.env.BETTER_AUTH_SECRET ||
      process.env.BETTER_AUTH_SECRET.length < 32 ||
      !c.ownerEmails.length)
  )
    checks.push({
      name: 'owner access',
      status: 'failed',
      detail: 'Configure the auth secret, allowlist and privately provisioned account.',
    });
  else
    checks.push({
      name: 'owner access',
      status: 'ready',
      detail: c.demoAccess
        ? 'Explicit loopback development demo access.'
        : 'Auth configuration present; account login not tested by this command.',
    });
  if (c.ai === 'live') {
    const limits = liveLimits();
    checks.push({
      name: 'model configuration',
      status: 'ready',
      detail: `${limits.provider}/${limits.model}; daily ${limits.calls} calls/${limits.tokens} reserved tokens; ${limits.output} output tokens/call. Access not tested.`,
    });
    if (limits.provider === 'astropods')
      checks.push({
        name: 'gateway continuity',
        status: 'warning',
        detail:
          'Development keys are short-lived. Check the CLI-reported expiry and re-import when renewed.',
      });
  } else
    checks.push({
      name: 'analysis provenance',
      status: 'ready',
      detail: 'Fixture rules selected. This is not live AI.',
    });
  if (c.studioEnabled && !c.studioKey)
    checks.push({
      name: 'Studio entitlement',
      status: 'warning',
      detail: 'Unlicensed internal evaluation; judge/release entitlement is not verified.',
    });
  console.log(
    JSON.stringify(
      {
        checks,
        providerCallsMade: 0,
        limits:
          'Prerequisites only. Does not prove worker liveness, provider access, account login or licence rights.',
      },
      null,
      2,
    ),
  );
  if (checks.some((c) => c.status === 'failed')) process.exitCode = 1;
} catch {
  console.error(
    'Setup check failed. Check the selected profile, database and docs/SETUP.md. No underlying error or credential was logged.',
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
