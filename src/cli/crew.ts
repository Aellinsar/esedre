import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TicketRepository } from '../storage/repository.js';
import { resolveWorkerIdentity, resolveSystemIdentity } from '../utils/identity.js';
import { formatLeaseListTable, colors } from '../utils/formatter.js';
import { CrewRole, WorkerRole, TicketStatus, EsedreTicket } from '../types.js';
import { HeadlessWorkerRunner, WorkerMode, isPlanEmpty } from './worker.js';
import { getWorkerLogPath, getWorkerRunFile, writeWorkerRun, tailFile, findDeadWorkers, isPidAlive } from '../utils/workerRuns.js';
import { launchDetached, collectWorkerEnv, readExitMarker, attachWorkerLog } from '../utils/workerLaunch.js';

function parseLookupKey(rawId: string | number, project?: string): string {
  if (!rawId) return '';
  const trimmed = String(rawId).trim();
  if (trimmed.includes('-')) return trimmed;
  if (/^\d+$/.test(trimmed) && project) {
    return `${project}-${trimmed}`;
  }
  return trimmed;
}

export async function handleClaim(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese lease claim <ticketId> [options]\n`);
    console.log(`Acquire mutual exclusion lease lock on a ticket.\n`);
    console.log(`${colors.bold}Arguments:${colors.reset}`);
    console.log(`  <ticketId>            Numeric ticket ID or project key (e.g. 42 or Prof-42)\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  --role <role>         Worker role: 'lead', 'anchor', or 'thug' (default: lead)`);
    console.log(`  --worker <workerId>   Worker identifier (default: caller ID)`);
    console.log(`  --ttl <minutes>       Lease TTL in minutes (default: 15)`);
    console.log(`  --worktree <path>     Associated git worktree path`);
    console.log(`  --force               Force claim / override existing lease (Lead role only)`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const rawId = positionals[0];
  if (!rawId) {
    console.error(`${colors.red}Error: Ticket ID is required (e.g. ese claim 42)${colors.reset}`);
    process.exit(1);
  }

  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const lookupKey = parseLookupKey(rawId, project);

  const roleFlag = (flags['role'] as CrewRole) || undefined;
  if (roleFlag && roleFlag !== 'anchor' && roleFlag !== 'thug' && roleFlag !== 'lead') {
    console.error(`${colors.red}Error: Invalid role '${roleFlag}'. Valid options: 'lead', 'anchor', 'thug'.${colors.reset}`);
    process.exit(1);
  }

  const workerFlag = (flags['worker'] as string) || undefined;
  const caller = resolveWorkerIdentity(discovered.config, { role: roleFlag, workerId: workerFlag });

  if (flags['system']) {
    console.warn(`${colors.yellow}Notice: System identity is machine-authoritative and resolved from host configuration; --system flag is ignored.${colors.reset}`);
  }

  const isForce = Boolean(flags['force']);
  if (isForce && caller.role !== 'lead') {
    console.error(`${colors.red}Access Denied: Only a Lead may use --force to break or override ticket leases.${colors.reset}`);
    process.exit(1);
  }

  const ttl = flags['ttl'] ? parseInt(String(flags['ttl']), 10) : undefined;
  const worktree = flags['worktree'] as string | undefined;
  const engine = (flags['engine'] as 'antigravity' | 'claude' | 'shell' | 'headless') || 'antigravity';

  const ticket = await storage.claimTicket(lookupKey, {
    system: caller.system,
    workerId: caller.workerId,
    role: caller.role,
    ttlMinutes: ttl,
    worktree,
    engine,
    force: isForce,
  });

  const lease = ticket.meta.lease!;
  if (isJson) {
    console.log(JSON.stringify({ ticket, lease }, null, 2));
  } else {
    console.log(`${colors.bold}${colors.green}✔ Claimed Ticket #${ticket.meta.id} (${ticket.meta.project}): "${ticket.meta.title}"${colors.reset}`);
    console.log(`  • System:     ${lease.system}`);
    console.log(`  • Worker:     ${lease.workerId} (${lease.role})`);
    console.log(`  • Expires At: ${lease.expiresAt} (TTL: ${lease.ttlMinutes}m)`);
    console.log(`  • Worktree:   ${lease.worktree || 'Default repository workspace'}`);
  }
}

