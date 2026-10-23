import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  evaluateAntigravityPreToolHook,
  readActiveMcpContext,
  ensureAntigravityPreToolHookScript,
} from '../src/mcp/antigravityHook.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { initHub, initWorkspace, setupGlobalAntigravityMcpConfig } from '../src/upgrade.js';
import { addLocationToGlobalConfig } from '../src/config.js';
import { isWorkspaceOrGitDir, resolveWorkerIdentity } from '../src/utils/identity.js';

describe('Antigravity Global MCP Isolation, Hook Bridge & Zero Path Leaks (Esedre-92)', () => {
  let tempRoot: string;
  let fakeGlobalDir: string;
  let fakeGeminiDir: string;
  let originalGlobalEnv: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-agy-hook-test-'));
    fakeGlobalDir = path.join(tempRoot, 'global-esedre');
    fakeGeminiDir = path.join(tempRoot, 'fake-gemini');
    fs.mkdirSync(fakeGlobalDir, { recursive: true });
    fs.mkdirSync(fakeGeminiDir, { recursive: true });

    originalGlobalEnv = process.env.ESEDRE_GLOBAL_DIR;
    process.env.ESEDRE_GLOBAL_DIR = fakeGlobalDir;
  });

  afterEach(() => {
    if (originalGlobalEnv !== undefined) {
      process.env.ESEDRE_GLOBAL_DIR = originalGlobalEnv;
    } else {
      delete process.env.ESEDRE_GLOBAL_DIR;
    }
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it('enforces directional parent/child isolation in PreToolUse hook for both lazy and eager MCP tool calls', () => {
    const labUmbrellaDir = path.join(tempRoot, 'lab151');
    const tcgChildDir = path.join(tempRoot, 'lab151-tcg');
    fs.mkdirSync(labUmbrellaDir, { recursive: true });
    fs.mkdirSync(tcgChildDir, { recursive: true });

    initWorkspace(labUmbrellaDir, {
      projectCode: 'Lab151',
      allowedProjects: ['Lab151', 'TCG', 'Sleep'],
    });
    initWorkspace(tcgChildDir, {
      projectCode: 'TCG',
      allowedProjects: ['TCG'],
    });

    // 1. Umbrella workspace (lab151) can access TCG via lazy call_mcp_tool
    const allowTcgFromLab = evaluateAntigravityPreToolHook({
      conversationId: 'conv-lab',
      workspacePaths: [labUmbrellaDir],
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'esedre',
          ToolName: 'esedre_get_ticket',
          Arguments: { ticketId: 'TCG-1' },
        },
      },
    });
    expect(allowTcgFromLab.decision).toBe('allow');

    // 2. Umbrella workspace (lab151) is denied Personal
    const denyPersonalFromLab = evaluateAntigravityPreToolHook({
      conversationId: 'conv-lab',
      workspacePaths: [labUmbrellaDir],
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'esedre',
          ToolName: 'esedre_list_tickets',
          Arguments: { project: 'Personal' },
        },
      },
    });
    expect(denyPersonalFromLab.decision).toBe('deny');
    expect(denyPersonalFromLab.reason).toContain("Project 'Personal' is outside this workspace's authorized scope");

    // 3. Child workspace (lab151-tcg) is allowed TCG, but denied Lab151 and Sleep (both lazy and eager)
    const allowTcgFromChild = evaluateAntigravityPreToolHook({
      conversationId: 'conv-tcg',
      workspacePaths: [tcgChildDir],
      toolCall: {
        name: 'mcp_esedre_esedre_get_ticket',
        args: { ticketId: 'TCG-4' },
      },
    });
    expect(allowTcgFromChild.decision).toBe('allow');

    const denyParentFromChild = evaluateAntigravityPreToolHook({
      conversationId: 'conv-tcg',
      workspacePaths: [tcgChildDir],
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'esedre',
          ToolName: 'esedre_get_ticket',
          Arguments: { ticketId: 'Lab151-1' },
        },
      },
    });
    expect(denyParentFromChild.decision).toBe('deny');
    expect(denyParentFromChild.reason).toContain("Project 'Lab151'");

    const denySiblingFromChild = evaluateAntigravityPreToolHook({
      conversationId: 'conv-tcg',
      workspacePaths: [tcgChildDir],
      toolCall: {
        name: 'esedre_claim_ticket',
        args: { ticketId: 2, project: 'Sleep' },
      },
    });
    expect(denySiblingFromChild.decision).toBe('deny');
    expect(denySiblingFromChild.reason).toContain("Project 'Sleep'");
  });

  it('unions allowedProjects across multi-root workspacePaths and executes standalone agy-pre-tool-hook.mjs', () => {
    const hubDir = path.join(tempRoot, 'esedre-data');
    const esedreDir = path.join(tempRoot, 'esedre');
    const webDir = path.join(tempRoot, 'esedre-web');
    initHub(hubDir);
    fs.mkdirSync(esedreDir, { recursive: true });
    fs.mkdirSync(webDir, { recursive: true });

    initWorkspace(esedreDir, {
      projectCode: 'Esedre',
      allowedProjects: ['Esedre'],
    });
    initWorkspace(webDir, {
      projectCode: 'EseWeb',
      allowedProjects: ['EseWeb'],
    });

    const configured = setupGlobalAntigravityMcpConfig({
      geminiDir: fakeGeminiDir,
      globalDir: fakeGlobalDir,
    });
    expect(configured).toBe(true);

    const hooksJsonPath = path.join(fakeGeminiDir, 'config', 'hooks.json');
    expect(fs.existsSync(hooksJsonPath)).toBe(true);
    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));
    expect(hooksJson['esedre-isolation']?.PreToolUse?.[0]?.matcher).toBe(
      'call_mcp_tool|list_resources|read_resource|.*esedre.*'
    );

    const scriptPath = ensureAntigravityPreToolHookScript(fakeGlobalDir);
    expect(fs.existsSync(scriptPath)).toBe(true);

    // Execute standalone .mjs hook with multi-root workspacePaths [hubDir, esedreDir, webDir]
    const stdoutAllow = execFileSync(process.execPath, [scriptPath], {
      input: JSON.stringify({
        conversationId: 'multi-root-session',
        workspacePaths: [hubDir, esedreDir, webDir],
        toolCall: {
          name: 'call_mcp_tool',
          args: {
            ServerName: 'esedre',
            ToolName: 'esedre_get_ticket',
            Arguments: { ticketId: 'EseWeb-1' },
          },
        },
      }),
      env: { ...process.env, ESEDRE_GLOBAL_DIR: fakeGlobalDir },
      encoding: 'utf-8',
    }).trim();

    expect(JSON.parse(stdoutAllow)).toEqual({ decision: 'allow' });

    const activeCtx = readActiveMcpContext(60_000, fakeGlobalDir);
    expect(activeCtx?.projectCode).toBe('Esedre');
    expect(activeCtx?.allowedProjects).toEqual(['Esedre', 'EseWeb']);

    // Verify standalone script denies unauthorized project
    const stdoutDeny = execFileSync(process.execPath, [scriptPath], {
      input: JSON.stringify({
        conversationId: 'multi-root-session',
        workspacePaths: [hubDir, esedreDir, webDir],
        toolCall: {
          name: 'call_mcp_tool',
          args: {
            ServerName: 'esedre',
            ToolName: 'esedre_get_ticket',
            Arguments: { ticketId: 'Sleep-92' },
          },
        },
      }),
      env: { ...process.env, ESEDRE_GLOBAL_DIR: fakeGlobalDir },
      encoding: 'utf-8',
    }).trim();

    const parsedDeny = JSON.parse(stdoutDeny);
    expect(parsedDeny.decision).toBe('deny');
    expect(parsedDeny.reason).toContain("Project 'Sleep'");
  });

  it('dynamically scopes Global EsedreMcpServer via mcp-active-context.json and strips all host paths', async () => {
    const hubDir = path.join(tempRoot, 'central-hub');
    const tcgRepo = path.join(tempRoot, 'lab151-tcg');
    const sleepRepo = path.join(tempRoot, 'lab151-sleep');
    initHub(hubDir);
    fs.mkdirSync(tcgRepo, { recursive: true });
    fs.mkdirSync(sleepRepo, { recursive: true });

    const rawStorage = new FilesystemStorageAdapter(hubDir, {
      dataDir: hubDir,
      projects: {
        TCG: tcgRepo,
        Sleep: sleepRepo,
      },
    });
    await rawStorage.registerProject({ code: 'TCG', name: 'Lab 151 TCG' });
    await rawStorage.registerProject({ code: 'Sleep', name: 'Sleep Lab' });

    await rawStorage.createTicket({ title: 'TCG Deck Builder', projectCode: 'TCG' });
    await rawStorage.createTicket({ title: 'Sleep Alarm Engine', projectCode: 'Sleep' });

    addLocationToGlobalConfig(hubDir);
    initWorkspace(tcgRepo, {
      projectCode: 'TCG',
      allowedProjects: ['TCG'],
    });
    initWorkspace(sleepRepo, {
      projectCode: 'Sleep',
      allowedProjects: ['Sleep'],
    });

    // Global MCP server started without a local projectCode (simulating Antigravity global fallback)
    const globalMcp = new EsedreMcpServer(new SecurityFilter(rawStorage, {}), {
      workspaceRoot: tempRoot,
      config: { dataDir: hubDir },
      useGlobalContextBridge: true,
    });

    // Simulate PreToolUse hook firing from tcgRepo before MCP call
    evaluateAntigravityPreToolHook({
      conversationId: 'tcg-session',
      workspacePaths: [tcgRepo],
      toolCall: {
        name: 'call_mcp_tool',
        args: {
          ServerName: 'esedre',
          ToolName: 'esedre_get_ticket',
          Arguments: { ticketId: 1 },
        },
      },
    });

    // 1. Bare numeric ticketId: 1 resolves to TCG-1 instead of throwing "Ambiguous ticket #1 (TCG, Sleep)"
    const getRes = await globalMcp.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'esedre_get_ticket',
        arguments: { ticketId: 1 },
      },
    });
    expect(getRes?.error).toBeUndefined();
    const fetchedTicket = JSON.parse(getRes!.result.content[0].text);
    expect(fetchedTicket.meta.project).toBe('TCG');
    expect(fetchedTicket.meta.title).toBe('TCG Deck Builder');

    // 2. Unfiltered esedre_list_tickets({}) only returns TCG tickets, hiding Sleep
    const listRes = await globalMcp.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'esedre_list_tickets',
        arguments: {},
      },
    });
    expect(listRes?.error).toBeUndefined();
    const listedTickets = JSON.parse(listRes!.result.content[0].text);
    expect(listedTickets).toHaveLength(1);
    expect(listedTickets[0].project).toBe('TCG');

    // 3. Attempting to fetch Sleep-1 from the global MCP server while scoped to TCG throws Access Denied
    const forbiddenRes = await globalMcp.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'esedre_get_ticket',
        arguments: { ticketId: 'Sleep-1' },
      },
    });
    expect(forbiddenRes?.error?.code).toBe(-32603);
    expect(forbiddenRes?.error?.message).toContain("Access Denied: Project 'Sleep'");

    // 4. Claiming TCG-1 refreshes tcgRepo/.esedre/snapshot.json without leaking worktree or stderr paths
    const stderrChunks: string[] = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;

    let claimRes: any;
    try {
      claimRes = await globalMcp.handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'esedre_claim_ticket',
          arguments: { ticketId: 1, holder: 'tcg-agent' },
        },
      });
    } finally {
      process.stderr.write = origStderrWrite;
    }

    expect(claimRes?.error).toBeUndefined();
    const claimPayload = JSON.parse(claimRes.result.content[0].text);
    expect(claimPayload.lease.worktree).toBeUndefined();

    // Check stderr log contains project code but zero host filesystem paths
    const combinedStderr = stderrChunks.join('');
    expect(combinedStderr).toContain("[Esedre MCP] Refreshed snapshot for project 'TCG'");
    expect(combinedStderr).not.toContain(tcgRepo);
    expect(combinedStderr).not.toContain('snapshot.json');

    // Check tcgRepo/.esedre/snapshot.json was refreshed and omits lease.worktree
    const snapshotPath = path.join(tcgRepo, '.esedre', 'snapshot.json');
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snapshot.tickets[0].lease).toBeDefined();
    expect(snapshot.tickets[0].lease.worktree).toBeUndefined();
    expect(snapshot.activeLeases[0].worktree).toBeUndefined();

    // 5. Lease conflict error (-32001) also strips activeLease.worktree
    const conflictRes = await globalMcp.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: { ticketId: 1, holder: 'second-agent' },
      },
    });
    expect(conflictRes?.error?.code).toBe(-32001);
    expect(conflictRes?.error?.data?.activeLease?.holder).toBe('tcg-agent');
    expect(conflictRes?.error?.data?.activeLease?.worktree).toBeUndefined();
  });

  it('rejects non-workspace directories when falling back to process.cwd() in resolveWorkerIdentity', () => {
    const nonRepoDir = path.join(tempRoot, 'isolated-app-bin');
    fs.mkdirSync(nonRepoDir, { recursive: true });
    expect(isWorkspaceOrGitDir(nonRepoDir)).toBe(false);

    const origCwd = process.cwd();
    try {
      process.chdir(nonRepoDir);
      const identity = resolveWorkerIdentity({ holder: 'test-worker' });
      expect(identity.worktree).toBeUndefined();
    } finally {
      process.chdir(origCwd);
    }
  });
});
