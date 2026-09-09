import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startGatewayCluster, EsedreServerCluster } from '../src/server/gateway.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

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

describe('Esedre Gateway & Reverse Proxy Cluster', () => {
  let cluster: EsedreServerCluster | null = null;
  const GATEWAY_PORT = 5990;
  const UI_PORT = 5991;
  const API_PORT = 5992;

  afterAll(async () => {
    if (cluster) {
      await cluster.close();
    }
  });

  it('starts gateway cluster, rewrites / to /app, and proxies /api', async () => {
    const rawStorage = new FilesystemStorageAdapter(workspaceRoot);
    const storage = new SecurityFilter(rawStorage);

    cluster = startGatewayCluster({
      gatewayPort: GATEWAY_PORT,
      uiPort: UI_PORT,
      apiPort: API_PORT,
      storage,
      workspaceRoot,
    });

    // 1. Test / transparently rewrites to /app/ and returns 200 with HTML
    const rootRes = await httpGet(`http://127.0.0.1:${GATEWAY_PORT}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.body).toContain('<!DOCTYPE html>');
    expect(rootRes.body).toContain('Esedre');

    // 2. Test /index.html also transparently rewrites and returns 200 with HTML
    const indexRes = await httpGet(`http://127.0.0.1:${GATEWAY_PORT}/index.html`);
    expect(indexRes.status).toBe(200);
    expect(indexRes.body).toContain('<!DOCTYPE html>');

    // 3. Test /app serves index.html
    const appRes = await httpGet(`http://127.0.0.1:${GATEWAY_PORT}/app`);
    expect(appRes.status).toBe(200);
    expect(appRes.body).toContain('<!DOCTYPE html>');

    // 4. Test /api/planning/projects reverse-proxies to API daemon
    const apiRes = await httpGet(`http://127.0.0.1:${GATEWAY_PORT}/api/planning/projects`);
    expect(apiRes.status).toBe(200);
    const projects = JSON.parse(apiRes.body);
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some((p: any) => p.code.toUpperCase() === 'ESEDRE')).toBe(true);

    // 5. Test legacy /esedre/api/planning/projects alias also works
    const legacyApiRes = await httpGet(`http://127.0.0.1:${GATEWAY_PORT}/esedre/api/planning/projects`);
    expect(legacyApiRes.status).toBe(200);
  });
});
