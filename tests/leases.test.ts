import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { EsedreLeaseConflictError } from '../src/types.js';
import { checkAgentRuleSizes, AGENT_RULE_MAX_BYTES, configureWorkspace } from '../src/upgrade.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import { initLogger, logInfo, logWarn, getLogBuffer, clearLogBuffer } from '../src/utils/logger.js';

describe('Ticket Leases (Esedre-69) & Rule Size Warnings (Esedre-68)', () => {
  let tempDir: string;
  let storage: FilesystemStorageAdapter;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-leases-test-'));
    storage = new FilesystemStorageAdapter(tempDir, {
      projectCode: 'Esedre',
      projectName: 'Esedre Engine',
      allowedProjects: ['Esedre'],
    });
    await storage.registerProject({ code: 'Esedre', name: 'Esedre Engine' });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('claims, renews, lists, and releases a ticket lease cleanly', async () => {
    const ticket = await storage.createTicket({
      title: 'Implement standalone leases',
      projectCode: 'Esedre',
      type: 'Feature',
    });

    // Claim lease
    const claimRes = await storage.claimTicket({
      ticketId: ticket.meta.id,
      holder: 'laptop-agent',
      agentType: 'antigravity',
      hostname: 'matt-laptop',
      branch: 'ticket/Esedre-69-leases',
      ttlMinutes: 45,
    });

    expect(claimRes.renewed).toBe(false);
    expect(claimRes.lease.ticketKey).toBe(`Esedre-${ticket.meta.id}`);
    expect(claimRes.lease.holder).toBe('laptop-agent');
    expect(claimRes.lease.ttlMinutes).toBe(45);
    expect(claimRes.ticket.meta.status).toBe('In Development');

    // Re-claiming by same holder renews idempotently
    const secondClaim = await storage.claimTicket({
      ticketId: ticket.meta.id,
      holder: 'laptop-agent',
      ttlMinutes: 90,
    });
    expect(secondClaim.renewed).toBe(true);
    expect(secondClaim.lease.ttlMinutes).toBe(90);

    // Competing holder without force throws EsedreLeaseConflictError
    await expect(
      storage.claimTicket({
        ticketId: ticket.meta.id,
        holder: 'desktop-agent',
      })
    ).rejects.toThrow(EsedreLeaseConflictError);

    // Competing holder with force overrides
    const overrideRes = await storage.claimTicket({
      ticketId: ticket.meta.id,
      holder: 'desktop-agent',
      force: true,
    });
    expect(overrideRes.overridden).toBe(true);
    expect(overrideRes.lease.holder).toBe('desktop-agent');

    // List leases
    const leases = await storage.listLeases('Esedre');
    expect(leases).toHaveLength(1);
    expect(leases[0].holder).toBe('desktop-agent');

    // Snapshot includes activeLeases
    const snap = await generateProjectSnapshot(storage, 'Esedre', tempDir);
    expect(snap.activeLeases).toBeDefined();
    expect(snap.activeLeases).toHaveLength(1);
    expect(snap.activeLeases![0].holder).toBe('desktop-agent');

    // Release lease
    const rel = await storage.releaseTicket({
      ticketId: ticket.meta.id,
      holder: 'desktop-agent',
    });
    expect(rel.released).toBe(true);

    const afterLeases = await storage.listLeases('Esedre');
    expect(afterLeases).toHaveLength(0);
  });

  it('auto-expires stale leases based on expiresAt and auto-releases on ticket completion', async () => {
    const ticket = await storage.createTicket({
      title: 'Test TTL expiration',
      projectCode: 'Esedre',
    });

    await storage.claimTicket({
      ticketId: ticket.meta.id,
      holder: 'worker-1',
      ttlMinutes: 10,
    });

    // Manually backdate expiresAt in lease.json to simulate TTL expiry
    const leasePath = path.join(tempDir, '.esedre', 'tickets', String(ticket.meta.id), 'lease.json');
    const rawLease = JSON.parse(fs.readFileSync(leasePath, 'utf-8'));
    rawLease.expiresAt = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(leasePath, JSON.stringify(rawLease, null, 2) + '\n', 'utf-8');
    storage.invalidateTicketCache();

    // Another worker can now claim without force because previous lease expired
    const newClaim = await storage.claimTicket({
      ticketId: ticket.meta.id,
      holder: 'worker-2',
    });
    expect(newClaim.lease.holder).toBe('worker-2');

    // Completing the ticket automatically clears the lease
    await storage.updateTicket(ticket.meta.id, { status: 'Completed' });
    const afterComplete = await storage.getTicketLease(ticket.meta.id);
    expect(afterComplete).toBeNull();
  });

  it('exposes MCP lease tools and enforces SecurityFilter isolation', async () => {
    const ticket = await storage.createTicket({
      title: 'MCP lease test',
      projectCode: 'Esedre',
    });

    const secured = new SecurityFilter(storage, {
      projectCode: 'Esedre',
      allowedProjects: ['Esedre'],
    });
    const mcp = new EsedreMcpServer(secured);

    const claimResp = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: `Esedre-${ticket.meta.id}`,
          holder: 'mcp-worker-1',
          ttlMinutes: 30,
        },
      },
    });
    expect(claimResp?.error).toBeUndefined();
    const claimPayload = JSON.parse(claimResp!.result.content[0].text);
    expect(claimPayload.success).toBe(true);
    expect(claimPayload.lease.holder).toBe('mcp-worker-1');

    // Conflict via MCP returns -32001
    const conflictResp = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: `Esedre-${ticket.meta.id}`,
          holder: 'mcp-worker-2',
        },
      },
    });
    expect(conflictResp?.error?.code).toBe(-32001);

    // Unauthorized project fails SecurityFilter check
    await expect(
      secured.claimTicket({
        ticketId: 1,
        project: 'SecretProj',
        holder: 'mcp-worker-1',
      })
    ).rejects.toThrow(/Access Denied/);
  });

  it('detects oversized AGENTS.md files (> 24,000 bytes) and writes dual MCP configs (Esedre-68)', () => {
    const oversizedContent = '# Oversized Rules\n' + 'a'.repeat(AGENT_RULE_MAX_BYTES + 500);
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), oversizedContent, 'utf-8');

    const warnings = checkAgentRuleSizes(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].file).toBe('AGENTS.md');
    expect(warnings[0].bytes).toBeGreaterThan(AGENT_RULE_MAX_BYTES);

    const cfgRes = configureWorkspace(tempDir, {
      projectCode: 'Esedre',
      allowedProjects: ['Esedre'],
      setupMcp: true,
    });
    expect(cfgRes.ruleSizeWarnings).toHaveLength(1);
    expect(fs.existsSync(path.join(tempDir, '.agents', 'mcp_config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agents', 'mcp.json'))).toBe(true);
  });

  it('records structured logs in memory ring buffer when logger is used', () => {
    clearLogBuffer();
    initLogger({ debug: false });
    logInfo('LeaseSubsys', 'Claimed ticket Esedre-69', { holder: 'agent-1' });
    logWarn('LeaseSubsys', 'Lease nearing expiration');
    const buf = getLogBuffer();
    expect(buf.length).toBeGreaterThanOrEqual(2);
    expect(buf[0].subsystem).toBe('LeaseSubsys');
  });
});
