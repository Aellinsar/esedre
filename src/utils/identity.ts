import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

export function detectGitBranch(cwd?: string): string | undefined {
  const targetCwd = cwd || process.cwd();
  try {
    const out = execSync('git branch --show-current', {
      cwd: targetCwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 1500,
    }).trim();
    if (out) return out;
  } catch {}

  try {
    const out = execSync('git symbolic-ref --short HEAD', {
      cwd: targetCwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 1500,
    }).trim();
    if (out) return out;
  } catch {}

  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: targetCwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 1500,
    }).trim();
    return out && out !== 'HEAD' ? out : undefined;
  } catch {
    return undefined;
  }
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  if (!childPath || !parentPath) return false;
  const normParent = path.resolve(parentPath).toLowerCase();
  const normChild = path.resolve(childPath).toLowerCase();
  if (normChild === normParent) return true;
  const rel = path.relative(normParent, normChild);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
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

  const worktree = input?.worktree?.trim() || process.cwd();
  const branch = input?.branch?.trim() || detectGitBranch(worktree);

  return {
    holder,
    ...(agentType ? { agentType } : {}),
    hostname,
    ...(sessionId ? { sessionId } : {}),
    ...(branch ? { branch } : {}),
    ...(worktree ? { worktree } : {}),
  };
}
