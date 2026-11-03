import { createServer } from 'node:http';

// Development credential bootstrap only: no app data, model calls or environment route.
createServer((request, response) => {
  const ready = request.method === 'GET' && request.url === '/health';
  response.writeHead(ready ? 200 : 404, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(ready ? { ready: true } : { error: 'Not found' }));
}).listen(80, '0.0.0.0');
