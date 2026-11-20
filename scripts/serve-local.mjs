import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { extname } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const host = 'dayboard.localhost';
const address = 'http://' + host;
const oldOrigin = address + ':8080';
const shareWithTalentee = process.argv.includes('--share-with-talentee');
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

function forwardTalentee(incoming, response) {
  // This route has one fixed loopback destination and preserves Talentee's Host and Origin checks.
  const upstream = request({
    host: '127.0.0.1',
    port: 4173,
    method: incoming.method,
    path: incoming.url,
    headers: incoming.headers,
  }, result => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else end(response, 502, 'Talentee is unavailable on its local port.');
  });
  response.on('close', () => upstream.destroy());
  incoming.pipe(upstream);
}

async function handle(incoming, response, legacy) {
  const requestHost = incoming.headers.host?.toLowerCase();
  if (!legacy && shareWithTalentee && (requestHost === 'talentee.localhost' || requestHost === 'talentee.localhost:80')) {
    forwardTalentee(incoming, response);
    return;
  }
  const origin = legacy ? oldOrigin : address;
  if (requestHost !== (legacy ? host + ':8080' : host) && (legacy || requestHost !== host + ':80')) {
    end(response, 421, 'Use ' + origin + '/.');
    return;
  }
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    end(response, 405, 'Method not allowed.');
    return;
  }

  const path = new URL(incoming.url, origin).pathname;
  if (legacy && path === '/_local-board-transfer') {
    const bridge = await readFile(new URL('local-board-transfer.html', import.meta.url));
    response.writeHead(200, {
      'Content-Type': types['.html'],
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors " + address,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(incoming.method === 'HEAD' ? undefined : bridge);
    return;
  }

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
function listen(port, loopback, legacy = false) {
  const server = createServer((incoming, response) => {
    void handle(incoming, response, legacy).catch(() => {
      if (response.headersSent) response.destroy();
      else end(response, 500, 'Dayboard could not serve this file.');
    });
  });
  server.listen({ host: loopback, port });
}

listen(8080, '127.0.0.1', true);
listen(80, '127.0.0.1');
listen(80, '::1');
