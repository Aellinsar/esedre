import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DaemonState {
  pid: number;
  port: number;
  uiPort?: number;
  apiPort?: number;
  startedAt: string;
  version: string;
  workspaceRoot: string;
  dataDir?: string;
  logFile: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptimeSeconds?: number;
  startedAt?: string;
  workspaceRoot?: string;
  projects?: string[];
  logFile?: string;
  error?: string;
}

/**
 * Returns the centralized user runtime directory (~/.esedre).
 */
export function getGlobalEsedreDir(): string {
  return path.join(os.homedir(), '.esedre');
}

/**
 * Resiliently pre-creates and verifies write access to ~/.esedre/run/ and ~/.esedre/logs/.
 * Never throws an unhandled error; safely cleans up probe files in a finally block.
 */
export function ensureGlobalEsedreStore(): { ok: boolean; path: string; error?: string } {
  const globalDir = getGlobalEsedreDir();
  const runDir = path.join(globalDir, 'run');
  const logsDir = path.join(globalDir, 'logs');

  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Clean up any stale probe files left over from prior aborted runs
    try {
      const runEntries = fs.readdirSync(runDir);
      for (const entry of runEntries) {
        if (entry.startsWith('.probe-')) {
          fs.unlinkSync(path.join(runDir, entry));
        }
      }
    } catch {}

    // Probe write capability
    const testProbe = path.join(runDir, `.probe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    try {
      fs.writeFileSync(testProbe, 'ok', 'utf-8');
      return { ok: true, path: globalDir };
    } finally {
      if (fs.existsSync(testProbe)) {
        try {
          fs.unlinkSync(testProbe);
        } catch {}
      }
    }
  } catch (err: any) {
    return { ok: false, path: globalDir, error: err.message };
  }
}

/**
 * Resolves the active store directory for daemon metadata and logs.
 * Falls back to <workspaceRoot>/.esedre if global directory is inaccessible.
 */
export function resolveStoreDir(workspaceRoot?: string): string {
  const globalStore = ensureGlobalEsedreStore();
  if (globalStore.ok) {
    return globalStore.path;
  }
  if (workspaceRoot) {
    const localStore = path.join(workspaceRoot, '.esedre');
    try {
      fs.mkdirSync(path.join(localStore, 'run'), { recursive: true });
      fs.mkdirSync(path.join(localStore, 'logs'), { recursive: true });
      return localStore;
    } catch {}
  }
  return globalStore.path;
}

export function getDaemonStateFile(port: number, workspaceRoot?: string): string {
  const store = resolveStoreDir(workspaceRoot);
  return path.join(store, 'run', `daemon-${port}.json`);
}

export function getDaemonLogFile(port: number, workspaceRoot?: string): string {
  const store = resolveStoreDir(workspaceRoot);
  return path.join(store, 'logs', `daemon-${port}.log`);
}

/**
 * Reads daemon state file with self-healing recovery.
 * Corrupted or invalid JSON files are automatically purged to prevent stuck re-runs.
 */
export function getDaemonState(port: number, workspaceRoot?: string): DaemonState | null {
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(stateFile, 'utf-8').trim();
    if (!raw) {
      fs.unlinkSync(stateFile);
      return null;
    }
    const state = JSON.parse(raw);
    if (!state || typeof state.pid !== 'number' || typeof state.port !== 'number') {
      fs.unlinkSync(stateFile);
      return null;
    }
    return state;
  } catch {
    // Corrupted state file — wipe it and self-heal
    try {
      fs.unlinkSync(stateFile);
    } catch {}
    return null;
  }
}

/**
 * Checks whether a given process ID is actively alive on the OS.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Calling kill with 0 performs error-checking without sending an actual signal
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM'; // Alive but different permissions
  }
}

/**
 * Performs a fast HTTP probe against the internal Esedre API.
 */
export function pingDaemon(port: number, timeoutMs = 200): Promise<{ responding: boolean; isEsedre: boolean; projects?: string[] }> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/planning/projects`,
      { timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              if (Array.isArray(data)) {
                const projects = data.map((p: any) => p.code || p.name).filter(Boolean);
                resolve({ responding: true, isEsedre: true, projects });
                return;
              }
            } catch {}
            resolve({ responding: true, isEsedre: false });
          } else {
            resolve({ responding: true, isEsedre: false });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ responding: false, isEsedre: false });
    });

    req.on('error', () => {
      resolve({ responding: false, isEsedre: false });
    });
  });
}

