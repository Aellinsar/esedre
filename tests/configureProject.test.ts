import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { configureWorkspace } from '../src/upgrade.js';
import { startApiServer } from '../src/server/apiServer.js';

function request(
  url: string,
  method: string = 'GET',
  body?: any
): Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = body ? JSON.stringify(body) : undefined;
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json',
    };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
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

describe('Project Registration & Configure Onboarding', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-configure-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('FilesystemStorageAdapter.registerProject', () => {
    it('registers a new project in standalone in-repo storage', async () => {
      const adapter = new FilesystemStorageAdapter(tempDir, { projectCode: 'ALCE' });
      const proj = await adapter.registerProject({
        code: 'ALCE',
        name: 'Alce Web Reader',
        description: 'E-reader application',
      });

      expect(proj.code).toBe('ALCE');
      expect(proj.name).toBe('Alce Web Reader');
      expect(proj.slug).toBe('alce');

      // Verify files written
      const pJsonPath = path.join(tempDir, '.esedre', 'project.json');
      expect(fs.existsSync(pJsonPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
      expect(saved.name).toBe('Alce Web Reader');

      const ticketsDir = path.join(tempDir, '.esedre', 'tickets');
      expect(fs.existsSync(ticketsDir)).toBe(true);

      // Verify getProjects lists it
      const projs = await adapter.getProjects();
      expect(projs.some((p) => p.code === 'ALCE' && p.name === 'Alce Web Reader')).toBe(true);
    });

    it('registers a new project in a hub data directory', async () => {
      const hubDir = path.join(tempDir, 'hub-data');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]', 'utf-8');

      const workspaceDir = path.join(tempDir, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const adapter = new FilesystemStorageAdapter(workspaceDir, {
        projectCode: 'DOCS',
        dataDir: '../hub-data',
      });

      const proj = await adapter.registerProject({
        code: 'DOCS',
        name: 'Developer Documentation',
      });

      expect(proj.code).toBe('DOCS');
      expect(proj.name).toBe('Developer Documentation');

      const hubProjectDir = path.join(hubDir, 'projects', 'DOCS');
      expect(fs.existsSync(path.join(hubProjectDir, 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(hubProjectDir, 'tickets'))).toBe(true);

      const hubProjectsArr = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects.json'), 'utf-8'));
      expect(hubProjectsArr.some((p: any) => p.code === 'DOCS')).toBe(true);
    });

    it('updates existing project name idempotently', async () => {
      const adapter = new FilesystemStorageAdapter(tempDir, { projectCode: 'ALCE' });
      await adapter.registerProject({
        code: 'ALCE',
        name: 'Alce Initial',
      });

      const updated = await adapter.registerProject({
        code: 'ALCE',
        name: 'Alce Updated Display Name',
      });

      expect(updated.name).toBe('Alce Updated Display Name');
      const saved = JSON.parse(fs.readFileSync(path.join(tempDir, '.esedre', 'project.json'), 'utf-8'));
      expect(saved.name).toBe('Alce Updated Display Name');
    });
  });

  describe('configureWorkspace', () => {
    it('creates .esedre/esedre.json with projectCode and projectName', () => {
      const res = configureWorkspace(tempDir, {
        projectCode: 'ALCE',
        projectName: 'Alce Web Reader',
        port: 5674,
      });

      expect(res.esedreJsonCreatedOrUpdated).toBe(true);
      expect(res.projectRegistered).toBe(true);
      expect(res.projectName).toBe('Alce Web Reader');

      const config = JSON.parse(fs.readFileSync(path.join(tempDir, '.esedre', 'esedre.json'), 'utf-8'));
      expect(config.projectCode).toBe('ALCE');
      expect(config.projectName).toBe('Alce Web Reader');
      expect(config.allowedProjects).toEqual(['ALCE']);

      // Auto-created in-repo project.json
      const projectJson = JSON.parse(fs.readFileSync(path.join(tempDir, '.esedre', 'project.json'), 'utf-8'));
      expect(projectJson.code).toBe('ALCE');
      expect(projectJson.name).toBe('Alce Web Reader');
    });
  });

  describe('REST API POST /api/planning/create-project', () => {
    let server: http.Server;
    let baseUrl = '';

    beforeEach(async () => {
      const rawStorage = new FilesystemStorageAdapter(tempDir, { projectCode: 'ALCE' });
      const storage = new SecurityFilter(rawStorage, { projectCode: 'ALCE', allowedProjects: ['*'] });
      server = startApiServer(0, storage, tempDir);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('creates project via POST /api/planning/create-project', async () => {
      const res = await request(`${baseUrl}/api/planning/create-project`, 'POST', {
        code: 'TEST',
        name: 'Test Project',
        description: 'Testing REST project creation',
      });

      expect(res.status).toBe(201);
      const json = res.json();
      expect(json.code).toBe('TEST');
      expect(json.name).toBe('Test Project');

      // Verify listed in /api/planning/projects
      const listRes = await request(`${baseUrl}/api/planning/projects`);
      expect(listRes.status).toBe(200);
      const list = listRes.json();
      expect(list.some((p: any) => p.code === 'TEST')).toBe(true);
    });

    it('rejects invalid project code', async () => {
      const res = await request(`${baseUrl}/api/planning/create-project`, 'POST', {
        code: 'TOOLONGCODE',
        name: 'Invalid Code',
      });

      expect(res.status).toBe(400);
      const json = res.json();
      expect(json.error).toContain('alphanumeric characters');
    });
  });

  describe('CLI configure command integration', () => {
    it('executes configure command and produces snapshot and guided config', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const output = execFileSync(
        process.execPath,
        [cliPath, 'init', '--project', 'ALCE', '--name', 'Alce Reader', '--no-mcp', '--no-proxy', '-y'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      expect(output).toContain('Esedre workspace initialized successfully');
      expect(output).toContain('Registered new project \'ALCE\' (Alce Reader) in Esedre');
      expect(output).toContain('Start the background server:');
      expect(output).toContain('ese start');
      expect(output).toContain('http://localhost:5674/app?project=ALCE');
      expect(output).toContain('ese create --title "First feature" --type Feature --project ALCE');

      const config = JSON.parse(fs.readFileSync(path.join(tempDir, '.esedre', 'esedre.json'), 'utf-8'));
      expect(config.projectCode).toBe('ALCE');
      expect(config.projectName).toBe('Alce Reader');

      const snapshot = JSON.parse(fs.readFileSync(path.join(tempDir, '.esedre', 'snapshot.json'), 'utf-8'));
      expect(snapshot.projectCode).toBe('ALCE');
    });
  });
});
