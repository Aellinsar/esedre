import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AddressInfo } from 'node:net';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { HttpStorageAdapter } from '../src/storage/http.js';
import { createStorageAdapter } from '../src/storage/index.js';
import { startApiServer } from '../src/server/apiServer.js';
import { getRemoteDaemonStatus } from '../src/server/daemon.js';
import {
  normalizeRemoteHostUrl,
  setGlobalConfigKey,
  getGlobalConfigKey,
  resolveRemoteHost,
  findEsedreConfig,
  EsedreAuthorizationError,
} from '../src/config.js';
import {
  EsedreConflictError,
  EsedreLeaseConflictError,
  CURRENT_ESEDRE_VERSION,
} from '../src/types.js';
import { CURRENT_DATA_VERSION } from '../src/migrations/index.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { evaluateAntigravityPreToolHook } from '../src/mcp/antigravityHook.js';
import { initHub, initWorkspace } from '../src/upgrade.js';

describe('Remote Server Host, HttpStorageAdapter & 5-Tier Resolution (Esedre-51)', () => {
  let tempRoot: string;
  let fakeGlobalDir: string;
  let originalGlobalEnv: string | undefined;
  let originalHostEnv: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-http-storage-test-'));
    fakeGlobalDir = path.join(tempRoot, 'global-esedre');
    fs.mkdirSync(fakeGlobalDir, { recursive: true });

    originalGlobalEnv = process.env.ESEDRE_GLOBAL_DIR;
    originalHostEnv = process.env.ESEDRE_HOST;
    process.env.ESEDRE_GLOBAL_DIR = fakeGlobalDir;
    delete process.env.ESEDRE_HOST;
  });

  afterEach(() => {
    if (originalGlobalEnv !== undefined) {
      process.env.ESEDRE_GLOBAL_DIR = originalGlobalEnv;
    } else {
      delete process.env.ESEDRE_GLOBAL_DIR;
    }
    if (originalHostEnv !== undefined) {
      process.env.ESEDRE_HOST = originalHostEnv;
    } else {
      delete process.env.ESEDRE_HOST;
    }
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('URL Normalization & Global Config Keys', () => {
    it('normalizes bare hostnames, IP:port, trailing slashes, and /api suffixes', () => {
      expect(normalizeRemoteHostUrl('192.168.86.38')).toBe('http://192.168.86.38:5674');
      expect(normalizeRemoteHostUrl('192.168.86.38:5674')).toBe('http://192.168.86.38:5674');
      expect(normalizeRemoteHostUrl('http://192.168.86.38:5674/')).toBe('http://192.168.86.38:5674');
      expect(normalizeRemoteHostUrl('http://192.168.86.38:5674/api')).toBe('http://192.168.86.38:5674');
      expect(normalizeRemoteHostUrl('http://192.168.86.38:5674/app/')).toBe('http://192.168.86.38:5674');
      expect(normalizeRemoteHostUrl('https://esedre.internal.example.com/')).toBe(
        'https://esedre.internal.example.com'
      );
      expect(normalizeRemoteHostUrl('none')).toBeUndefined();
      expect(normalizeRemoteHostUrl('local')).toBe('local');
      expect(normalizeRemoteHostUrl('clear')).toBeUndefined();
      expect(normalizeRemoteHostUrl('')).toBeUndefined();
    });

    it('sets, reads, and clears server.host and remotes.<Code> in ~/.esedre/config.json', () => {
      setGlobalConfigKey('server.host', '192.168.86.38:5674');
      expect(getGlobalConfigKey('server.host')).toBe('http://192.168.86.38:5674');
      expect(getGlobalConfigKey('server')).toEqual({ host: 'http://192.168.86.38:5674' });

      setGlobalConfigKey('remotes.Profe', '10.0.0.12:5674');
      expect(getGlobalConfigKey('remotes.Profe')).toBe('http://10.0.0.12:5674');
      expect(getGlobalConfigKey('remotes.profe')).toBe('http://10.0.0.12:5674');

      // Clear per-project remote
      setGlobalConfigKey('remotes.PROFE', 'none');
      expect(getGlobalConfigKey('remotes.Profe')).toBeUndefined();

      // Clear global server.host
      setGlobalConfigKey('server.host', 'none');
      expect(getGlobalConfigKey('server.host')).toBeUndefined();
    });
  });

  describe('5-Tier Remote Host Precedence Hierarchy', () => {
    it('resolves across all 5 tiers and enforces Tier 3 self-contained local workspace precedence', () => {
      // Set Tier 5 global default server.host
      setGlobalConfigKey('server.host', 'http://192.168.86.38:5674');

      // 1. Standard client workspace (only .esedre/esedre.json, no local tickets) -> uses Tier 5 global server.host
      const clientRepo = path.join(tempRoot, 'profe-client');
      fs.mkdirSync(path.join(clientRepo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(clientRepo, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'Profe', allowedProjects: ['Profe'] }, null, 2)
      );
      const clientDiscovered = findEsedreConfig(clientRepo, { fallbackToGlobal: true });
      expect(resolveRemoteHost(clientDiscovered)).toBe('http://192.168.86.38:5674');

      // 2. Tier 3: Self-contained local workspace with .esedre/tickets/ takes precedence over global server.host
      const standaloneRepo = path.join(tempRoot, 'standalone-repo');
      fs.mkdirSync(path.join(standaloneRepo, '.esedre', 'tickets', '1'), { recursive: true });
      fs.writeFileSync(
        path.join(standaloneRepo, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'Solo', allowedProjects: ['Solo'] }, null, 2)
      );
      const standaloneDiscovered = findEsedreConfig(standaloneRepo, { fallbackToGlobal: true });
      expect(resolveRemoteHost(standaloneDiscovered)).toBeUndefined();

      // 3. Tier 3: Workspace with explicit in-repo dataDir in .esedre/esedre.json stays local,
      // while external "../esedre-data" hub references route to global server.host
      const customHubRepo = path.join(tempRoot, 'custom-hub-repo');
      fs.mkdirSync(path.join(customHubRepo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(customHubRepo, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'Custom', dataDir: './local-planning-hub' }, null, 2)
      );
      const customHubDiscovered = findEsedreConfig(customHubRepo, { fallbackToGlobal: true });
      expect(resolveRemoteHost(customHubDiscovered)).toBeUndefined();

      const externalHubRepo = path.join(tempRoot, 'external-hub-repo');
      fs.mkdirSync(path.join(externalHubRepo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(externalHubRepo, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'Esedre', dataDir: '../esedre-data' }, null, 2)
      );
      const externalHubDiscovered = findEsedreConfig(externalHubRepo, { fallbackToGlobal: true });
      expect(resolveRemoteHost(externalHubDiscovered)).toBe('http://192.168.86.38:5674');

      // 4. Tier 2: Per-project remotes.<Code> overrides global server.host and self-contained check
      setGlobalConfigKey('remotes.Profe', 'http://10.20.30.40:5674');
      expect(resolveRemoteHost(clientDiscovered)).toBe('http://10.20.30.40:5674');

      // 5. Tier 1: --host flag or ESEDRE_HOST env var overrides everything
      expect(resolveRemoteHost(clientDiscovered, { hostFlag: 'http://127.0.0.1:9999' })).toBe(
        'http://127.0.0.1:9999'
      );
      expect(resolveRemoteHost(clientDiscovered, { hostFlag: 'local' })).toBeUndefined();

      process.env.ESEDRE_HOST = 'http://172.16.0.5:5674';
      expect(resolveRemoteHost(clientDiscovered)).toBe('http://172.16.0.5:5674');
    });

    it('supports Tier 4 workspace server.host while bypassing it on the host machine itself', () => {
      const hubDir = path.join(tempRoot, 'esedre-data');
      initHub(hubDir);
      fs.mkdirSync(path.join(hubDir, 'projects', 'Shared', 'tickets'), { recursive: true });
      fs.writeFileSync(
        path.join(hubDir, 'projects', 'Shared', 'project.json'),
        JSON.stringify({ id: 1, code: 'Shared', name: 'Shared Project' }, null, 2)
      );

      const sharedRepo = path.join(tempRoot, 'shared-repo');
      fs.mkdirSync(path.join(sharedRepo, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(sharedRepo, '.esedre', 'esedre.json'),
        JSON.stringify(
          {
            projectCode: 'Shared',
            server: { host: 'http://192.168.86.38:5674' },
          },
          null,
          2
        )
      );

      // On a client machine without the local hub in ~/.esedre/config.json -> resolves to Tier 4 workspace server.host
      const clientDiscovered = findEsedreConfig(sharedRepo, { fallbackToGlobal: true });
      expect(resolveRemoteHost(clientDiscovered)).toBe('http://192.168.86.38:5674');

      // On the host machine that owns hubDir in ~/.esedre/config.json (and has no global server.host) -> stays local!
      setGlobalConfigKey('dataDir', hubDir);
      const hostDiscovered = findEsedreConfig(sharedRepo, { fallbackToGlobal: true });
      expect(resolveRemoteHost(hostDiscovered)).toBeUndefined();
    });
  });

  describe('HttpStorageAdapter & Remote Daemon End-to-End over HTTP', () => {
    let serverHubDir: string;
    let serverStorage: FilesystemStorageAdapter;
    let apiServer: ReturnType<typeof startApiServer>;
    let remoteUrl: string;

    beforeEach(async () => {
      serverHubDir = path.join(tempRoot, 'server-hub');
      initHub(serverHubDir);
      serverStorage = new FilesystemStorageAdapter(serverHubDir, {
        dataDir: serverHubDir,
        allowedProjects: ['*'],
      });
      await serverStorage.registerProject({
        code: 'Esedre',
        name: 'Esedre Core',
        description: 'Core roadmap engine',
      });
      await serverStorage.registerProject({
        code: 'Profe',
        name: 'Professor Arwam',
        description: 'Language learning suite',
      });
      await serverStorage.registerProject({
        code: 'Secret',
        name: 'Secret Project',
        description: 'Restricted project',
      });
      await serverStorage.createTicket({
        projectCode: 'Secret',
        title: 'Top Secret Spec',
      });

      apiServer = startApiServer(0, serverStorage, serverHubDir);
      await new Promise<void>((resolve) => {
        if (apiServer.listening) return resolve();
        apiServer.once('listening', () => resolve());
      });
      const addr = apiServer.address() as AddressInfo;
      remoteUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      if (apiServer) {
        await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      }
    });

    it('reports remote daemon status accurately when online and offline', async () => {
      const onlineStatus = await getRemoteDaemonStatus(remoteUrl);
      expect(onlineStatus.running).toBe(true);
      expect(onlineStatus.remote).toBe(true);
      expect(onlineStatus.host).toBe(remoteUrl);
      expect(onlineStatus.version).toBe(CURRENT_ESEDRE_VERSION);
      expect(onlineStatus.schemaVersion).toBe(CURRENT_DATA_VERSION);
      expect(typeof onlineStatus.uptimeSeconds).toBe('number');
      expect(onlineStatus.projects).toEqual(expect.arrayContaining(['Esedre', 'Profe', 'Secret']));

      const offlineStatus = await getRemoteDaemonStatus('http://127.0.0.1:59999', 300);
      expect(offlineStatus.running).toBe(false);
      expect(offlineStatus.remote).toBe(true);
      expect(offlineStatus.host).toBe('http://127.0.0.1:59999');
    });

    it('supports full ticket lifecycle, filters, OCC, plans, comments, links, milestones, and leases over HTTP', async () => {
      const clientDir = path.join(tempRoot, 'laptop-workspace');
      fs.mkdirSync(path.join(clientDir, '.esedre'), { recursive: true });
      const clientConfig = {
        projectCode: 'Esedre',
        allowedProjects: ['Esedre', 'Profe'],
        server: { host: remoteUrl },
      };
      fs.writeFileSync(
        path.join(clientDir, '.esedre', 'esedre.json'),
        JSON.stringify(clientConfig, null, 2)
      );

      const discovered = findEsedreConfig(clientDir, { fallbackToGlobal: true });
      const { storage, remoteHost } = createStorageAdapter(discovered);
      expect(remoteHost).toBe(remoteUrl);

      // 1. Projects (filtered by allowedProjects)
      const projects = await storage.getProjects();
      expect(projects.map((p) => p.code)).toEqual(['Esedre', 'Profe']);

      const updatedProj = await storage.updateProject({
        code: 'Esedre',
        description: 'Updated via HTTP client',
      });
      expect(updatedProj.description).toBe('Updated via HTTP client');

      // 2. Milestones CRUD + umbrella featureFlag inheritance
      const ms = await storage.createMilestone({
        projectCode: 'Esedre',
        title: 'v0.7.0 Remote Mode',
        featureFlag: 'remote-host-v1',
        description: 'LAN client support',
      });
      expect(ms.id).toBe(1);
      expect(ms.featureFlag).toBe('remote-host-v1');

      const fetchedMs = await storage.getMilestone(ms.id, 'Esedre');
      expect(fetchedMs?.title).toBe('v0.7.0 Remote Mode');

      // 3. Create tickets across Esedre and Profe
      const t1 = await storage.createTicket({
        projectCode: 'Esedre',
        title: 'Implement HttpStorageAdapter',
        type: 'Feature',
        priority: 'High',
        milestone: String(ms.id),
        summary: 'HTTP client adapter',
        detailMarkdown: '# Spec\nFull HTTP parity.',
        planMarkdown: '# Plan\nStep 1: Build adapter.',
      });
      expect(t1.meta.id).toBe(1);
      expect(t1.meta.project).toBe('Esedre');
      expect(t1.meta.priority).toBe('High');
      expect(t1.meta.inheritedFeatureFlag).toBe('remote-host-v1');
      expect(t1.detail?.raw).toContain('Full HTTP parity.');
      expect(t1.planMarkdown).toContain('Step 1: Build adapter.');

      const t2 = await storage.createTicket({
        projectCode: 'Profe',
        title: 'Consume remote Esedre from laptop',
        type: 'Platform',
        priority: 'Medium',
      });
      expect(t2.meta.id).toBe(1);
      expect(t2.meta.project).toBe('Profe');

      // Non-existent ticket returns null
      expect(await storage.getTicket('Esedre-999')).toBeNull();

      // 4. Bi-directional cross-project linking & isBlocked filter
      const linkRes = await storage.addTicketLink('Esedre-1', 'blocks', 'Profe-1', {
        author: 'LaptopAgent',
      });
      expect(linkRes.source.links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ relation: 'blocks', targetKey: 'Profe-1' }),
        ])
      );

      const blockedTickets = await storage.listTickets({ project: 'Profe', isBlocked: true });
      expect(blockedTickets).toHaveLength(1);
      expect(blockedTickets[0].meta.title).toBe('Consume remote Esedre from laptop');

      const byFlag = await storage.listTickets({
        project: 'Esedre',
        featureFlag: 'remote-host-v1',
      });
      expect(byFlag).toHaveLength(1);

      const byLinkedTo = await storage.listTickets({
        project: 'Profe',
        linkedTo: 'Esedre-1',
      });
      expect(byLinkedTo).toHaveLength(1);

      // 5. Optimistic Concurrency Control (EsedreConflictError) on stale lastHash
      await expect(
        storage.updateTicket('Esedre-1', { status: 'In Development' }, '0000000000000000000000000000000000000000')
      ).rejects.toThrow(EsedreConflictError);

      const currentT1 = await storage.getTicket('Esedre-1');
      const updatedT1 = await storage.updateTicket(
        'Esedre-1',
        { status: 'In Development', priority: 'Critical' },
        currentT1!.sha1
      );
      expect(updatedT1.meta.status).toBe('In Development');
      expect(updatedT1.meta.priority).toBe('Critical');

      // 6. Plans, Comments, Answers, Detail
      await storage.savePlan('Esedre-1', '# Updated Plan\nStep 2: Verify tests.', updatedT1.sha1);
      expect(await storage.getPlan('Esedre-1')).toContain('Step 2: Verify tests.');

      const comment = await storage.addComment('Esedre-1', {
        author: 'Matt@Quaoar',
        text: 'Tested over LAN from laptop!',
      });
      expect(comment.author).toBe('Matt@Quaoar');
      const ticketWithComment = await storage.getTicket('Esedre-1');
      expect(ticketWithComment?.comments).toHaveLength(1);

      await storage.saveAnswer('Esedre-1', 0, 'Use 5-tier precedence');
      expect(await storage.getAnswers('Esedre-1')).toEqual({ '0': 'Use 5-tier precedence' });

      await storage.saveDetail('Esedre-1', '# Updated Spec');
      const afterDetail = await storage.getTicket('Esedre-1');
      expect(afterDetail?.detail?.raw).toContain('# Updated Spec');

      // 7. Leases (claim, conflict, renew, list, release)
      const claim = await storage.claimTicket({
        ticketId: 'Esedre-1',
        holder: 'Matt@Quaoar',
        hostname: 'Quaoar-2002LM60',
        ttlMinutes: 60,
      });
      expect(claim.lease.ticketKey).toBe('Esedre-1');
      expect(claim.lease.holder).toBe('Matt@Quaoar');

      await expect(
        storage.claimTicket({
          ticketId: 'Esedre-1',
          holder: 'OtherAgent@Eris',
        })
      ).rejects.toThrow(EsedreLeaseConflictError);

      const leasedTickets = await storage.listTickets({ project: 'Esedre', leased: true });
      expect(leasedTickets).toHaveLength(1);

      const renewed = await storage.renewLease({
        ticketId: 'Esedre-1',
        holder: 'Matt@Quaoar',
        ttlMinutes: 90,
      });
      expect(renewed.ttlMinutes).toBe(90);

      const activeLeases = await storage.listLeases('Esedre');
      expect(activeLeases).toHaveLength(1);

      const released = await storage.releaseTicket({
        ticketId: 'Esedre-1',
        holder: 'Matt@Quaoar',
      });
      expect(released.released).toBe(true);

      // 8. Unlink and delete milestone
      await storage.removeTicketLinks!('Esedre-1', ['Profe-1']);
      const afterUnlink = await storage.getTicket('Esedre-1');
      expect(afterUnlink?.links || []).toHaveLength(0);

      expect(await storage.deleteMilestone(ms.id, 'Esedre')).toBe(true);

      // 9. Unauthorized project throws EsedreAuthorizationError
      await expect(storage.getTicket('Secret-1')).rejects.toThrow(EsedreAuthorizationError);
      await expect(storage.listTickets({ project: 'Secret' })).rejects.toThrow(
        EsedreAuthorizationError
      );
    });

    it('proxies MCP tool calls over HttpStorageAdapter and refreshes local .esedre/snapshot.json on client machine', async () => {
      setGlobalConfigKey('server.host', remoteUrl);

      const laptopProfeDir = path.join(tempRoot, 'laptop-profe');
      initWorkspace(laptopProfeDir, {
        projectCode: 'Profe',
        allowedProjects: ['Profe'],
      });

      const discovered = findEsedreConfig(laptopProfeDir, { fallbackToGlobal: true });
      const { storage } = createStorageAdapter(discovered);
      const mcp = new EsedreMcpServer(storage, {
        workspaceRoot: laptopProfeDir,
        config: discovered.config,
        projectCode: 'Profe',
        useGlobalContextBridge: true,
      });

      evaluateAntigravityPreToolHook({
        conversationId: 'laptop-session',
        workspacePaths: [laptopProfeDir],
        toolCall: {
          name: 'call_mcp_tool',
          args: {
            ServerName: 'esedre',
            ToolName: 'esedre_create_ticket',
            Arguments: { title: 'Remote MCP Ticket' },
          },
        },
      });

      const createRes = await mcp.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Created from Laptop MCP over HTTP',
            type: 'Feature',
            priority: 'High',
          },
        },
      });
      expect(createRes?.error).toBeUndefined();
      const createdPayload = JSON.parse(createRes!.result.content[0].text);
      expect(createdPayload.meta.id).toBe(1);
      expect(createdPayload.meta.project).toBe('Profe');

      // Verify the ticket was persisted on the remote server's storage hub
      const remoteTicket = await serverStorage.getTicket('Profe-1');
      expect(remoteTicket?.meta.title).toBe('Created from Laptop MCP over HTTP');

      // Verify the client workspace's local .esedre/snapshot.json was automatically refreshed!
      const localSnapshotPath = path.join(laptopProfeDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(localSnapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(localSnapshotPath, 'utf-8'));
      expect(snapshot.projectCode).toBe('Profe');
      expect(snapshot.totalTickets).toBe(1);
      expect(snapshot.tickets[0].title).toBe('Created from Laptop MCP over HTTP');
    });
  });
});
