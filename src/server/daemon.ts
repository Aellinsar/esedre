import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePorts, getGlobalConfigDir, normalizeRemoteHostUrl, readGlobalConfig } from '../config.js';
import { CURRENT_ESEDRE_VERSION, GitSyncStatusReport } from '../types.js';
import { getGitSyncStatusReport } from '../sync/gitSync.js';

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
  remote?: boolean;
  host?: string;
  pid?: number;
  port?: number;
  uptimeSeconds?: number;
  startedAt?: string;
  workspaceRoot?: string;
  projects?: string[];
  logFile?: string;
  version?: string;
  schemaVersion?: string;
  staleVersion?: boolean;
  installedVersion?: string;
  sync?: GitSyncStatusReport;
  error?: string;
}

/**
 * Returns the centralized user runtime directory (~/.esedre), respecting ESEDRE_GLOBAL_DIR and VITEST isolation.
 */
export function getGlobalEsedreDir(): string {
  return getGlobalConfigDir();
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
    // Corrupted state file - wipe it and self-heal
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
export function pingDaemon(port: number, timeoutMs = 1000): Promise<{ responding: boolean; isEsedre: boolean; projects?: string[] }> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/planning/projects`,
      { timeout: timeoutMs, agent: false },
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

function fetchDaemonPid(port: number, timeoutMs = 1000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/ping`,
      { timeout: timeoutMs, agent: false },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.esedre && typeof data.pid === 'number' && data.pid > 0) {
              resolve(data.pid);
              return;
            }
          } catch {}
          resolve(undefined);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
    req.on('error', () => {
      resolve(undefined);
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
  const port = resolvePorts(undefined, { port: options.port }).gateway;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  const logFile = getDaemonLogFile(port, workspaceRoot);

  // 1. Check existing state
  const existingState = getDaemonState(port, workspaceRoot);
  if (existingState) {
    if (isProcessAlive(existingState.pid)) {
      const ping = await pingDaemon(port, 3000);
      if (ping.responding && ping.isEsedre) {
        if (!options.quiet) {
          console.log(`\x1b[36m⚡ Esedre daemon already running on http://localhost:${port} (PID ${existingState.pid})\x1b[0m`);
          if (existingState.version && existingState.version !== CURRENT_ESEDRE_VERSION) {
            console.log(`\x1b[33m⚠️  Warning: Daemon is running v${existingState.version}, but v${CURRENT_ESEDRE_VERSION} is installed. Run 'ese stop && ese start' to reload.\x1b[0m`);
          }
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
  const portPing = await pingDaemon(port, 500);
  if (portPing.responding && portPing.isEsedre) {
    const discoveredPid = (await fetchDaemonPid(port, 1000)) || process.pid;
    if (!options.quiet) {
      console.log(`\x1b[36m⚡ Esedre server already active on http://localhost:${port}\x1b[0m`);
    }
    return {
      pid: discoveredPid,
      port,
      startedAt: new Date().toISOString(),
      version: CURRENT_ESEDRE_VERSION,
      workspaceRoot,
      logFile,
    };
  }

  // 3. Ensure store & log directories exist
  resolveStoreDir(workspaceRoot);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  // Rotate log if it exceeds 10MB to prevent log bloat
  const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;
  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > MAX_LOG_SIZE_BYTES) {
        const oldLogFile = `${logFile}.old`;
        try {
          if (fs.existsSync(oldLogFile)) fs.unlinkSync(oldLogFile);
          fs.renameSync(logFile, oldLogFile);
        } catch {
          fs.truncateSync(logFile, 0);
        }
      }
    }
  } catch {}

  const logFd = fs.openSync(logFile, 'a');

  // 4. Resolve the CLI executable path (guarded against test runners like vitest)
  const isEsedreArgv1 = process.argv[1] && /esedre/i.test(path.basename(process.argv[1]));
  const cliCandidates = [
    isEsedreArgv1 ? path.resolve(process.argv[1]) : undefined,
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
  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: workspaceRoot,
    env: { ...process.env },
    windowsHide: true,
  });

  child.unref();

  // Close parent file descriptor so Windows file lock is released
  try {
    fs.closeSync(logFd);
  } catch {}

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn Esedre daemon background process.');
  }

  // 6. Poll for daemon readiness (up to 10000ms timeout on Windows, 5000ms elsewhere)
  const timeoutMs = process.platform === 'win32' ? 10000 : 5000;
  const pingTimeout = process.platform === 'win32' ? 500 : 300;
  const startTime = Date.now();
  let ready = false;
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    const ping = await pingDaemon(port, pingTimeout);
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
    version: CURRENT_ESEDRE_VERSION,
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
  const port = resolvePorts(undefined, { port: options.port }).gateway;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  const state = getDaemonState(port, workspaceRoot);

  let pid = state?.pid;

  if (!pid) {
    // Check if anything is responding on port
    const ping = await pingDaemon(port, 1000);
    if (!ping.responding) {
      if (!options.quiet) {
        console.log(`\x1b[33m○ Esedre daemon is not running on port ${port}.\x1b[0m`);
      }
      return false;
    }

    // 1. Primary cross-platform PID resolution via GET /api/ping (works even when lsof is absent)
    pid = await fetchDaemonPid(port, 1000);

    // 2. Fallback to OS network tables if /api/ping did not return a PID
    if (!pid) {
      try {
        if (process.platform === 'win32') {
          const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout || '';
          const lines = out.split('\n');
          for (const line of lines) {
            if (line.includes(`:${port}`) && line.includes('LISTENING')) {
              const parts = line.trim().split(/\s+/);
              const foundPid = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(foundPid) && foundPid > 0) {
                pid = foundPid;
                break;
              }
            }
          }
        } else {
          const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout || '';
          const foundPid = parseInt(out.trim().split('\n')[0], 10);
          if (!isNaN(foundPid) && foundPid > 0) pid = foundPid;
        }
      } catch {}
    }
  }

  if (pid && isProcessAlive(pid)) {
    try {
      if (process.platform === 'win32') {
        const tk = spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { shell: false, stdio: 'ignore' });
        if (tk.error || tk.status !== 0) {
          try {
            process.kill(pid);
          } catch {}
        }
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

    if (isProcessAlive(pid)) {
      if (!options.quiet) {
        console.error(
          `\x1b[33m⚠️  Could not stop Esedre daemon on port ${port} (PID ${pid}): Access denied (process may be running in an elevated Administrator session).\x1b[0m`
        );
      }
      return false;
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
  const port = resolvePorts(undefined, { port: options.port }).gateway;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const state = getDaemonState(port, workspaceRoot);
  const stateFile = getDaemonStateFile(port, workspaceRoot);
  const logFile = getDaemonLogFile(port, workspaceRoot);

  let ping = await pingDaemon(port, 3000);
  if (state && isProcessAlive(state.pid) && !ping.responding) {
    await new Promise((r) => setTimeout(r, 150));
    ping = await pingDaemon(port, 3000);
  }

  if (state && isProcessAlive(state.pid) && ping.responding && ping.isEsedre) {
    const startedMs = Date.parse(state.startedAt) || Date.now();
    const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));

    const daemonVersion = state.version;
    const isStale = Boolean(daemonVersion && daemonVersion !== CURRENT_ESEDRE_VERSION);
    let syncStatus: GitSyncStatusReport | undefined;
    try {
      syncStatus = await getGitSyncStatusReport(readGlobalConfig());
    } catch {}

    return {
      running: true,
      pid: state.pid,
      port: state.port,
      uptimeSeconds,
      startedAt: state.startedAt,
      workspaceRoot: state.workspaceRoot,
      projects: ping.projects,
      logFile: state.logFile || logFile,
      version: daemonVersion,
      staleVersion: isStale,
      installedVersion: CURRENT_ESEDRE_VERSION,
      ...(syncStatus ? { sync: syncStatus } : {}),
    };
  }

  // Clean up stale state file if process died
  if (state && !isProcessAlive(state.pid)) {
    try {
      fs.unlinkSync(stateFile);
    } catch {}
  }

  let livePingData: any = null;
  if (ping.responding && ping.isEsedre) {
    try {
      const res = await fetchJsonEndpoint(`http://127.0.0.1:${port}/api/ping`, 500);
      if (res.status === 200 && res.data?.esedre) {
        livePingData = res.data;
      }
    } catch {}
  }

  let syncStatus: GitSyncStatusReport | undefined;
  try {
    syncStatus = await getGitSyncStatusReport(readGlobalConfig());
  } catch {}

  const effectiveVersion = state?.version || livePingData?.version;
  return {
    running: ping.responding && ping.isEsedre,
    pid: typeof livePingData?.pid === 'number' ? livePingData.pid : undefined,
    port,
    uptimeSeconds: typeof livePingData?.uptimeSeconds === 'number' ? livePingData.uptimeSeconds : undefined,
    startedAt: typeof livePingData?.startedAt === 'string' ? livePingData.startedAt : undefined,
    projects: ping.projects,
    logFile,
    version: effectiveVersion,
    staleVersion: Boolean(effectiveVersion && effectiveVersion !== CURRENT_ESEDRE_VERSION),
    installedVersion: CURRENT_ESEDRE_VERSION,
    ...(syncStatus ? { sync: syncStatus } : {}),
  };
}

