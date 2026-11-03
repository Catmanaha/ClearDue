import { hash } from '../../src/domain/core';
import type { Evidence } from '../../src/domain/evidence';

// Expected outcome declared before the first provider run. Not part of prompt tuning.
export const freshApproval = {
  id: 'fresh-dated-approval-v1',
  expectedIssue: 'NO_CHANGE',
  expectedAction: 'NONE',
  rationale:
    'Explicit approval on 19 October supersedes the pause on 18 October; do not remove the extra.',
} as const;

export function freshApprovalDocuments(): Evidence[] {
  return [
    {
      label: 'Project agreement',
      kind: 'agreement' as const,
      text: 'Landing page design and build: GBP 1,000. The additional social-media pack costs GBP 250 and requires customer approval.',
    },
    {
      label: 'Customer message — 18 October',
      kind: 'message' as const,
      text: '18 October 2026 — Customer: Please pause the GBP 250 social-media pack. I have not approved that extra yet.',
    },
    {
      label: 'Customer message — 19 October',
      kind: 'message' as const,
      text: '19 October 2026 — Customer: I have now reviewed the social-media pack. I approve the extra GBP 250 and its inclusion in invoice CD-1001.',
    },
  ].map((doc, index) => ({
    ...doc,
    id: `${freshApproval.id}-document-${index + 1}`,
    caseId: freshApproval.id,
    version: 1,
    hash: hash(doc.text),
  }));
}
