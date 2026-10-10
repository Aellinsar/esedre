import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { TicketRepository } from '../storage/repository.js';
import { resolveSystemIdentity } from '../utils/identity.js';
import { setupWorktree, isInsideGitRepo } from '../utils/gitWorktree.js';
import { colors } from '../utils/formatter.js';
import { logDebug } from '../utils/logger.js';
import { WorkerRole, EsedreTicket } from '../types.js';
import { readGlobalConfig } from '../config.js';

export function isBinaryAvailable(binName: string): boolean {
  if (!binName || typeof binName !== 'string') return false;
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${binName}` : `which ${binName}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function resolveAgentBinary(binName: string): string | null {
  if (isBinaryAvailable(binName)) {
    return binName;
  }

  if (binName === 'agy') {
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const defaultPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      if (fs.existsSync(defaultPath)) {
        return `"${defaultPath}"`;
      }
    } else {
      const defaultPath = path.join(os.homedir(), '.local', 'bin', 'agy');
      if (fs.existsSync(defaultPath)) {
        return `"${defaultPath}"`;
      }
    }
  }

  if (binName === 'claude') {
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const npmClaude = path.join(appData, 'npm', 'claude.cmd');
      if (fs.existsSync(npmClaude)) {
        return `"${npmClaude}"`;
      }
    }
  }

  return null;
}

export function generateTaskPrompt(ticket: EsedreTicket, planMarkdown?: string, workerId?: string): string {
  const meta = ticket.meta;
  const rawDetail = ticket.detail?.raw || ticket.detail?.summary || '';

  return `# Autonomous Task: Ticket #${meta.id} - ${meta.title}

- **Project**: ${meta.project || 'Default'}
- **Type**: ${meta.type}
- **Priority**: ${meta.priority || 'Normal'}
- **Worker**: ${workerId || 'thug-1'}

## Specification
${rawDetail.trim() || 'No detailed specification provided.'}

## Implementation Plan
${planMarkdown?.trim() || 'Implement the ticket according to specification, verify with test and build commands.'}

## Guidelines for Autonomous Agent
1. Work strictly within this directory/worktree.
2. Implement the required changes, preserving existing architecture and conventions.
3. Run test suites and linting to ensure no regressions.
4. Keep modifications focused strictly on the assigned ticket.
`;
}

export type WorkerMode = 'implement' | 'plan';

/** A plan counts as missing when it is null, empty, or whitespace only. */
export function isPlanEmpty(plan: string | null | undefined): boolean {
  return typeof plan !== 'string' || plan.trim().length === 0;
}

export function generatePlanTaskPrompt(
  ticket: EsedreTicket,
  ticketKey: string,
  existingPlan: string | null | undefined,
  planDraftPath: string,
  workerId?: string
): string {
  const meta = ticket.meta;
  const rawDetail = ticket.detail?.raw || ticket.detail?.summary || '';
  const hasExisting = !isPlanEmpty(existingPlan);

  return `# Planning Task: Ticket ${ticketKey} - ${meta.title}

- **Project**: ${meta.project || 'Default'}
- **Type**: ${meta.type}
- **Priority**: ${meta.priority || 'Normal'}
- **Worker**: ${workerId || 'anchor-1'}
- **Mode**: plan (planning only, no implementation)

## Specification
${rawDetail.trim() || 'No detailed specification provided.'}

## Existing Implementation Plan
${hasExisting ? existingPlan!.trim() : 'None. This ticket has no implementation plan yet.'}

## Guidelines for Planning Agent
1. Your only deliverable is an implementation plan saved to this ticket. Do NOT modify, create, or delete any source files.
2. Read the specification and explore the repository (read-only) to understand the architecture, conventions, and affected files.
3. Write the plan as Markdown to \`${planDraftPath}\`. Include goals, the files to change, step-by-step implementation, a test strategy, and open risks.
4. Save the plan to the ticket by running: \`.esedre/ese plan ${ticketKey} --file "${planDraftPath}"\`
5. If the specification is too ambiguous to plan, run \`.esedre/ese comment ${ticketKey} "<questions>"\` instead and stop.
`;
}

export function buildAgentPrompt(
  ticketId: number | string,
  taskFilePath: string,
  mode: WorkerMode = 'implement'
): string {
  if (mode === 'plan') {
    return `"Write the implementation plan for ticket #${ticketId} as specified in ${taskFilePath}. Do not modify source files."`;
  }
  return `"Implement ticket #${ticketId} as specified in ${taskFilePath}"`;
}

