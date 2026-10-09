import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { removeWorktree, listWorktrees } from '../src/utils/gitWorktree.js';

describe('Autonomous Crew Fleet E2E Multi-Role Integration (Ticket #66)', () => {
  let tempRepo: string;
  let cliScriptPath: string;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-fleet-e2e-'));
    cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

    // Initialize git repository with initial commit
    execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fleet@esedre.dev'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Fleet Coordinator'], { cwd: tempRepo, stdio: 'ignore' });

    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Fleet Project\n', 'utf-8');
    execFileSync('git', ['add', 'README.md'], { cwd: tempRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', '[#1] Initial project setup'], { cwd: tempRepo, stdio: 'ignore' });

    // Setup .esedre directory
    const esedreDir = path.join(tempRepo, '.esedre');
    fs.mkdirSync(esedreDir, { recursive: true });

    fs.writeFileSync(
      path.join(esedreDir, 'esedre.json'),
      JSON.stringify(
        {
          projectCode: 'Core',
          allowedProjects: ['Core'],
        },
        null,
        2
      )
    );

    // Create 3 tickets
    for (let id = 1; id <= 3; id++) {
      const tDir = path.join(esedreDir, 'tickets', String(id));
      fs.mkdirSync(tDir, { recursive: true });
      fs.writeFileSync(
        path.join(tDir, 'meta.json'),
        JSON.stringify(
          {
            id,
            title: `Task #${id} for Fleet`,
            type: 'Feature',
            category: 'Feature',
            status: 'Planned',
            project: 'Core',
            revision: 1,
          },
          null,
          2
        )
      );
      fs.writeFileSync(path.join(tDir, 'detail.md'), `# Ticket #${id}\nDescription of task ${id}.\n`);
    }
  });

  afterEach(async () => {
    if (fs.existsSync(tempRepo)) {
      try {
        await removeWorktree(tempRepo, 'thug-1', { force: true, deleteBranch: true });
      } catch {}
      try {
        await removeWorktree(tempRepo, 'thug-2', { force: true, deleteBranch: true });
      } catch {}
      try {
        fs.rmSync(tempRepo, { recursive: true, force: true });
      } catch {}
    }
  });

  const runCli = (
    args: string[],
    envOverrides: Record<string, string> = {},
    cwd: string = tempRepo
  ): { stdout: string; stderr: string; status: number } => {
    try {
      const stdout = execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ESEDRE_GLOBAL_DIR: path.join(tempRepo, '.global-esedre'),
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

  it('coordinates a complete multi-worker fleet lifecycle (Lead, Anchor & Thugs)', async () => {
    // 1. Lead delegates Ticket #1 to thug-1 and Ticket #2 to thug-2
    const del1 = runCli(['crew', 'delegate', '1', '--worker', 'thug-1', '--json']);
    expect(del1.status).toBe(0);
    const del1Json = JSON.parse(del1.stdout);
    expect(del1Json.meta.lease.workerId).toBe('thug-1');
    expect(del1Json.meta.lease.role).toBe('thug');

    const del2 = runCli(['crew', 'delegate', '2', '--worker', 'thug-2', '--json']);
    expect(del2.status).toBe(0);
    const del2Json = JSON.parse(del2.stdout);
    expect(del2Json.meta.lease.workerId).toBe('thug-2');

    // 2. Anchor inspects active leases across fleet
    const leasesRes = runCli(['leases', '--json'], { ESEDRE_WORKER_ROLE: 'anchor', ESEDRE_WORKER_ID: 'anchor-1' });
    expect(leasesRes.status).toBe(0);
    const leases = JSON.parse(leasesRes.stdout);
    expect(leases).toHaveLength(2);
    expect(leases.map((l: any) => l.workerId).sort()).toEqual(['thug-1', 'thug-2']);
    expect(leases.every((l: any) => l.remainingSeconds > 0)).toBe(true);

    // 3. Thug attempts to delegate Ticket #3 and is strictly rejected with guidance
    const thugDel = runCli(['crew', 'delegate', '3', '--worker', 'thug-1'], {
      ESEDRE_WORKER_ROLE: 'thug',
      ESEDRE_WORKER_ID: 'thug-1',
    });
    expect(thugDel.status).toBe(1);
    expect(thugDel.stderr).toContain("Role 'thug' cannot delegate tasks");
    expect(thugDel.stderr).toContain('ese crew escalate');

    // 4. Thug-1 runs task in isolated worktree and succeeds
    const execSuccess = 'node -e "require(\'fs\').writeFileSync(\'feature1.txt\', \'fleet feature 1 complete\')"';
    const worker1Res = runCli(
      ['crew', 'worker', '--id', 'thug-1', '--exec', execSuccess, '--once', '--json'],
      { ESEDRE_WORKER_ROLE: 'thug', ESEDRE_WORKER_ID: 'thug-1' }
    );
    expect(worker1Res.status).toBe(0);
    const worker1Cycles = JSON.parse(worker1Res.stdout);
    expect(worker1Cycles[0].action).toBe('claimed_and_completed');

    // Verify git worktree isolation for thug-1:
    const wt1Path = path.join(tempRepo, '.worktrees', 'thug-1');
    expect(fs.existsSync(path.join(wt1Path, 'feature1.txt'))).toBe(true);
    // Main repository does not contain worker-generated feature1.txt:
    expect(fs.existsSync(path.join(tempRepo, 'feature1.txt'))).toBe(false);

    // Verify Ticket #1 is Completed and lease released:
    const t1Meta = JSON.parse(fs.readFileSync(path.join(tempRepo, '.esedre', 'tickets', '1', 'meta.json'), 'utf-8'));
    expect(t1Meta.status).toBe('Completed');
    expect(t1Meta.lease).toBeNull();

    // 5. Thug-2 runs task in isolated worktree with a failing command
    const execFail = 'node -e "process.exit(42)"';
    const worker2Res = runCli(
      ['crew', 'worker', '--id', 'thug-2', '--exec', execFail, '--once', '--json'],
      { ESEDRE_WORKER_ROLE: 'thug', ESEDRE_WORKER_ID: 'thug-2' }
    );
    expect(worker2Res.status).toBe(0);
    const worker2Cycles = JSON.parse(worker2Res.stdout);
    expect(worker2Cycles[0].action).toBe('claimed_and_escalated');

    // Verify Ticket #2 was escalated back to Planned and lease released:
    const t2Meta = JSON.parse(fs.readFileSync(path.join(tempRepo, '.esedre', 'tickets', '2', 'meta.json'), 'utf-8'));
    expect(t2Meta.status).toBe('Planned');
    expect(t2Meta.lease).toBeNull();

    // 6. Lead force-claims and completes Ticket #2 manually with notes
    const leadClaim = runCli(['claim', '2', '--role', 'lead', '--json']);
    expect(leadClaim.status).toBe(0);

    const leadRelease = runCli(['release', '2', '--status', 'Completed', '--notes', 'Resolved manually by Lead', '--json']);
    expect(leadRelease.status).toBe(0);

    // 7. Verify zero remaining active leases
    const finalLeases = runCli(['leases', '--json']);
    expect(finalLeases.status).toBe(0);
    expect(JSON.parse(finalLeases.stdout)).toEqual([]);

    // 8. Generate snapshot and verify projection includes assignee & completed statuses
    const snapRes = runCli(['snapshot', '--project', 'Core', '--json']);
    expect(snapRes.status).toBe(0);
    const snapshot = JSON.parse(snapRes.stdout);
    expect(snapshot.tickets).toHaveLength(3);
    const snap1 = snapshot.tickets.find((t: any) => t.id === 1);
    expect(snap1.status).toBe('Completed');
    expect(snap1.lease).toBeUndefined();

    // 9. Decommission and remove worktrees cleanly
    const rm1 = await removeWorktree(tempRepo, 'thug-1', { force: true, deleteBranch: true });
    expect(rm1.removed).toBe(true);

    const rm2 = await removeWorktree(tempRepo, 'thug-2', { force: true, deleteBranch: true });
    expect(rm2.removed).toBe(true);

    const activeWts = listWorktrees(tempRepo);
    // Only main repo worktree remains
    expect(activeWts.filter((w) => w.path.includes('.worktrees'))).toHaveLength(0);
  });
});
