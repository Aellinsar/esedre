import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { parseCliArgs } from '../src/utils/cliArgs.js';
import {
  isClearSentinel,
  normalizeTicketType,
  validateTicketType,
  normalizeTicketStatus,
  validateTicketStatus,
  normalizeMilestoneStatus,
  validateMilestoneStatus,
} from '../src/utils/formatter.js';

describe('Field, Flag, Clearing, Validation & Filter Parity Audit (Esedre-103..106)', () => {
  describe('Esedre-103: Standard node:util parseArgs for CLI (parseCliArgs)', () => {
    it('does not greedily consume positional arguments after boolean flags', () => {
      const p1 = parseCliArgs(['get', '--json', '102']);
      expect(p1.error).toBeUndefined();
      expect(p1.command).toBe('get');
      expect(p1.flags['json']).toBe(true);
      expect(p1.positionals).toEqual(['102']);

      const p2 = parseCliArgs(['update', '--force', '102', '--status', 'Completed']);
      expect(p2.error).toBeUndefined();
      expect(p2.command).toBe('update');
      expect(p2.flags['force']).toBe(true);
      expect(p2.positionals).toEqual(['102']);
      expect(p2.flags['status']).toBe('Completed');

      const p3 = parseCliArgs(['comment', '102', '--json', 'Verification note']);
      expect(p3.error).toBeUndefined();
      expect(p3.command).toBe('comment');
      expect(p3.flags['json']).toBe(true);
      expect(p3.positionals).toEqual(['102', 'Verification note']);
    });

    it('supports inline --key=value and -k=value syntax', () => {
      const p = parseCliArgs([
        'update',
        '10',
        '--status=Completed',
        '--priority=High',
        '-p=Core',
        '--in-dev=false',
      ]);
      expect(p.error).toBeUndefined();
      expect(p.command).toBe('update');
      expect(p.positionals).toEqual(['10']);
      expect(p.flags['status']).toBe('Completed');
      expect(p.flags['priority']).toBe('High');
      expect(p.flags['project']).toBe('Core');
      expect(p.flags['in-dev']).toBe(false);
    });

    it('parses explicit boolean literals (true/false) and --no-* flags', () => {
      const p1 = parseCliArgs(['update', '1', '--in-dev', 'false']);
      expect(p1.error).toBeUndefined();
      expect(p1.flags['in-dev']).toBe(false);

      const p2 = parseCliArgs(['list', '--leased', 'false', '--blocked', 'true']);
      expect(p2.error).toBeUndefined();
      expect(p2.flags['leased']).toBe(false);
      expect(p2.flags['blocked']).toBe(true);

      const p3 = parseCliArgs(['update', '1', '--no-in-dev']);
      expect(p3.error).toBeUndefined();
      expect(p3.flags['in-dev']).toBe(false);
    });

    it('reports a descriptive error when value-taking flags are missing their value', () => {
      const m1 = parseCliArgs(['update', '1', '--milestone']);
      expect(m1.error).toMatch(/Flag --milestone requires a value/);

      const m2 = parseCliArgs(['create', '--title']);
      expect(m2.error).toMatch(/Flag --title requires a value/);

      const m3 = parseCliArgs(['update', '1', '--status', '--json']);
      expect(m3.error).toMatch(/Flag --status requires a value/);

      const m4 = parseCliArgs(['list', '-P']);
      expect(m4.error).toMatch(/Flag -P requires a value/);
    });

    it('allows empty string values and markdown bullet strings on value-taking flags', () => {
      const e1 = parseCliArgs(['plan', '1', '--set', '']);
      expect(e1.error).toBeUndefined();
      expect(e1.flags['set']).toBe('');

      const e2 = parseCliArgs(['comment', '1', '--text', '- fixed edge case']);
      expect(e2.error).toBeUndefined();
      expect(e2.flags['text']).toBe('- fixed edge case');
    });

    it('reassembles unquoted multi-word --title, --effort, --summary, and --status values when SSH cmd.exe /c strips quotes and preserves --json', () => {
      const c1 = parseCliArgs([
        'create',
        '--project',
        'Sleep',
        '--title',
        'Weekly',
        'Research',
        'Settings',
        'Mobile',
        'Top',
        'Layout',
        '--type',
        'Feature',
        '--priority',
        'Medium',
        '--complexity',
        'Low',
        '--effort',
        '0.5',
        '-',
        '1.0',
        'hours',
        '--summary',
        'Redesign',
        'weekly',
        'research',
        'settings',
        '--json',
      ]);
      expect(c1.error).toBeUndefined();
      expect(c1.command).toBe('create');
      expect(c1.positionals).toEqual([]);
      expect(c1.flags['project']).toBe('Sleep');
      expect(c1.flags['title']).toBe('Weekly Research Settings Mobile Top Layout');
      expect(c1.flags['effort']).toBe('0.5 - 1.0 hours');
      expect(c1.flags['summary']).toBe('Redesign weekly research settings');
      expect(c1.flags['json']).toBe(true);

      const u1 = parseCliArgs([
        'update',
        'Sleep-226',
        '--status',
        'In',
        'Development',
        '--title',
        'Weekly',
        'Research',
        'Settings',
        'Mobile',
        'Top',
        'Layout',
        '--effort',
        '0.5',
        '-',
        '1.0',
        'hours',
        '--json\r',
      ]);
      expect(u1.error).toBeUndefined();
      expect(u1.command).toBe('update');
      expect(u1.positionals).toEqual(['Sleep-226']);
      expect(u1.flags['status']).toBe('In Development');
      expect(u1.flags['title']).toBe('Weekly Research Settings Mobile Top Layout');
      expect(u1.flags['effort']).toBe('0.5 - 1.0 hours');
      expect(u1.flags['json']).toBe(true);
    });
  });

  describe('Esedre-104 & Esedre-105: Normalizers, Validators & Clear Sentinels', () => {
    it('identifies clear sentinels consistently', () => {
      expect(isClearSentinel(null)).toBe(true);
      expect(isClearSentinel('')).toBe(true);
      expect(isClearSentinel('   ')).toBe(true);
      expect(isClearSentinel('none')).toBe(true);
      expect(isClearSentinel('NONE')).toBe(true);
      expect(isClearSentinel('clear')).toBe(true);
      expect(isClearSentinel('null')).toBe(true);
      expect(isClearSentinel('v1.0')).toBe(false);
      expect(isClearSentinel(undefined)).toBe(false);
    });

    it('normalizes and validates ticket types case-insensitively', () => {
      expect(normalizeTicketType('bug')).toBe('Bug');
      expect(normalizeTicketType('FEATURE')).toBe('Feature');
      expect(normalizeTicketType('tool')).toBe('Tools');
      expect(normalizeTicketType('tools')).toBe('Tools');
      expect(normalizeTicketType('platform')).toBe('Platform');
      expect(normalizeTicketType('idea')).toBe('Idea');
      expect(normalizeTicketType('Enhancement')).toBeUndefined();
      expect(() => validateTicketType('Enhancement')).toThrow(/Invalid ticket type/);
    });

    it('normalizes and validates ticket statuses and common aliases', () => {
      expect(normalizeTicketStatus('planned')).toBe('Planned');
      expect(normalizeTicketStatus('in development')).toBe('In Development');
      expect(normalizeTicketStatus('in-dev')).toBe('In Development');
      expect(normalizeTicketStatus('in-progress')).toBe('In Development');
      expect(normalizeTicketStatus('completed')).toBe('Completed');
      expect(normalizeTicketStatus('complete')).toBe('Completed');
      expect(normalizeTicketStatus('rejected')).toBe('Rejected');
      expect(() => validateTicketStatus('Done')).toThrow(/Invalid ticket status/);
    });

    it('normalizes and validates milestone statuses', () => {
      expect(normalizeMilestoneStatus('planned')).toBe('Planned');
      expect(normalizeMilestoneStatus('active')).toBe('Active');
      expect(normalizeMilestoneStatus('completed')).toBe('Completed');
      expect(normalizeMilestoneStatus('complete')).toBe('Completed');
      expect(normalizeMilestoneStatus('closed')).toBe('Closed');
      expect(() => validateMilestoneStatus('Archived')).toThrow(/Invalid milestone status/);
    });
  });

  describe('Storage, MCP & CLI End-to-End Integration (Esedre-103..106)', () => {
    let tempDir: string;
    let adapter: FilesystemStorageAdapter;
    let mcpServer: EsedreMcpServer;
    let cliScriptPath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-audit-test-'));
      cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

      const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
      const esedreDir = path.join(tempDir, '.esedre');
      fs.mkdirSync(ticketsDir, { recursive: true });
      fs.mkdirSync(esedreDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'audit-test-repo' }));
      fs.writeFileSync(
        path.join(esedreDir, 'esedre.json'),
        JSON.stringify({ projectCode: 'Core', allowedProjects: ['Core'] }, null, 2)
      );
      fs.writeFileSync(
        path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
        JSON.stringify([{ id: 1, code: 'Core', name: 'Core Application' }], null, 2)
      );

      adapter = new FilesystemStorageAdapter(tempDir);
      mcpServer = new EsedreMcpServer(adapter);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const callRpc = async (req: any) => {
      return await (mcpServer as any).handleRequest(req);
    };

    const runCli = (args: string[]) => {
      return execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
      });
    };

    it('Esedre-104: clears ticket featureFlag, milestone, priority, plan, and milestone description cleanly', async () => {
      const m = await adapter.createMilestone({
        projectCode: 'Core',
        title: 'v1.0',
        description: 'Initial milestone description',
        featureFlag: 'umbrella_v1',
        targetDate: '2026-12-01',
      });
      expect(m.description).toBe('Initial milestone description');

      // Clear milestone description via "none"
      const mUpdated = await adapter.updateMilestone(m.id, { description: 'none' }, 'Core');
      expect(mUpdated.description).toBeUndefined();

      // Create ticket with featureFlag, priority, milestone, and plan
      const created = await adapter.createTicket({
        title: 'Clearable Fields Ticket',
        projectCode: 'Core',
        priority: 'High',
        featureFlag: 'custom_flag',
        plan: '## Step 1\n- Do work',
      });
      expect(created.meta.featureFlag).toBe('custom_flag');
      expect(created.meta.priority).toBe('High');
      expect(await adapter.getPlan(created.meta.id)).toContain('Step 1');

      // Clear featureFlag via "none"
      const afterFlagClear = await adapter.updateTicket(created.meta.id, { featureFlag: 'none' });
      expect(afterFlagClear.meta.featureFlag).toBeUndefined();

      // Re-set featureFlag and clear via null in MCP
      await adapter.updateTicket(created.meta.id, { featureFlag: 'temp_flag' });
      const mcpClearRes = await callRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: created.meta.id,
            project: 'Core',
            featureFlag: 'none',
          },
        },
      });
      expect(mcpClearRes.error).toBeUndefined();
      const mcpClearedTicket = JSON.parse(mcpClearRes.result.content[0].text);
      expect(mcpClearedTicket.meta.featureFlag).toBeUndefined();

      // Clear plan via savePlan(id, "")
      await adapter.savePlan(created.meta.id, '');
      expect(await adapter.getPlan(created.meta.id)).toBeNull();
    });

    it('Esedre-105: enforces enum validation, case-insensitive normalization, and non-empty title guards', async () => {
      // Case-insensitive type and status normalization
      const t = await adapter.createTicket({
        title: 'Normalized Ticket',
        projectCode: 'Core',
        type: 'bug' as any,
      });
      expect(t.meta.type).toBe('Bug');
      expect(t.meta.category).toBe('Bug');

      const updated = await adapter.updateTicket(t.meta.id, {
        status: 'in-dev' as any,
        type: 'tool' as any,
      });
      expect(updated.meta.status).toBe('In Development');
      expect(updated.meta.type).toBe('Tools');

      const completed = await adapter.updateTicket(t.meta.id, {
        status: 'complete' as any,
      });
      expect(completed.meta.status).toBe('Completed');
      expect(completed.meta.completedAt).toBeDefined();

      // Rejects invalid enums and empty titles
      await expect(
        adapter.createTicket({ title: '   ', projectCode: 'Core' })
      ).rejects.toThrow(/Ticket title is required/);

      await expect(
        adapter.createTicket({ title: 'Bad Type', projectCode: 'Core', type: 'Enhancement' as any })
      ).rejects.toThrow(/Invalid ticket type/);

      await expect(
        adapter.updateTicket(t.meta.id, { status: 'BogusStatus' as any })
      ).rejects.toThrow(/Invalid ticket status/);

      await expect(
        adapter.updateTicket(t.meta.id, { title: '   ' })
      ).rejects.toThrow(/Ticket title cannot be empty/);

      await expect(
        adapter.createMilestone({ projectCode: 'Core', title: 'Bad MS', status: 'InvalidState' as any })
      ).rejects.toThrow(/Invalid milestone status/);
    });

    it('Esedre-106: supports case-insensitive type filter, milestone: none, summary/flag search, create featureFlag, and MCP leased filters', async () => {
      await adapter.createMilestone({ projectCode: 'Core', title: 'M1' });

      // Create via MCP with featureFlag
      const createRes = await callRpc({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Searchable Bug Ticket',
            project: 'Core',
            type: 'Bug',
            featureFlag: 'enable_quantum_cache',
            summary: 'Fixes race condition in distributed lock manager',
            milestone: 'M1',
          },
        },
      });
      expect(createRes.error).toBeUndefined();
      const t1 = JSON.parse(createRes.result.content[0].text);
      expect(t1.meta.featureFlag).toBe('enable_quantum_cache');

      const t2 = await adapter.createTicket({
        title: 'Unassigned Feature Ticket',
        projectCode: 'Core',
        type: 'Feature',
        summary: 'Routine UI polish',
      });

      // Case-insensitive type filter
      const bugsLower = await adapter.listTickets({ type: 'bug' as any });
      expect(bugsLower).toHaveLength(1);
      expect(bugsLower[0].meta.id).toBe(t1.meta.id);

      // milestone: 'none' filter
      const unassigned = await adapter.listTickets({ milestone: 'none' });
      expect(unassigned).toHaveLength(1);
      expect(unassigned[0].meta.id).toBe(t2.meta.id);

      // featureFlag filter ("enable_quantum_cache" and "none")
      const flagged = await adapter.listTickets({ featureFlag: 'ENABLE_QUANTUM_CACHE' });
      expect(flagged).toHaveLength(1);
      expect(flagged[0].meta.id).toBe(t1.meta.id);

      const unflagged = await adapter.listTickets({ featureFlag: 'none' });
      expect(unflagged).toHaveLength(1);
      expect(unflagged[0].meta.id).toBe(t2.meta.id);

      // Search matches summary and featureFlag
      const bySummary = await adapter.listTickets({ search: 'distributed lock' });
      expect(bySummary).toHaveLength(1);
      expect(bySummary[0].meta.id).toBe(t1.meta.id);

      const byFlag = await adapter.listTickets({ search: 'quantum_cache' });
      expect(byFlag).toHaveLength(1);
      expect(byFlag[0].meta.id).toBe(t1.meta.id);

      // Claim lease on t1 and filter via MCP esedre_list_tickets({ leased, leasedBy })
      await adapter.claimTicket({ ticketId: t1.meta.id, holder: 'worker-alpha', project: 'Core' });

      const mcpLeasedRes = await callRpc({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            project: 'Core',
            leased: true,
            leasedBy: 'worker-alpha',
          },
        },
      });
      expect(mcpLeasedRes.error).toBeUndefined();
      const leasedList = JSON.parse(mcpLeasedRes.result.content[0].text);
      expect(leasedList).toHaveLength(1);
      expect(leasedList[0].id).toBe(t1.meta.id);

      const mcpUnleasedRes = await callRpc({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'esedre_list_tickets',
          arguments: {
            project: 'Core',
            leased: false,
          },
        },
      });
      const unleasedList = JSON.parse(mcpUnleasedRes.result.content[0].text);
      expect(unleasedList).toHaveLength(1);
      expect(unleasedList[0].id).toBe(t2.meta.id);
    });

    it('CLI subprocess: handles boolean flags before positionals, --key=value, field clearing, and validation errors', () => {
      // Create with --flag and --type=bug (case-insensitive + inline =)
      const createOut = runCli([
        'create',
        '--title=CLI Audit Ticket',
        '--type=bug',
        '--flag=cli_feature_x',
        '--plan=Initial CLI plan',
        '--json',
      ]);
      const created = JSON.parse(createOut);
      expect(created.meta.id).toBe(1);
      expect(created.meta.type).toBe('Bug');
      expect(created.meta.featureFlag).toBe('cli_feature_x');

      // `ese get --json 1` (boolean flag BEFORE positional ID!)
      const getOut = runCli(['get', '--json', '1']);
      const fetched = JSON.parse(getOut);
      expect(fetched.meta.id).toBe(1);
      expect(fetched.meta.featureFlag).toBe('cli_feature_x');

      // `ese update --force 1 --in-dev true` and then `--in-dev false` and `--flag none`
      runCli(['update', '--force', '1', '--in-dev', 'true']);
      const afterInDevTrue = JSON.parse(runCli(['get', '--json', '1']));
      expect(afterInDevTrue.meta.isActivePlanning).toBe(true);

      runCli(['update', '--force', '1', '--in-dev', 'false', '--flag', 'none']);
      const afterClear = JSON.parse(runCli(['get', '--json', '1']));
      expect(afterClear.meta.isActivePlanning).toBe(false);
      expect(afterClear.meta.featureFlag).toBeUndefined();

      // Clear plan via `ese plan 1 --set ""`
      runCli(['plan', '1', '--set', '']);
      const planOut = JSON.parse(runCli(['plan', '1', '--json']));
      expect(planOut.planMarkdown).toBeNull();

      // Reject missing value on string flag (`ese update 1 --milestone`)
      expect(() => runCli(['update', '1', '--milestone'])).toThrow();

      // Reject no-op update (`ese update 1`)
      expect(() => runCli(['update', '1'])).toThrow();

      // Reject invalid status (`ese update 1 --status NotAStatus`)
      expect(() => runCli(['update', '1', '--status', 'NotAStatus'])).toThrow();
    });
  });
});