export async function handleRelease(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese lease release <ticketId> [options]\n`);
    console.log(`Release mutual exclusion lease lock on a ticket.\n`);
    console.log(`${colors.bold}Arguments:${colors.reset}`);
    console.log(`  <ticketId>            Numeric ticket ID or project key (e.g. 42 or Prof-42)\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  -s, --status <status> Final status: 'Completed', 'In Development', or 'Planned'`);
    console.log(`  --notes "<text>"      Release notes or execution summary`);
    console.log(`  --force               Force release / override lease (Lead role only)`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const rawId = positionals[0];
  if (!rawId) {
    console.error(`${colors.red}Error: Ticket ID is required (e.g. ese release 42)${colors.reset}`);
    process.exit(1);
  }

  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const lookupKey = parseLookupKey(rawId, project);

  const workerFlag = (flags['worker'] as string) || undefined;
  const caller = resolveWorkerIdentity(discovered.config, { workerId: workerFlag });

  const isForce = Boolean(flags['force']);
  if (isForce && caller.role !== 'lead') {
    console.error(`${colors.red}Access Denied: Only a Lead may use --force to break or override ticket leases.${colors.reset}`);
    process.exit(1);
  }

  const rawStatus = (flags['status'] as string) || (flags['s'] as string);
  let finalStatus: 'Completed' | 'Planned' | 'In Development' | undefined;
  if (rawStatus === 'Completed' || rawStatus === 'Planned' || rawStatus === 'In Development') {
    finalStatus = rawStatus;
  }
  const notes = (flags['notes'] as string) || (flags['note'] as string) || undefined;

  const ticket = await storage.releaseTicket(lookupKey, {
    system: caller.system,
    workerId: caller.workerId,
    finalStatus,
    notes,
    force: isForce,
  });

  if (isJson) {
    console.log(JSON.stringify(ticket, null, 2));
  } else {
    console.log(`${colors.bold}${colors.green}✔ Released lease on Ticket #${ticket.meta.id} (${ticket.meta.project})${colors.reset}`);
    console.log(`  • Status:      ${ticket.meta.status}`);
    console.log(`  • Released By: ${caller.system}:${caller.workerId} (${caller.role})`);
    if (notes) {
      console.log(`  • Notes:       ${notes}`);
    }
  }
}

export async function handleRenew(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese lease renew <ticketId> [options]\n`);
    console.log(`Extend rolling lease expiration TTL on a currently held ticket.\n`);
    console.log(`${colors.bold}Arguments:${colors.reset}`);
    console.log(`  <ticketId>            Numeric ticket ID or project key (e.g. 42 or Prof-42)\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  --ttl <minutes>       Lease TTL in minutes (default: 15)`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const rawId = positionals[0];
  if (!rawId) {
    console.error(`${colors.red}Error: Ticket ID is required (e.g. ese renew 42)${colors.reset}`);
    process.exit(1);
  }

  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const lookupKey = parseLookupKey(rawId, project);

  const workerFlag = (flags['worker'] as string) || undefined;
  const caller = resolveWorkerIdentity(discovered.config, { workerId: workerFlag });
  const ttl = flags['ttl'] ? parseInt(String(flags['ttl']), 10) : undefined;

  const lease = await storage.renewLease(lookupKey, caller.system, caller.workerId, ttl);

  if (isJson) {
    console.log(JSON.stringify(lease, null, 2));
  } else {
    console.log(`${colors.bold}${colors.green}✔ Renewed lease on Ticket #${rawId}${colors.reset}`);
    console.log(`  • Holder:     ${lease.system}:${lease.workerId}`);
    console.log(`  • Expires At: ${lease.expiresAt} (TTL: ${lease.ttlMinutes}m)`);
  }
}

