import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { logDebug } from './logger.js';

export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  bare?: boolean;
}

export interface SetupWorktreeOptions {
  branch?: string;
  baseBranch?: string;
  force?: boolean;
}

export interface SetupWorktreeResult {
  worktreePath: string;
  branch: string;
  created: boolean;
}

/**
 * Sanitizes a worker ID for safe use in directory and branch names across platforms.
 * Replaces colons, spaces, slashes, and special characters with hyphens.
 */
export function sanitizeWorkerId(workerId: string): string {
  return workerId.trim().replace(/[:/\\*\?"<>| ]+/g, '-').replace(/^-+|-+$/g, '') || 'worker';
}

/**
 * Returns the root directory used for crew worktrees (.worktrees/ under repo root).
 */
export function getWorktreeBaseDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), '.worktrees');
}

/**
 * Returns the dedicated worktree directory for a specific worker.
 */
export function getWorkerWorktreePath(repoRoot: string, workerId: string): string {
  const safeId = sanitizeWorkerId(workerId);
  return path.join(getWorktreeBaseDir(repoRoot), safeId);
}

/**
 * Verifies if a given directory is inside a valid Git repository work tree.
 */
export function isInsideGitRepo(dir: string): boolean {
  try {
    const res = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return res.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Ensures .worktrees/ is present in .gitignore so crew worktree directories
 * are never accidentally staged or committed into git tracking.
 */
export function ensureGitignoreIgnoresWorktrees(repoRoot: string): boolean {
  const gitignorePath = path.join(path.resolve(repoRoot), '.gitignore');
  const ignoreEntry = '.worktrees/';

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (content.includes('.worktrees') || content.includes('.worktrees/')) {
        return false;
      }
      const separator = content.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(
        gitignorePath,
        `${content}${separator}# Esedre crew fleet worktrees\n${ignoreEntry}\n`,
        'utf-8'
      );
      return true;
    } else {
      fs.writeFileSync(gitignorePath, `# Esedre crew fleet worktrees\n${ignoreEntry}\n`, 'utf-8');
      return true;
    }
  } catch (err: any) {
    logDebug('worktree', `Could not update .gitignore: ${err.message}`);
    return false;
  }
}

/**
 * Lists all active git worktrees using git worktree list --porcelain.
 */
export function listWorktrees(repoRoot: string): WorktreeInfo[] {
  try {
    const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const entries: WorktreeInfo[] = [];
    const stanzas = raw.trim().split(/\r?\n\r?\n/);

    for (const stanza of stanzas) {
      if (!stanza.trim()) continue;
      const lines = stanza.split(/\r?\n/);
      let wtPath = '';
      let head = '';
      let branch: string | undefined;
      let bare = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = path.resolve(line.slice(9).trim());
        } else if (line.startsWith('HEAD ')) {
          head = line.slice(5).trim();
        } else if (line.startsWith('branch ')) {
          const rawRef = line.slice(7).trim();
          branch = rawRef.replace(/^refs\/heads\//, '');
        } else if (line.trim() === 'bare') {
          bare = true;
        }
      }

      if (wtPath) {
        entries.push({ path: wtPath, head, branch, bare });
      }
    }

    return entries;
  } catch (err: any) {
    logDebug('worktree', `Failed to list worktrees: ${err.message}`);
    return [];
  }
}

/**
 * Sets up an isolated git worktree for a worker process.
 * If the worktree already exists, returns its path.
 * If not, creates the worktree on a dedicated worker branch.
 */
