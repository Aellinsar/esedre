import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import {
  EsedreConfig,
  getGlobalConfigDir,
  readGlobalConfig,
  resolveGitSyncConfig,
  resolvePorts,
  expandHome,
  validateGitRemoteName,
  validateGitBranchName,
} from '../config.js';
import {
  GitSyncConfig,
  GitSyncHubMetrics,
  GitSyncHubStatus,
  GitSyncResult,
  GitSyncStatusReport,
  GitSyncStatusState,
  SyncMutationEvent,
} from '../types.js';
import { formatSyncCommitMessage } from './commitMessage.js';

const MAX_SYNC_HISTORY_ENTRIES = 20;
const MAX_PERSISTED_HUBS = 25;

export function sanitizeGitLogText(raw?: string | null, maxLength = 350): string {
  if (!raw || typeof raw !== 'string') return '';
  const redacted = raw
    .replace(/(https?:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\b(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(token|password|secret|authorization)\s*[:=]\s*[^\s'"]+/gi, '$1=[REDACTED]')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 3)}...` : redacted;
}

export interface ExecGitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function execGit(
  hubDir: string,
  args: string[],
  timeoutMs = 15000
): Promise<ExecGitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-pager', '-C', hubDir, ...args],
      {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          LC_ALL: 'C',
        },
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const outStr = typeof stdout === 'string' ? stdout.trim() : '';
        const errStr = typeof stderr === 'string' ? stderr.trim() : '';
        if (!err) {
          resolve({ code: 0, stdout: outStr, stderr: errStr });
          return;
        }
        const exitCode = typeof (err as any).code === 'number' ? (err as any).code : 1;
        resolve({
          code: exitCode,
          stdout: outStr,
          stderr: errStr || err.message || 'Git command failed',
        });
      }
    );
  });
}

export function normalizeRealPath(p: string): string {
  const realFn = typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native : fs.realpathSync;
  const initial = path.resolve(p);
  const tailSegments: string[] = [];
  let current = initial;
  while (true) {
    try {
      if (fs.existsSync(current)) {
        const real = realFn(current);
        const joined = (tailSegments.length > 0 ? path.join(real, ...tailSegments) : real)
          .normalize('NFC')
          .replace(/\\/g, '/')
          .replace(/\/+$/, '');
        return process.platform === 'win32' || process.platform === 'darwin' ? joined.toLowerCase() : joined;
      }
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    tailSegments.unshift(path.basename(current));
    current = parent;
  }
  const abs = initial.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs;
}

export interface HubVerificationResult {
  valid: boolean;
  hubDir: string;
  branch?: string;
  reason?: string;
}

export async function verifyDataHubGitRepo(hubDir: string): Promise<HubVerificationResult> {
  const resolvedHub = path.resolve(expandHome(hubDir));
  if (!fs.existsSync(resolvedHub)) {
    return {
      valid: false,
      hubDir: resolvedHub,
      reason: `Data hub directory does not exist: ${resolvedHub}`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedHub);
  } catch (err: any) {
    return {
      valid: false,
      hubDir: resolvedHub,
      reason: `Cannot stat data hub directory: ${err.message}`,
    };
  }
  if (!stat.isDirectory()) {
    return {
      valid: false,
      hubDir: resolvedHub,
      reason: `Data hub path is not a directory: ${resolvedHub}`,
    };
  }

  const hasHubMarker =
    fs.existsSync(path.join(resolvedHub, '.esedre-hub')) ||
    fs.existsSync(path.join(resolvedHub, 'projects.json')) ||
    fs.existsSync(path.join(resolvedHub, 'projects'));

  if (!hasHubMarker) {
    return {
      valid: false,
      hubDir: resolvedHub,
      reason: `Refusing to auto-sync: "${resolvedHub}" does not contain Esedre data hub markers (projects/, projects.json, or .esedre-hub).`,
    };
  }

  const hasExplicitHubFile = fs.existsSync(path.join(resolvedHub, '.esedre-hub'));
  if (!hasExplicitHubFile) {
    const workspaceConfigCandidates = [
      path.join(resolvedHub, '.esedre', 'esedre.json'),
      path.join(resolvedHub, 'esedre.json'),
    ];
    for (const cand of workspaceConfigCandidates) {
      if (fs.existsSync(cand)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
          if (parsed && typeof parsed.projectCode === 'string' && parsed.projectCode.trim()) {
            return {
              valid: false,
              hubDir: resolvedHub,
              reason: `Refusing to auto-sync: "${resolvedHub}" is a project workspace (projectCode: ${parsed.projectCode}), not a dedicated data hub repository.`,
            };
          }
        } catch {}
      }
    }

    const pkgJsonPath = path.join(resolvedHub, 'package.json');
    if (fs.existsSync(pkgJsonPath) && fs.existsSync(path.join(resolvedHub, 'src'))) {
      return {
        valid: false,
        hubDir: resolvedHub,
        reason: `Refusing to auto-sync: "${resolvedHub}" appears to be an application source code repository (contains package.json and src/).`,
      };
    }
  }

  // Fast path: query top-level, git-dir, and active branch in a single git spawn when HEAD exists
  let topLevelStdout = '';
  let gitDirStdout = '';
  let branch = 'main';
  let resolvedFast = false;

  const combinedRev = await execGit(resolvedHub, [
    'rev-parse',
    '--show-toplevel',
    '--git-dir',
    '--abbrev-ref',
    'HEAD',
  ]);
  if (combinedRev.code === 0 && combinedRev.stdout) {
    const revLines = combinedRev.stdout.split(/\r?\n/).map((l) => l.trim());
    if (revLines.length >= 3 && revLines[0] && revLines[1] && revLines[2]) {
      topLevelStdout = revLines[0];
      gitDirStdout = revLines[1];
      if (revLines[2] === 'HEAD') {
        return {
          valid: false,
          hubDir: resolvedHub,
          reason: `Git repository at "${resolvedHub}" is in detached HEAD state.`,
        };
      }
      branch = revLines[2];
      resolvedFast = true;
    }
  }

  if (!resolvedFast) {
    const topLevelRes = await execGit(resolvedHub, ['rev-parse', '--show-toplevel']);
    if (topLevelRes.code !== 0 || !topLevelRes.stdout) {
      return {
        valid: false,
        hubDir: resolvedHub,
        reason: `Data hub "${resolvedHub}" is not a Git repository.`,
      };
    }
    topLevelStdout = topLevelRes.stdout;

    const gitDirRes = await execGit(resolvedHub, ['rev-parse', '--git-dir']);
    gitDirStdout = gitDirRes.code === 0 ? gitDirRes.stdout : '';

    const symRef = await execGit(resolvedHub, ['symbolic-ref', '--short', 'HEAD']);
    if (symRef.code === 0 && symRef.stdout) {
      branch = symRef.stdout.trim();
    } else {
      const revAbbrev = await execGit(resolvedHub, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (revAbbrev.code === 0 && revAbbrev.stdout === 'HEAD') {
        return {
          valid: false,
          hubDir: resolvedHub,
          reason: `Git repository at "${resolvedHub}" is in detached HEAD state.`,
        };
      }
    }
  }

  const normHub = normalizeRealPath(resolvedHub);
  const normTop = normalizeRealPath(topLevelStdout);
  if (normHub !== normTop) {
    return {
      valid: false,
      hubDir: resolvedHub,
      reason: `Refusing to auto-sync: "${resolvedHub}" is a subdirectory inside parent Git repository "${topLevelStdout}" rather than a standalone data hub repository.`,
    };
  }

  const gitDir = gitDirStdout
    ? path.resolve(resolvedHub, gitDirStdout)
    : path.join(resolvedHub, '.git');

  if (
    fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
    fs.existsSync(path.join(gitDir, 'rebase-apply')) ||
    fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))
  ) {
    return {
      valid: false,
      hubDir: resolvedHub,
      reason: `Git repository at "${resolvedHub}" has an unfinished rebase or merge in progress.`,
    };
  }

  return {
    valid: true,
    hubDir: resolvedHub,
    branch,
  };
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function resolveGitInternalDir(dirPath: string): string | null {
  const resolved = path.resolve(expandHome(dirPath));
  const dotGit = path.join(resolved, '.git');
  try {
    if (!fs.existsSync(dotGit)) return null;
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    if (st.isFile()) {
      const raw = fs.readFileSync(dotGit, 'utf-8');
      const match = raw.match(/^gitdir:\s*(.+)$/im);
      if (match && match[1]) {
        const target = path.resolve(resolved, match[1].trim());
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
          return target;
        }
      }
    }
  } catch {}
  return null;
}