export function interpolateAgentCommand(
  cmdTemplate: string,
  ticketId: number | string,
  ticketKey: string,
  taskFilePath: string,
  mode: WorkerMode = 'implement'
): string {
  const trimmed = cmdTemplate.trim();

  // If using agy or claude as shorthand binary without flags or templates
  if (trimmed === 'agy' || trimmed.startsWith('agy ')) {
    if (!trimmed.includes('-p') && !trimmed.includes('{{')) {
      return `agy -p ${buildAgentPrompt(ticketId, taskFilePath, mode)} --dangerously-skip-permissions`;
    }
  }

  if (trimmed === 'claude' || trimmed.startsWith('claude ')) {
    if (!trimmed.includes('-p') && !trimmed.includes('{{')) {
      return `claude -p ${buildAgentPrompt(ticketId, taskFilePath, mode)} --dangerously-skip-permissions`;
    }
  }

  let result = cmdTemplate;
  // {{prompt}} expands to a correctly quoted instruction, so configs need no inner shell quoting
  result = result.replaceAll('{{prompt}}', buildAgentPrompt(ticketId, taskFilePath, mode));
  result = result.replaceAll('{{ticketId}}', String(ticketId));
  result = result.replaceAll('{{ticketKey}}', ticketKey);
  result = result.replaceAll('{{taskFile}}', taskFilePath);
  result = result.replaceAll('{{taskPath}}', taskFilePath);

  // If the command template did not have placeholders and was not already referencing taskFilePath, append taskFilePath as argument
  if (!cmdTemplate.includes('{{') && !cmdTemplate.includes(taskFilePath)) {
    result = `${result} "${taskFilePath}"`;
  }

  return result;
}

export interface WorkerRunnerOptions {
  workerId: string;
  role?: WorkerRole;
  project?: string;
  ticketId?: number | string;
  engine?: 'antigravity' | 'claude' | 'shell' | 'headless';
  agentCommand?: string;
  pollIntervalMs?: number;
  ttlMinutes?: number;
  useWorktree?: boolean;
  execCommand?: string;
  completeOnSuccess?: boolean;
  once?: boolean;
  dryRun?: boolean;
  isJson?: boolean;
  workspaceRoot?: string;
  maxWorkers?: number;
  /** 'implement' (default) runs the agent against the ticket; 'plan' has an anchor write the implementation plan only. */
  mode?: WorkerMode;
  /** Permit agent-driven implementation of a ticket that has no implementation plan. */
  allowNoPlan?: boolean;
  /** File descriptor receiving the agent child's stdout/stderr (detached workers log here instead of inheriting). */
  childStdioFd?: number;
}

export interface WorkerCycleResult {
  ticketId?: number | string;
  ticketKey?: string;
  action:
    | 'claimed_and_completed'
    | 'claimed_and_executed'
    | 'claimed_and_escalated'
    | 'claimed_and_held'
    | 'claimed_and_planned'
    | 'blocked_no_plan'
    | 'idle';
  error?: string;
}

export class HeadlessWorkerRunner {
  private workerId: string;
  private role: WorkerRole;
  private project?: string;
  private engine: 'antigravity' | 'claude' | 'shell' | 'headless';
  private agentCommand?: string;
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
  private activeRestoreStatus: 'Planned' | 'In Development' = 'Planned';
  private targetTicketId?: number | string;
  private completeOnSuccess: boolean;
  private maxWorkers?: number;
  private mode: WorkerMode;
  private allowNoPlan: boolean;
  private childStdioFd?: number;

