import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { pool } from './db';
import { config } from './config';
import { DomainError } from '../domain/core';
function createAuth() {
  const c = config();
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
    throw new DomainError(
      'AUTH_SETUP',
      'Configure a random BETTER_AUTH_SECRET of at least 32 characters and OWNER_EMAILS.',
    );
  if (!c.ownerEmails.length)
    throw new DomainError(
      'AUTH_SETUP',
      'Configure OWNER_EMAILS before enabling authenticated access.',
    );
  return betterAuth({
    database: pool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: c.appUrl,
    trustedOrigins: [c.appUrl],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          !c.readOnlyJudgeEmail ||
          ctx.path === '/sign-in/email' ||
          ctx.path === '/sign-out' ||
          ctx.path === '/get-session'
        )
          return;
        const session = await getSessionFromCtx(ctx, { disableRefresh: true });
        const email = session?.user.email.toLowerCase();
        if (!email || email === c.readOnlyJudgeEmail || !c.ownerEmails.includes(email))
          throw new APIError('FORBIDDEN', { message: 'This account action is unavailable.' });
      }),
    },
    advanced: { useSecureCookies: !c.loopback },
    rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limit' },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function auth() {
  return (instance ??= createAuth());
}
export async function requireWorkspaceAccess(headers: Headers) {
  const c = config();
  const host = headers.get('host') ?? '';
  const hostIsLocal = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
  if (c.demoAccess && hostIsLocal)
    return { id: 'demo-owner', email: 'owner@cleardue.example', readOnly: false };
  const session = await auth().api.getSession({ headers });
  if (!session || !c.ownerEmails.includes(session.user.email.toLowerCase()))
    throw new DomainError(
      'UNAUTHORIZED',
      'Sign in with an authorized owner or judge account.',
      401,
    );
  return {
    id: session.user.id,
    email: session.user.email,
    readOnly: session.user.email.toLowerCase() === c.readOnlyJudgeEmail,
  };
}
export async function requireOwner(headers: Headers) {
  const actor = await requireWorkspaceAccess(headers);
  if (actor.readOnly)
    throw new DomainError(
      'READ_ONLY',
      'This judge workspace is for reviewing saved cases. Changes and new analysis are turned off.',
      403,
    );
  return actor;
}