function enqueueInProcessMutex<T>(
  chains: Map<string, Promise<void>>,
  normKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = chains.get(normKey) ?? Promise.resolve();
  let releaseNext!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  const tail = prev.then(() => currentGate, () => currentGate);
  chains.set(normKey, tail);

  return prev
    .catch(() => {})
    .then(() => fn())
    .finally(() => {
      releaseNext();
      if (chains.get(normKey) === tail) {
        chains.delete(normKey);
      }
    });
}

async function acquireCrossProcessLockFile(
  lockPath: string,
  maxWaitMs: number,
  staleAgeMs: number,
  pollIntervalMs: number,
  lockLabel: string
): Promise<() => void> {
  const deadline = Date.now() + maxWaitMs;
  const lockToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  let acquired = false;

  while (Date.now() <= deadline) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          acquiredAt: Date.now(),
          token: lockToken,
        }),
        'utf-8'
      );
      fs.closeSync(fd);
      acquired = true;
      break;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw err;
      }
      if (err.code !== 'EEXIST') {
        throw err;
      }
      try {
        const raw = fs.readFileSync(lockPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const age = Date.now() - (Number(parsed.acquiredAt) || 0);
        const sameHost =
          typeof parsed.hostname === 'string' &&
          parsed.hostname.toLowerCase() === os.hostname().toLowerCase();
        if (age > staleAgeMs || (sameHost && !isPidAlive(Number(parsed.pid)))) {
          try {
            fs.unlinkSync(lockPath);
          } catch {}
          continue;
        }
      } catch {
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > staleAgeMs) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {}
      }
      await sleep(pollIntervalMs);
    }
  }

  if (!acquired) {
    throw new Error(`Timed out waiting for ${lockLabel} at ${lockPath}`);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (fs.existsSync(lockPath)) {
        const raw = fs.readFileSync(lockPath, 'utf-8');
        try {
          const parsed = JSON.parse(raw);
          if (parsed.token && parsed.token !== lockToken) {
            return;
          }
        } catch {}
        fs.unlinkSync(lockPath);
      }
    } catch {}
  };
}

const syncChains = new Map<string, Promise<void>>();
const worktreeChains = new Map<string, Promise<void>>();
const activeWorktreeLocks = new AsyncLocalStorage<Map<string, { active: boolean }>>();

export async function withHubSyncLock<T>(
  hubDir: string,
  fn: () => Promise<T>,
  maxWaitMs = 95000
): Promise<T> {
  const resolvedHub = path.resolve(expandHome(hubDir));
  const normKey = normalizeRealPath(resolvedHub);

  return enqueueInProcessMutex(syncChains, normKey, async () => {
    const gitInternalDir = resolveGitInternalDir(resolvedHub);
    const lockDir = gitInternalDir || resolvedHub;
    if (!fs.existsSync(lockDir)) {
      return fn();
    }
    const lockPath = path.join(lockDir, 'esedre-sync.lock');
    const releaseFile = await acquireCrossProcessLockFile(
      lockPath,
      maxWaitMs,
      120000,
      75,
      'Git sync lock'
    );
    try {
      return await fn();
    } finally {
      releaseFile();
    }
  });
}

export interface WorkingTreeLockOptions {
  maxWaitMs?: number;
  crossProcess?: boolean;
}

