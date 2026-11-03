import { boundedText, errorResponse, json, rateLimit } from '@/server/http';
import { ingestWebhook } from '@/server/webhooks';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    await rateLimit('webhook:global', 120);
    const raw = await boundedText(request, 128000);
    return json(await ingestWebhook(request.headers, raw));
  } catch (e) {
    return errorResponse(e);
  }
}
