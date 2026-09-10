import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { EsedreAuthorizationError } from '../src/config.js';

describe('Esedre Agent Project Allow-List (SecurityFilter)', () => {
  let tempDir: string;
  let adapter: SecurityFilter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-allowlist-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    // Seed projects.json with 3 projects
    const projects = [
      { id: 1, code: 'Core', slug: 'core', name: 'Core Application', description: 'Main App' },
      { id: 2, code: 'Web', slug: 'web', name: 'Web Client', description: 'Web Client' },
      { id: 3, code: 'Docs', slug: 'docs', name: 'Documentation', description: 'Docs' },
    ];
    fs.writeFileSync(
      path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
      JSON.stringify(projects, null, 2)
    );

    // Seed tickets:
    // Ticket 1: Core (authorized)
    // Ticket 2: Web (unauthorized)
    // Ticket 3: Docs (authorized)
    const seedTicket = (id: number, title: string, projectId: number, projectCode: string) => {
      const dir = path.join(ticketsDir, String(id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        JSON.stringify({
          id,
          title,
          type: 'Feature',
          projectId,
          project: projectCode,
          status: 'Planned',
        }, null, 2)
      );
      fs.writeFileSync(path.join(dir, 'detail.md'), `# Ticket #${id}: ${title}\n\n### Summary\nTest summary.`);
      fs.writeFileSync(path.join(dir, 'implementation_plan.md'), `# Implementation Plan for #${id}\n- Step 1`);
    };

    seedTicket(1, 'Authorized Core Feature', 1, 'Core');
    seedTicket(2, 'Restricted Web Feature', 2, 'Web');
    seedTicket(3, 'Authorized Docs Feature', 3, 'Docs');

    const raw = new FilesystemStorageAdapter(tempDir);
    adapter = new SecurityFilter(raw, {
      projectCode: 'Profe',
      allowedProjects: ['Core', 'Docs'],
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('filters out unauthorized projects from getProjects()', async () => {
    const projects = await adapter.getProjects();
    const codes = projects.map((p) => p.code);
    expect(codes).toContain('Core');
    expect(codes).toContain('Docs');
    expect(codes).not.toContain('Web');
  });

  it('automatically excludes unauthorized project tickets from listTickets()', async () => {
    const tickets = await adapter.listTickets();
    const ids = tickets.map((t) => t.meta.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2); // Ticket 2 is Web -> must be hidden
  });

  it('throws EsedreAuthorizationError when listTickets() explicitly requests unauthorized project', async () => {
    await expect(adapter.listTickets({ project: 'Web' })).rejects.toThrow(EsedreAuthorizationError);
  });

  it('throws EsedreAuthorizationError when getTicket() accesses an unauthorized ticket', async () => {
    // Ticket 1 (Core) is authorized
    const ticket1 = await adapter.getTicket(1);
    expect(ticket1).not.toBeNull();
    expect(ticket1?.meta.title).toBe('Authorized Core Feature');

    // Ticket 2 (Web) is unauthorized -> MUST THROW EsedreAuthorizationError
    await expect(adapter.getTicket(2)).rejects.toThrow(EsedreAuthorizationError);
  });

  it('throws EsedreAuthorizationError when createTicket() targets an unauthorized project', async () => {
    await expect(
      adapter.createTicket({
        title: 'Unauthorized Create',
        type: 'Feature',
        projectCode: 'Web',
      })
    ).rejects.toThrow(EsedreAuthorizationError);
  });

  it('throws EsedreAuthorizationError when getPlan() or savePlan() targets unauthorized ticket', async () => {
    await expect(adapter.getPlan(2)).rejects.toThrow(EsedreAuthorizationError);
    await expect(adapter.savePlan(2, '# Injected Plan')).rejects.toThrow(EsedreAuthorizationError);
  });

  it('throws EsedreAuthorizationError when addComment() targets unauthorized ticket', async () => {
    await expect(
      adapter.addComment(2, { text: 'Injected Comment', author: 'Attacker' })
    ).rejects.toThrow(EsedreAuthorizationError);
  });
});
