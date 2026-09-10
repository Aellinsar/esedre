import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiServer } from './uiServer.js';
import { startApiServer } from './apiServer.js';
import { SecurityFilter } from '../securityFilter.js';
import { resolvePorts } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveWebDir(explicitWebDir?: string, workspaceRoot?: string): string {
  if (explicitWebDir && fs.existsSync(path.join(explicitWebDir, 'index.html'))) {
    return explicitWebDir;
  }

  const candidates = [
    // 1. Packaged layout right next to executable (e.g. tools/web)
    path.resolve(__dirname, 'web'),
    // 2. From workspace root: <workspaceRoot>/dist/web
    workspaceRoot ? path.resolve(workspaceRoot, 'dist', 'web') : '',
    // 3. In-repo legacy subfolder: <workspaceRoot>/esedre/dist/web
    workspaceRoot ? path.resolve(workspaceRoot, 'esedre', 'dist', 'web') : '',
    // 4. Sibling standalone repository from workspace root: <workspaceRoot>/../esedre/dist/web
    workspaceRoot ? path.resolve(workspaceRoot, '..', 'esedre', 'dist', 'web') : '',
    // 5. Packaged layout inside dist/web
    path.resolve(__dirname, 'dist', 'web'),
    // 6. Sibling standalone repository from __dirname: <__dirname>/../../esedre/dist/web
    path.resolve(__dirname, '..', '..', 'esedre', 'dist', 'web'),
    // 7. Source tree layout: esedre/src/server/ -> esedre/dist/web
    path.resolve(__dirname, '..', '..', 'dist', 'web'),
    // 8. Legacy layout from __dirname
    path.resolve(__dirname, '..', 'esedre', 'dist', 'web'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return candidates[0] || path.resolve(__dirname, 'web');
}

export interface GatewayOptions {
  gatewayPort?: number;
  uiPort?: number;
  apiPort?: number;
  webDir?: string;
  storage: SecurityFilter;
  workspaceRoot: string;
}

export interface EsedreServerCluster {
  gatewayServer: http.Server;
  uiServer: http.Server;
  apiServer: http.Server;
  close: () => Promise<void>;
}

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, targetPort: number, rewritePath?: (path: string) => string) {
  const targetPath = rewritePath ? rewritePath(req.url || '/') : req.url || '/';

  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
      'x-forwarded-for': req.socket.remoteAddress || '',
      'x-forwarded-proto': 'http',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`[Gateway Proxy Error -> ${targetPort}]:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: Could not forward request to internal port ${targetPort}`);
    }
  });

  req.pipe(proxyReq, { end: true });
}

export function startGatewayCluster(options: GatewayOptions): EsedreServerCluster {
  const resolved = resolvePorts(undefined, {
    gatewayPort: options.gatewayPort,
    uiPort: options.uiPort,
    apiPort: options.apiPort,
  });
  const gatewayPort = resolved.gateway;
  const uiPort = options.uiPort !== undefined ? options.uiPort : (gatewayPort ? gatewayPort + 1 : 0);
  const apiPort = options.apiPort !== undefined ? options.apiPort : (gatewayPort ? gatewayPort + 2 : 0);
  const webDir = resolveWebDir(options.webDir, options.workspaceRoot);

  // Start internal services
  const uiServer = startUiServer(uiPort, webDir);
  const apiServer = startApiServer(apiPort, options.storage, options.workspaceRoot);

  const getUiPort = () => (uiServer.address() as any)?.port || uiPort;
  const getApiPort = () => (apiServer.address() as any)?.port || apiPort;

  // Start external reverse proxy gateway
  const gatewayServer = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const parsedPath = rawUrl.split('?')[0];

    // Rewrite rule: / or /index.html transparently rewrites to /app/
    if (parsedPath === '/' || parsedPath === '/index.html' || parsedPath === '/esedre' || parsedPath === '/esedre/') {
      const search = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
      proxyRequest(req, res, getUiPort(), () => `/app/${search}`);
      return;
    }

    // Route to API daemon (/api)
    if (parsedPath.startsWith('/api') || parsedPath.startsWith('/esedre/api')) {
      proxyRequest(req, res, getApiPort(), (p) => {
        return p.replace(/^\/esedre\/api/, '/api');
      });
      return;
    }

    // Route to UI static server (/app or static /assets)
    if (parsedPath.startsWith('/app') || parsedPath.startsWith('/esedre/app') || parsedPath.startsWith('/assets/')) {
      proxyRequest(req, res, getUiPort(), (p) => {
        return p.replace(/^\/esedre\/app/, '/app');
      });
      return;
    }

    // Fallback: proxy to UI server
    proxyRequest(req, res, getUiPort());
  });

  gatewayServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\x1b[31mError: Port ${gatewayPort} is already in use by another process.\x1b[0m`);
    } else {
      console.error(`\x1b[31mGateway Server Error: ${err.message}\x1b[0m`);
    }
  });

  gatewayServer.listen(gatewayPort, '0.0.0.0', () => {
    // Gateway listening
  });

  return {
    gatewayServer,
    uiServer,
    apiServer,
    close: async () => {
      await Promise.all([
        new Promise((resolve) => gatewayServer.close(resolve)),
        new Promise((resolve) => uiServer.close(resolve)),
        new Promise((resolve) => apiServer.close(resolve)),
      ]);
    },
  };
}
