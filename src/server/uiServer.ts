import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

export function startUiServer(port: number, webDir: string): http.Server {
  const server = http.createServer((req, res) => {
    // Enable CORS for embedding
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let reqPath = (req.url || '/').split('?')[0];
    // Strip leading /app route prefix if present
    if (reqPath === '/app' || reqPath === '/app/') {
      reqPath = '/';
    } else if (reqPath.startsWith('/app/')) {
      reqPath = reqPath.slice('/app'.length);
    }

    if (!reqPath || reqPath === '/') {
      reqPath = '/index.html';
    }

    const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(webDir, safePath);
    const resolvedFilePath = path.resolve(filePath);
    const resolvedWebDir = path.resolve(webDir);
    if (!resolvedFilePath.startsWith(resolvedWebDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied: Path escapes web root.');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA Fallback: serve index.html for client-side routing
      filePath = path.join(webDir, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Esedre UI: index.html not found. Run npm run build first.');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\x1b[31mError: Internal UI port ${port} is already in use.\x1b[0m`);
    } else {
      console.error(`\x1b[31mUI Server Error: ${err.message}\x1b[0m`);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    // Listening
  });

  return server;
}
