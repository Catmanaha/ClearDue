import { DomainError } from '../domain/core';
import { config } from './config';
import { pool } from './db';
import { publicError } from './public-error';
export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== config().appUrl)
    throw new DomainError('ORIGIN', 'Request origin is not allowed.', 403);
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('application/json'))
    throw new DomainError('CONTENT_TYPE', 'Use application/json.', 415);
}
export async function boundedText(request: Request, max = 64000) {
  if (Number(request.headers.get('content-length') ?? 0) > max)
    throw new DomainError('BODY_LIMIT', 'Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new DomainError('BODY_LIMIT', 'Request is too large; nothing was imported.', 413);
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new DomainError('UTF8', 'Supply valid UTF-8 text.');
  }
}
export async function rateLimit(key: string, limit = 30, seconds = 60) {
  const r = await pool().query(
    "INSERT INTO rate_limits(key,count,resets_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.resets_at<now() THEN 1 ELSE rate_limits.count+1 END, resets_at=CASE WHEN rate_limits.resets_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.resets_at END RETURNING count",
    [key, seconds],
  );
  if (r.rows[0].count > limit)
    throw new DomainError('RATE_LIMIT', 'Too many requests. Wait a minute and try again.', 429);
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function errorResponse(error: unknown) {
  if (error instanceof DomainError)
    return json({ error: publicError(error, ''), code: error.code }, error.status);
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError')
    return json(
      { error: 'The supplied data does not match the supported format.', code: 'VALIDATION' },
      422,
    );
  console.error(
    JSON.stringify({
      event: 'request_failed',
      message: 'Unexpected failure; request data redacted.',
    }),
  );
  return json(
    {
      error:
        'ClearDue could not confirm this request. Reload the saved view before taking another action. If this continues, ask the person who set up the workspace for help.',
      code: 'SERVICE',
    },
    503,
  );
}
