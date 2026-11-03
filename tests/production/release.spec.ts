import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fixtures } from '../../src/domain/fixtures';
const origin = 'http://127.0.0.1:3100';
const test = base.extend<
  Record<never, never>,
  { ownerState: Awaited<ReturnType<APIRequestContext['storageState']>> }
>({
  ownerState: [
    async ({ playwright }, provide) => {
      const credentials = JSON.parse(
        await readFile('.local/production-test/credentials.json', 'utf8'),
      );
      const session = await playwright.request.newContext({ baseURL: origin });
      const login = await session.post('/api/auth/sign-in/email', {
        headers: { origin },
        data: credentials,
      });
      expect(login.status()).toBe(200);
      await provide(await session.storageState());
      await session.dispose();
    },
    { scope: 'worker' },
  ],
  storageState: async ({ ownerState }, provide) => {
    await provide(ownerState);
  },
});
test('production owner can sign in through the interface without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().clearCookies();
  for (const path of ['/analytics', '/setup', '/cases/no-such-case']) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'Sign in to your workspace.', exact: true }),
    ).toBeVisible();
  }
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Sign in to your workspace.', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Your workspace needs a connection.', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'Owner or judge sign in', exact: true }).click();
  await expect(page.locator('form')).toHaveAttribute('method', 'post');
  const credentials = JSON.parse(await readFile('.local/production-test/credentials.json', 'utf8'));
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Make room for a resolution.', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('production refuses demo bypass, isolates owner data and applies private response headers', async ({
  playwright,
  request,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: origin,
    storageState: { cookies: [], origins: [] },
  });
  expect((await anonymous.storageState()).cookies).toHaveLength(0);
  expect((await fetch(`${origin}/api/cases`)).status).toBe(401);
  expect((await anonymous.get('/api/cases')).status()).toBe(401);
  expect(
    (
      await anonymous.post('/api/auth/sign-up/email', {
        headers: { origin },
        data: {
          email: 'outsider@cleardue.example',
          password: 'synthetic-password',
          name: 'Outsider',
        },
      })
    ).ok(),
  ).toBe(false);
  await anonymous.dispose();
  const cases = await request.get('/api/cases');
  expect(cases.status()).toBe(200);
  expect(cases.headers()['cache-control']).toBe('no-store');
  expect(cases.headers()['referrer-policy']).toBe('no-referrer');
  expect(cases.headers()['x-frame-options']).toBe('DENY');
  expect((await cases.json()).every((row: { id: string }) => !/^case-[1-6]$/.test(row.id))).toBe(
    true,
  );
  expect((await request.get('/api/cases/case-2')).status()).toBe(404);
});