export async function withHubWorkingTreeLock<T>(
  dirPath: string,
  fn: () => Promise<T>,
  optionsOrMaxWait?: WorkingTreeLockOptions | number
): Promise<T> {
  const resolvedDir = path.resolve(expandHome(dirPath));
  const normKey = normalizeRealPath(resolvedDir);
  const currentStore = activeWorktreeLocks.getStore();
  if (currentStore?.get(normKey)?.active) {
    return fn();
  }

  const maxWaitMs =
    typeof optionsOrMaxWait === 'number'
      ? optionsOrMaxWait
      : (optionsOrMaxWait?.maxWaitMs ?? 30000);
  const crossProcess =
    typeof optionsOrMaxWait === 'object' && optionsOrMaxWait !== null
      ? optionsOrMaxWait.crossProcess !== false
      : true;

  return enqueueInProcessMutex(worktreeChains, normKey, async () => {
    let releaseFile: (() => void) | undefined;
    if (crossProcess) {
      const gitInternalDir = resolveGitInternalDir(resolvedDir);
      if (gitInternalDir && fs.existsSync(gitInternalDir)) {
        const lockPath = path.join(gitInternalDir, 'esedre-worktree.lock');
        releaseFile = await acquireCrossProcessLockFile(
          lockPath,
          maxWaitMs,
          60000,
          20,
          'data hub working-tree lock'
        );
      }
    }

    const token = { active: true };
    const nextStore = new Map(activeWorktreeLocks.getStore());
    nextStore.set(normKey, token);

    try {
      return await activeWorktreeLocks.run(nextStore, fn);
    } finally {
      token.active = false;
      if (releaseFile) {
        releaseFile();
      }
    }
  });
}

export async function withMultiDirectoryLocks<T>(
  targets: Array<{ dir: string; crossProcess?: boolean }>,
  fn: () => Promise<T>,
  maxWaitMs = 30000
): Promise<T> {
  const deduped = new Map<string, { dir: string; crossProcess: boolean }>();
  for (const t of targets) {
    if (!t.dir) continue;
    const resolved = path.resolve(expandHome(t.dir));
    const key = normalizeRealPath(resolved);
    const prev = deduped.get(key);
    if (!prev) {
      deduped.set(key, { dir: resolved, crossProcess: Boolean(t.crossProcess) });
    } else if (t.crossProcess) {
      prev.crossProcess = true;
    }
  }

  const ordered = Array.from(deduped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, val]) => val);

  if (ordered.length === 0) {
    return fn();
  }

  const runNested = (idx: number): Promise<T> => {
    if (idx >= ordered.length) {
      return fn();
    }
    const item = ordered[idx];
    return withHubWorkingTreeLock(
      item.dir,
      () => runNested(idx + 1),
      { maxWaitMs, crossProcess: item.crossProcess }
    );
  };

  return runNested(0);
}

export function getSyncStatusFilePath(): string {
  return path.join(getGlobalConfigDir(), 'sync-status.json');
}

interface PersistedSyncHistoryEntry {
  timestamp: string;
  status: GitSyncStatusState;
  committed: boolean;
  pulled: boolean;
  pushed: boolean;
  commitSha?: string;
  durationMs: number;
}

interface PersistedSyncStateMap {
  [normalizedHubDir: string]: {
    hubDir: string;
    status: GitSyncStatusState;
    lastCommitSha?: string;
    lastCommitMessage?: string;
    lastSyncedAt?: string;
    lastError?: string;
    metrics?: GitSyncHubMetrics;
    recentHistory?: PersistedSyncHistoryEntry[];
  };
}

function readPersistedSyncState(): PersistedSyncStateMap {
  const filePath = getSyncStatusFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedSyncStateMap;
  } catch {
    return {};
  }
}

function writePersistedHubSyncState(
  hubDir: string,
  update: {
    status: GitSyncStatusState;
    lastCommitSha?: string;
    lastCommitMessage?: string;
    lastSyncedAt?: string;
    lastError?: string;
    committed?: boolean;
    pulled?: boolean;
    pushed?: boolean;
    durationMs?: number;
  }
): void {
  try {
    const dir = getGlobalConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const current = readPersistedSyncState();
    const key = normalizeRealPath(hubDir);
    const prev = current[key] || { hubDir, status: 'idle' };
    const prevMetrics: GitSyncHubMetrics = prev.metrics || {
      totalSyncs: 0,
      totalCommits: 0,
      totalPulls: 0,
      totalPushes: 0,
      totalConflicts: 0,
      totalErrors: 0,
    };

    const nextMetrics: GitSyncHubMetrics = {
      totalSyncs: prevMetrics.totalSyncs + 1,
      totalCommits: prevMetrics.totalCommits + (update.committed ? 1 : 0),
      totalPulls: prevMetrics.totalPulls + (update.pulled ? 1 : 0),
      totalPushes: prevMetrics.totalPushes + (update.pushed ? 1 : 0),
      totalConflicts: prevMetrics.totalConflicts + (update.status === 'conflict' ? 1 : 0),
      totalErrors: prevMetrics.totalErrors + (update.status === 'error' ? 1 : 0),
      ...(update.durationMs !== undefined ? { lastDurationMs: update.durationMs } : prevMetrics.lastDurationMs !== undefined ? { lastDurationMs: prevMetrics.lastDurationMs } : {}),
    };

    const historyEntry: PersistedSyncHistoryEntry = {
      timestamp: new Date().toISOString(),
      status: update.status,
      committed: Boolean(update.committed),
      pulled: Boolean(update.pulled),
      pushed: Boolean(update.pushed),
      ...(update.lastCommitSha ? { commitSha: update.lastCommitSha } : {}),
      durationMs: update.durationMs ?? 0,
    };

    const prevHistory = Array.isArray(prev.recentHistory) ? prev.recentHistory : [];
    const nextHistory = [...prevHistory, historyEntry].slice(-MAX_SYNC_HISTORY_ENTRIES);

    const sanitizedError = update.lastError ? sanitizeGitLogText(update.lastError) : undefined;

    current[key] = {
      hubDir,
      status: update.status,
      lastCommitSha: update.lastCommitSha ?? prev.lastCommitSha,
      lastCommitMessage: update.lastCommitMessage ? sanitizeGitLogText(update.lastCommitMessage, 120) : prev.lastCommitMessage,
      lastSyncedAt: update.lastSyncedAt ?? prev.lastSyncedAt,
      lastError: sanitizedError,
      metrics: nextMetrics,
      recentHistory: nextHistory,
    };

    // Bound total number of tracked hubs in sync-status.json to prevent unbounded file growth
    const allKeys = Object.keys(current);
    if (allKeys.length > MAX_PERSISTED_HUBS) {
      for (const oldKey of allKeys.slice(0, allKeys.length - MAX_PERSISTED_HUBS)) {
        if (oldKey !== key) delete current[oldKey];
      }
    }

    fs.writeFileSync(getSyncStatusFilePath(), JSON.stringify(current, null, 2) + '\n', 'utf-8');
  } catch {}
}

function isTransientOrExcludedHubPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  if (norm.endsWith('/lease.json') || norm === 'lease.json') return true;
  if (norm.includes('.tmp.') || norm.endsWith('.bak')) return true;
  return false;
}

async function stageDataHubChanges(hubDir: string): Promise<string[]> {
  const candidates = ['projects', 'projects.json', '.esedre-hub'];
  const existingTargets: string[] = [];
  const missingCandidates: string[] = [];

  for (const c of candidates) {
    if (fs.existsSync(path.join(hubDir, c))) {
      existingTargets.push(c);
    } else {
      missingCandidates.push(c);
    }
  }

  if (missingCandidates.length > 0) {
    const tracked = await execGit(hubDir, ['ls-files', '--', ...missingCandidates]);
    if (tracked.code === 0 && tracked.stdout) {
      const trackedLines = tracked.stdout.split(/\r?\n/).filter(Boolean);
      for (const c of missingCandidates) {
        if (trackedLines.some((l) => l === c || l.startsWith(`${c}/`))) {
          existingTargets.push(c);
        }
      }
    }
  }

  if (existingTargets.length === 0) {
    return [];
  }

  await execGit(hubDir, [
    'add',
    '-A',
    '--',
    ...existingTargets,
    ':(exclude)projects/*/tickets/*/lease.json',
    ':(exclude)**/lease.json',
    ':(exclude)**/*.tmp.*',
    ':(exclude)**/*.bak',
  ]);

  // Ensure any previously staged lease.json, .tmp.*, or .bak files are unstaged
  const stagedRaw = await execGit(hubDir, ['diff', '--cached', '--name-only']);
  if (stagedRaw.code !== 0 || !stagedRaw.stdout) {
    return [];
  }

  const lines = stagedRaw.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const excludedFiles = lines.filter((f) => isTransientOrExcludedHubPath(f));
  if (excludedFiles.length > 0) {
    await execGit(hubDir, ['reset', '-q', '--', ...excludedFiles]);
  }

  return lines.filter((f) => !isTransientOrExcludedHubPath(f));
}

async function ensureCommitIdentityArgs(hubDir: string): Promise<string[]> {
  const cfgRes = await execGit(hubDir, ['config', '--get-regexp', '^user\\.(name|email)$']);
  let hasName = false;
  let hasEmail = false;
  if (cfgRes.code === 0 && cfgRes.stdout) {
    for (const line of cfgRes.stdout.split(/\r?\n/)) {
      if (/^user\.name\s+\S+/i.test(line)) hasName = true;
      if (/^user\.email\s+\S+/i.test(line)) hasEmail = true;
    }
  }
  const args: string[] = [];
  if (!hasName) {
    args.push('-c', 'user.name=Esedre Auto-Sync');
  }
  if (!hasEmail) {
    args.push('-c', 'user.email=sync@esedre.com');
  }
  return args;
}

async function countPendingCommits(hubDir: string, remote: string, branch: string): Promise<number> {
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  // Fast path: single rev-list invocation when both HEAD and remote tracking branch exist
  const directCount = await execGit(hubDir, ['rev-list', '--count', `${remoteRef}..HEAD`]);
  if (directCount.code === 0) {
    return parseInt(directCount.stdout, 10) || 0;
  }

  const hasHead = await execGit(hubDir, ['rev-parse', '--verify', 'HEAD']);
  if (hasHead.code !== 0) return 0;

  const remoteUrl = await execGit(hubDir, ['remote', 'get-url', remote]);
  if (remoteUrl.code === 0) {
    const totalRes = await execGit(hubDir, ['rev-list', '--count', 'HEAD']);
    if (totalRes.code === 0) {
      return parseInt(totalRes.stdout, 10) || 0;
    }
  }
  return 0;
}

export interface SyncDataHubOptions {
  config?: GitSyncConfig | null;
  events?: SyncMutationEvent[];
  consumeQueuedEvents?: () => SyncMutationEvent[];
  commit?: boolean;
  pull?: boolean;
  push?: boolean;
  force?: boolean;
}

