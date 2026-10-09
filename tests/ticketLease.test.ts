import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { EsedreLeaseConflictError } from '../src/storage/adapter.js';

describe('Ticket Lease Concurrency Engine (src/storage/filesystem.ts)', () => {
  let tempDir: string;
  let adapter: FilesystemStorageAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-lease-test-'));
    const ticketsDir = path.join(tempDir, 'projects', 'Core', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    // Seed projects.json
    const projects = [
      { id: 1, code: 'Core', name: 'Core Engine', description: 'Core repo' },
      { id: 2, code: 'Web', name: 'Web Client', description: 'Web repo' },
    ];
    fs.writeFileSync(
      path.join(tempDir, 'projects.json'),
      JSON.stringify(projects, null, 2)
    );

    adapter = new FilesystemStorageAdapter(tempDir, { dataDir: tempDir });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('claimTicket', () => {
    it('claims an unleased ticket, sets In Development status, and assigns host system', async () => {
      const ticket = await adapter.createTicket({
        title: 'Build parser engine',
        projectCode: 'Core',
        summary: 'Parse ast trees',
      });

      expect(ticket.meta.id).toBe(1);
      expect(ticket.meta.status).toBe('Planned');
      expect(ticket.meta.lease).toBeUndefined();

      const claimed = await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
        role: 'thug',
        engine: 'antigravity',
        ttlMinutes: 20,
        worktree: '.worktrees/thug-1',
      });

      expect(claimed.meta.status).toBe('In Development');
      expect(claimed.meta.assignee).toBe('Laptop');
      expect(claimed.meta.lease).toBeDefined();
      expect(claimed.meta.lease?.system).toBe('Laptop');
      expect(claimed.meta.lease?.workerId).toBe('thug-1');
      expect(claimed.meta.lease?.role).toBe('thug');
      expect(claimed.meta.lease?.engine).toBe('antigravity');
      expect(claimed.meta.lease?.ttlMinutes).toBe(20);
      expect(claimed.meta.lease?.worktree).toBe('.worktrees/thug-1');

      const expiresMs = new Date(claimed.meta.lease!.expiresAt).getTime();
      expect(expiresMs).toBeGreaterThan(Date.now());
    });

    it('rejects claim with EsedreLeaseConflictError when another worker holds an active lease', async () => {
      await adapter.createTicket({
        title: 'Optimize cache',
        projectCode: 'Core',
      });

      // Worker 1 claims
      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
        role: 'thug',
        ttlMinutes: 15,
      });

      // Worker 2 attempts claim
      await expect(
        adapter.claimTicket('Core-1', {
          system: 'Laptop',
          workerId: 'thug-2',
          role: 'thug',
          ttlMinutes: 15,
        })
      ).rejects.toThrow(EsedreLeaseConflictError);

      // Remote worker attempts claim
      await expect(
        adapter.claimTicket('Core-1', {
          system: 'Eris',
          workerId: 'thug-1',
          role: 'thug',
          ttlMinutes: 15,
        })
      ).rejects.toThrow(EsedreLeaseConflictError);
    });

    it('allows same worker to update its own lease', async () => {
      await adapter.createTicket({
        title: 'Refactor types',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'anchor-1',
        role: 'anchor',
        ttlMinutes: 10,
      });

      // Same worker claims again (e.g. promoting hat or updating worktree)
      const updated = await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'anchor-1',
        role: 'anchor',
        ttlMinutes: 30,
        worktree: '.worktrees/anchor-1',
      });

      expect(updated.meta.lease?.ttlMinutes).toBe(30);
      expect(updated.meta.lease?.worktree).toBe('.worktrees/anchor-1');
    });

    it('allows force override over active lease when force: true', async () => {
      await adapter.createTicket({
        title: 'Fix race condition',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-stuck',
        role: 'thug',
        ttlMinutes: 60,
      });

      // Lead overrides
      const overridden = await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'lead-human',
        role: 'lead',
        force: true,
      });

      expect(overridden.meta.lease?.workerId).toBe('lead-human');
      expect(overridden.meta.lease?.role).toBe('lead');
    });

    it('allows automatic takeover when previous worker lease has expired', async () => {
      await adapter.createTicket({
        title: 'Long batch task',
        projectCode: 'Core',
      });

      // Seed an expired lease directly in meta.json
      const metaPath = path.join(tempDir, 'projects', 'Core', 'tickets', '1', 'meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.lease = {
        system: 'Laptop',
        workerId: 'dead-worker',
        role: 'thug',
        engine: 'antigravity',
        machine: 'localhost',
        acquiredAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1800 * 1000).toISOString(), // Expired 30 mins ago
        ttlMinutes: 15,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
      adapter.invalidateTicketCache();

      // New worker claims without force
      const reclaimed = await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'alive-worker',
        role: 'thug',
        ttlMinutes: 15,
      });

      expect(reclaimed.meta.lease?.workerId).toBe('alive-worker');
      expect(new Date(reclaimed.meta.lease!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('renewLease', () => {
    it('extends the expiration timestamp for the active holder', async () => {
      await adapter.createTicket({
        title: 'Heavy vitest run',
        projectCode: 'Core',
      });

      const claimed = await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
        ttlMinutes: 10,
      });

      const initialExpiresMs = new Date(claimed.meta.lease!.expiresAt).getTime();

      const renewed = await adapter.renewLease('Core-1', 'Laptop', 'thug-1', 45);
      expect(renewed.ttlMinutes).toBe(45);

      const renewedExpiresMs = new Date(renewed.expiresAt).getTime();
      expect(renewedExpiresMs).toBeGreaterThan(initialExpiresMs);
    });

    it('rejects renewal from a different worker with EsedreLeaseConflictError', async () => {
      await adapter.createTicket({
        title: 'Task Alpha',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
      });

      await expect(
        adapter.renewLease('Core-1', 'Laptop', 'imposter-worker')
      ).rejects.toThrow(EsedreLeaseConflictError);
    });

    it('rejects renewal on unleased tickets', async () => {
      await adapter.createTicket({
        title: 'Task Beta',
        projectCode: 'Core',
      });

      await expect(
        adapter.renewLease('Core-1', 'Laptop', 'thug-1')
      ).rejects.toThrow(/has no active lease/);
    });
  });

  describe('releaseTicket', () => {
    it('clears the active lease, marks status Completed, and appends completion notes', async () => {
      await adapter.createTicket({
        title: 'Implement feature X',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
        role: 'thug',
      });

      const released = await adapter.releaseTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
        finalStatus: 'Completed',
        notes: 'Verification passed: 100% tests green, clean build.',
      });

      expect(released.meta.lease).toBeNull();
      expect(released.meta.status).toBe('Completed');
      expect(released.meta.completedAt).toBeDefined();
      expect(released.comments).toHaveLength(1);
      expect(released.comments[0].author).toBe('Laptop:thug-1');
      expect(released.comments[0].text).toContain('Verification passed');
    });

    it('supports reverting status to Planned with failure notes on blocked task', async () => {
      await adapter.createTicket({
        title: 'Complex architectural task',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
      });

      const escalated = await adapter.releaseTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
        finalStatus: 'Planned',
        notes: 'Escalated: Blocked by upstream database migration.',
      });

      expect(escalated.meta.lease).toBeNull();
      expect(escalated.meta.status).toBe('Planned');
      expect(escalated.comments[0].text).toContain('Escalated');
    });

    it('rejects release attempt from an unauthorized worker without force', async () => {
      await adapter.createTicket({
        title: 'Task Gamma',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-1',
      });

      await expect(
        adapter.releaseTicket('Core-1', {
          system: 'Laptop',
          workerId: 'random-worker',
        })
      ).rejects.toThrow(EsedreLeaseConflictError);
    });

    it('allows administrative release override with force: true', async () => {
      await adapter.createTicket({
        title: 'Task Delta',
        projectCode: 'Core',
      });

      await adapter.claimTicket('Core-1', {
        system: 'Laptop',
        workerId: 'thug-lost',
      });

      const released = await adapter.releaseTicket('Core-1', {
        system: 'Laptop',
        workerId: 'lead-override',
        force: true,
        finalStatus: 'Planned',
        notes: 'Administrative reset by Lead',
      });

      expect(released.meta.lease).toBeNull();
      expect(released.meta.status).toBe('Planned');
    });
  });

  describe('listActiveLeases', () => {
    it('returns all active unexpired leases across tickets with remaining seconds', async () => {
      const t1 = await adapter.createTicket({ title: 'Task 1', projectCode: 'Core' });
      const t2 = await adapter.createTicket({ title: 'Task 2', projectCode: 'Core' });
      const t3 = await adapter.createTicket({ title: 'Task 3', projectCode: 'Core' });

      // Claim t1 and t2
      await adapter.claimTicket(`Core-${t1.meta.id}`, {
        system: 'Laptop',
        workerId: 'anchor-1',
        role: 'anchor',
        ttlMinutes: 20,
      });

      await adapter.claimTicket(`Core-${t2.meta.id}`, {
        system: 'Laptop',
        workerId: 'thug-1',
        role: 'thug',
        ttlMinutes: 10,
        worktree: '.worktrees/thug-1',
      });

      // t3 remains unleased

      const leases = await adapter.listActiveLeases('Core');
      expect(leases).toHaveLength(2);

      expect(leases[0].workerId).toBe('thug-1'); // Expires sooner (10m vs 20m)
      expect(leases[0].role).toBe('thug');
      expect(leases[0].worktree).toBe('.worktrees/thug-1');
      expect(leases[0].remainingSeconds).toBeGreaterThan(500);

      expect(leases[1].workerId).toBe('anchor-1');
      expect(leases[1].role).toBe('anchor');
      expect(leases[1].remainingSeconds).toBeGreaterThan(1100);
    });

    it('filters out expired leases from listActiveLeases', async () => {
      const t1 = await adapter.createTicket({ title: 'Expired Lease Task', projectCode: 'Core' });

      // Seed expired lease in meta.json
      const metaPath = path.join(tempDir, 'projects', 'Core', 'tickets', String(t1.meta.id), 'meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.lease = {
        system: 'Laptop',
        workerId: 'dead-thug',
        role: 'thug',
        engine: 'antigravity',
        machine: 'localhost',
        acquiredAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1800 * 1000).toISOString(), // expired
        ttlMinutes: 15,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
      adapter.invalidateTicketCache();

      const leases = await adapter.listActiveLeases('Core');
      expect(leases).toHaveLength(0);
    });
  });
});
