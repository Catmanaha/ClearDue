import { parseEnv } from 'node:util';
import { resolve, normalize } from 'node:path';

export class SetupError extends Error {}

const origin = 'https://aig.astropods.ai';
const fields = ['ASTRO_GATEWAY_URL', 'ASTRO_GATEWAY_API_KEY', 'ASTRO_GATEWAY_MODEL'] as const;
export const gatewayProject = 'cleardue-gateway';
export const gatewayModel = 'gpt-5-6-luna';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SetupError('Unexpected local CLI response. Nothing was imported.');
  return value as Record<string, unknown>;
}

export function creditOnlyBilling(billing: unknown, status: unknown) {
  const b = record(billing);
  const s = record(status);
  if (
    b.currency !== 'USD' ||
    b.has_credit !== true ||
    typeof b.credit_remaining !== 'number' ||
    !Number.isFinite(b.credit_remaining) ||
    b.credit_remaining <= 0 ||
    b.current_spend !== 0 ||
    s.status !== 'active' ||
    s.has_payment_method !== false ||
    s.credits_exhausted !== false ||
    s.workloads_suspended !== false ||
    s.gated !== false
  )
    throw new SetupError(
      'Free-credit/no-card billing could not be confirmed. Nothing was imported.',
    );
  return { creditRemainingUsd: b.credit_remaining, cashPayableUsd: 0, paymentMethodOnFile: false };
}

export function gatewayFromContainer(value: unknown, directory: string, model: string) {
  if (model !== gatewayModel) throw new SetupError('Select the approved model explicitly.');
  if (!Array.isArray(value) || value.length !== 1)
    throw new SetupError('Expected one local gateway container.');
  const container = record(value[0]);
  const config = record(container.Config);
  const labels = record(config.Labels);
  if (
    labels['com.docker.compose.project'] !== gatewayProject ||
    labels['com.docker.compose.service'] !== 'agent' ||
    typeof labels['com.docker.compose.project.working_dir'] !== 'string' ||
    normalize(resolve(labels['com.docker.compose.project.working_dir'])) !==
      normalize(resolve(directory))
  )
    throw new SetupError('Container does not belong to this repository gateway project.');
  if (!Array.isArray(config.Env))
    throw new SetupError('Managed gateway environment is unavailable.');
  const vars = new Map<string, string>();
  for (const entry of config.Env) {
    if (typeof entry !== 'string') throw new SetupError('Invalid managed gateway environment.');
    const split = entry.indexOf('=');
    const name = entry.slice(0, split);
    if (split < 1 || vars.has(name)) throw new SetupError('Ambiguous managed gateway environment.');
    vars.set(name, entry.slice(split + 1));
  }
  const key = vars.get('ASTRO_GATEWAY_API_KEY') ?? '';
  if (!/^[A-Za-z0-9._~+/=-]{20,4096}$/.test(key))
    throw new SetupError('Invalid managed credential format.');
  if (vars.get('ASTRO_GATEWAY_URL') !== origin || vars.get('MODEL_DEFAULT') !== model)
    throw new SetupError('Unexpected gateway origin or model. Nothing was imported.');
  return { ASTRO_GATEWAY_URL: origin, ASTRO_GATEWAY_API_KEY: key, ASTRO_GATEWAY_MODEL: model };
}

export function gatewayEnvUpdate(
  text: string,
  values: ReturnType<typeof gatewayFromContainer>,
  replace: boolean,
) {
  const parsed = parseEnv(text);
  // Deliberately refuse multiline files rather than risk altering embedded dotenv-looking text.
  if (Object.values(parsed).some((v) => v !== undefined && /[\r\n]/.test(v)))
    throw new SetupError(
      'Automatic import supports single-line dotenv values only. Update the key privately.',
    );
  let result = text;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  for (const name of fields) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[^\\r\\n]*`, 'gm');
    if ([...result.matchAll(pattern)].length > 1)
      throw new SetupError('Duplicate gateway dotenv settings.');
    if (parsed[name] && parsed[name] !== values[name] && !replace)
      throw new SetupError(
        'Existing gateway settings differ. Use --replace for deliberate renewal.',
      );
    const line = `${name}=${JSON.stringify(values[name])}`;
    result = pattern.test(result)
      ? result.replace(pattern, () => line)
      : `${result}${result.endsWith('\n') ? '' : newline}${line}${newline}`;
  }
  return result;
}
