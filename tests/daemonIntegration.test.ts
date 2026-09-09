import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDaemonStateFile,
  pingDaemon,
  stopDaemon,
} from '../src/server/daemon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const cliScript = path.resolve(workspaceRoot, 'dist', 'esedre.mjs');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliScript, ...args], { cwd: workspaceRoot }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: err ? (err as any).code || 1 : 0,
      });
    });
  });
}

function httpGet(url: string): Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

describe('Esedre Daemon Integration & CLI Lifecycle', () => {
  const PORT_A = 5970;

  afterAll(async () => {
    try {
      await stopDaemon({ port: PORT_A, quiet: true, workspaceRoot });
    } catch {}
  });

  it('executes full CLI lifecycle: start -> status -> HTTP probe -> logs -> idempotent start -> stop', async () => {
    // 1. Start daemon via CLI with --json
    const startRes = await runCli(['start', '--port', String(PORT_A), '--json']);
    expect(startRes.code).toBe(0);
    const startJson = JSON.parse(startRes.stdout);
    expect(startJson.port).toBe(PORT_A);
    expect(startJson.pid).toBeGreaterThan(0);
    expect(startJson.logFile).toBeTruthy();

    // 2. Query status via CLI with --json
    const statusRes = await runCli(['status', '--port', String(PORT_A), '--json']);
    expect(statusRes.code).toBe(0);
    const statusJson = JSON.parse(statusRes.stdout);
    expect(statusJson.running).toBe(true);
    expect(statusJson.pid).toBe(startJson.pid);
    expect(statusJson.port).toBe(PORT_A);
    expect(Array.isArray(statusJson.projects)).toBe(true);

    // 3. Perform live HTTP queries against daemon gateway
    const apiRes = await httpGet(`http://127.0.0.1:${PORT_A}/api/planning/projects`);
    expect(apiRes.status).toBe(200);
    const projects = JSON.parse(apiRes.body);
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);

    const rootRes = await httpGet(`http://127.0.0.1:${PORT_A}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.body).toContain('<!DOCTYPE html>');
    expect(rootRes.body).toContain('Esedre');

    const appRes = await httpGet(`http://127.0.0.1:${PORT_A}/app`);
    expect(appRes.status).toBe(200);
    expect(appRes.body).toContain('<!DOCTYPE html>');

    // 4. Query logs via CLI
    const logsRes = await runCli(['logs', '--port', String(PORT_A), '--lines', '10']);
    expect(logsRes.code).toBe(0);
    expect(logsRes.stdout).toContain('Esedre Server active');

    // 5. Idempotent start: running start again returns existing state
    const restartRes = await runCli(['start', '--port', String(PORT_A), '--json']);
    expect(restartRes.code).toBe(0);
    const restartJson = JSON.parse(restartRes.stdout);
    expect(restartJson.pid).toBe(startJson.pid);

    // 6. Stop daemon via CLI with --json
    const stopRes = await runCli(['stop', '--port', String(PORT_A), '--json']);
    expect(stopRes.code).toBe(0);
    const stopJson = JSON.parse(stopRes.stdout);
    expect(stopJson.stopped).toBe(true);
    expect(stopJson.port).toBe(PORT_A);

    // 7. Verify status after stop
    const postStopRes = await runCli(['status', '--port', String(PORT_A), '--json']);
    expect(postStopRes.code).toBe(0);
    const postStopJson = JSON.parse(postStopRes.stdout);
    expect(postStopJson.running).toBe(false);
  }, 20000);

  it('recovers cleanly from stale PID in state file', async () => {
    const STALE_PORT = 5975;
    const stateFile = getDaemonStateFile(STALE_PORT, workspaceRoot);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });

    // Write a fake state with a dead PID
    const fakeState = {
      pid: 9999998,
      port: STALE_PORT,
      startedAt: new Date().toISOString(),
      version: '0.1.0',
      workspaceRoot,
      logFile: stateFile.replace('.json', '.log'),
    };
    fs.writeFileSync(stateFile, JSON.stringify(fakeState), 'utf-8');

    // Query status: should detect dead process, prune state, and report stopped
    const statusRes = await runCli(['status', '--port', String(STALE_PORT), '--json']);
    expect(statusRes.code).toBe(0);
    const statusJson = JSON.parse(statusRes.stdout);
    expect(statusJson.running).toBe(false);
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('recovers cleanly from corrupted state file JSON', async () => {
    const CORRUPT_PORT = 5985;
    const stateFile = getDaemonStateFile(CORRUPT_PORT, workspaceRoot);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, 'INVALID NON-JSON DATA', 'utf-8');

    const statusRes = await runCli(['status', '--port', String(CORRUPT_PORT), '--json']);
    expect(statusRes.code).toBe(0);
    const statusJson = JSON.parse(statusRes.stdout);
    expect(statusJson.running).toBe(false);
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('distinguishes between Esedre daemon and arbitrary non-Esedre HTTP service', async () => {
    const FOREIGN_PORT = 5995;
    const foreignServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('I am an Apache or Nginx server, not Esedre');
    });

    await new Promise<void>((resolve) => foreignServer.listen(FOREIGN_PORT, '127.0.0.1', () => resolve()));

    try {
      const probe = await pingDaemon(FOREIGN_PORT, 200);
      expect(probe.responding).toBe(true);
      expect(probe.isEsedre).toBe(false);

      const statusRes = await runCli(['status', '--port', String(FOREIGN_PORT), '--json']);
      expect(statusRes.code).toBe(0);
      const statusJson = JSON.parse(statusRes.stdout);
      // Foreign service is responding, but is not Esedre daemon
      expect(statusJson.running).toBe(false);
    } finally {
      await new Promise<void>((resolve) => foreignServer.close(() => resolve()));
    }
  });
});
