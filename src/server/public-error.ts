import { DomainError } from '../domain/core';

const messages: Record<string, string> = {
  CONFIG:
    'This workspace needs its connection settings checked. Ask the person who set it up for help.',
  AUTH_SETUP:
    'Sign-in is not ready yet. Ask the person who set up this workspace to check access settings.',
  OWNER_SETUP: 'Workspace access needs to be set up before you can continue.',
  AI_DISABLED:
    'AI analysis is not available in this workspace yet. Check Connections before requesting analysis.',
  AI_SETUP:
    'AI analysis needs its connection settings checked. Open Connections for the next step.',
  AI_LIMITS:
    'AI usage limits need to be set before analysis can run. Ask the person who set up this workspace.',
  AI_BUDGET:
    'The AI usage allowance has been reached. Check Connections before requesting more analysis.',
  AI_RESPONSE:
    'The AI response could not be verified. Review the records before requesting another analysis.',
  MODEL:
    'AI analysis could not be completed. Check Connections before requesting another analysis.',
  PAYPAL_SETUP: 'The PayPal test connection is not ready. Check Connections before continuing.',
  PAYPAL_AUTH:
    'ClearDue could not connect to PayPal. Ask the person who set up this workspace to check the connection.',
  PAYPAL_READ:
    'The latest invoice details could not be loaded from PayPal. Reload the saved case before continuing.',
  PAYPAL_RESOURCE:
    'This invoice is not approved for changes in this test workspace. Ask the person who set it up for help.',
  INVOICE_ID: 'Check the PayPal test invoice ID and enter it again.',
  UNKNOWN_OUTCOME:
    'The result of the invoice change is unconfirmed. Check the saved case status before considering another change.',
  PAYPAL_WRITE_DISABLED:
    'Invoice changes are turned off for this workspace. Ask the person who set it up before continuing.',
  STALE:
    'The invoice or supporting records have changed. Review the latest details before approving a new correction.',
  QUEUE:
    'The correction could not be scheduled, so this approval was not saved. Reload the case before trying again.',
  CONTENT_TYPE: 'This request could not be read. Refresh the page before continuing.',
  ORIGIN:
    'This request could not be accepted from this page. Open ClearDue directly and try again.',
  TOOL: 'That dashboard change is not supported. Use the available view controls.',
  MONEY: 'This amount could not be read safely. Check the invoice amounts before continuing.',
  EVIDENCE:
    'The supporting records could not be verified. Reload the case and check the supplied records.',
  CITATION:
    'The quoted source could not be verified. Review the original records before choosing a correction.',
  PROPOSAL:
    'This correction could not be verified against the investigation. Review the latest case before approving.',
  TRANSITION:
    'This action is not available at this stage. Reload the case to see its current status.',
};

export function publicError(error: unknown, fallback: string): string {
  return error instanceof DomainError ? (messages[error.code] ?? error.message) : fallback;
}