export async function syncDataHub(
  hubDir: string,
  options: SyncDataHubOptions = {}
): Promise<GitSyncResult> {
  const resolvedHub = path.resolve(expandHome(hubDir));
  const syncCfg = resolveGitSyncConfig(options.config ? { sync: options.config } : undefined);

  if (!syncCfg.enabled && !options.force) {
    if (options.commit !== false) {
      options.consumeQueuedEvents?.();
    }
    return {
      hubDir: resolvedHub,
      committed: false,
      pulled: false,
      pushed: false,
      pendingCommits: 0,
      status: 'disabled',
    };
  }

  return withHubSyncLock(resolvedHub, async () => {
    const startedAtMs = Date.now();
    const shouldCommit = options.commit !== false;
    const verification = await verifyDataHubGitRepo(resolvedHub);
    if (!verification.valid) {
      if (shouldCommit) {
        options.consumeQueuedEvents?.();
      }
      writePersistedHubSyncState(resolvedHub, {
        status: 'error',
        lastError: verification.reason,
        durationMs: Date.now() - startedAtMs,
      });
      return {
        hubDir: resolvedHub,
        committed: false,
        pulled: false,
        pushed: false,
        pendingCommits: 0,
        status: 'error',
        error: verification.reason,
      };
    }

    let remote = 'origin';
    let branch = 'main';
    try {
      remote = validateGitRemoteName(options.config?.remote || syncCfg.remote || 'origin');
      branch = validateGitBranchName(options.config?.branch || verification.branch || syncCfg.branch || 'main');
    } catch (validationErr: any) {
      if (shouldCommit) {
        options.consumeQueuedEvents?.();
      }
      const safeErr = sanitizeGitLogText(validationErr.message);
      writePersistedHubSyncState(resolvedHub, {
        status: 'error',
        lastError: safeErr,
        durationMs: Date.now() - startedAtMs,
      });
      return {
        hubDir: resolvedHub,
        committed: false,
        pulled: false,
        pushed: false,
        pendingCommits: 0,
        status: 'error',
        error: safeErr,
      };
    }
    const shouldPush = options.push !== undefined ? options.push : syncCfg.push;
    const shouldPull = options.pull !== undefined ? options.pull : shouldPush;

    const outcome: {
      committed: boolean;
      pulled: boolean;
      pushed: boolean;
      commitSha?: string;
      commitMessage?: string;
      status: GitSyncStatusState;
      errorMsg?: string;
    } = {
      committed: false,
      pulled: false,
      pushed: false,
      status: 'idle',
    };
    const explicitEvents: SyncMutationEvent[] = [...(options.events || [])];

    const stageAndCommitInCurrentLock = async (): Promise<void> => {
      if (outcome.status === 'error' || outcome.status === 'conflict') return;
      const stagedFiles = await stageDataHubChanges(resolvedHub);
      const drainedEvents = [
        ...explicitEvents.splice(0, explicitEvents.length),
        ...(options.consumeQueuedEvents ? options.consumeQueuedEvents() : []),
      ];
      if (stagedFiles.length === 0) {
        return;
      }
      const formatted = formatSyncCommitMessage(drainedEvents, stagedFiles);
      const identityArgs = await ensureCommitIdentityArgs(resolvedHub);
      const commitArgs = [...identityArgs, 'commit', '--no-gpg-sign', '-m', formatted.subject];
      if (formatted.body) {
        commitArgs.push('-m', formatted.body);
      }
      const commitRes = await execGit(resolvedHub, commitArgs);
      if (commitRes.code === 0) {
        outcome.committed = true;
        outcome.commitMessage = formatted.subject;
        const shaRes = await execGit(resolvedHub, ['rev-parse', '--short', 'HEAD']);
        if (shaRes.code === 0 && shaRes.stdout) {
          outcome.commitSha = shaRes.stdout;
        }
      } else {
        outcome.status = 'error';
        outcome.errorMsg = `Failed to commit data hub changes: ${commitRes.stderr || commitRes.stdout}`;
      }
    };

    // 1. Stage & Commit local changes inside working-tree lock (never tearing mid-flight ticket writes)
    if (shouldCommit) {
      await withHubWorkingTreeLock(resolvedHub, () => stageAndCommitInCurrentLock());
    }

    // 2. Check remote availability
    const remoteUrlRes = await execGit(resolvedHub, ['remote', 'get-url', remote]);
    const hasRemote = remoteUrlRes.code === 0 && Boolean(remoteUrlRes.stdout);

    const fetchAndIntegrateRemote = async (): Promise<void> => {
      // Network fetch executes OUTSIDE the working-tree lock so local reads/writes never block on network I/O
      const fetchRes = await execGit(resolvedHub, ['fetch', '--prune', remote, branch], 30000);
      if (fetchRes.code !== 0) {
        outcome.status = 'offline';
        outcome.errorMsg = `Could not fetch from ${remote}/${branch}: ${fetchRes.stderr || fetchRes.stdout}`;
        return;
      }

      const remoteRef = `refs/remotes/${remote}/${branch}`;
      const verifyRemoteRef = await execGit(resolvedHub, ['rev-parse', '--verify', remoteRef]);
      if (verifyRemoteRef.code !== 0) {
        outcome.pulled = true;
        return;
      }

      const hasLocalHead = await execGit(resolvedHub, ['rev-parse', '--verify', 'HEAD']);
      if (hasLocalHead.code === 0) {
        const isAncestor = await execGit(resolvedHub, [
          'merge-base',
          '--is-ancestor',
          remoteRef,
          'HEAD',
        ]);
        if (isAncestor.code === 0) {
          outcome.pulled = true;
          return;
        }
      }

      // Upstream has new commits: acquire working-tree lock before mutating files via rebase/merge
      await withHubWorkingTreeLock(resolvedHub, async () => {
        if (shouldCommit) {
          // Commit any local ticket mutations written while network fetch was in flight
          await stageAndCommitInCurrentLock();
          if (outcome.status === 'error') return;
        }

        const headBefore = await execGit(resolvedHub, ['rev-parse', 'HEAD']);
        if (headBefore.code === 0) {
          const stillNeedsRebase = await execGit(resolvedHub, [
            'merge-base',
            '--is-ancestor',
            remoteRef,
            'HEAD',
          ]);
          if (stillNeedsRebase.code === 0) {
            outcome.pulled = true;
            return;
          }

          const rebaseRes = await execGit(
            resolvedHub,
            ['rebase', '--autostash', remoteRef],
            30000
          );
          if (rebaseRes.code === 0) {
            outcome.pulled = true;
            const headAfter = await execGit(resolvedHub, ['rev-parse', 'HEAD']);
            const shaRes = await execGit(resolvedHub, ['rev-parse', '--short', 'HEAD']);
            if (shaRes.code === 0 && shaRes.stdout) {
              outcome.commitSha = shaRes.stdout;
            }
            if (headAfter.code === 0 && headAfter.stdout !== headBefore.stdout) {
              globalGitSyncCoordinator.notifyHubWorkingTreeUpdated(resolvedHub);
            }
          } else {
            await execGit(resolvedHub, ['rebase', '--abort']);
            outcome.status = 'conflict';
            outcome.errorMsg = `Rebase conflict with ${remote}/${branch}; automatically aborted rebase to keep working tree clean.`;
          }
        } else {
          const checkoutRes = await execGit(resolvedHub, ['merge', '--ff-only', remoteRef]);
          if (checkoutRes.code === 0) {
            outcome.pulled = true;
            globalGitSyncCoordinator.notifyHubWorkingTreeUpdated(resolvedHub);
          }
        }
      });
    };

    if (outcome.status !== 'error' && hasRemote && (shouldPull || shouldPush)) {
      if (shouldPull) {
        await fetchAndIntegrateRemote();
      }

      if (shouldPush && outcome.status === 'idle') {
        const pendingBeforePush = await countPendingCommits(resolvedHub, remote, branch);
        if (pendingBeforePush > 0) {
          const pushRes = await execGit(resolvedHub, ['push', '-u', remote, branch], 30000);
          if (pushRes.code === 0) {
            outcome.pushed = true;
          } else if (
            shouldPull &&
            /non-fast-forward|fetch first|\[rejected\]/i.test(`${pushRes.stderr} ${pushRes.stdout}`)
          ) {
            await fetchAndIntegrateRemote();
            if (outcome.status === 'idle') {
              const retryPush = await execGit(resolvedHub, ['push', '-u', remote, branch], 30000);
              if (retryPush.code === 0) {
                outcome.pushed = true;
              } else {
                outcome.status = 'offline';
                outcome.errorMsg = `Could not push to ${remote}/${branch}: ${retryPush.stderr || retryPush.stdout}`;
              }
            }
          } else {
            outcome.status = 'offline';
            outcome.errorMsg = `Could not push to ${remote}/${branch}: ${pushRes.stderr || pushRes.stdout}`;
          }
        }
      }
    }

    const pendingCommits =
      !hasRemote
        ? 0
        : outcome.pushed && outcome.status === 'idle'
          ? 0
          : await countPendingCommits(resolvedHub, remote, branch);
    if (!outcome.commitSha || !outcome.commitMessage) {
      const latestLog = await execGit(resolvedHub, ['log', '-1', '--format=%h%n%s']);
      if (latestLog.code === 0 && latestLog.stdout) {
        const logLines = latestLog.stdout.split(/\r?\n/);
        if (!outcome.commitSha && logLines[0]) {
          outcome.commitSha = logLines[0].trim();
        }
        if (!outcome.commitMessage && logLines[1]) {
          outcome.commitMessage = logLines[1].trim();
        }
      }
    }

    const nowIso = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const safeErrorMsg = outcome.errorMsg ? sanitizeGitLogText(outcome.errorMsg) : undefined;
    writePersistedHubSyncState(resolvedHub, {
      status: outcome.status,
      lastCommitSha: outcome.commitSha,
      lastCommitMessage: outcome.commitMessage,
      ...(outcome.committed || outcome.pulled || outcome.pushed ? { lastSyncedAt: nowIso } : {}),
      lastError: safeErrorMsg,
      committed: outcome.committed,
      pulled: outcome.pulled,
      pushed: outcome.pushed,
      durationMs,
    });

    return {
      hubDir: resolvedHub,
      committed: outcome.committed,
      pulled: outcome.pulled,
      pushed: outcome.pushed,
      commitSha: outcome.commitSha,
      commitMessage: outcome.commitMessage,
      pendingCommits,
      status: outcome.status,
      ...(safeErrorMsg ? { error: safeErrorMsg } : {}),
    };
  });
}

