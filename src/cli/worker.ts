import path from 'node:path';
import { execSync } from 'node:child_process';
import { TicketRepository } from '../storage/repository.js';
import { resolveSystemIdentity } from '../utils/identity.js';
import { setupWorktree, isInsideGitRepo } from '../utils/gitWorktree.js';
import { colors } from '../utils/formatter.js';
import { logDebug } from '../utils/logger.js';
import { WorkerRole, EsedreTicket } from '../types.js';
import { readGlobalConfig } from '../config.js';

export interface WorkerRunnerOptions {
  workerId: string;
  role?: WorkerRole;
  project?: string;
  pollIntervalMs?: number;
  ttlMinutes?: number;
  useWorktree?: boolean;
  execCommand?: string;
  once?: boolean;
  dryRun?: boolean;
  isJson?: boolean;
  workspaceRoot?: string;
  maxWorkers?: number;
}

export interface WorkerCycleResult {
  ticketId?: number | string;
  ticketKey?: string;
  action: 'claimed_and_completed' | 'claimed_and_escalated' | 'claimed_and_held' | 'idle';
  error?: string;
}

export class HeadlessWorkerRunner {
  private workerId: string;
  private role: WorkerRole;
  private project?: string;
  private pollIntervalMs: number;
  private ttlMinutes: number;
  private useWorktree: boolean;
  private execCommand?: string;
  private once: boolean;
  private dryRun: boolean;
  private isJson: boolean;
  private workspaceRoot: string;
  private storage: TicketRepository;
  private system: string;
  private worktreePath?: string;
  private isRunning = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private activeTicketId?: number | string;
  private maxWorkers?: number;

  constructor(storage: TicketRepository, options: WorkerRunnerOptions) {
    this.storage = storage;
    this.workerId = options.workerId || 'thug-1';
    this.role = options.role || 'thug';
    this.project = options.project;
    this.pollIntervalMs = options.pollIntervalMs || 10000;
    this.ttlMinutes = options.ttlMinutes || 15;
    this.useWorktree = options.useWorktree !== undefined ? options.useWorktree : this.role === 'thug';
    this.execCommand = options.execCommand;
    this.once = Boolean(options.once);
    this.dryRun = Boolean(options.dryRun);
    this.isJson = Boolean(options.isJson);
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    this.maxWorkers = options.maxWorkers !== undefined
      ? options.maxWorkers
      : (readGlobalConfig()?.maxWorkers !== undefined ? readGlobalConfig()!.maxWorkers : undefined);

    this.system = resolveSystemIdentity();

    // Bind process identity
    process.env.ESEDRE_WORKER_ID = this.workerId;
    process.env.ESEDRE_WORKER_ROLE = this.role;
  }