function fetchJsonEndpoint(urlStr: string, timeoutMs: number): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.get(parsedUrl, { timeout: timeoutMs, agent: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 500, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode || 500, data: null });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

/**
 * Probes a remote Esedre daemon host for health, version, uptime, and registered projects.
 */
export async function getRemoteDaemonStatus(
  remoteHost: string,
  timeoutMs = 2500
): Promise<DaemonStatus> {
  const host = normalizeRemoteHostUrl(remoteHost) || remoteHost;
  let parsedPort: number | undefined;
  try {
    const u = new URL(host);
    parsedPort = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
  } catch {}

  try {
    const [pingRes, projRes, syncRes] = await Promise.all([
      fetchJsonEndpoint(`${host}/api/ping`, timeoutMs),
      fetchJsonEndpoint(`${host}/api/planning/projects`, timeoutMs).catch(() => ({
        status: 500,
        data: null,
      })),
      fetchJsonEndpoint(`${host}/api/planning/sync/status`, timeoutMs).catch(() => ({
        status: 500,
        data: null,
      })),
    ]);

    const pingData = pingRes.data;
    const isRunning = Boolean(pingRes.status === 200 && pingData && pingData.esedre);
    const projects = Array.isArray(projRes.data)
      ? projRes.data.map((p: any) => p.code || p.name).filter(Boolean)
      : undefined;
    const remoteVersion = pingData?.version;
    const staleVersion = Boolean(remoteVersion && remoteVersion !== CURRENT_ESEDRE_VERSION);
    const syncStatus: GitSyncStatusReport | undefined =
      syncRes.status === 200 && syncRes.data && Array.isArray(syncRes.data.hubs)
        ? syncRes.data
        : undefined;

    return {
      running: isRunning,
      remote: true,
      host,
      pid: typeof pingData?.pid === 'number' ? pingData.pid : undefined,
      port: parsedPort,
      uptimeSeconds: typeof pingData?.uptimeSeconds === 'number' ? pingData.uptimeSeconds : undefined,
      startedAt: typeof pingData?.startedAt === 'string' ? pingData.startedAt : undefined,
      projects,
      version: remoteVersion,
      schemaVersion: typeof pingData?.schemaVersion === 'string' ? pingData.schemaVersion : undefined,
      staleVersion,
      installedVersion: CURRENT_ESEDRE_VERSION,
      ...(syncStatus ? { sync: syncStatus } : {}),
    };
  } catch (err: any) {
    return {
      running: false,
      remote: true,
      host,
      port: parsedPort,
      installedVersion: CURRENT_ESEDRE_VERSION,
      error: err.code || err.message,
    };
  }
}

