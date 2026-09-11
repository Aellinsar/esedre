import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { startApiServer } from '../src/server/apiServer.js';

function request(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = body ? JSON.stringify(body) : undefined;
    const reqHeaders: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => (resBody += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: resBody,
            json: () => (resBody ? JSON.parse(resBody) : null),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

describe('Server-Side Security Filtering & Dynamic Config Reloading', () => {
  let tempDir: string;
  let hubDir: string;
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-server-security-'));
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-hub-'));

    // Create hub projects: AlceWeb and Profe
    const hubProjectsDir = path.join(hubDir, 'projects');
    fs.mkdirSync(hubProjectsDir, { recursive: true });

    // Project 1: AlceWeb
    const alceWebDir = path.join(hubProjectsDir, 'AlceWeb');
    fs.mkdirSync(path.join(alceWebDir, 'tickets', '1'), { recursive: true });
    fs.writeFileSync(
      path.join(alceWebDir, 'project.json'),
      JSON.stringify({ id: 1, code: 'AlceWeb', name: 'Alce Web Reader' }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(alceWebDir, 'tickets', '1', 'meta.json'),
      JSON.stringify({ id: 1, title: 'AlceWeb Reader Ticket', type: 'Feature', status: 'In Progress', project: 'AlceWeb' }, null, 2) + '\n'
    );

    // Project 2: Profe
    const profeDir = path.join(hubProjectsDir, 'Profe');
    fs.mkdirSync(path.join(profeDir, 'tickets', '1'), { recursive: true });
    fs.writeFileSync(
      path.join(profeDir, 'project.json'),
      JSON.stringify({ id: 2, code: 'Profe', name: 'Professor Arwam' }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(profeDir, 'tickets', '1', 'meta.json'),
      JSON.stringify({ id: 1, title: 'Profe Sleep Ticket', type: 'Feature', status: 'Backlog', project: 'Profe' }, null, 2) + '\n'
    );

    // Write projects.json at hub
    fs.writeFileSync(
      path.join(hubDir, 'projects.json'),
      JSON.stringify([
        { id: 1, code: 'AlceWeb', name: 'Alce Web Reader' },
        { id: 2, code: 'Profe', name: 'Professor Arwam' },
      ], null, 2) + '\n'
    );

    // Workspace config points to data hub, with portfolio access (allowedProjects: ['*'])
    const esedreDir = path.join(tempDir, '.esedre');
    fs.mkdirSync(esedreDir, { recursive: true });
    fs.writeFileSync(
      path.join(esedreDir, 'esedre.json'),
      JSON.stringify({
        projectCode: 'AlceWeb',
        dataDir: hubDir,
        allowedProjects: ['*'],
      }, null, 2) + '\n'
    );
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(hubDir, { recursive: true, force: true }); } catch {}
  });

  it('serves full portfolio data by default to Web UI', async () => {
    const adapter = new FilesystemStorageAdapter(tempDir, {
      dataDir: hubDir,
      allowedProjects: ['*'],
    });

    await new Promise<void>((resolve) => {
      server = startApiServer(0, adapter, tempDir);
      server.once('listening', () => {
        const addr = server!.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const res = await request(`${baseUrl}/api/planning/all`);
    expect(res.status).toBe(200);
    const data = res.json();
    expect(data.projects).toHaveLength(2);
    expect(data.projects.map((p: any) => p.code).sort()).toEqual(['AlceWeb', 'Profe']);
    expect(Object.keys(data.metas)).toContain('AlceWeb-1');
    expect(Object.keys(data.metas)).toContain('Profe-1');
  });

  it('enforces server-side isolation when request specifies x-esedre-allowed-projects header', async () => {
    const adapter = new FilesystemStorageAdapter(tempDir, {
      dataDir: hubDir,
      allowedProjects: ['*'],
    });

    await new Promise<void>((resolve) => {
      server = startApiServer(0, adapter, tempDir);
      server.once('listening', () => {
        const addr = server!.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Agent request restricted to AlceWeb
    const res = await request(`${baseUrl}/api/planning/all`, 'GET', {
      'x-esedre-allowed-projects': 'alceweb',
    });
    expect(res.status).toBe(200);
    const data = res.json();
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].code).toBe('AlceWeb');
    expect(Object.keys(data.metas)).toContain('AlceWeb-1');
    expect(Object.keys(data.metas)).not.toContain('Profe-1');

    // Attempting to access Profe-1 when scoped to AlceWeb throws 403 Forbidden
    const forbiddenRes = await request(`${baseUrl}/api/planning/ticket/Profe-1`, 'GET', {
      'x-esedre-allowed-projects': 'alceweb',
    });
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.json().error).toContain('outside this workspace\'s authorized scope');
  });

  it('enforces server-side isolation when query parameter allowedProjects is provided', async () => {
    const adapter = new FilesystemStorageAdapter(tempDir, {
      dataDir: hubDir,
      allowedProjects: ['*'],
    });

    await new Promise<void>((resolve) => {
      server = startApiServer(0, adapter, tempDir);
      server.once('listening', () => {
        const addr = server!.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const res = await request(`${baseUrl}/api/planning/tickets?allowedProjects=Profe`);
    expect(res.status).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].meta.project).toBe('Profe');
  });

  it('dynamically reloads configuration without requiring daemon restart', async () => {
    // Start adapter referencing workspaceRoot without explicit in-memory config
    const adapter = new FilesystemStorageAdapter(tempDir);
    const initialProjects = await adapter.getProjects();
    expect(initialProjects).toHaveLength(2);

    // Create a 3rd project in the hub on disk
    const hubProjectsDir = path.join(hubDir, 'projects');
    const personalDir = path.join(hubProjectsDir, 'Personal');
    fs.mkdirSync(path.join(personalDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(personalDir, 'project.json'),
      JSON.stringify({ id: 3, code: 'Personal', name: 'Personal Work' }, null, 2) + '\n'
    );

    // Dynamic config refresh immediately detects new project
    adapter.refreshConfig();
    const updatedProjects = await adapter.getProjects();
    expect(updatedProjects).toHaveLength(3);
    expect(updatedProjects.some((p) => p.code === 'Personal')).toBe(true);
  });

  it('registers project without slug property', async () => {
    const adapter = new FilesystemStorageAdapter(tempDir, { dataDir: hubDir });
    const registered = await adapter.registerProject({
      code: 'NewApp',
      name: 'New Application',
      description: 'Brand new app',
      hub: path.basename(hubDir),
    });

    expect(registered.code).toBe('NewApp');
    expect(registered.name).toBe('New Application');
    expect((registered as any).slug).toBeUndefined();

    // Verify project.json on disk does not contain slug
    const pJsonPath = path.join(hubDir, 'projects', 'NewApp', 'project.json');
    expect(fs.existsSync(pJsonPath)).toBe(true);
    const fileContent = fs.readFileSync(pJsonPath, 'utf-8');
    expect(fileContent.includes('"slug"')).toBe(false);
  });
});