export async function setupWorktree(
  repoRoot: string,
  workerId: string,
  options: SetupWorktreeOptions = {}
): Promise<SetupWorktreeResult> {
  const resolvedRoot = path.resolve(repoRoot);
  if (!isInsideGitRepo(resolvedRoot)) {
    throw new Error(`Directory '${resolvedRoot}' is not inside a git repository.`);
  }

  ensureGitignoreIgnoresWorktrees(resolvedRoot);

  const safeId = sanitizeWorkerId(workerId);
  const worktreePath = getWorkerWorktreePath(resolvedRoot, workerId);
  const targetBranch = options.branch || `thug/${safeId}`;
  const baseBranch = options.baseBranch || 'HEAD';

  // Check if worktree already exists and is registered in git
  const existing = listWorktrees(resolvedRoot);
  const match = existing.find((w) => path.resolve(w.path).toLowerCase() === worktreePath.toLowerCase());

  if (match && fs.existsSync(worktreePath)) {
    logDebug('worktree', `Reusing existing worktree at ${worktreePath} on branch ${match.branch || targetBranch}`);
    linkNodeModules(resolvedRoot, worktreePath);
    return {
      worktreePath,
      branch: match.branch || targetBranch,
      created: false,
    };
  }

  // If path exists on disk but not in git worktrees, prune or clean
  if (fs.existsSync(worktreePath)) {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: resolvedRoot, stdio: 'ignore' });
    } catch {}
    if (fs.existsSync(worktreePath)) {
      try {
        unlinkNodeModules(worktreePath);
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {}
    }
  }

  const baseDir = getWorktreeBaseDir(resolvedRoot);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Check if target branch already exists locally
  let branchExists = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/heads/${targetBranch}`], {
      cwd: resolvedRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  const gitArgs: string[] = ['worktree', 'add'];
  if (options.force) {
    gitArgs.push('--force');
  }

  if (branchExists) {
    gitArgs.push(worktreePath, targetBranch);
  } else {
    gitArgs.push('-b', targetBranch, worktreePath, baseBranch);
  }

  try {
    execFileSync('git', gitArgs, {
      cwd: resolvedRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    logDebug('worktree', `Created isolated worktree at ${worktreePath} on branch ${targetBranch}`);
    linkNodeModules(resolvedRoot, worktreePath);
    return {
      worktreePath,
      branch: targetBranch,
      created: true,
    };
  } catch (err: any) {
    const errMsg = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`Failed to create git worktree at '${worktreePath}': ${errMsg}`);
  }
}

/**
 * Links root and subproject node_modules directories into the worktree so that
 * npm test, build, and lint commands run without requiring fresh npm installs.
 * Uses NTFS directory junctions on Windows (requires no admin privileges) and
 * directory symlinks on Linux/macOS.
 */
export function linkNodeModules(repoRoot: string, worktreePath: string): void {
  if (!fs.existsSync(repoRoot) || !fs.existsSync(worktreePath)) {
    return;
  }

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';

  // 1. Link root node_modules
  const rootModules = path.join(repoRoot, 'node_modules');
  const targetRootLink = path.join(worktreePath, 'node_modules');

  if (fs.existsSync(rootModules) && !fs.existsSync(targetRootLink)) {
    try {
      fs.symlinkSync(rootModules, targetRootLink, linkType);
      logDebug('worktree', `Linked root node_modules into worktree: ${targetRootLink}`);
    } catch (err: any) {
      logDebug('worktree', `Could not link root node_modules: ${err.message}`);
    }
  }

  // 2. Discover subproject node_modules (e.g. web/node_modules, packages/*/node_modules)
  try {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build') {
        continue;
      }

      const subModules = path.join(repoRoot, name, 'node_modules');
      if (fs.existsSync(subModules)) {
        const subWorktreeDir = path.join(worktreePath, name);
        const subTargetLink = path.join(subWorktreeDir, 'node_modules');
        if (fs.existsSync(subWorktreeDir) && !fs.existsSync(subTargetLink)) {
          try {
            fs.symlinkSync(subModules, subTargetLink, linkType);
            logDebug('worktree', `Linked subproject node_modules in '${name}' into worktree`);
          } catch (err: any) {
            logDebug('worktree', `Could not link subproject node_modules in '${name}': ${err.message}`);
          }
        }
      }
    }
  } catch (err: any) {
    logDebug('worktree', `Error scanning subprojects for node_modules: ${err.message}`);
  }
}

/**
 * Removes node_modules junctions/symlinks from the worktree before git worktree remove.
 */
export function unlinkNodeModules(worktreePath: string): void {
  if (!fs.existsSync(worktreePath)) {
    return;
  }

  const removeLinkSafe = (linkPath: string) => {
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() || process.platform === 'win32') {
        try {
          fs.unlinkSync(linkPath);
        } catch {
          try { fs.rmdirSync(linkPath); } catch {}
        }
      }
    } catch {}
  };

  // 1. Root node_modules in worktree
  removeLinkSafe(path.join(worktreePath, 'node_modules'));

  // 2. Subproject node_modules in worktree
  try {
    const entries = fs.readdirSync(worktreePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      removeLinkSafe(path.join(worktreePath, entry.name, 'node_modules'));
    }
  } catch {}
}

/**
 * Removes an existing git worktree for a worker and prunes git metadata.
 */
export async function removeWorktree(
  repoRoot: string,
  workerId: string,
  options: { force?: boolean; deleteBranch?: boolean } = {}
): Promise<{ removed: boolean; worktreePath: string }> {
  const resolvedRoot = path.resolve(repoRoot);
  const worktreePath = getWorkerWorktreePath(resolvedRoot, workerId);
  const safeId = sanitizeWorkerId(workerId);
  const targetBranch = `thug/${safeId}`;

  let removed = false;

  unlinkNodeModules(worktreePath);

  try {
    const args = ['worktree', 'remove', worktreePath];
    if (options.force) {
      args.push('--force');
    }
    execFileSync('git', args, {
      cwd: resolvedRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    removed = true;
  } catch {
    // If git worktree remove fails (e.g. dirty files), check fallback force removal
    if (fs.existsSync(worktreePath) && options.force) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        removed = true;
      } catch {}
    }
  }

  try {
    execFileSync('git', ['worktree', 'prune'], {
      cwd: resolvedRoot,
      stdio: 'ignore',
    });
  } catch {}

  if (options.deleteBranch) {
    try {
      execFileSync('git', ['branch', '-D', targetBranch], {
        cwd: resolvedRoot,
        stdio: 'ignore',
      });
    } catch {}
  }

  return { removed, worktreePath };
}
