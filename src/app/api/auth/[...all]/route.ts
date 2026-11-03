import { auth } from '@/server/auth';
import { errorResponse, sameOrigin, boundedText, rateLimit } from '@/server/http';
export async function GET(request: Request) {
  try {
    return await auth().handler(request);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await rateLimit('auth:global', 60);
    const body = await boundedText(request, 16000);
    return await auth().handler(
      new Request(request.url, { method: 'POST', headers: request.headers, body }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