export interface StartDaemonOptions {
  port?: number;
  quiet?: boolean;
  workspaceRoot?: string;
}

/**
 * Starts the Esedre daemon in the background detached.
 * Completely idempotent: if already running, logs status (unless quiet) and exits 0.
 */
export async function startDaemon(options: StartDaemonOptions = {}): Promise<DaemonState> {
  const port = options.port || 5674;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  const logFile = getDaemonLogFile(port, workspaceRoot);

  // 1. Check existing state
  const existingState = getDaemonState(port, workspaceRoot);
  if (existingState) {
    if (isProcessAlive(existingState.pid)) {
      const ping = await pingDaemon(port, 400);
      if (ping.responding && ping.isEsedre) {
        if (!options.quiet) {
          console.log(`\x1b[36m⚡ Esedre daemon already running on http://localhost:${port} (PID ${existingState.pid})\x1b[0m`);
        }
        return existingState;
      }
    }
    // Process is dead or not responding as Esedre; clean up stale state
    try {
      fs.unlinkSync(stateFile);
    } catch {}
  }

  // 2. Double-check if port is responding to an unrecorded Esedre instance
  const portPing = await pingDaemon(port, 200);
  if (portPing.responding && portPing.isEsedre) {
    if (!options.quiet) {
      console.log(`\x1b[36m⚡ Esedre server already active on http://localhost:${port}\x1b[0m`);
    }
    return {
      pid: process.pid,
      port,
      startedAt: new Date().toISOString(),
      version: '0.1.0',
      workspaceRoot,
      logFile,
    };
  }

  // 3. Ensure store & log directories exist
  resolveStoreDir(workspaceRoot);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const logFd = fs.openSync(logFile, 'a');

  // 4. Resolve the CLI executable path (guarded against test runners like vitest)
  const isEsedreArgv1 = process.argv[1] && /esedre/i.test(path.basename(process.argv[1]));
  const cliCandidates = [
    isEsedreArgv1 ? process.argv[1] : undefined,
    path.resolve(workspaceRoot, 'dist', 'esedre.mjs'),
    path.resolve(workspaceRoot, '../esedre/dist', 'esedre.mjs'),
    path.resolve(__dirname, 'esedre.mjs'),
    path.resolve(__dirname, '..', 'dist', 'esedre.mjs'),
    path.resolve(__dirname, '..', '..', 'dist', 'esedre.mjs'),
    path.resolve(__dirname, '..', '..', 'bin', 'esedre.js'),
    path.resolve(__dirname, '..', '..', 'bin', 'esedre.ts'),
    path.resolve(__dirname, '..', 'esedre.mjs'),
    path.resolve(__dirname, '../../../esedre/dist', 'esedre.mjs'),
  ].filter(Boolean) as string[];
  const cliPath = cliCandidates.find((c) => fs.existsSync(c) && (c.endsWith('.mjs') || c.endsWith('.js') || c.endsWith('.ts'))) || cliCandidates[0];
  if (!fs.existsSync(cliPath)) {
    throw new Error(`Could not locate Esedre executable. Searched candidates: ${cliCandidates.join(', ')}`);
  }

  // 5. Spawn background detached process
  const child = spawn(process.execPath, [cliPath, 'serve', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: workspaceRoot,
    env: { ...process.env },
    windowsHide: true,
  });

  child.unref();

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn Esedre daemon background process.');
  }

  // 6. Poll for daemon readiness (up to 3500ms timeout)
  const startTime = Date.now();
  let ready = false;
  while (Date.now() - startTime < 3500) {
    await new Promise((r) => setTimeout(r, 100));
    const ping = await pingDaemon(port, 150);
    if (ping.responding && ping.isEsedre) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { shell: false });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {}
    throw new Error(`Esedre daemon failed to start on port ${port} within timeout. Check logs at: ${logFile}`);
  }

  // 7. Write state file
  const state: DaemonState = {
    pid,
    port,
    uiPort: port + 1,
    apiPort: port + 2,
    startedAt: new Date().toISOString(),
    version: '0.1.0',
    workspaceRoot,
    logFile,
  };

  const tmpState = `${stateFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpState, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  try {
    fs.renameSync(tmpState, stateFile);
  } catch {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    try { fs.unlinkSync(tmpState); } catch {}
  }

  if (!options.quiet) {
    console.log(`\x1b[32m✔ Started Esedre background daemon on http://localhost:${port} (PID ${pid})\x1b[0m`);
    console.log(`  • Web UI:   http://localhost:${port}`);
    console.log(`  • Logs:     ${logFile}`);
  }

  return state;
}

