import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

describe('Esedre CLI Security & Project Isolation Integration', () => {
  let tempDir: string;
  let cliScriptPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-cli-sec-'));
    cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    const projectsDir = path.join(tempDir, 'src', 'data', 'planning', 'projects');
    const nestedDir = path.join(tempDir, 'nested', 'deep', 'subdir');
    const esedreDir = path.join(tempDir, '.esedre');
    fs.mkdirSync(ticketsDir, { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.mkdirSync(esedreDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-repo' }));

    // .esedre/esedre.json: ONLY Core and Docs allowed. Web is forbidden!
    fs.writeFileSync(
      path.join(esedreDir, 'esedre.json'),
      JSON.stringify({
        projectCode: 'Core',
        allowedProjects: ['Core', 'Docs'],
      }, null, 2)
    );

    // projects.json
    fs.writeFileSync(
      path.join(projectsDir, 'projects.json'),
      JSON.stringify([
        { id: 1, code: 'Core', slug: 'core', name: 'Core Application' },
        { id: 2, code: 'Web', slug: 'web', name: 'Web Client' },
        { id: 3, code: 'Docs', slug: 'docs', name: 'Documentation' },
      ], null, 2)
    );

    // Seed tickets: #1 (Core), #2 (Web), #3 (Docs)
    const seed = (id: number, title: string, projectId: number, projectCode: string) => {
      const dir = path.join(ticketsDir, String(id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        JSON.stringify({ id, title, category: 'Feature', projectId, project: projectCode, status: 'Planned' })
      );
      fs.writeFileSync(path.join(dir, 'detail.md'), `# Ticket #${id}: ${title}`);
    };
    seed(1, 'Core Feature', 1, 'Core');
    seed(2, 'Web Client Feature', 2, 'Web');
    seed(3, 'Esedre Engine Feature', 3, 'Esedre');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const runCli = (args: string[], cwd: string = tempDir): { stdout: string; stderr: string; status: number } => {
    try {
      const stdout = execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { stdout, stderr: '', status: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || '',
        status: err.status ?? 1,
      };
    }
  };

  it('defaults list to active repo project in .esedre/esedre.json (Core)', () => {
    const res = runCli(['list', '--json']);
    expect(res.status).toBe(0);
    const tickets = JSON.parse(res.stdout);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].id).toBe(1);
    expect(tickets[0].project).toBe('Core');
  });

  it('permits listing other authorized projects (Esedre)', () => {
    const res = runCli(['list', '--project', 'Docs', '--json']);
    expect(res.status).toBe(0);
    const tickets = JSON.parse(res.stdout);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].id).toBe(3);
    expect(tickets[0].project).toBe('Docs');
  });

  it('permits listing all authorized projects via --project all', () => {
    const res = runCli(['list', '--project', 'all', '--json']);
    expect(res.status).toBe(0);
    const tickets = JSON.parse(res.stdout);
    expect(tickets).toHaveLength(2); // Core (1) and Docs (3). Web (2) is hidden!
    const ids = tickets.map((t: any) => t.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  it('strictly blocks list --project Web with Access Denied exit status', () => {
    const res = runCli(['list', '--project', 'Web']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Access Denied');
    expect(res.stderr).toContain('Web');
  });

  it('strictly blocks get <unauthorizedId> with Access Denied', () => {
    const res = runCli(['get', '2']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Access Denied');
  });

  it('strictly blocks create under unauthorized project', () => {
    const res = runCli(['create', '--title', 'Unauthorized Feature', '--project', 'Web']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Access Denied');
  });

  it('crawls upward to find .esedre/esedre.json when executed from deep subdirectories', () => {
    const deepDir = path.join(tempDir, 'nested', 'deep', 'subdir');
    const res = runCli(['list', '--json'], deepDir);
    expect(res.status).toBe(0);
    const tickets = JSON.parse(res.stdout);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].project).toBe('Core');
  });
});
