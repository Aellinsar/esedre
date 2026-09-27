import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { EsedreAuthorizationError } from '../src/config.js';

describe('Cross-Project Ticket Linking & Dependencies', () => {
  let tmpDir: string;
  let hubDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-link-test-'));
    hubDir = path.join(tmpDir, 'hub');
    fs.mkdirSync(hubDir, { recursive: true });

    // Create project Core in hub
    const coreDir = path.join(hubDir, 'projects', 'Core');
    fs.mkdirSync(path.join(coreDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'project.json'),
      JSON.stringify({ code: 'Core', name: 'Core Engine' }, null, 2) + '\n'
    );

    // Create project Web in hub
    const webDir = path.join(hubDir, 'projects', 'Web');
    fs.mkdirSync(path.join(webDir, 'tickets'), { recursive: true });
    fs.writeFileSync(
      path.join(webDir, 'project.json'),
      JSON.stringify({ code: 'Web', name: 'Web Client' }, null, 2) + '\n'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Storage Adapter Linking CRUD', () => {
    it('creates bi-directional link with inverse relation within the same project', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });

      // Create two tickets in Core
      const t1 = await storage.createTicket({
        title: 'Database Schema Migration',
        type: 'Platform',
        projectCode: 'Core',
      });
      const t2 = await storage.createTicket({
        title: 'User Profile API Endpoint',
        type: 'Feature',
        projectCode: 'Core',
      });

      expect(t1.meta.id).toBe(1);
      expect(t2.meta.id).toBe(2);

      // Link: Core-1 blocks Core-2
      const result = await storage.addTicketLink('Core-1', 'blocks', 'Core-2', { author: 'Developer' });

      expect(result.source.meta.id).toBe(1);
      expect(result.source.links).toHaveLength(1);
      expect(result.source.links![0].relation).toBe('blocks');
      expect(result.source.links![0].targetKey).toBe('Core-2');
      expect(result.source.links![0].targetProject).toBe('Core');
      expect(result.source.links![0].targetId).toBe(2);
      expect(result.source.links![0].targetTitle).toBe('User Profile API Endpoint');
      expect(result.source.isBlocked).toBe(false);

      // Verify reciprocal link on target (Core-2)
      const fetched2 = await storage.getTicket('Core-2');
      expect(fetched2).not.toBeNull();
      expect(fetched2!.links).toHaveLength(1);
      expect(fetched2!.links![0].relation).toBe('blocked-by');
      expect(fetched2!.links![0].targetKey).toBe('Core-1');
      expect(fetched2!.links![0].targetProject).toBe('Core');
      expect(fetched2!.links![0].targetId).toBe(1);
      expect(fetched2!.links![0].targetTitle).toBe('Database Schema Migration');
      expect(fetched2!.links![0].isTargetCompleted).toBe(false);
      // Core-2 is blocked because Core-1 is not completed
      expect(fetched2!.isBlocked).toBe(true);

      // Complete Core-1
      await storage.updateTicket('Core-1', { status: 'Completed' });

      // Core-2 should no longer be blocked
      const fetched2AfterComplete = await storage.getTicket('Core-2');
      expect(fetched2AfterComplete!.links![0].isTargetCompleted).toBe(true);
      expect(fetched2AfterComplete!.isBlocked).toBe(false);
    });

    it('supports parent-of / child-of hierarchy and duplicates relations', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });

      const epic = await storage.createTicket({ title: 'Authentication Redesign', type: 'Feature', projectCode: 'Core' });
      const subtask = await storage.createTicket({ title: 'OAuth2 Provider', type: 'Feature', projectCode: 'Core' });
      const dup = await storage.createTicket({ title: 'Duplicate OAuth Provider', type: 'Feature', projectCode: 'Core' });

      // Epic parent-of Subtask
      await storage.addTicketLink('Core-1', 'parent-of', 'Core-2');

      const fetchedEpic = await storage.getTicket('Core-1');
      const fetchedSubtask = await storage.getTicket('Core-2');

      expect(fetchedEpic!.links![0].relation).toBe('parent-of');
      expect(fetchedEpic!.links![0].targetKey).toBe('Core-2');
      expect(fetchedSubtask!.links![0].relation).toBe('child-of');
      expect(fetchedSubtask!.links![0].targetKey).toBe('Core-1');

      // Dup duplicates Subtask
      await storage.addTicketLink('Core-3', 'duplicates', 'Core-2');

      const fetchedDup = await storage.getTicket('Core-3');
      const fetchedSubtaskAfterDup = await storage.getTicket('Core-2');

      expect(fetchedDup!.links![0].relation).toBe('duplicates');
      expect(fetchedDup!.links![0].targetKey).toBe('Core-2');
      const dupLinkOnSubtask = fetchedSubtaskAfterDup!.links!.find((l) => l.targetKey === 'Core-3');
      expect(dupLinkOnSubtask).toBeDefined();
      expect(dupLinkOnSubtask!.relation).toBe('duplicated-by');
    });

    it('removes link bi-directionally', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });

      await storage.createTicket({ title: 'Task A', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Task B', type: 'Feature', projectCode: 'Core' });

      await storage.addTicketLink('Core-1', 'relates-to', 'Core-2');
      expect((await storage.getTicket('Core-1'))!.links).toHaveLength(1);
      expect((await storage.getTicket('Core-2'))!.links).toHaveLength(1);

      // Unlink
      await storage.removeTicketLink('Core-1', 'Core-2');

      expect((await storage.getTicket('Core-1'))!.links).toHaveLength(0);
      expect((await storage.getTicket('Core-2'))!.links).toHaveLength(0);
    });
  });

  describe('Cycle Detection & Self-Link Prevention', () => {
    it('prevents direct self-linking', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });
      await storage.createTicket({ title: 'Task A', type: 'Feature', projectCode: 'Core' });

      await expect(storage.addTicketLink('Core-1', 'blocks', 'Core-1')).rejects.toThrow(
        /Cannot link ticket Core-1 to itself/
      );
    });

    it('detects 2-node direct cycle for blocks relation', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });
      await storage.createTicket({ title: 'Task A', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Task B', type: 'Feature', projectCode: 'Core' });

      // Core-1 blocks Core-2
      await storage.addTicketLink('Core-1', 'blocks', 'Core-2');

      // Attempt Core-2 blocks Core-1
      await expect(storage.addTicketLink('Core-2', 'blocks', 'Core-1')).rejects.toThrow(
        /Circular dependency detected/
      );
    });

    it('detects 3-node transitive cycle for blocks and parent-of relations', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });
      await storage.createTicket({ title: 'Task 1', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Task 2', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Task 3', type: 'Feature', projectCode: 'Core' });

      // 1 blocks 2
      await storage.addTicketLink('Core-1', 'blocks', 'Core-2');
      // 2 blocks 3
      await storage.addTicketLink('Core-2', 'blocks', 'Core-3');

      // Attempt 3 blocks 1 -> cycle!
      await expect(storage.addTicketLink('Core-3', 'blocks', 'Core-1')).rejects.toThrow(
        /Circular dependency detected/
      );

      // Attempt 3 parent-of 2 -> cycle!
      await storage.addTicketLink('Core-1', 'parent-of', 'Core-2');
      await expect(storage.addTicketLink('Core-2', 'parent-of', 'Core-1')).rejects.toThrow(
        /Circular dependency detected/
      );
    });
  });

  describe('Cross-Project Linking & Security Allow-List Isolation', () => {
    it('establishes cross-project link between Core and Web', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

      const coreTicket = await storage.createTicket({
        title: 'Backend Auth Protocol',
        type: 'Platform',
        projectCode: 'Core',
      });
      const webTicket = await storage.createTicket({
        title: 'Web Login Screen',
        type: 'Feature',
        projectCode: 'Web',
      });

      expect(coreTicket.meta.id).toBe(1);
      expect(webTicket.meta.id).toBe(1);

      // Core-1 blocks Web-1
      const result = await storage.addTicketLink('Core-1', 'blocks', 'Web-1');

      expect(result.source.links![0].targetKey).toBe('Web-1');
      expect(result.source.links![0].targetProject).toBe('Web');
      expect(result.source.links![0].targetTitle).toBe('Web Login Screen');

      const fetchedWeb = await storage.getTicket('Web-1');
      expect(fetchedWeb!.links![0].targetKey).toBe('Core-1');
      expect(fetchedWeb!.links![0].targetProject).toBe('Core');
      expect(fetchedWeb!.links![0].relation).toBe('blocked-by');
      expect(fetchedWeb!.isBlocked).toBe(true);
    });

    it('redacts target metadata when target project is outside allowedProjects', async () => {
      const rawStorage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir });

      await rawStorage.createTicket({ title: 'Core Secret Engine', type: 'Platform', projectCode: 'Core' });
      await rawStorage.createTicket({ title: 'Web App', type: 'Feature', projectCode: 'Web' });

      // Link Core-1 relates-to Web-1
      await rawStorage.addTicketLink('Core-1', 'relates-to', 'Web-1');

      // SecurityFilter configured strictly for Web (cannot inspect Core metadata)
      const webOnlySecurity = new SecurityFilter(rawStorage, {
        projectCode: 'Web',
        allowedProjects: ['Web'],
      });

      const webTicket = await webOnlySecurity.getTicket('Web-1');
      expect(webTicket).not.toBeNull();
      expect(webTicket!.links).toHaveLength(1);
      // Link exists with targetKey and targetProject, but title is redacted
      expect(webTicket!.links![0].targetKey).toBe('Core-1');
      expect(webTicket!.links![0].targetProject).toBe('Core');
      expect(webTicket!.links![0].targetTitle).toBe('[Restricted Project]');
      expect(webTicket!.links![0].targetStatus).toBeUndefined();

      // Attempting to mutate unauthorized project throws EsedreAuthorizationError
      await expect(
        webOnlySecurity.addTicketLink('Core-1', 'relates-to', 'Web-1')
      ).rejects.toThrow(EsedreAuthorizationError);
    });
  });

  describe('Query Filters & Snapshot Invalidation', () => {
    it('filters tickets by isBlocked and linkedTo', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });

      await storage.createTicket({ title: 'Ticket 1', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Ticket 2', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Ticket 3', type: 'Feature', projectCode: 'Core' });

      // Core-1 blocks Core-2
      await storage.addTicketLink('Core-1', 'blocks', 'Core-2');

      // Filter by isBlocked
      const blockedTickets = await storage.listTickets({ project: 'Core', isBlocked: true });
      expect(blockedTickets).toHaveLength(1);
      expect(blockedTickets[0].meta.id).toBe(2);

      const unblockedTickets = await storage.listTickets({ project: 'Core', isBlocked: false });
      expect(unblockedTickets).toHaveLength(2);
      expect(unblockedTickets.map((t) => t.meta.id).sort()).toEqual([1, 3]);

      // Filter by linkedTo
      const linkedTo1 = await storage.listTickets({ linkedTo: 'Core-1' });
      expect(linkedTo1).toHaveLength(1);
      expect(linkedTo1[0].meta.id).toBe(2);
    });

    it('generates snapshot projection containing links and isBlocked status', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });

      await storage.createTicket({ title: 'Base Task', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Dependent Task', type: 'Feature', projectCode: 'Core' });

      await storage.addTicketLink('Core-1', 'blocks', 'Core-2');

      const snapshot = await generateProjectSnapshot(storage, 'Core', tmpDir);

      expect(snapshot.projectCode).toBe('Core');
      expect(snapshot.tickets).toHaveLength(2);

      const snap1 = snapshot.tickets.find((t) => t.id === 1);
      const snap2 = snapshot.tickets.find((t) => t.id === 2);

      expect(snap1?.links).toHaveLength(1);
      expect(snap1?.links![0].relation).toBe('blocks');
      expect(snap1?.isBlocked).toBe(false);

      expect(snap2?.links).toHaveLength(1);
      expect(snap2?.links![0].relation).toBe('blocked-by');
      expect(snap2?.isBlocked).toBe(true);
    });

    it('updates links targetKey and targetProject on project code rename', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });

      await storage.createTicket({ title: 'Core Task', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'Web Task', type: 'Feature', projectCode: 'Web' });

      await storage.addTicketLink('Core-1', 'relates-to', 'Web-1');

      // Rename project Web -> Frontend
      const renRes = await storage.renameProjectCode({
        oldCode: 'Web',
        newCode: 'Frontend',
        newName: 'Frontend App',
      });
      expect(renRes.success).toBe(true);

      // Check Core-1 link targetKey has updated to Frontend-1
      const fetchedCore = await storage.getTicket('Core-1');
      expect(fetchedCore).not.toBeNull();
      expect(fetchedCore!.links![0].targetKey).toBe('Frontend-1');
      expect(fetchedCore!.links![0].targetProject).toBe('Frontend');
    });
  });

  describe('MCP Protocol Integration for Ticket Linking', () => {
    it('executes esedre_link_ticket and esedre_unlink_ticket via JSON-RPC', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });
      const server = new EsedreMcpServer(storage);

      const callRpc = async (req: any) => {
        return await (server as any).handleRequest(req);
      };

      await storage.createTicket({ title: 'MCP Task Alpha', type: 'Feature', projectCode: 'Core' });
      await storage.createTicket({ title: 'MCP Task Beta', type: 'Feature', projectCode: 'Core' });

      // Call esedre_link_ticket
      const linkRes = await callRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'esedre_link_ticket',
          arguments: {
            sourceTicketId: 'Core-1',
            relation: 'blocks',
            targetTicketId: 'Core-2',
            author: 'MCP-Agent',
          },
        },
      });

      expect(linkRes.error).toBeUndefined();
      const linkOutput = JSON.parse(linkRes.result.content[0].text);
      expect(linkOutput.success).toBe(true);
      expect(linkOutput.source.meta.id).toBe(1);

      // Call esedre_list_tickets with isBlocked filter
      const listRes = await callRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            project: 'Core',
            isBlocked: true,
          },
        },
      });

      const listOutput = JSON.parse(listRes.result.content[0].text);
      expect(listOutput).toHaveLength(1);
      expect(listOutput[0].id).toBe(2);
      expect(listOutput[0].isBlocked).toBe(true);

      // Call esedre_unlink_ticket
      const unlinkRes = await callRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'esedre_unlink_ticket',
          arguments: {
            sourceTicketId: 'Core-1',
            targetTicketId: 'Core-2',
          },
        },
      });

      expect(unlinkRes.error).toBeUndefined();
      const unlinkOutput = JSON.parse(unlinkRes.result.content[0].text);
      expect(unlinkOutput.success).toBe(true);

      const fetched1 = await storage.getTicket('Core-1');
      expect(fetched1!.links).toHaveLength(0);
    });
  });
});
