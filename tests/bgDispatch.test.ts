import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { quoteWinArg, buildWinCommandLine, collectWorkerEnv, readExitMarker } from '../src/utils/workerLaunch.js';
import { tailFile, isPidAlive } from '../src/utils/workerRuns.js';

/**
 * Regression tests for `ese crew dispatch --bg`: a worker that dies, crashes or escalates right
 * after launch must never leave an active lease plus a silent "success" message.
 */
describe('crew dispatch --bg hardening', () => {
  let tempRepo: string;
  let cliScriptPath: string;
  let globalDir: string;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-bg-dispatch-test-'));
    cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');
    globalDir = path.join(tempRepo, '.global-esedre');

    const git = (...a: string[]) => execFileSync('git', a, { cwd: tempRepo, stdio: 'ignore' });
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@esedre.dev');
    git('config', 'user.name', 'Esedre Tester');
    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Test Project\n', 'utf-8');
    git('add', 'README.md');
    git('commit', '-m', '[#1] Initial commit');

    const esedreDir = path.join(tempRepo, '.esedre');
    const ticketsDir = path.join(esedreDir, 'tickets', '1');
    fs.mkdirSync(ticketsDir, { recursive: true });
    fs.writeFileSync(
      path.join(esedreDir, 'esedre.json'),
      JSON.stringify({ projectCode: 'Core', allowedProjects: ['Core'] }, null, 2)
    );
    fs.writeFileSync(
      path.join(ticketsDir, 'meta.json'),
      JSON.stringify(
        { id: 1, title: 'Background Task', type: 'Feature', category: 'Feature', status: 'Planned', project: 'Core' },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(ticketsDir, 'detail.md'), '# Ticket #1\n');
    fs.writeFileSync(path.join(ticketsDir, 'implementation_plan.md'), '# Plan\n- do it\n');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(logPath(), { force: true });
    } catch {}
  });

  // ESEDRE_BG_LAUNCH=spawn keeps the worker a plain detached child so tests stay deterministic.
  const runCli = (args: string[], envOverrides: Record<string, string> = {}) => {
    try {
      const stdout = execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd: tempRepo,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ESEDRE_GLOBAL_DIR: globalDir,
          ESEDRE_BG_LAUNCH: 'spawn',
          ...envOverrides,
        },
      });
      return { stdout, stderr: '', status: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ? err.stdout.toString() : '',
        stderr: err.stderr ? err.stderr.toString() : '',
        status: err.status ?? 1,
      };
    }
  };

  const getTicket = () => JSON.parse(runCli(['get', '1', '--json']).stdout);
  const logPath = () => path.join(globalDir, 'logs', 'worker-thug-1-Core-1.log');
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it('fails loudly, comments, and releases the lease when the worker crashes on startup', () => {
    const res = runCli(
      ['crew', 'dispatch', '1', '--worker', 'thug-1', '--bg', '--exec', 'node -e "process.exit(0)"'],
      { ESEDRE_WORKER_CRASH_FOR_TEST: '1', ESEDRE_BG_LIVENESS_MS: '8000' }
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('exited with code 1');
    expect(res.stderr).toContain('worker-thug-1-Core-1.log');
    expect(res.stdout).not.toContain('Dispatched Ticket');

    const ticket = getTicket();
    expect(ticket.meta.status).toBe('Planned');
    expect(ticket.meta.lease == null).toBe(true);
    const last = ticket.comments[ticket.comments.length - 1].text;
    expect(last).toContain('[Escalation]');
    expect(last).toContain('exited with code 1');
    expect(last).toContain('Simulated worker startup crash');

    expect(fs.existsSync(logPath())).toBe(true);
    expect(readExitMarker(logPath())).toBe(1);
  });

  it('reports a worker that exits 0 but escalated the ticket (failed exec) as a failure', () => {
    const res = runCli(
      ['crew', 'dispatch', '1', '--worker', 'thug-1', '--bg', '--exec', 'node -e "process.exit(3)"'],
      { ESEDRE_BG_LIVENESS_MS: '8000' }
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('escalated the ticket back to Planned');

    const ticket = getTicket();
    expect(ticket.meta.status).toBe('Planned');
    expect(ticket.meta.lease == null).toBe(true);
    expect(fs.existsSync(logPath())).toBe(true);
  });

  it('prints the log path, and the worker finishes and writes an exit marker for a healthy run', async () => {
    const stub = `node -e "setTimeout(()=>require('fs').writeFileSync('alive.txt','x'),1500)"`;
    const res = runCli(['crew', 'dispatch', '1', '--worker', 'thug-1', '--bg', '--exec', stub], {
      ESEDRE_BG_LIVENESS_MS: '300',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Dispatched Ticket #1');
    expect(res.stdout).toContain('worker-thug-1-Core-1.log');

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && readExitMarker(logPath()) === undefined) {
      await sleep(250);
    }
    expect(readExitMarker(logPath())).toBe(0);
    expect(fs.existsSync(path.join(tempRepo, '.worktrees', 'thug-1', 'alive.txt'))).toBe(true);

    const ticket = getTicket();
    expect(ticket.meta.status).toBe('In Development');
    expect(ticket.meta.lease == null).toBe(true);
  }, 40000);

  it('flags a lease whose detached worker PID is gone as STALE in `lease list`', () => {
    expect(runCli(['claim', '1', '--worker', 'thug-1', '--ttl', '30', '--json']).status).toBe(0);

    const deadPid = 2147483000;
    expect(isPidAlive(deadPid)).toBe(false);
    const runDir = path.join(globalDir, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'worker-thug-1-Core-1.json'),
      JSON.stringify({
        pid: deadPid,
        workerId: 'thug-1',
        role: 'thug',
        mode: 'implement',
        ticketId: 1,
        ticketKey: 'Core-1',
        system: 'x',
        startedAt: new Date().toISOString(),
        logFile: logPath(),
      })
    );

    const table = runCli(['lease', 'list']);
    expect(table.status).toBe(0);
    expect(table.stdout).toContain('STALE');
    expect(table.stdout).toContain(String(deadPid));
    expect(table.stdout).toContain('--force');

    const json = JSON.parse(runCli(['lease', 'list', '--json']).stdout);
    expect(json[0].stale).toBe(true);
    expect(json[0].workerPid).toBe(deadPid);
  });

  it('does not flag a lease as stale when no run record exists', () => {
    runCli(['claim', '1', '--worker', 'thug-1', '--ttl', '30', '--json']);
    const json = JSON.parse(runCli(['lease', 'list', '--json']).stdout);
    expect(json[0].stale).toBe(false);
    expect(runCli(['lease', 'list']).stdout).not.toContain('STALE');
  });

  describe('launch helpers', () => {
    it('quotes Windows arguments per CommandLineToArgvW rules', () => {
      expect(quoteWinArg('plain')).toBe('plain');
      expect(quoteWinArg('')).toBe('""');
      expect(quoteWinArg('a b')).toBe('"a b"');
      expect(quoteWinArg('say "hi"')).toBe('"say \\"hi\\""');
      expect(quoteWinArg('trail\\ ')).toBe('"trail\\ "');
      expect(quoteWinArg('dir with space\\')).toBe('"dir with space\\\\"');
      expect(buildWinCommandLine('C:\\Program Files\\node.exe', ['a.mjs', 'two words'])).toBe(
        '"C:\\Program Files\\node.exe" a.mjs "two words"'
      );
    });

    it('forwards only ESEDRE_*, PATH and Windows essentials to a detached worker', () => {
      const env = collectWorkerEnv(
        { ESEDRE_GLOBAL_DIR: '/g', Path: '/bin', SECRET_TOKEN: 'nope', LOCALAPPDATA: 'C:\\L' },
        { ESEDRE_WORKER_ID: 'thug-1' }
      );
      expect(env.ESEDRE_GLOBAL_DIR).toBe('/g');
      expect(env.Path).toBe('/bin');
      expect(env.LOCALAPPDATA).toBe('C:\\L');
      expect(env.ESEDRE_WORKER_ID).toBe('thug-1');
      expect(env.SECRET_TOKEN).toBeUndefined();
    });

    it('reads the last exit marker and tails a log file', () => {
      const f = path.join(tempRepo, 'w.log');
      expect(readExitMarker(f)).toBeUndefined();
      fs.writeFileSync(f, 'one\ntwo\n[esedre-worker exit code=2]\nthree\n[esedre-worker exit code=0]\n');
      expect(readExitMarker(f)).toBe(0);
      expect(tailFile(f, 2)).toBe('three\n[esedre-worker exit code=0]');
      expect(tailFile(path.join(tempRepo, 'missing.log'))).toBe('');
    });
  });
});
