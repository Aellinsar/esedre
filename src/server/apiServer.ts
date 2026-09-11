import http from 'node:http';
import { StorageAdapter } from '../storage/adapter.js';
import { SecurityFilter } from '../securityFilter.js';
import { generateProjectSnapshot } from '../snapshot.js';
import { validateProjectCode, validateProjectName } from '../config.js';

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-esedre-allowed-projects',
  });
  res.end(JSON.stringify(data));
}

interface CacheEntry {
  data: any;
  timestamp: number;
}
const cachedAllData = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000;

export function invalidateApiCache(): void {
  cachedAllData.clear();
}

function getRequestStorage(baseStorage: StorageAdapter, req: http.IncomingMessage, url: URL): { storage: StorageAdapter; cacheKey: string } {
  const headerAllowed = req.headers['x-esedre-allowed-projects'];
  const queryAllowed = url.searchParams.get('allowedProjects');
  const rawAllowed = (typeof headerAllowed === 'string' ? headerAllowed : Array.isArray(headerAllowed) ? headerAllowed[0] : null) || queryAllowed;

  if (rawAllowed && typeof rawAllowed === 'string') {
    const list = rawAllowed.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0 && !list.includes('*')) {
      const sortedKey = [...list].sort().join(',');
      return {
        storage: new SecurityFilter(baseStorage, { allowedProjects: list }),
        cacheKey: sortedKey,
      };
    }
  }
  return { storage: baseStorage, cacheKey: '*' };
}