export async function handleLeases(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese lease list [options]\n`);
    console.log(`List active ticket leases and lock holders across workspace or fleet.\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  -p, --project <code>  Filter leases by project code`);
    console.log(`  --all                 Show all leases across registered projects`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const projectArg = (flags['project'] as string) || (flags['p'] as string) || positionals[0] || discovered.config?.projectCode;
  const filterProject = !projectArg || projectArg.toLowerCase() === 'all' ? undefined : projectArg;

  const leases = await storage.listActiveLeases(filterProject);

  // A lease whose detached worker process is gone is stale: it will only expire, never complete.
  const dead = findDeadWorkers(discovered.workspaceRoot);
  const stale = new Map<string, { pid: number; logFile: string }>();
  for (const l of leases) {
    const key = `${l.project || ''}-${l.ticketId}`.toLowerCase();
    const rec = dead.get(key);
    if (rec && rec.workerId.toLowerCase() === String(l.workerId).toLowerCase()) {
      stale.set(key, { pid: rec.pid, logFile: rec.logFile });
    }
  }

  if (isJson) {
    console.log(JSON.stringify(
      leases.map((l) => {
        const s = stale.get(`${l.project || ''}-${l.ticketId}`.toLowerCase());
        return s ? { ...l, stale: true, workerPid: s.pid, logFile: s.logFile } : { ...l, stale: false };
      }),
      null,
      2
    ));
  } else {
    console.log(formatLeaseListTable(leases, stale));
  }
}

export async function handleDelegate(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese crew delegate <ticketId> --worker <workerId> [options]\n`);
    console.log(`Role-Aware Ticket Delegation: Assigns and leases a ticket to a worker.\n`);
    console.log(`${colors.bold}Arguments:${colors.reset}`);
    console.log(`  <ticketId>            Numeric ticket ID or project key (e.g. 42 or Prof-42)\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  --worker <workerId>   Target worker identity (required)`);
    console.log(`  --role <role>         Target worker role: 'thug' or 'anchor' (default: thug)`);
    console.log(`  --ttl <minutes>       Lease TTL in minutes (default: 15)`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const rawId = positionals[0];
  if (!rawId) {
    console.error(`${colors.red}Error: Ticket ID is required (e.g. ese crew delegate 42 --worker thug-2)${colors.reset}`);
    process.exit(1);
  }

  const caller = resolveWorkerIdentity(discovered.config);
  if (caller.role === 'thug') {
    console.error(`${colors.red}Access Denied: Role 'thug' cannot delegate tasks. Only Leads and Anchors may delegate. If task is too complex, run 'ese crew escalate ${rawId} --reason <explanation>'.${colors.reset}`);
    process.exit(1);
  }

  const targetWorker = (flags['worker'] as string) || (flags['to'] as string) || positionals[1];
  if (!targetWorker) {
    console.error(`${colors.red}Error: Target worker is required (--worker <workerId>)${colors.reset}`);
    process.exit(1);
  }

  const targetRole = (flags['role'] as WorkerRole) || 'thug';
  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const lookupKey = parseLookupKey(rawId, project);

  const ticket = await storage.claimTicket(lookupKey, {
    system: caller.system,
    workerId: targetWorker,
    role: targetRole,
    force: true,
  });

  if (isJson) {
    console.log(JSON.stringify(ticket, null, 2));
  } else {
    console.log(`${colors.bold}${colors.green}✔ Delegated Ticket #${ticket.meta.id} to ${caller.system}:${targetWorker} (${targetRole})${colors.reset}`);
    console.log(`  • Delegated By: ${caller.system}:${caller.workerId} (${caller.role})`);
  }
}

export async function handleEscalate(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese crew escalate <ticketId> --reason "<explanation>" [options]\n`);
    console.log(`Worker Escalation: Releases lease, resets status to Planned, and leaves note for Lead.\n`);
    console.log(`${colors.bold}Arguments:${colors.reset}`);
    console.log(`  <ticketId>            Numeric ticket ID or project key (e.g. 42 or Prof-42)\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  -r, --reason "<text>" Reason for escalation (blocker, complexity, missing spec)`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const rawId = positionals[0];
  if (!rawId) {
    console.error(`${colors.red}Error: Ticket ID is required (e.g. ese crew escalate 42 --reason "Blocked by DB migration")${colors.reset}`);
    process.exit(1);
  }

  const reason = (flags['reason'] as string) || (flags['r'] as string) || positionals.slice(1).join(' ').trim();
  if (!reason) {
    console.error(`${colors.red}Error: Escalation reason is required (--reason "<explanation>")${colors.reset}`);
    process.exit(1);
  }

  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const lookupKey = parseLookupKey(rawId, project);
  const caller = resolveWorkerIdentity(discovered.config);

  const ticket = await storage.releaseTicket(lookupKey, {
    system: caller.system,
    workerId: caller.workerId,
    finalStatus: 'Planned',
    notes: `[Escalation] ${reason}`,
    force: true,
  });

  if (isJson) {
    console.log(JSON.stringify({ ticket, escalatedBy: caller, reason }, null, 2));
  } else {
    console.log(`${colors.bold}${colors.green}✔ Escalated Ticket #${ticket.meta.id}: lease released and status reset to Planned.${colors.reset}`);
    console.log(`  • Escalated By: ${caller.system}:${caller.workerId} (${caller.role})`);
    console.log(`  • Reason:       ${reason}`);
    console.log(`  • Lead / Anchor notified via ticket comment.`);
  }
}

