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
import { validateProjectCode, validateProjectName, MAX_PROJECT_CODE_LENGTH } from '../src/config.js';

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

    it('is case-remembering on disk and case-insensitive on lookups and updates', async () => {
      const hubDir = path.join(tempDir, 'case-hub');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]', 'utf-8');

      const adapter = new FilesystemStorageAdapter(tempDir, {
        dataDir: hubDir,
      });

      // 1. Initial registration with mixed case 'Personal'
      const initial = await adapter.registerProject({
        code: 'Personal',
        name: 'Personal Projects',
      });
      expect(initial.code).toBe('Personal');
      expect(fs.existsSync(path.join(hubDir, 'projects', 'Personal'))).toBe(true);

      // 2. Re-registering with all-lowercase 'personal' preserves 'Personal' casing and reuses existing directory
      const updated = await adapter.registerProject({
        code: 'personal',
        name: 'Personal Projects Updated',
      });
      expect(updated.code).toBe('Personal');
      expect(updated.name).toBe('Personal Projects Updated');

      // Verify no duplicate directory was created on disk
      const dirEntries = fs.readdirSync(path.join(hubDir, 'projects'));
      const matchingDirs = dirEntries.filter((d) => d.toLowerCase() === 'personal');
      expect(matchingDirs.length).toBe(1);
      expect(matchingDirs[0]).toBe('Personal');

      // 3. Create ticket with lowercase 'personal'
      const ticket = await adapter.createTicket({
        title: 'Case sensitivity test',
        projectCode: 'personal',
      });
      expect(ticket.meta.project).toBe('Personal');
      expect(fs.existsSync(path.join(hubDir, 'projects', 'Personal', 'tickets', '1', 'meta.json'))).toBe(true);

      // 4. Case-insensitive lookups across Personal-1, personal-1, PERSONAL-1
      const t1 = await adapter.getTicket('Personal-1');
      const t2 = await adapter.getTicket('personal-1');
      const t3 = await adapter.getTicket('PERSONAL-1');
      expect(t1?.meta.id).toBe(1);
      expect(t2?.meta.id).toBe(1);
      expect(t3?.meta.id).toBe(1);
      expect(t1?.projectDescriptor?.code).toBe('Personal');

      // 5. Update ticket using uppercase lookup key: preserves canonical project code
      const updatedTicket = await adapter.updateTicket('PERSONAL-1', {
        status: 'In Development',
      });
      expect(updatedTicket.meta.status).toBe('In Development');
      expect(updatedTicket.meta.project).toBe('Personal');
    });

    it('handles multi-hub disambiguation by basename, warns when omitted, and handles collisions', async () => {
      const hub1 = path.join(tempDir, 'team-hub');
      fs.mkdirSync(path.join(hub1, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');

      const hub2 = path.join(tempDir, 'personal-hub');
      fs.mkdirSync(path.join(hub2, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub2, 'projects.json'), '[]', 'utf-8');

      const adapter = new FilesystemStorageAdapter(tempDir, {
        dataDir: [hub1, hub2],
      });

      // 1. Omitted hub when multiple hubs exist throws informative error listing hubs
      await expect(
        adapter.registerProject({
          code: 'PERS',
          name: 'Personal Project',
        })
      ).rejects.toThrow(/Multiple data hubs configured.*Please specify --hub/);

      // 2. Disambiguate by basename
      const proj = await adapter.registerProject({
        code: 'PERS',
        name: 'Personal Project',
        hub: 'personal-hub',
      });
      expect(proj.code).toBe('PERS');
      expect(fs.existsSync(path.join(hub2, 'projects', 'PERS', 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(hub1, 'projects', 'PERS', 'project.json'))).toBe(false);

      // 3. Collision handling when two hubs have the same basename
      const nestedDir = path.join(tempDir, 'nested');
      const hub3 = path.join(nestedDir, 'personal-hub');
      fs.mkdirSync(path.join(hub3, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub3, 'projects.json'), '[]', 'utf-8');

      const collidingAdapter = new FilesystemStorageAdapter(tempDir, {
        dataDir: [hub2, hub3],
      });

      await expect(
        collidingAdapter.registerProject({
          code: 'COLL',
          name: 'Colliding Hub Project',
          hub: 'personal-hub',
        })
      ).rejects.toThrow(/Hub name collision.*Please specify by unambiguous path/);

      // Resolving with exact path succeeds
      const exactProj = await collidingAdapter.registerProject({
        code: 'COLL',
        name: 'Colliding Hub Project',
        hub: hub3,
      });
      expect(exactProj.code).toBe('COLL');
      expect(fs.existsSync(path.join(hub3, 'projects', 'COLL', 'project.json'))).toBe(true);
    });

    it('rejects when specified hub does not match any configured hub', async () => {
      const hub1 = path.join(tempDir, 'hub-one');
      fs.mkdirSync(path.join(hub1, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');

      const adapter = new FilesystemStorageAdapter(tempDir, {
        dataDir: hub1,
      });

      await expect(
        adapter.registerProject({
          code: 'FOO',
          name: 'Foo Project',
          hub: 'non-existent-hub',
        })
      ).rejects.toThrow(/Hub "non-existent-hub" not found/);
    });

    it('validates project code up to MAX_PROJECT_CODE_LENGTH (8 characters)', () => {
      expect(MAX_PROJECT_CODE_LENGTH).toBe(8);

      // Valid 1 to 8 character codes
      expect(validateProjectCode('P').valid).toBe(true);
      expect(validateProjectCode('CORE').valid).toBe(true);
      expect(validateProjectCode('Personal').valid).toBe(true);
      expect(validateProjectCode('12345678').valid).toBe(true);

      // Invalid: 9 or more characters
      const overLimit = validateProjectCode('PersonalX');
      expect(overLimit.valid).toBe(false);
      expect(overLimit.error).toContain('1 to 8 alphanumeric characters');

      // Invalid characters
      expect(validateProjectCode('Pers-1').valid).toBe(false);
      expect(validateProjectCode('Pers_1').valid).toBe(false);
      expect(validateProjectCode('Pers 1').valid).toBe(false);
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
      expect(config.port).toBeUndefined();

      const snapshot = JSON.parse(fs.readFileSync(path.join(tempDir, '.esedre', 'snapshot.json'), 'utf-8'));
      expect(snapshot.projectCode).toBe('ALCE');
    });

    it('preserves explicit --port override in .esedre/esedre.json when provided', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');
      const customDir = path.join(tempDir, 'custom-port');
      fs.mkdirSync(customDir, { recursive: true });

      execFileSync(
        process.execPath,
        [cliPath, 'init', '--project', 'BETA', '--port', '5780', '--no-mcp', '--no-proxy', '-y'],
        {
          cwd: customDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      const config = JSON.parse(fs.readFileSync(path.join(customDir, '.esedre', 'esedre.json'), 'utf-8'));
      expect(config.projectCode).toBe('BETA');
      expect(config.port).toBe(5780);
    });

    it('registers workspaceless project into configured dataDir without overwriting active workspace', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      // 1. Create a data hub
      const hubDir = path.join(tempDir, 'central-hub');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]', 'utf-8');

      // 2. Create an active workspace initialized as "MAIN"
      const mainWorkspace = path.join(tempDir, 'main-repo');
      fs.mkdirSync(path.join(mainWorkspace, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(mainWorkspace, '.esedre', 'esedre.json'),
        JSON.stringify({
          version: '0.1.0',
          projectCode: 'MAIN',
          projectName: 'Main Engine',
          dataDir: '../central-hub',
        }, null, 2) + '\n',
        'utf-8'
      );

      // 3. Run ese init from inside main-repo targeting new project PERS
      const output = execFileSync(
        process.execPath,
        [cliPath, 'init', '--project', 'PERS', '--name', 'Personal Projects', '-y'],
        {
          cwd: mainWorkspace,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      expect(output).toContain("Registered project 'PERS' (Personal Projects) in Esedre data hub");

      // 4. Verify main-repo's workspace config was NOT overwritten
      const mainConfig = JSON.parse(
        fs.readFileSync(path.join(mainWorkspace, '.esedre', 'esedre.json'), 'utf-8')
      );
      expect(mainConfig.projectCode).toBe('MAIN');
      expect(mainConfig.projectName).toBe('Main Engine');

      // 5. Verify PERS was registered in central-hub
      const persProjectJson = path.join(hubDir, 'projects', 'PERS', 'project.json');
      expect(fs.existsSync(persProjectJson)).toBe(true);
      const persData = JSON.parse(fs.readFileSync(persProjectJson, 'utf-8'));
      expect(persData.code).toBe('PERS');
      expect(persData.name).toBe('Personal Projects');

      expect(fs.existsSync(path.join(hubDir, 'projects', 'PERS', 'tickets'))).toBe(true);

      const hubProjects = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects.json'), 'utf-8'));
      expect(hubProjects.some((p: any) => p.code === 'PERS')).toBe(true);
    });

    it('CLI disambiguates multi-hub project creation via --hub flag', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      // Create two distinct hubs
      const hub1 = path.join(tempDir, 'team-hub');
      const hub2 = path.join(tempDir, 'personal-hub');
      fs.mkdirSync(path.join(hub1, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');
      fs.mkdirSync(path.join(hub2, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub2, 'projects.json'), '[]', 'utf-8');

      // Create workspace configured with both hubs
      const repo = path.join(tempDir, 'multi-hub-repo');
      fs.mkdirSync(path.join(repo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, '.esedre', 'esedre.json'),
        JSON.stringify({
          version: '0.1.0',
          projectCode: 'MREPO',
          projectName: 'Multi Hub Repo',
          dataDir: [hub1, hub2],
        }, null, 2) + '\n',
        'utf-8'
      );

      // Execute ese init targeting personal-hub
      const output = execFileSync(
        process.execPath,
        [cliPath, 'init', '--project', 'PHUB', '--name', 'Personal Hub Project', '--hub', 'personal-hub', '-y'],
        {
          cwd: repo,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store-multi'),
          },
        }
      );

      expect(output).toContain("Registered project 'PHUB' (Personal Hub Project) in Esedre data hub");
      expect(fs.existsSync(path.join(hub2, 'projects', 'PHUB', 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(hub1, 'projects', 'PHUB', 'project.json'))).toBe(false);
    });

    it('CLI rejects multi-hub project creation when --hub flag is omitted and lists available hubs', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const hub1 = path.join(tempDir, 'hub-alpha');
      const hub2 = path.join(tempDir, 'hub-beta');
      fs.mkdirSync(path.join(hub1, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');
      fs.mkdirSync(path.join(hub2, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub2, 'projects.json'), '[]', 'utf-8');

      const repo = path.join(tempDir, 'ambiguous-repo');
      fs.mkdirSync(path.join(repo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, '.esedre', 'esedre.json'),
        JSON.stringify({
          version: '0.1.0',
          projectCode: 'AMBIG',
          dataDir: [hub1, hub2],
        }, null, 2) + '\n',
        'utf-8'
      );

      let threw = false;
      try {
        execFileSync(
          process.execPath,
          [cliPath, 'init', '--project', 'FAILP', '-y'],
          {
            cwd: repo,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store-fail'),
            },
          }
        );
      } catch (err: any) {
        threw = true;
        expect(err.status).toBe(1);
        const stderr = err.stderr ? err.stderr.toString() : '';
        expect(stderr).toContain('Multiple data hubs configured. Please specify --hub');
        expect(stderr).toContain('hub-alpha');
        expect(stderr).toContain('hub-beta');
      }
      expect(threw).toBe(true);
    });

    it('CLI inside a data hub directory registers project without creating .esedre/esedre.json in hub', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const standaloneHub = path.join(tempDir, 'standalone-hub');
      fs.mkdirSync(path.join(standaloneHub, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(standaloneHub, 'projects.json'), '[]', 'utf-8');

      const output = execFileSync(
        process.execPath,
        [cliPath, 'init', '--project', 'INDIR', '--name', 'Inside Hub Project', '-y'],
        {
          cwd: standaloneHub,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store-hub'),
          },
        }
      );

      expect(output).toContain("Registered project 'INDIR' (Inside Hub Project) in Esedre data hub");
      expect(fs.existsSync(path.join(standaloneHub, 'projects', 'INDIR', 'project.json'))).toBe(true);
      // Ensure .esedre/esedre.json was NOT created in the hub root
      expect(fs.existsSync(path.join(standaloneHub, '.esedre', 'esedre.json'))).toBe(false);
    });

    it('CLI supports --json mode for workspaceless project registration', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const jsonHub = path.join(tempDir, 'json-hub');
      fs.mkdirSync(path.join(jsonHub, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(jsonHub, 'projects.json'), '[]', 'utf-8');

      const output = execFileSync(
        process.execPath,
        [cliPath, 'init', '--project', 'JSONP', '--name', 'JSON Project', '--hub', jsonHub, '-y', '--json'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store-json'),
          },
        }
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.project.code).toBe('JSONP');
      expect(parsed.project.name).toBe('JSON Project');
      expect(parsed.registeredInHub).toBe(true);
      expect(parsed.commands.create).toContain('ese create');
      expect(parsed.commands.list).toContain('ese list');
    });

    it('storage adapter detects and warns on duplicate project codes across hubs', async () => {
      const hub1 = path.join(tempDir, 'warn-hub-1');
      const hub2 = path.join(tempDir, 'warn-hub-2');
      fs.mkdirSync(path.join(hub1, 'projects', 'DUP', 'tickets'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');
      fs.mkdirSync(path.join(hub2, 'projects', 'DUP', 'tickets'), { recursive: true });
      fs.writeFileSync(path.join(hub2, 'projects.json'), '[]', 'utf-8');

      const adapter = new FilesystemStorageAdapter(tempDir, {
        dataDir: [hub1, hub2],
      });

      const warnings = adapter.getDuplicateProjectWarnings();
      expect(warnings.length).toBe(1);
      expect(warnings[0].code.toUpperCase()).toBe('DUP');
      expect(warnings[0].firstHub).toBe(hub1);
      expect(warnings[0].duplicateHub).toBe(hub2);
    });

    it('rejects registering a project code that already exists in another hub', async () => {
      const hub1 = path.join(tempDir, 'exist-hub-1');
      const hub2 = path.join(tempDir, 'exist-hub-2');
      fs.mkdirSync(path.join(hub1, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');
      fs.mkdirSync(path.join(hub2, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hub2, 'projects.json'), '[]', 'utf-8');

      const adapter = new FilesystemStorageAdapter(tempDir, {
        dataDir: [hub1, hub2],
      });

      // Register CODE in hub1
      await adapter.registerProject({
        code: 'UNIQUE',
        name: 'Unique Project',
        hub: hub1,
      });

      // Attempt to register same CODE in hub2
      await expect(
        adapter.registerProject({
          code: 'UNIQUE',
          name: 'Conflicting Project',
          hub: hub2,
        })
      ).rejects.toThrow(/already exists in another data hub \(exist-hub-1\).*Duplicate project codes across hubs are not supported/);
    });

    it('CLI warns on duplicate project codes across hubs during ese projects', () => {
      const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const hub1 = path.join(tempDir, 'cli-warn-hub-1');
      const hub2 = path.join(tempDir, 'cli-warn-hub-2');
      fs.mkdirSync(path.join(hub1, 'projects', 'CLIDUP', 'tickets'), { recursive: true });
      fs.writeFileSync(path.join(hub1, 'projects.json'), '[]', 'utf-8');
      fs.mkdirSync(path.join(hub2, 'projects', 'CLIDUP', 'tickets'), { recursive: true });
      fs.writeFileSync(path.join(hub2, 'projects.json'), '[]', 'utf-8');

      const repo = path.join(tempDir, 'cli-warn-repo');
      fs.mkdirSync(path.join(repo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, '.esedre', 'esedre.json'),
        JSON.stringify({
          version: '0.1.0',
          projectCode: 'WARNREPO',
          dataDir: [hub1, hub2],
        }, null, 2) + '\n',
        'utf-8'
      );

      const output = execFileSync(
        process.execPath,
        [cliPath, 'projects'],
        {
          cwd: repo,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store-cli-warn'),
          },
        }
      );

      expect(output).toContain('CLIDUP');
    });
  });
});

