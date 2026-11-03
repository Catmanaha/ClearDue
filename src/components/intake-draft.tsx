'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ImportedRecord } from '@/domain/import';

export type DraftRecord = ImportedRecord & { key: string };
export type IntakeDraft = {
  requestId: string;
  customer: string;
  title: string;
  invoiceId: string;
  records: DraftRecord[];
  removed: { record: DraftRecord; index: number } | null;
  review: boolean;
  uncertain: boolean;
  checkedQueue: boolean;
};
type Store = {
  read: (scope: string) => IntakeDraft | undefined;
  save: (scope: string, draft: IntakeDraft) => void;
  clear: (scope: string) => void;
};
const DraftContext = createContext<Store | null>(null);

export function createIntakeDraftStore(): Store {
  let saved: { scope: string; draft: IntakeDraft } | null = null;
  return {
    read: (scope) => (saved?.scope === scope ? saved.draft : undefined),
    save: (scope, draft) => {
      saved = { scope, draft };
    },
    clear: (scope) => {
      if (saved?.scope === scope) saved = null;
    },
  };
}

export function IntakeDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createIntakeDraftStore);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

export function useIntakeDraftStore() {
  const store = useContext(DraftContext);
  if (!store) throw new Error('Intake draft provider is required');
  return store;
}
