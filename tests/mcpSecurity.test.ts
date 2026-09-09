import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';

describe('Esedre MCP Server Security & Project Isolation', () => {
  let tempDir: string;
  let server: EsedreMcpServer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-mcp-sec-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    // Seed projects
    const projects = [
      { id: 1, code: 'Core', slug: 'core', name: 'Core Application', description: 'Main App' },
      { id: 2, code: 'Web', slug: 'web', name: 'Web Client', description: 'Web Client' },
      { id: 3, code: 'Docs', slug: 'docs', name: 'Documentation', description: 'Docs' },
    ];
    fs.writeFileSync(
      path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
      JSON.stringify(projects, null, 2)
    );

    // Seed tickets
    const seedTicket = (id: number, title: string, projectId: number, projectCode: string) => {
      const dir = path.join(ticketsDir, String(id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        JSON.stringify({
          id,
          title,
          category: 'Feature',
          projectId,
          project: projectCode,
          status: 'Planned',
        }, null, 2)
      );
      fs.writeFileSync(path.join(dir, 'detail.md'), `# Ticket #${id}: ${title}\n\n### Summary\nTest summary.`);
    };

    seedTicket(1, 'Core Feature', 1, 'Core');
    seedTicket(2, 'Web Feature', 2, 'Web');
    seedTicket(3, 'Docs Feature', 3, 'Docs');

    const raw = new FilesystemStorageAdapter(tempDir);
    const filtered = new SecurityFilter(raw, {
      projectCode: 'Profe',
      allowedProjects: ['Core', 'Docs'],
    });
    server = new EsedreMcpServer(filtered);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const callRpc = async (serverInstance: EsedreMcpServer, req: any) => {
    return await (serverInstance as any).handleRequest(req);
  };

  it('MCP resources/list excludes tickets from unauthorized projects', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/list',
    });

    expect(res.result.resources).toBeInstanceOf(Array);
    const uris = res.result.resources.map((r: any) => r.uri);
    expect(uris).toContain('esedre://tickets/1');
    expect(uris).toContain('esedre://tickets/3');
    expect(uris).not.toContain('esedre://tickets/2'); // Web ticket must be hidden
  });

  it('MCP resources/read rejects unauthorized ticket with JSON-RPC error', async () => {
    // 1. Authorized read succeeds
    const okRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'esedre://tickets/1' },
    });
    expect(okRes.result).toBeDefined();
    expect(okRes.result.contents[0].text).toContain('# Ticket #1: Core Feature');

    // 2. Unauthorized read is rejected with JSON-RPC error
    const deniedRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'esedre://tickets/2' },
    });
    expect(deniedRes.error).toBeDefined();
    expect(deniedRes.error.message).toMatch(/Access Denied/i);
  });

  it('esedre_list_tickets excludes unauthorized projects by default', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'esedre_list_tickets',
        arguments: {},
      },
    });

    const tickets = JSON.parse(res.result.content[0].text);
    const ids = tickets.map((t: any) => t.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2); // Web must not appear
  });

  it('esedre_list_tickets explicitly querying unauthorized project returns JSON-RPC error', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'esedre_list_tickets',
        arguments: { project: 'Web' }, 
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Access Denied.*Web/i);
  });

  it('esedre_get_ticket rejects probing unauthorized ticket IDs', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'esedre_get_ticket',
        arguments: { ticketId: 2 },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Access Denied.*Web/i);
  });

  it('esedre_create_ticket rejects creating ticket in unauthorized project', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'esedre_create_ticket',
        arguments: {
          title: 'Illegitimate Web Feature',
          category: 'Feature',
          project: 'Web',
        },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Access Denied.*Web/i);
  });

  it('esedre_update_ticket rejects modifying tickets belonging to unauthorized projects', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'esedre_update_ticket',
        arguments: {
          ticketId: 2,
          status: 'Completed',
        },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Access Denied.*Web/i);
  });

  it('esedre_save_plan rejects modifying plan of unauthorized tickets', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'esedre_save_plan',
        arguments: {
          ticketId: 2,
          planMarkdown: '# Subversive Plan',
        },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Access Denied.*Web/i);
  });

  it('esedre_add_comment rejects adding notes to unauthorized tickets', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'esedre_add_comment',
        arguments: {
          ticketId: 2,
          text: 'Infiltrator was here.',
        },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Access Denied.*Web/i);
  });

  it('does NOT expose esedre_list_projects in tool definitions', async () => {
    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/list',
    });

    const toolNames = res.result.tools.map((t: any) => t.name);
    expect(toolNames).not.toContain('esedre_list_projects');
  });
});
