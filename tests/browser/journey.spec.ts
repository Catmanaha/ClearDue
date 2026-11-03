import { test, expect } from '@playwright/test';
import { fixtures } from '../../src/domain/fixtures';
import { money } from '../../src/lib/format';

test('unsaved intake survives in-app navigation without submitting or writing browser storage', async ({
  page,
}) => {
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/cases')) posts++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New case', exact: true }).click();
  await page.getByLabel('Customer', { exact: true }).fill('Private draft navigation example');
  await page.getByLabel('Case title', { exact: true }).fill('Keep my unsaved records');
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Case queue', exact: true }).click();
  await expect(page.getByLabel('Customer', { exact: true })).toHaveValue(
    'Private draft navigation example',
  );
  await expect(page.getByLabel('Case title', { exact: true })).toHaveValue(
    'Keep my unsaved records',
  );
  await expect(
    page.getByText('Your unsaved draft is back. Nothing has been submitted automatically.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
        'Private draft navigation example',
      ),
    ),
  ).toBe(false);
  expect(posts).toBe(0);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Discard this draft', exact: true }).click();
  await expect(page.getByLabel('Customer', { exact: true })).toHaveValue('');
});

test('unconfirmed dashboard save pauses changes and recovers with GET only', async ({ page }) => {
  await page.goto('/analytics');
  const original = await (await page.request.get('/api/dashboard')).json();
  let posts = 0;
  await page.route('**/api/dashboard', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      const saved = await route.fetch();
      expect(saved.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  const target = original.view.filter === 'manual-review' ? 'all' : 'manual-review';
  try {
    await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption(target);
    await expect(page.locator('.notice.error')).toContainText('could not confirm');
    await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Reload saved view', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toHaveValue(target);
    expect(posts).toBe(1);
  } finally {
    const restored = await page.request.post('/api/dashboard', {
      headers: { origin: 'http://127.0.0.1:3100' },
      data: original.view,
    });
    expect(restored.status()).toBe(200);
  }
});

test('connections uses everyday language and keeps technical instructions opt-in', async ({
  page,
}, info) => {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(page.getByText('Demo · no real money', { exact: true })).toBeVisible();
  await expect(page.getByText('Local demo access', { exact: true })).toBeVisible();
  await expect(page.getByText('Example analysis · no AI', { exact: true }).first()).toBeVisible();
  const details = page.locator('details.connection-technical');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByText('docker compose up -d db', { exact: true })).not.toBeVisible();
  await expect(page.getByText('LIVE_AI_ENABLED', { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath('connections-desktop.png'), fullPage: true });
  const summary = page.getByText('Technical details for workspace administrators', { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('docker compose up -d db', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('docker compose up -d db', { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('connections-mobile.png'), fullPage: true });
});
test('owner reviews evidence, explicitly approves, customer pays in demo, outcomes stay separate', async ({
  page,
  request,
}, testInfo) => {
  const fixture = fixtures()[0];
  const baselineResponse = await request.get('/api/dashboard');
  expect(baselineResponse.ok()).toBe(true);
  const baseline = await baselineResponse.json();
  const previousPaid = baseline.rows.reduce(
    (sum: number, row: { paidPence: number }) => sum + row.paidPence,
    0,
  );
  const previousRemoved = baseline.rows.reduce(
    (sum: number, row: { removedPence: number }) => sum + row.removedPence,
    0,
  );
  const runtimeErrors: string[] = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  const create = await request.post('/api/cases', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: {
      customer: 'Browser test · Juniper',
      title: 'A questioned extra',
      documents: fixture.docs.map(({ label, kind, text }) => ({ label, kind, text })),
    },
  });
  expect(create.status()).toBe(201);
  const { id } = await create.json();
  await page.goto(`/cases/${id}`);
  await expect(page.getByRole('heading', { name: 'A questioned extra' })).toBeVisible();
  await page.getByRole('button', { name: 'Investigate this case' }).click();
  await expect(
    page.getByRole('heading', { name: 'The extra needs a conversation.' }),
  ).toBeVisible();
  await page.locator('.citation').last().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#source-text')).toBeFocused();
  await expect(page.locator('#source-text mark')).toHaveText(
    'Let me check with my business partner before we add that.',
  );
  const approve = page.getByRole('button', { name: 'Approve this correction' });
  await expect(approve).toBeDisabled();
  await page.getByRole('checkbox', { name: /I explicitly select/ }).check();
  await page.getByRole('checkbox', { name: /I reviewed the exact sources/ }).check();
  await approve.click();
  await expect(
    page.getByRole('heading', { name: 'A clearer invoice. A better next step.' }),
  ).toBeVisible();
  await expect(page.locator('.invoice-total')).toContainText('£1,000.00');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('workbench-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create customer link' }).click();
  const link = await page
    .getByRole('link', { name: 'Open customer resolution' })
    .getAttribute('href');
  expect(link).toContain('/r#');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy customer link', exact: true }).click();
  await expect(page.getByText('Link copied. It is ready to share.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await page.getByRole('button', { name: 'Copy customer link', exact: true }).click();
  await expect(
    page.getByText('Open the customer view and copy its address to share the link.', {
      exact: true,
    }),
  ).toBeVisible();

  await page.goto(link!);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Let’s get this invoice right.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'This still looks wrong' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('customer-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'This still looks wrong' }).click();
  await page
    .getByLabel('What should the studio look at?')
    .fill('Please confirm the final landing-page scope.');
  await page.getByRole('button', { name: 'Save feedback for the studio' }).click();
  await expect(page.getByText('Your feedback is saved for the studio.')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate demo buyer payment' }).click();
  await expect(async () => {
    await page.getByRole('button', { name: 'Check payment status' }).click();
    await expect(page.getByRole('heading', { name: 'All settled. Thank you.' })).toBeVisible();
  }).toPass({ timeout: 15000, intervals: [1000, 2000] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/analytics');
  await expect(page.getByText('AG Studio unlicensed evaluation.', { exact: false })).toBeVisible();
  await expect(
    page.locator('.studio-surface').getByRole('heading', { name: 'Evidence comparison' }),
  ).toBeVisible();
  await expect(
    page.locator('.studio-surface').getByRole('heading', { name: 'Resolution outcomes' }),
  ).toBeVisible();
  const afterResponse = await request.get('/api/dashboard');
  const after = await afterResponse.json();
  expect(after.rows.find((r: { id: string }) => r.id === id)).toMatchObject({
    totalPence: 100000,
    paidPence: 100000,
    removedPence: 25000,
    duePence: 0,
    payment: 'PAID',
    environment: 'demo',
  });
  await expect(page.locator('.outcome-ledger > div').nth(0)).toContainText(
    money(previousPaid + 100000),
  );
  await expect(page.locator('.outcome-ledger > div').nth(1)).toContainText(
    money(previousRemoved + 25000),
  );
  expect(
    await page
      .locator('.studio-surface .custom-widget')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(650);
  await expect(page.locator('.studio-surface')).toContainText(
    'Let me check with my business partner',
  );
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
});
test('API rejects origin forgery, financial-tool forgery and invalid customer grants', async ({
  request,
  page,
}) => {
  const forbidden = await request.post('/api/cases/case-1', {
    headers: { origin: 'https://evil.example' },
    data: { action: 'approve', proposalId: 'forged', sourceSupportReviewed: true },
  });
  expect(forbidden.status()).toBe(403);
  const forged = await request.post('/api/studio/model', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: { tools: [{ name: 'execute_invoice' }] },
  });
  expect(forged.ok()).toBe(false);
  const invalid = await request.get('/api/customer', {
    headers: { Authorization: 'Bearer invented' },
  });
  expect(invalid.status()).toBe(404);
  await page.goto('/r#invalid');
  await expect(page.locator('.notice.error[role="alert"]')).toContainText('invalid or expired');
});
test('approval counterexample, empty queue and mobile workbench remain usable', async ({
  page,
}, testInfo) => {
  await page.goto('/cases/case-2');
  const button = page.getByRole('button', { name: 'Investigate this case' });
  if (await button.isVisible()) await button.click();
  await expect(
    page.getByRole('heading', { name: 'The customer approved this extra.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this correction' })).toHaveCount(0);
  await page.locator('.source-tabs button').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.source-tabs button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('workbench-mobile.png'), fullPage: true });
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('queue-desktop.png'), fullPage: true });
  await page.getByLabel('Find a case').fill('No such synthetic customer');
  await expect(page.locator('.search')).toHaveCSS('outline-style', 'solid');
  await expect(page.getByRole('heading', { name: 'No matching conversations.' })).toBeVisible();
});

test('changing widget order preserves the mounted Studio widgets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/analytics');
  const evidence = page.getByRole('heading', { name: 'Evidence comparison', exact: true });
  const outcomes = page.getByRole('heading', { name: 'Resolution outcomes', exact: true });
  await expect(evidence).toBeVisible();
  const original = await evidence.elementHandle();
  if (!original) throw new Error('Evidence widget did not mount.');
  for (const layout of ['outcomes-first', 'evidence-first']) {
    await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption(layout);
    await expect(page.getByRole('combobox', { name: 'Layout', exact: true })).toHaveValue(layout);
    await expect
      .poll(async () => {
        const left = await evidence.boundingBox();
        const right = await outcomes.boundingBox();
        return (
          !!left && !!right && (layout === 'evidence-first' ? left.x < right.x : right.x < left.x)
        );
      })
      .toBe(true);
    expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await expect
    .poll(async () => {
      const first = await evidence.boundingBox();
      const second = await outcomes.boundingBox();
      return (
        !!first &&
        !!second &&
        first.x >= 0 &&
        second.x >= 0 &&
        first.x + first.width <= 320 &&
        second.x + second.width <= 320 &&
        second.y > first.y
      );
    })
    .toBe(true);
  await expect(
    page.getByText('Scroll the table sideways to see more columns.', { exact: true }),
  ).toBeVisible();
  for (const amount of await page.locator('.studio-surface .outcome-ledger dd').all()) {
    const bounds = await amount.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect
    .poll(async () => {
      const first = await evidence.boundingBox();
      const second = await outcomes.boundingBox();
      return !!first && !!second && first.x < second.x && Math.abs(first.y - second.y) < 2;
    })
    .toBe(true);
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
});

test('intake keeps separate records, preserves a hidden draft and recovers from rejection', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New case', exact: true }).click();
  await page.getByLabel('Customer', { exact: true }).fill('Intake test · Juniper');
  await page.getByLabel('Case title', { exact: true }).fill('Separate source intake');
  const docs = fixtures()[0].docs.map(({ label, kind, text }) => ({ label, kind, text }));
  await page.getByLabel('Or add records from files').setInputFiles({
    name: 'records.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(docs)),
  });
  await expect(page.locator('.intake-record')).toHaveCount(docs.length);
  await page.getByRole('button', { name: 'Hide draft' }).click();
  await expect(page.locator('#case-intake')).toBeHidden();
  await page.getByRole('button', { name: 'New case', exact: true }).click();
  await expect(page.getByLabel('Customer', { exact: true })).toHaveValue('Intake test · Juniper');
  await expect(page.getByLabel('Complete text').first()).toHaveValue(docs[0].text);
  await page.getByRole('button', { name: 'Remove record 2', exact: true }).click();
  await page.getByRole('button', { name: 'Undo removal' }).click();
  await expect(page.getByLabel('Complete text').nth(1)).toHaveValue(docs[1].text);
  await page.getByLabel('Or add records from files').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('[{"label":"bad"}]'),
  });
  await expect(page.locator('.notice.error')).toContainText('Record');
  await expect(page.locator('.intake-record')).toHaveCount(docs.length);
  await page.getByRole('button', { name: 'Review records', exact: true }).click();
  await expect(page.locator('.intake-preview pre')).toHaveText(docs.map((d) => d.text));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('intake-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('intake-mobile.png'), fullPage: true });
  await page.route(
    '**/api/cases',
    (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Complete bundle exceeds the supported limit.' }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('Your draft is still here');
  await page.getByRole('button', { name: 'Edit records', exact: true }).click();
  await expect(page.getByLabel('Complete text').nth(1)).toHaveValue(docs[1].text);
  await page.getByRole('button', { name: 'Review records', exact: true }).click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/cases') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await expect(page).toHaveURL(new RegExp(`/cases/${id}$`));
  await expect(
    page.getByRole('heading', { name: 'Separate source intake', exact: true }),
  ).toBeVisible();
  // The actual persisted records, not the preview, must preserve provenance and complete text.
  const stored = await page.request.get(`/api/cases/${id}`);
  const data = await stored.json();
  expect(
    data.docs.map(({ label, kind, text }: { label: string; kind: string; text: string }) => ({
      label,
      kind,
      text,
    })),
  ).toEqual(expect.arrayContaining(docs));
  expect(data.docs).toHaveLength(docs.length);
  expect(data.runs).toHaveLength(0);
  expect(data.commands).toHaveLength(0);
});

test('intake pauses a lost-response submission instead of blindly retrying', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New case', exact: true }).click();
  await page.getByLabel('Customer', { exact: true }).fill('Lost-response test');
  await page.getByLabel('Case title', { exact: true }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Add record', exact: true }).click();
  await page.getByLabel('Record name', { exact: true }).fill('Agreement');
  await page.getByLabel('Complete text').fill('The complete agreement.');
  await page.getByRole('button', { name: 'Review records', exact: true }).click();
  let posts = 0;
  await page.route('**/api/cases', async (route) => {
    posts++;
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText(
    'could not confirm whether the case was saved',
  );
  await expect(page.getByRole('button', { name: 'Create case', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Check case queue in a new tab' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(page.locator('.intake-preview pre')).toHaveText('The complete agreement.');
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByRole('link', { name: 'Case queue', exact: true }).click();
  await expect(page.locator('.intake-preview pre')).toHaveText('The complete agreement.');
  await expect(page.getByRole('button', { name: 'Create case', exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
});

test('later approval changes the conclusion while earlier evidence and history remain available', async ({
  page,
  request,
}, testInfo) => {
  const response = await request.post('/api/cases', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: {
      customer: 'Chronology walkthrough',
      title: 'Later approval changes the next step',
      documents: fixtures()[0].docs.map(({ label, kind, text }) => ({ label, kind, text })),
    },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page.goto(`/cases/${id}`);
  await page.getByRole('button', { name: 'Investigate this case', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'The extra needs a conversation.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cited records' })).toBeVisible();
  await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await page.getByLabel('Source label').fill('Later explicit approval');
  await page
    .getByLabel('Complete source text')
    .fill('I approve the additional social-media pack for GBP 250.');
  await page.getByRole('button', { name: 'Hide evidence draft' }).click();
  await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await expect(page.getByLabel('Complete source text')).toHaveValue(
    'I approve the additional social-media pack for GBP 250.',
  );
  await page.getByRole('button', { name: 'Save evidence & investigate', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'The customer approved this extra.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve this correction', exact: true }),
  ).toHaveCount(0);
  await page.getByText('Earlier investigations (1 shown)', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Earlier conclusion' })).toBeVisible();
  await page.locator('.previous-investigations .citation').last().click();
  await expect(page.locator('#source-text mark')).toHaveText(
    'Let me check with my business partner before we add that.',
  );
  await expect(page.locator('.audit-section')).toContainText('Evidence added');
  await expect(page.locator('.audit-section')).toContainText('Investigation completed');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('evidence-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('evidence-mobile.png'), fullPage: true });
  const stored = await (await request.get(`/api/cases/${id}`)).json();
  expect(stored.runs).toHaveLength(2);
  expect(stored.docs).toHaveLength(4);
  expect(stored.commands).toHaveLength(0);
  expect(stored.proposals.every((proposal: { state: string }) => proposal.state === 'STALE')).toBe(
    true,
  );
});

test('Studio widgets keep uninvestigated cases visible and persist bounded exploration filters', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/analytics');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all');
  const baseline = await (await request.get('/api/dashboard')).json();
  await expect(page.locator('.studio-surface .comparison-row')).toHaveCount(baseline.rows.length);
  for (const filter of ['needs-evidence', 'confirmed-outcomes']) {
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/dashboard') && response.request().method() === 'POST',
    );
    await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption(filter);
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByText('Presentation saved. Invoice state is unchanged.', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toHaveValue(filter);
    const latest = await (await request.get('/api/dashboard')).json();
    expect(latest.view.filter).toBe(filter);
    const expected = baseline.rows.filter(
      (r: { needsEvidence: boolean; payment: string; removedPence: number }) =>
        filter === 'needs-evidence' ? r.needsEvidence : r.payment === 'PAID' || r.removedPence > 0,
    );
    await expect(page.locator('.studio-surface .comparison-row')).toHaveCount(expected.length);
    for (const row of expected)
      await expect(
        page
          .locator('.studio-surface .comparison-row')
          .getByRole('link', { name: row.title, exact: true })
          .and(page.locator(`a[href="/cases/${row.id}"]`)),
      ).toBeVisible();
    expect(latest.rows).toEqual(baseline.rows);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('studio-outcomes.png'), fullPage: true });
  const reset = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/dashboard') && response.request().method() === 'POST',
  );
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all');
  expect((await reset).status()).toBe(200);
});

test('accepted investigation with failed view refresh recovers through GET without another POST', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/cases', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: {
      customer: 'Recovery walkthrough',
      title: 'Confirmed action and failed refresh',
      documents: fixtures()[0].docs.map(({ label, kind, text }) => ({ label, kind, text })),
    },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page.goto(`/cases/${id}`);
  let posts = 0;
  await page.route(`**/api/cases/${id}`, async (route) => {
    if (route.request().method() === 'GET')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Read unavailable' }),
      });
    else {
      posts++;
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Investigate this case', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('Your action was accepted');
  await expect(
    page.getByRole('button', { name: 'Investigate this case', exact: true }),
  ).toBeDisabled();
  await page.unroute(`**/api/cases/${id}`);
  await page.getByRole('button', { name: 'Reload saved case', exact: true }).click();
  await expect(
    page.getByText('Saved case reloaded. Review its current state before continuing.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.notice.error')).toHaveCount(0);
  expect(posts).toBe(1);
});

test('customer retries initial failure, preserves feedback draft and clears recovered refresh errors', async ({
  page,
  request,
}, testInfo) => {
  const response = await request.post('/api/cases/case-2', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: {
      action: 'clarification-grant',
      explanation: 'Please clarify the approved scope.',
      invoiceHash: (await (await request.get('/api/cases/case-2')).json()).case.invoice.fingerprint,
      evidenceHash: (await (await request.get('/api/cases/case-2')).json()).evidenceHash,
      reviewed: true,
    },
  });
  expect(response.status()).toBe(200);
  const { url } = await response.json();
  await page.route(
    '**/api/customer',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Connection interrupted.' }),
      }),
    { times: 1 },
  );
  await page.goto(url);
  await page.getByRole('button', { name: 'Try opening again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Let’s get this invoice right.' })).toBeVisible();
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await page.getByRole('button', { name: 'This still looks wrong', exact: true }).click();
  await page.getByLabel('What should the studio look at?').fill('Please check the later approval.');
  await page.getByRole('button', { name: 'This still looks wrong', exact: true }).click();
  await page.getByRole('button', { name: 'This still looks wrong', exact: true }).click();
  await expect(page.getByLabel('What should the studio look at?')).toHaveValue(
    'Please check the later approval.',
  );
  await page.route(
    '**/api/customer',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Refresh interrupted.' }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('Refresh interrupted.');
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await expect(page.getByLabel('What should the studio look at?')).toHaveValue(
    'Please check the later approval.',
  );
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('customer-recovery-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save feedback for the studio', exact: true }).click();
  await expect(
    page.getByText(
      'Your feedback is saved for the studio. No payment or invoice change was made.',
      { exact: true },
    ),
  ).toBeVisible();
  const beforeReview = await (await request.get('/api/cases/case-2')).json();
  const reply = beforeReview.customerFeedback.find(
    (item: { message: string }) => item.message === 'Please check the later approval.',
  );
  expect(reply.reviewedAt).toBeNull();
  const wrongCase = await request.post('/api/cases/case-1', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: { action: 'review-feedback', feedbackId: reply.id },
  });
  expect(wrongCase.status()).toBe(404);
  await page.goto('/');
  await page.getByRole('button', { name: 'Customer replies', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Marlow Goods' });
  await expect(row).toContainText('1 new customer reply');
  await row.getByRole('link', { name: 'Read reply', exact: true }).click();
  const message = page
    .getByRole('listitem')
    .filter({ hasText: 'Please check the later approval.' });
  await message.getByRole('button', { name: 'Mark reply reviewed', exact: true }).click();
  await expect(message).toContainText('Reviewed');
  const afterReview = await (await request.get('/api/cases/case-2')).json();
  expect(
    afterReview.customerFeedback.find((item: { id: string }) => item.id === reply.id).reviewedAt,
  ).toBeTruthy();
  expect(afterReview.case.invoice).toEqual(beforeReview.case.invoice);
  expect(afterReview.commands).toEqual(beforeReview.commands);
  await page.goto('/');
  await page.getByRole('button', { name: 'Customer replies', exact: true }).click();
  await expect(row).toHaveCount(0);
});

test('Studio case grid links keyboard selection to evidence, paired correction and payment trail', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/analytics');
  await page
    .getByRole('combobox', { name: 'Show', exact: true })
    .selectOption('confirmed-outcomes');
  const baseline = await (await request.get('/api/dashboard')).json();
  const grid = page.getByRole('region', { name: 'Read-only case explorer' });
  await expect(
    grid.getByRole('heading', { name: 'Follow a case from evidence to outcome.' }),
  ).toBeVisible();
  const first = grid.getByRole('button').first();
  await expect(first).toBeVisible();
  const id = await first.getAttribute('data-case-id');
  const expected = baseline.rows.find((row: { id: string }) => row.id === id);
  expect(expected).toBeTruthy();
  await first.focus();
  await page.keyboard.press('Enter');
  const summary = page.getByRole('region', {
    name: 'Financial summary for the current view',
    exact: true,
  });
  await expect(
    page
      .locator('.studio-surface')
      .getByRole('button', { name: 'widgetToolbarDelete', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.studio-surface')
      .getByRole('button', { name: 'widgetToolbarDuplicate', exact: true }),
  ).toHaveCount(0);
  await expect(summary).toContainText(`Selected case: ${expected.title}`);
  await expect(summary.locator('dd').nth(0)).toHaveText(money(expected.paidPence));
  await expect(summary.locator('dd').nth(1)).toHaveText(money(expected.removedPence));
  await expect(summary.locator('dd').nth(2)).toHaveText(money(expected.duePence));
  const trail = page.getByRole('region', { name: 'Evidence to outcome trail' });
  await expect(trail.getByRole('heading', { name: expected.title, exact: true })).toBeVisible();
  await expect(trail).toContainText('Example analysis');
  await expect(trail).toContainText('Correction verified');
  await expect(trail).toContainText('Payment observation');
  await expect(page.locator('.outcome-ledger > div').first()).toContainText(
    money(expected.paidPence),
  );
  await expect(page.locator('.outcome-ledger > div').nth(1)).toContainText(
    money(expected.removedPence),
  );
  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('outcomes-first');
  await expect(trail).toContainText(expected.customer);
  expect((await (await request.get('/api/dashboard')).json()).rows).toEqual(baseline.rows);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('studio-linked-trail.png'), fullPage: true });
  if (expected.citations.length) {
    await trail.getByRole('link', { name: /Read cited quote 1/ }).click();
    const doc = (await (await request.get(`/api/cases/${id}`)).json()).docs.find(
      (record: { id: string }) => record.id === expected.citations[0].documentId,
    );
    await expect(page.locator('#source-text')).toContainText(doc.text);
    await expect(page.locator('#source-text mark')).toHaveText(expected.citations[0].quote);
    await expect(page.locator('#source-text')).toBeFocused();
  }
  await page.goto('/analytics');
  const reset = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/dashboard') && response.request().method() === 'POST',
  );
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all');
  expect((await reset).status()).toBe(200);
});
