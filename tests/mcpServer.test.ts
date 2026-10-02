import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { CURRENT_ESEDRE_VERSION } from '../src/types.js';

describe('EsedreMcpServer (JSON-RPC 2.0)', () => {
  let tempDir: string;
  let adapter: FilesystemStorageAdapter;
  let server: EsedreMcpServer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-mcp-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const projects = [
      { id: 1, code: 'Core', name: 'Core Application', description: 'Main App' },
      { id: 2, code: 'Web', name: 'Web Client', description: 'Web Client' },
      { id: 3, code: 'Docs', name: 'Documentation', description: 'Docs' },
    ];
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

  const callRpc = async (serverInstance: EsedreMcpServer, req: any) => {
    return await (serverInstance as any).handleRequest(req);
  };

  it('handles MCP initialize handshake', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });

    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe('2024-11-05');
    expect(res.result.serverInfo.name).toBe('esedre');
    expect(res.result.serverInfo.version).toBe(CURRENT_ESEDRE_VERSION);
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.capabilities.resources).toBeDefined();
  });

  it('handles ping', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    });

    expect(res.id).toBe(2);
    expect(res.result).toEqual({});
  });

  it('lists registered tools with correct schemas and excludes esedre_list_projects', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });

    expect(res.result.tools).toBeInstanceOf(Array);
    const toolNames = res.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('esedre_list_tickets');
    expect(toolNames).toContain('esedre_get_ticket');
    expect(toolNames).toContain('esedre_create_ticket');
    expect(toolNames).toContain('esedre_update_ticket');
    expect(toolNames).toContain('esedre_get_plan');
    expect(toolNames).toContain('esedre_save_plan');
    expect(toolNames).toContain('esedre_add_comment');
    expect(toolNames).not.toContain('esedre_list_projects'); // Eliminated tool
  });

  it('executes esedre_create_ticket and esedre_get_ticket via tools/call', async () => {
    // 1. Create a ticket
    const createRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'esedre_create_ticket',
        arguments: {
          title: 'MCP Integration Ticket',
          category: 'Feature',
          project: 'Core',
          summary: 'Testing MCP server via JSON-RPC',
        },
      },
    });

    expect(createRes.result).toBeDefined();
    const createdTicket = JSON.parse(createRes.result.content[0].text);
    expect(createdTicket.meta.id).toBe(1);
    expect(createdTicket.meta.title).toBe('MCP Integration Ticket');
    expect(createdTicket.sha1).toBeDefined();

    // 2. Get the ticket
    const getRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'esedre_get_ticket',
        arguments: { ticketId: 1 },
      },
    });

    expect(getRes.result).toBeDefined();
    const fetched = JSON.parse(getRes.result.content[0].text);
    expect(fetched.meta.id).toBe(1);
    expect(fetched.meta.title).toBe('MCP Integration Ticket');
  });

  it('saves and retrieves implementation plans via tools/call', async () => {
    await adapter.createTicket({ title: 'Plan Target', category: 'Feature', projectCode: 'Core' });

    // Save plan
    const saveRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'esedre_save_plan',
        arguments: {
          ticketId: 1,
          planMarkdown: '## Proposed Implementation\n- Step 1\n- Step 2',
        },
      },
    });

    expect(saveRes.result).toBeDefined();

    // Get plan
    const getPlanRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'esedre_get_plan',
        arguments: { ticketId: 1 },
      },
    });

    const planData = JSON.parse(getPlanRes.result.content[0].text);
    expect(planData.planMarkdown).toContain('## Proposed Implementation');
  });

  it('exposes and reads URI resources (esedre://tickets/{id} and fallback esedre://)', async () => {
    await adapter.createTicket({ title: 'Resource Target', category: 'Feature', projectCode: 'Core' });

    // List resources
    const listRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/list',
    });

    expect(listRes.result.resources).toHaveLength(1);
    expect(listRes.result.resources[0].uri).toBe('esedre://tickets/1');

    // Read resource via esedre://
    const readRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 9,
      method: 'resources/read',
      params: { uri: 'esedre://tickets/1' },
    });

    expect(readRes.result.contents[0].uri).toBe('esedre://tickets/1');
    expect(readRes.result.contents[0].mimeType).toBe('text/markdown');
    expect(readRes.result.contents[0].text).toContain('# Ticket #1: Resource Target');

    // Read resource via legacy esedre:// fallback
    const legacyReadRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 10,
      method: 'resources/read',
      params: { uri: 'esedre://tickets/1' },
    });

    expect(legacyReadRes.result.contents[0].uri).toBe('esedre://tickets/1');
    expect(legacyReadRes.result.contents[0].text).toContain('# Ticket #1: Resource Target');
  });

  it('updates ticket specification detail via esedre_update_ticket (Ticket #49)', async () => {
    await adapter.createTicket({ title: 'MCP Update Target', category: 'Feature', projectCode: 'Core' });

    const updateRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'esedre_update_ticket',
        arguments: {
          ticketId: 1,
          detailMarkdown: '### Summary\nMCP updated ticket detail summary.\n\n### Feature Breakdown\n1. Detail from MCP',
        },
      },
    });

    expect(updateRes.result).toBeDefined();
    const updatedTicket = JSON.parse(updateRes.result.content[0].text);
    expect(updatedTicket.meta.id).toBe(1);
    expect(updatedTicket.detail?.summary).toBe('MCP updated ticket detail summary.');
    expect(updatedTicket.detail?.breakdown).toContain('Detail from MCP');
  });
});

