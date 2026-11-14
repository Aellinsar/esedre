import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  formatSyncCommitMessage,
  sanitizeCommitText,
} from '../src/sync/commitMessage.js';
import {
  verifyDataHubGitRepo,
  syncDataHub,
  getDataHubSyncStatus,
  globalGitSyncCoordinator,
  sanitizeGitLogText,
  normalizeRealPath,
} from '../src/sync/gitSync.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { HttpStorageAdapter } from '../src/storage/http.js';
import { createApiHandler } from '../src/server/apiServer.js';
import { EsedreConflictError } from '../src/types.js';
import {
  setGlobalConfigKey,
  getGlobalConfigKey,
  resolveGitSyncConfig,
  getGlobalConfigPath,
  DEFAULT_GIT_SYNC_CONFIG,
} from '../src/config.js';
import { parseCliArgs } from '../src/utils/cliArgs.js';
import { getSyncStatusBadgeMeta } from '../src/ui/GitSyncHubCard.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    },
  }).trim();
}

describe('Esedre-6: Automatic Data Hub Git Sync', () => {
  describe('Commit Message Formatter (commitMessage.ts)', () => {
    it('strips conventional prefixes and em dashes', () => {
      expect(sanitizeCommitText('feat(sync): Add auto\u2014sync \u2013 engine')).toBe(
        'Add auto-sync - engine'
      );
      expect(sanitizeCommitText('fix: Resolve race condition')).toBe('Resolve race condition');
    });

    it('formats single ticket creation, completion, plan, comment, and link events', () => {
      const created = formatSyncCommitMessage([
        {
          hubDir: '/tmp/hub',
          action: 'create-ticket',
          project: 'Esedre',
          ticketId: 6,
          ticketKey: 'Esedre-6',
          title: 'feat: Auto-sync data repository\u2014GitHub',
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(created.subject).toBe('[#Esedre-6] Create ticket: Auto-sync data repository-GitHub');
      expect(created.subject).not.toContain('\u2014');

      const completed = formatSyncCommitMessage([
        {
          hubDir: '/tmp/hub',
          action: 'complete-ticket',
          project: 'Esedre',
          ticketId: 6,
          ticketKey: 'Esedre-6',
          title: 'Auto-sync data repository to GitHub',
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(completed.subject).toBe(
        '[#Esedre-6] Update ticket status to Completed'
      );

      const plan = formatSyncCommitMessage([
        {
          hubDir: '/tmp/hub',
          action: 'save-plan',
          project: 'Esedre',
          ticketId: 6,
          ticketKey: 'Esedre-6',
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(plan.subject).toBe('[#Esedre-6] Save implementation plan');
    });

    it('coalesces multiple events on the same ticket into a single clean subject', () => {
      const msg = formatSyncCommitMessage([
        {
          hubDir: '/tmp/hub',
          action: 'save-plan',
          project: 'Esedre',
          ticketId: 6,
          ticketKey: 'Esedre-6',
          timestamp: new Date().toISOString(),
        },
        {
          hubDir: '/tmp/hub',
          action: 'complete-ticket',
          project: 'Esedre',
          ticketId: 6,
          ticketKey: 'Esedre-6',
          title: 'Auto-sync data repository to GitHub',
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(msg.subject).toBe('[#Esedre-6] Complete ticket and update verification records');
    });

    it('coalesces events across multiple tickets with a bulleted commit body', () => {
      const msg = formatSyncCommitMessage([
        {
          hubDir: '/tmp/hub',
          action: 'update-ticket',
          project: 'Esedre',
          ticketId: 6,
          ticketKey: 'Esedre-6',
          changedFields: ['status'],
          timestamp: new Date().toISOString(),
        },
        {
          hubDir: '/tmp/hub',
          action: 'add-comment',
          project: 'Esedre',
          ticketId: 51,
          ticketKey: 'Esedre-51',
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(msg.subject).toBe('[#Esedre-6, #Esedre-51] Sync 2 ticket updates');
      expect(msg.body).toContain('- [#Esedre-6] Update ticket (status)');
      expect(msg.body).toContain('- [#Esedre-51] Add comment on ticket');
    });

    it('infers [#Project-id] anchor from staged file paths when no events are queued', () => {
      const msg = formatSyncCommitMessage(
        [],
        ['projects/Esedre/tickets/108/meta.json', 'projects/Esedre/tickets/108/detail.md']
      );
      expect(msg.subject).toBe('[#Esedre-108] Update ticket specification and metadata');
    });
  });

  describe('Data Hub Boundary Verification (verifyDataHubGitRepo)', () => {
    let tempRoot: string;

    beforeEach(() => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-sync-boundary-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    });

    it('rejects a directory that is not a Git repository', async () => {
      const hubDir = path.join(tempRoot, 'non-git-hub');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      const res = await verifyDataHubGitRepo(hubDir);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('is not a Git repository');
    });

    it('rejects a subdirectory inside a parent Git repository', async () => {
      const parentRepo = path.join(tempRoot, 'parent-repo');
      const nestedHub = path.join(parentRepo, 'nested-hub');
      fs.mkdirSync(path.join(nestedHub, 'projects'), { recursive: true });
      git(parentRepo, ['init']);

      const res = await verifyDataHubGitRepo(nestedHub);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('subdirectory inside parent Git repository');
    });

    it('rejects a project workspace repository containing .esedre/esedre.json with projectCode', async () => {
      const workspaceDir = path.join(tempRoot, 'app-workspace');
      fs.mkdirSync(path.join(workspaceDir, '.esedre'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, 'projects'), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'App' }, null, 2)
      );
      git(workspaceDir, ['init']);

      const res = await verifyDataHubGitRepo(workspaceDir);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('is a project workspace');
    });

    it('accepts a dedicated Esedre data hub Git repository', async () => {
      const hubDir = path.join(tempRoot, 'esedre-data');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n');
      git(hubDir, ['init']);

      const res = await verifyDataHubGitRepo(hubDir);
      expect(res.valid).toBe(true);
    });
  });

  describe('End-to-End Git Sync with Bare Remote, Lease Exclusion, Rebase & Conflict Recovery', { timeout: 45000 }, () => {
    let tempRoot: string;
    let bareRemoteDir: string;
    let hubDir: string;

    beforeEach(() => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-sync-e2e-'));
      bareRemoteDir = path.join(tempRoot, 'remote.git');
      hubDir = path.join(tempRoot, 'esedre-data');

      fs.mkdirSync(bareRemoteDir, { recursive: true });
      git(bareRemoteDir, ['init', '--bare', '-b', 'main']);

      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n', 'utf-8');
      git(hubDir, ['init', '-b', 'main']);
      git(hubDir, ['config', 'user.name', 'Test Developer']);
      git(hubDir, ['config', 'user.email', 'test@esedre.com']);
      git(hubDir, ['remote', 'add', 'origin', bareRemoteDir]);
      git(hubDir, ['add', 'projects.json']);
      git(hubDir, ['commit', '-m', '[Infra] Initialize data hub']);
      git(hubDir, ['push', '-u', 'origin', 'main']);
    });

    afterEach(async () => {
      await globalGitSyncCoordinator.waitForIdle();
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    });

    it('automatically commits and pushes ticket mutations while excluding lease.json', async () => {
      const storage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
        sync: {
          enabled: true,
          remote: 'origin',
          branch: 'main',
          push: true,
          debounceSeconds: 0,
        },
      });

      await storage.registerProject({
        code: 'Esedre',
        name: 'Esedre Engine',
      });

      const created = await storage.createTicket({
        projectCode: 'Esedre',
        title: 'Auto-sync data repository to GitHub',
        type: 'Platform',
        summary: 'Automatically commit and push ticket mutations.',
      });
      expect(created.meta.id).toBe(1);

      await globalGitSyncCoordinator.waitForIdle();

      const remoteLog1 = git(bareRemoteDir, ['log', '--oneline', '-n', '5']);
      expect(remoteLog1).toContain('[#Esedre-1] Create ticket: Auto-sync data repository to GitHub');

      // Claim a lease and verify lease.json is never staged or committed
      const claimRes = await storage.claimTicket({
        ticketId: 'Esedre-1',
        holder: 'TestAgent',
      });
      expect(claimRes.lease.holder).toBe('TestAgent');
      const leaseFile = path.join(hubDir, 'projects', 'Esedre', 'tickets', '1', 'lease.json');
      expect(fs.existsSync(leaseFile)).toBe(true);

      // Save plan and complete ticket
      await storage.savePlan('Esedre-1', '# Implementation Plan\n1. Build sync engine\n');
      await storage.updateTicket('Esedre-1', { status: 'Completed' });
      await globalGitSyncCoordinator.waitForIdle();

      const remoteTree = git(bareRemoteDir, ['ls-tree', '-r', '--name-only', 'HEAD']);
      expect(remoteTree).toContain('projects/Esedre/tickets/1/meta.json');
      expect(remoteTree).toContain('projects/Esedre/tickets/1/implementation_plan.md');
      expect(remoteTree).not.toContain('lease.json');

      const status = await getDataHubSyncStatus(hubDir, {
        enabled: true,
        remote: 'origin',
        branch: 'main',
        push: true,
      });
      expect(status.status).toBe('idle');
      expect(status.pendingCommits).toBe(0);
    });

    it('pulls and rebases upstream commits cleanly before pushing local ticket updates', async () => {
      const storage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
        sync: {
          enabled: false,
        },
      });
      await storage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });
      await storage.createTicket({
        projectCode: 'Esedre',
        title: 'Initial shared ticket',
      });
      await syncDataHub(hubDir, { force: true, push: true });

      // Simulate a second machine cloning bareRemoteDir and pushing a commit on Ticket #1
      const peerCloneDir = path.join(tempRoot, 'peer-clone');
      git(tempRoot, ['clone', bareRemoteDir, peerCloneDir]);
      git(peerCloneDir, ['config', 'user.name', 'Peer Machine']);
      git(peerCloneDir, ['config', 'user.email', 'peer@esedre.com']);
      const peerStorage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: peerCloneDir,
        projectCode: 'Esedre',
      });
      await peerStorage.createTicket({
        projectCode: 'Esedre',
        title: 'Peer created ticket two',
      });
      await syncDataHub(peerCloneDir, {
        force: true,
        push: true,
        events: [
          {
            hubDir: peerCloneDir,
            action: 'create-ticket',
            project: 'Esedre',
            ticketId: 2,
            ticketKey: 'Esedre-2',
            title: 'Peer created ticket two',
            timestamp: new Date().toISOString(),
          },
        ],
      });

      // Now mutate Ticket #1 locally in hubDir (which is behind origin/main by 1 commit)
      await storage.addComment('Esedre-1', {
        author: 'LocalDev',
        text: 'Added local verification note while peer pushed.',
      });

      const syncRes = await syncDataHub(hubDir, {
        force: true,
        pull: true,
        push: true,
        events: [
          {
            hubDir: hubDir,
            action: 'add-comment',
            project: 'Esedre',
            ticketId: 1,
            ticketKey: 'Esedre-1',
            timestamp: new Date().toISOString(),
          },
        ],
      });

      expect(syncRes.status).toBe('idle');
      expect(syncRes.committed).toBe(true);
      expect(syncRes.pulled).toBe(true);
      expect(syncRes.pushed).toBe(true);
      expect(syncRes.pendingCommits).toBe(0);

      const remoteLog = git(bareRemoteDir, ['log', '--oneline', '-n', '5']);
      expect(remoteLog).toContain('[#Esedre-1] Add comment on ticket');
      expect(remoteLog).toContain('[#Esedre-2] Create ticket: Peer created ticket two');
    });

    it('automatically aborts rebase and preserves a clean working tree on merge conflict', async () => {
      const storage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
      });
      await storage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });
      await storage.createTicket({
        projectCode: 'Esedre',
        title: 'Conflict test ticket',
        summary: 'Original summary line',
      });
      await syncDataHub(hubDir, { force: true, push: true });

      // Clone peer and modify Ticket #1 detail.md on remote
      const peerCloneDir = path.join(tempRoot, 'peer-conflict-clone');
      git(tempRoot, ['clone', bareRemoteDir, peerCloneDir]);
      git(peerCloneDir, ['config', 'user.name', 'Peer Machine']);
      git(peerCloneDir, ['config', 'user.email', 'peer@esedre.com']);
      const peerDetailPath = path.join(
        peerCloneDir,
        'projects',
        'Esedre',
        'tickets',
        '1',
        'detail.md'
      );
      fs.writeFileSync(peerDetailPath, '# Ticket #1: Peer conflicting edit\nPeer body text\n', 'utf-8');
      await syncDataHub(peerCloneDir, { force: true, push: true });

      // Modify the exact same file locally in hubDir
      const localDetailPath = path.join(
        hubDir,
        'projects',
        'Esedre',
        'tickets',
        '1',
        'detail.md'
      );
      fs.writeFileSync(localDetailPath, '# Ticket #1: Local conflicting edit\nLocal body text\n', 'utf-8');

      const conflictRes = await syncDataHub(hubDir, {
        force: true,
        pull: true,
        push: true,
      });

      expect(conflictRes.status).toBe('conflict');
      expect(conflictRes.pushed).toBe(false);
      expect(conflictRes.error).toContain('Rebase conflict');

      // Verify rebase was cleanly aborted (no .git/rebase-merge or .git/rebase-apply)
      expect(fs.existsSync(path.join(hubDir, '.git', 'rebase-merge'))).toBe(false);
      expect(fs.existsSync(path.join(hubDir, '.git', 'rebase-apply'))).toBe(false);
    });
  });

  describe('Config, CLI Args & HTTP Remote Sync Endpoints', { timeout: 45000 }, () => {
    let tempRoot: string;
    let bareRemoteDir: string;
    let hubDir: string;
    let server: http.Server | null = null;
    let savedGlobalConfigRaw: string | null = null;

    beforeEach(() => {
      const globalPath = getGlobalConfigPath();
      savedGlobalConfigRaw = fs.existsSync(globalPath)
        ? fs.readFileSync(globalPath, 'utf-8')
        : null;

      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-sync-http-'));
      bareRemoteDir = path.join(tempRoot, 'remote.git');
      hubDir = path.join(tempRoot, 'esedre-data');

      fs.mkdirSync(bareRemoteDir, { recursive: true });
      git(bareRemoteDir, ['init', '--bare', '-b', 'main']);

      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n', 'utf-8');
      git(hubDir, ['init', '-b', 'main']);
      git(hubDir, ['config', 'user.name', 'Test Developer']);
      git(hubDir, ['config', 'user.email', 'test@esedre.com']);
      git(hubDir, ['remote', 'add', 'origin', bareRemoteDir]);
      git(hubDir, ['add', 'projects.json']);
      git(hubDir, ['commit', '-m', '[Infra] Initialize data hub']);
      git(hubDir, ['push', '-u', 'origin', 'main']);
    });

    afterEach(async () => {
      globalGitSyncCoordinator.stopDaemonBackgroundLoop();
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      const globalPath = getGlobalConfigPath();
      if (savedGlobalConfigRaw !== null) {
        fs.writeFileSync(globalPath, savedGlobalConfigRaw, 'utf-8');
      } else if (fs.existsSync(globalPath)) {
        fs.unlinkSync(globalPath);
      }
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    });

    it('coerces and normalizes sync.* configuration keys in ~/.esedre/config.json', () => {
      setGlobalConfigKey('sync.enabled', 'true');
      setGlobalConfigKey('sync.debounceseconds', '7');
      setGlobalConfigKey('sync.intervalminutes', '15');
      setGlobalConfigKey('sync.pullonstart', 'false');

      expect(getGlobalConfigKey('sync.enabled')).toBe(true);
      expect(getGlobalConfigKey('sync.debounceSeconds')).toBe(7);
      expect(getGlobalConfigKey('sync.intervalMinutes')).toBe(15);
      expect(getGlobalConfigKey('sync.pullOnStart')).toBe(false);

      const resolved = resolveGitSyncConfig({
        sync: {
          enabled: getGlobalConfigKey('sync.enabled'),
          debounceSeconds: getGlobalConfigKey('sync.debounceSeconds'),
          intervalMinutes: getGlobalConfigKey('sync.intervalMinutes'),
          pullOnStart: getGlobalConfigKey('sync.pullOnStart'),
        },
      });
      expect(resolved.enabled).toBe(true);
      expect(resolved.debounceSeconds).toBe(7);
      expect(resolved.intervalMinutes).toBe(15);
      expect(resolved.pullOnStart).toBe(false);
    });

    it('parses ese sync CLI flags (--status, --pull, --push, --commit, --no-commit, --hub, --json)', () => {
      const parsedStatus = parseCliArgs(['sync', '--status', '--json']);
      expect(parsedStatus.error).toBeUndefined();
      expect(parsedStatus.command).toBe('sync');
      expect(parsedStatus.flags['status']).toBe(true);
      expect(parsedStatus.flags['json']).toBe(true);

      const parsedPull = parseCliArgs(['sync', '--pull', '--hub', '/custom/hub']);
      expect(parsedPull.error).toBeUndefined();
      expect(parsedPull.command).toBe('sync');
      expect(parsedPull.flags['pull']).toBe(true);
      expect(parsedPull.flags['commit']).toBeUndefined();
      expect(parsedPull.flags['hub']).toBe('/custom/hub');

      const parsedPullCommit = parseCliArgs(['sync', '--pull', '--commit']);
      expect(parsedPullCommit.error).toBeUndefined();
      expect(parsedPullCommit.flags['pull']).toBe(true);
      expect(parsedPullCommit.flags['commit']).toBe(true);

      const parsedPushNoCommit = parseCliArgs(['sync', '--push', '--no-commit']);
      expect(parsedPushNoCommit.error).toBeUndefined();
      expect(parsedPushNoCommit.flags['push']).toBe(true);
      expect(parsedPushNoCommit.flags['no-commit']).toBe(true);
      expect(parsedPushNoCommit.flags['commit']).toBe(false);

      const parsedCommitFalse = parseCliArgs(['sync', '--commit', 'false']);
      expect(parsedCommitFalse.error).toBeUndefined();
      expect(parsedCommitFalse.flags['commit']).toBe(false);
    });

    it('exposes GET /api/planning/sync/status and POST /api/planning/sync over HttpStorageAdapter', async () => {
      const fsStorage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
        sync: {
          enabled: true,
          remote: 'origin',
          branch: 'main',
          push: true,
          debounceSeconds: 60,
        },
      });
      await fsStorage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });

      const handler = createApiHandler(fsStorage, tempRoot);
      server = http.createServer(async (req, res) => {
        await handler(req, res);
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as { port: number };
      const remoteUrl = `http://127.0.0.1:${addr.port}`;

      const httpStorage = new HttpStorageAdapter({
        host: remoteUrl,
        workspaceRoot: tempRoot,
        config: {
          projectCode: 'Esedre',
          allowedProjects: ['Esedre'],
        },
      });

      const created = await httpStorage.createTicket({
        projectCode: 'Esedre',
        title: 'Remote client ticket synced via HTTP',
      });
      expect(created.meta.id).toBe(1);

      const syncResults = await httpStorage.syncDataHub({
        pull: true,
        push: true,
        commit: true,
        force: true,
      });
      expect(syncResults.length).toBe(1);
      expect(syncResults[0].status).toBe('idle');
      expect(syncResults[0].pushed).toBe(true);

      const statusReport = await httpStorage.getSyncStatus();
      expect(statusReport.enabled).toBe(true);
      expect(statusReport.hubs.length).toBe(1);
      expect(statusReport.hubs[0].pendingCommits).toBe(0);

      const remoteLog = git(bareRemoteDir, ['log', '--oneline', '-n', '5']);
      expect(remoteLog).toContain('[#Esedre-1] Create ticket: Remote client ticket synced via HTTP');
    });

    it('defaults sync.enabled to false and supports POST /api/planning/sync/config with projectModes', async () => {
      expect(DEFAULT_GIT_SYNC_CONFIG.enabled).toBe(false);

      // Set up a hybrid storage with one hub-backed project (Esedre) and one federated in-repo project (InRepoApp)
      const inRepoDir = path.join(tempRoot, 'in-repo-app');
      fs.mkdirSync(path.join(inRepoDir, '.esedre', 'tickets'), { recursive: true });
      fs.writeFileSync(
        path.join(inRepoDir, '.esedre', 'project.json'),
        JSON.stringify({ id: 9, code: 'InRepo', name: 'In-Repo App', description: 'In-project tickets' }, null, 2) + '\n',
        'utf-8'
      );

      const fsStorage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projects: { InRepo: inRepoDir },
        projectCode: 'Esedre',
      });
      await fsStorage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });

      const handler = createApiHandler(fsStorage, tempRoot);
      server = http.createServer(async (req, res) => {
        await handler(req, res);
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as { port: number };
      const remoteUrl = `http://127.0.0.1:${addr.port}`;

      // 1. Update global sync config via POST /api/planning/sync/config
      const updateRes = await fetch(`${remoteUrl}/api/planning/sync/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          push: true,
          pullOnStart: false,
          remote: 'origin',
          branch: 'main',
          debounceSeconds: 12,
          intervalMinutes: 20,
        }),
      });
      expect(updateRes.status).toBe(200);
      const updateData = await updateRes.json();
      expect(updateData.success).toBe(true);
      expect(updateData.config.enabled).toBe(true);
      expect(updateData.config.pullOnStart).toBe(false);
      expect(updateData.config.debounceSeconds).toBe(12);
      expect(updateData.config.intervalMinutes).toBe(20);

      // Verify projectModes distinguishes hub-backed (autoSyncEligible: true) vs in-repo hands-off (autoSyncEligible: false)
      const modes = updateData.status.projectModes;
      expect(Array.isArray(modes)).toBe(true);
      const hubMode = modes.find((m: any) => m.code === 'Esedre');
      const inRepoMode = modes.find((m: any) => m.code === 'InRepo');
      expect(hubMode).toMatchObject({ code: 'Esedre', storageMode: 'hub', autoSyncEligible: true });
      expect(inRepoMode).toMatchObject({ code: 'InRepo', storageMode: 'in-repo', autoSyncEligible: false });

      // 2. Reject invalid config payloads and Git argument injection attempts with 400 Bad Request
      const badRes = await fetch(`${remoteUrl}/api/planning/sync/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remote: '   ' }),
      });
      expect(badRes.status).toBe(400);

      const flagInjectRemote = await fetch(`${remoteUrl}/api/planning/sync/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remote: '--upload-pack=evil' }),
      });
      expect(flagInjectRemote.status).toBe(400);

      const flagInjectBranch = await fetch(`${remoteUrl}/api/planning/sync/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: '-oProxyCommand=evil' }),
      });
      expect(flagInjectBranch.status).toBe(400);

      // 3. Reject unconfigured hubDir paths over HTTP with 403 Forbidden
      const unauthHubRes = await fetch(`${remoteUrl}/api/planning/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubDir: '/etc/unconfigured-path' }),
      });
      expect(unauthHubRes.status).toBe(403);
    });

    it('redacts embedded credentials and tokens in sanitizeGitLogText', () => {
      const raw =
        'fatal: Authentication failed for https://devuser:ghp_1234567890abcdefghijklmnopqrstuv@github.com/org/esedre-data.git\nsecret=mySecret123';
      const sanitized = sanitizeGitLogText(raw);
      expect(sanitized).not.toContain('ghp_1234567890abcdefghijklmnopqrstuv');
      expect(sanitized).not.toContain('mySecret123');
      expect(sanitized).toContain('https://[REDACTED]@github.com/org/esedre-data.git');
      expect(sanitized).toContain('secret=[REDACTED]');
    });

    it('maps GitSyncStatusState to UI status badge metadata', () => {
      expect(getSyncStatusBadgeMeta('idle', false).label).toBe('Disabled');
      expect(getSyncStatusBadgeMeta('idle', true).label).toBe('Active / Idle');
      expect(getSyncStatusBadgeMeta('syncing', true).label).toBe('Syncing...');
      expect(getSyncStatusBadgeMeta('offline', true).label).toBe('Offline (Local Commit)');
      expect(getSyncStatusBadgeMeta('conflict', true).label).toBe('Conflict');
      expect(getSyncStatusBadgeMeta('error', true).label).toBe('Error');
    });

    it('normalizes Windows 8.3 short paths (e.g. RUNNER~1 / PROGRA~1) to canonical long paths', () => {
      if (process.platform === 'win32' && fs.existsSync('C:\\PROGRA~1')) {
        expect(normalizeRealPath('C:\\PROGRA~1')).toBe(normalizeRealPath('C:\\Program Files'));
        expect(normalizeRealPath('C:\\PROGRA~1\\sub-folder')).toBe(
          normalizeRealPath('C:\\Program Files\\sub-folder')
        );
      } else {
        expect(normalizeRealPath(tempRoot)).toBe(normalizeRealPath(path.join(tempRoot, '.')));
      }
    });
  });

  describe('Concurrency, Working-Tree Serialization & Cache Invalidation (Esedre-114)', { timeout: 45000 }, () => {
    let tempRoot: string;
    let bareRemoteDir: string;
    let hubDir: string;
    let server: http.Server | null = null;
    let prevGlobalDir: string | undefined;

    beforeEach(() => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-sync-race-'));
      prevGlobalDir = process.env.ESEDRE_GLOBAL_DIR;
      process.env.ESEDRE_GLOBAL_DIR = path.join(tempRoot, 'global-esedre');
      fs.mkdirSync(process.env.ESEDRE_GLOBAL_DIR, { recursive: true });

      bareRemoteDir = path.join(tempRoot, 'remote.git');
      hubDir = path.join(tempRoot, 'esedre-data');

      fs.mkdirSync(bareRemoteDir, { recursive: true });
      git(bareRemoteDir, ['init', '--bare', '-b', 'main']);

      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n', 'utf-8');
      git(hubDir, ['init', '-b', 'main']);
      git(hubDir, ['config', 'user.name', 'Test Developer']);
      git(hubDir, ['config', 'user.email', 'test@esedre.com']);
      git(hubDir, ['remote', 'add', 'origin', bareRemoteDir]);
      git(hubDir, ['add', 'projects.json']);
      git(hubDir, ['commit', '-m', '[Infra] Initialize data hub']);
      git(hubDir, ['push', '-u', 'origin', 'main']);
    });

    afterEach(async () => {
      globalGitSyncCoordinator.stopDaemonBackgroundLoop();
      await globalGitSyncCoordinator.waitForIdle();
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      if (prevGlobalDir === undefined) {
        delete process.env.ESEDRE_GLOBAL_DIR;
      } else {
        process.env.ESEDRE_GLOBAL_DIR = prevGlobalDir;
      }
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    });

    it('serializes concurrent ticket writes and active sync flushes without ID collisions, lost writes, or staged .tmp files', async () => {
      const storage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
        sync: {
          enabled: true,
          remote: 'origin',
          branch: 'main',
          push: true,
          debounceSeconds: 0,
        },
      });

      await storage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });

      // Fire 6 concurrent ticket creations alongside an explicit sync flush
      const [createdTickets] = await Promise.all([
        Promise.all(
          Array.from({ length: 6 }, (_, idx) =>
            storage.createTicket({
              projectCode: 'Esedre',
              title: `Concurrent ticket #${idx + 1}`,
              type: 'Platform',
              summary: `Created concurrently in slot ${idx + 1}`,
            })
          )
        ),
        storage.syncDataHub({ pull: true, push: true, commit: true, force: true }),
      ]);

      const assignedIds = createdTickets.map((t) => t.meta.id).sort((a, b) => a - b);
      expect(assignedIds).toEqual([1, 2, 3, 4, 5, 6]);

      // Plant a synthetic leftover .tmp file and fire concurrent comments, answers, inline comments, and sync
      const strayTmpFile = path.join(hubDir, 'projects', 'Esedre', 'tickets', '1', 'meta.json.tmp.99999');
      fs.writeFileSync(strayTmpFile, '{"partial":true', 'utf-8');

      await Promise.all([
        storage.addComment('Esedre-1', { author: 'AgentA', text: 'Concurrent comment 1' }),
        storage.addComment('Esedre-1', { author: 'AgentB', text: 'Concurrent comment 2' }),
        storage.addComment('Esedre-1', { author: 'AgentC', text: 'Concurrent comment 3' }),
        storage.addComment('Esedre-1', { author: 'AgentD', text: 'Concurrent comment 4' }),
        storage.saveAnswer('Esedre-1', 0, 'Use working-tree lock serialization'),
        storage.saveInlineComment('Esedre-1', 'Concurrent', 'Verified under parallel load', 'Reviewer'),
        storage.syncDataHub({ pull: true, push: true, commit: true, force: true }),
      ]);

      await globalGitSyncCoordinator.waitForIdle();
      // Flush any trailing debounced mutations deterministically
      await storage.syncDataHub({ pull: true, push: true, commit: true, force: true });

      const ticket1 = await storage.getTicket('Esedre-1');
      expect(ticket1?.comments.length).toBe(4);
      const answers = await storage.getAnswers('Esedre-1');
      expect(answers['0']).toBe('Use working-tree lock serialization');
      const inlineComments = await storage.getInlineComments('Esedre-1');
      expect(inlineComments.length).toBe(1);

      // Verify remote repository received all 6 tickets, answers, and inline-comments, and NEVER staged .tmp files
      const remoteTree = git(bareRemoteDir, ['ls-tree', '-r', '--name-only', 'HEAD']);
      for (let id = 1; id <= 6; id++) {
        expect(remoteTree).toContain(`projects/Esedre/tickets/${id}/meta.json`);
      }
      expect(remoteTree).toContain('projects/Esedre/tickets/1/comments.json');
      expect(remoteTree).toContain('projects/Esedre/tickets/1/answers.json');
      expect(remoteTree).toContain('projects/Esedre/tickets/1/inline-comments.json');
      expect(remoteTree).not.toContain('.tmp.');

      const status = await getDataHubSyncStatus(hubDir, {
        enabled: true,
        remote: 'origin',
        branch: 'main',
        push: true,
      });
      expect(status.pendingCommits).toBe(0);
      expect(status.dirtyFilesCount).toBe(0);

      storage.closeWatchers();
    });

    it('enforces optimistic concurrency (EsedreConflictError) when parallel updateTicket calls share the same lastHash', async () => {
      const storage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
        sync: { enabled: false },
      });
      await storage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });
      const created = await storage.createTicket({
        projectCode: 'Esedre',
        title: 'Initial title before race',
      });
      const baselineSha = created.sha1!;
      expect(baselineSha).toBeTruthy();

      const outcomes = await Promise.allSettled([
        storage.updateTicket('Esedre-1', { title: 'Updated by Worker Alpha' }, baselineSha),
        storage.updateTicket('Esedre-1', { title: 'Updated by Worker Beta' }, baselineSha),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason).toBeInstanceOf(EsedreConflictError);

      storage.closeWatchers();
    });

    it('preserves dirty local files on Pull-Only (commit: false) and immediately invalidates storage and API ETag caches on upstream pull', async () => {
      const fsStorage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: hubDir,
        projectCode: 'Esedre',
        sync: {
          enabled: false,
          remote: 'origin',
          branch: 'main',
          push: true,
        },
      });
      await fsStorage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });
      await fsStorage.createTicket({
        projectCode: 'Esedre',
        title: 'Baseline synced ticket',
        priority: 'Low',
      });
      await fsStorage.syncDataHub({ pull: true, push: true, commit: true, force: true });

      const handler = createApiHandler(fsStorage, tempRoot);
      server = http.createServer(async (req, res) => {
        await handler(req, res);
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      // Warm both FilesystemStorageAdapter memory cache and API ETag cache
      const initialTickets = await fsStorage.listTickets({ project: 'Esedre' });
      expect(initialTickets.length).toBe(1);
      expect(initialTickets[0].meta.priority).toBe('Low');

      const res1 = await fetch(`${baseUrl}/api/planning/all`);
      expect(res1.status).toBe(200);
      const etag1 = res1.headers.get('etag');
      expect(etag1).toBeTruthy();

      const res304 = await fetch(`${baseUrl}/api/planning/all`, {
        headers: { 'If-None-Match': etag1! },
      });
      expect(res304.status).toBe(304);

      // Push an upstream update from an independent peer clone
      const peerDir = path.join(tempRoot, 'peer-hub');
      git(tempRoot, ['clone', bareRemoteDir, peerDir]);
      git(peerDir, ['config', 'user.name', 'Peer Dev']);
      git(peerDir, ['config', 'user.email', 'peer@esedre.com']);
      const peerStorage = new FilesystemStorageAdapter(tempRoot, {
        dataDir: peerDir,
        projectCode: 'Esedre',
        sync: { enabled: false },
      });
      await peerStorage.updateTicket('Esedre-1', { priority: 'Critical' });
      await peerStorage.addComment('Esedre-1', {
        author: 'PeerDev',
        text: 'Escalated priority from peer machine',
      });
      await peerStorage.syncDataHub({ pull: true, push: true, commit: true, force: true });
      peerStorage.closeWatchers();

      // Create a local uncommitted ticket on primary hub before running Pull-Only
      await fsStorage.createTicket({
        projectCode: 'Esedre',
        title: 'Local uncommitted draft ticket',
      });

      // Run Pull-Only (commit: false, pull: true, push: false)
      const pullResults = await fsStorage.syncDataHub({
        pull: true,
        push: false,
        commit: false,
        force: true,
      });
      expect(pullResults.length).toBe(1);
      expect(pullResults[0].status).toBe('idle');
      expect(pullResults[0].committed).toBe(false);
      expect(pullResults[0].pulled).toBe(true);
      expect(pullResults[0].pushed).toBe(false);

      // Local draft ticket must remain uncommitted in the working tree
      const statusAfterPull = await fsStorage.getSyncStatus();
      expect((statusAfterPull.hubs[0].dirtyFilesCount ?? 0) > 0).toBe(true);

      // Immediately verify both FilesystemStorageAdapter and HTTP /api/planning/all invalidated stale caches (<5s TTL)
      const refreshedTicket1 = await fsStorage.getTicket('Esedre-1');
      expect(refreshedTicket1?.meta.priority).toBe('Critical');
      expect(refreshedTicket1?.comments.some((c) => c.text.includes('Escalated priority from peer machine'))).toBe(
        true
      );

      const resAfterPull = await fetch(`${baseUrl}/api/planning/all`, {
        headers: { 'If-None-Match': etag1! },
      });
      expect(resAfterPull.status).toBe(200);
      const payloadAfterPull = await resAfterPull.json();
      const apiTicket1 = payloadAfterPull.metas['Esedre-1'];
      expect(apiTicket1?.priority).toBe('Critical');
      expect(apiTicket1?.commentCount).toBe(1);

      fsStorage.closeWatchers();
    });
  });
});
