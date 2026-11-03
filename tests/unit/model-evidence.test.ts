import { describe, expect, it } from 'vitest';
import { hash } from '../../src/domain/core';
import { type Evidence, validateFinding } from '../../src/domain/evidence';
import { demoMerchant, demoRaw } from '../../src/domain/fixtures';
import { projectInvoice } from '../../src/domain/invoice';
import {
  modelSources,
  modelFindingSchema,
  resolveModelFinding,
} from '../../src/domain/model-evidence';

const evidence = (text: string, version = 1): Evidence => ({
  id: 'doc-1',
  caseId: 'case-1',
  label: 'Message',
  kind: 'message',
  version,
  hash: hash(text),
  text,
});
const draft = (sourceId = 'S1') => ({
  explanation: 'The supplied message is recorded.',
  citations: [{ sourceId }],
  missing: [],
  decision: { type: 'NONE', issue: 'NO_CHANGE', reviewReasons: [] },
});
const invoice = projectInvoice(demoRaw(), demoMerchant, 'demo');

describe('model source references', () => {
  it('preserves every character and exact offsets without splitting surrogate pairs', () => {
    const text = 'a'.repeat(999) + '😀\r\n' + 'b'.repeat(1700);
    const sources = modelSources([evidence(text)]);
    expect(sources.map((s) => s.quote).join('')).toBe(text);
    for (const source of sources) {
      expect(source.quote.length).toBeLessThanOrEqual(1000);
      expect(source.quote).toBe(text.slice(source.start, source.start + source.quote.length));
      expect(new TextDecoder().decode(new TextEncoder().encode(source.quote))).toBe(source.quote);
    }
  });

  it('bounds metadata growth for many short lines', () => {
    const text = 'x\n'.repeat(8000);
    const sources = modelSources([evidence(text)]);
    expect(sources.length).toBeLessThanOrEqual(32);
    expect(sources.map((s) => s.quote).join('')).toBe(text);
  });

  it('derives versioned citations from the current request and passes the existing guard', () => {
    const doc = evidence('I approve the additional social-media pack for GBP 250.');
    const sources = modelSources([doc]);
    const result = resolveModelFinding(draft(), sources);
    expect(result.citations).toEqual([
      { documentId: doc.id, version: 1, quote: doc.text, start: 0 },
    ]);
    expect(validateFinding(result, 'case-1', [doc], invoice)).toEqual(result);
  });

  it('rejects invented source IDs and model-supplied citation overrides', () => {
    const sources = modelSources([evidence('Original source.')]);
    expect(() => resolveModelFinding(draft('S999'), sources)).toThrow();
    expect(() =>
      modelFindingSchema(sources).parse({
        ...draft(),
        citations: [
          {
            sourceId: 'S1',
            documentId: 'another-case',
            version: 99,
            quote: 'invented',
            start: 0,
          },
        ],
      }),
    ).toThrow();
  });

  it('keeps stale-version and cross-case rejection in the existing guard', () => {
    const doc = evidence('Original source.');
    const result = resolveModelFinding(draft(), modelSources([doc]));
    expect(() => validateFinding(result, 'case-1', [evidence(doc.text, 2)], invoice)).toThrow();
    expect(() => validateFinding(result, 'another-case', [doc], invoice)).toThrow();
  });

  it('keeps source indexes isolated between requests and refuses an empty index', () => {
    const first = modelSources([evidence('First source.')]);
    const second = modelSources([evidence('Second source.', 2)]);
    expect(resolveModelFinding(draft(), first).citations[0].quote).toBe('First source.');
    expect(resolveModelFinding(draft(), second).citations[0].version).toBe(2);
    expect(() => modelFindingSchema([])).toThrow();
  });

  it('rejects a proposal with review blockers instead of silently discarding blockers', () => {
    const sources = modelSources([evidence('Let me check before adding that extra.')]);
    const decision = { type: 'REMOVE_ITEM', issue: 'QUESTIONED_CHARGE', lineId: 'social-pack' };
    expect(() =>
      resolveModelFinding(
        { ...draft(), decision: { ...decision, reviewReasons: ['Conflict.'] } },
        sources,
      ),
    ).toThrow();
    expect(() =>
      resolveModelFinding({ ...draft(), decision: { ...decision, issue: 'CONFLICT' } }, sources),
    ).toThrow();
    const result = resolveModelFinding({ ...draft(), decision }, sources);
    expect(result.reviewReasons).toEqual([]);
    expect(() =>
      validateFinding(result, 'case-1', [evidence('Let me check before adding that extra.')], {
        ...invoice,
        payment: 'PAID',
      }),
    ).toThrow();
  });
});
