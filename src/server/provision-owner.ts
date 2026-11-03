import { betterAuth } from 'better-auth';
import { config } from './config';
import { pool } from './db';
import { DomainError } from '../domain/core';
/** CLI-only provisioning. This auth instance is never exposed as an HTTP handler. */
export async function provisionOwner(email: string, password: string) {
  const c = config();
  if (
    !c.ownerEmails.includes(email.toLowerCase()) ||
    password.length < 12 ||
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32
  )
    throw new DomainError(
      'OWNER_SETUP',
      'Use an OWNER_EMAILS allowlisted email, a 12+ character password and a configured random auth secret.',
    );
  const provisioner = betterAuth({
    database: pool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: c.appUrl,
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: false },
  });
  return provisioner.api.signUpEmail({ body: { email, password, name: 'Workspace owner' } });
}
