import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import { EsedreMcpServer } from '../src/mcp/server.js';

describe('Milestones and Umbrella Feature Flags', () => {
  let tmpDir: string;
  let hubDir: string;
  let cliScriptPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-milestone-test-'));
    hubDir = path.join(tmpDir, 'hub');
    fs.mkdirSync(hubDir, { recursive: true });

    // Create project Core in hub
    const projectDir = path.join(hubDir, 'projects', 'Core');
    fs.mkdirSync(path.join(projectDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify({ code: 'Core', name: 'Core Engine' }, null, 2) + '\n'
    );

    cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Storage Adapter Milestone CRUD', () => {
    it('creates, lists, retrieves, updates, and deletes milestones', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

      // Create milestone 1
      const m1 = await storage.createMilestone({
        projectCode: 'Core',
        title: 'v1.0 Launch',
        description: 'First public release',
        status: 'Planned',
        featureFlag: 'v1_core',
        targetDate: '2026-10-01',
      });

      expect(m1.id).toBe(1);
      expect(m1.project).toBe('Core');
      expect(m1.title).toBe('v1.0 Launch');
      expect(m1.status).toBe('Planned');
      expect(m1.featureFlag).toBe('v1_core');
      expect(m1.targetDate).toBe('2026-10-01');

      // Create milestone 2
      const m2 = await storage.createMilestone({
        projectCode: 'Core',
        title: 'v2.0 Architecture',
        status: 'Active',
      });
      expect(m2.id).toBe(2);

      // List milestones
      const list = await storage.listMilestones('Core');
      expect(list).toHaveLength(2);
      expect(list[0].title).toBe('v1.0 Launch');
      expect(list[1].title).toBe('v2.0 Architecture');

      // Get milestone by numeric ID
      const fetched1 = await storage.getMilestone(1, 'Core');
      expect(fetched1?.title).toBe('v1.0 Launch');

      // Get milestone by title (case-insensitive)
      const fetchedByTitle = await storage.getMilestone('V1.0 LAUNCH', 'Core');
      expect(fetchedByTitle?.id).toBe(1);

      // Update milestone
      const updated = await storage.updateMilestone(1, {
        status: 'Active',
        description: 'Updated scope description',
      }, 'Core');
      expect(updated.status).toBe('Active');
      expect(updated.description).toBe('Updated scope description');

      // Delete milestone 2
      const deleted = await storage.deleteMilestone(2, 'Core');
      expect(deleted).toBe(true);

      const remaining = await storage.listMilestones('Core');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(1);
    });
  });

  describe('Umbrella Feature Flag Inheritance', () => {
    it('propagates milestone umbrella feature flag onto member tickets', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

      // Create milestone with umbrella feature flag
      await storage.createMilestone({
        projectCode: 'Core',
        title: 'CloudSync',
        status: 'Active',
        featureFlag: 'cloud_sync_umbrella',
      });

      // Create ticket linked to milestone without explicit featureFlag
      const ticket1 = await storage.createTicket({
        title: 'Implement sync worker',
        project: 'Core',
        type: 'Feature',
        complexity: 'Medium',
        milestone: 'CloudSync',
      });

      expect(ticket1.meta.milestone).toBe('CloudSync');
      expect(ticket1.meta.inheritedFeatureFlag).toBe('cloud_sync_umbrella');
      expect(ticket1.meta.featureFlag).toBe('cloud_sync_umbrella');

      // Create ticket linked to milestone with its OWN featureFlag
      const ticket2 = await storage.createTicket({
        title: 'Experimental Delta Protocol',
        project: 'Core',
        type: 'Feature',
        complexity: 'High',
        featureFlag: 'custom_delta_proto',
        milestone: 'CloudSync',
      });

      expect(ticket2.meta.milestone).toBe('CloudSync');
      // Preserves custom flag on ticket while recording inherited umbrella flag
      expect(ticket2.meta.featureFlag).toBe('custom_delta_proto');
      expect(ticket2.meta.inheritedFeatureFlag).toBe('cloud_sync_umbrella');

      // Filter tickets by milestone title and numeric milestone ID
      const filtered = await storage.listTickets({ project: 'Core', milestone: 'CloudSync' });
      expect(filtered).toHaveLength(2);
      const filteredById = await storage.listTickets({ project: 'Core', milestone: '1' });
      expect(filteredById).toHaveLength(2);

      // Create ticket linked via numeric milestone ID string (e.g. "1")
      const ticket3 = await storage.createTicket({
        title: 'Background telemetry worker',
        project: 'Core',
        type: 'Tools',
        milestone: '1',
      });
      expect(ticket3.meta.milestone).toBe('1');
      expect(ticket3.meta.inheritedFeatureFlag).toBe('cloud_sync_umbrella');
      const filteredAfter3 = await storage.listTickets({ project: 'Core', milestone: 'CloudSync' });
      expect(filteredAfter3).toHaveLength(3);

      // Unlink ticket 1 from milestone
      const updated1 = await storage.updateTicket(ticket1.meta.id, { milestone: 'none' });
      expect(updated1.meta.milestone).toBeUndefined();
      expect(updated1.meta.inheritedFeatureFlag).toBeUndefined();
      expect(updated1.meta.featureFlag).toBeUndefined();
    });
  });

  describe('Security & Isolation (Agent Project Allow-List)', () => {
    it('enforces isolation boundaries on milestone operations', async () => {
      // Create second project PrivateProject
      const privDir = path.join(hubDir, 'projects', 'Private');
      fs.mkdirSync(path.join(privDir, 'tickets'), { recursive: true });
      fs.writeFileSync(
        path.join(privDir, 'project.json'),
        JSON.stringify({ code: 'Private', name: 'Private Ops' }, null, 2) + '\n'
      );

      const baseStorage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });
      // Security filter scoped only to Core
      const secureStorage = new SecurityFilter(baseStorage, { allowedProjects: ['Core'] });

      // Milestone in Core is allowed
      const coreM = await secureStorage.createMilestone({
        projectCode: 'Core',
        title: 'Core Milestone',
      });
      expect(coreM.id).toBe(1);

      // Milestone in Private throws authorization error
      await expect(
        secureStorage.createMilestone({
          projectCode: 'Private',
          title: 'Secret Milestone',
        })
      ).rejects.toThrow(/Access Denied.*Private/i);

      await expect(
        secureStorage.listMilestones('Private')
      ).rejects.toThrow(/Access Denied.*Private/i);
    });
  });

  describe('Snapshot Projection Integration', () => {
    it('includes milestones array in snapshot.json', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });
      await storage.createMilestone({
        projectCode: 'Core',
        title: 'Q4 Objective',
        status: 'Active',
        featureFlag: 'q4_umbrella',
      });

      await storage.createTicket({
        title: 'Finish API specs',
        project: 'Core',
        type: 'Feature',
        complexity: 'Medium',
        milestone: 'Q4 Objective',
      });

      const snapshot = await generateProjectSnapshot(storage, 'Core', tmpDir);
      expect(snapshot.milestones).toBeDefined();
      expect(snapshot.milestones).toHaveLength(1);
      expect(snapshot.milestones![0].title).toBe('Q4 Objective');
      expect(snapshot.milestones![0].featureFlag).toBe('q4_umbrella');

      expect(snapshot.tickets[0].milestone).toBe('Q4 Objective');
      expect(snapshot.tickets[0].featureFlag).toBe('q4_umbrella');
    });
  });

  describe('CLI End-to-End Execution', () => {
    it('executes ese milestone create, list, get, update, and ticket linking', () => {
      // Create local .esedre/esedre.json in tmpDir to bind project
      const esedreDir = path.join(tmpDir, '.esedre');
      fs.mkdirSync(esedreDir, { recursive: true });
      fs.writeFileSync(
        path.join(esedreDir, 'esedre.json'),
        JSON.stringify({
          projectCode: 'Core',
          allowedProjects: ['Core'],
          dataDir: hubDir,
        }, null, 2) + '\n'
      );

      const runCli = (args: string[]) => {
        const output = execFileSync(
          process.execPath,
          [cliScriptPath, ...args],
          {
            cwd: tmpDir,
            env: {
              ...process.env,
              NODE_ENV: 'test',
            },
            encoding: 'utf-8',
          }
        );
        return output;
      };

      // 1. Create milestone via CLI
      const createOut = runCli([
        'milestone', 'create', 'v1.0 General Release',
        '-p', 'Core',
        '--flag', 'v1_release_flag',
        '--target', '2026-11-15',
        '--desc', 'Scope for public v1.0',
        '--json',
      ]);
      const createdMilestone = JSON.parse(createOut);
      expect(createdMilestone.id).toBe(1);
      expect(createdMilestone.title).toBe('v1.0 General Release');
      expect(createdMilestone.featureFlag).toBe('v1_release_flag');

      // 2. List milestones via CLI
      const listOut = runCli(['milestone', 'list', '-p', 'Core', '--json']);
      const listed = JSON.parse(listOut);
      expect(listed).toHaveLength(1);
      expect(listed[0].title).toBe('v1.0 General Release');

      // 3. Create ticket linked to milestone via -m flag
      const ticketOut = runCli([
        'create', '--title', 'First Milestone Ticket',
        '-p', 'Core',
        '-m', 'v1.0 General Release',
        '--json',
      ]);
      const ticket = JSON.parse(ticketOut);
      expect(ticket.meta.milestone).toBe('v1.0 General Release');
      expect(ticket.meta.featureFlag).toBe('v1_release_flag');
      expect(ticket.meta.inheritedFeatureFlag).toBe('v1_release_flag');

      // 4. Update milestone status via CLI
      const updateOut = runCli([
        'milestone', 'update', '1',
        '-p', 'Core',
        '--status', 'Active',
        '--json',
      ]);
      const updated = JSON.parse(updateOut);
      expect(updated.status).toBe('Active');

      // 5. Get milestone details with member tickets via CLI
      const getOut = runCli(['milestone', 'get', '1', '-p', 'Core', '--json']);
      const fetched = JSON.parse(getOut);
      expect(fetched.id).toBe(1);
      expect(fetched.tickets).toHaveLength(1);
      expect(fetched.tickets[0].meta.title).toBe('First Milestone Ticket');

      // 6. Delete milestone via CLI
      const deleteOut = runCli(['milestone', 'delete', '1', '-p', 'Core', '--json']);
      const deletedRes = JSON.parse(deleteOut);
      expect(deletedRes.success).toBe(true);
    });
  });

  describe('MCP Protocol Integration', () => {
    it('supports milestone creation, retrieval, updates, and ticket linking via MCP JSON-RPC', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });
      const server = new EsedreMcpServer(storage);

      const callRpc = async (req: any) => {
        return await (server as any).handleRequest(req);
      };

      // 1. Create milestone via esedre_create_milestone
      const createRes = await callRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'esedre_create_milestone',
          arguments: {
            title: 'MCP Milestone Beta',
            description: 'Created through MCP protocol',
            status: 'Planned',
            featureFlag: 'mcp_beta_flag',
            project: 'Core',
          },
        },
      });

      expect(createRes.error).toBeUndefined();
      const created = JSON.parse(createRes.result.content[0].text);
      expect(created.id).toBe(1);
      expect(created.title).toBe('MCP Milestone Beta');
      expect(created.featureFlag).toBe('mcp_beta_flag');

      // 2. List milestones via esedre_list_milestones
      const listRes = await callRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'esedre_list_milestones',
          arguments: {
            project: 'Core',
          },
        },
      });

      expect(listRes.error).toBeUndefined();
      const milestones = JSON.parse(listRes.result.content[0].text);
      expect(milestones).toHaveLength(1);
      expect(milestones[0].title).toBe('MCP Milestone Beta');

      // 3. Create ticket linked to milestone via esedre_create_ticket
      const ticketRes = await callRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'MCP Linked Ticket',
            type: 'Feature',
            milestone: 'MCP Milestone Beta',
            project: 'Core',
          },
        },
      });

      expect(ticketRes.error).toBeUndefined();
      const ticket = JSON.parse(ticketRes.result.content[0].text);
      expect(ticket.meta.milestone).toBe('MCP Milestone Beta');
      expect(ticket.meta.featureFlag).toBe('mcp_beta_flag');
      expect(ticket.meta.inheritedFeatureFlag).toBe('mcp_beta_flag');

      // 4. Get milestone details via esedre_get_milestone
      const getRes = await callRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'esedre_get_milestone',
          arguments: {
            id: 1,
            project: 'Core',
          },
        },
      });

      expect(getRes.error).toBeUndefined();
      const fetched = JSON.parse(getRes.result.content[0].text);
      expect(fetched.id).toBe(1);
      expect(fetched.tickets).toHaveLength(1);
      expect(fetched.tickets[0].meta.title).toBe('MCP Linked Ticket');

      // 5. Update milestone via esedre_update_milestone
      const updateRes = await callRpc({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'esedre_update_milestone',
          arguments: {
            id: 1,
            status: 'Active',
            project: 'Core',
          },
        },
      });

      expect(updateRes.error).toBeUndefined();
      const updated = JSON.parse(updateRes.result.content[0].text);
      expect(updated.status).toBe('Active');

      // 6. List tickets filtered by milestone via esedre_list_tickets
      const filterRes = await callRpc({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            milestone: 'MCP Milestone Beta',
            project: 'Core',
          },
        },
      });

      expect(filterRes.error).toBeUndefined();
      const filteredTickets = JSON.parse(filterRes.result.content[0].text);
      expect(filteredTickets).toHaveLength(1);
      expect(filteredTickets[0].title).toBe('MCP Linked Ticket');
    });
  });
});
