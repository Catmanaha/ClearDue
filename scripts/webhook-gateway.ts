import { createWebhookGateway, localPort } from './lib/webhook-gateway';

if (process.env.PAYMENT_MODE !== 'sandbox')
  throw new Error('The temporary webhook gateway requires PAYMENT_MODE=sandbox.');
const port = localPort(process.env.WEBHOOK_GATEWAY_PORT, 3400);
const upstream = localPort(process.env.WEBHOOK_UPSTREAM_PORT, 3000);
if (port === upstream) throw new Error('Gateway and web ports must differ.');
const server = createWebhookGateway(upstream);
server.listen(port, '127.0.0.1', () => {
  console.log(
    'Temporary webhook-only gateway ready on loopback. No request bodies or headers logged.',
  );
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
