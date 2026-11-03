const entries: Record<string, { title: string; description: string }> = {
  EVIDENCE_ADDED: {
    title: 'Evidence added',
    description: 'A new source was saved. Earlier conclusions need another investigation.',
  },
  INVESTIGATED: {
    title: 'Investigation completed',
    description: 'A conclusion was saved for the records and invoice examined at that time.',
  },
  APPROVED: {
    title: 'Correction approved',
    description:
      'The owner approved a specific proposal. Approval alone does not confirm an invoice change.',
  },
  CLARIFICATION_APPROVED: {
    title: 'Customer explanation approved',
    description: 'A clarification was approved for sharing without an invoice correction.',
  },
  COMMAND_QUEUED: {
    title: 'Correction queued',
    description: 'The approved correction is waiting to be checked and processed.',
  },
  COMMAND_RUNNING: {
    title: 'Correction started',
    description: 'Processing started. The resulting invoice still needs verification.',
  },
  COMMAND_SUCCEEDED: {
    title: 'Correction verified',
    description: 'The invoice was read back and matched the approved change. Payment is separate.',
  },
  COMMAND_STALE: {
    title: 'Correction stopped: details changed',
    description:
      'The earlier approval no longer matches the current details. Review a new proposal.',
  },
  COMMAND_UNSUPPORTED: {
    title: 'Correction stopped: unsupported invoice',
    description: 'The invoice needs manual review before any further correction.',
  },
  COMMAND_RETRYABLE_FAILURE: {
    title: 'Invoice check needs another attempt',
    description:
      'The invoice could not be checked before making a change. Further checks are limited; the case may need manual review.',
  },
  COMMAND_UNKNOWN_OUTCOME: {
    title: 'Correction result is unconfirmed',
    description:
      'Check the latest invoice status to confirm the result. Do not repeat the correction while its result is unknown.',
  },
  COMMAND_MANUAL_REVIEW: {
    title: 'Manual review required',
    description:
      'Automatic processing has stopped. Inspect the current invoice and recorded activity.',
  },
  RECOVERY_BUDGET_EXHAUSTED: {
    title: 'Automatic recovery stopped',
    description: 'The recovery limit was reached. A person must review the invoice and result.',
  },
};
export function historyCopy(event: string) {
  return (
    entries[event] ?? {
      title: 'Case activity recorded',
      description: 'Additional activity was recorded for this case.',
    }
  );
}
