import { mkdir, writeFile } from 'node:fs/promises';
import { demoRaw, demoMerchant } from '../src/domain/fixtures';
import { projectInvoice } from '../src/domain/invoice';
import { modelSources, modelFindingSchema } from '../src/domain/model-evidence';
import { DomainError } from '../src/domain/core';
import { liveLimits } from '../src/server/config';
import { pool, closeDb } from '../src/server/db';
import { investigateLive, INSTRUCTIONS, PROMPT_VERSION } from '../src/server/investigator';
import { freshApproval, freshApprovalDocuments } from './fixtures/fresh-approval';

const args = process.argv.slice(2);
if (args.some((arg) => !['--plan', '--run'].includes(arg)) || args.length > 1)
  throw new Error('Use --plan (no inference) or --run (one capped live call).');
try {
  const limits = liveLimits();
  const docs = freshApprovalDocuments();
  const invoice = projectInvoice(demoRaw(), demoMerchant, 'demo');
  const sources = modelSources(docs);
  const bundle = JSON.stringify({ documents: docs, invoice, sourceSpans: sources });
  const requiredTokens =
    Buffer.byteLength(
      bundle + INSTRUCTIONS + JSON.stringify(modelFindingSchema(sources).toJSONSchema()),
    ) +
    1024 +
    limits.output;
  const { rows } = await pool().query<{ calls: number; tokens: number }>(
    "SELECT calls,tokens FROM ai_budget WHERE day=(now() AT TIME ZONE 'UTC')::date",
  );
  const used = rows[0] ?? { calls: 0, tokens: 0 };
  const plan = {
    id: freshApproval.id,
    expectedIssue: freshApproval.expectedIssue,
    expectedAction: freshApproval.expectedAction,
    provider: limits.provider,
    requestedModel: limits.model,
    promptVersion: PROMPT_VERSION,
    requiredCalls: 1,
    requiredReservedTokens: requiredTokens,
    remainingCalls: limits.calls - used.calls,
    remainingReservedTokens: limits.tokens - used.tokens,
    fits: used.calls < limits.calls && used.tokens + requiredTokens <= limits.tokens,
  };
  console.log(JSON.stringify({ phase: 'plan', ...plan, providerCallsMade: 0 }));
  if (args[0] !== '--run') {
    if (!plan.fits) process.exitCode = 1;
  } else {
    if (!plan.fits)
      throw new DomainError('AI_BUDGET', 'Fresh case does not fit the approved allowance.');
    await mkdir('.local', { recursive: true });
    const path = `.local/fresh-approval-v1-${Date.now()}.json`;
    const startedAt = new Date().toISOString();
    await writeFile(path, JSON.stringify({ plan, startedAt, status: 'PLANNED' }, null, 2));
    const started = performance.now();
    try {
      const result = await investigateLive(freshApproval.id, docs, invoice);
      const issueCorrect = result.finding.issue === freshApproval.expectedIssue;
      const actionCorrect = result.finding.action.type === freshApproval.expectedAction;
      await writeFile(
        path,
        JSON.stringify(
          {
            plan,
            startedAt,
            latencyMs: Math.round(performance.now() - started),
            issueCorrect,
            actionCorrect,
            finding: result.finding,
            usage: result.usage,
            semanticSupport: 'REQUIRES_HUMAN_REVIEW',
            status:
              issueCorrect && actionCorrect ? 'LABELS_MATCH_REVIEW_REQUIRED' : 'LABEL_MISMATCH',
          },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          phase: 'result',
          id: plan.id,
          providerCallsMade: 1,
          issueCorrect,
          actionCorrect,
          report: path,
          semanticSupport: 'REQUIRES_HUMAN_REVIEW',
        }),
      );
      if (!issueCorrect || !actionCorrect) process.exitCode = 1;
    } catch (error) {
      await writeFile(
        path,
        JSON.stringify(
          {
            plan,
            startedAt,
            status: 'FAILED',
            code: error instanceof DomainError ? error.code : 'UNEXPECTED',
          },
          null,
          2,
        ),
      );
      throw new Error('Fresh evaluation failed; inspect the private report. No automatic retry.');
    }
  }
} finally {
  await closeDb();
}
