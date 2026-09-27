import readline from 'node:readline';
import { StorageAdapter } from '../storage/adapter.js';
import { TicketType, TicketCategory, TicketStatus, TicketPriority, EsedreConflictError, CURRENT_ESEDRE_VERSION } from '../types.js';

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
              version: CURRENT_ESEDRE_VERSION,
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

  private parseTicketId(val: any): string | number {
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (/^\d+$/.test(str)) {
      return parseInt(str, 10);
    }
    return str;
  }

  private getToolDefinitions(): any[] {
    return [
      {
        name: 'esedre_list_tickets',
        description: 'List roadmap tickets with optional project code, status, type, category, or search query.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project code (e.g. CORE, WEB, DOCS)' },
            status: { type: 'string', enum: ['Planned', 'In Development', 'Completed', 'Rejected'], description: 'Ticket status' },
            type: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'], description: 'Ticket type' },
            category: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'], description: 'Ticket category (legacy alias for type)' },
            priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low', 'none'], description: 'Ticket priority filter' },
            milestone: { type: 'string', description: 'Filter tickets by milestone name or ID' },
            search: { type: 'string', description: 'Search keywords in title or ID' },
            isBlocked: { type: 'boolean', description: 'Filter tickets blocked by uncompleted tickets' },
            linkedTo: { type: 'string', description: 'Filter tickets linked to a specific ticket ID or key' },
          },
        },
      },
      {
        name: 'esedre_get_ticket',
        description: 'Retrieve full details for a ticket including metadata, summary, feature breakdown, open decisions, and comments.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['integer', 'string'], description: 'Numeric ticket ID (e.g. 96, 101) or compound key (e.g. Profe-96)' },
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
            ticketId: { type: ['integer', 'string'], description: 'Numeric ticket ID or compound key' },
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
            ticketId: { type: ['integer', 'string'], description: 'Numeric ticket ID or compound key' },
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
            type: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'], description: 'Ticket type' },
            category: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'], description: 'Ticket category' },
            priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'], description: 'Ticket priority' },
            complexity: { type: 'string', description: 'Complexity (e.g. Low, Medium, High)' },
            effort: { type: 'string', description: 'Estimated effort (e.g. 2.0 - 4.0 hours)' },
            summary: { type: 'string', description: 'Initial feature summary' },
            detail: { type: 'string', description: 'Initial specification, feature breakdown, or technical detail markdown' },
            milestone: { type: 'string', description: 'Assign ticket to milestone' },
            author: { type: 'string', description: 'Submitting author name' },
          },
          required: ['title'],
        },
      },
      {
        name: 'esedre_update_ticket',
        description: 'Update an existing ticket state (status, type, title, complexity, effort, active planning flag, or feature flag).',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['integer', 'string'], description: 'Numeric ticket ID or compound key' },
            status: { type: 'string', enum: ['Planned', 'In Development', 'Completed', 'Rejected'] },
            type: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'] },
            category: { type: 'string', enum: ['Feature', 'Platform', 'Tools', 'Idea', 'Bug'] },
            priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low', 'none'], description: 'Ticket priority (pass none or null to clear)' },
            title: { type: 'string', description: 'New title (max 48 characters)' },
            complexity: { type: 'string', description: 'Complexity (e.g. Low, Medium, High)' },
            effort: { type: 'string', description: 'Estimated effort (e.g. 2.0 - 4.0 hours)' },
            inDevelopment: { type: 'boolean', description: 'Active development toggle' },
            featureFlag: { type: 'string', description: 'Feature flag name' },
            milestone: { type: 'string', description: 'Update ticket milestone ("none" to clear)' },
            lastHash: { type: 'string', description: 'Optimistic concurrency control: last known sha1 hash of the ticket' },
          },
          required: ['ticketId'],
        },
      },
      {
        name: 'esedre_add_comment',
        description: 'Append a developer or LLM agent comment to a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['integer', 'string'], description: 'Numeric ticket ID or compound key' },
            text: { type: 'string', description: 'Comment message' },
            author: { type: 'string', description: 'Author name (e.g. Antigravity, Developer)' },
          },
          required: ['ticketId', 'text'],
        },
      },
      {
        name: 'esedre_list_milestones',
        description: 'List roadmap milestones with optional project filter.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project code (e.g. Esedre, Alce)' },
          },
        },
      },
      {
        name: 'esedre_get_milestone',
        description: 'Retrieve milestone details by ID or title.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: ['integer', 'string'], description: 'Milestone ID or title' },
            project: { type: 'string', description: 'Project code' },
          },
          required: ['id'],
        },
      },
      {
        name: 'esedre_create_milestone',
        description: 'Create a new milestone with optional umbrella feature flag.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Milestone title' },
            project: { type: 'string', description: 'Target project code' },
            description: { type: 'string', description: 'Milestone goal and description' },
            featureFlag: { type: 'string', description: 'Optional umbrella feature flag inherited by member tickets' },
            targetDate: { type: 'string', description: 'Optional target completion date' },
            status: { type: 'string', enum: ['Planned', 'Active', 'Completed', 'Closed'], description: 'Milestone status' },
          },
          required: ['title'],
        },
      },
      {
        name: 'esedre_update_milestone',
        description: 'Update milestone state, umbrella feature flag, status, or target date.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: ['integer', 'string'], description: 'Milestone ID or title' },
            project: { type: 'string', description: 'Project code' },
            title: { type: 'string', description: 'New milestone title' },
            description: { type: 'string', description: 'Milestone goal and description' },
            featureFlag: { type: 'string', description: 'Umbrella feature flag ("none" to clear)' },
            targetDate: { type: 'string', description: 'Target date ("none" to clear)' },
            status: { type: 'string', enum: ['Planned', 'Active', 'Completed', 'Closed'], description: 'Milestone status' },
          },
          required: ['id'],
        },
      },
      {
        name: 'esedre_link_ticket',
        description: 'Establish a bi-directional link between two tickets (within or across projects) with cycle detection.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceTicketId: { type: ['integer', 'string'], description: 'Source ticket ID or compound key' },
            relation: {
              type: 'string',
              enum: ['relates-to', 'blocks', 'blocked-by', 'parent-of', 'child-of', 'duplicates', 'duplicated-by'],
              description: 'Link relation type',
            },
            targetTicketId: { type: ['integer', 'string'], description: 'Target ticket ID or compound key' },
            author: { type: 'string', description: 'Author creating the link' },
            project: { type: 'string', description: 'Project code context for unqualified source ticket ID' },
          },
          required: ['sourceTicketId', 'relation', 'targetTicketId'],
        },
      },
      {
        name: 'esedre_unlink_ticket',
        description: 'Remove a link between two tickets and its reciprocal link.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceTicketId: { type: ['integer', 'string'], description: 'Source ticket ID or compound key' },
            targetTicketId: { type: ['integer', 'string'], description: 'Target ticket ID or compound key' },
            project: { type: 'string', description: 'Project code context for unqualified source ticket ID' },
          },
          required: ['sourceTicketId', 'targetTicketId'],
        },
      },
    ];
  }

  private async executeTool(name: string, args: any): Promise<any> {
    const canonical = name.replace(/^esedre_/, '');
    switch (canonical) {
      case 'list_tickets': {
        const type = (args.type || args.category) as TicketType | undefined;
        const tickets = await this.storage.listTickets({
          project: args.project,
          status: args.status,
          type,
          category: type,
          priority: args.priority,
          milestone: args.milestone,
          search: args.search,
          isBlocked: args.isBlocked !== undefined ? Boolean(args.isBlocked) : undefined,
          linkedTo: args.linkedTo,
        });
        return tickets.map((t) => ({
          id: t.meta.id,
          title: t.meta.title,
          type: t.meta.type || (t.meta as any).category,
          category: t.meta.type || (t.meta as any).category,
          status: t.meta.status,
          priority: t.meta.priority,
          complexity: t.meta.complexity,
          effort: t.meta.estimatedEffort,
          milestone: t.meta.milestone,
          featureFlag: t.meta.featureFlag,
          inheritedFeatureFlag: t.meta.inheritedFeatureFlag,
          project: t.projectDescriptor?.code || t.meta.project || 'UNASSIGNED',
          sha1: t.sha1 || t.meta.sha1,
          isBlocked: t.isBlocked,
          links: t.links,
        }));
      }

      case 'get_ticket': {
        const id = this.parseTicketId(args.ticketId);
        const ticket = await this.storage.getTicket(id);
        if (!ticket) throw new Error(`Ticket #${id} not found`);
        return ticket;
      }

      case 'get_plan': {
        const id = this.parseTicketId(args.ticketId);
        const plan = await this.storage.getPlan(id);
        return { ticketId: id, planMarkdown: plan || null };
      }

      case 'save_plan': {
        const id = this.parseTicketId(args.ticketId);
        await this.storage.savePlan(id, args.planMarkdown, args.lastHash);
        return { success: true, message: `Implementation plan saved for Ticket #${id}` };
      }

      case 'create_ticket': {
        const type = (args.type || args.category || 'Feature') as TicketType;
        const created = await this.storage.createTicket({
          title: args.title,
          type,
          category: type,
          priority: args.priority,
          projectCode: args.project,
          complexity: args.complexity,
          estimatedEffort: args.effort,
          summary: args.summary,
          detail: args.detail || args.detailMarkdown,
          detailMarkdown: args.detailMarkdown || args.detail,
          milestone: args.milestone,
          submittedBy: args.author || 'Agent',
        });
        return created;
      }

      case 'update_ticket': {
        const id = this.parseTicketId(args.ticketId);
        const updates: any = {};
        const type = (args.type || args.category) as TicketType | undefined;
        if (type) {
          updates.type = type;
          updates.category = type;
        }
        if (args.status) updates.status = args.status as TicketStatus;
        if (args.priority !== undefined) updates.priority = args.priority;
        if (args.title) updates.title = args.title;
        if (args.complexity) updates.complexity = args.complexity;
        if (args.effort) updates.estimatedEffort = args.effort;
        if (args.inDevelopment !== undefined) updates.isActivePlanning = Boolean(args.inDevelopment);
        if (args.featureFlag) updates.featureFlag = args.featureFlag;
        if (args.milestone !== undefined) updates.milestone = args.milestone;

        const updated = await this.storage.updateTicket(id, updates, args.lastHash);
        return updated;
      }

      case 'add_comment': {
        const id = this.parseTicketId(args.ticketId);
        const comment = await this.storage.addComment(id, {
          text: args.text,
          author: args.author || 'Agent',
        });
        return comment;
      }

      case 'list_milestones': {
        return this.storage.listMilestones(args.project);
      }

      case 'get_milestone': {
        const m = await this.storage.getMilestone(args.id, args.project);
        if (!m) throw new Error(`Milestone '${args.id}' not found`);
        const tickets = await this.storage.listTickets({ project: args.project || m.project, milestone: String(m.id) });
        return {
          ...m,
          tickets,
        };
      }

      case 'create_milestone': {
        return this.storage.createMilestone({
          title: args.title,
          projectCode: args.project,
          description: args.description,
          featureFlag: args.featureFlag,
          targetDate: args.targetDate,
          status: args.status,
        });
      }

      case 'update_milestone': {
        return this.storage.updateMilestone(args.id, {
          title: args.title,
          description: args.description,
          featureFlag: args.featureFlag,
          targetDate: args.targetDate,
          status: args.status,
        }, args.project);
      }

      case 'link_ticket': {
        const sourceId = this.parseTicketId(args.sourceTicketId);
        const targetId = this.parseTicketId(args.targetTicketId);
        const relation = String(args.relation).toLowerCase().replace(/_/g, '-') as any;
        const result = await this.storage.addTicketLink(sourceId, relation, targetId, {
          author: args.author || 'Agent',
          project: args.project,
        });
        return {
          success: true,
          source: result.source,
          target: result.target,
        };
      }

      case 'unlink_ticket': {
        const sourceId = this.parseTicketId(args.sourceTicketId);
        const targetId = this.parseTicketId(args.targetTicketId);
        const result = await this.storage.removeTicketLink(sourceId, targetId, {
          project: args.project,
        });
        return {
          success: true,
          source: result.source,
          target: result.target,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