  constructor(storage: TicketRepository, options: WorkerRunnerOptions) {
    this.storage = storage;
    this.workerId = options.workerId || 'thug-1';
    this.role = options.role || 'thug';
    this.mode = options.mode || 'implement';
    this.allowNoPlan = Boolean(options.allowNoPlan);
    this.childStdioFd = options.childStdioFd;
    if (this.mode === 'plan') {
      if (this.role !== 'anchor') {
        throw new Error(`Plan mode requires the 'anchor' role (got '${this.role}'). Planning is a senior task.`);
      }
      if (options.ticketId === undefined) {
        throw new Error(`Plan mode requires a target ticket (--ticket <id>).`);
      }
    }
    this.project = options.project;
    this.targetTicketId = options.ticketId;
    this.engine = options.engine || readGlobalConfig()?.engine || 'antigravity';
    this.agentCommand = options.agentCommand || process.env.ESEDRE_AGENT_CMD || readGlobalConfig()?.agentCommand;
    this.pollIntervalMs = options.pollIntervalMs || 10000;
    this.ttlMinutes = options.ttlMinutes || 15;
    this.useWorktree = this.mode === 'plan'
      ? false
      : (options.useWorktree !== undefined ? options.useWorktree : this.role === 'thug');
    this.execCommand = options.execCommand;
    this.completeOnSuccess = Boolean(options.completeOnSuccess);
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
            finalStatus: this.activeRestoreStatus,
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
        let cycle: WorkerCycleResult;
        try {
          cycle = await this.runSingleCycle();
        } catch (err: any) {
          this.logError(`Worker cycle crashed: ${err?.stack || err?.message || err}`);
          await this.escalateActiveTicket(`Worker ${this.workerId} crashed: ${err?.message || err}`);
          throw err;
        }
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

  /** Releases the in-flight ticket back to its restore status with an escalation note. Never throws. */
  private async escalateActiveTicket(reason: string): Promise<void> {
    this.stopHeartbeat();
    if (this.activeTicketId === undefined) return;
    try {
      await this.storage.releaseTicket(this.activeTicketId, {
        system: this.system,
        workerId: this.workerId,
        finalStatus: this.activeRestoreStatus,
        notes: `[Escalation] ${reason}`,
        force: true,
      });
    } catch {
      // best effort
    }
    this.activeTicketId = undefined;
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
    const isPlanMode = this.mode === 'plan';
    // Status the ticket returns to when the worker releases it without finishing.
    const restoreStatus: 'Planned' | 'In Development' =
      isPlanMode && candidate.meta.status === 'In Development' ? 'In Development' : 'Planned';
    this.activeRestoreStatus = restoreStatus;

    // Read the current plan up front: the no-plan guard must run before any lease is taken.
    let planBefore: string | null = null;
    try {
      planBefore = await this.storage.getPlan(ticketId);
    } catch {
      // Plan is optional
    }

    if (!isPlanMode && !this.execCommand && !this.allowNoPlan && isPlanEmpty(planBefore)) {
      const blockedMsg = `Ticket ${ticketKey} has no implementation plan. Run it in plan mode first (ese crew dispatch ${ticketKey} --mode plan --role anchor), or pass --allow-no-plan to implement from the specification alone.`;
      this.logWarn(blockedMsg);
      this.activeTicketId = undefined;
      return { ticketId, ticketKey, action: 'blocked_no_plan', error: blockedMsg };
    }

    this.logInfo(`Claiming Ticket #${ticketId} ("${candidate.meta.title}")${isPlanMode ? ' for planning' : ''}`);

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

    // 3. Resolve working directory and task specification (.esedre/TASK.md, or PLAN_TASK.md in plan mode)
    const workingDir = this.worktreePath || this.workspaceRoot;
    const esedreDir = path.join(workingDir, '.esedre');
    if (!fs.existsSync(esedreDir)) {
      fs.mkdirSync(esedreDir, { recursive: true });
    }
    let taskFilePath: string;
    if (isPlanMode) {
      taskFilePath = path.join(esedreDir, 'PLAN_TASK.md');
      const planDraftPath = path.join(esedreDir, `plan-draft-${ticketId}.md`);
      fs.writeFileSync(
        taskFilePath,
        generatePlanTaskPrompt(candidate, ticketKey, planBefore, planDraftPath, this.workerId),
        'utf-8'
      );
    } else {
      taskFilePath = path.join(esedreDir, 'TASK.md');
      fs.writeFileSync(taskFilePath, generateTaskPrompt(candidate, planBefore || '', this.workerId), 'utf-8');
    }
    this.logDebug(`Generated task specification at ${taskFilePath}`);

    // 4. Resolve command to execute
    let commandToRun = this.execCommand;
    if (!commandToRun) {
      const resolvedAgentCmd = this.resolveAgentCommand(ticketId, ticketKey, taskFilePath);
      if (!resolvedAgentCmd) {
        this.stopHeartbeat();
        const missingMsg = `No autonomous agent CLI ('agy' or 'claude') detected in PATH, and no agentCommand configured.`;
        this.logWarn(missingMsg);
        this.logInfo(`To enable autonomous background workers:`);
        this.logInfo(`  1. Configure an agent command: ese configure set agentCommand "<command>"`);
        this.logInfo(`  2. Or pass an agent command directly: ese crew worker --agent-cmd "<command>"`);
        this.logInfo(`  3. Or pass a task command directly: ese crew worker --exec "<command>"`);
        this.logInfo(`Releasing lease on Ticket #${ticketId} (status reverted to ${restoreStatus}).`);

        await this.storage.releaseTicket(ticketId, {
          system: this.system,
          workerId: this.workerId,
          finalStatus: restoreStatus,
          notes: `[Escalation] ${missingMsg} Worker ${this.workerId} released lease.`,
          force: true,
        });

        this.activeTicketId = undefined;
        return { ticketId, ticketKey, action: 'claimed_and_escalated', error: missingMsg };
      }
      commandToRun = resolvedAgentCmd;
    }

    // 5. Execute task command asynchronously with active heartbeat
    this.logInfo(`Executing worker task: "${commandToRun}" in ${workingDir}`);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(commandToRun, {
          cwd: workingDir,
          stdio: this.childStdioFd !== undefined ? ['ignore', this.childStdioFd, this.childStdioFd] : 'inherit',
          shell: true,
          windowsHide: true,
          env: {
            ...process.env,
            ESEDRE_WORKER_ID: this.workerId,
            ESEDRE_WORKER_ROLE: this.role,
            ESEDRE_TICKET_ID: String(ticketId),
            ESEDRE_TICKET_KEY: ticketKey,
            ESEDRE_TASK_FILE: taskFilePath,
          },
        });

        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Worker process exited with code ${code}`));
          }
        });
      });

      // Plan mode: the deliverable is a saved plan, not code. Verify one was written, then release.
      if (isPlanMode) {
        let planAfter: string | null = null;
        try {
          planAfter = await this.storage.getPlan(ticketId);
        } catch {
          // treated as no plan saved below
        }
        if (isPlanEmpty(planAfter) || planAfter === planBefore) {
          throw new Error(
            `Planning agent exited successfully but no new plan was saved for ${ticketKey}. Expected the agent to run: .esedre/ese plan ${ticketKey} --file <draft>`
          );
        }
        this.stopHeartbeat();
        await this.storage.releaseTicket(ticketId, {
          system: this.system,
          workerId: this.workerId,
          finalStatus: restoreStatus,
          notes: `[Plan] Implementation plan saved by ${this.workerId} (${this.role}). Ticket status unchanged (${restoreStatus}).`,
        });
        this.logInfo(`Plan saved for Ticket #${ticketId}; lease released (status ${restoreStatus}).`);
        this.activeTicketId = undefined;
        return { ticketId, ticketKey, action: 'claimed_and_planned' };
      }

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

      // Release as completed or in development based on completeOnSuccess
      this.stopHeartbeat();
      if (this.completeOnSuccess) {
        await this.storage.releaseTicket(ticketId, {
          system: this.system,
          workerId: this.workerId,
          finalStatus: 'Completed',
          notes: `Automated worker execution completed successfully by ${this.workerId}.`,
        });

        this.logInfo(`Ticket #${ticketId} completed and lease released.`);
        this.activeTicketId = undefined;
        return { ticketId, ticketKey, action: 'claimed_and_completed' };
      } else {
        await this.storage.releaseTicket(ticketId, {
          system: this.system,
          workerId: this.workerId,
          finalStatus: 'In Development',
          notes: `Automated worker execution succeeded: ${commandToRun}. Ticket remains In Development.`,
        });

        this.logInfo(`Ticket #${ticketId} execution succeeded (In Development) and lease released.`);
        this.activeTicketId = undefined;
        return { ticketId, ticketKey, action: 'claimed_and_executed' };
      }
    } catch (err: any) {
      this.stopHeartbeat();
      const errorSummary = err.message || 'Execution error';
      this.logError(`Execution failed for Ticket #${ticketId}: ${errorSummary}`);

      // Escalation: release lease and return the ticket to its restore status
      await this.storage.releaseTicket(ticketId, {
        system: this.system,
        workerId: this.workerId,
        finalStatus: restoreStatus,
        notes: `[Escalation] Automated worker ${isPlanMode ? 'planning' : 'execution'} failed: ${errorSummary}`,
        force: true,
      });

      this.activeTicketId = undefined;
      return { ticketId, ticketKey, action: 'claimed_and_escalated', error: errorSummary };
    }
  }

  private async findNextClaimableTicket(): Promise<EsedreTicket | null> {
    const now = Date.now();

    // 0. If a specific ticket ID is targeted, bind directly to it
    if (this.targetTicketId !== undefined) {
      try {
        const lookup = (typeof this.targetTicketId === 'string' && this.targetTicketId.includes('-')) || !this.project
          ? this.targetTicketId
          : `${this.project}-${this.targetTicketId}`;
        const ticket = await this.storage.getTicket(lookup);
        if (!ticket) return null;
        if (ticket.meta.status === 'Completed' || ticket.meta.status === 'Rejected') {
          return null;
        }
        if (ticket.meta.lease && new Date(ticket.meta.lease.expiresAt).getTime() > now) {
          const isMine =
            ticket.meta.lease.system.toLowerCase() === this.system.toLowerCase() &&
            ticket.meta.lease.workerId.toLowerCase() === this.workerId.toLowerCase();
          if (!isMine) {
            return null;
          }
        }
        return ticket;
      } catch {
        return null;
      }
    }

    const filter = this.project && this.project.toLowerCase() !== 'all' ? { project: this.project } : undefined;
    const tickets = await this.storage.listTickets(filter);

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
    for (const t of tickets) {
      if (t.meta.status === 'Completed' || t.meta.status === 'Rejected') continue;
      const assignee = (t.meta.assignee || '').toLowerCase();
      const match =
        assignee === this.workerId.toLowerCase() ||
        assignee === `${this.system}:${this.workerId}`.toLowerCase();
      if (!match) continue;

      // Ensure no other active lease
      if (t.meta.lease && new Date(t.meta.lease.expiresAt).getTime() > now) {
        continue;
      }
      if (!(await this.isScanEligible(t))) continue;
      return t;
    }

    // 3. Third priority: Unleased and unassigned planned tickets in project
    for (const t of tickets) {
      if (t.meta.status !== 'Planned') continue;
      if (t.isBlocked) continue;
      if (t.meta.assignee && t.meta.assignee.trim()) {
        const assignee = t.meta.assignee.toLowerCase();
        const isMine =
          assignee === this.workerId.toLowerCase() ||
          assignee === `${this.system}:${this.workerId}`.toLowerCase();
        if (!isMine) continue;
      }
      if (t.meta.lease && new Date(t.meta.lease.expiresAt).getTime() > now) {
        continue;
      }
      if (!(await this.isScanEligible(t))) continue;
      return t;
    }

    return null;
  }

  /** Agent-driven implementation scans skip tickets without a plan unless --allow-no-plan is set. */
  private async isScanEligible(ticket: EsedreTicket): Promise<boolean> {
    if (this.mode === 'plan' || this.execCommand || this.allowNoPlan) return true;
    try {
      return !isPlanEmpty(await this.storage.getPlan(ticket.meta.id));
    } catch {
      return false;
    }
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

  private resolveAgentCommand(ticketId: number | string, ticketKey: string, taskFilePath: string): string | null {
    const prompt = buildAgentPrompt(ticketId, taskFilePath, this.mode);

    // 1. Explicit agentCommand option, project/global setting, or env var
    if (this.agentCommand) {
      let command = interpolateAgentCommand(this.agentCommand, ticketId, ticketKey, taskFilePath, this.mode);
      // If the command starts with a known agent CLI that is not on PATH, use its resolved install location
      const leading = command.trim().split(/\s+/)[0];
      if ((leading === 'agy' || leading === 'claude') && !isBinaryAvailable(leading)) {
        const resolved = resolveAgentBinary(leading);
        if (resolved) {
          command = command.trim().replace(leading, resolved);
        }
      }
      return command;
    }

    // 2. Engine-specific binary resolution
    if (this.engine === 'antigravity') {
      const bin = resolveAgentBinary('agy');
      if (bin) {
        return `${bin} -p ${prompt} --dangerously-skip-permissions`;
      }
    }

    if (this.engine === 'claude') {
      const bin = resolveAgentBinary('claude');
      if (bin) {
        return `${bin} -p ${prompt} --dangerously-skip-permissions`;
      }
    }

    // 3. Fallback auto-detection across known agent CLIs
    const agyBin = resolveAgentBinary('agy');
    if (agyBin) {
      return `${agyBin} -p ${prompt} --dangerously-skip-permissions`;
    }

    const claudeBin = resolveAgentBinary('claude');
    if (claudeBin) {
      return `${claudeBin} -p ${prompt} --dangerously-skip-permissions`;
    }

    return null;
  }

  private logWarn(msg: string): void {
    if (this.isJson) return;
    console.warn(`${colors.yellow}[Worker:${this.workerId}] Warning:${colors.reset} ${msg}`);
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
