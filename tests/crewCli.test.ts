import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

describe('Esedre Crew Fleet CLI and Lease Mutex (Ticket #66)', () => {
  let tempDir: string;
  let cliScriptPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-crew-cli-test-'));
    cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

    const ticketsDir = path.join(tempDir, '.esedre', 'tickets', '1');
    fs.mkdirSync(ticketsDir, { recursive: true });

    // .esedre/esedre.json
    fs.writeFileSync(
      path.join(tempDir, '.esedre', 'esedre.json'),
      JSON.stringify(
        {
          projectCode: 'Core',
          allowedProjects: ['Core'],
        },
        null,
        2
      )
    );

    // Seed ticket #1
    fs.writeFileSync(
      path.join(ticketsDir, 'meta.json'),
      JSON.stringify(
        {
          id: 1,
          title: 'Implement Multi-Worker Engine',
          type: 'Feature',
          category: 'Feature',
          status: 'Planned',
          project: 'Core',
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(ticketsDir, 'detail.md'), '# Ticket #1: Multi-Worker Engine\n');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const runCli = (
    args: string[],
    envOverrides: Record<string, string> = {},
    cwd: string = tempDir
  ): { stdout: string; stderr: string; status: number } => {
    try {
      const stdout = execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ESEDRE_GLOBAL_DIR: path.join(tempDir, '.global-esedre'),
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

  it('claims a ticket as Lead by default and outputs structured JSON', () => {
    const res = runCli(['claim', '1', '--json']);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.lease).toBeDefined();
    expect(parsed.lease.workerId).toBe('lead');
    expect(parsed.lease.role).toBe('lead');
    expect(parsed.ticket.meta.status).toBe('In Development');
  });

  it('claims a ticket as a process-bound Thug worker and respects machine-authoritative system', () => {
    const res = runCli(
      ['claim', '1', '--role', 'thug', '--ttl', '30', '--json'],
      { ESEDRE_WORKER_ID: 'thug-1', ESEDRE_SYSTEM: 'HostAlpha' }
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.lease.system).toBe('HostAlpha');
    expect(parsed.lease.workerId).toBe('thug-1');
    expect(parsed.lease.role).toBe('thug');
    expect(parsed.lease.ttlMinutes).toBe(30);
  });

  it('warns that system is machine-authoritative if --system flag is provided on CLI', () => {
    const res = runCli(['claim', '1', '--system', 'FakeHost']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Claimed Ticket #1');
  });

  it('rejects lease acquisition by another worker while active lease is held', () => {
    // Thug 1 claims
    const claim1 = runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
      ESEDRE_SYSTEM: 'Laptop',
    });
    expect(claim1.status).toBe(0);

    // Thug 2 attempts to claim
    const claim2 = runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-2',
      ESEDRE_WORKER_ROLE: 'thug',
      ESEDRE_SYSTEM: 'Laptop',
    });
    expect(claim2.status).not.toBe(0);
    expect(claim2.stderr).toContain('Lease Conflict');
    expect(claim2.stderr).toContain('thug-1');
  });

  it('strictly blocks non-lead workers from using --force to break leases', () => {
    // Thug 1 claims
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });

    // Thug 2 tries --force
    const claimForce = runCli(['claim', '1', '--force'], {
      ESEDRE_WORKER_ID: 'thug-2',
      ESEDRE_WORKER_ROLE: 'thug',
    });
    expect(claimForce.status).not.toBe(0);
    expect(claimForce.stderr).toContain('Access Denied: Only a Lead may use --force');
  });

  it('allows Lead to override and force-claim an actively leased ticket', () => {
    // Thug 1 claims
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });

    // Lead breaks lease with --force
    const leadForce = runCli(['claim', '1', '--force', '--json'], {
      ESEDRE_WORKER_ID: 'lead',
      ESEDRE_WORKER_ROLE: 'lead',
    });
    expect(leadForce.status).toBe(0);
    const parsed = JSON.parse(leadForce.stdout);
    expect(parsed.lease.workerId).toBe('lead');
  });

  it('renews lease for active holder and rejects renewal by non-holder', () => {
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
      ESEDRE_SYSTEM: 'Laptop',
    });

    // Valid renewal
    const renewValid = runCli(['renew', '1', '--ttl', '25', '--json'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_SYSTEM: 'Laptop',
    });
    expect(renewValid.status).toBe(0);
    const parsed = JSON.parse(renewValid.stdout);
    expect(parsed.ttlMinutes).toBe(25);

    // Invalid renewal by different worker
    const renewInvalid = runCli(['renew', '1'], {
      ESEDRE_WORKER_ID: 'thug-2',
      ESEDRE_SYSTEM: 'Laptop',
    });
    expect(renewInvalid.status).not.toBe(0);
    expect(renewInvalid.stderr).toContain('Lease Conflict');
  });

  it('releases lease and updates status with developer notes', () => {
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
      ESEDRE_SYSTEM: 'Laptop',
    });

    const releaseRes = runCli(
      ['release', '1', '--status', 'Completed', '--notes', 'All unit tests passing', '--json'],
      { ESEDRE_WORKER_ID: 'thug-1', ESEDRE_SYSTEM: 'Laptop' }
    );
    expect(releaseRes.status).toBe(0);
    const parsed = JSON.parse(releaseRes.stdout);
    expect(parsed.meta.lease).toBeNull();
    expect(parsed.meta.status).toBe('Completed');
  });

  it('lists active leases across projects', () => {
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });

    const listJson = runCli(['leases', '--json']);
    expect(listJson.status).toBe(0);
    const parsed = JSON.parse(listJson.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].workerId).toBe('thug-1');

    const listTable = runCli(['leases']);
    expect(listTable.status).toBe(0);
    expect(listTable.stdout).toContain('Ticket');
    expect(listTable.stdout).toContain('thug-1');
  });

  it('strictly blocks Thugs from delegating tasks and provides constructive escalation guidance', () => {
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });

    const delegateRes = runCli(['crew', 'delegate', '1', '--worker', 'thug-2'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });
    expect(delegateRes.status).not.toBe(0);
    expect(delegateRes.stderr).toContain("Access Denied: Role 'thug' cannot delegate tasks");
    expect(delegateRes.stderr).toContain('ese crew escalate 1 --reason <explanation>');
  });

  it('allows Lead or Anchor to delegate a task to a worker', () => {
    const delegateRes = runCli(['crew', 'delegate', '1', '--worker', 'thug-3', '--role', 'thug', '--json'], {
      ESEDRE_WORKER_ID: 'lead',
      ESEDRE_WORKER_ROLE: 'lead',
    });
    expect(delegateRes.status).toBe(0);
    const parsed = JSON.parse(delegateRes.stdout);
    expect(parsed.meta.lease.workerId).toBe('thug-3');
    expect(parsed.meta.lease.role).toBe('thug');
  });

  it('allows worker to escalate a blocked task, releasing lease and resetting status to Planned', () => {
    runCli(['claim', '1', '--role', 'thug'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });

    const escRes = runCli(['crew', 'escalate', '1', '--reason', 'Database deadlock in migration scripts', '--json'], {
      ESEDRE_WORKER_ID: 'thug-1',
      ESEDRE_WORKER_ROLE: 'thug',
    });
    expect(escRes.status).toBe(0);
    const parsed = JSON.parse(escRes.stdout);
    expect(parsed.ticket.meta.lease).toBeNull();
    expect(parsed.ticket.meta.status).toBe('Planned');
    expect(parsed.reason).toContain('Database deadlock');

    // Verify escalation comment was saved
    const getRes = runCli(['get', '1', '--json']);
    const getParsed = JSON.parse(getRes.stdout);
    const lastComment = getParsed.comments[getParsed.comments.length - 1];
    expect(lastComment.text).toContain('[Escalation] Database deadlock in migration scripts');
  });

  it('reports current crew identity via ese crew whoami', () => {
    const res = runCli(['crew', 'whoami', '--json'], {
      ESEDRE_WORKER_ID: 'anchor-1',
      ESEDRE_WORKER_ROLE: 'anchor',
      ESEDRE_SYSTEM: 'LaptopAlpha',
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.system).toBe('LaptopAlpha');
    expect(parsed.workerId).toBe('anchor-1');
    expect(parsed.role).toBe('anchor');
  });
});
