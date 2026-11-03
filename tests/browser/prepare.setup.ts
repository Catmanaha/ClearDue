import { test as setup, expect } from '@playwright/test';

setup(
  'prepare cold development routes without mutations or provider calls',
  async ({ request }) => {
    // Compilation belongs to startup, not the scenario's unchanged 60-second interaction budget.
    // Every request is GET; no evidence, commands, grants, payments or model requests are created.
    for (const path of [
      '/',
      '/cases/case-2',
      '/analytics',
      '/setup',
      '/r',
      '/api/dashboard',
      '/api/cases/browser-route-preparation',
      '/api/customer',
      '/api/studio/model',
    ]) {
      const started = Date.now();
      const response = await request.get(path, { timeout: 120000 });
      expect(response.status(), `Development route preparation: ${path}`).toBeLessThan(500);
      console.log(`Development route prepared: ${path} (${Date.now() - started}ms)`);
    }
  },
);
