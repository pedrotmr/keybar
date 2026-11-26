import { createServer } from 'node:http';

const host = process.env.KEYBAR_BENCH_HOST ?? '127.0.0.1';
const port = Number(process.env.KEYBAR_BENCH_PORT ?? 8770);
const events = [];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  if (url.pathname === '/benchmarks/clear' && request.method === 'POST') {
    events.length = 0;
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ cleared: true }));
    return;
  }

  if (url.pathname === '/benchmarks/events' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(events));
    return;
  }

  if (url.pathname === '/benchmarks/events' && request.method === 'POST') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        events.push(JSON.parse(body));
        response.writeHead(202, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ accepted: true }));
      } catch {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('invalid JSON');
      }
    });
    return;
  }

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
  const probeScript = `
    (() => {
      const storageKey = 'keybarActivationBenchmarkSample';
      const sample = Number(localStorage.getItem(storageKey) || '0') + 1;
      localStorage.setItem(storageKey, String(sample));
      const events = [];
      const hostId = 'lnflcdainoeimligocpijlehbfiokfmb-command-center-surface';
      let sawHost = false;
      let wasVisible = false;
      let activation = 0;
      let focused = false;
      const record = (name, details = {}) => {
        const event = {
          cell: localStorage.getItem('keybarActivationBenchmarkCell') || 'unspecified',
          sample,
          name,
          epochMs: performance.timeOrigin + performance.now(),
          perfMs: performance.now(),
          ...details,
        };
        events.push(event);
        fetch('/benchmarks/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
          keepalive: true,
        }).catch(() => {});
      };
      const isVisible = (host) => {
        const style = getComputedStyle(host);
        const rect = host.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const inspect = () => {
        const host = document.getElementById(hostId);
        if (host && !sawHost) {
          sawHost = true;
          record('hostInjected');
        }
        const visible = !!host && isVisible(host);
        if (visible && !wasVisible) {
          activation += 1;
          focused = false;
          record('surfaceShown', { activation });
          requestAnimationFrame(() => record('firstVisibleFrame', { activation }));
        } else if (!visible && wasVisible) {
          record('surfaceHidden', { activation });
        }
        wasVisible = visible;
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-hidden'],
        childList: true,
        subtree: true,
      });
      document.addEventListener('focusin', () => {
        if (!focused && wasVisible) {
          focused = true;
          record('focused', { activation });
        }
      }, true);
      window.__keybarColdActivationProbe = {
        read: () => ({ cell: localStorage.getItem('keybarActivationBenchmarkCell') || 'unspecified', sample, events }),
        disconnect: () => observer.disconnect(),
      };
      inspect();
    })();
  `;
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
  });
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<script>${probeScript}</script></head><body><main><h1>${escapeHtml(title)}</h1></main></body></html>`,
  );
});

server.listen(port, host, () => {
  process.stdout.write(`Keybar activation fixture listening at http://${host}:${port}/fixture?tab=0001\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