export function createApiHandler(storage: StorageAdapter, workspaceRoot: string) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const rawUrl = req.url || '/';
    const parsedPath = rawUrl.split('?')[0];

    // Handle CORS preflight for API paths
    if (req.method === 'OPTIONS') {
      if (parsedPath.startsWith('/api') || parsedPath.startsWith('/esedre/api')) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return true;
      }
      return false;
    }

    if (!parsedPath.startsWith('/api') && !parsedPath.startsWith('/esedre/api')) {
      return false;
    }

    const url = new URL(rawUrl, 'http://127.0.0.1');
    let pathname = url.pathname;
    if (pathname.startsWith('/esedre/api')) {
      pathname = pathname.slice('/esedre'.length);
    }

    const { storage: reqStorage, cacheKey } = getRequestStorage(storage, req, url);

    try {
      if (req.method === 'GET') {
        if (pathname === '/api/ping') {
          sendJson(res, 200, { status: 'ok', esedre: true });
          return true;
        }

        if (pathname === '/api/planning/projects') {
          const projects = await reqStorage.getProjects();
          sendJson(res, 200, projects);
          return true;
        }

        if (pathname === '/api/planning/tickets') {
          const project = url.searchParams.get('project') || undefined;
          const status = (url.searchParams.get('status') as any) || undefined;
          const type = ((url.searchParams.get('type') || url.searchParams.get('category')) as any) || undefined;
          const category = type;
          const search = url.searchParams.get('search') || undefined;

          const tickets = await reqStorage.listTickets({
            project: project === 'all' ? undefined : project,
            status,
            type,
            category,
            search,
          });
          sendJson(res, 200, tickets);
          return true;
        }

        if (pathname.startsWith('/api/planning/ticket/')) {
          const idStr = pathname.slice('/api/planning/ticket/'.length);
          if (!idStr || !/^([a-zA-Z0-9]{1,8}-)?\d+$/.test(idStr)) {
            sendJson(res, 400, { error: 'Invalid ticket ID' });
            return true;
          }
          const ticket = await reqStorage.getTicket(idStr);
          if (!ticket) {
            sendJson(res, 400, { error: 'Ticket not found' });
            return true;
          }
          sendJson(res, 200, ticket);
          return true;
        }

        if (pathname === '/api/planning/all') {
          const now = Date.now();
          const cached = cachedAllData.get(cacheKey);
          if (cached && now - cached.timestamp < CACHE_TTL_MS) {
            sendJson(res, 200, cached.data);
            return true;
          }

          const tickets = await reqStorage.listTickets({});
          const metasMap: Record<string, any> = {};
          const detailsMap: Record<string, string> = {};
          const plansMap: Record<string, string> = {};
          const commentsMap: Record<string, any[]> = {};

          for (const t of tickets) {
            const numKey = String(t.meta.id);
            const code = t.projectDescriptor?.code || t.meta.project || 'Profe';
            const prefixedKey = `${code}-${t.meta.id}`;

            metasMap[prefixedKey] = t.meta;
            if (!metasMap[numKey] || code.toUpperCase() === 'PROF') {
              metasMap[numKey] = t.meta;
            }
            commentsMap[prefixedKey] = t.comments || [];
            if (!commentsMap[numKey] || code.toUpperCase() === 'PROF') {
              commentsMap[numKey] = t.comments || [];
            }

            if (t.detail?.raw) {
              detailsMap[prefixedKey] = t.detail.raw;
              if (!detailsMap[numKey] || code.toUpperCase() === 'PROF') {
                detailsMap[numKey] = t.detail.raw;
              }
            }
            if (t.planMarkdown) {
              plansMap[prefixedKey] = t.planMarkdown;
              if (!plansMap[numKey] || code.toUpperCase() === 'PROF') {
                plansMap[numKey] = t.planMarkdown;
              }
            }
          }

          const projects = await reqStorage.getProjects();
          const responsePayload = {
            success: true,
            projects,
            metas: metasMap,
            details: detailsMap,
            plans: plansMap,
            comments: commentsMap,
            answers: {},
            inlineComments: {},
            planHistory: {},
            ticketHistory: {},
          };

          cachedAllData.set(cacheKey, { data: responsePayload, timestamp: now });
          sendJson(res, 200, responsePayload);
          return true;
        }

        if (pathname === '/api/planning/metas') {
          const tickets = await reqStorage.listTickets({});
          const metasMap: Record<string, any> = {};
          for (const t of tickets) {
            metasMap[String(t.meta.id)] = t.meta;
          }
          sendJson(res, 200, metasMap);
          return true;
        }

        if (pathname === '/api/planning/details') {
          const tickets = await reqStorage.listTickets({});
          const detailsMap: Record<string, string> = {};
          for (const t of tickets) {
            if (t.detail?.raw) {
              detailsMap[String(t.meta.id)] = t.detail.raw;
            }
          }
          sendJson(res, 200, detailsMap);
          return true;
        }

        if (pathname === '/api/planning/plans') {
          const tickets = await reqStorage.listTickets({});
          const plansMap: Record<string, string> = {};
          for (const t of tickets) {
            if (t.planMarkdown) {
              plansMap[String(t.meta.id)] = t.planMarkdown;
            }
          }
          sendJson(res, 200, plansMap);
          return true;
        }

        if (pathname === '/api/planning/comments') {
          const tickets = await reqStorage.listTickets({});
          const commentsMap: Record<string, any[]> = {};
          for (const t of tickets) {
            commentsMap[String(t.meta.id)] = t.comments || [];
          }
          sendJson(res, 200, commentsMap);
          return true;
        }

        if (pathname === '/api/planning/history') {
          sendJson(res, 200, {});
          return true;
        }

        if (pathname === '/api/planning/inline-comments') {
          sendJson(res, 200, {});
          return true;
        }

        if (pathname === '/api/planning/answers') {
          sendJson(res, 200, {});
          return true;
        }

        if (pathname === '/api/planning/plan-history') {
          sendJson(res, 200, {});
          return true;
        }

        if (pathname === '/api/planning/snapshot') {
          const projectCode = url.searchParams.get('project');
          if (!projectCode) {
            sendJson(res, 400, { error: 'Project query parameter is required for snapshot generation (no default fallback).' });
            return true;
          }
          const snapshot = await generateProjectSnapshot(reqStorage, projectCode, workspaceRoot);
          sendJson(res, 200, snapshot);
          return true;
        }
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req);

        if (pathname === '/api/planning/tickets') {
          invalidateApiCache();
          const created = await reqStorage.createTicket(body);
          sendJson(res, 201, { ticketId: String(created.meta.id), meta: created.meta });
          return true;
        }

        if (pathname === '/api/planning/create-project') {
          const { code, name, description, colors, hub } = body;
          if (!code || !name) {
            sendJson(res, 400, { error: 'Both code and name are required to register a project.' });
            return true;
          }
          const codeVal = validateProjectCode(code);
          if (!codeVal.valid) {
            sendJson(res, 400, { error: codeVal.error });
            return true;
          }
          const nameVal = validateProjectName(name);
          if (!nameVal.valid) {
            sendJson(res, 400, { error: nameVal.error });
            return true;
          }
          invalidateApiCache();
          const project = await reqStorage.registerProject({
            code,
            name,
            description,
            colors,
            hub,
          });
          sendJson(res, 201, project);
          return true;
        }

        if (pathname === '/api/planning/plans') {
          const { ticketId, planMarkdown, lastHash } = body;
          invalidateApiCache();
          await reqStorage.savePlan(ticketId, planMarkdown, lastHash);
          sendJson(res, 200, { success: true });
          return true;
        }

        if (pathname === '/api/planning/comments') {
          const { ticketId, text, author } = body;
          invalidateApiCache();
          await reqStorage.addComment(ticketId, { author: author || 'Developer', text });
          const ticket = await reqStorage.getTicket(ticketId);
          sendJson(res, 200, { comments: ticket?.comments || [] });
          return true;
        }

        if (pathname === '/api/planning/update-meta') {
          const { ticketId, updates, lastHash } = body;
          const updated = await reqStorage.updateTicket(ticketId, updates, lastHash);
          sendJson(res, 200, { meta: updated.meta });
          return true;
        }

        if (pathname === '/api/planning/toggle-flag') {
          const { ticketId, flagged } = body;
          const updated = await reqStorage.updateTicket(ticketId, {
            featureFlag: flagged ? 'chat_enhanced' : '',
          });
          sendJson(res, 200, { meta: updated.meta });
          return true;
        }

        if (pathname === '/api/planning/details') {
          const { ticketId, detailMarkdown, metaUpdates } = body;
          if (metaUpdates) {
            await reqStorage.updateTicket(ticketId, metaUpdates);
          }
          sendJson(res, 200, { success: true, detail: detailMarkdown });
          return true;
        }
      }

      sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });
      return true;
    } catch (err: any) {
      if (err.name === 'EsedreAuthorizationError' || err.message?.includes('outside this workspace\'s authorized scope') || err.message?.includes('Access Denied')) {
        sendJson(res, 403, { error: err.message });
        return true;
      }
      console.error('[Esedre API Error]:', err);
      sendJson(res, 500, { error: err.message });
      return true;
    }
  };
}

export function startApiServer(port: number, storage: StorageAdapter, workspaceRoot: string): http.Server {
  const handler = createApiHandler(storage, workspaceRoot);

  const server = http.createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled && !res.headersSent) {
      sendJson(res, 404, { error: `Endpoint not found: ${req.url}` });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    // Listening
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\x1b[31mError: Internal API port ${port} is already in use.\x1b[0m`);
    } else {
      console.error(`\x1b[31mAPI Server Error: ${err.message}\x1b[0m`);
    }
  });

  return server;
}
