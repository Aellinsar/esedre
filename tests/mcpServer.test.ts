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

  it('preserves existing estimatedEffort without writing literal undefined when effort argument is omitted in esedre_update_ticket (Ticket #82)', async () => {
    await adapter.createTicket({
      title: 'Effort Preservation Target',
      category: 'Feature',
      projectCode: 'Core',
      estimatedEffort: '2.0 - 3.5 hours',
    });

    const updateRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 82,
      method: 'tools/call',
      params: {
        name: 'esedre_update_ticket',
        arguments: {
          ticketId: 1,
          detail: [
            '# Ticket #1: Effort Preservation Target',
            '**Category**: Feature  ',
            '**Complexity**: Medium  ',
            '**Estimated Effort**: 2.0 - 3.5 hours  ',
            '',
            '### Summary',
            'Updated detail without separate effort argument.',
            '',
            '### Feature Breakdown',
            '1. Preserves effort cleanly',
          ].join('\n'),
          includeRaw: true,
        },
      },
    });

    expect(updateRes.result).toBeDefined();
    const updatedTicket = JSON.parse(updateRes.result.content[0].text);
    expect(updatedTicket.meta.id).toBe(1);
    expect(updatedTicket.meta.estimatedEffort).toBe('2.0 - 3.5 hours');
    expect(updatedTicket.detail?.estimatedEffort).toBe('2.0 - 3.5 hours');
    expect(updatedTicket.detail?.raw).not.toContain('undefined');
    expect(updatedTicket.detail?.raw).toContain('**Estimated Effort**: 2.0 - 3.5 hours');
  });

  it('returns hasPlan, summary, and hydrates planMarkdown when includePlan is true in esedre_list_tickets (Ticket #58)', async () => {
    // 1. Create two tickets: one with a plan, one without
    await adapter.createTicket({
      title: 'Ticket With Plan',
      category: 'Feature',
      projectCode: 'Core',
      summary: 'Summary for ticket with plan',
    });
    await adapter.createTicket({
      title: 'Ticket Without Plan',
      category: 'Bug',
      projectCode: 'Core',
      summary: 'Summary for ticket without plan',
    });
    await adapter.savePlan(1, '## Architectural Plan\n- Milestone 1\n- Milestone 2');

    // 2. Query without includePlan
    const defaultListRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'esedre_list_tickets',
        arguments: { project: 'Core' },
      },
    });

    expect(defaultListRes.result).toBeDefined();
    const defaultTickets = JSON.parse(defaultListRes.result.content[0].text);
    expect(defaultTickets).toHaveLength(2);
    const withPlan = defaultTickets.find((t: any) => t.id === 1);
    const withoutPlan = defaultTickets.find((t: any) => t.id === 2);

    expect(withPlan.hasPlan).toBe(true);
    expect(withPlan.summary).toBe('Summary for ticket with plan');
    expect(withPlan.planMarkdown).toBeUndefined();

    expect(withoutPlan.hasPlan).toBe(false);
    expect(withoutPlan.summary).toBe('Summary for ticket without plan');
    expect(withoutPlan.planMarkdown).toBeUndefined();

    // 3. Query with includePlan: true
    const hydratedListRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'esedre_list_tickets',
        arguments: { project: 'Core', includePlan: true },
      },
    });

    expect(hydratedListRes.result).toBeDefined();
    const hydratedTickets = JSON.parse(hydratedListRes.result.content[0].text);
    const hydratedWithPlan = hydratedTickets.find((t: any) => t.id === 1);
    const hydratedWithoutPlan = hydratedTickets.find((t: any) => t.id === 2);

    expect(hydratedWithPlan.hasPlan).toBe(true);
    expect(hydratedWithPlan.planMarkdown).toContain('## Architectural Plan');

    expect(hydratedWithoutPlan.hasPlan).toBe(false);
    expect(hydratedWithoutPlan.planMarkdown).toBeNull();
  });

  describe('Automatic snapshot refresh on mutations', () => {
    let workspaceDir: string;
    let wsAdapter: FilesystemStorageAdapter;
    let wsServer: EsedreMcpServer;

    beforeEach(() => {
      workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-mcp-snapshot-'));
      const ticketsDir = path.join(workspaceDir, 'src', 'data', 'planning', 'tickets');
      fs.mkdirSync(ticketsDir, { recursive: true });

      const projects = [
        { id: 1, code: 'Conquest', name: 'Conquest Game', description: 'Game App' },
      ];
      fs.writeFileSync(
        path.join(workspaceDir, 'src', 'data', 'planning', 'projects.json'),
        JSON.stringify(projects, null, 2)
      );

      const esedreDir = path.join(workspaceDir, '.esedre');
      fs.mkdirSync(esedreDir, { recursive: true });
      fs.writeFileSync(
        path.join(esedreDir, 'esedre.json'),
        JSON.stringify({ projectCode: 'Conquest' }, null, 2)
      );

      wsAdapter = new FilesystemStorageAdapter(workspaceDir);
      wsServer = new EsedreMcpServer(wsAdapter, {
        workspaceRoot: workspaceDir,
        projectCode: 'Conquest',
        config: { projectCode: 'Conquest' },
      });
    });

    afterEach(() => {
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    it('automatically generates .esedre/snapshot.json on esedre_create_ticket', async () => {
      const snapshotPath = path.join(workspaceDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(snapshotPath)).toBe(false);

      const res = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Implement battle arena',
            project: 'Conquest',
            summary: 'Battle arena mechanics',
          },
        },
      });

      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();

      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.projectCode).toBe('Conquest');
      expect(snapshot.totalTickets).toBe(1);
      expect(snapshot.tickets[0].title).toBe('Implement battle arena');
      expect(snapshot.tickets[0].hasPlan).toBe(false);
    });

    it('automatically updates snapshot.json on esedre_save_plan and esedre_update_ticket', async () => {
      const snapshotPath = path.join(workspaceDir, '.esedre', 'snapshot.json');

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Implement save system',
            project: 'Conquest',
          },
        },
      });

      const planRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/call',
        params: {
          name: 'esedre_save_plan',
          arguments: {
            ticketId: 1,
            planMarkdown: '## Architecture\n- Use SQLite serialization',
          },
        },
      });
      expect(planRes.error).toBeUndefined();

      let snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.tickets[0].hasPlan).toBe(true);
      expect(snapshot.tickets[0].planMarkdown).toContain('SQLite serialization');

      const updateRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 104,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: 1,
            status: 'In Development',
            priority: 'High',
          },
        },
      });
      expect(updateRes.error).toBeUndefined();

      snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.tickets[0].status).toBe('In Development');
      expect(snapshot.tickets[0].priority).toBe('High');
    });

    it('automatically updates snapshot.json on lease claim and release', async () => {
      const snapshotPath = path.join(workspaceDir, '.esedre', 'snapshot.json');

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 105,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Multiplayer lobby',
            project: 'Conquest',
          },
        },
      });

      const claimRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 106,
        method: 'tools/call',
        params: {
          name: 'esedre_claim_ticket',
          arguments: {
            ticketId: 1,
            holder: 'agent-151',
            ttlMinutes: 30,
          },
        },
      });
      expect(claimRes.error).toBeUndefined();

      let snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.activeLeases).toBeDefined();
      expect(snapshot.activeLeases.length).toBe(1);
      expect(snapshot.activeLeases[0].holder).toBe('agent-151');
      expect(snapshot.tickets[0].lease?.holder).toBe('agent-151');

      const releaseRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 107,
        method: 'tools/call',
        params: {
          name: 'esedre_release_ticket',
          arguments: {
            ticketId: 1,
            holder: 'agent-151',
          },
        },
      });
      expect(releaseRes.error).toBeUndefined();

      snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.activeLeases).toBeUndefined();
      expect(snapshot.tickets[0].lease).toBeUndefined();
    });

    it('automatically updates snapshot.json on link_ticket and unlink_ticket', async () => {
      const snapshotPath = path.join(workspaceDir, '.esedre', 'snapshot.json');

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 108,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Base Ticket',
            project: 'Conquest',
          },
        },
      });

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 109,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Dependent Ticket',
            project: 'Conquest',
          },
        },
      });

      const linkRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 110,
        method: 'tools/call',
        params: {
          name: 'esedre_link_ticket',
          arguments: {
            sourceTicketId: 1,
            relation: 'blocks',
            targetTicketId: 2,
          },
        },
      });
      expect(linkRes.error).toBeUndefined();

      let snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      const t1 = snapshot.tickets.find((t: any) => t.id === 1);
      const t2 = snapshot.tickets.find((t: any) => t.id === 2);
      expect(t1.links.length).toBe(1);
      expect(t1.links[0].relation).toBe('blocks');
      expect(t2.links.length).toBe(1);
      expect(t2.links[0].relation).toBe('blocked-by');
      expect(t2.isBlocked).toBe(true);

      const unlinkRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 111,
        method: 'tools/call',
        params: {
          name: 'esedre_unlink_ticket',
          arguments: {
            sourceTicketId: 1,
            targetTicketId: 2,
          },
        },
      });
      expect(unlinkRes.error).toBeUndefined();

      snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      const t1After = snapshot.tickets.find((t: any) => t.id === 1);
      const t2After = snapshot.tickets.find((t: any) => t.id === 2);
      expect(t1After.links.length).toBe(0);
      expect(t2After.links.length).toBe(0);
      expect(t2After.isBlocked).toBe(false);
    });

    it('safely handles snapshot errors without breaking tool response', async () => {
      const esedreDir = path.join(workspaceDir, '.esedre');
      const snapshotPath = path.join(esedreDir, 'snapshot.json');
      // Create snapshot.json as a directory so file writing fails
      fs.mkdirSync(snapshotPath, { recursive: true });

      const res = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 112,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Resilient ticket',
            project: 'Conquest',
          },
        },
      });

      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();
      expect(res.result.content[0].text).toContain('Resilient ticket');
    });

    it('returns compact confirmation payload for link_ticket and unlink_ticket', async () => {
      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 198,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: { title: 'Ticket A', project: 'Conquest' },
        },
      });
      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 199,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: { title: 'Ticket B', project: 'Conquest' },
        },
      });

      const linkRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 200,
        method: 'tools/call',
        params: {
          name: 'esedre_link_ticket',
          arguments: {
            sourceTicketId: 1,
            relation: 'blocks',
            targetTicketId: 2,
            project: 'Conquest',
          },
        },
      });

      expect(linkRes.error).toBeUndefined();
      const linkPayload = JSON.parse(linkRes.result.content[0].text);
      expect(linkPayload.success).toBe(true);
      expect(linkPayload.sourceKey).toBe('Conquest-1');
      expect(linkPayload.relation).toBe('blocks');
      expect(linkPayload.targetKey).toBe('Conquest-2');
      expect(typeof linkPayload.sourceRevision).toBe('number');
      expect(Array.isArray(linkPayload.links)).toBe(true);
      expect(linkPayload.links.length).toBe(1);
      // Ensure massive hydrated source/target objects are omitted
      expect((linkPayload as any).source).toBeUndefined();
      expect((linkPayload as any).target).toBeUndefined();

      const unlinkRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 201,
        method: 'tools/call',
        params: {
          name: 'esedre_unlink_ticket',
          arguments: {
            sourceTicketId: 1,
            targetTicketId: 2,
            project: 'Conquest',
          },
        },
      });

      expect(unlinkRes.error).toBeUndefined();
      const unlinkPayload = JSON.parse(unlinkRes.result.content[0].text);
      expect(unlinkPayload.success).toBe(true);
      expect(unlinkPayload.sourceKey).toBe('Conquest-1');
      expect(unlinkPayload.targetKey).toBe('Conquest-2');
      expect(typeof unlinkPayload.sourceRevision).toBe('number');
      expect(Array.isArray(unlinkPayload.links)).toBe(true);
      expect(unlinkPayload.links.length).toBe(0);
      expect((unlinkPayload as any).source).toBeUndefined();
      expect((unlinkPayload as any).target).toBeUndefined();
    });

    it('omits detail.raw by default in create_ticket and update_ticket unless includeRaw is true', async () => {
      // 1. Create ticket without includeRaw
      const createCleanRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 202,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Clean detail ticket',
            project: 'Conquest',
            summary: 'Clean summary',
            detail: '### Summary\nClean summary\n\n### Technical Details\n- Clean item',
          },
        },
      });

      expect(createCleanRes.error).toBeUndefined();
      const cleanCreated = JSON.parse(createCleanRes.result.content[0].text);
      expect(cleanCreated.detail).toBeDefined();
      expect(cleanCreated.detail.summary).toBe('Clean summary');
      expect(cleanCreated.detail.technicalDetails).toContain('Clean item');
      expect(cleanCreated.detail.raw).toBeUndefined();

      // 2. Create ticket with includeRaw: true
      const createRawRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 203,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Raw detail ticket',
            project: 'Conquest',
            summary: 'Raw summary',
            detail: '### Summary\nRaw summary\n\n### Technical Details\n- Raw item',
            includeRaw: true,
          },
        },
      });

      expect(createRawRes.error).toBeUndefined();
      const rawCreated = JSON.parse(createRawRes.result.content[0].text);
      expect(rawCreated.detail).toBeDefined();
      expect(rawCreated.detail.raw).toBeDefined();
      expect(rawCreated.detail.raw).toContain('Raw item');

      // 3. Update ticket without includeRaw
      const updateCleanRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 204,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: cleanCreated.meta.id,
            project: 'Conquest',
            detail: '### Summary\nUpdated clean summary\n\n### Technical Details\n- Updated item',
          },
        },
      });

      expect(updateCleanRes.error).toBeUndefined();
      const cleanUpdated = JSON.parse(updateCleanRes.result.content[0].text);
      expect(cleanUpdated.detail.summary).toBe('Updated clean summary');
      expect(cleanUpdated.detail.raw).toBeUndefined();

      // 4. Update ticket with includeRaw: true
      const updateRawRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 205,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: cleanCreated.meta.id,
            project: 'Conquest',
            detail: '### Summary\nUpdated raw summary\n\n### Technical Details\n- Updated raw item',
            includeRaw: true,
          },
        },
      });

      expect(updateRawRes.error).toBeUndefined();
      const rawUpdated = JSON.parse(updateRawRes.result.content[0].text);
      expect(rawUpdated.detail.raw).toBeDefined();
      expect(rawUpdated.detail.raw).toContain('Updated raw item');
    });

    it('serializes concurrent parallel tool batches without deadlock or race conditions', async () => {
      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 298,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: { title: 'Batch Ticket A', project: 'Conquest' },
        },
      });
      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 299,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: { title: 'Batch Ticket B', project: 'Conquest' },
        },
      });

      // Concurrently invoke link_ticket and save_plan on the same ticket
      const [linkRes, planRes] = await Promise.all([
        callRpc(wsServer, {
          jsonrpc: '2.0',
          id: 300,
          method: 'tools/call',
          params: {
            name: 'esedre_link_ticket',
            arguments: {
              sourceTicketId: 1,
              relation: 'relates-to',
              targetTicketId: 2,
              project: 'Conquest',
            },
          },
        }),
        callRpc(wsServer, {
          jsonrpc: '2.0',
          id: 301,
          method: 'tools/call',
          params: {
            name: 'esedre_save_plan',
            arguments: {
              ticketId: 1,
              project: 'Conquest',
              planMarkdown: '## Parallel Plan Execution\n- Verified serial batching\n- No lock contention',
            },
          },
        }),
      ]);

      expect(linkRes.error).toBeUndefined();
      expect(planRes.error).toBeUndefined();

      const linkData = JSON.parse(linkRes.result.content[0].text);
      const planData = JSON.parse(planRes.result.content[0].text);
      expect(linkData.success).toBe(true);
      expect(planData.success).toBe(true);

      // Verify both mutations persisted cleanly
      const t1 = await wsAdapter.getTicket('Conquest-1');
      expect(t1?.links?.some((l: any) => l.targetId === 2)).toBe(true);
      const plan = await wsAdapter.getPlan('Conquest-1');
      expect(plan).toContain('Verified serial batching');

      // Verify snapshot was generated cleanly without file corruption
      const snapshotPath = path.join(workspaceDir, '.esedre', 'snapshot.json');
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      const snapTicket = snapshot.tickets.find((t: any) => t.id === 1);
      expect(snapTicket).toBeDefined();
      expect(snapTicket!.links.length).toBeGreaterThanOrEqual(1);
    });

    it('creates and updates ticket with implementation plan atomically via esedre_create_ticket and esedre_update_ticket (Ticket #80)', async () => {
      const snapshotPath = path.join(workspaceDir, '.esedre', 'snapshot.json');

      // 1. Create ticket with planMarkdown in one single call
      const createRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 400,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Ticket with Atomic MCP Plan',
            project: 'Conquest',
            summary: 'Single-call creation and planning',
            planMarkdown: '## MCP Architecture Plan\n- Milestone 1\n- Milestone 2',
          },
        },
      });

      expect(createRes.error).toBeUndefined();
      const created = JSON.parse(createRes.result.content[0].text);
      const ticketId = created.meta.id;

      // Verify plan is immediately available via esedre_get_plan
      const getPlanRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 401,
        method: 'tools/call',
        params: {
          name: 'esedre_get_plan',
          arguments: { ticketId, project: 'Conquest' },
        },
      });

      expect(getPlanRes.error).toBeUndefined();
      const planPayload = JSON.parse(getPlanRes.result.content[0].text);
      expect(planPayload.planMarkdown).toContain('## MCP Architecture Plan');
      expect(planPayload.planMarkdown).toContain('Milestone 1');

      // Verify snapshot has hasPlan: true
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      const snapTicket = snapshot.tickets.find((t: any) => t.id === ticketId);
      expect(snapTicket).toBeDefined();
      expect(snapTicket.hasPlan).toBe(true);
      expect(snapTicket.planMarkdown).toContain('## MCP Architecture Plan');

      // 2. Update ticket and plan simultaneously in one call
      const updateRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 402,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId,
            project: 'Conquest',
            status: 'In Development',
            planMarkdown: '## Updated MCP Architecture Plan\n- Milestone 1 Completed\n- Milestone 2 In Progress',
          },
        },
      });

      expect(updateRes.error).toBeUndefined();
      const updated = JSON.parse(updateRes.result.content[0].text);
      expect(updated.meta.status).toBe('In Development');

      // Verify updated plan via esedre_get_plan
      const getUpdatedPlanRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 403,
        method: 'tools/call',
        params: {
          name: 'esedre_get_plan',
          arguments: { ticketId, project: 'Conquest' },
        },
      });

      expect(getUpdatedPlanRes.error).toBeUndefined();
      const updatedPlanPayload = JSON.parse(getUpdatedPlanRes.result.content[0].text);
      expect(updatedPlanPayload.planMarkdown).toContain('Milestone 1 Completed');

      // Verify snapshot updated
      const updatedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      const updatedSnapTicket = updatedSnapshot.tickets.find((t: any) => t.id === ticketId);
      expect(updatedSnapTicket.status).toBe('In Development');
      expect(updatedSnapTicket.planMarkdown).toContain('Milestone 1 Completed');
    });

    it('validates plan parameters and supports plan alias in esedre_save_plan (Ticket #81)', async () => {
      // 1. Create a ticket
      const createRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 500,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Ticket for Plan Alias Testing',
            project: 'Conquest',
          },
        },
      });
      const ticketId = JSON.parse(createRes.result.content[0].text).meta.id;

      // 2. Call esedre_save_plan with 'plan' instead of 'planMarkdown'
      const saveWithAliasRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 501,
        method: 'tools/call',
        params: {
          name: 'esedre_save_plan',
          arguments: {
            ticketId,
            project: 'Conquest',
            plan: '## Alias Plan Content\n- Point A\n- Point B',
          },
        },
      });

      expect(saveWithAliasRes.error).toBeUndefined();
      const saveAliasResult = JSON.parse(saveWithAliasRes.result.content[0].text);
      expect(saveAliasResult.success).toBe(true);

      // Verify the plan was saved via get_plan
      const getPlanRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 502,
        method: 'tools/call',
        params: {
          name: 'esedre_get_plan',
          arguments: { ticketId, project: 'Conquest' },
        },
      });
      const planData = JSON.parse(getPlanRes.result.content[0].text);
      expect(planData.planMarkdown).toContain('## Alias Plan Content');

      // 3. Call esedre_save_plan with neither planMarkdown nor plan
      const saveMissingRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 503,
        method: 'tools/call',
        params: {
          name: 'esedre_save_plan',
          arguments: {
            ticketId,
            project: 'Conquest',
          },
        },
      });
      expect(saveMissingRes.error).toBeDefined();
      expect(saveMissingRes.error.message).toContain("Plan markdown content is required (pass 'planMarkdown' or 'plan')");

      // 4. Call esedre_save_plan without ticketId
      const saveMissingIdRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 504,
        method: 'tools/call',
        params: {
          name: 'esedre_save_plan',
          arguments: {
            planMarkdown: '## Some content',
          },
        },
      });
      expect(saveMissingIdRes.error).toBeDefined();
      expect(saveMissingIdRes.error.message).toContain('Ticket ID is required');
    });

    it('deduplicates meta.links, meta.lease, and projectDescriptor.colors and supports lossless-aware includeRaw on esedre_get_ticket (Ticket #91)', async () => {
      // 1. Create two standard-template tickets and link them
      const create1Res = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 600,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Standard Template Ticket',
            project: 'Conquest',
            summary: 'Standard summary text.',
            detail: [
              '### Summary',
              'Standard summary text.',
              '',
              '### Feature Breakdown',
              '- **First Item**: First breakdown item.',
              '- **Second Item**: Second breakdown item.',
              '',
              '### Technical Details',
              '- **Architecture**: Clean modular design.',
            ].join('\n'),
          },
        },
      });
      const created1 = JSON.parse(create1Res.result.content[0].text);
      expect(created1.projectDescriptor?.colors).toBeUndefined();

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 601,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Linked Target Ticket',
            project: 'Conquest',
          },
        },
      });

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 602,
        method: 'tools/call',
        params: {
          name: 'esedre_link_ticket',
          arguments: {
            sourceTicketId: 1,
            relation: 'relates-to',
            targetTicketId: 2,
            project: 'Conquest',
          },
        },
      });

      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 603,
        method: 'tools/call',
        params: {
          name: 'esedre_claim_ticket',
          arguments: {
            ticketId: 1,
            project: 'Conquest',
            holder: 'agent-91',
          },
        },
      });

      // 2. Get standard ticket without includeRaw -> omits detail.raw, meta.links, meta.lease, projectDescriptor.colors
      const getStandardRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 604,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: 1, project: 'Conquest' },
        },
      });
      expect(getStandardRes.error).toBeUndefined();
      const standardFetched = JSON.parse(getStandardRes.result.content[0].text);
      expect(standardFetched.detail.summary).toBe('Standard summary text.');
      expect(standardFetched.detail.breakdown).toHaveLength(2);
      expect(standardFetched.detail.technicalDetails).toHaveLength(1);
      expect(standardFetched.detail.raw).toBeUndefined();
      // Top-level enriched links and lease are present, while duplicate meta.links and meta.lease are omitted
      expect(standardFetched.links).toHaveLength(1);
      expect(standardFetched.links[0].targetKey).toBe('Conquest-2');
      expect(standardFetched.links[0].targetTitle).toBe('Linked Target Ticket');
      expect(standardFetched.meta.links).toBeUndefined();
      expect(standardFetched.lease?.holder).toBe('agent-91');
      expect(standardFetched.meta.lease).toBeUndefined();
      expect(standardFetched.projectDescriptor?.colors).toBeUndefined();

      // Verify underlying storage adapter cache still retains meta.links intact
      const directFromStorage = await wsAdapter.getTicket('Conquest-1');
      expect(directFromStorage?.meta.links).toHaveLength(1);

      // 3. Get standard ticket with includeRaw: true -> includes detail.raw
      const getStandardRawRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 605,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: 1, project: 'Conquest', includeRaw: true },
        },
      });
      const standardWithRaw = JSON.parse(getStandardRawRes.result.content[0].text);
      expect(standardWithRaw.detail.raw).toBeDefined();
      expect(standardWithRaw.detail.raw).toContain('### Feature Breakdown');

      // 4. Update ticket with custom non-standard Markdown headings (like Esedre-84)
      await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 606,
        method: 'tools/call',
        params: {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: 2,
            project: 'Conquest',
            detail: [
              '# Ticket #2: Custom Freeform Spec',
              '**Category**: Bug  ',
              '**Complexity**: Medium  ',
              '**Estimated Effort**: 2.0 - 4.0 hours  ',
              '',
              '### Summary',
              'Summary for custom heading ticket.',
              '',
              '## Overview',
              'Custom overview prose not captured by standard breakdown arrays.',
              '',
              '## Root Cause & Defects',
              '1. Custom root cause item.',
            ].join('\n'),
          },
        },
      });

      // 5. Get custom ticket without includeRaw -> automatically preserves detail.raw to prevent data loss
      const getCustomRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 607,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: 2, project: 'Conquest' },
        },
      });
      const customFetched = JSON.parse(getCustomRes.result.content[0].text);
      expect(customFetched.detail.breakdown).toEqual([]);
      expect(customFetched.detail.raw).toBeDefined();
      expect(customFetched.detail.raw).toContain('## Overview');
      expect(customFetched.detail.raw).toContain('## Root Cause & Defects');
      expect(customFetched.meta.links).toBeUndefined();
      expect(customFetched.links).toHaveLength(1);

      // 6. Get custom ticket with explicit includeRaw: false -> honors explicit false override
      const getCustomNoRawRes = await callRpc(wsServer, {
        jsonrpc: '2.0',
        id: 608,
        method: 'tools/call',
        params: {
          name: 'esedre_get_ticket',
          arguments: { ticketId: 2, project: 'Conquest', includeRaw: false },
        },
      });
      const customNoRaw = JSON.parse(getCustomNoRawRes.result.content[0].text);
      expect(customNoRaw.detail.raw).toBeUndefined();
    });
  });
});