export async function handleDispatch(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese crew dispatch <ticketId> [options]\n`);
    console.log(`One-Shot Ticket Dispatch: Atomically delegates a ticket and starts worker execution.\n`);
    console.log(`${colors.bold}Arguments:${colors.reset}`);
    console.log(`  <ticketId>            Numeric ticket ID or project key (e.g. 42 or Prof-42)\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  --worker <workerId>   Target worker identity (default: thug-1, or anchor-1 with --mode plan)`);
    console.log(`  --role <role>         Target worker role: 'thug' or 'anchor' (default: thug, or anchor with --mode plan)`);
    console.log(`  --mode <mode>         'implement' (default) or 'plan'. Plan mode has an anchor write the implementation`);
    console.log(`                        plan only: no worktree, no code changes, ticket status left unchanged`);
    console.log(`  --allow-no-plan       Allow agent implementation of a ticket that has no implementation plan`);
    console.log(`                        (default: refused; run --mode plan first)`);
    console.log(`  --exec "<command>"    Command to execute for this ticket`);
    console.log(`  --agent-cmd "<cmd>"   Autonomous AI agent command template (e.g. "agy -p {{prompt}}")`);
    console.log(`  --engine <name>       Agent engine: 'antigravity', 'claude', 'shell', or 'headless'`);
    console.log(`  --bg, --background    Run detached in background and immediately yield terminal`);
    console.log(`  --complete            Mark ticket Completed upon successful exec (exit 0)`);
    console.log(`                        (default: leaves ticket In Development with success note)`);
    console.log(`  --no-worktree         Execute directly in active repo instead of git worktree`);
    console.log(`  --ttl <minutes>       Lease TTL in minutes (default: 15)`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  const rawId = positionals[0];
  if (!rawId) {
    console.error(`${colors.red}Error: Ticket ID is required (e.g. ese crew dispatch 42 --worker thug-1 --exec "npm test")${colors.reset}`);
    process.exit(1);
  }

  const caller = resolveWorkerIdentity(discovered.config);
  if (caller.role === 'thug') {
    console.error(`${colors.red}Access Denied: Role 'thug' cannot dispatch tasks. Only Leads and Anchors may dispatch.${colors.reset}`);
    process.exit(1);
  }

  const mode: WorkerMode = flags['mode'] === undefined ? 'implement' : (String(flags['mode']).toLowerCase() as WorkerMode);
  if (mode !== 'implement' && mode !== 'plan') {
    console.error(`${colors.red}Error: Invalid --mode '${flags['mode']}'. Valid options: 'implement', 'plan'.${colors.reset}`);
    process.exit(1);
  }
  const isPlanMode = mode === 'plan';
  const allowNoPlan = Boolean(flags['allow-no-plan']);

  const targetWorker = (flags['worker'] as string) || (flags['to'] as string) || positionals[1] || (isPlanMode ? 'anchor-1' : 'thug-1');
  const targetRole = (flags['role'] as WorkerRole) || (isPlanMode ? 'anchor' : 'thug');
  if (isPlanMode && targetRole !== 'anchor') {
    console.error(`${colors.red}Error: Plan mode requires the 'anchor' role (got '${targetRole}'). Planning is a senior task: use --role anchor.${colors.reset}`);
    process.exit(1);
  }
  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const lookupKey = parseLookupKey(rawId, project);
  const ttl = flags['ttl'] ? parseInt(String(flags['ttl']), 10) : undefined;

  const execCommand = (flags['exec'] as string) || undefined;

  let ticket: EsedreTicket;
  if (isPlanMode) {
    // Plan mode: the worker takes the lease itself so it can restore the ticket's original status.
    // Here we only verify the ticket exists, is open, and is not leased by someone else.
    const existing = await storage.getTicket(lookupKey);
    if (!existing) {
      console.error(`${colors.red}Error: Ticket '${rawId}' not found.${colors.reset}`);
      process.exit(1);
    }
    if (existing.meta.status === 'Completed' || existing.meta.status === 'Rejected') {
      console.error(`${colors.red}Error: Ticket ${rawId} is ${existing.meta.status}; nothing to plan.${colors.reset}`);
      process.exit(1);
    }
    const lease = existing.meta.lease;
    if (lease && new Date(lease.expiresAt).getTime() > Date.now()) {
      const isMine =
        lease.system.toLowerCase() === caller.system.toLowerCase() &&
        lease.workerId.toLowerCase() === targetWorker.toLowerCase();
      if (!isMine) {
        console.error(`${colors.red}Error: Ticket ${rawId} is leased by ${lease.system}:${lease.workerId} until ${lease.expiresAt}.${colors.reset}`);
        process.exit(1);
      }
    }
    ticket = existing;
  } else {
    // Implementation guard: refuse an unplanned ticket before any lease is taken.
    if (!execCommand && !allowNoPlan) {
      const current = await storage.getPlan(lookupKey).catch(() => null);
      if (isPlanEmpty(current)) {
        console.error(`${colors.red}Error: Ticket ${rawId} has no implementation plan.${colors.reset}`);
        console.error(`  Plan it first:  ese crew dispatch ${rawId} --mode plan --bg`);
        console.error(`  Or implement from the specification alone with --allow-no-plan.`);
        process.exit(1);
      }
    }
    ticket = await storage.claimTicket(lookupKey, {
      system: caller.system,
      workerId: targetWorker,
      role: targetRole,
      ttlMinutes: ttl,
      force: true,
    });
  }

  const agentCommand = (flags['agent-cmd'] as string) || (flags['agent'] as string) || discovered.config?.agentCommand || undefined;
  const engine = (flags['engine'] as 'antigravity' | 'claude' | 'shell' | 'headless') || discovered.config?.engine || undefined;
  const isBg = Boolean(flags['bg'] || flags['background']);
  const isComplete = Boolean(flags['complete'] || flags['complete-on-success']);
  const noWorktree = Boolean(flags['no-worktree']);

  if (isBg) {
    const args = [
      process.argv[1],
      'crew',
      'worker',
      '--id', targetWorker,
      '--role', targetRole,
      '--ticket', String(ticket.meta.id),
      '--once',
    ];
    if (execCommand) args.push('--exec', execCommand);
    if (isPlanMode) args.push('--mode', 'plan');
    if (allowNoPlan) args.push('--allow-no-plan');
    if (agentCommand) args.push('--agent-cmd', agentCommand);
    if (engine) args.push('--engine', engine);
    if (isComplete) args.push('--complete');
    if (noWorktree) args.push('--no-worktree');
    if (ttl) args.push('--ttl', String(ttl));
    if (project) args.push('--project', project);

    const ticketKey = `${ticket.meta.project}-${ticket.meta.id}`;
    const restoreStatus: 'Planned' | 'In Development' =
      isPlanMode && ticket.meta.status === 'In Development' ? 'In Development' : 'Planned';
    const livenessMs = process.env.ESEDRE_BG_LIVENESS_MS !== undefined
      ? Math.max(0, parseInt(process.env.ESEDRE_BG_LIVENESS_MS, 10) || 0)
      : 3000;

    // The worker logs itself to a per-worker file and receives its env via a one-shot file, so it can
    // be launched outside this process tree (see launchDetached).
    const logFile = getWorkerLogPath(targetWorker, ticketKey, discovered.workspaceRoot);
    const envFile = getWorkerRunFile(targetWorker, ticketKey, discovered.workspaceRoot).replace(/\.json$/, '.env.json');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(
      envFile,
      JSON.stringify(collectWorkerEnv(process.env, { ESEDRE_WORKER_ID: targetWorker, ESEDRE_WORKER_ROLE: targetRole })),
      { encoding: 'utf-8', mode: 0o600 }
    );
    args.push('--log-file', logFile, '--worker-env-file', envFile);

    const logFd = fs.openSync(logFile, 'a');
    fs.writeSync(
      logFd,
      `\n=== ${new Date().toISOString()} dispatch ${ticketKey} worker=${targetWorker} role=${targetRole} mode=${mode} ===\n`
    );
    const launched = launchDetached({
      exe: process.execPath,
      args,
      cwd: discovered.workspaceRoot || process.cwd(),
      logFd,
      env: {
        ...process.env,
        ESEDRE_WORKER_ID: targetWorker,
        ESEDRE_WORKER_ROLE: targetRole,
      },
    });
    fs.closeSync(logFd);
    const child = { pid: launched.pid };

    if (child.pid) {
      writeWorkerRun(
        {
          pid: child.pid,
          workerId: targetWorker,
          role: targetRole,
          mode,
          ticketId: ticket.meta.id,
          ticketKey,
          system: caller.system,
          startedAt: new Date().toISOString(),
          logFile,
        },
        discovered.workspaceRoot
      );
    }

    // Short liveness window: catch a worker that dies or fails to launch immediately.
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const waitStart = Date.now();
    let workerExited = !child.pid;
    while (!workerExited && Date.now() - waitStart < livenessMs) {
      await sleep(150);
      if (!isPidAlive(child.pid)) workerExited = true;
    }
    const exitCode = workerExited ? readExitMarker(logFile) : undefined;

    const failDispatch = async (how: string, releaseLease: boolean): Promise<never> => {
      const tail = tailFile(logFile);
      if (releaseLease) {
        const note =
          `[Escalation] Background worker ${targetWorker} ${how} within ${livenessMs}ms of dispatch. ` +
          `Lease released.\nLog: ${logFile}` + (tail ? `\nLast output:\n${tail}` : '');
        try {
          await storage.releaseTicket(ticket.meta.id, {
            system: caller.system,
            workerId: targetWorker,
            finalStatus: restoreStatus,
            notes: note,
            force: true,
          });
        } catch {
          // best effort: the lease may never have been taken (plan mode) or is already released
        }
      }
      if (isJson) {
        console.log(JSON.stringify({ dispatched: false, ticketKey, workerId: targetWorker, reason: how, logFile, tail }, null, 2));
      } else {
        console.error(`${colors.red}${colors.bold}✘ Worker ${targetWorker} ${how} right after dispatch (Ticket ${ticketKey}).${colors.reset}`);
        console.error(`  • Log:    ${logFile}`);
        console.error(`  • Status: ticket is ${restoreStatus} with no lease; a failure comment is on the ticket.`);
        if (tail) console.error(`  • Last output:\n${tail.split('\n').map((l) => `      ${l}`).join('\n')}`);
      }
      process.exit(1);
    };

    if (workerExited && exitCode !== 0) {
      const how = !child.pid
        ? 'failed to launch (no PID)'
        : exitCode !== undefined
          ? `exited with code ${exitCode}`
          : 'died without an exit marker (killed or crashed during startup)';
      await failDispatch(how, true);
    }
    const finishedFast = workerExited;
    if (finishedFast && !isPlanMode) {
      // Exit code 0 can still mean the worker escalated (e.g. agent command failed): the ticket is back to Planned
      const after = await storage.getTicket(ticket.meta.id).catch(() => null);
      if (after && !after.meta.lease && after.meta.status === 'Planned') {
        await failDispatch('finished but escalated the ticket back to Planned', false);
      }
    }

    if (isJson) {
      console.log(JSON.stringify({
        dispatched: true,
        mode: 'background',
        workMode: mode,
        pid: child.pid,
        ticketId: ticket.meta.id,
        ticketKey: `${ticket.meta.project}-${ticket.meta.id}`,
        workerId: targetWorker,
        role: targetRole,
        exec: execCommand,
        agentCommand,
        engine,
        completeOnSuccess: isComplete,
        logFile,
        finishedWithinLivenessWindow: finishedFast,
      }, null, 2));
    } else if (isPlanMode) {
      console.log(`${colors.bold}${colors.green}✔ Dispatched planning for Ticket #${ticket.meta.id} to background worker ${caller.system}:${targetWorker} (${targetRole})${colors.reset}`);
      console.log(`  • Worker PID:  ${child.pid}`);
      if (agentCommand) console.log(`  • Agent Cmd:   ${agentCommand}`);
      console.log(`  • Mode:        plan (no worktree, no code changes)`);
      console.log(`  • Log:         ${logFile}`);
      console.log(`  • Status:      Ticket status is left unchanged; the plan is saved to the ticket.`);
      console.log(`\n${colors.cyan}Responsive Yield: Planning worker is running. Lead agent yields terminal control to user.${colors.reset}`);
    } else {
      console.log(`${colors.bold}${colors.green}✔ Dispatched Ticket #${ticket.meta.id} to background worker ${caller.system}:${targetWorker} (${targetRole})${colors.reset}`);
      console.log(`  • Worker PID:  ${child.pid}`);
      if (execCommand) console.log(`  • Command:     ${execCommand}`);
      if (agentCommand) console.log(`  • Agent Cmd:   ${agentCommand}`);
      if (engine) console.log(`  • Engine:      ${engine}`);
      console.log(`  • Mode:        Detached Background Process`);
      console.log(`  • Completion:  ${isComplete ? 'Auto-complete on success (--complete)' : 'Leave In Development on success'}`);
      console.log(`  • Log:         ${logFile}`);
      console.log(`  • Status:      ${finishedFast ? 'Worker finished within the liveness window (exit 0); see log.' : `Lease claimed, worker alive after ${livenessMs}ms liveness check.`}`);
      console.log(`\n${colors.cyan}Responsive Yield: Background worker is running. Lead agent yields terminal control to user.${colors.reset}`);
    }
    return;
  } else {
    const runner = new HeadlessWorkerRunner(storage, {
      workerId: targetWorker,
      role: targetRole,
      project,
      ticketId: ticket.meta.id,
      engine,
      agentCommand,
      execCommand,
      mode,
      allowNoPlan,
      completeOnSuccess: isComplete,
      useWorktree: isPlanMode ? false : !noWorktree,
      once: true,
      ttlMinutes: ttl,
      isJson,
      workspaceRoot: discovered.workspaceRoot,
    });
    const results = await runner.start();
    if (isJson) {
      console.log(JSON.stringify(results, null, 2));
    }
    return;
  }
}

