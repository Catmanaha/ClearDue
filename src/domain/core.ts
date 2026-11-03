import { createHash } from 'node:crypto';

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export const assert = (condition: unknown, code: string, message: string): asserts condition => {
  if (!condition) throw new DomainError(code, message);
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function pence(value: string): number {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value))
    throw new DomainError(
      'MONEY',
      'Use a non-negative exact amount with at most two decimal places.',
    );
  const [whole, decimal = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100_000_000)
    throw new DomainError('MONEY', 'Amount exceeds the supported limit.');
  return result;
}
export function decimal(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000)
    throw new DomainError('MONEY', 'Invalid pence amount.');
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
export const money = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100);
export type Environment = 'demo' | 'sandbox';
export type PaymentState = 'UNPAID' | 'PARTIAL' | 'PENDING' | 'PAID' | 'UNVERIFIED' | 'UNKNOWN';
export type CommandState =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'STALE'
  | 'UNSUPPORTED'
  | 'RETRYABLE_FAILURE'
  | 'UNKNOWN_OUTCOME'
  | 'MANUAL_REVIEW';
export const unresolved = ['QUEUED', 'RUNNING', 'RETRYABLE_FAILURE', 'UNKNOWN_OUTCOME'] as const;
export const transitions: Record<CommandState, readonly CommandState[]> = {
  QUEUED: ['RUNNING', 'STALE', 'UNSUPPORTED', 'RETRYABLE_FAILURE'],
  RUNNING: [
    'SUCCEEDED',
    'UNKNOWN_OUTCOME',
    'MANUAL_REVIEW',
    'STALE',
    'UNSUPPORTED',
    'RETRYABLE_FAILURE',
  ],
  RETRYABLE_FAILURE: ['QUEUED', 'MANUAL_REVIEW'],
  UNKNOWN_OUTCOME: ['SUCCEEDED', 'MANUAL_REVIEW'],
  SUCCEEDED: [],
  STALE: [],
  UNSUPPORTED: [],
  MANUAL_REVIEW: [],
};
export function transition(from: CommandState, to: CommandState) {
  if (!transitions[from].includes(to))
    throw new DomainError('TRANSITION', `Cannot move ${from} to ${to}.`);
  return to;
}
