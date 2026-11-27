import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 8770;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('ok');
    return;
  }

  if (url.pathname !== '/fixture') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  const index = Math.max(0, Math.floor(Number(url.searchParams.get('tab')) || 0));
  const title = `Keybar benchmark tab ${String(index).padStart(4, '0')}`;
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
  });
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
      `<body><main><h1>${escapeHtml(title)}</h1></main></body></html>`,
  );
});

server.listen(port, host, () => {
  process.stdout.write(`Keybar activation fixture listening at http://${host}:${port}/fixture?tab=0001\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
