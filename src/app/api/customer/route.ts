import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { boundedText, errorResponse, json, rateLimit, sameOrigin } from '@/server/http';
import { customerView, requestRefresh } from '@/server/workflow';
import { db } from '@/server/db';
import { cases, feedback, grants } from '@/server/schema';
import { config } from '@/server/config';
import { DomainError, decimal } from '@/domain/core';
function token(request: Request) {
  return request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
}
export async function GET(request: Request) {
  try {
    const view = await customerView(token(request));
    await rateLimit(`customer:read:${view.grantId}`, 120);
    return json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const t = token(request);
    const view = await customerView(t);
    await rateLimit(`feedback:${view.grantId}`, 10);
    const input = z
      .discriminatedUnion('action', [
        z
          .object({ action: z.literal('feedback'), message: z.string().trim().min(1).max(1000) })
          .strict(),
        z.object({ action: z.literal('demo-payment') }).strict(),
      ])
      .parse(JSON.parse(await boundedText(request, 4000)));
    if (input.action === 'feedback') {
      await db()
        .insert(feedback)
        .values({ id: randomUUID(), grantId: view.grantId, message: input.message });
      return json({ received: true });
    }
    if (config().mode !== 'demo' || !config().demoAccess)
      throw new DomainError(
        'DEMO_ONLY',
        'Simulated payment is available only in explicit loopback local demo mode.',
        403,
      );
    const [grant] = await db().select().from(grants).where(eq(grants.id, view.grantId));
    const [c] = await db()
      .select()
      .from(cases)
      .where(and(eq(cases.id, grant.caseId), eq(cases.environment, 'demo')));
    if (!c || c.invoice.payment !== 'UNPAID')
      throw new DomainError(
        'PAYMENT',
        'This demo invoice is not fully unpaid. Refresh the observation.',
      );
    const raw = structuredClone(c.providerInvoice) as Record<string, unknown>;
    raw.status = 'PAID';
    raw.due_amount = { currency_code: 'GBP', value: '0.00' };
    raw.payments = {
      paid_amount: { currency_code: 'GBP', value: decimal(c.invoice.totalPence) },
      transactions: [
        { type: 'PAYPAL', status: 'COMPLETED', payment_id: `SIMULATED-${randomUUID()}` },
      ],
    };
    await db().update(cases).set({ providerInvoice: raw }).where(eq(cases.id, c.id));
    await requestRefresh(c.ownerId, c.id);
    return json({
      simulated: true,
      message:
        'Simulated buyer payment recorded in the demo adapter. Worker reconciliation is pending.',
    });
  } catch (e) {
    return errorResponse(e);
  }
}