test('protected judge can review its saved case and cannot alter the workspace or shared account', async ({
  browser,
  request: owner,
}) => {
  const { email, password, caseId } = JSON.parse(
    await readFile('.local/production-test/judge-credentials.json', 'utf8'),
  );
  const judge = await browser.newContext({
    baseURL: origin,
    storageState: { cookies: [], origins: [] },
  });
  try {
    expect(
      (
        await judge.request.post('/api/auth/sign-in/email', {
          headers: { origin },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    const cases = await judge.request.get('/api/cases');
    expect(cases.status()).toBe(200);
    expect((await cases.json()).map((row: { id: string }) => row.id)).toEqual([caseId]);
    const saved = await judge.request.get(`/api/cases/${caseId}`);
    expect(saved.status()).toBe(200);
    const savedData = await saved.json();
    expect(savedData.runs[0].status).toBe('SUCCEEDED');
    expect(savedData.proposals[0].state).toBe('DRAFT');
    const dashboard = await judge.request.get('/api/dashboard');
    expect(dashboard.status()).toBe(200);
    const dashboardData = await dashboard.json();

    for (const action of [
      'investigate',
      'refresh',
      'evidence',
      'revise',
      'approve',
      'grant',
      'clarification-grant',
      'revoke',
      'review-feedback',
    ]) {
      const response = await judge.request.post(`/api/cases/${caseId}`, {
        headers: { origin },
        data: { action },
      });
      expect(response.status(), action).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'READ_ONLY' });
    }
    for (const path of ['/api/cases', '/api/dashboard', '/api/studio/model']) {
      const response = await judge.request.post(path, { headers: { origin }, data: {} });
      expect(response.status(), path).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'READ_ONLY' });
    }
    const passwordChange = await judge.request.post('/api/auth/change-password', {
      headers: { origin },
      data: { currentPassword: password, newPassword: 'isolated-replacement-password' },
    });
    expect(passwordChange.status()).toBe(403);
    expect(
      (
        await judge.request.post('/api/auth/revoke-other-sessions', {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect((await owner.get(`/api/cases/${caseId}`)).status()).toBe(404);
    expect(
      (
        await owner.post(`/api/cases/${caseId}`, {
          headers: { origin },
          data: { action: 'investigate' },
        })
      ).status(),
    ).toBe(404);
    const after = await (await judge.request.get(`/api/cases/${caseId}`)).json();
    expect(after.runs).toEqual(savedData.runs);
    expect(after.proposals).toEqual(savedData.proposals);
    expect(after.commands).toEqual([]);
    expect((await (await judge.request.get('/api/dashboard')).json()).view).toEqual(
      dashboardData.view,
    );

    const page = await judge.newPage();
    await page.goto(`/cases/${caseId}`);
    await expect(
      page.getByRole('heading', { name: 'Saved judge case', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Read-only case. You can review saved findings and their sources.'),
    ).toBeVisible();
    const evidence = page.getByRole('group', { name: 'Evidence documents' });
    const conversation = evidence.getByRole('button', {
      name: 'Customer conversation 2',
      exact: true,
    });
    await conversation.press('Enter');
    await expect(conversation).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#source-text')).toContainText('check with my business partner');
    await expect(
      page.getByRole('button', { name: 'Investigate this case', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Approve this correction', exact: true }),
    ).toHaveCount(0);
    await page.goto('/analytics');
    await expect(
      page.getByText('Explore saved cases. View changes stay on this page.'),
    ).toBeVisible();
    const explorer = page.getByRole('region', { name: 'Read-only case explorer' });
    const savedRow = explorer.getByRole('row').filter({ hasText: 'Saved judge case' });
    await expect(savedRow).toContainText('Example analysis');
    const layout = page.getByRole('combobox', { name: 'Layout', exact: true });
    await expect(layout).toBeEnabled();
    await layout.selectOption('outcomes-first');
    await expect(layout).toHaveValue('outcomes-first');
    expect((await (await judge.request.get('/api/dashboard')).json()).view).toEqual(
      dashboardData.view,
    );
    expect(
      (await judge.request.post('/api/auth/sign-out', { headers: { origin }, data: {} })).status(),
    ).toBe(200);
    expect((await judge.request.get('/api/cases')).status()).toBe(401);
  } finally {
    await judge.close();
  }
});

test('production owner and worker resolve a fixture case; Studio navigation and source links raise no page errors', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await request.post('/api/cases', {
    headers: { origin },
    data: {
      customer: 'Production rehearsal',
      title: 'Production evidence to outcome',
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
  await page.getByRole('checkbox', { name: /I explicitly select/ }).check();
  await page.getByRole('checkbox', { name: /I reviewed the exact sources/ }).check();
  await page.getByRole('button', { name: 'Approve this correction', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A clearer invoice. A better next step.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create customer link', exact: true }).click();
  const customerUrl = await page
    .getByRole('link', { name: 'Open customer resolution', exact: true })
    .getAttribute('href');
  for (let attempt = 0; attempt < 121; attempt++) {
    const rejected = await request.get('/api/customer', {
      headers: { authorization: 'Bearer invalid' },
    });
    expect(rejected.status()).toBe(404);
    await rejected.dispose();
  }
  await page.goto(customerUrl!);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(
    page.getByRole('button', { name: 'This still looks wrong', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Simulate demo buyer payment', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      'This demo cannot take payments. Payment status updates after a new invoice check.',
      { exact: true },
    ),
  ).toBeVisible();
  const denied = await request.post('/api/customer', {
    headers: { origin, Authorization: `Bearer ${new URL(customerUrl!).hash.slice(1)}` },
    data: { action: 'demo-payment' },
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).code).toBe('DEMO_ONLY');
  await page.getByRole('button', { name: 'This still looks wrong', exact: true }).click();
  await page
    .getByLabel('What should the studio look at?')
    .fill('Please confirm the approved scope.');
  await page.getByRole('button', { name: 'Save feedback for the studio', exact: true }).click();
  await expect(
    page.getByText(
      'Your feedback is saved for the studio. No payment or invoice change was made.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Customer replies', exact: true }).click();
  const replyRow = page.getByRole('row').filter({ hasText: 'Production evidence to outcome' });
  await expect(replyRow).toContainText('1 new customer reply');
  await replyRow.getByRole('link', { name: 'Read reply', exact: true }).click();
  const reply = page
    .getByRole('listitem')
    .filter({ hasText: 'Please confirm the approved scope.' });
  await reply.getByRole('button', { name: 'Mark reply reviewed', exact: true }).click();
  await expect(reply).toContainText('Reviewed');
  await page.goto('/analytics');
  await page
    .getByRole('combobox', { name: 'Show', exact: true })
    .selectOption('confirmed-outcomes');
  const select = page
    .getByRole('region', { name: 'Read-only case explorer' })
    .locator(`button[data-case-id="${id}"]`);
  await select.focus();
  await page.keyboard.press('Enter');
  const trail = page.getByRole('region', { name: 'Evidence to outcome trail' });
  await expect(trail).toContainText('Production rehearsal');
  await expect(page.locator('.outcome-ledger')).toContainText('£1,000.00');
  await expect(page.locator('.outcome-ledger')).toContainText('£250.00');
  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('outcomes-first');
  await expect(trail).toContainText('Production rehearsal');
  await page.screenshot({ path: info.outputPath('production-linked-studio.png'), fullPage: true });
  await trail.getByRole('link', { name: /Read cited quote 1/ }).click();
  await expect(page.locator('#source-text')).toContainText('Landing page');
  await expect(page.locator('#source-text mark')).toContainText('Landing page');
  await expect(page.locator('#source-text')).toBeFocused();
  expect(errors).toEqual([]);
  const stored = await (await request.get(`/api/cases/${id}`)).json();
  expect(stored.commands).toHaveLength(1);
  expect(stored.commands[0].state).toBe('SUCCEEDED');
  expect(stored.case.invoice.paidPence).toBe(0);
  expect(stored.case.invoice.duePence).toBe(100000);
});
