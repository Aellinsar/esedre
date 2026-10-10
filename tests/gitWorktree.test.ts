import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  setupWorktree,
  removeWorktree,
  listWorktrees,
  isInsideGitRepo,
  ensureGitignoreIgnoresWorktrees,
  sanitizeWorkerId,
  getWorkerWorktreePath,
} from '../src/utils/gitWorktree.js';

describe('Git Worktree Isolation & Lifecycle (Ticket #66)', () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-worktree-test-'));

    // Initialize git repository with initial commit
    execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@esedre.dev'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Esedre Tester'], { cwd: tempRepo, stdio: 'ignore' });

    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Test Project\n', 'utf-8');
    execFileSync('git', ['add', 'README.md'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', '[#1] Initial test commit'], { cwd: tempRepo, stdio: 'ignore' });
  });

  afterEach(() => {
    if (fs.existsSync(tempRepo)) {
      try {
        fs.rmSync(tempRepo, { recursive: true, force: true });
      } catch {}
    }
  });

  it('sanitizes worker IDs with colons and special characters for filesystem and git branch safety', () => {
    expect(sanitizeWorkerId('Laptop:thug-1')).toBe('Laptop-thug-1');
    expect(sanitizeWorkerId('worker/sub/1')).toBe('worker-sub-1');
    expect(sanitizeWorkerId('thug 2')).toBe('thug-2');
  });

  it('correctly detects if a directory is inside a git work tree', () => {
    expect(isInsideGitRepo(tempRepo)).toBe(true);

    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
    try {
      expect(isInsideGitRepo(nonGitDir)).toBe(false);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('ensures .gitignore contains .worktrees/ entry automatically', () => {
    const updated = ensureGitignoreIgnoresWorktrees(tempRepo);
    expect(updated).toBe(true);

    const gitignoreContent = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('.worktrees/');

    // Calling again is idempotent and returns false
    const idempotent = ensureGitignoreIgnoresWorktrees(tempRepo);
    expect(idempotent).toBe(false);
  });

  it('sets up an isolated git worktree for a worker process on a dedicated branch', async () => {
    const result = await setupWorktree(tempRepo, 'thug-1');
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.worktreePath)).toBe(true);
    expect(result.branch).toBe('thug/thug-1');

    // Verify .worktrees/thug-1 has README.md from main
    expect(fs.existsSync(path.join(result.worktreePath, 'README.md'))).toBe(true);

    // List worktrees includes the new one
    const worktrees = listWorktrees(tempRepo);
    expect(worktrees.some((w) => w.branch === 'thug/thug-1')).toBe(true);

    // Reusing existing worktree returns created: false
    const secondSetup = await setupWorktree(tempRepo, 'thug-1');
    expect(secondSetup.created).toBe(false);
    expect(secondSetup.worktreePath).toBe(result.worktreePath);
  });

  it('allows modifications and commits in the isolated worktree without affecting the main worktree', async () => {
    const { worktreePath } = await setupWorktree(tempRepo, 'thug-2');

    // Create a new file in worktree
    const newFilePath = path.join(worktreePath, 'feature.ts');
    fs.writeFileSync(newFilePath, 'export const feature = true;\n', 'utf-8');

    // Stage and commit in worktree
    execFileSync('git', ['add', 'feature.ts'], { cwd: worktreePath, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', '[#2] Implement feature in thug worktree'], {
      cwd: worktreePath,
      stdio: 'ignore',
    });

    // File exists in worktree
    expect(fs.existsSync(newFilePath)).toBe(true);

    // File DOES NOT exist in main repo directory
    expect(fs.existsSync(path.join(tempRepo, 'feature.ts'))).toBe(false);
  });

  it('links root and subproject node_modules into worktree and unlinks them on removal', async () => {
    // Create root node_modules
    const rootMod = path.join(tempRepo, 'node_modules', 'fake-root-pkg');
    fs.mkdirSync(rootMod, { recursive: true });
    fs.writeFileSync(path.join(rootMod, 'index.js'), 'module.exports = "root";\n');

    // Create subproject web/node_modules and commit web/package.json so git tracks directory
    const webDir = path.join(tempRepo, 'web');
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, 'package.json'), '{"name":"web"}\n');
    execFileSync('git', ['add', 'web/package.json'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', '[#3] Add web subproject'], { cwd: tempRepo, stdio: 'ignore' });

    const webMod = path.join(webDir, 'node_modules', 'fake-web-pkg');
    fs.mkdirSync(webMod, { recursive: true });
    fs.writeFileSync(path.join(webMod, 'index.js'), 'module.exports = "web";\n');

    // Setup worktree
    const { worktreePath } = await setupWorktree(tempRepo, 'thug-modules');

    // Verify root node_modules was linked
    const worktreeRootMod = path.join(worktreePath, 'node_modules', 'fake-root-pkg', 'index.js');
    expect(fs.existsSync(worktreeRootMod)).toBe(true);

    // Verify subproject web/node_modules was linked
    const worktreeWebMod = path.join(worktreePath, 'web', 'node_modules', 'fake-web-pkg', 'index.js');
    expect(fs.existsSync(worktreeWebMod)).toBe(true);

    // Remove worktree
    const { removed } = await removeWorktree(tempRepo, 'thug-modules', { force: true, deleteBranch: true });
    expect(removed).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(false);

    // Original modules in tempRepo are untouched
    expect(fs.existsSync(path.join(rootMod, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(webMod, 'index.js'))).toBe(true);
  });
});