export async function handleWorker(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  if (flags['help'] || flags['h']) {
    console.log(`${colors.bold}Usage:${colors.reset} ese crew worker [options]\n`);
    console.log(`Autonomous Headless Worker: Claims tickets and runs verification or worker tasks.\n`);
    console.log(`${colors.bold}Options:${colors.reset}`);
    console.log(`  --id <workerId>       Worker identity (default: thug-1, or anchor-1 with --mode plan)`);
    console.log(`  --role <role>         Worker role: 'thug' or 'anchor' (default: thug, or anchor with --mode plan)`);
    console.log(`  --mode <mode>         'implement' (default) or 'plan' (anchor writes the implementation plan only; requires -t)`);
    console.log(`  --allow-no-plan       Allow agent implementation of a ticket with no implementation plan`);
    console.log(`  -t, --ticket <id>     Target specific ticket instead of scanning backlog`);
    console.log(`  --exec "<command>"    Command to execute against worktree / workspace`);
    console.log(`  --agent-cmd "<cmd>"   Autonomous AI agent command template (e.g. "agy -p {{prompt}}")`);
    console.log(`  --engine <name>       Agent engine: 'antigravity', 'claude', 'shell', or 'headless'`);
    console.log(`  --complete            Mark ticket Completed upon successful exec (exit 0)`);
    console.log(`                        (default: leaves ticket In Development with success note)`);
    console.log(`  --once                Run a single cycle and exit immediately`);
    console.log(`  --poll <seconds>      Polling interval when idle in seconds (default: 10)`);
    console.log(`  --ttl <minutes>       Lease TTL in minutes (default: 15)`);
    console.log(`  --no-worktree         Execute directly in active repo instead of git worktree`);
    console.log(`  --max-workers <n>     Max concurrent workers per host system`);
    console.log(`  --dry-run             Preview ticket claim without modifying state`);
    console.log(`  -p, --project <code>  Target project code`);
    console.log(`  --json                Output machine-readable JSON`);
    console.log(`  -h, --help            Show this help screen`);
    return;
  }

  // Detached (--bg) workers are launched with --log-file: send all console output and the agent
  // child's stdio to that file so a failure is never silent.
  let childStdioFd: number | undefined;
  if (flags['log-file']) {
    childStdioFd = attachWorkerLog(String(flags['log-file']));
  }
  // Test-only hook: simulates a worker that crashes immediately at startup.
  if (process.env.ESEDRE_WORKER_CRASH_FOR_TEST === '1') {
    throw new Error('Simulated worker startup crash (ESEDRE_WORKER_CRASH_FOR_TEST)');
  }

  const mode: WorkerMode = flags['mode'] === undefined ? 'implement' : (String(flags['mode']).toLowerCase() as WorkerMode);
  if (mode !== 'implement' && mode !== 'plan') {
    console.error(`${colors.red}Error: Invalid --mode '${flags['mode']}'. Valid options: 'implement', 'plan'.${colors.reset}`);
    process.exit(1);
  }
  const allowNoPlan = Boolean(flags['allow-no-plan']);
  const workerId = (flags['id'] as string) || (flags['name'] as string) || positionals[0] || (mode === 'plan' ? 'anchor-1' : 'thug-1');
  const role = (flags['role'] as WorkerRole) || (mode === 'plan' ? 'anchor' : 'thug');
  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const ticketId = (flags['ticket'] as string) || (flags['t'] as string) || undefined;
  const agentCommand = (flags['agent-cmd'] as string) || (flags['agent'] as string) || discovered.config?.agentCommand || undefined;
  const engine = (flags['engine'] as 'antigravity' | 'claude' | 'shell' | 'headless') || discovered.config?.engine || undefined;
  const pollSec = flags['poll'] ? parseInt(String(flags['poll']), 10) : undefined;
  const pollIntervalMs = pollSec && pollSec > 0 ? pollSec * 1000 : 10000;
  const ttl = flags['ttl'] ? parseInt(String(flags['ttl']), 10) : undefined;
  const useWorktree = flags['no-worktree'] ? false : (flags['worktree'] !== undefined ? Boolean(flags['worktree']) : undefined);
  const execCommand = (flags['exec'] as string) || undefined;
  const completeOnSuccess = Boolean(flags['complete'] || flags['complete-on-success']);
  const once = Boolean(flags['once']);
  const dryRun = Boolean(flags['dry-run']);
  const maxWorkersFlag = flags['max-workers'] ? parseInt(String(flags['max-workers']), 10) : undefined;
  const maxWorkers = maxWorkersFlag !== undefined
    ? maxWorkersFlag
    : (discovered.config?.maxWorkers !== undefined ? discovered.config.maxWorkers : undefined);

  let runner: HeadlessWorkerRunner;
  try {
    runner = new HeadlessWorkerRunner(storage, {
      workerId,
      role,
      project,
      ticketId,
      engine,
      agentCommand,
      pollIntervalMs,
      ttlMinutes: ttl,
      useWorktree,
      execCommand,
      mode,
      allowNoPlan,
      completeOnSuccess,
      once,
      dryRun,
      isJson,
      workspaceRoot: discovered.workspaceRoot,
      maxWorkers,
      childStdioFd,
    });
  } catch (err: any) {
    console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
    process.exit(1);
  }

  let results;
  try {
    results = await runner.start();
  } catch (err: any) {
    console.error(`${colors.red}Error: Worker ${workerId} failed: ${err?.message || err}${colors.reset}`);
    process.exit(1);
  }
  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
  }
}

