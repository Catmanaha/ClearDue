import { z } from 'zod';
export const viewSchema = z
  .object({
    filter: z.enum([
      'all',
      'missing-reference',
      'questioned-charge',
      'manual-review',
      'needs-evidence',
      'confirmed-outcomes',
    ]),
    sort: z.enum(['largest', 'oldest', 'customer']),
    layout: z.enum(['evidence-first', 'outcomes-first']),
  })
  .strict();
export type DashboardView = z.infer<typeof viewSchema>;
export const defaultView: DashboardView = {
  filter: 'all',
  sort: 'largest',
  layout: 'evidence-first',
};
export const toolName = 'set_case_view';
export const viewTool = {
  name: toolName,
  description:
    'Change only the current authorized case dashboard filter, balance sorting and widget order. Cannot change invoices, evidence, approvals or payments.',
  parameters: {
    type: 'object' as const,
    properties: {
      filter: {
        type: 'string',
        enum: [
          'all',
          'missing-reference',
          'questioned-charge',
          'manual-review',
          'needs-evidence',
          'confirmed-outcomes',
        ],
      },
      sort: { type: 'string', enum: ['largest', 'oldest', 'customer'] },
      layout: { type: 'string', enum: ['evidence-first', 'outcomes-first'] },
    },
    required: ['filter', 'sort', 'layout'],
    additionalProperties: false,
  },
};
type SummaryRow = {
  kind: string;
  issue: string;
  state: string;
  needsEvidence: boolean;
  payment: string;
  paidPence: number;
  removedPence: number;
  duePence: number;
};
export function matchesView(row: SummaryRow, filter: DashboardView['filter']) {
  switch (filter) {
    case 'all':
      return true;
    case 'needs-evidence':
      return row.needsEvidence;
    case 'confirmed-outcomes':
      return row.payment === 'PAID' || row.removedPence > 0;
    case 'missing-reference':
      return row.issue === 'MISSING_REFERENCE' || row.kind === 'missing-reference';
    case 'questioned-charge':
      return row.issue === 'QUESTIONED_CHARGE' || row.kind === 'unsupported-extra';
    case 'manual-review':
      return row.state === 'MANUAL_REVIEW';
  }
}
export function dashboardTotals(rows: SummaryRow[]) {
  return rows.reduce(
    (total, row) => ({
      cases: total.cases + 1,
      paidPence: total.paidPence + (row.payment === 'PAID' ? row.paidPence : 0),
      removedPence: total.removedPence + row.removedPence,
      duePence: total.duePence + row.duePence,
    }),
    { cases: 0, paidPence: 0, removedPence: 0, duePence: 0 },
  );
}
