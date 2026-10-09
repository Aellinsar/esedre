import { TicketRepository } from '../storage/repository.js';
import { resolveWorkerIdentity, resolveSystemIdentity } from '../utils/identity.js';
import { formatLeaseListTable, colors } from '../utils/formatter.js';
import { CrewRole, WorkerRole, TicketStatus } from '../types.js';
import { HeadlessWorkerRunner } from './worker.js';

function parseLookupKey(rawId: string, project?: string): string {
  if (!rawId) return '';
  const trimmed = rawId.trim();
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
  const projectArg = (flags['project'] as string) || (flags['p'] as string) || positionals[0] || discovered.config?.projectCode;
  const filterProject = !projectArg || projectArg.toLowerCase() === 'all' ? undefined : projectArg;

  const leases = await storage.listActiveLeases(filterProject);

  if (isJson) {
    console.log(JSON.stringify(leases, null, 2));
  } else {
    console.log(formatLeaseListTable(leases));
  }
}

export async function handleDelegate(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
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

export async function handleWorker(
  storage: TicketRepository,
  positionals: string[],
  flags: Record<string, any>,
  isJson: boolean,
  discovered: any
): Promise<void> {
  const workerId = (flags['id'] as string) || (flags['name'] as string) || positionals[0] || 'thug-1';
  const role = (flags['role'] as WorkerRole) || 'thug';
  const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
  const pollSec = flags['poll'] ? parseInt(String(flags['poll']), 10) : undefined;
  const pollIntervalMs = pollSec && pollSec > 0 ? pollSec * 1000 : 10000;
  const ttl = flags['ttl'] ? parseInt(String(flags['ttl']), 10) : undefined;
  const useWorktree = flags['no-worktree'] ? false : (flags['worktree'] !== undefined ? Boolean(flags['worktree']) : undefined);
  const execCommand = (flags['exec'] as string) || undefined;
  const once = Boolean(flags['once']);
  const dryRun = Boolean(flags['dry-run']);
  const maxWorkersFlag = flags['max-workers'] ? parseInt(String(flags['max-workers']), 10) : undefined;
  const maxWorkers = maxWorkersFlag !== undefined
    ? maxWorkersFlag
    : (discovered.config?.maxWorkers !== undefined ? discovered.config.maxWorkers : undefined);

  const runner = new HeadlessWorkerRunner(storage, {
    workerId,
    role,
    project,
    pollIntervalMs,
    ttlMinutes: ttl,
    useWorktree,
    execCommand,
    once,
    dryRun,
    isJson,
    workspaceRoot: discovered.workspaceRoot,
    maxWorkers,
  });

  const results = await runner.start();
  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
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

  switch (sub) {
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
      console.log(`  ese claim <id> [--role anchor|thug] [--ttl <m>] [--worktree <p>] [--force]`);
      console.log(`  ese release <id> [--status <s>] [--notes "..."] [--force]`);
      console.log(`  ese renew <id> [--ttl <m>]`);
      console.log(`  ese leases [-p <code|all>]`);
      console.log(`  ese crew delegate <id> --worker <workerId>`);
      console.log(`  ese crew escalate <id> --reason "<explanation>"`);
      console.log(`  ese crew worker [--id <id>] [--role anchor|thug] [--exec "<cmd>"] [--once]`);
      console.log(`  ese crew whoami`);
      return;
    }
  }
}
