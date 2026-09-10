import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import {
  generateProjectSnapshot,
  computeTicketHash,
  verifyTicketHash,
  ProjectSnapshot,
  TicketSnapshotEntry,
} from '../src/snapshot.js';
import { CURRENT_ESEDRE_VERSION, EsedreConflictError } from '../src/types.js';

describe('.esedre/snapshot.json Comprehensive Test Suite', () => {
  let tempDir: string;
  let adapter: FilesystemStorageAdapter;
  const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-snapshot-suite-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const projectsFile = path.join(tempDir, 'src', 'data', 'planning', 'projects', 'projects.json');
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(
      projectsFile,
      JSON.stringify([
        { id: 1, code: 'Core', slug: 'core', name: 'Core Application', description: '' },
        { id: 2, code: 'Docs', slug: 'docs', name: 'Documentation', description: '' },
        { id: 3, code: 'Web', slug: 'web', name: 'Web Client', description: '' },
      ])
    );

    adapter = new FilesystemStorageAdapter(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Schema & Contract Validation', () => {
    it('produces a valid snapshot matching the ProjectSnapshot interface', async () => {
      const t1 = await adapter.createTicket({
        title: 'Core Architecture',
        type: 'Platform',
        complexity: 'High',
        estimatedEffort: '5.0 - 8.0 hours',
        summary: 'Establish foundational architecture',
        projectCode: 'Core',
      });
      await adapter.savePlan(t1.meta.id, '# Plan\n1. Define interfaces\n2. Implement adapter');

      const t2 = await adapter.createTicket({
        title: 'Fix edge case',
        type: 'Bug',
        complexity: 'Low',
        estimatedEffort: '1.0 hour',
        projectCode: 'Core',
      });
      await adapter.updateTicket(t2.meta.id, { status: 'Completed' });

      const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);

      // Top-level schema assertions
      expect(snapshot.version).toBe(CURRENT_ESEDRE_VERSION);
      expect(snapshot.projectCode).toBe('Core');
      expect(snapshot.totalTickets).toBe(2);
      expect(snapshot.tickets).toHaveLength(2);
      expect(new Date(snapshot.generatedAt).getTime()).not.toBeNaN();

      // Ticket 1: with plan
      const entry1 = snapshot.tickets.find((t) => t.id === t1.meta.id);
      expect(entry1).toBeDefined();
      expect(entry1!.ticketKey).toBe(`Core-${t1.meta.id}`);
      expect(entry1!.title).toBe('Core Architecture');
      expect(entry1!.type).toBe('Platform');
      expect(entry1!.category).toBe('Platform');
      expect(entry1!.status).toBe('Planned');
      expect(entry1!.complexity).toBe('High');
      expect(entry1!.estimatedEffort).toBe('5.0 - 8.0 hours');
      expect(entry1!.summary).toBe('Establish foundational architecture');
      expect(entry1!.hasPlan).toBe(true);
      expect(entry1!.planMarkdown).toContain('# Plan');
      expect(entry1!.completedAt).toBeUndefined();
      expect(entry1!.revision).toBeGreaterThanOrEqual(1);
      expect(entry1!.daysSinceUpdate).toBeGreaterThanOrEqual(0);
      expect(entry1!.sha1).toMatch(/^[0-9a-f]{40}$/);

      // Ticket 2: completed bug without plan
      const entry2 = snapshot.tickets.find((t) => t.id === t2.meta.id);
      expect(entry2).toBeDefined();
      expect(entry2!.ticketKey).toBe(`Core-${t2.meta.id}`);
      expect(entry2!.title).toBe('Fix edge case');
      expect(entry2!.type).toBe('Bug');
      expect(entry2!.status).toBe('Completed');
      expect(entry2!.hasPlan).toBe(false);
      expect(entry2!.planMarkdown).toBeUndefined();
      expect(entry2!.completedAt).toBeDefined();
      expect(entry2!.sha1).toMatch(/^[0-9a-f]{40}$/);
    });

    it('handles empty projects with zero tickets gracefully', async () => {
      const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);

      expect(snapshot.version).toBe(CURRENT_ESEDRE_VERSION);
      expect(snapshot.projectCode).toBe('Core');
      expect(snapshot.totalTickets).toBe(0);
      expect(snapshot.tickets).toEqual([]);

      const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(snapshotFile)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
      expect(onDisk.totalTickets).toBe(0);
      expect(onDisk.tickets).toEqual([]);
    });
  });

  describe('Multi-Project Isolation', () => {
    it('scopes snapshot strictly to the requested project code without leakage', async () => {
      await adapter.createTicket({ title: 'Core Feature 1', projectCode: 'Core' });
      await adapter.createTicket({ title: 'Core Feature 2', projectCode: 'Core' });
      await adapter.createTicket({ title: 'Docs Guide 1', projectCode: 'Docs' });
      await adapter.createTicket({ title: 'Web App Landing', projectCode: 'Web' });

      // Generate snapshot for Core
      const coreSnapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);
      expect(coreSnapshot.totalTickets).toBe(2);
      expect(coreSnapshot.tickets.every((t) => t.project === 'Core')).toBe(true);
      expect(coreSnapshot.tickets.every((t) => t.ticketKey.startsWith('Core-'))).toBe(true);

      // Generate snapshot for Docs
      const docsDir = path.join(tempDir, 'docs-sub');
      const docsSnapshot = await generateProjectSnapshot(adapter, 'Docs', docsDir);
      expect(docsSnapshot.totalTickets).toBe(1);
      expect(docsSnapshot.tickets[0].title).toBe('Docs Guide 1');
      expect(docsSnapshot.tickets[0].ticketKey).toBe(`Docs-${docsSnapshot.tickets[0].id}`);
    });
  });

  describe('Temporal Staleness & Timestamps', () => {
    it('calculates daysSinceUpdate accurately based on ticket updatedAt', async () => {
      const ticket = await adapter.createTicket({
        title: 'Aging Ticket',
        projectCode: 'Core',
      });

      // Manually set updatedAt to 10 days ago in raw meta.json
      const metaPath = path.join(
        tempDir,
        'src',
        'data',
        'planning',
        'tickets',
        String(ticket.meta.id),
        'meta.json'
      );
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      meta.updatedAt = tenDaysAgo;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

      const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);
      const entry = snapshot.tickets.find((t) => t.id === ticket.meta.id);
      expect(entry).toBeDefined();
      expect(entry!.daysSinceUpdate).toBe(10);
    });

    it('falls back to 0 for missing or invalid dates without throwing', async () => {
      const ticket = await adapter.createTicket({
        title: 'No Date Ticket',
        projectCode: 'Core',
      });

      const metaPath = path.join(
        tempDir,
        'src',
        'data',
        'planning',
        'tickets',
        String(ticket.meta.id),
        'meta.json'
      );
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      delete meta.timestamp;
      delete meta.createdAt;
      delete meta.updatedAt;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

      const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);
      const entry = snapshot.tickets.find((t) => t.id === ticket.meta.id);
      expect(entry).toBeDefined();
      expect(entry!.daysSinceUpdate).toBe(0);
    });
  });

  describe('Optimistic Concurrency Control (OCC) Interoperability', () => {
    it('provides authoritative sha1 that can be used directly for OCC updates', async () => {
      const ticket = await adapter.createTicket({
        title: 'OCC Grounding Ticket',
        projectCode: 'Core',
      });

      // Generate snapshot
      const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);
      const entry = snapshot.tickets.find((t) => t.id === ticket.meta.id);
      expect(entry).toBeDefined();

      const snapshotSha1 = entry!.sha1;
      expect(snapshotSha1).toBe(ticket.sha1);

      // Agent uses sha1 from snapshot as lastHash to update ticket
      const updated = await adapter.updateTicket(
        ticket.meta.id,
        { status: 'In Development' },
        snapshotSha1
      );
      expect(updated.meta.status).toBe('In Development');

      // Attempting to reuse old snapshotSha1 must be rejected
      await expect(
        adapter.updateTicket(ticket.meta.id, { title: 'Conflicting Title' }, snapshotSha1)
      ).rejects.toThrow(EsedreConflictError);
    });

    it('supports prefix hash verification from snapshot sha1', () => {
      const fullHash = 'e2b4c6d8a0123456789012345678901234567890';
      expect(verifyTicketHash(fullHash, fullHash)).toBe(true);
      expect(verifyTicketHash(fullHash, fullHash.slice(0, 8))).toBe(true);
      expect(verifyTicketHash(fullHash, 'different-hash')).toBe(false);
    });
  });

  describe('Direct Agent Zero-Latency Grounding', () => {
    it('allows an LLM agent to ground its context by reading .esedre/snapshot.json directly', async () => {
      const t = await adapter.createTicket({
        title: 'Zero Latency Context Verification',
        type: 'Feature',
        complexity: 'Medium',
        summary: 'Direct JSON read for LLM agent grounding',
        projectCode: 'Core',
      });
      await adapter.savePlan(t.meta.id, '# Architectural Plan\nExecute step-by-step.');

      await generateProjectSnapshot(adapter, 'Core', tempDir);

      // Simulate autonomous agent reading the snapshot file directly
      const snapshotPath = path.join(tempDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const rawContent = fs.readFileSync(snapshotPath, 'utf-8');
      expect(rawContent.endsWith('\n')).toBe(true);

      const grounded: ProjectSnapshot = JSON.parse(rawContent);
      expect(grounded.projectCode).toBe('Core');

      // Fast lookup by compound ticketKey
      const key = `Core-${t.meta.id}`;
      const found = grounded.tickets.find((x) => x.ticketKey === key);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Zero Latency Context Verification');
      expect(found!.hasPlan).toBe(true);
      expect(found!.planMarkdown).toContain('# Architectural Plan');
      expect(found!.sha1).toBeDefined();
    });
  });

  describe('Atomic Writing & Directory Creation', () => {
    it('creates .esedre directory if missing and leaves zero temporary files', async () => {
      const targetDir = path.join(tempDir, 'sub-workspace');
      fs.mkdirSync(targetDir, { recursive: true });

      const esedreDir = path.join(targetDir, '.esedre');
      expect(fs.existsSync(esedreDir)).toBe(false);

      await generateProjectSnapshot(adapter, 'Core', targetDir);

      expect(fs.existsSync(esedreDir)).toBe(true);
      expect(fs.existsSync(path.join(esedreDir, 'snapshot.json'))).toBe(true);

      // Verify no leftover .tmp files
      const files = fs.readdirSync(esedreDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('safely overwrites previous snapshot on re-generation', async () => {
      await adapter.createTicket({ title: 'Ticket 1', projectCode: 'Core' });
      await generateProjectSnapshot(adapter, 'Core', tempDir);

      const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
      const snap1 = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
      expect(snap1.totalTickets).toBe(1);

      // Add second ticket and regenerate
      await adapter.createTicket({ title: 'Ticket 2', projectCode: 'Core' });
      await generateProjectSnapshot(adapter, 'Core', tempDir);

      const snap2 = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
      expect(snap2.totalTickets).toBe(2);
    });
  });

  describe('CLI Command Integration: ese snapshot', () => {
    it('generates snapshot via ese snapshot --project Core --json', async () => {
      await adapter.createTicket({ title: 'CLI Ticket 1', projectCode: 'Core' });

      // Write .esedre/esedre.json in tempDir
      fs.mkdirSync(path.join(tempDir, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.esedre', 'esedre.json'),
        JSON.stringify({ version: CURRENT_ESEDRE_VERSION, projectCode: 'Core' }),
        'utf-8'
      );

      const stdout = execFileSync(
        process.execPath,
        [cliPath, 'snapshot', '--project', 'Core', '--json'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      const parsed: ProjectSnapshot = JSON.parse(stdout);
      expect(parsed.projectCode).toBe('Core');
      expect(parsed.version).toBe(CURRENT_ESEDRE_VERSION);
      expect(parsed.totalTickets).toBe(1);
      expect(parsed.tickets[0].title).toBe('CLI Ticket 1');

      const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(snapshotFile)).toBe(true);
    });

    it('generates snapshot via ese snapshot without --project using workspace config', async () => {
      await adapter.createTicket({ title: 'Auto Project Ticket', projectCode: 'Core' });

      fs.mkdirSync(path.join(tempDir, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.esedre', 'esedre.json'),
        JSON.stringify({ version: CURRENT_ESEDRE_VERSION, projectCode: 'Core' }),
        'utf-8'
      );

      const stdout = execFileSync(
        process.execPath,
        [cliPath, 'snapshot', '--json'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      const parsed: ProjectSnapshot = JSON.parse(stdout);
      expect(parsed.projectCode).toBe('Core');
      expect(parsed.totalTickets).toBe(1);
    });

    it('prints clean human-readable confirmation when --json is omitted', async () => {
      await adapter.createTicket({ title: 'Human Readable Ticket', projectCode: 'Core' });

      fs.mkdirSync(path.join(tempDir, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.esedre', 'esedre.json'),
        JSON.stringify({ version: CURRENT_ESEDRE_VERSION, projectCode: 'Core' }),
        'utf-8'
      );

      const stdout = execFileSync(
        process.execPath,
        [cliPath, 'snapshot', '--project', 'Core'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      expect(stdout).toContain('Generated projection snapshot for project \'Core\'');
      expect(stdout).toContain('.esedre/snapshot.json');
    });

    it('fails with clean error message when no project code is available', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-empty-test-'));
      try {
        expect(() => {
          execFileSync(process.execPath, [cliPath, 'snapshot'], {
            cwd: emptyDir,
            encoding: 'utf-8',
            env: {
              ...process.env,
              ESEDRE_GLOBAL_DIR: path.join(emptyDir, 'global-store'),
            },
          });
        }).toThrow();
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('CLI Upgrade Integration: ese upgrade refreshes snapshot', () => {
    it('refreshes .esedre/snapshot.json during ese upgrade', async () => {
      await adapter.createTicket({ title: 'Pre Upgrade Ticket', projectCode: 'Core' });

      fs.mkdirSync(path.join(tempDir, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.esedre', 'esedre.json'),
        JSON.stringify({ version: CURRENT_ESEDRE_VERSION, projectCode: 'Core' }),
        'utf-8'
      );

      const stdout = execFileSync(
        process.execPath,
        [cliPath, 'upgrade', '--json'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
          },
        }
      );

      const parsed = JSON.parse(stdout);
      expect(parsed.snapshot.totalTickets).toBe(1);

      const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(snapshotFile)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
      expect(onDisk.version).toBe(CURRENT_ESEDRE_VERSION);
      expect(onDisk.totalTickets).toBe(1);
      expect(onDisk.tickets[0].title).toBe('Pre Upgrade Ticket');
    });
  });
});
