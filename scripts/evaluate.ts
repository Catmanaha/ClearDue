import { writeFile, mkdir } from 'node:fs/promises';
import { fixtures, demoRaw, demoMerchant } from '../src/domain/fixtures';
import { projectInvoice } from '../src/domain/invoice';
import { investigateFixture, validateFinding } from '../src/domain/evidence';
import { PROMPT_VERSION } from '../src/server/investigator';
import { rubricSupport } from '../src/domain/evaluation';
const invoice = projectInvoice(demoRaw(), demoMerchant, 'demo');
const results = fixtures().map((f) => {
  const result = investigateFixture(f.id, f.docs, invoice);
  let referencesValid = true;
  try {
    validateFinding(result, f.id, f.docs, invoice);
  } catch {
    referencesValid = false;
  }
  const support = rubricSupport(f, result);
  return {
    id: f.id,
    label: f.kind,
    split: f.split,
    issueCorrect: result.issue === f.expected,
    financialActionCorrect: result.action.type === f.action,
    referencesValid,
    rubricSupportCheck: support,
    abstentionCorrect: f.action !== 'NONE' || result.action.type === 'NONE',
  };
});
await mkdir('docs/evaluation', { recursive: true });
await writeFile(
  'docs/evaluation/fixture-results.json',
  JSON.stringify(
    {
      provenance: 'fixture-rules',
      model: null,
      promptVersion: PROMPT_VERSION,
      datasetVersion: 'synthetic-v1',
      warning:
        '24 templated cases from six scenario families; held-out variants are header variations, not independent production validation. Hand-labelled quote-support rubric is specific to these synthetic families; not a general semantic judge.',
      results,
    },
    null,
    2,
  ) + '\n',
);
const failed = results.filter(
  (r) =>
    !r.issueCorrect ||
    !r.financialActionCorrect ||
    !r.referencesValid ||
    !r.rubricSupportCheck ||
    !r.abstentionCorrect,
);
console.log(
  `Fixture rules: ${results.length - failed.length}/${results.length} labeled cases passed. Model calls: 0. Held-out header variants: ${results.filter((r) => r.split === 'held-out').length}.`,
);
if (failed.length) process.exitCode = 1;
