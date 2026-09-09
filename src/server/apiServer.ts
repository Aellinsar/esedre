import http from 'node:http';
import { SecurityFilter } from '../securityFilter.js';
import { generateProjectSnapshot } from '../snapshot.js';

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

let cachedAllData: any = null;
let cachedAllTimestamp = 0;
const CACHE_TTL_MS = 5000;

export function invalidateApiCache(): void {
  cachedAllData = null;
  cachedAllTimestamp = 0;
}

export function startApiServer(port: number, storage: SecurityFilter, workspaceRoot: string): http.Server {
  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    let pathname = url.pathname;
    if (pathname.startsWith('/esedre/api')) {
      pathname = pathname.slice('/esedre'.length);
    }

    try {
      if (req.method === 'GET') {
        if (pathname === '/api/planning/projects') {
          const projects = await storage.getProjects();
          return sendJson(res, 200, projects);
        }

        if (pathname === '/api/planning/tickets') {
          const project = url.searchParams.get('project') || undefined;
          const status = (url.searchParams.get('status') as any) || undefined;
          const type = ((url.searchParams.get('type') || url.searchParams.get('category')) as any) || undefined;
          const category = type;
          const search = url.searchParams.get('search') || undefined;

          const tickets = await storage.listTickets({
            project: project === 'all' ? undefined : project,
            status,
            type,
            category,
            search,
          });
          return sendJson(res, 200, tickets);
        }

        if (pathname.startsWith('/api/planning/ticket/')) {
          const idStr = pathname.slice('/api/planning/ticket/'.length);
          if (!idStr || !/^([a-zA-Z0-9]{1,6}-)?\d+$/.test(idStr)) {
            return sendJson(res, 400, { error: 'Invalid ticket ID' });
          }
          const ticket = await storage.getTicket(idStr);
          if (!ticket) {
            return sendJson(res, 400, { error: 'Ticket not found' });
          }
          return sendJson(res, 200, ticket);
        }

        if (pathname === '/api/planning/all') {
          const now = Date.now();
          if (cachedAllData && now - cachedAllTimestamp < CACHE_TTL_MS) {
            return sendJson(res, 200, cachedAllData);
          }

          const tickets = await storage.listTickets({});
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

          const projects = await storage.getProjects();
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

          cachedAllData = responsePayload;
          cachedAllTimestamp = now;
          return sendJson(res, 200, responsePayload);
        }

        if (pathname === '/api/planning/metas') {
          const tickets = await storage.listTickets({});
          const metasMap: Record<string, any> = {};
          for (const t of tickets) {
            metasMap[String(t.meta.id)] = t.meta;
          }
          return sendJson(res, 200, metasMap);
        }

        if (pathname === '/api/planning/details') {
          const tickets = await storage.listTickets({});
          const detailsMap: Record<string, string> = {};
          for (const t of tickets) {
            if (t.detail?.raw) {
              detailsMap[String(t.meta.id)] = t.detail.raw;
            }
          }
          return sendJson(res, 200, detailsMap);
        }

        if (pathname === '/api/planning/plans') {
          const tickets = await storage.listTickets({});
          const plansMap: Record<string, string> = {};
          for (const t of tickets) {
            if (t.planMarkdown) {
              plansMap[String(t.meta.id)] = t.planMarkdown;
            }
          }
          return sendJson(res, 200, plansMap);
        }

        if (pathname === '/api/planning/comments') {
          const tickets = await storage.listTickets({});
          const commentsMap: Record<string, any[]> = {};
          for (const t of tickets) {
            commentsMap[String(t.meta.id)] = t.comments || [];
          }
          return sendJson(res, 200, commentsMap);
        }

        if (pathname === '/api/planning/history') {
          return sendJson(res, 200, {});
        }

        if (pathname === '/api/planning/inline-comments') {
          return sendJson(res, 200, {});
        }

        if (pathname === '/api/planning/answers') {
          return sendJson(res, 200, {});
        }

        if (pathname === '/api/planning/plan-history') {
          return sendJson(res, 200, {});
        }

        if (pathname === '/api/planning/snapshot') {
          const projectCode = url.searchParams.get('project');
          if (!projectCode) {
            return sendJson(res, 400, { error: 'Project query parameter is required for snapshot generation (no default fallback).' });
          }
          const snapshot = await generateProjectSnapshot(storage, projectCode, workspaceRoot);
          return sendJson(res, 200, snapshot);
        }
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req);

        if (pathname === '/api/planning/tickets') {
          invalidateApiCache();
          const created = await storage.createTicket(body);
          return sendJson(res, 201, { ticketId: String(created.meta.id), meta: created.meta });
        }

        if (pathname === '/api/planning/plans') {
          const { ticketId, planMarkdown, lastHash } = body;
          invalidateApiCache();
        await storage.savePlan(ticketId, planMarkdown, lastHash);
          return sendJson(res, 200, { success: true });
        }

        if (pathname === '/api/planning/comments') {
          const { ticketId, text, author } = body;
          invalidateApiCache();
        await storage.addComment(ticketId, { author: author || 'Developer', text });
          const ticket = await storage.getTicket(ticketId);
          return sendJson(res, 200, { comments: ticket?.comments || [] });
        }

        if (pathname === '/api/planning/update-meta') {
          const { ticketId, updates, lastHash } = body;
          const updated = await storage.updateTicket(ticketId, updates, lastHash);
          return sendJson(res, 200, { meta: updated.meta });
        }

        if (pathname === '/api/planning/toggle-flag') {
          const { ticketId, flagged } = body;
          const updated = await storage.updateTicket(ticketId, {
            featureFlag: flagged ? 'chat_enhanced' : '',
          });
          return sendJson(res, 200, { meta: updated.meta });
        }

        if (pathname === '/api/planning/details') {
          const { ticketId, detailMarkdown, metaUpdates } = body;
          if (metaUpdates) {
            await storage.updateTicket(ticketId, metaUpdates);
          }
          return sendJson(res, 200, { success: true, detail: detailMarkdown });
        }
      }

      return sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });
    } catch (err: any) {
      console.error('[Esedre API Error]:', err);
      return sendJson(res, 500, { error: err.message });
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
