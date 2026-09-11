import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';

function seedProject(dir: string, project: { id: number; code: string; name: string }, ticketCount: number = 0): void {
  const pJson = {
    id: project.id,
    code: project.code,
    name: project.name,
    description: `${project.name} test project`,
  };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(pJson, null, 2) + '\n', 'utf-8');

  const ticketsDir = path.join(dir, 'tickets');
  fs.mkdirSync(ticketsDir, { recursive: true });

  for (let i = 1; i <= ticketCount; i++) {
    const tDir = path.join(ticketsDir, String(i));
    fs.mkdirSync(tDir, { recursive: true });
    const meta = {
      id: i,
      title: `${project.code} Feature ${i}`,
      category: 'Feature',
      complexity: 'Medium',
      status: 'Planned',
      projectId: project.id,
      project: project.code,
      revision: 1,
    };
    fs.writeFileSync(path.join(tDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(tDir, 'detail.md'), `# Ticket #${i}: ${meta.title}\n\n**Category**: Feature\n`, 'utf-8');
  }
}

describe('Multi-Topology Storage Engine', () => {
  let rootTemp: string;

  beforeEach(() => {
    rootTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-multi-topo-'));
  });

  afterEach(() => {
    if (fs.existsSync(rootTemp)) {
      fs.rmSync(rootTemp, { recursive: true, force: true });
    }
  });

  // 1. Single Hub Topology
  it('Topology 1: 1 Hub (Multi-project centralized repo)', async () => {
    const hubDir = path.join(rootTemp, 'hub1');
    const profDir = path.join(hubDir, 'projects', 'Profe');
    const eseDir = path.join(hubDir, 'projects', 'Esedre');
    fs.mkdirSync(profDir, { recursive: true });
    fs.mkdirSync(eseDir, { recursive: true });

    seedProject(profDir, { id: 1, code: 'Profe', name: 'Professor Arwam' }, 3);
    seedProject(eseDir, { id: 2, code: 'Esedre', name: 'Esedre Planner' }, 2);

    const adapter = new FilesystemStorageAdapter(rootTemp, { dataDir: 'hub1' });
    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.code).sort()).toEqual(['Esedre', 'Profe']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(5);

    // Prefixed access
    const prof1 = await adapter.getTicket('Profe-1');
    expect(prof1).not.toBeNull();
    expect(prof1?.meta.title).toBe('Profe Feature 1');

    const ese2 = await adapter.getTicket('Esedre-2');
    expect(ese2).not.toBeNull();
    expect(ese2?.meta.title).toBe('Esedre Feature 2');

    // Ambiguity detection
    await expect(adapter.getTicket(1)).rejects.toThrow(/Ambiguous ticket #1/);

    // Scoped sequential ticket creation
    const created = await adapter.createTicket({
      title: 'New Esedre Capability',
      category: 'Tools',
      projectCode: 'Esedre',
    });
    expect(created.meta.id).toBe(3); // was 2, now 3
    expect(created.meta.project).toBe('Esedre');
  });

  // 2. In-Repo Standalone Topology
  it('Topology 2: 1 Project (In-Repo standalone mode)', async () => {
    const repoDir = path.join(rootTemp, 'single-repo');
    const esedreDir = path.join(repoDir, '.esedre');
    fs.mkdirSync(esedreDir, { recursive: true });

    seedProject(esedreDir, { id: 1, code: 'Alce', name: 'Alce Reader' }, 4);

    const adapter = new FilesystemStorageAdapter(repoDir, { projectCode: 'Alce' });
    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].code).toBe('Alce');

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(4);

    // Pure numeric ID works seamlessly in single-project mode
    const t3 = await adapter.getTicket(3);
    expect(t3).not.toBeNull();
    expect(t3?.meta.title).toBe('Alce Feature 3');

    // Next sequential creation starts at 5
    const created = await adapter.createTicket({
      title: 'Offline Sync Mode',
      category: 'Feature',
    });
    expect(created.meta.id).toBe(5);
    expect(created.meta.project).toBe('Alce');
  });

  // 3. Multi-Hub Topology
  it('Topology 3: 2 Hubs (Multi-dataDir array federation)', async () => {
    const hub1 = path.join(rootTemp, 'hubA');
    const hub2 = path.join(rootTemp, 'hubB');

    const projA = path.join(hub1, 'projects', 'TeamAlpha');
    const projB = path.join(hub2, 'projects', 'TeamBeta');
    fs.mkdirSync(projA, { recursive: true });
    fs.mkdirSync(projB, { recursive: true });

    seedProject(projA, { id: 10, code: 'Alpha', name: 'Team Alpha' }, 2);
    seedProject(projB, { id: 20, code: 'Beta', name: 'Team Beta' }, 3);

    const adapter = new FilesystemStorageAdapter(rootTemp, { dataDir: ['hubA', 'hubB'] });
    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.code).sort()).toEqual(['Alpha', 'Beta']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(5);
    expect(await adapter.getTicket('Alpha-1')).not.toBeNull();
    expect(await adapter.getTicket('Beta-2')).not.toBeNull();
  });

  // 4. Disparate Multi-Repo Federation
  it('Topology 4: 2 Projects (Disparate repos linked via projects map)', async () => {
    const repo1 = path.join(rootTemp, 'repo1');
    const repo2 = path.join(rootTemp, 'repo2');
    fs.mkdirSync(path.join(repo1, '.esedre'), { recursive: true });
    fs.mkdirSync(path.join(repo2, '.esedre'), { recursive: true });

    seedProject(path.join(repo1, '.esedre'), { id: 1, code: 'Repo1', name: 'First Repo' }, 2);
    seedProject(path.join(repo2, '.esedre'), { id: 2, code: 'Repo2', name: 'Second Repo' }, 3);

    const adapter = new FilesystemStorageAdapter(rootTemp, {
      projects: {
        Repo1: 'repo1',
        Repo2: 'repo2',
      },
    });

    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.code).sort()).toEqual(['Repo1', 'Repo2']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(5);
    expect(await adapter.getTicket('Repo1-2')).not.toBeNull();
    expect(await adapter.getTicket('Repo2-3')).not.toBeNull();
  });

  // 5. Hybrid: 1 Hub + 1 Project
  it('Topology 5: Hybrid (1 Hub + 1 Disparate standalone project)', async () => {
    const hub = path.join(rootTemp, 'mainHub');
    const hubProj = path.join(hub, 'projects', 'Core');
    fs.mkdirSync(hubProj, { recursive: true });
    seedProject(hubProj, { id: 1, code: 'Core', name: 'Core Platform' }, 2);

    const standalone = path.join(rootTemp, 'standaloneRepo');
    fs.mkdirSync(path.join(standalone, '.esedre'), { recursive: true });
    seedProject(path.join(standalone, '.esedre'), { id: 2, code: 'Tool', name: 'Standalone Tool' }, 1);

    const adapter = new FilesystemStorageAdapter(rootTemp, {
      dataDir: 'mainHub',
      projects: {
        Tool: 'standaloneRepo',
      },
    });

    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.code).sort()).toEqual(['Core', 'Tool']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(3);
    expect(await adapter.getTicket('Core-1')).not.toBeNull();
    expect(await adapter.getTicket('Tool-1')).not.toBeNull();
  });

  // 6. Hybrid: 1 Hub + 2 Projects
  it('Topology 6: Hybrid (1 Hub + 2 Disparate standalone projects)', async () => {
    const hub = path.join(rootTemp, 'hub');
    const hubProj = path.join(hub, 'projects', 'HubA');
    fs.mkdirSync(hubProj, { recursive: true });
    seedProject(hubProj, { id: 1, code: 'HubA', name: 'Hub Project' }, 2);

    const repo1 = path.join(rootTemp, 'ext1');
    const repo2 = path.join(rootTemp, 'ext2');
    fs.mkdirSync(path.join(repo1, '.esedre'), { recursive: true });
    fs.mkdirSync(path.join(repo2, '.esedre'), { recursive: true });
    seedProject(path.join(repo1, '.esedre'), { id: 2, code: 'Ext1', name: 'External 1' }, 1);
    seedProject(path.join(repo2, '.esedre'), { id: 3, code: 'Ext2', name: 'External 2' }, 2);

    const adapter = new FilesystemStorageAdapter(rootTemp, {
      dataDir: 'hub',
      projects: {
        Ext1: 'ext1',
        Ext2: 'ext2',
      },
    });

    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.code).sort()).toEqual(['Ext1', 'Ext2', 'HubA']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(5);
  });

  // 7. Hybrid: 2 Hubs + 1 Project
  it('Topology 7: Hybrid (2 Hubs + 1 Disparate standalone project)', async () => {
    const hub1 = path.join(rootTemp, 'h1');
    const hub2 = path.join(rootTemp, 'h2');
    fs.mkdirSync(path.join(hub1, 'projects', 'H1P'), { recursive: true });
    fs.mkdirSync(path.join(hub2, 'projects', 'H2P'), { recursive: true });
    seedProject(path.join(hub1, 'projects', 'H1P'), { id: 1, code: 'H1P', name: 'Hub 1 Project' }, 1);
    seedProject(path.join(hub2, 'projects', 'H2P'), { id: 2, code: 'H2P', name: 'Hub 2 Project' }, 1);

    const standalone = path.join(rootTemp, 'solo');
    fs.mkdirSync(path.join(standalone, '.esedre'), { recursive: true });
    seedProject(path.join(standalone, '.esedre'), { id: 3, code: 'Solo', name: 'Solo Project' }, 1);

    const adapter = new FilesystemStorageAdapter(rootTemp, {
      dataDir: ['h1', 'h2'],
      projects: {
        Solo: 'solo',
      },
    });

    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.code).sort()).toEqual(['H1P', 'H2P', 'Solo']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(3);
  });

  // 8. Hybrid: 2 Hubs + 2 Projects
  it('Topology 8: Hybrid (2 Hubs + 2 Disparate standalone projects)', async () => {
    const hub1 = path.join(rootTemp, 'hubOne');
    const hub2 = path.join(rootTemp, 'hubTwo');
    fs.mkdirSync(path.join(hub1, 'projects', 'HOne'), { recursive: true });
    fs.mkdirSync(path.join(hub2, 'projects', 'HTwo'), { recursive: true });
    seedProject(path.join(hub1, 'projects', 'HOne'), { id: 1, code: 'HOne', name: 'Hub One' }, 2);
    seedProject(path.join(hub2, 'projects', 'HTwo'), { id: 2, code: 'HTwo', name: 'Hub Two' }, 2);

    const repoA = path.join(rootTemp, 'extA');
    const repoB = path.join(rootTemp, 'extB');
    fs.mkdirSync(path.join(repoA, '.esedre'), { recursive: true });
    fs.mkdirSync(path.join(repoB, '.esedre'), { recursive: true });
    seedProject(path.join(repoA, '.esedre'), { id: 3, code: 'ExtA', name: 'External A' }, 2);
    seedProject(path.join(repoB, '.esedre'), { id: 4, code: 'ExtB', name: 'External B' }, 2);

    const adapter = new FilesystemStorageAdapter(rootTemp, {
      dataDir: ['hubOne', 'hubTwo'],
      projects: {
        ExtA: 'extA',
        ExtB: 'extB',
      },
    });

    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(4);
    expect(projects.map((p) => p.code).sort()).toEqual(['ExtA', 'ExtB', 'HOne', 'HTwo']);

    const tickets = await adapter.listTickets();
    expect(tickets).toHaveLength(8);

    // Verify isolation and sequential nextId in createTicket for any member
    const newExtB = await adapter.createTicket({
      title: 'ExtB New Feature',
      category: 'Feature',
      projectCode: 'ExtB',
    });
    expect(newExtB.meta.id).toBe(3); // was 2, next is 3
    expect(newExtB.meta.project).toBe('ExtB');
    expect(await adapter.getTicket('ExtB-3')).not.toBeNull();
  });

  // 6. Monorepo / In-Workspace Data Hub Auto-Detection
  it('Topology 6: Monorepo / In-Workspace Data Hub (projects/ at root without explicit dataDir)', async () => {
    const monoDir = path.join(rootTemp, 'monorepo');
    const projA = path.join(monoDir, 'projects', 'AppA');
    const projB = path.join(monoDir, 'projects', 'AppB');
    fs.mkdirSync(projA, { recursive: true });
    fs.mkdirSync(projB, { recursive: true });

    seedProject(projA, { id: 1, code: 'AppA', name: 'Monorepo App A' }, 2);
    seedProject(projB, { id: 2, code: 'AppB', name: 'Monorepo App B' }, 4);

    // Save top-level projects.json
    fs.writeFileSync(
      path.join(monoDir, 'projects.json'),
      JSON.stringify([
        { id: 1, code: 'AppA', name: 'Monorepo App A', description: 'App A' },
        { id: 2, code: 'AppB', name: 'Monorepo App B', description: 'App B' },
      ], null, 2) + '\n',
      'utf-8'
    );

    // Zero config passed - auto-detection discovers projects/ in workspaceRoot
    const adapter = new FilesystemStorageAdapter(monoDir, {});

    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.code).sort()).toEqual(['AppA', 'AppB']);

    const allTickets = await adapter.listTickets();
    expect(allTickets).toHaveLength(6);

    // Filter by project override
    const appATickets = await adapter.listTickets({ project: 'AppA' });
    expect(appATickets).toHaveLength(2);
    expect(appATickets.every((t) => t.meta.project === 'AppA')).toBe(true);

    // Create ticket with project override
    const created = await adapter.createTicket({
      title: 'AppA Ticket 3',
      type: 'Feature',
      projectCode: 'AppA',
    });
    expect(created.meta.id).toBe(3);
    expect(created.meta.project).toBe('AppA');

    // Create ticket without project code in multi-project hub throws clear error
    await expect(
      adapter.createTicket({ title: 'Ambiguous Ticket', type: 'Feature' })
    ).rejects.toThrow(/Project is required to create a ticket \(available: AppA, AppB\)/);
  });
});

