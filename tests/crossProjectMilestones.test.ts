import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';

describe('Cross-Project Milestones and Resolution', () => {
  let tmpDir: string;
  let hubDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-cross-ms-test-'));
    hubDir = path.join(tmpDir, 'hub');
    fs.mkdirSync(hubDir, { recursive: true });

    // Project 1: Core
    const coreDir = path.join(hubDir, 'projects', 'Core');
    fs.mkdirSync(path.join(coreDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'project.json'),
      JSON.stringify({ code: 'Core', name: 'Core Engine' }, null, 2) + '\n'
    );

    // Project 2: Lab
    const labDir = path.join(hubDir, 'projects', 'Lab');
    fs.mkdirSync(path.join(labDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(labDir, 'project.json'),
      JSON.stringify({ code: 'Lab', name: 'Lab Experiments' }, null, 2) + '\n'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('resolves cross-project milestones by title and inherits umbrella feature flags', async () => {
    const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

    // Create a milestone in Lab
    const labMs = await storage.createMilestone({
      projectCode: 'Lab',
      title: 'Platform Foundation',
      featureFlag: 'lab_foundation_flag',
      status: 'Active',
    });
    expect(labMs.id).toBe(1);
    expect(labMs.project).toBe('Lab');

    // Create a ticket in Core referencing Lab's milestone by title
    const coreTicket = await storage.createTicket({
      projectCode: 'Core',
      title: 'Core Foundation Adapter',
      type: 'Feature',
      milestone: 'Platform Foundation',
    });

    // Verify getTicket resolves the milestone and inherits the umbrella flag across projects
    const fetched = await storage.getTicket('Core-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.meta.milestone).toBe('Platform Foundation');
    expect(fetched?.meta.inheritedFeatureFlag).toBe('lab_foundation_flag');
    expect(fetched?.meta.featureFlag).toBe('lab_foundation_flag');

    // Verify listTickets resolves it as well
    const all = await storage.listTickets();
    const coreT = all.find((t) => t.meta.project === 'Core' && t.meta.id === 1);
    expect(coreT).toBeDefined();
    expect(coreT?.meta.inheritedFeatureFlag).toBe('lab_foundation_flag');
  });

  it('resolves compound notation Project:Milestone across projects', async () => {
    const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

    await storage.createMilestone({
      projectCode: 'Lab',
      title: 'v2.0 Beta',
      featureFlag: 'lab_v2',
      status: 'Planned',
    });

    // Reference using compound notation "Lab:v2.0 Beta"
    const t1 = await storage.createTicket({
      projectCode: 'Core',
      title: 'Core support for Lab v2',
      type: 'Platform',
      milestone: 'Lab:v2.0 Beta',
    });

    const fetched = await storage.getTicket('Core-1');
    expect(fetched?.meta.inheritedFeatureFlag).toBe('lab_v2');

    // Reference using compound ID "Lab:1"
    const t2 = await storage.createTicket({
      projectCode: 'Core',
      title: 'Core ID support for Lab v2',
      type: 'Platform',
      milestone: 'Lab:1',
    });

    const fetched2 = await storage.getTicket('Core-2');
    expect(fetched2?.meta.inheritedFeatureFlag).toBe('lab_v2');
  });

  it('prevents ambiguous numeric ID collision across projects', async () => {
    const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

    // Both projects have milestone #1 with different titles
    await storage.createMilestone({
      projectCode: 'Lab',
      title: 'Lab Deliverable',
      featureFlag: 'lab_only_flag',
    });
    await storage.createMilestone({
      projectCode: 'Core',
      title: 'Core Deliverable',
      featureFlag: 'core_only_flag',
    });

    // Ticket in Core references numeric "1" without prefix
    const coreTicket = await storage.createTicket({
      projectCode: 'Core',
      title: 'Core Local Ticket',
      type: 'Feature',
      milestone: '1',
    });

    // Must resolve to Core's milestone #1, NOT Lab's milestone #1
    const fetched = await storage.getTicket('Core-1');
    expect(fetched?.meta.inheritedFeatureFlag).toBe('core_only_flag');
  });

  it('filters tickets across projects by milestone', async () => {
    const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

    await storage.createMilestone({
      projectCode: 'Lab',
      title: 'Cross Project Initiative',
    });

    await storage.createTicket({
      projectCode: 'Lab',
      title: 'Lab Initiative Ticket',
      type: 'Feature',
      milestone: 'Cross Project Initiative',
    });

    await storage.createTicket({
      projectCode: 'Core',
      title: 'Core Initiative Ticket',
      type: 'Feature',
      milestone: 'Cross Project Initiative',
    });

    await storage.createTicket({
      projectCode: 'Core',
      title: 'Unrelated Core Ticket',
      type: 'Feature',
    });

    // Filter by milestone across all projects
    const filtered = await storage.listTickets({ milestone: 'Cross Project Initiative' });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => `${t.meta.project}-${t.meta.id}`).sort()).toEqual(['Core-1', 'Lab-1']);
  });

  it('respects SecurityFilter allow-list boundaries for cross-project queries', async () => {
    const baseStorage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

    await baseStorage.createMilestone({
      projectCode: 'Lab',
      title: 'Confidential Lab Initiative',
    });

    await baseStorage.createTicket({
      projectCode: 'Lab',
      title: 'Secret Lab Implementation',
      type: 'Feature',
      milestone: 'Confidential Lab Initiative',
    });

    await baseStorage.createTicket({
      projectCode: 'Core',
      title: 'Public Core Ticket',
      type: 'Feature',
      milestone: 'Confidential Lab Initiative',
    });

    // Filtered storage scoped to Core only
    const secured = new SecurityFilter(baseStorage, { allowedProjects: ['Core'] });

    // Milestones list must only return Core milestones
    const ms = await secured.listMilestones();
    expect(ms.some((m) => m.project === 'Lab')).toBe(false);

    // Tickets list must only return Core tickets
    const tickets = await secured.listTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].meta.project).toBe('Core');
    expect(tickets[0].meta.title).toBe('Public Core Ticket');
  });
});
