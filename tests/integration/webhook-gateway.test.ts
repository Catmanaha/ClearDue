import { afterEach, expect, test } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createWebhookGateway, localPort } from '../../scripts/lib/webhook-gateway';

const servers: Server[] = [];
const signature = {
  'content-type': 'application/json',
  'paypal-transmission-id': 'test-id',
  'paypal-transmission-time': '2026-10-30T18:00:00Z',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/test-certificate',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-transmission-sig': 'synthetic-test-signature',
};
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}
afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('forwards only the exact webhook POST and required signature headers, preserving raw bytes', async () => {
  let calls = 0;
  let actualBody = '';
  let actualHeaders: import('node:http').IncomingHttpHeaders = {};
  const upstream = await listen(
    createServer(async (req, res) => {
      calls++;
      actualHeaders = req.headers;
      for await (const chunk of req) actualBody += chunk.toString();
      expect(req.url).toBe('/api/webhooks/paypal');
      res.writeHead(200, { 'set-cookie': 'internal=secret', 'x-internal': 'private' });
      res.end('{"internal":"must not leak"}');
    }),
  );
  const port = await listen(createWebhookGateway(upstream));
  const body = '{ "id": "synthetic",\n "resource": { "id": "test" } }';
  const result = await fetch(`http://127.0.0.1:${port}/api/webhooks/paypal`, {
    method: 'POST',
    body,
    headers: { ...signature, authorization: 'secret', cookie: 'private=secret' },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ accepted: true });
  expect(result.headers.get('set-cookie')).toBeNull();
  expect(result.headers.get('x-internal')).toBeNull();
  expect(actualBody).toBe(body);
  expect(actualHeaders['paypal-transmission-sig']).toBe(signature['paypal-transmission-sig']);
  expect(actualHeaders.authorization).toBeUndefined();
  expect(actualHeaders.cookie).toBeUndefined();
  expect(calls).toBe(1);
});

test('rejects owner/customer/health paths, query strings, wrong methods, types and missing headers before forwarding', async () => {
  let calls = 0;
  const upstream = await listen(
    createServer((_req, res) => {
      calls++;
      res.end();
    }),
  );
  const port = await listen(createWebhookGateway(upstream));
  for (const path of [
    '/',
    '/r',
    '/api/health',
    '/api/webhooks/paypal?other=1',
    '/api/webhooks/paypal/',
  ]) {
    expect(
      (
        await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: signature,
          body: '{}',
        })
      ).status,
    ).toBe(404);
  }
  const url = `http://127.0.0.1:${port}/api/webhooks/paypal`;
  expect((await fetch(url)).status).toBe(405);
  expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(415);
  expect(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(400);
  expect(calls).toBe(0);
});

test('rejects oversized declared and chunked bodies without forwarding or dropping the rejection response', async () => {
  let calls = 0;
  const upstream = await listen(
    createServer((_req, res) => {
      calls++;
      res.end();
    }),
  );
  const port = await listen(createWebhookGateway(upstream));
  const url = `http://127.0.0.1:${port}/api/webhooks/paypal`;
  expect(
    (await fetch(url, { method: 'POST', headers: signature, body: 'x'.repeat(128001) })).status,
  ).toBe(413);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: 'POST', headers: { ...signature, 'transfer-encoding': 'chunked' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.write(Buffer.alloc(64000));
    req.end(Buffer.alloc(64001));
  });
  expect(status).toBe(413);
  expect(calls).toBe(0);
});

test('survives an interrupted upload without forwarding a partial event', async () => {
  let calls = 0;
  const upstream = await listen(
    createServer((_req, res) => {
      calls++;
      res.end();
    }),
  );
  const gateway = createWebhookGateway(upstream);
  const port = await listen(gateway);
  let received!: () => void;
  let closed!: () => void;
  const dataReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const requestClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  gateway.once('request', (req) => {
    req.once('data', received);
    req.once('close', closed);
  });
  const request = httpRequest(`http://127.0.0.1:${port}/api/webhooks/paypal`, {
    method: 'POST',
    headers: { ...signature, 'transfer-encoding': 'chunked' },
  });
  request.on('error', () => {});
  request.write('{"unfinished":');
  await dataReceived;
  request.destroy();
  await requestClosed;
  expect(calls).toBe(0);
  const result = await fetch(`http://127.0.0.1:${port}/api/webhooks/paypal`, {
    method: 'POST',
    headers: signature,
    body: '{}',
  });
  expect(result.status).toBe(200);
  expect(calls).toBe(1);
});

test('preserves signature-rejection status without leaking provider/internal error text', async () => {
  const upstream = await listen(
    createServer((_req, res) => {
      res.writeHead(401);
      res.end('private details');
    }),
  );
  const port = await listen(createWebhookGateway(upstream));
  const result = await fetch(`http://127.0.0.1:${port}/api/webhooks/paypal`, {
    method: 'POST',
    headers: signature,
    body: '{}',
  });
  expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ error: 'Webhook rejected.' });
});

test('does not follow upstream redirects or acknowledge unavailable/failed upstreams', async () => {
  let redirectHits = 0;
  const target = await listen(
    createServer((_req, res) => {
      redirectHits++;
      res.end();
    }),
  );
  for (const status of [302, 500]) {
    const upstream = await listen(
      createServer((_req, res) => {
        res.writeHead(status, { location: `http://127.0.0.1:${target}/` });
        res.end();
      }),
    );
    const port = await listen(createWebhookGateway(upstream));
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/api/webhooks/paypal`, {
          method: 'POST',
          headers: signature,
          body: '{}',
        })
      ).status,
    ).toBe(502);
  }
  const unused = createServer();
  const closedPort = await listen(unused);
  servers.splice(servers.indexOf(unused), 1);
  await new Promise<void>((resolve) => unused.close(() => resolve()));
  const port = await listen(createWebhookGateway(closedPort));
  expect(
    (
      await fetch(`http://127.0.0.1:${port}/api/webhooks/paypal`, {
        method: 'POST',
        headers: signature,
        body: '{}',
      })
    ).status,
  ).toBe(502);
  expect(redirectHits).toBe(0);
});

test('validates local ports rather than accepting an arbitrary upstream destination', () => {
  expect(localPort(undefined, 3400)).toBe(3400);
  for (const value of ['0', '-1', '65536', '3000.5', 'https://example.com', ''])
    expect(() => localPort(value, 3400)).toThrow();
});
