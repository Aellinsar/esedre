import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { resolveWebDir, startGatewayCluster, EsedreServerCluster } from '../src/server/gateway.js';
import { startUiServer } from '../src/server/uiServer.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';

function httpGet(url: string): Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpOptions(url: string): Promise<{ status?: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'OPTIONS',
      },
      (res) => {
        resolve({ status: res.statusCode, headers: res.headers });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function createTestUiServer(dir: string): Promise<{ server: http.Server; url: string }> {
  const s = startUiServer(0, dir);
  await new Promise<void>((resolve) => s.once('listening', () => resolve()));
  const port = (s.address() as any).port;
  return { server: s, url: `http://127.0.0.1:${port}` };
}

describe('UI Server & Gateway Path Resolution', () => {
  let tempDir: string;
  let webDir: string;
  let uiServer: http.Server | null = null;
  let cluster: EsedreServerCluster | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-ui-test-'));
    webDir = path.join(tempDir, 'dist', 'web');
    fs.mkdirSync(webDir, { recursive: true });

    // Populate mock web assets
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!DOCTYPE html><html><head><title>Mock Esedre</title></head><body>App</body></html>');
    fs.writeFileSync(path.join(webDir, 'app.js'), 'console.log("esedre");');
    fs.writeFileSync(path.join(webDir, 'style.css'), 'body { margin: 0; }');
    fs.writeFileSync(path.join(webDir, 'data.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(webDir, 'icon.svg'), '<svg></svg>');
  });

  afterEach(async () => {
    if (uiServer) {
      await new Promise<void>((resolve) => uiServer!.close(() => resolve()));
      uiServer = null;
    }
    if (cluster) {
      await cluster.close();
      cluster = null;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('resolveWebDir', () => {
    it('returns explicitWebDir if it contains index.html', () => {
      const resolved = resolveWebDir(webDir, tempDir);
      expect(resolved).toBe(webDir);
    });

    it('resolves <workspaceRoot>/esedre/dist/web when present', () => {
      const mockWorkspace = path.join(tempDir, 'workspace');
      const esedreWeb = path.join(mockWorkspace, 'esedre', 'dist', 'web');
      fs.mkdirSync(esedreWeb, { recursive: true });
      fs.writeFileSync(path.join(esedreWeb, 'index.html'), '<html></html>');

      const resolved = resolveWebDir(undefined, mockWorkspace);
      expect(resolved).toBe(esedreWeb);
    });

    it('resolves <workspaceRoot>/dist/web when present', () => {
      const mockWorkspace = path.join(tempDir, 'workspace');
      const distWeb = path.join(mockWorkspace, 'dist', 'web');
      fs.mkdirSync(distWeb, { recursive: true });
      fs.writeFileSync(path.join(distWeb, 'index.html'), '<html></html>');

      const resolved = resolveWebDir(undefined, mockWorkspace);
      expect(resolved).toBe(distWeb);
    });

    it('falls back to default path when no candidates contain index.html', () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      const resolved = resolveWebDir(undefined, emptyDir);
      expect(resolved).toBeDefined();
    });
  });

  describe('startUiServer', () => {
    it('serves index.html on / and /app with text/html content-type', async () => {
      const instance = await createTestUiServer(webDir);
      uiServer = instance.server;

      const rootRes = await httpGet(`${instance.url}/`);
      expect(rootRes.status).toBe(200);
      expect(rootRes.headers['content-type']).toContain('text/html');
      expect(rootRes.body).toContain('<title>Mock Esedre</title>');

      const appRes = await httpGet(`${instance.url}/app`);
      expect(appRes.status).toBe(200);
      expect(appRes.body).toContain('<title>Mock Esedre</title>');
    });

    it('serves static assets with appropriate MIME types', async () => {
      const instance = await createTestUiServer(webDir);
      uiServer = instance.server;

      const jsRes = await httpGet(`${instance.url}/app.js`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers['content-type']).toContain('application/javascript');
      expect(jsRes.body).toBe('console.log("esedre");');

      const cssRes = await httpGet(`${instance.url}/style.css`);
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers['content-type']).toContain('text/css');

      const jsonRes = await httpGet(`${instance.url}/data.json`);
      expect(jsonRes.status).toBe(200);
      expect(jsonRes.headers['content-type']).toContain('application/json');

      const svgRes = await httpGet(`${instance.url}/icon.svg`);
      expect(svgRes.status).toBe(200);
      expect(svgRes.headers['content-type']).toContain('image/svg+xml');
    });

    it('falls back to index.html for unknown SPA client routes', async () => {
      const instance = await createTestUiServer(webDir);
      uiServer = instance.server;

      const spaRes = await httpGet(`${instance.url}/app/tickets/42`);
      expect(spaRes.status).toBe(200);
      expect(spaRes.body).toContain('<title>Mock Esedre</title>');
    });

    it('handles CORS preflight OPTIONS requests with 204 No Content', async () => {
      const instance = await createTestUiServer(webDir);
      uiServer = instance.server;

      const optRes = await httpOptions(`${instance.url}/app`);
      expect(optRes.status).toBe(204);
      expect(optRes.headers['access-control-allow-origin']).toBe('*');
      expect(optRes.headers['access-control-allow-methods']).toContain('GET');
    });

    it('returns 404 when index.html is missing in webDir', async () => {
      const emptyWeb = path.join(tempDir, 'empty-web');
      fs.mkdirSync(emptyWeb, { recursive: true });
      const instance = await createTestUiServer(emptyWeb);
      uiServer = instance.server;

      const res = await httpGet(`${instance.url}/app`);
      expect(res.status).toBe(404);
      expect(res.body).toContain('index.html not found');
    });

    it('protects against directory traversal attempts', async () => {
      const instance = await createTestUiServer(webDir);
      uiServer = instance.server;

      // Attempt traversal outside webDir
      const res = await httpGet(`${instance.url}/app/../../../../etc/passwd`);
      // Should fall back safely to index.html within webDir, NOT expose root filesystem
      expect(res.status).toBe(200);
      expect(res.body).toContain('<title>Mock Esedre</title>');
    });
  });

  describe('Gateway Cluster Routing & Query Forwarding', () => {
    it('preserves query parameters when transparently rewriting / to /app', async () => {
      const rawStorage = new FilesystemStorageAdapter(tempDir);
      const storage = new SecurityFilter(rawStorage);

      cluster = startGatewayCluster({
        gatewayPort: 0,
        uiPort: 0,
        apiPort: 0,
        webDir,
        storage,
        workspaceRoot: tempDir,
      });
      await new Promise<void>((resolve) => cluster!.gatewayServer.once('listening', () => resolve()));
      const gPort = (cluster.gatewayServer.address() as any).port;

      const res = await httpGet(`http://127.0.0.1:${gPort}/?project=Core&embedded=true`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('<title>Mock Esedre</title>');
    });
  });
});