/**
 * Reads and prints recent daemon log lines with log bloat protection and terminal escape sanitization.
 */
export function printDaemonLogs(options: { port?: number; lines?: number; workspaceRoot?: string } = {}): void {
  const port = resolvePorts(undefined, { port: options.port }).gateway;
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const logFile = getDaemonLogFile(port, workspaceRoot);

  if (!fs.existsSync(logFile)) {
    console.log(`\x1b[33mNo logs found at: ${logFile}\x1b[0m`);
    return;
  }

  const count = options.lines || 40;
  let content = '';

  try {
    const stats = fs.statSync(logFile);
    // Read only the last chunk of the file (max 256KB or estimated bytes based on line count)
    const maxReadBytes = Math.min(stats.size, Math.max(256 * 1024, count * 2048));
    if (stats.size <= maxReadBytes) {
      content = fs.readFileSync(logFile, 'utf-8');
    } else {
      const fd = fs.openSync(logFile, 'r');
      const buffer = Buffer.alloc(maxReadBytes);
      fs.readSync(fd, buffer, 0, maxReadBytes, stats.size - maxReadBytes);
      fs.closeSync(fd);
      content = buffer.toString('utf-8');
    }
  } catch {
    content = fs.readFileSync(logFile, 'utf-8');
  }

  const allLines = content.split(/\r?\n/);
  // Sanitize lines against terminal log escape injection
  // Strip ANSI CSI escape sequences, OSC sequences, and standalone CRs that attempt to overwrite terminal lines
  const sanitizedLines = allLines.slice(-count).map((line) => {
    return line
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Strip CSI sequences
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // Strip OSC sequences
      .replace(/\r(?!\n)/g, '') // Strip naked carriage returns that overwrite line starts
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Strip control characters except tab and newline
  });

  console.log(`\x1b[36m--- Esedre Daemon Logs (${logFile}) ---\x1b[0m\n`);
  console.log(sanitizedLines.join('\n'));
}
