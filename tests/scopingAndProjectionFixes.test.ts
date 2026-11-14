import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import { formatMilestoneListTable } from '../src/utils/formatter.js';
import { CURRENT_ESEDRE_VERSION } from '../src/types.js';

describe('Ticket #115: Snapshot Isolation, List Compaction, Project "all", and Milestone Namespace Scoping', () => {
  let tmpDir: string;
  let hubDir: string;
  let lab151Dir: string;
  let sleepDir: string;
  let fakeGlobalDir: string;
  const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-115-test-'));
    hubDir = path.join(tmpDir, 'hub');
    lab151Dir = path.join(tmpDir, 'lab151');
    sleepDir = path.join(tmpDir, 'sleep');
    fakeGlobalDir = path.join(tmpDir, 'global-esedre');

    fs.mkdirSync(hubDir, { recursive: true });
    fs.mkdirSync(path.join(lab151Dir, '.esedre'), { recursive: true });
    fs.mkdirSync(path.join(sleepDir, '.esedre'), { recursive: true });
    fs.mkdirSync(fakeGlobalDir, { recursive: true });

    for (const proj of [
      { code: 'Lab151', name: 'Lab 151' },
      { code: 'Sleep', name: 'Sleep Center' },
      { code: 'Personal', name: 'Personal Tasks' },
      { code: 'Secret', name: 'Classified Ops' },
    ]) {
      const pDir = path.join(hubDir, 'projects', proj.code);
      fs.mkdirSync(path.join(pDir, 'tickets'), { recursive: true });
      fs.writeFileSync(
        path.join(pDir, 'project.json'),
        JSON.stringify({ code: proj.code, name: proj.name }, null, 2) + '\n',
        'utf-8'
      );
    }

    // Personal intentionally has NO workspace directory in config.json (workspace-less hub project)
    fs.writeFileSync(
      path.join(fakeGlobalDir, 'config.json'),
      JSON.stringify(
        {
          version: CURRENT_ESEDRE_VERSION,
          dataDir: hubDir,
          projects: {
            Lab151: lab151Dir,
            Sleep: sleepDir,
          },
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );

    fs.writeFileSync(
      path.join(lab151Dir, '.esedre', 'esedre.json'),
      JSON.stringify(
        {
          version: CURRENT_ESEDRE_VERSION,
          projectCode: 'Lab151',
          projectName: 'Lab 151',
          allowedProjects: ['Lab151', 'Sleep', 'Personal'],
          dataDir: hubDir,
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );

    fs.writeFileSync(
      path.join(sleepDir, '.esedre', 'esedre.json'),
      JSON.stringify(
        {
          version: CURRENT_ESEDRE_VERSION,
          projectCode: 'Sleep',
          projectName: 'Sleep Center',
          allowedProjects: ['Sleep', 'Lab151', 'Personal'],
          dataDir: hubDir,
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const callRpc = async (serverInstance: EsedreMcpServer, req: any) => {
    return await (serverInstance as any).handleRequest(req);
  };

  describe('1. Cross-Project snapshot.json Clobber Guard', () => {
    it('never overwrites caller workspace snapshot.json when mutating a workspace-less hub project via CLI, MCP, or direct snapshot call', async () => {
      const prevGlobal = process.env.ESEDRE_GLOBAL_DIR;
      process.env.ESEDRE_GLOBAL_DIR = fakeGlobalDir;
      try {
        const storage = new FilesystemStorageAdapter(lab151Dir, {
          projectCode: 'Lab151',
          allowedProjects: ['Lab151', 'Sleep', 'Personal'],
          dataDir: hubDir,
        });

        await storage.createTicket({
          projectCode: 'Lab151',
          title: 'Lab151 Anchor Ticket',
          type: 'Feature',
        });
        await generateProjectSnapshot(storage, 'Lab151', lab151Dir);

        const labSnapPath = path.join(lab151Dir, '.esedre', 'snapshot.json');
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        // 1a. Direct generateProjectSnapshot call for Personal targeting lab151Dir must NOT overwrite lab151/.esedre/snapshot.json
        const personalMemSnap = await generateProjectSnapshot(storage, 'Personal', lab151Dir);
        expect(personalMemSnap.projectCode).toBe('Personal');
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        // 1b. CLI mutations on Personal run from cwd=lab151Dir must preserve lab151/.esedre/snapshot.json
        const cliEnv = {
          ...process.env,
          ESEDRE_GLOBAL_DIR: fakeGlobalDir,
          NODE_ENV: 'test',
        };
        execFileSync(
          process.execPath,
          [cliPath, 'create', '--title', 'Personal Errand', '--project', 'Personal', '--type', 'Idea', '--json'],
          { cwd: lab151Dir, env: cliEnv, encoding: 'utf-8' }
        );
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        execFileSync(
          process.execPath,
          [cliPath, 'claim', 'Personal-1', '--by', 'Tester', '--json'],
          { cwd: lab151Dir, env: cliEnv, encoding: 'utf-8' }
        );
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        execFileSync(
          process.execPath,
          [cliPath, 'release', 'Personal-1', '--by', 'Tester', '--status', 'Completed', '--json'],
          { cwd: lab151Dir, env: cliEnv, encoding: 'utf-8' }
        );
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        // Explicit CLI `ese snapshot --project Personal` without --json fails safely without clobbering Lab151
        expect(() => {
          execFileSync(process.execPath, [cliPath, 'snapshot', '--project', 'Personal'], {
            cwd: lab151Dir,
            env: cliEnv,
            encoding: 'utf-8',
            stdio: 'pipe',
          });
        }).toThrow();
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        // Explicit CLI `ese snapshot --project Personal --json` outputs Personal JSON while keeping disk untouched
        const jsonSnapOut = execFileSync(
          process.execPath,
          [cliPath, 'snapshot', '--project', 'Personal', '--json'],
          { cwd: lab151Dir, env: cliEnv, encoding: 'utf-8' }
        );
        expect(JSON.parse(jsonSnapOut).projectCode).toBe('Personal');
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).projectCode).toBe('Lab151');

        // 1c. Simulate an already-corrupted snapshot.json ("projectCode": "Personal") inside lab151/.esedre/
        // MCP mutations on Personal must NOT continue writing Personal into lab151/.esedre/snapshot.json
        fs.writeFileSync(
          labSnapPath,
          JSON.stringify({ version: CURRENT_ESEDRE_VERSION, projectCode: 'Personal', totalTickets: 99, tickets: [] }, null, 2) + '\n',
          'utf-8'
        );

        const secured = new SecurityFilter(storage, {
          projectCode: 'Lab151',
          allowedProjects: ['Lab151', 'Sleep', 'Personal'],
          dataDir: hubDir,
        });
        const mcp = new EsedreMcpServer(secured, {
          workspaceRoot: lab151Dir,
          projectCode: 'Lab151',
          config: {
            projectCode: 'Lab151',
            allowedProjects: ['Lab151', 'Sleep', 'Personal'],
            dataDir: hubDir,
          },
        });
        (mcp as any).activeWorkspacePaths = [lab151Dir];

        const mcpCreatePersonal = await callRpc(mcp, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'esedre_create_ticket',
            arguments: {
              project: 'Personal',
              title: 'Second Personal Task',
              type: 'Idea',
            },
          },
        });
        expect(mcpCreatePersonal.error).toBeUndefined();
        // Corrupted sentinel totalTickets: 99 was NOT refreshed with Personal's 2 tickets
        expect(JSON.parse(fs.readFileSync(labSnapPath, 'utf-8')).totalTickets).toBe(99);

        // Mutating Lab151 immediately restores lab151/.esedre/snapshot.json back to Lab151
        const mcpUpdateLab = await callRpc(mcp, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'esedre_update_ticket',
            arguments: {
              ticketId: 'Lab151-1',
              summary: 'Restored Lab151 snapshot',
            },
          },
        });
        expect(mcpUpdateLab.error).toBeUndefined();
        const restoredSnap = JSON.parse(fs.readFileSync(labSnapPath, 'utf-8'));
        expect(restoredSnap.projectCode).toBe('Lab151');
        expect(restoredSnap.totalTickets).toBe(1);
      } finally {
        if (prevGlobal === undefined) delete process.env.ESEDRE_GLOBAL_DIR;
        else process.env.ESEDRE_GLOBAL_DIR = prevGlobal;
      }
    });
  });

  describe('2. MCP esedre_list_tickets Supports project: "all" Within allowedProjects', () => {
    it('expands project: "all" (case-insensitive) across allowedProjects while excluding unauthorized projects', async () => {
      const raw = new FilesystemStorageAdapter(lab151Dir, { dataDir: hubDir });
      await raw.createTicket({ projectCode: 'Lab151', title: 'Lab Item' });
      await raw.createTicket({ projectCode: 'Sleep', title: 'Sleep Item' });
      await raw.createTicket({ projectCode: 'Secret', title: 'Top Secret Item' });

      const secured = new SecurityFilter(raw, {
        projectCode: 'Lab151',
        allowedProjects: ['Lab151', 'Sleep'],
      });
      const mcp = new EsedreMcpServer(secured, {
        workspaceRoot: lab151Dir,
        projectCode: 'Lab151',
        config: { projectCode: 'Lab151', allowedProjects: ['Lab151', 'Sleep'], dataDir: hubDir },
      });

      for (const allVariant of ['all', 'ALL', 'All']) {
        const res = await callRpc(mcp, {
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'esedre_list_tickets',
            arguments: { project: allVariant },
          },
        });
        expect(res.error).toBeUndefined();
        const items = JSON.parse(res.result.content[0].text);
        expect(items.map((t: any) => `${t.project}-${t.id}`).sort()).toEqual(['Lab151-1', 'Sleep-1']);
      }

      // Direct query to unauthorized project still throws Access Denied
      const denied = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: { project: 'Secret' },
        },
      });
      expect(denied.error).toBeDefined();
      expect(denied.error.message).toMatch(/Access Denied.*Secret/i);
    });
  });

  describe('3. MCP & CLI compact: true and includeCompleted: false', () => {
    it('omits summaries and hydrated links[] when compact: true and omits terminal tickets when includeCompleted: false', async () => {
      const storage = new FilesystemStorageAdapter(sleepDir, {
        projectCode: 'Sleep',
        allowedProjects: ['Sleep'],
        dataDir: hubDir,
      });

      const t1 = await storage.createTicket({
        projectCode: 'Sleep',
        title: 'Blocker Ticket',
        summary: 'Detailed summary for blocker ticket that should be omitted in compact mode',
        priority: 'High',
      });
      const t2 = await storage.createTicket({
        projectCode: 'Sleep',
        title: 'Dependent Ticket',
        summary: 'Detailed summary for dependent ticket',
      });
      await storage.addTicketLink(`Sleep-${t1.meta.id}`, 'blocks', `Sleep-${t2.meta.id}`);

      const t3 = await storage.createTicket({
        projectCode: 'Sleep',
        title: 'Finished Ticket',
        summary: 'Completed work',
      });
      await storage.updateTicket(`Sleep-${t3.meta.id}`, { status: 'Completed' });

      const t4 = await storage.createTicket({
        projectCode: 'Sleep',
        title: 'Dropped Idea',
        summary: 'Rejected idea',
      });
      await storage.updateTicket(`Sleep-${t4.meta.id}`, { status: 'Rejected' });

      const mcp = new EsedreMcpServer(storage, {
        workspaceRoot: sleepDir,
        projectCode: 'Sleep',
        config: { projectCode: 'Sleep', allowedProjects: ['Sleep'], dataDir: hubDir },
      });

      // Default list includes hydrated links and summary on active tickets
      const defaultRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: { project: 'Sleep' },
        },
      });
      const defaultList = JSON.parse(defaultRes.result.content[0].text);
      expect(defaultList).toHaveLength(4);
      const defaultDep = defaultList.find((x: any) => x.id === t2.meta.id);
      expect(defaultDep.summary).toBe('Detailed summary for dependent ticket');
      expect(Array.isArray(defaultDep.links)).toBe(true);
      expect(defaultDep.links).toHaveLength(1);

      // compact: true + includeCompleted: false omits summaries, hydrated links[], and terminal tickets
      const compactRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            project: 'Sleep',
            compact: true,
            includeCompleted: false,
          },
        },
      });
      expect(compactRes.error).toBeUndefined();
      const compactList = JSON.parse(compactRes.result.content[0].text);
      expect(compactList).toHaveLength(2);
      const compactBlocker = compactList.find((x: any) => x.id === t1.meta.id);
      const compactDep = compactList.find((x: any) => x.id === t2.meta.id);

      expect(compactBlocker.summary).toBeUndefined();
      expect(compactBlocker.links).toBeUndefined();
      expect(compactBlocker.linkCount).toBe(1);
      expect(compactBlocker.isBlocked).toBeUndefined();

      expect(compactDep.summary).toBeUndefined();
      expect(compactDep.links).toBeUndefined();
      expect(compactDep.linkCount).toBe(1);
      expect(compactDep.isBlocked).toBe(true);

      // CLI parity: ese list --compact --no-include-completed --json
      const cliOut = execFileSync(
        process.execPath,
        [cliPath, 'list', '--project', 'Sleep', '--compact', '--no-include-completed', '--json'],
        {
          cwd: sleepDir,
          env: { ...process.env, ESEDRE_GLOBAL_DIR: fakeGlobalDir, NODE_ENV: 'test' },
          encoding: 'utf-8',
        }
      );
      const cliCompact = JSON.parse(cliOut);
      expect(cliCompact).toHaveLength(2);
      expect(cliCompact[0].links).toBeUndefined();
      expect(cliCompact[0].lease).toBeUndefined();
      expect(cliCompact[0].linkCount).toBe(1);
    });
  });

  describe('4. Cross-Project Milestone Prefix Collision Guard', () => {
    it('excludes cross-project <OtherProject>:1 tickets when querying Sleep milestone #1 in MCP, CLI, listTickets, and formatter', async () => {
      const raw = new FilesystemStorageAdapter(sleepDir, { dataDir: hubDir });

      await raw.createMilestone({ projectCode: 'Sleep', title: 'Sleep Phase 1', status: 'Active' });
      await raw.createMilestone({ projectCode: 'Lab151', title: 'Lab151 Phase 1', status: 'Active' });
      await raw.createMilestone({ projectCode: 'Personal', title: 'Personal Phase 1', status: 'Active' });

      // 7 Sleep tickets in Sleep's own milestone "1"
      for (let i = 1; i <= 7; i++) {
        await raw.createTicket({
          projectCode: 'Sleep',
          title: `Sleep Native M1 Ticket ${i}`,
          milestone: i === 7 ? 'Sleep:1' : '1',
        });
      }

      // 3 Sleep tickets assigned to umbrella milestone "Lab151:1"
      for (let i = 1; i <= 3; i++) {
        await raw.createTicket({
          projectCode: 'Sleep',
          title: `Sleep Cross-Repo Lab151 Ticket ${i}`,
          milestone: 'Lab151:1',
        });
      }

      // 1 Sleep ticket assigned to "Personal:1"
      await raw.createTicket({
        projectCode: 'Sleep',
        title: 'Sleep Cross-Repo Personal Ticket',
        milestone: 'Personal:1',
      });

      // 2 native Lab151 tickets in Lab151's own milestone "1"
      await raw.createTicket({
        projectCode: 'Lab151',
        title: 'Lab151 Native Ticket 1',
        milestone: '1',
      });
      await raw.createTicket({
        projectCode: 'Lab151',
        title: 'Lab151 Native Ticket 2',
        milestone: '1',
      });

      const secured = new SecurityFilter(raw, {
        projectCode: 'Sleep',
        allowedProjects: ['Sleep', 'Lab151', 'Personal'],
      });
      const mcp = new EsedreMcpServer(secured, {
        workspaceRoot: sleepDir,
        projectCode: 'Sleep',
        config: {
          projectCode: 'Sleep',
          allowedProjects: ['Sleep', 'Lab151', 'Personal'],
          dataDir: hubDir,
        },
      });

      // 4a. esedre_get_milestone({ project: "Sleep", milestoneId: 1 }) -> strictly 7 Sleep:1 tickets (NOT 11!)
      const sleepMsRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'esedre_get_milestone',
          arguments: { project: 'Sleep', milestoneId: 1 },
        },
      });
      expect(sleepMsRes.error).toBeUndefined();
      const sleepMs = JSON.parse(sleepMsRes.result.content[0].text);
      expect(sleepMs.project).toBe('Sleep');
      expect(sleepMs.id).toBe(1);
      expect(sleepMs.totalTickets).toBe(7);
      expect(sleepMs.tickets).toHaveLength(7);
      expect(sleepMs.tickets.every((t: any) => t.project === 'Sleep')).toBe(true);
      expect(
        sleepMs.tickets.some(
          (t: any) => t.milestone === 'Lab151:1' || t.milestone === 'Personal:1'
        )
      ).toBe(false);

      // 4b. esedre_get_milestone({ project: "Lab151", milestoneId: 1 }) -> 2 native Lab151 + 3 cross-project Sleep tickets = 5
      const labMsRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'esedre_get_milestone',
          arguments: { project: 'Lab151', milestoneId: 1 },
        },
      });
      expect(labMsRes.error).toBeUndefined();
      const labMs = JSON.parse(labMsRes.result.content[0].text);
      expect(labMs.project).toBe('Lab151');
      expect(labMs.totalTickets).toBe(5);

      // 4c. Direct listTickets({ project: "Sleep", milestone: "1" }) vs listTickets({ project: "Sleep", milestone: "Lab151:1" })
      const sleepLocalM1 = await secured.listTickets({ project: 'Sleep', milestone: '1' });
      expect(sleepLocalM1).toHaveLength(7);

      const sleepInLabM1 = await secured.listTickets({ project: 'Sleep', milestone: 'Lab151:1' });
      expect(sleepInLabM1).toHaveLength(3);

      // 4d. CLI `ese milestone get 1 -p Sleep --json` returns 7 tickets
      const cliMsOut = execFileSync(
        process.execPath,
        [cliPath, 'milestone', 'get', '1', '-p', 'Sleep', '--json'],
        {
          cwd: sleepDir,
          env: { ...process.env, ESEDRE_GLOBAL_DIR: fakeGlobalDir, NODE_ENV: 'test' },
          encoding: 'utf-8',
        }
      );
      const cliMs = JSON.parse(cliMsOut);
      expect(cliMs.totalTickets).toBe(7);

      // 4e. Snapshot milestones progress on Sleep counts strictly 7 tickets
      const sleepSnapshot = await generateProjectSnapshot(secured, 'Sleep', sleepDir);
      expect(sleepSnapshot.milestones).toHaveLength(1);
      expect(sleepSnapshot.milestones![0].totalTickets).toBe(7);

      // 4f. formatMilestoneListTable across all projects does not cross-pollinate numeric "1"
      const allMilestones = await secured.listMilestones('all');
      const allTickets = await secured.listTickets({ project: 'all' });
      const table = formatMilestoneListTable(allMilestones, allTickets);
      expect(table).toContain('0/7'); // Sleep Phase 1: 0/7
      expect(table).toContain('0/5'); // Lab151 Phase 1: 0/5 (2 Lab151 + 3 Lab151:1)
      expect(table).toContain('0/1'); // Personal Phase 1: 0/1 (1 Personal:1)
    });
  });

  describe('5. esedre_get_ticket & esedre_get_milestone includeRaw Default & hasUnparsedMarkdown Hint', () => {
    it('omits detail.raw by default, preserves secondary Overview/custom headings, and sets hasUnparsedMarkdown when code blocks or tables exist', async () => {
      const storage = new FilesystemStorageAdapter(lab151Dir, {
        dataDir: hubDir,
        projectCode: 'Lab151',
        allowedProjects: ['Lab151'],
      });
      const secured = new SecurityFilter(storage, {
        projectCode: 'Lab151',
        allowedProjects: ['Lab151'],
      });
      const mcp = new EsedreMcpServer(secured, {
        workspaceRoot: lab151Dir,
        projectCode: 'Lab151',
        config: { projectCode: 'Lab151', allowedProjects: ['Lab151'], dataDir: hubDir },
      });

      await secured.createMilestone({ projectCode: 'Lab151', title: 'Rich Spec Milestone' });

      // 5a. Ticket with nested sub-bullets, secondary ## Overview, and custom ## Rollout Notes -> omits detail.raw, no hasUnparsedMarkdown
      const proseSpec = await secured.createTicket({
        projectCode: 'Lab151',
        title: 'Nested Sub-bullets & Custom Headings',
        milestone: '1',
        detail: [
          '### Summary',
          'Primary summary text.',
          '',
          '## Overview',
          'Secondary overview paragraph that previously dropped when Summary existed.',
          '',
          '### Feature Breakdown',
          '1. **Parent Deliverable**:',
          '   - Nested sub-bullet one with `inline | pipe`',
          '   - Nested sub-bullet two',
          '',
          '## Rollout Notes',
          'Staged rollout across staging before production.',
        ].join('\n'),
        plan: '# Plan\n\n1. Implement\n2. Verify',
      });

      const getProseRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 50,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: `Lab151-${proseSpec.meta.id}` },
        },
      });
      expect(getProseRes.error).toBeUndefined();
      const prosePayload = JSON.parse(getProseRes.result.content[0].text);
      expect(prosePayload.detail.raw).toBeUndefined();
      expect(prosePayload.detail.hasUnparsedMarkdown).toBeUndefined();
      expect(prosePayload.detail.summary).toBe('Primary summary text.');
      expect(prosePayload.detail.breakdown).toContain(
        '**Overview**: Secondary overview paragraph that previously dropped when Summary existed.'
      );
      expect(prosePayload.detail.breakdown).toContain(
        '**Rollout Notes**: Staged rollout across staging before production.'
      );
      expect(
        prosePayload.detail.breakdown.some((item: string) =>
          item.includes('Nested sub-bullet one with `inline | pipe`')
        )
      ).toBe(true);

      // 5b. Ticket with fenced code block and Markdown table in Technical Details -> omits detail.raw by default and sets hasUnparsedMarkdown: true
      const richSpec = await secured.createTicket({
        projectCode: 'Lab151',
        title: 'Spec With Code Block & Table',
        milestone: '1',
        detail: [
          '### Summary',
          'Compact summary.',
          '',
          '### Feature Breakdown',
          '- Implement schema adapter',
          '',
          '### Technical Details',
          '- Endpoint matrix:',
          '',
          '| Route | Method |',
          '|---|---|',
          '| /api/sync | POST |',
          '',
          '```ts',
          'export const TIMEOUT_MS = 5000;',
          '```',
        ].join('\n'),
      });

      const getRichDefaultRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 51,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: `Lab151-${richSpec.meta.id}` },
        },
      });
      expect(getRichDefaultRes.error).toBeUndefined();
      const richDefaultPayload = JSON.parse(getRichDefaultRes.result.content[0].text);
      expect(richDefaultPayload.detail.raw).toBeUndefined();
      expect(richDefaultPayload.detail.hasUnparsedMarkdown).toBe(true);

      // Passing includeRaw: true returns full raw markdown and omits hasUnparsedMarkdown
      const getRichWithRawRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 52,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: `Lab151-${richSpec.meta.id}`, includeRaw: true },
        },
      });
      expect(getRichWithRawRes.error).toBeUndefined();
      const richWithRawPayload = JSON.parse(getRichWithRawRes.result.content[0].text);
      expect(richWithRawPayload.detail.raw).toContain('export const TIMEOUT_MS = 5000;');
      expect(richWithRawPayload.detail.raw).toContain('| /api/sync | POST |');
      expect(richWithRawPayload.detail.hasUnparsedMarkdown).toBeUndefined();

      // esedre_get_milestone with includeDetails: true also defaults includeRaw to false and sets hasUnparsedMarkdown: true
      const getMsDetailsRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 53,
        method: 'tools/call',
        params: {
          name: 'esedre_get_milestone',
          arguments: { project: 'Lab151', milestoneId: 1, includeDetails: true },
        },
      });
      expect(getMsDetailsRes.error).toBeUndefined();
      const msDetailsPayload = JSON.parse(getMsDetailsRes.result.content[0].text);
      const msProseTicket = msDetailsPayload.tickets.find((t: any) => t.id === proseSpec.meta.id);
      const msRichTicket = msDetailsPayload.tickets.find((t: any) => t.id === richSpec.meta.id);
      expect(msProseTicket.detail.raw).toBeUndefined();
      expect(msProseTicket.detail.hasUnparsedMarkdown).toBeUndefined();
      expect(msRichTicket.detail.raw).toBeUndefined();
      expect(msRichTicket.detail.hasUnparsedMarkdown).toBe(true);

      // 5c. Ticket where a code block appears ONLY inside Summary (already retained verbatim in detail.summary) -> hasUnparsedMarkdown is undefined
      const summaryOnlyFence = await secured.createTicket({
        projectCode: 'Lab151',
        title: 'Fence Inside Summary Only',
        detail: [
          '### Summary',
          'Run command:',
          '```bash',
          'ese sync --status',
          '```',
          '',
          '### Feature Breakdown',
          '- Verify exit code 0',
        ].join('\n'),
      });
      const getSummaryFenceRes = await callRpc(mcp, {
        jsonrpc: '2.0',
        id: 54,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: `Lab151-${summaryOnlyFence.meta.id}` },
        },
      });
      const summaryFencePayload = JSON.parse(getSummaryFenceRes.result.content[0].text);
      expect(summaryFencePayload.detail.raw).toBeUndefined();
      expect(summaryFencePayload.detail.summary).toContain('ese sync --status');
      expect(summaryFencePayload.detail.hasUnparsedMarkdown).toBeUndefined();
    });
  });
});
