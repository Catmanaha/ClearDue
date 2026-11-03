import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  SetupError,
  creditOnlyBilling,
  gatewayFromContainer,
  gatewayEnvUpdate,
  gatewayModel,
  gatewayProject,
} from './lib/astropods-setup';

const { values } = parseArgs({
  options: {
    cli: { type: 'string' },
    model: { type: 'string' },
    replace: { type: 'boolean', default: false },
    'confirm-credit-only': { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
});

function run(file: string, args: string[]) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Never forward child stderr, Docker environment, API responses or credential-bearing errors.
    throw new SetupError(
      'Local CLI/Docker read failed. Check login and Docker privately; no output was forwarded.',
    );
  }
}

let temporary: string | undefined;
try {
  if (!values.cli || values.model !== gatewayModel || !values['confirm-credit-only'])
    throw new SetupError(
      'Supply --cli, --model gpt-5-6-luna and --confirm-credit-only after reviewing billing.',
    );
  const target = resolve('.env');
  if ((await lstat(target)).isSymbolicLink()) throw new SetupError('Refuse a symlinked .env.');
  const original = await readFile(target, 'utf8');
  const billing = creditOnlyBilling(
    JSON.parse(run(resolve(values.cli), ['billing', 'get', '--json', '--non-interactive'])),
    JSON.parse(run(resolve(values.cli), ['billing', 'status', '--json', '--non-interactive'])),
  );
  const directory = resolve('dev/astropods-gateway');
  const gateway = gatewayFromContainer(
    JSON.parse(run('docker', ['inspect', `${gatewayProject}-agent-1`])),
    directory,
    values.model,
  );
  const updated = gatewayEnvUpdate(original, gateway, values.replace);
  const before = parseEnv(original);
  const after = parseEnv(updated);
  for (const name of Object.keys(before)) {
    if (!name.startsWith('ASTRO_GATEWAY_') && before[name] !== after[name])
      throw new SetupError('An unrelated setting changed. Nothing was imported.');
  }
  if ((await readFile(target, 'utf8')) !== original)
    throw new SetupError('.env changed during import. Retry deliberately.');
  temporary = `${target}.gateway-${randomUUID()}.tmp`;
  await writeFile(temporary, updated, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
  temporary = undefined;
  console.log(
    JSON.stringify({
      gatewayImported: true,
      provider: 'astropods',
      model: values.model,
      ...billing,
      modelCallsMade: 0,
      otherSettingsPreserved: true,
      next: 'Restart web and worker. Confirm the development-key expiry shown by the CLI; this command does not extend it.',
    }),
  );
} catch (error) {
  console.error(
    error instanceof SetupError
      ? error.message
      : 'Gateway import failed; no underlying output was logged.',
  );
  process.exitCode = 1;
} finally {
  if (temporary) await unlink(temporary).catch(() => undefined);
}