export async function handleLease(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  const sub = positionals[0]?.toLowerCase();
  const subPositionals = positionals.slice(1);

  if (flags['help'] || flags['h']) {
    if (!sub || sub === 'help') {
      console.log(`${colors.bold}Usage:${colors.reset} ese lease [command] [options]\n`);
      console.log(`Ticket Lease & Mutual Exclusion Subcommands:\n`);
      console.log(`  ese lease list [-p <project>] [--all]`);
      console.log(`  ese lease claim <ticketId> [--role anchor|thug] [--ttl <minutes>]`);
      console.log(`  ese lease release <ticketId> [--status <status>] [--notes "<notes>"]`);
      console.log(`  ese lease renew <ticketId> [--ttl <minutes>]\n`);
      console.log(`Run 'ese lease <command> --help' for details on a specific subcommand.`);
      return;
    }
  }

  switch (sub) {
    case 'claim':
      return handleClaim(storage, subPositionals, flags, isJson, discovered);
    case 'release':
      return handleRelease(storage, subPositionals, flags, isJson, discovered);
    case 'renew':
      return handleRenew(storage, subPositionals, flags, isJson, discovered);
    case 'list':
    case 'ls':
      return handleLeases(storage, subPositionals, flags, isJson, discovered);
    default: {
      if (!sub || sub === 'all') {
        return handleLeases(storage, positionals, flags, isJson, discovered);
      }
      console.error(`${colors.red}Error: Unknown lease subcommand "${sub}"${colors.reset}`);
      console.log(`\nUsage:`);
      console.log(`  ese lease list [-p <project>] [--all]`);
      console.log(`  ese lease claim <ticketId> [--role anchor|thug] [--ttl <minutes>]`);
      console.log(`  ese lease release <ticketId> [--status <status>] [--notes "<notes>"]`);
      console.log(`  ese lease renew <ticketId> [--ttl <minutes>]`);
      process.exit(1);
    }
  }
}

