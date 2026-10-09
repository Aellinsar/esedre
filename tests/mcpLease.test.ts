import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemTicketRepository } from '../src/storage/filesystem.js';
import { AuthorizedTicketRepository } from '../src/storage/securityFilter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';

describe('Esedre MCP Server Lease Tools (Ticket #66)', () => {
  let tempDir: string;
  let server: EsedreMcpServer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-mcp-lease-test-'));

    // Create standalone project structure under .esedre/
    const ticketsDir = path.join(tempDir, '.esedre', 'tickets', '1');
    fs.mkdirSync(ticketsDir, { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, '.esedre', 'esedre.json'),
      JSON.stringify(
        {
          projectCode: 'Core',
          allowedProjects: ['Core'],
        },
        null,
        2
      )
    );

    // Seed ticket #1
    fs.writeFileSync(
      path.join(ticketsDir, 'meta.json'),
      JSON.stringify(
        {
          id: 1,
          title: 'Autonomous Worker Task',
          type: 'Feature',
          category: 'Feature',
          status: 'Planned',
          project: 'Core',
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(ticketsDir, 'detail.md'), '# Ticket #1: Autonomous Worker Task\n');

    const rawRepo = new FilesystemTicketRepository(tempDir, { projectCode: 'Core', allowedProjects: ['Core'] });
    const authRepo = new AuthorizedTicketRepository(rawRepo, { projectCode: 'Core', allowedProjects: ['Core'] });
    server = new EsedreMcpServer(authRepo);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const callRpc = async (serverInstance: EsedreMcpServer, req: any) => {
    return await (serverInstance as any).handleRequest(req);
  };

  it('exposes all lease tools in tools/list', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    const toolNames = res.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('esedre_claim_ticket');
    expect(toolNames).toContain('esedre_renew_lease');
    expect(toolNames).toContain('esedre_release_ticket');
    expect(toolNames).toContain('esedre_list_leases');
    expect(toolNames).toContain('esedre_escalate_ticket');
  });

  it('claims a ticket and acquires exclusive lease via esedre_claim_ticket', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          role: 'thug',
          ttlMinutes: 20,
        },
      },
    });

    expect(res.error).toBeUndefined();
    const data = JSON.parse(res.result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.lease.workerId).toBe('thug-1');
    expect(data.lease.role).toBe('thug');
    expect(data.lease.ttlMinutes).toBe(20);
    expect(data.ticket.meta.status).toBe('In Development');
  });

  it('returns JSON-RPC error code -32001 on lease conflict', async () => {
    // Thug 1 claims
    await callRpc(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          role: 'thug',
        },
      },
    });

    // Thug 2 attempts to claim
    const conflictRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-2',
          role: 'thug',
        },
      },
    });

    expect(conflictRes.error).toBeDefined();
    expect(conflictRes.error.code).toBe(-32001);
    expect(conflictRes.error.message).toContain('Lease Conflict');
    expect(conflictRes.error.data.ticketId).toBe(1);
    expect(conflictRes.error.data.role).toBe('thug');
    expect(conflictRes.error.data.activeHolder).toContain('thug-1');
  });

  it('blocks non-lead worker from forcing lease acquisition and permits lead', async () => {
    // Thug 1 claims
    await callRpc(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          role: 'thug',
        },
      },
    });

    // Thug 2 tries with force: true
    const thugForceRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-2',
          role: 'thug',
          force: true,
        },
      },
    });
    expect(thugForceRes.error).toBeDefined();
    expect(thugForceRes.error.message).toContain('Access Denied: Only a Lead may use force');

    // Lead breaks lease with force: true
    const leadForceRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'lead',
          role: 'lead',
          force: true,
        },
      },
    });
    expect(leadForceRes.error).toBeUndefined();
    const data = JSON.parse(leadForceRes.result.content[0].text);
    expect(data.lease.workerId).toBe('lead');
  });

  it('renews lease via esedre_renew_lease and lists active leases via esedre_list_leases', async () => {
    await callRpc(server, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          role: 'thug',
          ttlMinutes: 10,
        },
      },
    });

    // Renew
    const renewRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'esedre_renew_lease',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          ttlMinutes: 30,
        },
      },
    });
    expect(renewRes.error).toBeUndefined();
    const renewData = JSON.parse(renewRes.result.content[0].text);
    expect(renewData.lease.ttlMinutes).toBe(30);

    // List leases
    const listRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'esedre_list_leases',
        arguments: {},
      },
    });
    expect(listRes.error).toBeUndefined();
    const listData = JSON.parse(listRes.result.content[0].text);
    expect(listData.total).toBe(1);
    expect(listData.leases[0].workerId).toBe('thug-1');
  });

  it('releases ticket lease via esedre_release_ticket', async () => {
    await callRpc(server, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          role: 'thug',
        },
      },
    });

    const releaseRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'esedre_release_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          status: 'Completed',
          notes: 'Task verified with automated test suite',
        },
      },
    });
    expect(releaseRes.error).toBeUndefined();
    const data = JSON.parse(releaseRes.result.content[0].text);
    expect(data.ticket.meta.lease).toBeNull();
    expect(data.ticket.meta.status).toBe('Completed');
  });

  it('escalates ticket via esedre_escalate_ticket, releasing lease and resetting status to Planned', async () => {
    await callRpc(server, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'esedre_claim_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          role: 'thug',
        },
      },
    });

    const escRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'esedre_escalate_ticket',
        arguments: {
          ticketId: 1,
          workerId: 'thug-1',
          reason: 'Ambiguous API schema requirement requires Lead review',
        },
      },
    });
    expect(escRes.error).toBeUndefined();
    const data = JSON.parse(escRes.result.content[0].text);
    expect(data.ticket.meta.lease).toBeNull();
    expect(data.ticket.meta.status).toBe('Planned');
    expect(data.reason).toBe('Ambiguous API schema requirement requires Lead review');

    // Verify ticket has escalation comment
    const getRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'esedre_get_ticket',
        arguments: { ticketId: 1 },
      },
    });
    const ticketData = JSON.parse(getRes.result.content[0].text);
    const lastComment = ticketData.comments[ticketData.comments.length - 1];
    expect(lastComment.text).toContain('[Escalation] Ambiguous API schema requirement requires Lead review');
  });
});
