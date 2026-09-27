import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { normalizePriority, colorPriority, formatTicketDetail, formatTicketListTable } from '../src/utils/formatter.js';
import { generateProjectSnapshot, computeTicketHash } from '../src/snapshot.js';
import { EsedreTicket, TicketPriority } from '../src/types.js';

describe('Ticket Priority Field (Esedre-17)', () => {
  describe('Normalization & Formatting Utilities', () => {
    it('normalizes valid priority levels case-insensitively', () => {
      expect(normalizePriority('Critical')).toBe('Critical');
      expect(normalizePriority('critical')).toBe('Critical');
      expect(normalizePriority('CRITICAL')).toBe('Critical');

      expect(normalizePriority('High')).toBe('High');
      expect(normalizePriority('high')).toBe('High');
      expect(normalizePriority('HIGH')).toBe('High');

      expect(normalizePriority('Medium')).toBe('Medium');
      expect(normalizePriority('medium')).toBe('Medium');
      expect(normalizePriority('MEDIUM')).toBe('Medium');

      expect(normalizePriority('Low')).toBe('Low');
      expect(normalizePriority('low')).toBe('Low');
      expect(normalizePriority('LOW')).toBe('Low');
    });

    it('returns undefined for invalid, empty, or unknown priority inputs', () => {
      expect(normalizePriority(undefined)).toBeUndefined();
      expect(normalizePriority(null)).toBeUndefined();
      expect(normalizePriority('')).toBeUndefined();
      expect(normalizePriority('   ')).toBeUndefined();
      expect(normalizePriority('urgent')).toBeUndefined();
      expect(normalizePriority('P1')).toBeUndefined();
      expect(normalizePriority('none')).toBeUndefined();
      expect(normalizePriority('null')).toBeUndefined();
    });

    it('formats priority with color helper or clean text', () => {
      expect(colorPriority('Critical')).toContain('Critical');
      expect(colorPriority('High')).toContain('High');
      expect(colorPriority('Medium')).toContain('Medium');
      expect(colorPriority('Low')).toContain('Low');
      expect(colorPriority(undefined)).toBe('');
    });

    it('formatTicketDetail omits Priority section when ticket priority is undefined', () => {
      const ticket: EsedreTicket = {
        meta: {
          id: 1,
          title: 'Legacy Ticket Without Priority',
          category: 'Feature',
          type: 'Feature',
          complexity: 'Low',
          status: 'Planned',
          project: 'Core',
        },
        detail: {
          title: 'Legacy Ticket Without Priority',
          category: 'Feature',
          type: 'Feature',
          complexity: 'Medium',
          summary: 'Legacy rationale',
          breakdown: [],
          openQuestions: [],
          raw: '',
        },
        comments: [],
      };

      const output = formatTicketDetail(ticket);
      expect(output).not.toContain('Priority:');
    });

    it('formatTicketDetail displays Priority section when ticket priority is set', () => {
      const ticket: EsedreTicket = {
        meta: {
          id: 2,
          title: 'Prioritized Ticket',
          category: 'Feature',
          type: 'Feature',
          complexity: 'High',
          status: 'Planned',
          project: 'Core',
          priority: 'Critical',
        },
        detail: {
          title: 'Prioritized Ticket',
          category: 'Feature',
          type: 'Feature',
          complexity: 'High',
          priority: 'Critical',
          summary: 'Urgent fix',
          breakdown: [],
          openQuestions: [],
          raw: '',
        },
        comments: [],
      };

      const output = formatTicketDetail(ticket);
      expect(output).toContain('Priority:');
      expect(output).toContain('Critical');
    });

    it('formatTicketListTable omits Priority column when NO tickets have priority', () => {
      const tickets: EsedreTicket[] = [
        {
          meta: { id: 1, title: 'Alpha', type: 'Feature', category: 'Feature', complexity: 'Low', status: 'Planned', project: 'Core' },
          comments: [],
        },
        {
          meta: { id: 2, title: 'Beta', type: 'Bug', category: 'Bug', complexity: 'Low', status: 'Planned', project: 'Core' },
          comments: [],
        },
      ];

      const table = formatTicketListTable(tickets);
      expect(table).not.toContain('Priority');
    });

    it('formatTicketListTable includes Priority column when at least ONE ticket has priority', () => {
      const tickets: EsedreTicket[] = [
        {
          meta: { id: 1, title: 'Alpha', type: 'Feature', category: 'Feature', complexity: 'Low', status: 'Planned', project: 'Core' },
          comments: [],
        },
        {
          meta: { id: 2, title: 'Beta', type: 'Bug', category: 'Bug', complexity: 'Low', status: 'Planned', project: 'Core', priority: 'High' },
          comments: [],
        },
      ];

      const table = formatTicketListTable(tickets);
      expect(table).toContain('Priority');
      expect(table).toContain('High');
      expect(table).toContain('-'); // Unset ticket gets '-' in table column
    });
  });

  describe('Filesystem Storage Adapter CRUD & Backwards Compatibility', () => {
    let tempDir: string;
    let adapter: FilesystemStorageAdapter;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-prio-test-'));
      const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
      fs.mkdirSync(ticketsDir, { recursive: true });

      const projects = [
        { id: 1, code: 'Core', name: 'Core Application' },
      ];
      fs.writeFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
        JSON.stringify(projects, null, 2)
      );

      adapter = new FilesystemStorageAdapter(tempDir);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('preserves backwards compatibility for existing tickets created without priority', async () => {
      // Seed a legacy ticket directly on disk
      const ticket1Dir = path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1');
      fs.mkdirSync(ticket1Dir, { recursive: true });
      fs.writeFileSync(
        path.join(ticket1Dir, 'meta.json'),
        JSON.stringify({
          id: 1,
          title: 'Legacy Ticket',
          type: 'Feature',
          category: 'Feature',
          projectId: 1,
          project: 'Core',
          status: 'Planned',
        }, null, 2)
      );
      fs.writeFileSync(
        path.join(ticket1Dir, 'detail.md'),
        '# Ticket #1: Legacy Ticket\n\n**Category**: Feature\n**Status**: Planned\n**Complexity**: Medium\n'
      );

      const ticket = await adapter.getTicket(1);
      expect(ticket).not.toBeNull();
      expect(ticket?.meta.priority).toBeUndefined();
      expect(ticket?.detail?.priority).toBeUndefined();

      const all = await adapter.listTickets();
      expect(all[0].meta.priority).toBeUndefined();
    });

    it('creates tickets without priority when omitted, keeping meta.json clean', async () => {
      const created = await adapter.createTicket({
        title: 'Unprioritized Ticket',
        type: 'Feature',
        projectCode: 'Core',
      });

      expect(created.meta.priority).toBeUndefined();
      expect(created.detail?.priority).toBeUndefined();

      // Verify file content on disk
      const metaContent = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'meta.json'), 'utf-8')
      );
      expect(metaContent.priority).toBeUndefined();

      const detailContent = fs.readFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'detail.md'),
        'utf-8'
      );
      expect(detailContent).not.toContain('**Priority**:');
    });

    it('creates tickets with priority and normalizes casing to canonical values', async () => {
      const p1 = await adapter.createTicket({
        title: 'Critical Task',
        type: 'Bug',
        priority: 'critical' as any,
        projectCode: 'Core',
      });
      expect(p1.meta.priority).toBe('Critical');
      expect(p1.detail?.priority).toBe('Critical');

      const p2 = await adapter.createTicket({
        title: 'High Task',
        type: 'Feature',
        priority: 'HIGH' as any,
        projectCode: 'Core',
      });
      expect(p2.meta.priority).toBe('High');
      expect(p2.detail?.priority).toBe('High');

      const p3 = await adapter.createTicket({
        title: 'Medium Task',
        type: 'Feature',
        priority: 'medium' as any,
        projectCode: 'Core',
      });
      expect(p3.meta.priority).toBe('Medium');
      expect(p3.detail?.priority).toBe('Medium');

      const p4 = await adapter.createTicket({
        title: 'Low Task',
        type: 'Tools',
        priority: 'low' as any,
        projectCode: 'Core',
      });
      expect(p4.meta.priority).toBe('Low');
      expect(p4.detail?.priority).toBe('Low');

      // Verify detail.md has **Priority**: Critical
      const detail1 = fs.readFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'detail.md'),
        'utf-8'
      );
      expect(detail1).toContain('**Priority**: Critical');
    });

    it('updates priority on an existing ticket and updates detail.md', async () => {
      const created = await adapter.createTicket({
        title: 'Initial Ticket',
        type: 'Feature',
        projectCode: 'Core',
      });
      expect(created.meta.priority).toBeUndefined();

      // Set priority to High
      const updated1 = await adapter.updateTicket(1, { priority: 'High' });
      expect(updated1.meta.priority).toBe('High');
      expect(updated1.detail?.priority).toBe('High');

      const detail1 = fs.readFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'detail.md'),
        'utf-8'
      );
      expect(detail1).toContain('**Priority**: High');

      // Update priority to Critical
      const updated2 = await adapter.updateTicket(1, { priority: 'Critical' });
      expect(updated2.meta.priority).toBe('Critical');
      expect(updated2.detail?.priority).toBe('Critical');

      const detail2 = fs.readFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'detail.md'),
        'utf-8'
      );
      expect(detail2).toContain('**Priority**: Critical');
      expect(detail2).not.toContain('**Priority**: High');
    });

    it('clears priority cleanly with "none" or null, removing from meta.json and detail.md', async () => {
      const created = await adapter.createTicket({
        title: 'Ticket with Initial Priority',
        type: 'Feature',
        priority: 'High',
        projectCode: 'Core',
      });
      expect(created.meta.priority).toBe('High');

      // Clear using 'none'
      const cleared = await adapter.updateTicket(1, { priority: 'none' as any });
      expect(cleared.meta.priority).toBeUndefined();
      expect(cleared.detail?.priority).toBeUndefined();

      const metaOnDisk = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'meta.json'), 'utf-8')
      );
      expect(metaOnDisk.priority).toBeUndefined();

      const detailOnDisk = fs.readFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'tickets', '1', 'detail.md'),
        'utf-8'
      );
      expect(detailOnDisk).not.toContain('**Priority**:');

      // Re-set to Low and clear with null
      await adapter.updateTicket(1, { priority: 'Low' });
      const clearedNull = await adapter.updateTicket(1, { priority: null as any });
      expect(clearedNull.meta.priority).toBeUndefined();
    });

    it('filters tickets by priority in listTickets', async () => {
      await adapter.createTicket({ title: 'T1', type: 'Bug', priority: 'Critical', projectCode: 'Core' });
      await adapter.createTicket({ title: 'T2', type: 'Bug', priority: 'High', projectCode: 'Core' });
      await adapter.createTicket({ title: 'T3', type: 'Feature', priority: 'High', projectCode: 'Core' });
      await adapter.createTicket({ title: 'T4', type: 'Feature', priority: 'Low', projectCode: 'Core' });
      await adapter.createTicket({ title: 'T5', type: 'Idea', projectCode: 'Core' }); // No priority

      // Filter: Critical
      const criticalOnly = await adapter.listTickets({ priority: 'Critical' });
      expect(criticalOnly).toHaveLength(1);
      expect(criticalOnly[0].meta.id).toBe(1);

      // Filter: High (case-insensitive)
      const highOnly = await adapter.listTickets({ priority: 'high' as any });
      expect(highOnly).toHaveLength(2);
      expect(highOnly.map((t) => t.meta.id)).toEqual([2, 3]);

      // Filter: Low
      const lowOnly = await adapter.listTickets({ priority: 'Low' });
      expect(lowOnly).toHaveLength(1);
      expect(lowOnly[0].meta.id).toBe(4);

      // Filter: Unset / None
      const unprioritized = await adapter.listTickets({ priority: 'none' as any });
      expect(unprioritized).toHaveLength(1);
      expect(unprioritized[0].meta.id).toBe(5);

      // Filter: All (no priority filter)
      const all = await adapter.listTickets();
      expect(all).toHaveLength(5);
    });
  });

  describe('Snapshot Projection & OCC Concurrency', () => {
    let tempDir: string;
    let adapter: FilesystemStorageAdapter;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-snap-prio-'));
      const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
      fs.mkdirSync(ticketsDir, { recursive: true });

      const projects = [{ id: 1, code: 'Core', name: 'Core Application' }];
      fs.writeFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
        JSON.stringify(projects, null, 2)
      );
      adapter = new FilesystemStorageAdapter(tempDir);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('generates snapshot entries with priority when present and undefined when absent', async () => {
      await adapter.createTicket({ title: 'No Prio', type: 'Feature', projectCode: 'Core' });
      await adapter.createTicket({ title: 'With Prio', type: 'Feature', priority: 'High', projectCode: 'Core' });

      const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);
      expect(snapshot.tickets).toHaveLength(2);
      expect(snapshot.tickets[0].priority).toBeUndefined();
      expect(snapshot.tickets[1].priority).toBe('High');
    });

    it('changes ticket OCC hash when priority changes to prevent silent overwrites', async () => {
      const t1 = await adapter.createTicket({ title: 'OCC Test', type: 'Feature', projectCode: 'Core' });
      const hashBefore = computeTicketHash(t1);

      const t1Updated = await adapter.updateTicket(1, { priority: 'Critical' });
      const hashAfter = computeTicketHash(t1Updated);

      expect(hashBefore).not.toBe(hashAfter);
    });
  });

  describe('Model Context Protocol (MCP) Integration', () => {
    let tempDir: string;
    let adapter: FilesystemStorageAdapter;
    let server: EsedreMcpServer;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-mcp-prio-'));
      const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
      fs.mkdirSync(ticketsDir, { recursive: true });

      const projects = [{ id: 1, code: 'Core', name: 'Core Application' }];
      fs.writeFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
        JSON.stringify(projects, null, 2)
      );
      adapter = new FilesystemStorageAdapter(tempDir);
      server = new EsedreMcpServer(adapter);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const callRpc = async (req: any) => {
      return await (server as any).handleRequest(req);
    };

    it('creates a ticket with priority via esedre_create_ticket', async () => {
      const res = await callRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'MCP Ticket with Priority',
            type: 'Feature',
            priority: 'Critical',
            project: 'Core',
          },
        },
      });

      expect(res.error).toBeUndefined();
      const content = JSON.parse(res.result.content[0].text);
      expect(content.meta.priority).toBe('Critical');
      expect(content.detail.priority).toBe('Critical');
    });

    it('updates ticket priority via esedre_update_ticket', async () => {
      await adapter.createTicket({ title: 'MCP Update Test', type: 'Feature', projectCode: 'Core' });

      const res = await callRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: 1,
            priority: 'High',
            project: 'Core',
          },
        },
      });

      expect(res.error).toBeUndefined();
      const content = JSON.parse(res.result.content[0].text);
      expect(content.meta.priority).toBe('High');
    });

    it('filters tickets by priority via esedre_list_tickets', async () => {
      await adapter.createTicket({ title: 'T1', type: 'Bug', priority: 'Critical', projectCode: 'Core' });
      await adapter.createTicket({ title: 'T2', type: 'Feature', priority: 'Low', projectCode: 'Core' });
      await adapter.createTicket({ title: 'T3', type: 'Idea', projectCode: 'Core' });

      const resCritical = await callRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            priority: 'Critical',
            project: 'Core',
          },
        },
      });

      const critTickets = JSON.parse(resCritical.result.content[0].text);
      expect(critTickets).toHaveLength(1);
      expect(critTickets[0].priority).toBe('Critical');

      const resNone = await callRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            priority: 'none',
            project: 'Core',
          },
        },
      });

      const noneTickets = JSON.parse(resNone.result.content[0].text);
      expect(noneTickets).toHaveLength(1);
      expect(noneTickets[0].title).toBe('T3');
    });
  });

  describe('CLI Commands & Shorthand Flags (-P / --priority)', () => {
    let tempDir: string;
    let cliScriptPath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-cli-prio-'));
      cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
      const esedreDir = path.join(tempDir, '.esedre');
      fs.mkdirSync(ticketsDir, { recursive: true });
      fs.mkdirSync(esedreDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'cli-test-repo' }));
      fs.writeFileSync(
        path.join(esedreDir, 'esedre.json'),
        JSON.stringify({ projectCode: 'Core', allowedProjects: ['Core'] }, null, 2)
      );

      const projects = [{ id: 1, code: 'Core', name: 'Core Application' }];
      fs.writeFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
        JSON.stringify(projects, null, 2)
      );
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const runCli = (args: string[]) => {
      return execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
      });
    };

    it('creates ticket with priority via -P shorthand flag', () => {
      const out = runCli(['create', '--title', 'CLI Shorthand Ticket', '-P', 'High']);
      expect(out).toContain('Created Ticket #1');
      expect(out).toContain('[High]');

      const detail = runCli(['get', '1', '--json']);
      const parsed = JSON.parse(detail);
      expect(parsed.meta.priority).toBe('High');
      expect(parsed.detail.priority).toBe('High');
    });

    it('creates ticket with priority via --priority full flag', () => {
      const out = runCli(['create', '--title', 'CLI Full Flag Ticket', '--priority', 'Critical']);
      expect(out).toContain('Created Ticket #1');
      expect(out).toContain('[Critical]');

      const detail = runCli(['get', '1', '--json']);
      const parsed = JSON.parse(detail);
      expect(parsed.meta.priority).toBe('Critical');
    });

    it('updates ticket priority via ese update -P', () => {
      runCli(['create', '--title', 'Update Target Ticket', '-P', 'Low']);
      const updateOut = runCli(['update', '1', '-P', 'Critical']);
      expect(updateOut).toContain('Updated Ticket #1');
      expect(updateOut).toContain('Priority: Critical');

      const detail = runCli(['get', '1', '--json']);
      const parsed = JSON.parse(detail);
      expect(parsed.meta.priority).toBe('Critical');
    });

    it('clears ticket priority via ese update -P none', () => {
      runCli(['create', '--title', 'Clear Target Ticket', '-P', 'High']);
      const updateOut = runCli(['update', '1', '-P', 'none']);
      expect(updateOut).toContain('Updated Ticket #1');
      expect(updateOut).not.toContain('Priority:');

      const detail = runCli(['get', '1', '--json']);
      const parsed = JSON.parse(detail);
      expect(parsed.meta.priority).toBeUndefined();
    });

    it('filters tickets via ese list -P and ese list --priority', () => {
      runCli(['create', '--title', 'Crit Ticket', '-P', 'Critical']);
      runCli(['create', '--title', 'High Ticket', '-P', 'High']);
      runCli(['create', '--title', 'Unset Ticket']);

      const listCrit = runCli(['list', '-P', 'Critical', '--json']);
      const parsedCrit = JSON.parse(listCrit);
      expect(parsedCrit).toHaveLength(1);
      expect(parsedCrit[0].title).toBe('Crit Ticket');

      const listNone = runCli(['list', '-P', 'none', '--json']);
      const parsedNone = JSON.parse(listNone);
      expect(parsedNone).toHaveLength(1);
      expect(parsedNone[0].title).toBe('Unset Ticket');
    });

    it('rejects invalid priority values with clean error message', () => {
      expect(() => {
        runCli(['create', '--title', 'Bad Prio', '-P', 'SuperUrgent']);
      }).toThrow();
    });
  });
});
