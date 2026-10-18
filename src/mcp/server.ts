import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { StorageAdapter } from '../storage/adapter.js';
import { TicketType, TicketCategory, TicketStatus, TicketPriority, EsedreConflictError, EsedreLeaseConflictError, CURRENT_ESEDRE_VERSION } from '../types.js';
import { EsedreVersionError } from '../migrations/index.js';
import { resolveWorkerIdentity } from '../utils/identity.js';
import { generateProjectSnapshot } from '../snapshot.js';
import { findEsedreConfig, readGlobalConfig, expandHome, EsedreConfig } from '../config.js';

export interface EsedreMcpServerOptions {
  workspaceRoot?: string;
  projectCode?: string;
  config?: EsedreConfig | null;
}

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
  private options: EsedreMcpServerOptions;
  private requestQueue: Promise<void> = Promise.resolve();
  private snapshotLocks = new Map<string, Promise<void>>();

  constructor(storage: StorageAdapter, options: EsedreMcpServerOptions = {}) {
    this.storage = storage;
    this.options = options;
  }

  public start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    // Write diagnostic info strictly to stderr to prevent stdio stream corruption
    process.stderr.write('[Esedre MCP Server] Initialized. Awaiting JSON-RPC messages on stdin...\n');

    let writeQueue: Promise<void> = Promise.resolve();

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      writeQueue = writeQueue.then(async () => {
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
      }).catch((err: any) => {
        process.stderr.write(`[Esedre MCP Error] Unexpected queue error: ${err.message}\n`);
      });
    });

    rl.on('close', () => {
      process.stderr.write('[Esedre MCP Server] Stdio closed. Exiting.\n');
      process.exit(0);
    });
  }

  public async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const run = async (): Promise<JsonRpcResponse | null> => {
      return this.dispatchRequest(req);
    };
    const resPromise = this.requestQueue.then(run, run);
    this.requestQueue = resPromise.then(() => {}, () => {});
    return resPromise;
  }

  private async dispatchRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
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
          if (err instanceof EsedreLeaseConflictError || err.name === 'EsedreLeaseConflictError') {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32001,
                message: err.message,
                data: {
                  ticketKey: err.ticketKey,
                  activeLease: err.activeLease,
                },
              },
            };
          }
          if (err instanceof EsedreVersionError || err.name === 'EsedreVersionError') {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32002,
                message: err.message,
                data: {
                  projectCode: err.projectCode,
                  currentSchemaVersion: err.currentSchemaVersion,
                  requiredSchemaVersion: err.requiredSchemaVersion,
                  reason: err.reason,
                  featureName: err.featureName,
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

  private parseTicketId(val: any, paramName = 'Ticket ID', project?: string): string | number {
    if (val === undefined || val === null || val === '') {
      throw new Error(`${paramName} is required`);
    }
    const cleanProject = typeof project === 'string' && project.trim() && project.trim().toLowerCase() !== 'all'
      ? project.trim()
      : undefined;
    if (typeof val === 'number') {
      return cleanProject ? `${cleanProject}-${val}` : val;
    }
    const str = String(val).trim();
    if (!str || str === 'undefined' || str === 'null') {
      throw new Error(`${paramName} is required`);
    }
    if (/^\d+$/.test(str)) {
      const num = parseInt(str, 10);
      return cleanProject ? `${cleanProject}-${num}` : num;
    }
    return str;
  }

  private async resolveTargetDirsForProject(projectCode: string): Promise<string[]> {
    const targetDirs: string[] = [];
    const normalizedCode = projectCode.trim().toLowerCase();

    // 1. Resolve active workspace root
    let activeWorkspaceRoot = this.options.workspaceRoot;
    let activeConfig = this.options.config;

    if (!activeWorkspaceRoot && this.storage.getWorkspaceRoot) {
      activeWorkspaceRoot = this.storage.getWorkspaceRoot();
    }

    if (!activeWorkspaceRoot) {
      try {
        const discovered = findEsedreConfig(process.cwd(), { fallbackToGlobal: true });
        activeWorkspaceRoot = discovered.workspaceRoot;
        activeConfig = activeConfig || discovered.config;
      } catch {}
    }

    if (!activeWorkspaceRoot) {
      activeWorkspaceRoot = process.cwd();
    }

    // Determine if active workspace corresponds to this projectCode
    let matchesActive = false;
    const configuredProjectCode = this.options.projectCode || activeConfig?.projectCode;

    if (configuredProjectCode) {
      if (configuredProjectCode.trim().toLowerCase() === normalizedCode) {
        matchesActive = true;
      }
    } else {
      // No explicit projectCode configured for this workspace.
      // Check if an existing snapshot in this workspace is for this project
      const activeSnapshotPath = path.join(activeWorkspaceRoot, '.esedre', 'snapshot.json');
      if (fs.existsSync(activeSnapshotPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(activeSnapshotPath, 'utf-8'));
          if (raw.projectCode && raw.projectCode.trim().toLowerCase() === normalizedCode) {
            matchesActive = true;
          }
        } catch {}
      } else {
        // If no snapshot exists yet, check if workspace has .esedre or is an initialized project repo
        const hasEsedreDir = fs.existsSync(path.join(activeWorkspaceRoot, '.esedre'));
        if (hasEsedreDir) {
          try {
            const projects = await this.storage.getProjects();
            if (projects.length === 1 && projects[0].code.trim().toLowerCase() === normalizedCode) {
              matchesActive = true;
            }
          } catch {}
        }
      }
    }

    if (matchesActive) {
      targetDirs.push(activeWorkspaceRoot);
    }

    // 2. Check globally registered project repos in ~/.esedre/config.json
    try {
      const globalConfig = readGlobalConfig();
      if (globalConfig?.projects) {
        for (const [codeKey, repoPath] of Object.entries(globalConfig.projects)) {
          if (codeKey.trim().toLowerCase() === normalizedCode && typeof repoPath === 'string') {
            const resolvedPath = path.resolve(expandHome(repoPath));
            if (fs.existsSync(resolvedPath)) {
              targetDirs.push(resolvedPath);
            }
          }
        }
      }
    } catch {}

    // Deduplicate normalized directories
    const uniqueDirs: string[] = [];
    const seen = new Set<string>();
    for (const dir of targetDirs) {
      const normalizedDir = path.resolve(dir).toLowerCase();
      if (!seen.has(normalizedDir)) {
        seen.add(normalizedDir);
        uniqueDirs.push(path.resolve(dir));
      }
    }

    return uniqueDirs;
  }

  private async refreshProjectSnapshots(projectCodes: (string | undefined | null)[]): Promise<void> {
    const rawCodes = projectCodes.filter((c): c is string => Boolean(c && typeof c === 'string' && c.trim().length > 0));
    if (rawCodes.length === 0) return;

    // Deduplicate project codes (case-insensitive)
    const uniqueCodes: string[] = [];
    const seenCodes = new Set<string>();
    for (const code of rawCodes) {
      const lower = code.trim().toLowerCase();
      if (!seenCodes.has(lower)) {
        seenCodes.add(lower);
        uniqueCodes.push(code.trim());
      }
    }

    for (const code of uniqueCodes) {
      try {
        const targetDirs = await this.resolveTargetDirsForProject(code);
        for (const targetDir of targetDirs) {
          const lockKey = path.resolve(targetDir).toLowerCase();
          const currentLock = this.snapshotLocks.get(lockKey) || Promise.resolve();
          const nextLock = currentLock.then(async () => {
            try {
              await generateProjectSnapshot(this.storage, code, targetDir);
              process.stderr.write(`[Esedre MCP] Refreshed snapshot for project '${code}' at ${path.join(targetDir, '.esedre', 'snapshot.json')}\n`);
            } catch (err: any) {
              process.stderr.write(`[Esedre MCP] Failed to refresh snapshot for project '${code}' in '${targetDir}': ${err.message}\n`);
            }
          }).catch(() => {});
          this.snapshotLocks.set(lockKey, nextLock);
          await nextLock;
        }
      } catch (err: any) {
        process.stderr.write(`[Esedre MCP] Error resolving target directories for project '${code}': ${err.message}\n`);
      }
    }
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
            includePlan: { type: 'boolean', description: 'When true, includes implementation plan markdown (planMarkdown) for each ticket' },
          },
        },
      },
      {
        name: 'esedre_get_ticket',
        description: 'Retrieve full details for a ticket including metadata, summary, feature breakdown, open decisions, and comments.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Numeric ticket ID (e.g. 96, 101) or compound key (e.g. Profe-96)' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: numeric ticket ID or compound key' },
            project: { type: 'string', description: 'Optional project code when numeric ticketId is used' },
          },
        },
      },
      {
        name: 'esedre_get_plan',
        description: 'Retrieve the active implementation plan markdown for a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Numeric ticket ID or compound key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: numeric ticket ID or compound key' },
            project: { type: 'string', description: 'Optional project code when numeric ticketId is used' },
          },
        },
      },
      {
        name: 'esedre_save_plan',
        description: 'Save or update the implementation plan markdown for a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Numeric ticket ID or compound key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: numeric ticket ID or compound key' },
            project: { type: 'string', description: 'Optional project code when numeric ticketId is used' },
            planMarkdown: { type: 'string', description: 'Implementation plan markdown content' },
            plan: { type: 'string', description: 'Alias for planMarkdown: Implementation plan markdown content' },
            lastHash: { type: 'string', description: 'Optimistic concurrency control: last known sha1 hash of the ticket' },
          },
        },
      },
      {
        name: 'esedre_create_ticket',
        description: 'Create a new roadmap ticket in Esedre with optional implementation plan.',
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
            plan: { type: 'string', description: 'Initial implementation plan markdown content' },
            planMarkdown: { type: 'string', description: 'Initial implementation plan markdown content (alias for plan)' },
            milestone: { type: 'string', description: 'Assign ticket to milestone' },
            author: { type: 'string', description: 'Submitting author name' },
            includeRaw: { type: 'boolean', description: 'When true, includes raw unparsed markdown in ticket.detail.raw' },
          },
          required: ['title'],
        },
      },
      {
        name: 'esedre_update_ticket',
        description: 'Update an existing ticket state (status, type, title, complexity, effort, active planning flag, feature flag, detail, or plan).',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Numeric ticket ID or compound key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: numeric ticket ID or compound key' },
            project: { type: 'string', description: 'Optional project code when numeric ticketId is used' },
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
            detail: { type: 'string', description: 'Updated specification markdown for ticket detail' },
            detailMarkdown: { type: 'string', description: 'Updated specification markdown for ticket detail' },
            plan: { type: 'string', description: 'Updated implementation plan markdown content' },
            planMarkdown: { type: 'string', description: 'Updated implementation plan markdown content (alias for plan)' },
            includeRaw: { type: 'boolean', description: 'When true, includes raw unparsed markdown in ticket.detail.raw' },
            lastHash: { type: 'string', description: 'Optimistic concurrency control: last known sha1 hash of the ticket' },
          },
        },
      },
      {
        name: 'esedre_add_comment',
        description: 'Append a developer or LLM agent comment to a ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Numeric ticket ID or compound key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: numeric ticket ID or compound key' },
            project: { type: 'string', description: 'Optional project code when numeric ticketId is used' },
            text: { type: 'string', description: 'Comment message' },
            file: { type: 'string', description: 'Path to local file containing comment message markdown' },
            author: { type: 'string', description: 'Author name (e.g. Antigravity, Developer)' },
          },
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
            id: { type: ['number', 'integer', 'string'], description: 'Milestone ID or title' },
            milestoneId: { type: ['number', 'integer', 'string'], description: 'Alias for id: Milestone ID or title' },
            project: { type: 'string', description: 'Project code' },
          },
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
            id: { type: ['number', 'integer', 'string'], description: 'Milestone ID or title' },
            milestoneId: { type: ['number', 'integer', 'string'], description: 'Alias for id: Milestone ID or title' },
            project: { type: 'string', description: 'Project code' },
            title: { type: 'string', description: 'New milestone title' },
            description: { type: 'string', description: 'Milestone goal and description' },
            featureFlag: { type: 'string', description: 'Umbrella feature flag ("none" to clear)' },
            targetDate: { type: 'string', description: 'Target date ("none" to clear)' },
            status: { type: 'string', enum: ['Planned', 'Active', 'Completed', 'Closed'], description: 'Milestone status' },
          },
        },
      },
      {
        name: 'esedre_link_ticket',
        description: 'Establish a bi-directional link between two tickets (within or across projects) with cycle detection. Returns a compact confirmation payload.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceTicketId: { type: ['number', 'integer', 'string'], description: 'Source ticket ID or compound key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for sourceTicketId: source ticket ID or compound key' },
            sourceId: { type: ['number', 'integer', 'string'], description: 'Alias for sourceTicketId: source ticket ID or compound key' },
            ticketId: { type: ['number', 'integer', 'string'], description: 'Alias for sourceTicketId: source ticket ID or compound key' },
            relation: {
              type: 'string',
              enum: ['relates-to', 'blocks', 'blocked-by', 'parent-of', 'child-of', 'duplicates', 'duplicated-by'],
              description: 'Link relation type',
            },
            targetTicketId: { type: ['number', 'integer', 'string'], description: 'Target ticket ID or compound key' },
            targetId: { type: ['number', 'integer', 'string'], description: 'Alias for targetTicketId: target ticket ID or compound key' },
            author: { type: 'string', description: 'Author creating the link' },
            project: { type: 'string', description: 'Project code context for unqualified ticket IDs' },
          },
        },
      },
      {
        name: 'esedre_unlink_ticket',
        description: 'Remove a link between two tickets and its reciprocal link. Returns a compact confirmation payload.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceTicketId: { type: ['number', 'integer', 'string'], description: 'Source ticket ID or compound key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for sourceTicketId: source ticket ID or compound key' },
            sourceId: { type: ['number', 'integer', 'string'], description: 'Alias for sourceTicketId: source ticket ID or compound key' },
            ticketId: { type: ['number', 'integer', 'string'], description: 'Alias for sourceTicketId: source ticket ID or compound key' },
            targetTicketId: { type: ['number', 'integer', 'string'], description: 'Target ticket ID or compound key' },
            targetId: { type: ['number', 'integer', 'string'], description: 'Alias for targetTicketId: target ticket ID or compound key' },
            project: { type: 'string', description: 'Project code context for unqualified ticket IDs' },
          },
        },
      },
      {
        name: 'esedre_claim_ticket',
        description: 'Claim an advisory TTL-backed lease on a ticket to coordinate multi-agent and multi-machine work and prevent duplicate effort.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Ticket ID or prefixed key (e.g. 69 or "Esedre-69")' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: ticket ID or prefixed key' },
            holder: { type: 'string', description: 'Agent or developer identity claiming the ticket (e.g. "agy-subagent-1" or "desktop-worker")' },
            workerId: { type: 'string', description: 'Alias for holder: agent or worker identity claiming the ticket' },
            agentType: { type: 'string', description: 'Optional agent runtime identifier (e.g. "antigravity", "claude-code", "codex")' },
            system: { type: 'string', description: 'Alias for agentType: system or runtime identifier' },
            sessionId: { type: 'string', description: 'Optional conversation or session identifier' },
            branch: { type: 'string', description: 'Optional Git branch associated with the lease' },
            ttlMinutes: { type: 'number', description: 'Lease time-to-live in minutes (default: 60)' },
            force: { type: 'boolean', description: 'Override an existing active lease held by another worker' },
            project: { type: 'string', description: 'Optional project code when numeric ticketId is used' },
          },
        },
      },
      {
        name: 'esedre_renew_lease',
        description: 'Renew (heartbeat) an active ticket lease to extend its expiration timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Ticket ID or prefixed key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: ticket ID or prefixed key' },
            holder: { type: 'string', description: 'Holder identity verifying lease ownership' },
            workerId: { type: 'string', description: 'Alias for holder: worker identity verifying lease ownership' },
            system: { type: 'string', description: 'Optional system or agent runtime identifier' },
            ttlMinutes: { type: 'number', description: 'New TTL in minutes from now (default: 60)' },
            force: { type: 'boolean', description: 'Force renewal even if held by another identity' },
            project: { type: 'string', description: 'Optional project code' },
          },
        },
      },
      {
        name: 'esedre_release_ticket',
        description: 'Release an active lease on a ticket when work is paused, handed off, or completed.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: ['number', 'integer', 'string'], description: 'Ticket ID or prefixed key' },
            id: { type: ['number', 'integer', 'string'], description: 'Alias for ticketId: ticket ID or prefixed key' },
            holder: { type: 'string', description: 'Holder identity verifying lease ownership' },
            workerId: { type: 'string', description: 'Alias for holder: worker identity verifying lease ownership' },
            system: { type: 'string', description: 'Optional system or agent runtime identifier' },
            finalStatus: { type: 'string', enum: ['Planned', 'In Development', 'Completed', 'Rejected'], description: 'Optional status to transition the ticket to upon release' },
            notes: { type: 'string', description: 'Optional verification or handoff comment to append upon release' },
            force: { type: 'boolean', description: 'Force release even if held by another identity' },
            project: { type: 'string', description: 'Optional project code' },
          },
        },
      },
      {
        name: 'esedre_list_leases',
        description: 'List all currently active (non-expired) ticket leases across authorized projects.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Optional project code filter (or "all")' },
          },
        },
      },
    ];
  }

  private async executeTool(name: string, args: any): Promise<any> {
    const canonical = name.replace(/^esedre_/, '');
    switch (canonical) {
      case 'list_tickets': {
        const type = (args.type || args.category) as TicketType | undefined;
        const includePlan = Boolean(args.includePlan);
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
        const results = await Promise.all(
          tickets.map(async (t) => {
            let planMarkdown: string | null | undefined = t.planMarkdown;
            if (includePlan && planMarkdown === undefined) {
              const lookupKey = t.projectDescriptor?.code ? `${t.projectDescriptor.code}-${t.meta.id}` : t.meta.id;
              planMarkdown = (await this.storage.getPlan(lookupKey)) ?? null;
            }

            const hasPlan = Boolean(
              (t.planMarkdown && t.planMarkdown.trim().length > 0) ||
              (planMarkdown && planMarkdown.trim().length > 0)
            );

            return {
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
              summary: t.detail?.summary,
              hasPlan,
              ...(includePlan ? { planMarkdown: planMarkdown || null } : {}),
              sha1: t.sha1 || t.meta.sha1,
              isBlocked: t.isBlocked,
              links: t.links,
            };
          })
        );
        return results;
      }

      case 'get_ticket': {
        const id = this.parseTicketId(args.ticketId ?? args.id, 'Ticket ID', args.project);
        const ticket = await this.storage.getTicket(id);
        if (!ticket) throw new Error(`Ticket #${id} not found`);
        return ticket;
      }

      case 'get_plan': {
        const id = this.parseTicketId(args.ticketId ?? args.id, 'Ticket ID', args.project);
        const plan = await this.storage.getPlan(id);
        return { ticketId: id, planMarkdown: plan || null };
      }

      case 'save_plan': {
        const id = this.parseTicketId(args.ticketId ?? args.id, 'Ticket ID', args.project);
        const planContent = args.planMarkdown ?? args.plan;
        if (typeof planContent !== 'string') {
          throw new Error("Plan markdown content is required (pass 'planMarkdown' or 'plan')");
        }
        await this.storage.savePlan(id, planContent, args.lastHash);
        const ticket = await this.storage.getTicket(id);
        const pCode = ticket?.projectDescriptor?.code || ticket?.meta.project;
        await this.refreshProjectSnapshots([pCode]);
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
          plan: args.plan || args.planMarkdown,
          planMarkdown: args.planMarkdown || args.plan,
          milestone: args.milestone,
          submittedBy: args.author || 'Agent',
        });
        const pCode = created.projectDescriptor?.code || created.meta.project || args.project;
        await this.refreshProjectSnapshots([pCode]);

        const responseTicket = { ...created };
        if (!args.includeRaw && responseTicket.detail) {
          const { raw, ...cleanDetail } = responseTicket.detail;
          responseTicket.detail = cleanDetail as any;
        }
        return responseTicket;
      }

      case 'update_ticket': {
        const id = this.parseTicketId(args.ticketId ?? args.id, 'Ticket ID', args.project);
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
        if (args.detail !== undefined) updates.detail = args.detail;
        if (args.detailMarkdown !== undefined) updates.detailMarkdown = args.detailMarkdown;
        if (args.plan !== undefined || args.planMarkdown !== undefined) {
          updates.plan = args.plan ?? args.planMarkdown;
          updates.planMarkdown = args.planMarkdown ?? args.plan;
        }

        const updated = await this.storage.updateTicket(id, updates, args.lastHash);
        const pCode = updated.projectDescriptor?.code || updated.meta.project || args.project;
        await this.refreshProjectSnapshots([pCode]);

        const responseTicket = { ...updated };
        if (!args.includeRaw && responseTicket.detail) {
          const { raw, ...cleanDetail } = responseTicket.detail;
          responseTicket.detail = cleanDetail as any;
        }
        return responseTicket;
      }

      case 'add_comment': {
        const id = this.parseTicketId(args.ticketId ?? args.id, 'Ticket ID', args.project);
        let text = args.text;
        if (!text && args.file) {
          const resolvedPath = path.resolve(process.cwd(), args.file);
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`File not found: ${args.file}`);
          }
          if (!fs.statSync(resolvedPath).isFile()) {
            throw new Error(`Path is not a file: ${args.file}`);
          }
          const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
          if (!fileContent.trim()) {
            throw new Error(`Comment file is empty: ${args.file}`);
          }
          text = fileContent;
        }
        if (!text || !text.trim()) {
          throw new Error('Comment text or file is required');
        }
        const comment = await this.storage.addComment(id, {
          text,
          author: args.author || 'Agent',
        });
        const ticket = await this.storage.getTicket(id);
        const pCode = ticket?.projectDescriptor?.code || ticket?.meta.project;
        await this.refreshProjectSnapshots([pCode]);
        return comment;
      }

      case 'list_milestones': {
        return this.storage.listMilestones(args.project);
      }

      case 'get_milestone': {
        const rawMilestoneId = args.id ?? args.milestoneId ?? args.ticketId;
        if (rawMilestoneId === undefined || rawMilestoneId === null || String(rawMilestoneId).trim() === '') {
          throw new Error('Milestone ID is required');
        }
        const m = await this.storage.getMilestone(rawMilestoneId, args.project);
        if (!m) throw new Error(`Milestone '${rawMilestoneId}' not found`);
        const tickets = await this.storage.listTickets({ project: args.project || m.project, milestone: String(m.id) });
        return {
          ...m,
          tickets,
        };
      }

      case 'create_milestone': {
        const created = await this.storage.createMilestone({
          title: args.title,
          projectCode: args.project,
          description: args.description,
          featureFlag: args.featureFlag,
          targetDate: args.targetDate,
          status: args.status,
        });
        const pCode = created.project || args.project;
        await this.refreshProjectSnapshots([pCode]);
        return created;
      }

      case 'update_milestone': {
        const rawMilestoneId = args.id ?? args.milestoneId ?? args.ticketId;
        if (rawMilestoneId === undefined || rawMilestoneId === null || String(rawMilestoneId).trim() === '') {
          throw new Error('Milestone ID is required');
        }
        const updated = await this.storage.updateMilestone(rawMilestoneId, {
          title: args.title,
          description: args.description,
          featureFlag: args.featureFlag,
          targetDate: args.targetDate,
          status: args.status,
        }, args.project);
        const pCode = updated.project || args.project;
        await this.refreshProjectSnapshots([pCode]);
        return updated;
      }

      case 'link_ticket': {
        const sourceRaw = args.sourceTicketId ?? args.id ?? args.sourceId ?? args.ticketId;
        const targetRaw = args.targetTicketId ?? args.targetId;
        if (!sourceRaw && !targetRaw) {
          throw new Error('sourceTicketId and targetTicketId are required');
        }
        if (!sourceRaw) {
          throw new Error('sourceTicketId is required');
        }
        if (!targetRaw) {
          throw new Error('targetTicketId is required');
        }
        if (!args.relation) {
          throw new Error('relation is required');
        }
        const sourceId = this.parseTicketId(sourceRaw, 'sourceTicketId', args.project);
        const targetId = this.parseTicketId(targetRaw, 'targetTicketId', args.project);
        const relation = String(args.relation).toLowerCase().replace(/_/g, '-') as any;
        const result = await this.storage.addTicketLink(sourceId, relation, targetId, {
          author: args.author || 'Agent',
          project: args.project,
        });
        const p1 = result.source?.projectDescriptor?.code || result.source?.meta?.project;
        const p2 = result.target?.projectDescriptor?.code || result.target?.meta?.project;
        await this.refreshProjectSnapshots([p1, p2]);

        const sourceProject = result.source?.projectDescriptor?.code || result.source?.meta?.project;
        const sourceKey = sourceProject ? `${sourceProject}-${result.source.meta.id}` : `#${result.source.meta.id}`;
        const targetProject = result.target?.projectDescriptor?.code || result.target?.meta?.project;
        const targetKey = result.target
          ? (targetProject ? `${targetProject}-${result.target.meta.id}` : `#${result.target.meta.id}`)
          : String(targetId);

        return {
          success: true,
          sourceKey,
          relation,
          targetKey,
          sourceRevision: result.source?.meta?.revision || 1,
          targetRevision: result.target?.meta?.revision,
          links: result.source?.meta?.links || [],
        };
      }

      case 'unlink_ticket': {
        const sourceRaw = args.sourceTicketId ?? args.id ?? args.sourceId ?? args.ticketId;
        const targetRaw = args.targetTicketId ?? args.targetId;
        if (!sourceRaw && !targetRaw) {
          throw new Error('sourceTicketId and targetTicketId are required');
        }
        if (!sourceRaw) {
          throw new Error('sourceTicketId is required');
        }
        if (!targetRaw) {
          throw new Error('targetTicketId is required');
        }
        const sourceId = this.parseTicketId(sourceRaw, 'sourceTicketId', args.project);
        const targetId = this.parseTicketId(targetRaw, 'targetTicketId', args.project);
        const result = await this.storage.removeTicketLink(sourceId, targetId, {
          project: args.project,
        });
        const p1 = result.source?.projectDescriptor?.code || result.source?.meta?.project;
        const p2 = result.target?.projectDescriptor?.code || result.target?.meta?.project;
        await this.refreshProjectSnapshots([p1, p2]);

        const sourceProject = result.source?.projectDescriptor?.code || result.source?.meta?.project;
        const sourceKey = sourceProject ? `${sourceProject}-${result.source.meta.id}` : `#${result.source.meta.id}`;
        const targetProject = result.target?.projectDescriptor?.code || result.target?.meta?.project;
        const targetKey = result.target
          ? (targetProject ? `${targetProject}-${result.target.meta.id}` : `#${result.target.meta.id}`)
          : String(targetId);

        return {
          success: true,
          sourceKey,
          targetKey,
          sourceRevision: result.source?.meta?.revision || 1,
          targetRevision: result.target?.meta?.revision,
          links: result.source?.meta?.links || [],
        };
      }

      case 'claim_ticket': {
        const identity = resolveWorkerIdentity({
          holder: args.holder || args.workerId,
          agentType: args.agentType || args.system || 'mcp-agent',
          sessionId: args.sessionId,
          branch: args.branch,
        });
        const res = await this.storage.claimTicket({
          ticketId: this.parseTicketId(args.ticketId ?? args.id),
          holder: identity.holder,
          agentType: identity.agentType,
          hostname: identity.hostname,
          sessionId: identity.sessionId,
          branch: identity.branch,
          worktree: identity.worktree,
          ttlMinutes: args.ttlMinutes,
          force: Boolean(args.force),
          project: args.project,
        });
        const pCode = res.ticket?.projectDescriptor?.code || res.ticket?.meta?.project || res.lease?.project || args.project;
        await this.refreshProjectSnapshots([pCode]);
        return {
          success: true,
          renewed: res.renewed,
          overridden: res.overridden || false,
          lease: res.lease,
          ticket: {
            id: res.ticket.meta.id,
            project: res.ticket.meta.project,
            title: res.ticket.meta.title,
            status: res.ticket.meta.status,
            sha1: res.ticket.sha1,
          },
        };
      }

      case 'renew_lease': {
        const lease = await this.storage.renewLease({
          ticketId: this.parseTicketId(args.ticketId ?? args.id),
          holder: args.holder || args.workerId,
          ttlMinutes: args.ttlMinutes,
          force: Boolean(args.force),
          project: args.project,
        });
        const pCode = lease?.project || args.project;
        await this.refreshProjectSnapshots([pCode]);
        return {
          success: true,
          lease,
        };
      }

      case 'release_ticket': {
        const holder = args.holder || args.workerId;
        const parsedId = this.parseTicketId(args.ticketId ?? args.id);
        const res = await this.storage.releaseTicket({
          ticketId: parsedId,
          holder,
          force: Boolean(args.force),
          project: args.project,
        });
        if (args.finalStatus) {
          await this.storage.updateTicket(res.ticketKey || parsedId, { status: args.finalStatus as TicketStatus });
        }
        if (args.notes) {
          await this.storage.addComment(res.ticketKey || parsedId, {
            author: holder || res.previousLease?.holder || 'mcp-agent',
            text: args.notes,
          });
        }
        let pCode = args.project;
        if (!pCode && res.ticketKey) {
          const match = String(res.ticketKey).match(/^([a-zA-Z0-9]+)-/);
          if (match) pCode = match[1];
        }
        if (!pCode && res.previousLease?.project) {
          pCode = res.previousLease.project;
        }
        if (!pCode) {
          const ticket = await this.storage.getTicket(parsedId);
          pCode = ticket?.projectDescriptor?.code || ticket?.meta.project;
        }
        await this.refreshProjectSnapshots([pCode]);
        return {
          success: true,
          ...res,
        };
      }

      case 'list_leases': {
        const leases = await this.storage.listLeases(args.project);
        return {
          total: leases.length,
          leases,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

