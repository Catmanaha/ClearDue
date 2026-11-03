import { mkdir, writeFile } from 'node:fs/promises';
import { fixtures, demoRaw, demoMerchant } from '../src/domain/fixtures';
import { projectInvoice } from '../src/domain/invoice';
import { investigateLive, PROMPT_VERSION } from '../src/server/investigator';
import { liveLimits } from '../src/server/config';
import { closeDb } from '../src/server/db';
import { DomainError } from '../src/domain/core';
const limits = liveLimits(); // Fails before a call if any flag, credential, model or user budget is absent.
const invoice = projectInvoice(demoRaw(), demoMerchant, 'demo');
const evaluationFixtures = fixtures().filter((f) => f.split === 'held-out');
const results = [];
try {
  for (const fixture of evaluationFixtures) {
    const started = performance.now();
    try {
      const result = await investigateLive(fixture.id, fixture.docs, invoice);
      results.push({
        id: fixture.id,
        label: fixture.kind,
        model: limits.model,
        promptVersion: PROMPT_VERSION,
        latencyMs: Math.round(performance.now() - started),
        usage: result.usage,
        issueCorrect: result.finding.issue === fixture.expected,
        actionCorrect: result.finding.action.type === fixture.action,
        finding: result.finding,
        semanticSupport: 'REQUIRES_HUMAN_REVIEW',
      });
    } catch (e) {
      results.push({
        id: fixture.id,
        error: e instanceof Error ? e.message : 'Live evaluation failed',
        model: limits.model,
        promptVersion: PROMPT_VERSION,
      });
      // Record rejected proposals independently; stop on provider/config/budget failures.
      if (
        !(e instanceof DomainError) ||
        !['CITATION', 'REVIEW', 'REFERENCE', 'LINE'].includes(e.code)
      )
        break;
    }
  }
  const complete =
    results.length === evaluationFixtures.length && !results.some((r) => 'error' in r);
  if (!complete) process.exitCode = 1;
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/live-evaluation.json',
    JSON.stringify(
      {
        provenance: 'live-model',
        provider: limits.provider,
        requestedModel: limits.model,
        datasetVersion: 'synthetic-v1',
        outcome: complete ? 'COMPLETED_REQUIRES_REVIEW' : 'INCOMPLETE',
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `Recorded ${results.length} attempted live evaluations privately. Review semantic support before publishing any accuracy claim.`,
  );
} finally {
  await closeDb();
}