export interface StopDaemonOptions {
  port?: number;
  quiet?: boolean;
  workspaceRoot?: string;
}

/**
 * Gracefully stops the background daemon process and cleans up state files.
 */
export async function stopDaemon(options: StopDaemonOptions = {}): Promise<boolean> {
  const port = options.port || 5674;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  const state = getDaemonState(port, workspaceRoot);

  let pid = state?.pid;

  if (!pid) {
    // Check if anything is responding on port
    const ping = await pingDaemon(port, 200);
    if (!ping.responding) {
      if (!options.quiet) {
        console.log(`\x1b[33m○ Esedre daemon is not running on port ${port}.\x1b[0m`);
      }
      return false;
    }
  }

  if (pid && isProcessAlive(pid)) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { shell: false, stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch (err: any) {
      console.warn(`Warning terminating PID ${pid}: ${err.message}`);
    }
    // Poll briefly to ensure process is dead and port is freed
    const stopStart = Date.now();
    while (isProcessAlive(pid) && Date.now() - stopStart < 2000) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Clean up state file
  try {
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }
  } catch {}

  if (!options.quiet) {
    console.log(`\x1b[32m✔ Stopped Esedre daemon on port ${port}${pid ? ` (PID ${pid})` : ''}\x1b[0m`);
  }

  return true;
}

/**
 * Returns diagnostic status of the daemon.
 */
export async function getDaemonStatus(options: { port?: number; json?: boolean; workspaceRoot?: string } = {}): Promise<DaemonStatus> {
  const port = options.port || 5674;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const state = getDaemonState(port, workspaceRoot);
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  const logFile = getDaemonLogFile(port, workspaceRoot);

  const ping = await pingDaemon(port, 300);

  if (state && isProcessAlive(state.pid) && ping.responding && ping.isEsedre) {
    const startedMs = Date.parse(state.startedAt) || Date.now();
    const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));

    return {
      running: true,
      pid: state.pid,
      port: state.port,
      uptimeSeconds,
      startedAt: state.startedAt,
      workspaceRoot: state.workspaceRoot,
      projects: ping.projects,
      logFile: state.logFile || logFile,
    };
  }

  // Clean up stale state file if process died
  if (state && !isProcessAlive(state.pid)) {
    try {
      fs.unlinkSync(stateFile);
    } catch {}
  }

  return {
    running: ping.responding && ping.isEsedre,
    port,
    projects: ping.projects,
    logFile,
  };
}

/**
 * Reads and prints recent daemon log lines.
 */
export function printDaemonLogs(options: { port?: number; lines?: number; workspaceRoot?: string } = {}): void {
  const port = options.port || 5674;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const logFile = getDaemonLogFile(port, workspaceRoot);

  if (!fs.existsSync(logFile)) {
    console.log(`\x1b[33mNo logs found at: ${logFile}\x1b[0m`);
    return;
  }

  const content = fs.readFileSync(logFile, 'utf-8');
  const count = options.lines || 40;
  const allLines = content.split(/\r?\n/);
  const tail = allLines.slice(-count).join('\n');

  console.log(`\x1b[36m--- Esedre Daemon Logs (${logFile}) ---\x1b[0m\n`);
  console.log(tail);
}
