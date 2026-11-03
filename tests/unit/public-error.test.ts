import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../src/domain/core';
import { publicError } from '../../src/server/public-error';
import { pageData } from '../../src/server/page-data';
import { errorResponse } from '../../src/server/http';

describe('errors presented to workspace users', () => {
  it('identifies sign-in separately from connection failures without trusting arbitrary error codes', async () => {
    const signedOut = await pageData(async () => {
      throw new DomainError(
        'UNAUTHORIZED',
        'Sign in with an authorized owner or judge account.',
        401,
      );
    });
    expect(signedOut.signInRequired).toBe(true);
    const unavailable = await pageData(async () => {
      throw Object.assign(new Error('private connection detail'), { code: 'UNAUTHORIZED' });
    });
    expect(unavailable.signInRequired).toBe(false);
    expect(unavailable.error).not.toContain('private connection detail');
  });
  it('does not mistake a database error code for an approved public error', async () => {
    const error = Object.assign(new Error('database connection details: private-example'), {
      code: 'ECONNREFUSED',
    });
    const result = await pageData(async () => {
      throw error;
    });
    expect(result.error).toContain('Try opening it again');
    expect(result.error).not.toContain('private-example');
    expect(result.error).not.toContain('ECONNREFUSED');
  });
  it('keeps domain status/code while replacing configuration jargon', async () => {
    const response = errorResponse(
      new DomainError('AI_SETUP', 'Configure ASTRO_GATEWAY_URL.', 422),
    );
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.code).toBe('AI_SETUP');
    expect(body.error).toContain('Open Connections');
    expect(body.error).not.toContain('ASTRO_GATEWAY_URL');
  });
  it('requires fresh review after changed invoice or records', () => {
    expect(publicError(new DomainError('STALE', 'fingerprint mismatch'), '')).toBe(
      'The invoice or supporting records have changed. Review the latest details before approving a new correction.',
    );
  });
  it('does not invite a write retry after an unexpected request failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = errorResponse(new Error('private provider details'));
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.code).toBe('SERVICE');
      expect(body.error).toContain('could not confirm');
      expect(body.error).toContain('Reload the saved view before taking another action');
      expect(JSON.stringify(body)).not.toContain('private provider details');
      expect(log.mock.calls.flat().join(' ')).not.toContain('private provider details');
    } finally {
      log.mockRestore();
    }
  });
  it('preserves specific supported validation feedback', () => {
    expect(
      publicError(
        new DomainError('EXPLANATION', 'Explanation must contain 1–1,500 characters.'),
        '',
      ),
    ).toContain('1–1,500');
  });
  it('keeps provider read failures and uncertain writes distinct without technical details', () => {
    expect(publicError(new DomainError('PAYPAL_READ', 'HTTP 422'), '')).toBe(
      'The latest invoice details could not be loaded from PayPal. Reload the saved case before continuing.',
    );
    expect(publicError(new DomainError('UNKNOWN_OUTCOME', 'PUT timed out'), '')).toBe(
      'The result of the invoice change is unconfirmed. Check the saved case status before considering another change.',
    );
  });
});
