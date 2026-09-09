import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startApiServer } from '../src/server/apiServer.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';

function request(
  url: string,
  method: string = 'GET',
  body?: any
): Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = body ? JSON.stringify(body) : undefined;
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json',
    };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => (resBody += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: resBody,
            json: () => (resBody ? JSON.parse(resBody) : null),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

describe('Esedre REST API Server', () => {
  let tempDir: string;
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-api-test-'));

    // Set up project and ticket fixture
    const projectsDir = path.join(tempDir, 'src', 'data', 'planning', 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectsDir, 'projects.json'),
      JSON.stringify([
        { id: 1, code: 'Core', slug: 'core', name: 'Core Application', description: 'Main App' },
        { id: 2, code: 'Esedre', slug: 'esedre', name: 'Esedre', description: 'Platform' },
      ])
    );

    const rawStorage = new FilesystemStorageAdapter(tempDir);
    const storage = new SecurityFilter(rawStorage);

    // Create an initial ticket
    await storage.createTicket({
      title: 'Initial Test Ticket',
      category: 'Feature',
      projectCode: 'Core',
      complexity: 'Low',
      summary: 'Initial summary',
    });

    await new Promise<void>((resolve) => {
      server = startApiServer(0, storage, tempDir);
      server.once('listening', () => {
        const addr = server!.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('handles CORS preflight OPTIONS with 204 status', async () => {
    const res = await request(`${baseUrl}/api/planning/tickets`, 'OPTIONS');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('GET /api/planning/projects returns registered projects', async () => {
    const res = await request(`${baseUrl}/api/planning/projects`, 'GET');
    expect(res.status).toBe(200);
    const projects = res.json();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBe(2);
    expect(projects[0].code).toBe('Core');
  });

  it('GET /api/planning/tickets returns tickets with optional filtering', async () => {
    const resAll = await request(`${baseUrl}/api/planning/tickets`, 'GET');
    expect(resAll.status).toBe(200);
    const all = resAll.json();
    expect(all.length).toBe(1);
    expect(all[0].meta.title).toBe('Initial Test Ticket');

    // Filter by project
    const resProf = await request(`${baseUrl}/api/planning/tickets?project=Core`, 'GET');
    expect(resProf.json().length).toBe(1);

    const resEsedre = await request(`${baseUrl}/api/planning/tickets?project=Esedre`, 'GET');
    expect(resEsedre.json().length).toBe(0);

    // Filter by status
    const resPlanned = await request(`${baseUrl}/api/planning/tickets?status=Planned`, 'GET');
    expect(resPlanned.json().length).toBe(1);

    const resDone = await request(`${baseUrl}/api/planning/tickets?status=Completed`, 'GET');
    expect(resDone.json().length).toBe(0);

    // Search query
    const resSearch = await request(`${baseUrl}/api/planning/tickets?search=Initial`, 'GET');
    expect(resSearch.json().length).toBe(1);

    const resSearchNone = await request(`${baseUrl}/api/planning/tickets?search=Nonexistent`, 'GET');
    expect(resSearchNone.json().length).toBe(0);
  });

  it('GET /api/planning/ticket/:id returns single ticket and handles errors', async () => {
    const res = await request(`${baseUrl}/api/planning/ticket/1`, 'GET');
    expect(res.status).toBe(200);
    const ticket = res.json();
    expect(ticket.meta.id).toBe(1);
    expect(ticket.meta.title).toBe('Initial Test Ticket');

    // Invalid numeric ID
    const resInvalid = await request(`${baseUrl}/api/planning/ticket/abc`, 'GET');
    expect(resInvalid.status).toBe(400);
    expect(resInvalid.json().error).toContain('Invalid ticket ID');

    // Non-existent ID
    const resNotFound = await request(`${baseUrl}/api/planning/ticket/999`, 'GET');
    expect(resNotFound.status).toBe(400);
    expect(resNotFound.json().error).toContain('Ticket not found');
  });

  it('GET /api/planning/metas, /details, /plans, /comments return mapped lookups', async () => {
    const metasRes = await request(`${baseUrl}/api/planning/metas`, 'GET');
    expect(metasRes.status).toBe(200);
    expect(metasRes.json()['1']).toBeDefined();

    const detailsRes = await request(`${baseUrl}/api/planning/details`, 'GET');
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.json()['1']).toContain('Initial Test Ticket');

    const plansRes = await request(`${baseUrl}/api/planning/plans`, 'GET');
    expect(plansRes.status).toBe(200);

    const commentsRes = await request(`${baseUrl}/api/planning/comments`, 'GET');
    expect(commentsRes.status).toBe(200);
    expect(commentsRes.json()['1']).toEqual([]);
  });

  it('GET /api/planning/snapshot generates projection snapshot', async () => {
    const res = await request(`${baseUrl}/api/planning/snapshot?project=Core`, 'GET');
    expect(res.status).toBe(200);
    const snapshot = res.json();
    expect(snapshot.projectCode).toBe('Core');
    expect(snapshot.totalTickets).toBe(1);
    expect(snapshot.tickets[0].id).toBe(1);
  });

  it('POST /api/planning/tickets creates a new ticket', async () => {
    const res = await request(`${baseUrl}/api/planning/tickets`, 'POST', {
      title: 'Second Ticket',
      category: 'Bug',
      projectCode: 'Core',
      complexity: 'High',
      summary: 'Bug fix summary',
    });
    expect(res.status).toBe(201);
    const body = res.json();
    expect(body.ticketId).toBe('2');
    expect(body.meta.title).toBe('Second Ticket');
    expect(body.meta.category).toBe('Bug');
  });

  it('POST /api/planning/plans updates implementation plan with OCC', async () => {
    const ticketRes = await request(`${baseUrl}/api/planning/ticket/1`, 'GET');
    const sha1 = ticketRes.json().sha1;

    const res = await request(`${baseUrl}/api/planning/plans`, 'POST', {
      ticketId: 1,
      planMarkdown: '## Step 1: Verification\nPlan content.',
      lastHash: sha1,
    });
    expect(res.status).toBe(200);
    expect(res.json().success).toBe(true);

    // Verify plan is persisted
    const updatedRes = await request(`${baseUrl}/api/planning/ticket/1`, 'GET');
    expect(updatedRes.json().planMarkdown).toBe('## Step 1: Verification\nPlan content.');
  });

  it('POST /api/planning/comments appends comments to ticket history', async () => {
    const res = await request(`${baseUrl}/api/planning/comments`, 'POST', {
      ticketId: 1,
      text: 'Verified by automated test',
      author: 'TestBot',
    });
    expect(res.status).toBe(200);
    const comments = res.json().comments;
    expect(comments.length).toBe(1);
    expect(comments[0].author).toBe('TestBot');
    expect(comments[0].text).toBe('Verified by automated test');
  });

  it('POST /api/planning/update-meta modifies ticket metadata', async () => {
    const res = await request(`${baseUrl}/api/planning/update-meta`, 'POST', {
      ticketId: 1,
      updates: {
        status: 'In Development',
        complexity: 'High',
      },
    });
    expect(res.status).toBe(200);
    expect(res.json().meta.status).toBe('In Development');
    expect(res.json().meta.complexity).toBe('High');
  });

  it('POST /api/planning/toggle-flag toggles featureFlag on ticket', async () => {
    const res = await request(`${baseUrl}/api/planning/toggle-flag`, 'POST', {
      ticketId: 1,
      flagged: true,
    });
    expect(res.status).toBe(200);
    expect(res.json().meta.featureFlag).toBe('chat_enhanced');
  });

  it('POST /api/planning/details updates detail markdown and metaUpdates', async () => {
    const res = await request(`${baseUrl}/api/planning/details`, 'POST', {
      ticketId: 1,
      detailMarkdown: '# Ticket #1: Updated Spec\n### Summary\nNew details.',
      metaUpdates: {
        title: 'Updated Spec',
      },
    });
    expect(res.status).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().detail).toContain('New details.');
  });

  it('handles legacy /esedre/api/ prefix identically', async () => {
    const res = await request(`${baseUrl}/esedre/api/planning/projects`, 'GET');
    expect(res.status).toBe(200);
    const projects = res.json();
    expect(projects[0].code).toBe('Core');
  });

  it('returns 404 on unknown API endpoints', async () => {
    const res = await request(`${baseUrl}/api/planning/unknown-route`, 'GET');
    expect(res.status).toBe(404);
    expect(res.json().error).toContain('Endpoint not found');
  });

  it('GET /api/planning/snapshot returns 400 when project parameter is missing (zero fallback)', async () => {
    const res = await request(`${baseUrl}/api/planning/snapshot`, 'GET');
    expect(res.status).toBe(400);
    expect(res.json().error).toContain('Project query parameter is required');
  });

  it('GET /api/planning/snapshot returns 200 when valid project parameter is provided', async () => {
    const res = await request(`${baseUrl}/api/planning/snapshot?project=Core`, 'GET');
    expect(res.status).toBe(200);
    expect(res.json().projectCode).toBe('Core');
  });
});
