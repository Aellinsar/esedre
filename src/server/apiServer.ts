import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { StorageAdapter } from '../storage/adapter.js';
import { SecurityFilter } from '../securityFilter.js';
import { generateProjectSnapshot } from '../snapshot.js';
import { validateProjectCode, validateProjectName } from '../config.js';

const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024; // 10MB payload ceiling

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytesRead = 0;
    req.on('data', (chunk) => {
      bytesRead += chunk.length;
      if (bytesRead > MAX_JSON_BODY_BYTES) {
        req.destroy(new Error('Payload Too Large: JSON body exceeds 10MB limit'));
        return;
      }
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
const MAX_CACHE_ENTRIES = 30;

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
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-esedre-allowed-projects',
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
          const priority = (url.searchParams.get('priority') as any) || undefined;
          const search = url.searchParams.get('search') || undefined;

          const tickets = await reqStorage.listTickets({
            project: project === 'all' ? undefined : project,
            status,
            type,
            category,
            priority,
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
          const answersMap: Record<string, Record<string, string>> = {};
          const inlineCommentsMap: Record<string, any[]> = {};

          for (const t of tickets) {
            const numKey = String(t.meta.id);
            const code = t.projectDescriptor?.code || t.meta.project || 'Profe';
            const prefixedKey = `${code}-${t.meta.id}`;

            const metaWithLinks = { ...t.meta, links: t.links || t.meta.links || [], isBlocked: t.isBlocked };
            metasMap[prefixedKey] = metaWithLinks;
            if (!metasMap[numKey] || code.toUpperCase() === 'PROF') {
              metasMap[numKey] = metaWithLinks;
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
            if (t.answers && Object.keys(t.answers).length > 0) {
              answersMap[prefixedKey] = t.answers;
              if (!answersMap[numKey] || code.toUpperCase() === 'PROF') {
                answersMap[numKey] = t.answers;
              }
            }
            if (t.inlineComments && t.inlineComments.length > 0) {
              inlineCommentsMap[prefixedKey] = t.inlineComments;
              if (!inlineCommentsMap[numKey] || code.toUpperCase() === 'PROF') {
                inlineCommentsMap[numKey] = t.inlineComments;
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
            answers: answersMap,
            inlineComments: inlineCommentsMap,
            planHistory: {},
            ticketHistory: {},
          };

          if (cachedAllData.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = cachedAllData.keys().next().value;
            if (oldestKey) cachedAllData.delete(oldestKey);
          }
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
          const ticketParam = url.searchParams.get('ticketId') || url.searchParams.get('id');
          if (ticketParam) {
            const inlines = reqStorage.getInlineComments ? await reqStorage.getInlineComments(ticketParam) : [];
            sendJson(res, 200, inlines);
            return true;
          }
          const tickets = await reqStorage.listTickets({});
          const inlinesMap: Record<string, any[]> = {};
          for (const t of tickets) {
            if (t.inlineComments && t.inlineComments.length > 0) {
              inlinesMap[String(t.meta.id)] = t.inlineComments;
              const code = t.projectDescriptor?.code || t.meta.project;
              if (code) {
                inlinesMap[`${code}-${t.meta.id}`] = t.inlineComments;
              }
            }
          }
          sendJson(res, 200, inlinesMap);
          return true;
        }

        if (pathname === '/api/planning/answers') {
          const ticketParam = url.searchParams.get('ticketId') || url.searchParams.get('id');
          if (ticketParam) {
            const answers = await reqStorage.getAnswers(ticketParam);
            sendJson(res, 200, answers);
            return true;
          }
          const tickets = await reqStorage.listTickets({});
          const answersMap: Record<string, Record<string, string>> = {};
          for (const t of tickets) {
            if (t.answers && Object.keys(t.answers).length > 0) {
              answersMap[String(t.meta.id)] = t.answers;
              const code = t.projectDescriptor?.code || t.meta.project;
              if (code) {
                answersMap[`${code}-${t.meta.id}`] = t.answers;
              }
            }
          }
          sendJson(res, 200, answersMap);
          return true;
        }

        if (pathname === '/api/planning/attachment') {
          const ticketId = url.searchParams.get('ticketId') || url.searchParams.get('id');
          const file = url.searchParams.get('file');
          if (!ticketId || !file) {
            sendJson(res, 400, { error: 'ticketId and file parameters are required.' });
            return true;
          }
          const ticket = await reqStorage.getTicket(ticketId);
          if (!ticket) {
            sendJson(res, 404, { error: 'Ticket not found.' });
            return true;
          }
          const filePath = reqStorage.getAttachmentPath ? reqStorage.getAttachmentPath(ticketId, file) : null;
          if (!filePath || !fs.existsSync(filePath)) {
            sendJson(res, 404, { error: 'Attachment not found.' });
            return true;
          }
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            sendJson(res, 404, { error: 'Attachment not found.' });
            return true;
          }
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
          };
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=86400',
          });
          fs.createReadStream(filePath).pipe(res);
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

        if (pathname === '/api/planning/milestones') {
          const project = url.searchParams.get('project') || undefined;
          const milestones = await reqStorage.listMilestones(project);
          sendJson(res, 200, { milestones });
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

        if (pathname === '/api/planning/update-project') {
          const { code, name, description, colors, techStack, groundingRules, guidelinesRef } = body;
          if (!code) {
            sendJson(res, 400, { error: 'Project code is required.' });
            return true;
          }
          if (name !== undefined) {
            const nameVal = validateProjectName(name);
            if (!nameVal.valid) {
              sendJson(res, 400, { error: nameVal.error });
              return true;
            }
          }
          invalidateApiCache();
          const updated = await reqStorage.updateProject({
            code,
            name,
            description,
            colors,
            techStack,
            groundingRules,
            guidelinesRef,
          });
          sendJson(res, 200, updated);
          return true;
        }

        if (pathname === '/api/planning/rename-project') {
          const { oldCode, newCode, newName } = body;
          if (!oldCode || !newCode) {
            sendJson(res, 400, { error: 'Both oldCode and newCode are required to rename a project.' });
            return true;
          }
          const codeVal = validateProjectCode(newCode);
          if (!codeVal.valid) {
            sendJson(res, 400, { error: codeVal.error });
            return true;
          }
          if (newName !== undefined) {
            const nameVal = validateProjectName(newName);
            if (!nameVal.valid) {
              sendJson(res, 400, { error: nameVal.error });
              return true;
            }
          }
          invalidateApiCache();
          const result = await reqStorage.renameProjectCode({
            oldCode,
            newCode,
            newName,
          });
          sendJson(res, 200, result);
          return true;
        }

        if (pathname === '/api/planning/plans') {
          const { ticketId, planMarkdown, lastHash } = body;
          if (!ticketId) {
            sendJson(res, 400, { error: 'ticketId is required.' });
            return true;
          }
          invalidateApiCache();
          await reqStorage.savePlan(ticketId, planMarkdown, lastHash);
          sendJson(res, 200, { success: true });
          return true;
        }

        if (pathname === '/api/planning/comments') {
          const { ticketId, text, author } = body;
          if (!ticketId) {
            sendJson(res, 400, { error: 'ticketId is required.' });
            return true;
          }
          invalidateApiCache();
          await reqStorage.addComment(ticketId, { author: author || 'Developer', text });
          const ticket = await reqStorage.getTicket(ticketId);
          sendJson(res, 200, { comments: ticket?.comments || [] });
          return true;
        }

        if (pathname === '/api/planning/update-meta') {
          const { ticketId, updates, lastHash } = body;
          if (!ticketId) {
            sendJson(res, 400, { error: 'ticketId is required.' });
            return true;
          }
          invalidateApiCache();
          const updated = await reqStorage.updateTicket(ticketId, updates, lastHash);
          sendJson(res, 200, { meta: updated.meta });
          return true;
        }

        if (pathname === '/api/planning/toggle-flag') {
          const { ticketId, flagged } = body;
          if (!ticketId) {
            sendJson(res, 400, { error: 'ticketId is required.' });
            return true;
          }
          invalidateApiCache();
          const updated = await reqStorage.updateTicket(ticketId, {
            featureFlag: flagged ? 'chat_enhanced' : '',
          });
          sendJson(res, 200, { meta: updated.meta });
          return true;
        }

        if (pathname === '/api/planning/details') {
          const { ticketId, detailMarkdown, metaUpdates } = body;
          if (!ticketId) {
            sendJson(res, 400, { error: 'ticketId is required.' });
            return true;
          }
          invalidateApiCache();
          const result = await reqStorage.saveDetail(ticketId, detailMarkdown || '', metaUpdates);
          sendJson(res, 200, result);
          return true;
        }

        if (pathname === '/api/planning/answers') {
          const { ticketId, questionIndex, answer } = body;
          if (ticketId === undefined || questionIndex === undefined || answer === undefined) {
            sendJson(res, 400, { error: 'ticketId, questionIndex, and answer are required.' });
            return true;
          }
          invalidateApiCache();
          const updated = await reqStorage.saveAnswer(ticketId, Number(questionIndex), String(answer));
          sendJson(res, 200, updated);
          return true;
        }

        if (pathname === '/api/planning/save-inline-comment' || pathname === '/api/planning/inline-comments') {
          const { ticketId, selectedText, comment, author } = body;
          if (!ticketId || !selectedText || !comment) {
            sendJson(res, 400, { error: 'ticketId, selectedText, and comment are required.' });
            return true;
          }
          invalidateApiCache();
          const inlineComments = reqStorage.saveInlineComment
            ? await reqStorage.saveInlineComment(ticketId, selectedText, comment, author)
            : [];
          sendJson(res, 200, { inlineComments });
          return true;
        }

        if (pathname === '/api/planning/upload-attachment') {
          const { ticketId, filename, base64Data } = body;
          if (!ticketId || !filename || !base64Data) {
            sendJson(res, 400, { error: 'ticketId, filename, and base64Data are required.' });
            return true;
          }
          const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
          const buffer = Buffer.from(base64Content, 'base64');
          if (!reqStorage.saveAttachment) {
            sendJson(res, 500, { error: 'Attachments are not supported by the storage engine.' });
            return true;
          }
          invalidateApiCache();
          const saved = await reqStorage.saveAttachment(ticketId, filename, buffer);
          sendJson(res, 200, {
            success: true,
            filename: saved.filename,
            url: `/api/planning/attachment?ticketId=${encodeURIComponent(ticketId)}&file=${encodeURIComponent(saved.filename)}`,
          });
          return true;
        }

        if (pathname === '/api/planning/milestones') {
          invalidateApiCache();
          const created = await reqStorage.createMilestone(body);
          sendJson(res, 201, { milestone: created });
          return true;
        }

        if (pathname === '/api/planning/update-milestone') {
          invalidateApiCache();
          const { id, projectCode, ...updates } = body;
          const updated = await reqStorage.updateMilestone(id, updates, projectCode);
          sendJson(res, 200, { milestone: updated });
          return true;
        }

        if (pathname === '/api/planning/delete-milestone') {
          invalidateApiCache();
          const { id, projectCode } = body;
          const success = await reqStorage.deleteMilestone(id, projectCode);
          sendJson(res, 200, { success });
          return true;
        }

        if (pathname === '/api/planning/link') {
          invalidateApiCache();
          const { sourceId, relation, targetId, author, project } = body;
          if (!sourceId || !relation || !targetId) {
            sendJson(res, 400, { error: 'sourceId, relation, and targetId are required.' });
            return true;
          }
          const result = await reqStorage.addTicketLink(sourceId, relation, targetId, { author, project });
          sendJson(res, 200, { success: true, source: result.source, target: result.target });
          return true;
        }

        if (pathname === '/api/planning/unlink') {
          invalidateApiCache();
          const { sourceId, targetId, relation, project } = body;
          if (!sourceId || !targetId) {
            sendJson(res, 400, { error: 'sourceId and targetId are required.' });
            return true;
          }
          const result = await reqStorage.removeTicketLink(sourceId, targetId, { relation, project });
          sendJson(res, 200, { success: true, source: result.source, target: result.target });
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
