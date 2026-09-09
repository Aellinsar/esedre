import readline from 'node:readline';
import { StorageAdapter } from '../storage/adapter.js';
import { TicketType, TicketCategory, TicketStatus, EsedreConflictError } from '../types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class EsedreMcpServer {
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  public start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    // Write diagnostic info strictly to stderr to prevent stdio stream corruption
    process.stderr.write('[Esedre MCP Server] Initialized. Awaiting JSON-RPC messages on stdin...\n');

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req: JsonRpcRequest = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        if (res && req.id !== undefined && req.id !== null) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (err: any) {
        process.stderr.write(`[Esedre MCP Error] Failed to parse or process line: ${err.message}\n`);
        const errorRes: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: ' + err.message },
        };
        process.stdout.write(JSON.stringify(errorRes) + '\n');
      }
    });

    rl.on('close', () => {
      process.stderr.write('[Esedre MCP Server] Stdio closed. Exiting.\n');
      process.exit(0);
    });
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    switch (req.method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: 'esedre',
              version: '0.1.0',
            },
          },
        };
      }

      case 'notifications/initialized': {
        return null;
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getToolDefinitions(),
          },
        };
      }

      case 'tools/call': {
        const toolName = req.params?.name;
        const args = req.params?.arguments || {};
        try {
          const content = await this.executeTool(toolName, args);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                },
              ],
            },
          };
        } catch (err: any) {
          if (err instanceof EsedreConflictError || err.name === 'EsedreConflictError') {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: err.message,
                data: {
                  ticketId: err.ticketId,
                  currentHash: err.currentHash,
                  lastHash: err.lastHash,
                },
              },
            };
          }
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: `Error executing ${toolName}: ${err.message}`,
            },
          };
        }
      }

      case 'resources/list': {
        const tickets = await this.storage.listTickets();
        const resources = tickets.map((t) => ({
          uri: `esedre://tickets/${t.meta.id}`,
          name: `Ticket #${t.meta.id}: ${t.meta.title}`,
          description: `[${t.projectDescriptor?.code || t.meta.project || 'UNASSIGNED'}] ${t.meta.type || (t.meta as any).category} : ${t.meta.status}`,
          mimeType: 'text/markdown',
        }));

        return {
          jsonrpc: '2.0',
          id,
          result: { resources },
        };
      }

      case 'resources/read': {
        const uri = req.params?.uri as string;
        if (!uri) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Resource URI is required' },
          };
        }

        try {
          const match = uri.match(/^esedre:\/\/tickets\/([a-zA-Z0-9_-]+)$/);
          if (match) {
            const ticketId = match[1];
            const ticket = await this.storage.getTicket(ticketId);
            if (!ticket) {
              return {
                jsonrpc: '2.0',
                id,
                error: { code: -32602, message: `Ticket #${ticketId} not found` },
              };
            }

            const markdown = ticket.detail?.raw || `# Ticket #${ticket.meta.id}: ${ticket.meta.title}\n\nStatus: ${ticket.meta.status}`;
            return {
              jsonrpc: '2.0',
              id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: 'text/markdown',
                    text: markdown,
                  },
                ],
              },
            };
          }
        } catch (err: any) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: err.message },
          };
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unsupported URI scheme: ${uri}` },
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${req.method}`,
          },
        };
      }
    }
  }

  private getToolDefinitions(): any[] {
    return [
      {
        name: 'esedre_list_tickets',
        description: 'List roadmap tickets with optional project code, status, category, or search query.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project code (e.g. CORE, WEB, DOCS)' },
            status: { type: 'string', enum: ['Planned', 'In Development', 'Completed', 'Rejected'], description: 'Ticket status' },
            category: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'], description: 'Ticket category' },
            search: { type: 'string', description: 'Search keywords in title or ID' },
          },
        },
      },
      {
        name: 'esedre_get_ticket',
        description: 'Retrieve full details for a ticket including metadata, summary, feature breakdown, open decisions, and comments.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numeric ticket ID (e.g. 96, 101)' },
          },
          required: ['ticketId'],
        },
      },
      {
        name: 'esedre_get_plan',
        description: 'Retrieve the active implementation plan markdown for a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numeric ticket ID' },
          },
          required: ['ticketId'],
        },
      },
      {
        name: 'esedre_save_plan',
        description: 'Save or update the implementation plan markdown for a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numeric ticket ID' },
            planMarkdown: { type: 'string', description: 'Implementation plan markdown content' },
            lastHash: { type: 'string', description: 'Optimistic concurrency control: last known sha1 hash of the ticket' },
          },
          required: ['ticketId', 'planMarkdown'],
        },
      },
      {
        name: 'esedre_create_ticket',
        description: 'Create a new roadmap ticket in Esedre.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Ticket title (max 48 characters)' },
            project: { type: 'string', description: 'Target project code (e.g. CORE, WEB, DOCS)' },
            category: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'], description: 'Ticket category' },
            complexity: { type: 'string', description: 'Complexity (e.g. Low, Medium, High)' },
            effort: { type: 'string', description: 'Estimated effort (e.g. 2.0 – 4.0 hours)' },
            summary: { type: 'string', description: 'Initial feature summary' },
            author: { type: 'string', description: 'Submitting author name' },
          },
          required: ['title', 'category'],
        },
      },
      {
        name: 'esedre_update_ticket',
        description: 'Update an existing ticket state (status, title, active planning flag, or feature flag).',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numeric ticket ID' },
            status: { type: 'string', enum: ['Planned', 'In Development', 'Completed', 'Rejected'] },
            title: { type: 'string', description: 'New title (max 48 characters)' },
            inDevelopment: { type: 'boolean', description: 'Active development toggle' },
            featureFlag: { type: 'string', description: 'Feature flag name' },
            lastHash: { type: 'string', description: 'Optimistic concurrency control: last known sha1 hash of the ticket' },
          },
          required: ['ticketId'],
        },
      },
      {
        name: 'esedre_add_comment',
        description: 'Append a developer or companion agent comment to a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numeric ticket ID' },
            text: { type: 'string', description: 'Comment message' },
            author: { type: 'string', description: 'Author name (e.g. Antigravity, Developer)' },
          },
          required: ['ticketId', 'text'],
        },
      },
    ];
  }

  private async executeTool(name: string, args: any): Promise<any> {
    const canonical = name.replace(/^esedre_/, '');
    switch (canonical) {
      case 'list_tickets': {
        const tickets = await this.storage.listTickets({
          project: args.project,
          status: args.status,
          category: args.category,
          search: args.search,
        });
        return tickets.map((t) => ({
          id: t.meta.id,
          title: t.meta.title,
          category: t.meta.category,
          status: t.meta.status,
          complexity: t.meta.complexity,
          effort: t.meta.estimatedEffort,
          project: t.projectDescriptor?.code || t.meta.project || 'UNASSIGNED',
          sha1: t.sha1 || t.meta.sha1,
        }));
      }

      case 'get_ticket': {
        const id = parseInt(String(args.ticketId), 10);
        const ticket = await this.storage.getTicket(id);
        if (!ticket) throw new Error(`Ticket #${id} not found`);
        return ticket;
      }

      case 'get_plan': {
        const id = parseInt(String(args.ticketId), 10);
        const plan = await this.storage.getPlan(id);
        return { ticketId: id, planMarkdown: plan || null };
      }

      case 'save_plan': {
        const id = parseInt(String(args.ticketId), 10);
        await this.storage.savePlan(id, args.planMarkdown, args.lastHash);
        return { success: true, message: `Implementation plan saved for Ticket #${id}` };
      }

      case 'create_ticket': {
        const created = await this.storage.createTicket({
          title: args.title,
          type: (args.type || args.category) as TicketType,
            category: (args.type || args.category) as TicketType,
          projectCode: args.project,
          complexity: args.complexity,
          estimatedEffort: args.effort,
          summary: args.summary,
          submittedBy: args.author || 'Agent',
        });
        return created;
      }

      case 'update_ticket': {
        const id = parseInt(String(args.ticketId), 10);
        const updates: any = {};
        if (args.status) updates.status = args.status as TicketStatus;
        if (args.title) updates.title = args.title;
        if (args.inDevelopment !== undefined) updates.isActivePlanning = Boolean(args.inDevelopment);
        if (args.featureFlag) updates.featureFlag = args.featureFlag;

        const updated = await this.storage.updateTicket(id, updates, args.lastHash);
        return updated;
      }

      case 'add_comment': {
        const id = parseInt(String(args.ticketId), 10);
        const comment = await this.storage.addComment(id, {
          text: args.text,
          author: args.author || 'Agent',
        });
        return comment;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

