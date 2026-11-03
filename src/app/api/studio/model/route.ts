import { requireOwner } from '@/server/auth';
import { boundedText, sameOrigin, errorResponse, json, rateLimit } from '@/server/http';
import { studioTurn } from '@/server/studio-model';
import { config } from '@/server/config';
import { DomainError } from '@/domain/core';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireOwner(request.headers);
    await rateLimit(`studio:${actor.id}`, 10);
    if (!config().studioEnabled || config().ai !== 'live')
      throw new DomainError(
        'AI_DISABLED',
        'Studio live interaction requires configured Studio access and live AI flags/limits. No fixture response will be substituted.',
      );
    return json(await studioTurn(actor.id, JSON.parse(await boundedText(request))));
  } catch (e) {
    return errorResponse(e);
  }
}
