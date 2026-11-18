import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const port = 8080;
const origin = 'http://dayboard.localhost:' + port;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function end(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

async function handle(incoming, response) {
  const host = incoming.headers.host?.toLowerCase();
  if (host !== 'dayboard.localhost:' + port) {
    end(response, 421, 'Use ' + origin + '/.');
    return;
  }
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    end(response, 405, 'Method not allowed.');
    return;
  }

  const path = new URL(incoming.url, origin).pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (file !== 'index.html' && file !== 'dayboard.svg' &&
    !/^assets\/[a-z0-9_-][a-z0-9_.-]*\.(?:js|css|woff2?)$/i.test(file)) {
    end(response, 404, 'File not found.');
    return;
  }

  try {
    const content = await readFile(new URL(file, dist));
    response.writeHead(200, {
      'Content-Type': types[extname(file)],
      'Content-Length': content.length,
      'Cache-Control': file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(incoming.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT') end(response, 404, 'Build Dayboard with npm run build.');
    else throw error;
  }
}

await readFile(new URL('index.html', dist));
const server = createServer((incoming, response) => {
  void handle(incoming, response).catch(() => {
    if (response.headersSent) response.destroy();
    else end(response, 500, 'Dayboard could not serve this file.');
  });
});
server.listen({ host: '127.0.0.1', port }, () => {
  console.log('Dayboard is ready at ' + origin + '/');
});
