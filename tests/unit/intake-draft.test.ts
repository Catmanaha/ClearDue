import { expect, it } from 'vitest';
import { createIntakeDraftStore, type IntakeDraft } from '../../src/components/intake-draft';
const draft: IntakeDraft = {
  requestId: 'draft-request',
  customer: 'Synthetic customer',
  title: 'Unsaved case',
  invoiceId: '',
  records: [],
  removed: null,
  review: true,
  uncertain: true,
  checkedQueue: false,
};
it('keeps a draft only in its owner/merchant/environment scope', () => {
  const store = createIntakeDraftStore();
  store.save('owner-a-demo', draft);
  expect(store.read('owner-a-demo')).toEqual(draft);
  expect(store.read('owner-b-demo')).toBeUndefined();
  expect(store.read('owner-a-sandbox')).toBeUndefined();
  store.save('owner-b-demo', { ...draft, title: 'Other owner' });
  expect(store.read('owner-a-demo')).toBeUndefined();
});
it('retains the unconfirmed-save guard and clears only the matching draft', () => {
  const store = createIntakeDraftStore();
  store.save('owner-a-demo', draft);
  store.clear('owner-b-demo');
  expect(store.read('owner-a-demo')?.uncertain).toBe(true);
  store.clear('owner-a-demo');
  expect(store.read('owner-a-demo')).toBeUndefined();
});
