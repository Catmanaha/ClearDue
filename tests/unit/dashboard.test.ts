import { expect, it } from 'vitest';
import { dashboardTotals, matchesView, viewSchema } from '../../src/domain/dashboard';
const row = {
  kind: 'imported',
  issue: 'QUESTIONED_CHARGE',
  state: 'REVIEW',
  needsEvidence: true,
  payment: 'UNPAID',
  paidPence: 0,
  removedPence: 0,
  duePence: 125000,
};
it('keeps partial/pending claims out of full payments and separates reductions', () => {
  expect(
    dashboardTotals([
      { ...row, payment: 'PAID', paidPence: 100000, removedPence: 25000, duePence: 0 },
      { ...row, payment: 'PARTIAL', paidPence: 20000, duePence: 105000 },
      { ...row, payment: 'PENDING', paidPence: 125000 },
    ]),
  ).toEqual({ cases: 3, paidPence: 100000, removedPence: 25000, duePence: 230000 });
});
it('shows missing-evidence work separately from confirmed payment or reduction outcomes', () => {
  expect(matchesView(row, 'needs-evidence')).toBe(true);
  expect(matchesView(row, 'confirmed-outcomes')).toBe(false);
  expect(matchesView({ ...row, payment: 'PARTIAL' }, 'confirmed-outcomes')).toBe(false);
  expect(matchesView({ ...row, removedPence: 25000 }, 'confirmed-outcomes')).toBe(true);
  expect(matchesView({ ...row, payment: 'PAID' }, 'confirmed-outcomes')).toBe(true);
  expect(dashboardTotals([])).toEqual({ cases: 0, paidPence: 0, removedPence: 0, duePence: 0 });
});
it('accepts bounded new presentation filters and rejects execution fields', () => {
  expect(
    viewSchema.safeParse({ filter: 'needs-evidence', sort: 'oldest', layout: 'evidence-first' })
      .success,
  ).toBe(true);
  expect(
    viewSchema.safeParse({
      filter: 'confirmed-outcomes',
      sort: 'largest',
      layout: 'outcomes-first',
      execute: true,
    }).success,
  ).toBe(false);
});