export async function handleCrew(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  const sub = positionals[0]?.toLowerCase();
  const subPositionals = positionals.slice(1);

  if (flags['help'] || flags['h']) {
    if (!sub || sub === 'help') {
      console.log(`${colors.bold}Esedre Crew Fleet Commands:${colors.reset}\n`);
      console.log(`  ese crew dispatch <id> [--worker <target>] [--mode plan|implement] [--exec "<cmd>"] [--bg] [--complete] [--allow-no-plan]`);
      console.log(`  ese crew worker [-t <id>] [--id <id>] [--role anchor|thug] [--exec "<cmd>"] [--once] [--complete]`);
      console.log(`  ese crew delegate <id> --worker <workerId>`);
      console.log(`  ese crew escalate <id> --reason "<explanation>"`);
      console.log(`  ese crew whoami`);
      console.log(`  ese crew leases\n`);
      console.log(`Run 'ese crew <command> --help' for details on a specific subcommand.`);
      return;
    }
  }

  switch (sub) {
    case 'dispatch':
      return handleDispatch(storage, subPositionals, flags, isJson, discovered);
    case 'claim':
      return handleClaim(storage, subPositionals, flags, isJson, discovered);
    case 'release':
      return handleRelease(storage, subPositionals, flags, isJson, discovered);
    case 'renew':
      return handleRenew(storage, subPositionals, flags, isJson, discovered);
    case 'leases':
    case 'list':
      return handleLeases(storage, subPositionals, flags, isJson, discovered);
    case 'delegate':
      return handleDelegate(storage, subPositionals, flags, isJson, discovered);
    case 'escalate':
      return handleEscalate(storage, subPositionals, flags, isJson, discovered);
    case 'worker':
      return handleWorker(storage, subPositionals, flags, isJson, discovered);
    case 'whoami':
    case 'status': {
      if (flags['help'] || flags['h']) {
        console.log(`${colors.bold}Usage:${colors.reset} ese crew whoami [options]\n`);
        console.log(`Show current host machine identity, active worker identity, and role.\n`);
        console.log(`${colors.bold}Options:${colors.reset}`);
        console.log(`  --json                Output machine-readable JSON`);
        console.log(`  -h, --help            Show this help screen`);
        return;
      }
      const identity = resolveWorkerIdentity(discovered.config);
      if (isJson) {
        console.log(JSON.stringify(identity, null, 2));
      } else {
        console.log(`${colors.bold}Current Crew Identity:${colors.reset}`);
        console.log(`  • System:    ${colors.cyan}${identity.system}${colors.reset}`);
        console.log(`  • Worker ID: ${colors.bold}${identity.workerId}${colors.reset}`);
        console.log(`  • Role:      ${colors.yellow}${identity.role}${colors.reset}`);
      }
      return;
    }
    default: {
      console.log(`${colors.bold}Esedre Crew Fleet Commands:${colors.reset}`);
      console.log(`  ese crew dispatch <id> [--worker <target>] [--mode plan|implement] [--exec "<cmd>"] [--bg] [--complete] [--allow-no-plan]`);
      console.log(`  ese crew worker [-t <id>] [--id <id>] [--role anchor|thug] [--exec "<cmd>"] [--once] [--complete]`);
      console.log(`  ese crew delegate <id> --worker <workerId>`);
      console.log(`  ese crew escalate <id> --reason "<explanation>"`);
      console.log(`  ese crew whoami`);
      console.log(`  ese crew leases`);
      return;
    }
  }
}
