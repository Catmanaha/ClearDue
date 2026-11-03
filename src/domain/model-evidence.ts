import { z } from 'zod';
import { DomainError } from './core';
import { findingSchema, type Evidence, type Finding } from './evidence';

export type SourceSpan = Readonly<{
  sourceId: string;
  documentId: string;
  version: number;
  quote: string;
  start: number;
}>;

/** Complete, bounded source spans. Offsets are measured by code, never by the model. */
export function modelSources(docs: Evidence[]): SourceSpan[] {
  const sources: SourceSpan[] = [];
  for (const doc of docs) {
    for (let start = 0; start < doc.text.length;) {
      let end = Math.min(start + 1000, doc.text.length);
      if (end < doc.text.length) {
        const newline = doc.text.lastIndexOf('\n', end - 1);
        if (newline >= start + 500) end = newline + 1;
        const before = doc.text.charCodeAt(end - 1);
        const after = doc.text.charCodeAt(end);
        if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
      }
      sources.push(
        Object.freeze({
          sourceId: `S${sources.length + 1}`,
          documentId: doc.id,
          version: doc.version,
          quote: doc.text.slice(start, end),
          start,
        }),
      );
      start = end;
    }
  }
  return sources;
}

export function modelFindingSchema(sources: readonly SourceSpan[]) {
  if (!sources.length) throw new DomainError('EVIDENCE', 'Supply source text before analysis.');
  return findingSchema
    .omit({ citations: true, issue: true, action: true, reviewReasons: true })
    .extend({
      decision: z.discriminatedUnion('type', [
        z
          .object({
            type: z.literal('REMOVE_ITEM'),
            issue: z.literal('QUESTIONED_CHARGE'),
            lineId: z.string(),
          })
          .strict(),
        z
          .object({
            type: z.literal('SET_REFERENCE'),
            issue: z.literal('MISSING_REFERENCE'),
            reference: z.string().min(1).max(120),
          })
          .strict(),
        z
          .object({
            type: z.literal('NONE'),
            issue: findingSchema.shape.issue,
            reviewReasons: findingSchema.shape.reviewReasons,
          })
          .strict(),
      ]),
      citations: z
        .array(
          z
            .object({
              sourceId: z.enum(sources.map((s) => s.sourceId) as [string, ...string[]]),
            })
            .strict(),
        )
        .max(12),
    });
}

/** Resolve only this request's allowlisted sources, then retain normal finding validation. */
export function resolveModelFinding(value: unknown, sources: readonly SourceSpan[]): Finding {
  const { decision, ...parsed } = modelFindingSchema(sources).parse(value);
  return {
    ...parsed,
    issue: decision.issue,
    action:
      decision.type === 'REMOVE_ITEM'
        ? { type: decision.type, lineId: decision.lineId }
        : decision.type === 'SET_REFERENCE'
          ? { type: decision.type, reference: decision.reference }
          : { type: 'NONE' },
    reviewReasons: decision.type === 'NONE' ? decision.reviewReasons : [],
    citations: parsed.citations.map(({ sourceId }) => {
      const source = sources.find((s) => s.sourceId === sourceId);
      if (!source) throw new DomainError('CITATION', 'Unknown source reference.');
      return {
        documentId: source.documentId,
        version: source.version,
        quote: source.quote,
        start: source.start,
      };
    }),
  };
}
