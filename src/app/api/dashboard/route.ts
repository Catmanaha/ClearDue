import { requireOwner, requireWorkspaceAccess } from '@/server/auth';
import { boundedText, sameOrigin, errorResponse, json, rateLimit } from '@/server/http';
import { analytics } from '@/server/analytics';
import { viewSchema } from '@/domain/dashboard';
import { dashboard } from '@/server/schema';
import { db } from '@/server/db';
export async function GET(request: Request) {
  try {
    const actor = await requireWorkspaceAccess(request.headers);
    return json(await analytics(actor.id));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireOwner(request.headers);
    await rateLimit(`dashboard:${actor.id}`);
    const state = viewSchema.parse(JSON.parse(await boundedText(request, 4000)));
    await db()
      .insert(dashboard)
      .values({ ownerId: actor.id, state })
      .onConflictDoUpdate({ target: dashboard.ownerId, set: { state, updatedAt: new Date() } });
    return json({ saved: true });
  } catch (e) {
    return errorResponse(e);
  }
}
