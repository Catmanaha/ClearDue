import { spawn } from 'node:child_process';
import process from 'node:process';
import { runtimeEnvironment } from './environment.mjs';

const children = new Set();
let stopping = false;
let shutdownTimer;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  shutdownTimer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 15000);
  shutdownTimer.unref();
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

function launch(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  children.add(child);
  child.once('exit', () => {
    children.delete(child);
    if (stopping && !children.size) clearTimeout(shutdownTimer);
  });
  return child;
}
async function once(args, env) {
  const child = launch(args, env);
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('STARTUP'))));
  });
}

try {
  const env = runtimeEnvironment(process.env);
  const bootstrap = process.argv[2] === 'bootstrap';
  if (!bootstrap) delete env.CLEARDUE_OWNER_PASSWORD;
  await once(['--import', 'tsx', 'scripts/migrate.ts'], env);
  if (!stopping && bootstrap) {
    await once(
      ['--import', 'tsx', 'scripts/bootstrap-judge.ts', '--confirm-empty-synthetic-db'],
      env,
    );
  } else if (!stopping) {
    for (const args of [
      ['--import', 'tsx', 'scripts/worker.ts'],
      ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '80'],
    ]) {
      const child = launch(args, env);
      child.once('error', () => stop(1));
      child.once('exit', () => {
        if (!stopping) {
          console.error('A required ClearDue process exited; stopping the complete service.');
          stop(1);
        }
      });
    }
  }
} catch {
  console.error('ClearDue startup failed. Check the private deployment configuration.');
  stop(1);
}
