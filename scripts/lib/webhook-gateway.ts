import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const route = '/api/webhooks/paypal';
const maxBodyBytes = 128000;
const signatureHeaders = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-cert-url',
  'paypal-auth-algo',
  'paypal-transmission-sig',
] as const;

export function localPort(value: string | undefined, fallback: number) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Configure a valid local TCP port.');
  return port;
}

class BodyLimit extends Error {}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = () => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', error);
      request.off('aborted', aborted);
    };
    const error = (cause: Error) => {
      cleanup();
      reject(cause);
    };
    const aborted = () => error(new Error('Request aborted.'));
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        request.pause();
        cleanup();
        reject(new BodyLimit());
      } else chunks.push(chunk);
    };
    request.on('data', data).once('end', end).once('error', error).once('aborted', aborted);
  });
}

function reply(response: ServerResponse, status: number) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(
    JSON.stringify(status === 200 ? { accepted: true } : { error: 'Webhook rejected.' }),
  );
}

/** Temporary local ingress only. Business logic and signature verification stay in Next. */
export function createWebhookGateway(upstreamPort: number) {
  localPort(String(upstreamPort), 3000);
  const upstream = `http://127.0.0.1:${upstreamPort}${route}`;
  const server = createServer({ maxHeaderSize: 16384 }, async (request, response) => {
    if (request.url !== route) return reply(response, 404);
    if (request.method !== 'POST') return reply(response, 405);
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
      return reply(response, 415);
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const name of signatureHeaders) {
      const value = request.headers[name];
      if (typeof value !== 'string' || !value || value.length > 2048) return reply(response, 400);
      headers.set(name, value);
    }
    if (Number(request.headers['content-length'] ?? 0) > maxBodyBytes) return reply(response, 413);
    try {
      const body = await readBody(request);
      const result = await fetch(upstream, {
        method: 'POST',
        headers,
        body: new Uint8Array(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      await result.body?.cancel();
      // Do not relay HTML, internal error details, cookies, redirects or arbitrary headers.
      const status = result.ok
        ? 200
        : result.status >= 400 && result.status < 500
          ? result.status
          : 502;
      reply(response, status);
    } catch (error) {
      reply(response, error instanceof BodyLimit ? 413 : 502);
    }
  });
  server.requestTimeout = 40000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  return server;
}
