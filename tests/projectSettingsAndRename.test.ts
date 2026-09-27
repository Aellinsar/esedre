import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { createApiHandler } from '../src/server/apiServer.js';

describe('Project Settings & Rename Engine', () => {
  let tempDir: string;
  let hubDir: string;
  let workspaceDir: string;
  let adapter: FilesystemStorageAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-proj-settings-test-'));
    hubDir = path.join(tempDir, 'hub');
    workspaceDir = path.join(tempDir, 'workspace');

    fs.mkdirSync(hubDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Seed data hub with projects/Profe and projects/Alce
    const profeDir = path.join(hubDir, 'projects', 'Profe');
    const profeTickets = path.join(profeDir, 'tickets');
    fs.mkdirSync(profeTickets, { recursive: true });

    fs.writeFileSync(
      path.join(profeDir, 'project.json'),
      JSON.stringify(
        {
          id: 1,
          code: 'Profe',
          name: 'Professor Arwam',
          description: "Professor Arwam's Sleep Center",
          colors: { badge: 'badge-profe', dot: 'dot-profe', border: 'border-profe' },
        },
        null,
        2
      ) + '\n'
    );

    // Seed 2 tickets in Profe
    const t1Dir = path.join(profeTickets, '1');
    fs.mkdirSync(t1Dir, { recursive: true });
    fs.writeFileSync(
      path.join(t1Dir, 'meta.json'),
      JSON.stringify(
        { id: 1, title: 'Profe Ticket 1', type: 'Feature', category: 'Feature', status: 'Planned', project: 'Profe' },
        null,
        2
      ) + '\n'
    );

    const t2Dir = path.join(profeTickets, '2');
    fs.mkdirSync(t2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(t2Dir, 'meta.json'),
      JSON.stringify(
        { id: 2, title: 'Profe Ticket 2', type: 'Bug', category: 'Bug', status: 'Completed', project: 'Profe' },
        null,
        2
      ) + '\n'
    );

    // Seed Alce project in hub
    const alceDir = path.join(hubDir, 'projects', 'Alce');
    fs.mkdirSync(path.join(alceDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(alceDir, 'project.json'),
      JSON.stringify(
        {
          id: 2,
          code: 'Alce',
          name: 'Alce E-Reader',
          description: 'Alce project',
        },
        null,
        2
      ) + '\n'
    );

    // Seed hub projects.json
    fs.writeFileSync(
      path.join(hubDir, 'projects.json'),
      JSON.stringify(
        [
          { id: 1, code: 'Profe', name: 'Professor Arwam', description: "Professor Arwam's Sleep Center" },
          { id: 2, code: 'Alce', name: 'Alce E-Reader', description: 'Alce project' },
        ],
        null,
        2
      ) + '\n'
    );

    // Seed workspace .esedre/esedre.json
    const wsEsedreDir = path.join(workspaceDir, '.esedre');
    fs.mkdirSync(wsEsedreDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsEsedreDir, 'esedre.json'),
      JSON.stringify(
        {
          projectCode: 'Profe',
          projectName: 'Professor Arwam',
          allowedProjects: ['Profe', 'Alce'],
          dataDir: hubDir,
        },
        null,
        2
      ) + '\n'
    );

    adapter = new FilesystemStorageAdapter(workspaceDir, {
      projectCode: 'Profe',
      allowedProjects: ['Profe', 'Alce'],
      dataDir: hubDir,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('updateProject', () => {
    it('updates project display name, description, colors, and grounding context', async () => {
      const updated = await adapter.updateProject({
        code: 'Profe',
        name: 'Lab 151 Sleep Research',
        description: 'Migrated sleep research platform',
        colors: { badge: 'badge-new', dot: 'dot-new', border: 'border-new' },
        guidelinesRef: 'AGENTS.md',
        techStack: ['React 19', 'TypeScript', 'Vite'],
        groundingRules: ['Zero em dashes', 'Occ verification'],
      });

      expect(updated.code).toBe('Profe');
      expect(updated.name).toBe('Lab 151 Sleep Research');
      expect(updated.description).toBe('Migrated sleep research platform');
      expect(updated.guidelinesRef).toBe('AGENTS.md');
      expect(updated.techStack).toEqual(['React 19', 'TypeScript', 'Vite']);
      expect(updated.groundingRules).toEqual(['Zero em dashes', 'Occ verification']);

      // Verify project.json on disk was updated
      const pJson = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects', 'Profe', 'project.json'), 'utf-8'));
      expect(pJson.name).toBe('Lab 151 Sleep Research');
      expect(pJson.description).toBe('Migrated sleep research platform');
      expect(pJson.guidelinesRef).toBe('AGENTS.md');

      // Verify hub projects.json was updated
      const hubList = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects.json'), 'utf-8'));
      const profeEntry = hubList.find((p: any) => p.code === 'Profe');
      expect(profeEntry.name).toBe('Lab 151 Sleep Research');
    });

    it('rejects invalid project name', async () => {
      await expect(
        adapter.updateProject({
          code: 'Profe',
          name: '',
        })
      ).rejects.toThrow('Project name is required');

      await expect(
        adapter.updateProject({
          code: 'Profe',
          name: 'A'.repeat(50),
        })
      ).rejects.toThrow('exceeds maximum length');
    });

    it('throws error when project does not exist', async () => {
      await expect(
        adapter.updateProject({
          code: 'Nonexistent',
          name: 'New Name',
        })
      ).rejects.toThrow('Project "Nonexistent" not found');
    });
  });

  describe('renameProjectCode', () => {
    it('safely renames project code on disk, updating hub directories, manifests, tickets, and workspace configs', async () => {
      const result = await adapter.renameProjectCode({
        oldCode: 'Profe',
        newCode: 'Lab151',
        newName: 'Lab 151',
      });

      expect(result.success).toBe(true);
      expect(result.oldCode).toBe('Profe');
      expect(result.newCode).toBe('Lab151');
      expect(result.project.name).toBe('Lab 151');
      expect(result.migratedTicketsCount).toBe(2);

      // Verify old directory is gone and new directory exists
      expect(fs.existsSync(path.join(hubDir, 'projects', 'Profe'))).toBe(false);
      expect(fs.existsSync(path.join(hubDir, 'projects', 'Lab151'))).toBe(true);

      // Verify project.json has updated code
      const pJson = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects', 'Lab151', 'project.json'), 'utf-8'));
      expect(pJson.code).toBe('Lab151');
      expect(pJson.name).toBe('Lab 151');

      // Verify hub projects.json was updated
      const hubList = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects.json'), 'utf-8'));
      expect(hubList.some((p: any) => p.code === 'Profe')).toBe(false);
      const newEntry = hubList.find((p: any) => p.code === 'Lab151');
      expect(newEntry).toBeDefined();
      expect(newEntry.name).toBe('Lab 151');

      // Verify ticket meta.json files were updated with new project code
      const t1 = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects', 'Lab151', 'tickets', '1', 'meta.json'), 'utf-8'));
      expect(t1.project).toBe('Lab151');
      const t2 = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects', 'Lab151', 'tickets', '2', 'meta.json'), 'utf-8'));
      expect(t2.project).toBe('Lab151');

      // Verify workspace .esedre/esedre.json was synchronized
      const wsCfg = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.esedre', 'esedre.json'), 'utf-8'));
      expect(wsCfg.projectCode).toBe('Lab151');
      expect(wsCfg.projectName).toBe('Lab 151');
      expect(wsCfg.allowedProjects).toContain('Lab151');
      expect(wsCfg.allowedProjects).not.toContain('Profe');
    });

    it('rejects invalid project code format', async () => {
      await expect(
        adapter.renameProjectCode({
          oldCode: 'Profe',
          newCode: 'TOOLONGCODE',
        })
      ).rejects.toThrow('must be 1 to 8 alphanumeric characters');

      await expect(
        adapter.renameProjectCode({
          oldCode: 'Profe',
          newCode: 'BAD-CODE',
        })
      ).rejects.toThrow('must be 1 to 8 alphanumeric characters');
    });

    it('rejects collision with existing project code', async () => {
      await expect(
        adapter.renameProjectCode({
          oldCode: 'Profe',
          newCode: 'Alce',
        })
      ).rejects.toThrow('collides with existing project');
    });

    it('handles case-only rename without file collisions', async () => {
      const result = await adapter.renameProjectCode({
        oldCode: 'profe',
        newCode: 'PROFE',
      });

      expect(result.success).toBe(true);
      expect(result.newCode).toBe('PROFE');

      const pJson = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects', 'PROFE', 'project.json'), 'utf-8'));
      expect(pJson.code).toBe('PROFE');
    });
  });

  describe('REST API Endpoints', () => {
    it('handles POST /api/planning/update-project cleanly', async () => {
      const handler = createApiHandler(adapter, workspaceDir);

      let statusCode = 0;
      let responseBody = '';
      const mockReq: any = {
        url: '/api/planning/update-project',
        method: 'POST',
        headers: {},
        on(event: string, cb: any) {
          if (event === 'data') {
            cb(JSON.stringify({ code: 'Profe', name: 'Updated Via API' }));
          }
          if (event === 'end') {
            cb();
          }
          return this;
        },
      };

      const mockRes: any = {
        writeHead(code: number) {
          statusCode = code;
        },
        end(data?: string) {
          responseBody = data || '';
        },
      };

      const handled = await handler(mockReq, mockRes);
      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      const parsed = JSON.parse(responseBody);
      expect(parsed.name).toBe('Updated Via API');
    });

    it('handles POST /api/planning/rename-project cleanly', async () => {
      const handler = createApiHandler(adapter, workspaceDir);

      let statusCode = 0;
      let responseBody = '';
      const mockReq: any = {
        url: '/api/planning/rename-project',
        method: 'POST',
        headers: {},
        on(event: string, cb: any) {
          if (event === 'data') {
            cb(JSON.stringify({ oldCode: 'Profe', newCode: 'L151', newName: 'Lab 151' }));
          }
          if (event === 'end') {
            cb();
          }
          return this;
        },
      };

      const mockRes: any = {
        writeHead(code: number) {
          statusCode = code;
        },
        end(data?: string) {
          responseBody = data || '';
        },
      };

      const handled = await handler(mockReq, mockRes);
      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      const parsed = JSON.parse(responseBody);
      expect(parsed.success).toBe(true);
      expect(parsed.newCode).toBe('L151');
      expect(parsed.project.name).toBe('Lab 151');
    });

    it('returns 400 for missing code in update-project', async () => {
      const handler = createApiHandler(adapter, workspaceDir);

      let statusCode = 0;
      let responseBody = '';
      const mockReq: any = {
        url: '/api/planning/update-project',
        method: 'POST',
        headers: {},
        on(event: string, cb: any) {
          if (event === 'data') {
            cb(JSON.stringify({ name: 'No Code Provided' }));
          }
          if (event === 'end') {
            cb();
          }
          return this;
        },
      };

      const mockRes: any = {
        writeHead(code: number) {
          statusCode = code;
        },
        end(data?: string) {
          responseBody = data || '';
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(400);
      const parsed = JSON.parse(responseBody);
      expect(parsed.error).toContain('Project code is required');
    });
  });

  describe('CLI Commands', () => {
    it('executes ese rename-project Profe Lab151 --name "Lab 151" --json cleanly', async () => {
      const { execFile } = await import('node:child_process');
      const cliScript = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const runCli = (args: string[]) =>
        new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
          execFile(
            process.execPath,
            [cliScript, ...args],
            {
              cwd: workspaceDir,
              env: {
                ...process.env,
              },
            },
            (err, stdout, stderr) => {
              resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code: err ? (err as any).code || 1 : 0,
              });
            }
          );
        });

      const res = await runCli(['rename-project', 'Profe', 'Lab151', '--name', 'Lab 151', '--json']);
      expect(res.code).toBe(0);
      const data = JSON.parse(res.stdout);
      expect(data.success).toBe(true);
      expect(data.oldCode).toBe('Profe');
      expect(data.newCode).toBe('Lab151');
      expect(data.project.name).toBe('Lab 151');
      expect(data.migratedTicketsCount).toBe(2);

      // Verify filesystem state after CLI command
      expect(fs.existsSync(path.join(hubDir, 'projects', 'Profe'))).toBe(false);
      expect(fs.existsSync(path.join(hubDir, 'projects', 'Lab151'))).toBe(true);
    });

    it('executes ese project set Profe --name "New Title" --json cleanly', async () => {
      const { execFile } = await import('node:child_process');
      const cliScript = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const runCli = (args: string[]) =>
        new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
          execFile(
            process.execPath,
            [cliScript, ...args],
            {
              cwd: workspaceDir,
              env: {
                ...process.env,
              },
            },
            (err, stdout, stderr) => {
              resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code: err ? (err as any).code || 1 : 0,
              });
            }
          );
        });

      const res = await runCli(['project', 'set', 'Profe', '--name', 'New Title', '--json']);
      expect(res.code).toBe(0);
      const data = JSON.parse(res.stdout);
      expect(data.code).toBe('Profe');
      expect(data.name).toBe('New Title');

      const pJson = JSON.parse(fs.readFileSync(path.join(hubDir, 'projects', 'Profe', 'project.json'), 'utf-8'));
      expect(pJson.name).toBe('New Title');
    });
  });
});