export function discoverConfiguredHubDirs(config?: EsedreConfig | null): string[] {
  const globalCfg = readGlobalConfig();
  const rawDirs: string[] = [];

  for (const src of [config?.dataDir, globalCfg?.dataDir]) {
    if (!src) continue;
    const arr = Array.isArray(src) ? src : [src];
    for (const d of arr) {
      if (typeof d === 'string' && d.trim()) {
        rawDirs.push(path.resolve(expandHome(d.trim())));
      }
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const d of rawDirs) {
    const key = normalizeRealPath(d);
    if (!seen.has(key) && fs.existsSync(d)) {
      seen.add(key);
      unique.push(d);
    }
  }
  return unique;
}

export async function getDataHubSyncStatus(
  hubDir: string,
  configOrSync?: EsedreConfig | GitSyncConfig | null
): Promise<GitSyncHubStatus> {
  const resolvedHub = path.resolve(expandHome(hubDir));
  const config: EsedreConfig | null | undefined =
    configOrSync && typeof configOrSync === 'object' && !('sync' in configOrSync) && ('enabled' in configOrSync || 'remote' in configOrSync || 'branch' in configOrSync || 'push' in configOrSync)
      ? { sync: configOrSync as GitSyncConfig }
      : (configOrSync as EsedreConfig | null | undefined);
  const syncCfg = resolveGitSyncConfig(config);
  const persisted = readPersistedSyncState()[normalizeRealPath(resolvedHub)];

  const verification = await verifyDataHubGitRepo(resolvedHub);
  const branch = config?.sync?.branch?.trim() || verification.branch || syncCfg.branch || 'main';
  const remote = syncCfg.remote || 'origin';

  if (!verification.valid) {
    return {
      hubDir: resolvedHub,
      enabled: syncCfg.enabled,
      remote,
      branch,
      push: syncCfg.push,
      status: syncCfg.enabled ? 'error' : 'disabled',
      pendingCommits: 0,
      lastError: verification.reason,
    };
  }

  const pendingCommits = await countPendingCommits(resolvedHub, remote, branch);
  const statusPorcelain = await execGit(resolvedHub, [
    'status',
    '--porcelain',
    '--',
    'projects',
    'projects.json',
    ':(exclude)projects/*/tickets/*/lease.json',
    ':(exclude)**/lease.json',
    ':(exclude)**/*.tmp.*',
    ':(exclude)**/*.bak',
  ]);
  const dirtyFilesCount =
    statusPorcelain.code === 0 && statusPorcelain.stdout
      ? statusPorcelain.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => Boolean(l) && !isTransientOrExcludedHubPath(l.slice(2).trim())).length
      : 0;

  let lastCommitSha = persisted?.lastCommitSha;
  let lastCommitMessage = persisted?.lastCommitMessage;
  if (!lastCommitSha || !lastCommitMessage) {
    const logRes = await execGit(resolvedHub, ['log', '-1', '--format=%h%x09%s']);
    if (logRes.code === 0 && logRes.stdout) {
      const [sha, ...subjParts] = logRes.stdout.split('\t');
      lastCommitSha = sha || lastCommitSha;
      lastCommitMessage = subjParts.join('\t') || lastCommitMessage;
    }
  }

  let status: GitSyncStatusState = !syncCfg.enabled
    ? 'disabled'
    : persisted?.status && persisted.status !== 'disabled'
      ? persisted.status
      : 'idle';

  const hubProjects: string[] = [];
  const projectsDir = path.join(resolvedHub, 'projects');
  if (fs.existsSync(projectsDir)) {
    try {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const pJsonPath = path.join(projectsDir, ent.name, 'project.json');
        if (fs.existsSync(pJsonPath)) {
          try {
            const pJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
            hubProjects.push(typeof pJson?.code === 'string' ? pJson.code : ent.name);
            continue;
          } catch {}
        }
        if (fs.existsSync(path.join(projectsDir, ent.name, 'tickets'))) {
          hubProjects.push(ent.name);
        }
      }
      hubProjects.sort((a, b) => a.localeCompare(b));
    } catch {}
  }

  return {
    hubDir: resolvedHub,
    enabled: syncCfg.enabled,
    remote,
    branch,
    push: syncCfg.push,
    status,
    pendingCommits,
    dirtyFilesCount,
    ...(hubProjects.length > 0 ? { projects: hubProjects } : {}),
    ...(lastCommitSha ? { lastCommitSha } : {}),
    ...(lastCommitMessage ? { lastCommitMessage } : {}),
    ...(persisted?.lastSyncedAt ? { lastSyncedAt: persisted.lastSyncedAt } : {}),
    ...(persisted?.lastError ? { lastError: persisted.lastError } : {}),
    ...(persisted?.metrics ? { metrics: persisted.metrics } : {}),
  };
}

