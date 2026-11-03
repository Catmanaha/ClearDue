import { requireOwner, requireWorkspaceAccess } from '@/server/auth';
import { boundedText, errorResponse, json, rateLimit, sameOrigin } from '@/server/http';
import { listCases } from '@/server/workflow';
import { createIntakeCase } from '@/server/intake';
export async function GET(request: Request) {
  try {
    const actor = await requireWorkspaceAccess(request.headers);
    return json(await listCases(actor.id));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireOwner(request.headers);
    await rateLimit(`create:${actor.id}`, 10);
    const saved = await createIntakeCase(actor.id, JSON.parse(await boundedText(request)));
    return json(saved, saved.replayed ? 200 : 201);
  } catch (e) {
    return errorResponse(e);
  }
}
