import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requireOwner, requireWorkspaceAccess } from '@/server/auth';
import { boundedText, errorResponse, json, rateLimit, sameOrigin } from '@/server/http';
import {
  addEvidence,
  approve,
  createGrant,
  clarificationGrant,
  getCase,
  requestInvestigation,
  requestRefresh,
  reviseProposal,
  workbench,
} from '@/server/workflow';
import { db } from '@/server/db';
import { feedback, grants } from '@/server/schema';
import { DomainError } from '@/domain/core';
import { importSchema } from '@/domain/evidence';
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('investigate') }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
  z.object({ action: z.literal('evidence'), document: importSchema }).strict(),
  z
    .object({
      action: z.literal('revise'),
      proposalId: z.string(),
      explanation: z.string().max(1500),
    })
    .strict(),
  z
    .object({
      action: z.literal('approve'),
      proposalId: z.string(),
      sourceSupportReviewed: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('grant') }).strict(),
  z
    .object({
      action: z.literal('clarification-grant'),
      explanation: z.string().min(1).max(1500),
      invoiceHash: z.string().length(64),
      evidenceHash: z.string().length(64),
      reviewed: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('revoke'), grantId: z.string() }).strict(),
  z.object({ action: z.literal('review-feedback'), feedbackId: z.uuid() }).strict(),
]);
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWorkspaceAccess(request.headers);
    return json(await workbench(actor.id, (await context.params).id));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const actor = await requireOwner(request.headers);
    await rateLimit(`case:${actor.id}`);
    const id = (await context.params).id;
    const input = actionSchema.parse(JSON.parse(await boundedText(request)));
    await getCase(actor.id, id);
    switch (input.action) {
      case 'investigate':
        await requestInvestigation(actor.id, id);
        break;
      case 'refresh':
        await requestRefresh(actor.id, id);
        break;
      case 'evidence':
        await addEvidence(actor.id, id, input.document);
        break;
      case 'revise':
        return json(await reviseProposal(actor.id, id, input.proposalId, input.explanation));
      case 'approve':
        return json(await approve(actor.id, id, input.proposalId, input.sourceSupportReviewed));
      case 'grant':
        return json(await createGrant(actor.id, id));
      case 'clarification-grant':
        return json(
          await clarificationGrant(
            actor.id,
            id,
            input.explanation,
            input.invoiceHash,
            input.evidenceHash,
            input.reviewed,
          ),
        );
      case 'revoke':
        await db()
          .update(grants)
          .set({ revokedAt: new Date() })
          .where(and(eq(grants.id, input.grantId), eq(grants.caseId, id)));
        break;
      case 'review-feedback': {
        const [reply] = await db()
          .update(feedback)
          .set({ reviewedAt: sql`coalesce(${feedback.reviewedAt}, now())` })
          .where(
            and(
              eq(feedback.id, input.feedbackId),
              inArray(
                feedback.grantId,
                db().select({ id: grants.id }).from(grants).where(eq(grants.caseId, id)),
              ),
            ),
          )
          .returning({ id: feedback.id });
        if (!reply)
          throw new DomainError('NOT_FOUND', 'Customer reply not found in this case.', 404);
        break;
      }
    }
    return json({ accepted: true }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
