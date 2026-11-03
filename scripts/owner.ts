import { provisionOwner } from '../src/server/provision-owner';
import { closeDb } from '../src/server/db';
const email = process.env.CLEARDUE_OWNER_EMAIL;
const password = process.env.CLEARDUE_OWNER_PASSWORD;
if (!email || !password)
  throw new Error(
    'Set CLEARDUE_OWNER_EMAIL and CLEARDUE_OWNER_PASSWORD privately for this command. No secret is printed.',
  );
try {
  const result = await provisionOwner(email, password);
  console.log(`Provisioned restricted account ${result.user.id}. Email and password omitted.`);
} finally {
  delete process.env.CLEARDUE_OWNER_PASSWORD;
  await closeDb();
}
