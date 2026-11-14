import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface WorkerIdentityInput {
  holder?: string;
  agentType?: string;
  hostname?: string;
  sessionId?: string;
  branch?: string;
  worktree?: string;
  configDefaultAuthor?: string;
}

export interface ResolvedWorkerIdentity {
  holder: string;
  agentType?: string;
  hostname: string;
  sessionId?: string;
  branch?: string;
  worktree?: string;
}

function findGitDirUpward(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const dotGit = path.join(current, '.git');
    try {
      if (fs.existsSync(dotGit)) {
        const st = fs.statSync(dotGit);
        if (st.isDirectory()) {
          return dotGit;
        }
        if (st.isFile()) {
          const raw = fs.readFileSync(dotGit, 'utf-8');
          const match = raw.match(/^gitdir:\s*(.+)$/im);
          if (match && match[1]) {
            const target = path.resolve(current, match[1].trim());
            if (fs.existsSync(target)) {
              return target;
            }
          }
        }
      }
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function detectGitBranch(cwd?: string): string | undefined {
  const targetCwd = cwd || process.cwd();
  const gitDir = process.env.GIT_DIR
    ? path.resolve(targetCwd, process.env.GIT_DIR)
    : findGitDirUpward(targetCwd);

  if (!gitDir) {
    return undefined;
  }

  try {
    const headPath = path.join(gitDir, 'HEAD');
    if (fs.existsSync(headPath)) {
      const headRaw = fs.readFileSync(headPath, 'utf-8').trim();
      if (headRaw.startsWith('ref:')) {
        const refTarget = headRaw.slice(4).trim();
        const headsPrefix = 'refs/heads/';
        if (refTarget.startsWith(headsPrefix)) {
          const branchName = refTarget.slice(headsPrefix.length).trim();
          if (branchName) {
            return branchName;
          }
        }
      } else if (/^[0-9a-f]{40,64}$/i.test(headRaw)) {
        return undefined;
      }
    }
  } catch {}

  for (const args of [
    ['branch', '--show-current'],
    ['symbolic-ref', '--short', 'HEAD'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
  ]) {
    try {
      const out = execFileSync('git', args, {
        cwd: targetCwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
        timeout: 4000,
        windowsHide: true,
      }).trim();
      if (out && out !== 'HEAD') {
        return out;
      }
    } catch {}
  }

  return undefined;
}

function resolveCanonicalPath(p: string): string {
  const realFn = typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native : fs.realpathSync;
  const initial = path.resolve(p.normalize('NFC'));
  const tailSegments: string[] = [];
  let current = initial;
  while (true) {
    try {
      if (fs.existsSync(current)) {
        const real = realFn(current);
        return (tailSegments.length > 0 ? path.join(real, ...tailSegments) : real).normalize('NFC');
      }
      const nfdCurrent = current.normalize('NFD');
      if (nfdCurrent !== current && fs.existsSync(nfdCurrent)) {
        const real = realFn(nfdCurrent);
        return (tailSegments.length > 0 ? path.join(real, ...tailSegments) : real).normalize('NFC');
      }
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    tailSegments.unshift(path.basename(current));
    current = parent;
  }
  return initial;
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  if (!childPath || !parentPath) return false;
  const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  const canonParent = resolveCanonicalPath(parentPath);
  const canonChild = resolveCanonicalPath(childPath);
  const normParent = isCaseInsensitive ? canonParent.toLowerCase() : canonParent;
  const normChild = isCaseInsensitive ? canonChild.toLowerCase() : canonChild;
  if (normChild === normParent) return true;
  const rel = path.relative(normParent, normChild);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function isWorkspaceOrGitDir(dirPath: string): boolean {
  if (!dirPath || typeof dirPath !== 'string' || !dirPath.trim()) {
    return false;
  }
  let current = path.resolve(dirPath.trim());
  while (true) {
    const markers = [
      path.join(current, '.git'),
      path.join(current, '.esedre', 'esedre.json'),
      path.join(current, 'esedre.json'),
      path.join(current, '.esedre', 'project.json'),
      path.join(current, 'project.json'),
      path.join(current, 'projects.json'),
      path.join(current, 'src', 'data', 'planning', 'projects.json'),
    ];
    if (markers.some((m) => fs.existsSync(m))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return false;
}

export function resolveWorkerIdentity(input?: WorkerIdentityInput): ResolvedWorkerIdentity {
  let hostname = input?.hostname?.trim() || '';
  if (!hostname) {
    try {
      hostname = os.hostname() || 'local-host';
    } catch {
      hostname = 'local-host';
    }
  }

  let username = '';
  try {
    username = os.userInfo().username || '';
  } catch {
    username = process.env.USER || process.env.USERNAME || 'developer';
  }

  const envHolder =
    process.env.ESEDRE_WORKER_ID ||
    process.env.ESEDRE_AGENT_ID ||
    process.env.AGY_AGENT_ID ||
    '';

  const holder =
    input?.holder?.trim() ||
    envHolder.trim() ||
    input?.configDefaultAuthor?.trim() ||
    `${username}@${hostname}`;

  const agentType =
    input?.agentType?.trim() ||
    process.env.ESEDRE_AGENT_TYPE?.trim() ||
    (process.env.AGY_CONVERSATION_ID ? 'antigravity' : undefined);

  const sessionId =
    input?.sessionId?.trim() ||
    process.env.ESEDRE_SESSION_ID?.trim() ||
    process.env.AGY_CONVERSATION_ID?.trim() ||
    undefined;

  const explicitWorktree = input?.worktree?.trim();
  const worktree = explicitWorktree
    ? path.resolve(explicitWorktree)
    : isWorkspaceOrGitDir(process.cwd())
      ? process.cwd()
      : undefined;
  const branch = input?.branch?.trim() || (worktree ? detectGitBranch(worktree) : undefined);

  return {
    holder,
    ...(agentType ? { agentType } : {}),
    hostname,
    ...(sessionId ? { sessionId } : {}),
    ...(branch ? { branch } : {}),
    ...(worktree ? { worktree } : {}),
  };
}