export async function getGitSyncStatusReport(
  config?: EsedreConfig | null,
  explicitHubDir?: string
): Promise<GitSyncStatusReport> {
  const syncCfg = resolveGitSyncConfig(config);
  const hubDirs = explicitHubDir
    ? [path.resolve(expandHome(explicitHubDir))]
    : discoverConfiguredHubDirs(config);

  const hubs: GitSyncHubStatus[] = [];
  for (const h of hubDirs) {
    hubs.push(await getDataHubSyncStatus(h, config));
  }

  return {
    enabled: syncCfg.enabled,
    config: syncCfg,
    hubs,
  };
}

function tryNotifyLocalDaemonSync(
  event: SyncMutationEvent,
  config?: EsedreConfig | null
): Promise<boolean> {
  const ports = resolvePorts(config ?? undefined);
  const stateFile = path.join(getGlobalConfigDir(), 'run', `daemon-${ports.gateway}.json`);
  if (!fs.existsSync(stateFile)) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({ notifyOnly: true, event });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: ports.api,
        path: '/api/planning/sync',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 250,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

export class GitSyncCoordinator {
  private queues = new Map<string, { hubDir: string; events: SyncMutationEvent[]; config?: EsedreConfig | null }>();
  private timers = new Map<string, NodeJS.Timeout>();
  private activeFlushes = new Map<string, Promise<GitSyncResult>>();
  private inFlight = new Set<Promise<any>>();
  private intervalTimer: NodeJS.Timeout | null = null;
  private isDaemonMode = false;
  private strongHubListeners = new Set<(hubDir: string) => void>();
  private weakHubListeners: Array<{ ref: WeakRef<object>; invoke: (target: any, hubDir: string) => void }> = [];

  private trackPromise<T>(p: Promise<T>): Promise<T> {
    this.inFlight.add(p);
    void p.finally(() => {
      this.inFlight.delete(p);
    });
    return p;
  }

  public onHubWorkingTreeUpdated(listener: (hubDir: string) => void): () => void {
    this.strongHubListeners.add(listener);
    return () => {
      this.strongHubListeners.delete(listener);
    };
  }

  public registerWeakHubUpdateListener<T extends object>(
    target: T,
    invoke: (target: T, hubDir: string) => void
  ): void {
    if (this.weakHubListeners.length > 64) {
      this.weakHubListeners = this.weakHubListeners.filter((item) => item.ref.deref() !== undefined);
    }
    this.weakHubListeners.push({
      ref: new WeakRef(target),
      invoke,
    });
  }

  public notifyHubWorkingTreeUpdated(hubDir: string): void {
    for (const listener of this.strongHubListeners) {
      try {
        listener(hubDir);
      } catch {}
    }
    if (this.weakHubListeners.length > 0) {
      const alive: typeof this.weakHubListeners = [];
      for (const item of this.weakHubListeners) {
        const deref = item.ref.deref();
        if (deref !== undefined) {
          alive.push(item);
          try {
            item.invoke(deref, hubDir);
          } catch {}
        }
      }
      this.weakHubListeners = alive;
    }
  }

  public setDaemonMode(enabled: boolean): void {
    this.isDaemonMode = enabled;
  }

  public enqueueMutation(event: SyncMutationEvent, config?: EsedreConfig | null): void {
    activeWorktreeLocks.exit(() => {
      const syncCfg = resolveGitSyncConfig(config);
      if (!syncCfg.enabled) return;

      const resolvedHub = path.resolve(expandHome(event.hubDir));
      const key = normalizeRealPath(resolvedHub);

      if (!this.isDaemonMode && syncCfg.debounceSeconds > 0) {
        // Short-lived CLI/MCP process: attempt to forward event to running local daemon first,
        // otherwise schedule debounced/immediate in-process flush.
        void this.trackPromise(
          tryNotifyLocalDaemonSync({ ...event, hubDir: resolvedHub }, config).then((notified) => {
            if (!notified) {
              this.scheduleInProcessFlush(key, resolvedHub, event, config, syncCfg);
            }
          })
        );
        return;
      }

      this.scheduleInProcessFlush(key, resolvedHub, event, config, syncCfg);
    });
  }

  private computeFlushDelayMs(syncCfg: Required<GitSyncConfig>): number {
    return this.isDaemonMode
      ? Math.max(50, syncCfg.debounceSeconds * 1000)
      : syncCfg.debounceSeconds === 0
        ? 10
        : Math.min(syncCfg.debounceSeconds * 1000, 150);
  }

  private scheduleTimerForKey(key: string, resolvedHub: string, delayMs: number): void {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (this.activeFlushes.has(key)) {
        // An active sync is already in flight for this hub; its finally block will schedule
        // a follow-up flush for any remaining queued events once it finishes.
        return;
      }
      const queued = this.queues.get(key);
      if (!queued || queued.events.length === 0) return;
      void this.flushHub(resolvedHub, queued.config).catch(() => {});
    }, delayMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.timers.set(key, timer);
  }

  private scheduleInProcessFlush(
    key: string,
    resolvedHub: string,
    event: SyncMutationEvent,
    config: EsedreConfig | null | undefined,
    syncCfg: Required<GitSyncConfig>
  ): void {
    let entry = this.queues.get(key);
    if (!entry) {
      entry = { hubDir: resolvedHub, events: [], config };
      this.queues.set(key, entry);
    }
    entry.events.push({ ...event, hubDir: resolvedHub });
    entry.config = config ?? entry.config;

    this.scheduleTimerForKey(key, resolvedHub, this.computeFlushDelayMs(syncCfg));
  }

  public async flushHub(
    hubDir: string,
    configOrOptions?: EsedreConfig | SyncDataHubOptions | null,
    maybeOptions?: SyncDataHubOptions
  ): Promise<GitSyncResult> {
    const resolvedHub = path.resolve(expandHome(hubDir));
    const key = normalizeRealPath(resolvedHub);
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    let explicitConfig: EsedreConfig | null | undefined;
    let options: SyncDataHubOptions | undefined;
    if (maybeOptions !== undefined) {
      explicitConfig = configOrOptions as EsedreConfig | null | undefined;
      options = maybeOptions;
    } else if (
      configOrOptions &&
      typeof configOrOptions === 'object' &&
      ('pull' in configOrOptions ||
        'push' in configOrOptions ||
        'commit' in configOrOptions ||
        'force' in configOrOptions ||
        'events' in configOrOptions ||
        'config' in configOrOptions)
    ) {
      options = configOrOptions as SyncDataHubOptions;
    } else {
      explicitConfig = configOrOptions as EsedreConfig | null | undefined;
    }

    // Wait for any already-running flush on this hub so queued events are never dropped or timed out
    while (this.activeFlushes.has(key)) {
      const current = this.activeFlushes.get(key)!;
      try {
        await current;
      } catch {}
    }

    const recheckTimer = this.timers.get(key);
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      this.timers.delete(key);
    }

    const queuedSnapshotCfg = this.queues.get(key)?.config;
    const effectiveSyncCfg = options?.config ?? explicitConfig?.sync ?? queuedSnapshotCfg?.sync;

    const passPromise = activeWorktreeLocks.exit(() =>
      syncDataHub(resolvedHub, {
        ...options,
        config: effectiveSyncCfg,
        events: options?.events,
        consumeQueuedEvents: () => {
          const currentQueue = this.queues.get(key);
          if (!currentQueue || currentQueue.events.length === 0) {
            this.queues.delete(key);
            return [];
          }
          const drained = currentQueue.events.splice(0, currentQueue.events.length);
          this.queues.delete(key);
          return drained;
        },
      })
    );

    this.activeFlushes.set(key, passPromise);
    void passPromise.finally(() => {
      if (this.activeFlushes.get(key) === passPromise) {
        this.activeFlushes.delete(key);
      }
      const remaining = this.queues.get(key);
      if (remaining && remaining.events.length > 0 && !this.timers.has(key)) {
        const resolvedCfg = resolveGitSyncConfig(remaining.config);
        if (resolvedCfg.enabled) {
          this.scheduleTimerForKey(key, remaining.hubDir, Math.min(this.computeFlushDelayMs(resolvedCfg), 75));
        }
      }
    });

    return this.trackPromise(passPromise);
  }

  public async flushAll(
    config?: EsedreConfig | null,
    options?: SyncDataHubOptions
  ): Promise<GitSyncResult[]> {
    const hubDirs = new Set<string>(discoverConfiguredHubDirs(config));
    for (const q of this.queues.values()) {
      hubDirs.add(q.hubDir);
    }
    const results: GitSyncResult[] = [];
    for (const h of hubDirs) {
      results.push(await this.flushHub(h, config, { ...options, config: options?.config ?? config?.sync }));
    }
    return results;
  }

  public async waitForIdle(): Promise<void> {
    while (this.inFlight.size > 0 || this.activeFlushes.size > 0 || this.queues.size > 0) {
      if (this.inFlight.size > 0 || this.activeFlushes.size > 0) {
        await Promise.allSettled([
          ...Array.from(this.inFlight),
          ...Array.from(this.activeFlushes.values()),
        ]);
      }
      if (this.queues.size > 0) {
        const pendingHubs = Array.from(this.queues.values());
        for (const item of pendingHubs) {
          await this.flushHub(item.hubDir, item.config);
        }
      }
    }
  }

  public startDaemonBackgroundLoop(getConfig: () => EsedreConfig | null | undefined): void {
    activeWorktreeLocks.exit(() => {
      this.isDaemonMode = true;
      this.stopDaemonBackgroundLoop();

      const initialCfg = getConfig();
      const syncCfg = resolveGitSyncConfig(initialCfg);
      if (syncCfg.enabled && syncCfg.pullOnStart) {
        void this.flushAll(initialCfg, { commit: true, pull: true, push: syncCfg.push }).catch(() => {});
      }

      // Check every 60s if intervalMinutes has elapsed for periodic background sync
      let lastPeriodicRun = Date.now();
      this.intervalTimer = setInterval(() => {
        const cfg = getConfig();
        const resolved = resolveGitSyncConfig(cfg);
        if (!resolved.enabled || resolved.intervalMinutes <= 0) return;
        const elapsedMinutes = (Date.now() - lastPeriodicRun) / 60000;
        if (elapsedMinutes >= resolved.intervalMinutes) {
          lastPeriodicRun = Date.now();
          void this.flushAll(cfg, { commit: true, pull: true, push: resolved.push }).catch(() => {});
        }
      }, 60000);

      if (typeof this.intervalTimer.unref === 'function') {
        this.intervalTimer.unref();
      }
    });
  }

  public stopDaemonBackgroundLoop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export const globalGitSyncCoordinator = new GitSyncCoordinator();
