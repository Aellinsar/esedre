import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { spawn, execFileSync } from 'node:child_process';

/**
 * Quotes one argument following CommandLineToArgvW rules (what Node's argv parser reverses).
 */
export function quoteWinArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    out += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  out += '\\'.repeat(backslashes * 2) + '"';
  return out;
}

export function buildWinCommandLine(exe: string, args: string[]): string {
  return [exe, ...args].map(quoteWinArg).join(' ');
}

const ENV_ALLOWLIST = new Set(
  ['path', 'localappdata', 'appdata', 'userprofile', 'homedrive', 'homepath', 'temp', 'tmp', 'systemroot', 'comspec', 'pathext'].map((k) => k)
);

/** Environment forwarded to a worker that is not a child of the dispatching process. */
export function collectWorkerEnv(env: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.toUpperCase().startsWith('ESEDRE_') || ENV_ALLOWLIST.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return { ...out, ...extra };
}

/**
 * Loads and deletes a `--worker-env-file <path>` handed over by `ese crew dispatch --bg`.
 * Must run before configuration is read. Returns true when an env file was applied.
 */
export function applyWorkerEnvFile(argv: string[]): boolean {
  const idx = argv.indexOf('--worker-env-file');
  if (idx === -1 || !argv[idx + 1]) return false;
  const file = argv[idx + 1];
  try {
    const env = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      // already removed
    }
  }
}

/**
 * Redirects this process's console output into a log file and records an exit marker so the
 * dispatcher (and a human) can tell how the worker ended. Returns the open fd for child stdio.
 */
export function attachWorkerLog(logFile: string): number {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  const write = (text: string): void => {
    try {
      fs.writeSync(fd, text);
    } catch {
      // never let logging crash the worker
    }
  };
  const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[method] = (...args: any[]) => write(strip(util.format(...args)) + '\n');
  }
  process.on('uncaughtException', (err) => {
    write(`Uncaught exception: ${(err as Error)?.stack || err}\n`);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    write(`Unhandled rejection: ${(err as Error)?.stack || err}\n`);
    process.exit(1);
  });
  process.on('exit', (code) => write(`[esedre-worker exit code=${code}]\n`));
  return fd;
}

/** Reads the last exit marker written by attachWorkerLog, or undefined when the worker never wrote one. */
export function readExitMarker(logFile: string): number | undefined {
  try {
    const text = fs.readFileSync(logFile, 'utf-8');
    const matches = [...text.matchAll(/\[esedre-worker exit code=(-?\d+)\]/g)];
    if (matches.length === 0) return undefined;
    return parseInt(matches[matches.length - 1][1], 10);
  } catch {
    return undefined;
  }
}

export interface LaunchResult {
  pid: number;
  via: 'wmi' | 'spawn';
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Starts a Windows process outside the caller's job object via Win32_Process.Create.
 *
 * `child_process.spawn({ detached: true })` does not escape a job object, so when the dispatching
 * command runs under a tool or terminal that kills its process tree on exit (agent harnesses, CI
 * runners), the "background" worker dies the moment dispatch returns. WMI parents the new process
 * to the WMI host instead, so it survives.
 */
function launchViaWmi(exe: string, args: string[], cwd: string): number {
  const commandLine = buildWinCommandLine(exe, args);
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]134217728 }",
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; CurrentDirectory = ${psQuote(cwd)}; ProcessStartupInformation = $si }`,
    "if ($r.ReturnValue -ne 0) { throw ('Win32_Process.Create returned ' + $r.ReturnValue) }",
    "[Console]::Out.Write($r.ProcessId)",
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf-8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const pid = parseInt(out.trim(), 10);
  if (!pid || Number.isNaN(pid)) {
    throw new Error(`WMI launch returned no PID (output: ${out.trim() || 'empty'})`);
  }
  return pid;
}

export interface LaunchOptions {
  exe: string;
  args: string[];
  cwd: string;
  /** Log file already opened by the caller for the plain-spawn fallback (stdout and stderr). */
  logFd: number;
  env: NodeJS.ProcessEnv;
  /** Escape hatch for tests: ESEDRE_BG_LAUNCH=spawn forces the plain spawn path. */
  forceSpawn?: boolean;
}

export function launchDetached(opts: LaunchOptions): LaunchResult {
  if (process.platform === 'win32' && !opts.forceSpawn && process.env.ESEDRE_BG_LAUNCH !== 'spawn') {
    try {
      return { pid: launchViaWmi(opts.exe, opts.args, opts.cwd), via: 'wmi' };
    } catch {
      // WMI unavailable or blocked: fall back to a plain detached spawn below
    }
  }
  const child = spawn(opts.exe, opts.args, {
    cwd: opts.cwd,
    detached: true,
    stdio: ['ignore', opts.logFd, opts.logFd],
    windowsHide: true,
    env: opts.env,
  });
  child.unref();
  return { pid: child.pid || 0, via: 'spawn' };
}