  public async start(): Promise<WorkerCycleResult[]> {
    this.isRunning = true;
    const results: WorkerCycleResult[] = [];

    this.logInfo(
      `Starting Headless Worker '${this.workerId}' (${this.role}) on system '${this.system}'`
    );

    // Setup git worktree if enabled
    if (this.useWorktree && isInsideGitRepo(this.workspaceRoot)) {
      try {
        const wt = await setupWorktree(this.workspaceRoot, this.workerId);
        this.worktreePath = wt.worktreePath;
        this.logInfo(`Assigned git worktree: ${this.worktreePath} (branch: ${wt.branch})`);
      } catch (err: any) {
        this.logError(`Could not setup git worktree: ${err.message}`);
        this.worktreePath = undefined;
      }
    }

    const cleanup = async () => {
      this.stopHeartbeat();
      if (this.activeTicketId) {
        try {
          this.logInfo(`Releasing lease on Ticket #${this.activeTicketId} due to worker shutdown`);
          await this.storage.releaseTicket(this.activeTicketId, {
            system: this.system,
            workerId: this.workerId,
            finalStatus: 'Planned',
            notes: '[Shutdown] Headless worker process terminated.',
            force: true,
          });
        } catch {}
      }
    };

    const sigintHandler = async () => {
      this.isRunning = false;
      await cleanup();
      process.exit(0);
    };

    process.once('SIGINT', sigintHandler);
    process.once('SIGTERM', sigintHandler);

    try {
      do {
        const cycle = await this.runSingleCycle();
        results.push(cycle);

        if (this.once) {
          break;
        }

        if (this.isRunning) {
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      } while (this.isRunning);
    } finally {
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('SIGTERM', sigintHandler);
      this.stopHeartbeat();
    }

    return results;
  }

  public stop(): void {
    this.isRunning = false;
    this.stopHeartbeat();
  }

  public async runSingleCycle(): Promise<WorkerCycleResult> {
    const candidate = await this.findNextClaimableTicket();
    if (!candidate) {
      this.logDebug('No claimable tickets matching worker criteria.');
      return { action: 'idle' };
    }

    const ticketId = candidate.meta.id;
    const ticketKey = `${candidate.meta.project || ''}-${ticketId}`;
    this.activeTicketId = ticketId;

    this.logInfo(`Claiming Ticket #${ticketId} ("${candidate.meta.title}")`);

    if (this.dryRun) {
      this.logInfo(`[Dry Run] Would claim and execute Ticket #${ticketId}`);
      return { ticketId, ticketKey, action: 'claimed_and_held' };
    }

    // 1. Claim ticket lease
    try {
      await this.storage.claimTicket(ticketId, {
        system: this.system,
        workerId: this.workerId,
        role: this.role,
        ttlMinutes: this.ttlMinutes,
        worktree: this.worktreePath,
        engine: 'headless',
      });
    } catch (err: any) {
      this.logError(`Failed to claim ticket #${ticketId}: ${err.message}`);
      return { ticketId, ticketKey, action: 'idle', error: err.message };
    }

    // 2. Start rolling heartbeat
    this.startHeartbeat(ticketId);

    // 3. Execute command if provided
    if (this.execCommand) {
      const workingDir = this.worktreePath || this.workspaceRoot;
      this.logInfo(`Executing task command: "${this.execCommand}" in ${workingDir}`);

      try {
        execSync(this.execCommand, {
          cwd: workingDir,
          stdio: 'inherit',
          env: {
            ...process.env,
            ESEDRE_WORKER_ID: this.workerId,
            ESEDRE_WORKER_ROLE: this.role,
            ESEDRE_TICKET_ID: String(ticketId),
          },
        });

        // If inside worktree, auto-commit any modifications
        if (this.worktreePath && isInsideGitRepo(this.worktreePath)) {
          try {
            const status = execSync('git status --porcelain', {
              cwd: this.worktreePath,
              encoding: 'utf-8',
            });
            if (status.trim()) {
              execSync('git add -A', { cwd: this.worktreePath, stdio: 'ignore' });
              execSync(`git commit -m "[#${ticketId}] Execute automated worker task (${this.workerId})"`, {
                cwd: this.worktreePath,
                stdio: 'ignore',
              });
              this.logInfo(`Committed worktree changes on branch for Ticket #${ticketId}`);
            }
          } catch (err: any) {
            this.logDebug(`Worktree commit check: ${err.message}`);
          }
        }

        // Release as completed
        this.stopHeartbeat();
        await this.storage.releaseTicket(ticketId, {
          system: this.system,
          workerId: this.workerId,
          finalStatus: 'Completed',
          notes: `Automated worker execution completed successfully by ${this.workerId}.`,
        });

        this.logInfo(`Ticket #${ticketId} completed and lease released.`);
        this.activeTicketId = undefined;
        return { ticketId, ticketKey, action: 'claimed_and_completed' };
      } catch (err: any) {
        this.stopHeartbeat();
        const errorSummary = err.message || 'Execution error';
        this.logError(`Execution failed for Ticket #${ticketId}: ${errorSummary}`);

        // Escalation: release lease and return status to Planned
        await this.storage.releaseTicket(ticketId, {
          system: this.system,
          workerId: this.workerId,
          finalStatus: 'Planned',
          notes: `[Escalation] Automated worker execution failed: ${errorSummary}`,
          force: true,
        });

        this.activeTicketId = undefined;
        return { ticketId, ticketKey, action: 'claimed_and_escalated', error: errorSummary };
      }
    } else {
      // No execCommand provided: worker holds lease
      this.logInfo(`Holding lease on Ticket #${ticketId} (heartbeat active).`);
      return { ticketId, ticketKey, action: 'claimed_and_held' };
    }
  }

  private async findNextClaimableTicket(): Promise<EsedreTicket | null> {
    const filter = this.project && this.project.toLowerCase() !== 'all' ? { project: this.project } : undefined;
    const tickets = await this.storage.listTickets(filter);
    const now = Date.now();

    // 1. First priority: Tickets already leased by this worker instance
    const myLease = tickets.find((t) => {
      const lease = t.meta.lease;
      if (!lease) return false;
      return (
        lease.system.toLowerCase() === this.system.toLowerCase() &&
        lease.workerId.toLowerCase() === this.workerId.toLowerCase() &&
        new Date(lease.expiresAt).getTime() > now
      );
    });
    if (myLease) return myLease;

    // Check host worker pool limit before claiming a new ticket
    if (this.maxWorkers !== undefined && this.maxWorkers > 0) {
      try {
        const activeLeases = await this.storage.listActiveLeases();
        const systemLeases = activeLeases.filter(
          (l) => l.system.toLowerCase() === this.system.toLowerCase()
        );
        const activeWorkersOnSystem = new Set(
          systemLeases.map((l) => l.workerId.toLowerCase())
        );
        if (
          !activeWorkersOnSystem.has(this.workerId.toLowerCase()) &&
          activeWorkersOnSystem.size >= this.maxWorkers
        ) {
          this.logDebug(
            `Worker pool limit reached (${activeWorkersOnSystem.size}/${this.maxWorkers} active on ${this.system}). Waiting...`
          );
          return null;
        }
      } catch (err: any) {
        this.logDebug(`Worker pool limit check error: ${err.message}`);
      }
    }

    // 2. Second priority: Tickets explicitly assigned to this worker
    const assigned = tickets.find((t) => {
      if (t.meta.status === 'Completed' || t.meta.status === 'Rejected') return false;
      const assignee = (t.meta.assignee || '').toLowerCase();
      const match =
        assignee === this.workerId.toLowerCase() ||
        assignee === `${this.system}:${this.workerId}`.toLowerCase();
      if (!match) return false;

      // Ensure no other active lease
      if (t.meta.lease && new Date(t.meta.lease.expiresAt).getTime() > now) {
        return false;
      }
      return true;
    });
    if (assigned) return assigned;

    // 3. Third priority: Unleased and unassigned planned tickets in project
    const unleased = tickets.find((t) => {
      if (t.meta.status !== 'Planned') return false;
      if (t.isBlocked) return false;
      if (t.meta.assignee && t.meta.assignee.trim()) {
        const assignee = t.meta.assignee.toLowerCase();
        const isMine =
          assignee === this.workerId.toLowerCase() ||
          assignee === `${this.system}:${this.workerId}`.toLowerCase();
        if (!isMine) return false;
      }
      if (t.meta.lease && new Date(t.meta.lease.expiresAt).getTime() > now) {
        return false;
      }
      return true;
    });

    return unleased || null;
  }

  private startHeartbeat(ticketId: number | string): void {
    this.stopHeartbeat();
    const intervalMs = Math.max(30000, Math.floor((this.ttlMinutes * 60 * 1000) / 2));

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.storage.renewLease(ticketId, this.system, this.workerId, this.ttlMinutes);
        this.logDebug(`Heartbeat: Renewed lease on Ticket #${ticketId}`);
      } catch (err: any) {
        this.logError(`Heartbeat failure for Ticket #${ticketId}: ${err.message}`);
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private logInfo(msg: string): void {
    if (this.isJson) return;
    console.log(`${colors.cyan}[Worker:${this.workerId}]${colors.reset} ${msg}`);
  }

  private logError(msg: string): void {
    if (this.isJson) return;
    console.error(`${colors.red}[Worker:${this.workerId}] Error:${colors.reset} ${msg}`);
  }

  private logDebug(msg: string): void {
    logDebug('worker', `[${this.workerId}] ${msg}`);
  }
}
