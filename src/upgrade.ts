import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureGlobalEsedreStore } from './server/daemon.js';
import {
  EsedreConfig,
  migrateEsedreConfig,
  appendSnapshotToGitIgnore,
  DEFAULT_ESEDRE_PORT,
  resolvePorts,
  readGlobalConfig,
  findEsedreConfig,
  expandHome,
} from './config.js';
import { generateProjectSnapshot } from './snapshot.js';
import { FilesystemStorageAdapter } from './storage/filesystem.js';
import { SecurityFilter } from './securityFilter.js';

import { CURRENT_ESEDRE_VERSION } from './types.js';
export { CURRENT_ESEDRE_VERSION };
export function computeNormalizedHash(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha1').update(normalized, 'utf-8').digest('hex');
}

export type ContentStatus = 'LATEST' | 'HISTORIC_DEFAULT' | 'CUSTOMIZED' | 'MISSING';

export function classifyContent(
  currentContent: string | null | undefined,
  latestTemplate: string,
  historicHashes: string[]
): ContentStatus {
  if (!currentContent || currentContent.trim().length === 0) {
    return 'MISSING';
  }
  const currentHash = computeNormalizedHash(currentContent);
  const latestHash = computeNormalizedHash(latestTemplate);

  if (currentHash === latestHash) {
    return 'LATEST';
  }
  if (historicHashes.includes(currentHash)) {
    return 'HISTORIC_DEFAULT';
  }
  return 'CUSTOMIZED';
}

export const WRAPPER_CMD = `@echo off
REM Esedre Autonomous Ticketing & Project Planning Engine Wrapper (Windows CMD)
call :run %*
exit /b %ERRORLEVEL%

:run
if exist "%~dp0..\\dist\\esedre.mjs" (
  node "%~dp0..\\dist\\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\\..\\esedre\\dist\\esedre.mjs" (
  node "%~dp0..\\..\\esedre\\dist\\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\\esedre\\dist\\esedre.mjs" (
  node "%~dp0..\\esedre\\dist\\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\\node_modules\\esedre\\dist\\esedre.mjs" (
  node "%~dp0..\\node_modules\\esedre\\dist\\esedre.mjs" %*
  goto :eof
)
if exist "%~dp0..\\node_modules\\.bin\\ese.cmd" (
  call "%~dp0..\\node_modules\\.bin\\ese.cmd" %*
  goto :eof
)
if exist "%~dp0..\\node_modules\\.bin\\esedre.cmd" (
  call "%~dp0..\\node_modules\\.bin\\esedre.cmd" %*
  goto :eof
)

where ese >nul 2>nul
if %ERRORLEVEL% equ 0 (
  call ese %*
  goto :eof
)

where esedre >nul 2>nul
if %ERRORLEVEL% equ 0 (
  call esedre %*
  goto :eof
)

call npx --yes esedre %*
goto :eof
`;

export const WRAPPER_PS1 = `# Esedre Autonomous Ticketing & Project Planning Engine Wrapper (PowerShell)
$ErrorActionPreference = "Stop"

# Ensure UTF-8 console output and pipeline encoding on Windows
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$inRepoEsedre = Join-Path $scriptDir "..\\dist\\esedre.mjs"
if (Test-Path $inRepoEsedre) {
    & node $inRepoEsedre @args
    exit $LASTEXITCODE
}
$siblingEsedre = Join-Path $scriptDir "..\\..\\esedre\\dist\\esedre.mjs"
if (Test-Path $siblingEsedre) {
    & node $siblingEsedre @args
    exit $LASTEXITCODE
}
$distEsedre = Join-Path $scriptDir "..\\esedre\\dist\\esedre.mjs"
if (Test-Path $distEsedre) {
    & node $distEsedre @args
    exit $LASTEXITCODE
}
$nodeModulesEsedre = Join-Path $scriptDir "..\\node_modules\\esedre\\dist\\esedre.mjs"
if (Test-Path $nodeModulesEsedre) {
    & node $nodeModulesEsedre @args
    exit $LASTEXITCODE
}
$localBin = Join-Path $scriptDir "..\\node_modules\\.bin\\ese.cmd"
if (Test-Path $localBin) {
    & $localBin @args
    exit $LASTEXITCODE
}
$localEsedreBin = Join-Path $scriptDir "..\\node_modules\\.bin\\esedre.cmd"
if (Test-Path $localEsedreBin) {
    & $localEsedreBin @args
    exit $LASTEXITCODE
}
if (Get-Command "ese" -ErrorAction SilentlyContinue) {
    & ese @args
    exit $LASTEXITCODE
}
if (Get-Command "esedre" -ErrorAction SilentlyContinue) {
    & esedre @args
    exit $LASTEXITCODE
}
& npx --yes esedre @args
exit $LASTEXITCODE
`;

export const WRAPPER_BASH = `#!/usr/bin/env bash
# Esedre Autonomous Ticketing & Project Planning Engine Wrapper (POSIX)
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

if [ -f "$DIR/../dist/esedre.mjs" ]; then
  exec node "$DIR/../dist/esedre.mjs" "$@"
fi
if [ -f "$DIR/../../esedre/dist/esedre.mjs" ]; then
  exec node "$DIR/../../esedre/dist/esedre.mjs" "$@"
fi
if [ -f "$DIR/../esedre/dist/esedre.mjs" ]; then
  exec node "$DIR/../esedre/dist/esedre.mjs" "$@"
fi
if [ -f "$DIR/../node_modules/esedre/dist/esedre.mjs" ]; then
  exec node "$DIR/../node_modules/esedre/dist/esedre.mjs" "$@"
fi
if [ -f "$DIR/../node_modules/.bin/ese" ]; then
  exec "$DIR/../node_modules/.bin/ese" "$@"
fi
if [ -f "$DIR/../node_modules/.bin/esedre" ]; then
  exec "$DIR/../node_modules/.bin/esedre" "$@"
fi
if command -v ese >/dev/null 2>&1; then
  exec ese "$@"
fi
if command -v esedre >/dev/null 2>&1; then
  exec esedre "$@"
fi
exec npx --yes esedre "$@"
`;

export const ESE_WRAPPER_CMD = `@echo off
REM Ese CLI short alias wrapper for Esedre (Windows CMD)
call "%~dp0esedre.cmd" %*
exit /b %ERRORLEVEL%
`;

export const ESE_WRAPPER_PS1 = `# Ese CLI short alias wrapper for Esedre (PowerShell)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "esedre.ps1") @args
exit $LASTEXITCODE
`;

export const ESE_WRAPPER_BASH = `#!/usr/bin/env bash
# Ese CLI short alias wrapper for Esedre (POSIX)
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
exec "$DIR/esedre" "$@"
`;

export const HISTORIC_SKILL_HASHES: string[] = [
  '8611116c276fdfb598b965c716b251ce7c77c7f7',
  '05f129fb6e06a18df00215af105567abcbf0bc67',
  '5d330ecf8fc96f383946e0351adb60378afa70f0',
  '23716c9db561e52e5115dc364fe154d3a7bc1e23',
  '75d50d5f9cf9348cca9d9b2466e04cf7992ef17e',
  'e5d4fe4f2ae0bd464bad877ea1e5ab63cef747fa',
  '1a33bdba76ad74dd83bb6fcf1e52c58578f312c4',
  'a5fc85d1635a1d13beb84bb55af04f037337600e',
  'ca5c42f69115d019c2c81624756fa4733a99dbbf',
];

export const ESEDRE_SKILL_TEMPLATE = `---
name: esedre
description: Tooling and workflow reference for interacting with the Esedre developer ticketing and roadmap system. Use this skill whenever inspecting planned work, viewing ticket specs, updating implementation plans, or posting developer notes.
---

# Esedre Planning & Roadmap Workflow

Esedre is the developer ticketing and LLM coding partner coordination platform. The engine codebase resides in the standalone repository \`aellinsar/esedre\` (\`../esedre\`), and operates on decoupled ticket repositories (such as \`aellinsar/esedre-data\` configured in \`~/.esedre/config.json\` or \`.esedre/esedre.json\`). Interact with tickets via in-repo shell wrappers in \`.esedre/\` (\`.esedre/ese\`), or the global \`ese\` CLI.

## 0. Authoritative Ingress Hierarchy & Zero-Latency Context (\`.esedre/snapshot.json\`)

All ticket discovery, inspection, and state management strictly follow this positive ingress hierarchy:

1. **Step 1 (Default for Read-Only Inspection) - Local Snapshot Projection**:
   Always read \`.esedre/snapshot.json\` in the workspace root first. It provides an immediate, zero-latency local projection containing all active and completed tickets, summaries, implementation plans, revision numbers, completion dates (\`completedAt\`), and staleness metrics (\`daysSinceUpdate\`).
2. **Step 2 (Dynamic Queries & State Mutations) - Esedre MCP Tools**:
   Use first-class MCP tools when active in the session (\`esedre_list_tickets\`, \`esedre_get_ticket\`, \`esedre_get_plan\`, \`esedre_save_plan\`, \`esedre_update_ticket\`, \`esedre_claim_ticket\`, \`esedre_renew_lease\`, \`esedre_release_ticket\`, \`esedre_add_comment\`).
3. **Step 3 (Terminal & Script Fallback) - In-Repo CLI Wrapper**:
   Use \`.esedre/ese\` (\`.esedre/ese get\`, \`.esedre/ese plan\`, \`.esedre/ese update\`, \`.esedre/ese lease claim\`, \`.esedre/ese lease release\`, \`.esedre/ese crew\`, \`.esedre/ese snapshot\`).
4. **Storage Boundary**:
   Backing ticket hubs (such as \`esedre-data\`) represent data storage managed by the engine. All agent interactions with roadmap tickets flow through the snapshot projection, MCP tools, or CLI wrappers.

## 1. Model Context Protocol (MCP) Tools

When Esedre MCP is active in your agent session (\`.agents/mcp_config.json\`), use these tools directly:

| Tool | Purpose | Key Arguments |
|---|---|---|
| \`esedre_list_tickets\` | List roadmap tickets with filters | \`project\` (e.g. \`Profe\`, \`Esedre\`, \`Alce\`), \`status\`, \`type\`, \`priority\`, \`milestone\`, \`isBlocked\`, \`linkedTo\`, \`search\`, \`includePlan\` |
| \`esedre_get_ticket\` | Full specification, summary, comments, links, revision & sha1 | \`ticketId\` (numeric e.g. \`96\` or compound e.g. \`Profe-96\`) |
| \`esedre_get_plan\` | Active implementation plan markdown | \`ticketId\` (numeric or compound) |
| \`esedre_save_plan\` | Save implementation plan markdown with OCC | \`ticketId\`, \`planMarkdown\`, \`lastHash\` |
| \`esedre_create_ticket\` | Mint a new ticket with auto sequential ID | \`title\` (max 48 chars), \`type\`, \`project\`, \`priority\`, \`milestone\`, \`effort\`, \`summary\`, \`detail\` |
| \`esedre_update_ticket\` | Update ticket attributes with OCC | \`ticketId\`, \`status\`, \`type\`, \`priority\`, \`milestone\`, \`title\`, \`detail\`, \`detailMarkdown\`, \`complexity\`, \`effort\`, \`inDevelopment\`, \`featureFlag\`, \`lastHash\` |
| \`esedre_claim_ticket\` | Acquire rolling exclusive lease on a ticket | \`ticketId\`, \`workerId\`, \`role\` (\`lead\` \\| \`anchor\` \\| \`thug\`), \`ttlMinutes\`, \`worktree\`, \`engine\` |
| \`esedre_renew_lease\` | Extend active lease heartbeat before expiry | \`ticketId\`, \`workerId\`, \`additionalMinutes\` |
| \`esedre_release_ticket\` | Relinquish ticket lease upon completion or escalation | \`ticketId\`, \`workerId\`, \`finalStatus\` (\`Completed\` \\| \`Planned\`), \`notes\`, \`force\` |
| \`esedre_list_leases\` | List active or unexpired ticket leases across projects | \`project\`, \`includeExpired\` |
| \`esedre_get_crew_status\` | Fleet diagnostics, active leases, role breakdown & pool | \`project\` |
| \`esedre_link_ticket\` | Establish bi-directional ticket relationship | \`sourceTicketId\`, \`relation\` (\`relates-to\` \\| \`blocks\` \\| \`parent-of\` \\| \`duplicates\`), \`targetTicketId\`, \`author\` |
| \`esedre_unlink_ticket\` | Remove bi-directional ticket relationship | \`sourceTicketId\`, \`targetTicketId\`, \`relation\` |
| \`esedre_list_milestones\` | List project milestones and deliverables progress | \`project\` |
| \`esedre_get_milestone\` | Get milestone specs, umbrella flag, and member tickets | \`milestoneId\` (numeric or title), \`project\` |
| \`esedre_create_milestone\` | Create a project milestone with optional umbrella flag | \`title\`, \`project\`, \`featureFlag\`, \`status\`, \`targetDate\`, \`description\` |
| \`esedre_update_milestone\` | Update milestone status, umbrella flag, or title | \`milestoneId\`, \`project\`, \`title\`, \`featureFlag\`, \`status\`, \`targetDate\`, \`description\` |
| \`esedre_add_comment\` | Append developer or agent comment | \`ticketId\`, \`text\`, \`file\`, \`author\` |

## 2. Headless Crew Fleet, Ticket Leases & Autonomous Coordination

Esedre provides mutual exclusion locks (leases) and headless worker runners for coordinating autonomous agents, subagents, and human developers:

### When to Use Ticket Leases:
1. **Start of Ticket Work**: Whenever an agent begins implementing a ticket, claim an exclusive lease via MCP (\`esedre_claim_ticket\`) or CLI (\`ese lease claim <ticketId>\`). This prevents clobbering, declares active ownership to other agents, and updates the local snapshot and UI in real time.
2. **Multi-Agent & Subagent Sessions**: When delegating subtasks or fanning out parallel work, each subagent claims its ticket under its assigned worker identity (\`workerId: "thug-1"\`, etc.).
3. **Long-Running Operations (Background Tests, Builds, Refactors)**: Acquire a lease with a specified TTL (default 15 minutes), and maintain a rolling heartbeat via \`esedre_renew_lease\` or \`ese lease renew <ticketId>\`.
4. **Task Completion**: Upon verifying implementation and running tests, release the lease via \`esedre_release_ticket\` or \`ese lease release <ticketId> --status Completed --notes "Verified implementation"\`.
5. **Escalations & Blockers**: If an automated worker or subagent encounters a blocker, missing dependency, or unexpected failure, escalate immediately via \`ese crew escalate <ticketId> --reason "..."\` or release with \`finalStatus: 'Planned'\` and detailed notes.

### Worker Roles:
- **\`lead\`**: Architectural planner, orchestrator, or human developer. Full authority: can plan, claim, release, delegate tasks, and force-reclaim leases.
- **\`anchor\`**: Senior pair or primary persistent agent. Can claim, release, delegate, or run test suites.
- **\`thug\`**: Headless worker runner for executing bounded tasks, tests, or subroutines. Thugs execute tasks, auto-commit in worktrees, and release or escalate. Thugs cannot delegate to other workers.

### Git Worktree Isolation:
- Headless workers (\`ese crew worker\`) execute inside isolated git worktrees (\`.worktrees/<workerId>\`) on dedicated branches (\`thug/<workerId>\`), preventing \`.git/index.lock\` collisions and file clobbering in the active IDE.

### Worker Pool Limits:
- Controlled globally via \`maxWorkers\` in \`~/.esedre/config.json\` (configured via \`ese configure set maxWorkers <n>\`).
- Workers check active unexpired leases on the local host machine; if active worker leases meet or exceed \`maxWorkers\`, additional workers idle and wait until capacity frees up.

### Operating as the Crew Lead (Conversational & Orchestration Guide):
In an interactive development session with the user, **you operate as the Crew Lead**:
1. **The Lead is the Human's Interface**: The user talks directly to you. You are the project architect, pair programmer, and fleet coordinator. Headless workers (thugs) operate under your direction.
2. **Transparent Delegation**: Whenever you offload tasks to background workers, inform the user clearly:
   - Identify the ticket number and title being worked on.
   - State the worker ID (e.g. \`thug-1\`) and explain that execution is sandboxed in a dedicated git worktree (\`.worktrees/thug-1\`).
   - Mention the command being run (e.g. \`npm test\`, test suite verification, build).
3. **Status Reporting & Health Checks**:
   - Check fleet health and active leases via \`esedre_get_crew_status\`, \`esedre_list_leases\`, \`.esedre/ese lease list\`, or \`.esedre/ese crew leases\`.
   - Provide concise, plain-language updates on what workers are actively running, what has completed, and remaining lease TTLs.
4. **Handling Escalations with Clarity**:
   - When a worker encounters an error or blocker, it releases its lease back to \`Planned\` and records an escalation comment.
   - The Lead triages the escalation notes, explains the root cause plainly to the user, and proposes an architectural solution or next action. Never hide worker failures.
5. **Reviewing and Merging Worker Output**:
   - When a worker successfully completes a task in its worktree, it commits to \`thug/<workerId>\`.
   - As Lead, inspect the changes (\`git diff HEAD..thug/<workerId>\`), verify correctness, merge into the active branch (\`git merge thug/<workerId>\`), and report the verified outcome to the user.
6. **Pool Concurrency Discipline**:
   - Respect the configured \`maxWorkers\` limit (e.g. 3 on this machine). Never launch more concurrent workers than the local pool permits.
7. **Lead Direct Mode vs. Autonomous Fleet Dispatch Mode**:
   - **Interactive Lead Direct Mode (Default for chat sessions)**: When the user asks you (the Lead agent in the active chat session) to implement a feature or tackle a ticket:
     1. Claim the ticket lease: \`.esedre/ese lease claim <id>\`
     2. Write the code, update plans, and run test suites directly in this workspace.
     3. Mark completed and release lease: \`.esedre/ese lease release <id> --status Completed --notes "..."\`
     Do NOT delegate to an external headless worker unless the user explicitly requests background dispatch or fleet execution.
   - **Autonomous Fleet Dispatch Mode (Headless Background Workers)**:
     When running \`ese crew dispatch <id> --bg\` or \`ese crew worker\`:
     - The worker compiles \`.worktrees/<workerId>/.esedre/TASK.md\` with full ticket specification and plan.
     - An agent CLI (\`agy\` for Antigravity, \`claude\` for Claude Code) or configured \`agentCommand\` is a pre-requisite for automated code writing in worktrees.
     - If no agent CLI or \`agentCommand\` is found, the worker fails fast, explains how to configure one, and reverts the ticket to \`Planned\`.
     - Alternatively, pass \`--exec "<cmd>"\` for headless test/build execution.
     - **No-plan guard**: agent-driven implementation refuses a ticket that has no implementation plan (\`blocked_no_plan\`, no lease taken). Plan it first with plan mode below, or pass \`--allow-no-plan\` to implement from the specification alone. Raw \`--exec\` commands are exempt.
    - **Plan Mode (Anchor-Directed Planning)**: Only when the user explicitly asks for a ticket to be planned by a worker, run \`.esedre/ese crew dispatch <id> --mode plan --bg\`. It defaults to worker \`anchor-1\` with role \`anchor\` (a thug is rejected). The anchor reads the specification and the repo, then saves the plan with \`.esedre/ese plan <id> --file <draft>\`. There is no worktree and no code change, and the ticket keeps its status. If the agent exits without saving a new plan, the worker escalates with a comment. Follow Fast-Yield after dispatching, then review the plan with \`.esedre/ese plan <id>\` when the user asks.
    - **Background Logs & Liveness (\`--bg\`)**: Every detached worker writes all output (including the agent's stdout and stderr) to \`~/.esedre/logs/worker-<workerId>-<ticketKey>.log\`, and dispatch prints that path. Dispatch waits a short liveness window (3s, \`ESEDRE_BG_LIVENESS_MS\`). A worker that exits non-zero, dies without an exit marker, or escalates the ticket makes dispatch exit 1, release the lease, set the ticket back to \`Planned\`, and post an \`[Escalation]\` comment with the log path and the last output. \`.esedre/ese lease list\` flags a lease whose worker PID is gone as \`STALE\`; release it with \`.esedre/ese lease release <ticketKey> --force\`. On Windows the worker is launched through WMI so it survives the dispatching shell or tool ending. Only report a dispatch as started when the success output was printed.

### Fast-Yield Delegation Pattern (Responsive Terminal Protocol):
In paired programming with a human developer, **the terminal belongs to the developer**. Avoid monopolizing conversation turns with long sequences of synchronous tool calls:
1. **Delegation is an Immediate Yield Point**: Whenever delegating or dispatching a task to a background worker (via \`ese crew dispatch <id> --bg\` or background runner), the Lead agent MUST stop calling tools immediately and yield terminal control to the human developer.
2. **Transparent Handoff Notice**: Provide a clear 2-3 line summary before yielding:
   - Announce the ticket ID, title, and assigned worker (e.g. \`thug-1\`).
   - Confirm execution is sandboxed in a dedicated git worktree (\`.worktrees/<workerId>\`).
   - Mention the command running in the background and that terminal control is returned to the user.
3. **User Unblocking is Priority #1**: Long-running builds, test suites, and subroutines belong in background worktree processes so the developer and Lead remain in responsive dialogue.
4. **No Synchronous Polling**: Never run synchronous polling or sleep loops waiting for workers. Check worker status when prompted by the user or upon receiving background task notifications.

### Launching, Checking & Managing Headless Workers (Runbook):

#### 1. One-Shot Ticket Dispatch with Fast-Yield (Recommended):
Atomically delegate a ticket and spawn a detached background worker that yields immediately:
\`\`\`bash
# Autonomous AI agent worker (uses configured agentCommand or auto-detects agy/claude):
.esedre/ese crew dispatch <ticketId> --worker thug-1 --bg

# Custom agent command:
.esedre/ese crew dispatch <ticketId> --worker thug-1 --agent-cmd "agy -p {{prompt}}" --bg

# Shell command runner (e.g. test or build verification):
.esedre/ese crew dispatch <ticketId> --worker thug-1 --exec "npm test" --bg
\`\`\`
To automatically mark the ticket \`Completed\` if the command exits with code 0 (default leaves ticket \`In Development\` with verification notes):
\`\`\`bash
.esedre/ese crew dispatch <ticketId> --worker thug-1 --bg --complete
\`\`\`

#### 2. Universal Agent Configuration (Zero Vendor Lock-In):
Configure any AI coding agent CLI, wrapper, or script once for the machine in \`~/.esedre/config.json\`, or per project in \`.esedre/esedre.json\` (project value wins). Tokens: \`{{prompt}}\` (quoted instruction pointing at the task file, preferred), \`{{taskFile}}\`, \`{{ticketId}}\`, \`{{ticketKey}}\`:
\`\`\`bash
# Antigravity CLI:
.esedre/ese configure set agentCommand "agy -p {{prompt}} --dangerously-skip-permissions"

# Claude Code CLI:
.esedre/ese configure set agentCommand "claude -p {{prompt}} --dangerously-skip-permissions"

# Custom agent script / runner:
.esedre/ese configure set agentCommand "node scripts/ai-worker.js --task {{taskFile}} --ticket {{ticketId}}"
\`\`\`

#### 3. Launch a Targeted Single-Task Worker:
Execute a specific command against a targeted ticket and exit when done:
\`\`\`bash
.esedre/ese crew worker -t <ticketId> --id thug-1 --role thug --exec "npm test" --once
\`\`\`

#### 4. Automatic Worktree Dependency Linking:
When a worker sets up a git worktree (\`.worktrees/<workerId>\`), root \`node_modules\` and subproject \`node_modules\` (e.g. \`web/node_modules\`) are automatically linked via NTFS directory junctions on Windows (requiring no admin privileges) and symlinks on POSIX. Tests, builds, and linters run out-of-the-box without requiring separate \`npm install\` cycles inside worktrees.

#### 5. Launch a Continuous Background Worker Daemon:
Launch a polling worker in the background that continuously claims matching tickets, runs commands, and renews heartbeats:
\`\`\`bash
.esedre/ese crew worker --id thug-1 --role thug --poll 10
\`\`\`

#### 6. Preview Worker Ticket Selection (Dry Run):
Check which ticket a worker would claim without acquiring leases or running commands:
\`\`\`bash
.esedre/ese crew worker --id thug-1 --dry-run --once --json
\`\`\`

#### 7. Delegate a Ticket from Lead to Worker:
Assign and claim a ticket directly for a specific worker without executing immediately:
\`\`\`bash
.esedre/ese crew delegate <ticketId> --worker thug-1 --role thug
\`\`\`

#### 8. Escalate a Blocked or Failed Task:
Release the active lease, reset ticket status to Planned, and post an escalation reason for the Lead:
\`\`\`bash
.esedre/ese crew escalate <ticketId> --reason "Unit tests failed with syntax error in auth module"
\`\`\`

#### 9. Inspect Active Leases & Fleet Status:
\`\`\`bash
# Check all active leases across projects
.esedre/ese lease list --all
# or: .esedre/ese crew leases

# Display current process crew identity and role
.esedre/ese crew whoami

# Query fleet status via MCP
# Use tool: esedre_get_crew_status or esedre_list_leases
\`\`\`

#### 10. Dedicated Subcommand Help Screens:
Get detailed usage and flag references for any crew or lease subcommand:
\`\`\`bash
.esedre/ese crew dispatch --help
.esedre/ese crew worker --help
.esedre/ese crew delegate --help
.esedre/ese crew escalate --help
.esedre/ese lease claim --help
.esedre/ese lease release --help
.esedre/ese lease list --help
\`\`\`

#### 11. Review and Merge Worktree Branch:
\`\`\`bash
# Inspect changes made by worker
git diff HEAD..thug/thug-1

# Merge worker branch into active branch
git merge thug/thug-1
\`\`\`

## 3. Core CLI Commands (Fallback via \`run_command\`)

Both \`esedre\` and \`ese\` work interchangeably:

### Ticket Operations
\`\`\`bash
# List tickets with filters
.esedre/ese list [-p|--project <code|all>] [-s|--status <status>] [-t|--type <type>] [-P|--priority <priority>] [-m|--milestone <name>] [--blocked] [--linked-to <ticketKey>] [-q|--search <q>] [--json]

# Read ticket details
.esedre/ese get <ticketId> [--json]

# Read or update implementation plans
.esedre/ese plan <ticketId>
.esedre/ese plan <ticketId> --file <planFilePath>
.esedre/ese plan <ticketId> --set "<markdownContent>" [--last-hash <hash>]

# Create a ticket
.esedre/ese create --title "..." [-p|--project <code>] [-t|--type Feature] [-P|--priority High] [-m|--milestone <name>] [--complexity Medium] [--effort "2.0 - 4.0 hours"] [--detail "<md>"] [--file <path>] [--json]

# Update ticket status & attributes
.esedre/ese update <ticketId> --status "In Development"
.esedre/ese update <ticketId> --status "Completed"
.esedre/ese update <ticketId> --type Feature -P High --complexity Medium --effort "2.0 - 4.0 hours"
.esedre/ese update <ticketId> -P none           # Clears priority
.esedre/ese update <ticketId> -m "Release 1.0"  # Links ticket to milestone
.esedre/ese update <ticketId> -m none           # Unlinks ticket from milestone
.esedre/ese update <ticketId> --detail "<markdownContent>"
.esedre/ese update <ticketId> --file <detailFilePath>

# Append comments or notes
.esedre/ese comment <ticketId> "Verified implementation." --author "Agent"
.esedre/ese comment <ticketId> --file <commentFilePath> --author "Agent"
.esedre/ese comment <ticketId> --text "Verified implementation." --author "Agent"

# Regenerate snapshot
.esedre/ese snapshot
.esedre/ese refresh
\`\`\`

### Concurrency & Ticket Leases
\`\`\`bash
# Claim an exclusive lease on a ticket
.esedre/ese lease claim <ticketId> [--role lead|anchor|thug] [--ttl <minutes>] [--worktree <path>] [--worker <id>]

# Release a ticket lease upon completion or handoff
.esedre/ese lease release <ticketId> [--status Completed|Planned] [--notes "<notes>"] [--force]

# Renew active lease heartbeat
.esedre/ese lease renew <ticketId> [--ttl <minutes>]

# List active leases across projects
.esedre/ese lease list [-p|--project <code|all>] [--all]
\`\`\`

### Autonomous Crew Fleet Commands
\`\`\`bash
# Delegate a ticket to another worker (Leads and Anchors only)
.esedre/ese crew delegate <ticketId> --worker <targetId> [--role thug]

# Escalate a ticket when blocked or failed (resets to Planned and notifies Lead)
.esedre/ese crew escalate <ticketId> --reason "<explanation>"

# Launch a headless worker runner loop
.esedre/ese crew worker [--id <id>] [--role thug] [--exec "<cmd>"] [--once] [--poll <sec>] [--max-workers <n>]

# Display active leases across the fleet
.esedre/ese crew leases [-p|--project <code|all>] [--all]

# Display bound worker identity
.esedre/ese crew whoami
\`\`\`

> *Convenience aliases*: Direct commands \`ese claim\`, \`ese release\`, \`ese renew\`, \`ese leases\`, and \`ese worker\` remain available as direct aliases.

### Link or Unlink Tickets
\`\`\`bash
.esedre/ese link <sourceId> <relation> <targetId> [--author "..."]
.esedre/ese unlink <sourceId> <targetId> [--relation <relation>]
# Supported relations: relates-to, blocks, parent-of, duplicates
\`\`\`

### Manage Milestones & Umbrella Feature Flags
\`\`\`bash
.esedre/ese milestone list [-p|--project <code>] [--json]
.esedre/ese milestone get <id|title> [-p|--project <code>] [--json]
.esedre/ese milestone create --title "..." [-p|--project <code>] [--flag <flag>] [--status <status>] [--target-date <YYYY-MM-DD>] [--description "..."] [--json]
.esedre/ese milestone update <id|title> [-p|--project <code>] [--title "..."] [--flag <flag|none>] [--status <status>] [--target-date <YYYY-MM-DD>] [--description "..."] [--json]
.esedre/ese milestone delete <id|title> [-p|--project <code>] [--json]
\`\`\`

### Server Lifecycle & Daemon Management
\`\`\`bash
# Start background server daemon on port 5674 (default)
.esedre/ese start [--port 5674] [--quiet] [--json]

# Run foreground gateway server directly (Ctrl+C to stop)
.esedre/ese start -f [--port 5674]

# Check daemon health and diagnostics
.esedre/ese status [--port 5674] [--json]

# View recent daemon activity logs
.esedre/ese logs [--port 5674] [--lines <n>]

# Stop background server daemon
.esedre/ese stop [--port 5674] [--quiet] [--json]
\`\`\`

## 4. Embedded View & Theme Token Contract

When embedding \`<PlannedWorkView />\` inside a host app (e.g. \`PlannedWorkModal.tsx\`):

### Zero-Effort Drop-in (Default Fallback)
\`PlannedWorkView\` incorporates an internal CSS fallback bridge (\`.esedre-host-bridge\` / \`.esedre-theme-root\` with \`ESEDRE_THEME_FALLBACK_CSS\`).
If an embedding application supplies **zero CSS variables**, the component automatically falls back to clean, high-contrast light or dark themes matching the user's OS preference (\`prefers-color-scheme: dark\`) or host \`.dark\` / \`[data-theme="night"]\` classes.

### Theme Token Customization
If the host application declares any or all of the 12 core design tokens on \`:root\` or an ancestor container, \`PlannedWorkView\` automatically adopts them:
- **Surface**: \`--bg-surface\`, \`--bg-surface-elevated\`, \`--bg-input\`
- **Borders**: \`--border-subtle\`, \`--border-strong\`, \`--border-accent\`
- **Text**: \`--text-primary\`, \`--text-secondary\`, \`--text-muted\`
- **Accent**: \`--accent-primary\`, \`--accent-bg-subtle\`, \`--accent-border-subtle\`

## 5. Safety & Invariants
- **Always use \`--json\`** for CLI programmatic inspection.
- **Optimistic Concurrency**: Writes support \`--last-hash <hash>\` to prevent overwriting concurrent updates.
- **Universal Type Naming**: Always use \`type\` (\`Feature\`, \`Platform\`, \`Tools\`, \`Idea\`, \`Bug\`). The legacy name \`category\` is deprecated.
- **Ticket Priority**: The \`priority\` field is optional (\`Critical\`, \`High\`, \`Medium\`, \`Low\`, or unset/null). Backwards compatible with legacy tickets lacking a priority field. To clear via CLI use \`-P none\` or \`--priority none\` (in code/MCP, pass \`null\` or \`'none'\`).
- **Milestones & Umbrella Feature Flags**: Milestones group tickets into deliverables with completion metrics. Milestones can declare an optional umbrella feature flag which member tickets inherit automatically. Unlinking a ticket (\`-m none\`) removes inherited flags.
- **Compound IDs for Multi-Project Portfolios**: In \`project=all\`, ticket IDs are \`\${projectCode}-\${id}\` (e.g. \`Profe-1\`, \`Esedre-1\`). DOM anchors strictly use \`feature-card-\${projectCode}-\${id}\`.
- **Never delete tickets** directly via filesystem.
- **Workspace Scoping**: An LLM coding partner operates strictly within the authorized project scope declared in the local repository configuration. Central repository linking and system-level configuration are managed separately; focus roadmap work, implementation plans, and verification notes on this project.
- **Secret Developer Hash Route (\`#/planner\`, \`#/plan\`, \`#planner\`, \`#plan\`)**:
  - In web applications embedding Esedre (such as your host web app), \`#/planner\` and \`#/plan\` serve as direct secret developer entry routes.
  - **SEO Invariant**: These developer routes are private and MUST NEVER be exposed in \`sitemap.xml\`, \`robots.txt\`, \`llms.txt\`, or public navigation links.
  - The URL hash is preserved across hard page refreshes (F5) without falling back to \`#/chat\` or other views.
`;

export type ViteProxyStatus = 'CONFIGURED' | 'ALREADY_CONFIGURED' | 'SKIPPED' | 'MANUAL_REQUIRED' | 'NOT_APPLICABLE';

export interface ConfigureOptions {
  projectCode?: string;
  projectName?: string;
  allowedProjects?: string[];
  dataDir?: string | string[];
  port?: number;
  setupMcp?: boolean;
  setupProxy?: boolean;
  force?: boolean;
}

export interface ConfigureResult {
  esedreJsonCreatedOrUpdated: boolean;
  projectRegistered?: boolean;
  projectName?: string;
  wrappersPlanted: boolean;
  gitignoreUpdated: boolean;
  mcpConfigured: boolean;
  skillConfigured: boolean;
  skillStatus: ContentStatus;
  viteProxyStatus: ViteProxyStatus;
  viteConfigFile?: string;
  recommendedProxySnippet?: string;
  globalStoreStatus: 'ready' | 'warning';
  globalStorePath: string;
  globalStoreError?: string;
}

export function plantWrappers(targetDir: string): void {
  const esedreDir = path.join(targetDir, '.esedre');
  fs.mkdirSync(esedreDir, { recursive: true });

  const wrappers = [
    { name: 'esedre.cmd', content: WRAPPER_CMD, exec: false },
    { name: 'esedre.ps1', content: WRAPPER_PS1, exec: false },
    { name: 'esedre', content: WRAPPER_BASH, exec: true },
    { name: 'ese.cmd', content: ESE_WRAPPER_CMD, exec: false },
    { name: 'ese.ps1', content: ESE_WRAPPER_PS1, exec: false },
    { name: 'ese', content: ESE_WRAPPER_BASH, exec: true },
  ];

  for (const w of wrappers) {
    const fullPath = path.join(esedreDir, w.name);
    fs.writeFileSync(fullPath, w.content, 'utf-8');
    if (w.exec) {
      try {
        fs.chmodSync(fullPath, 0o755);
      } catch {}
    }
  }
}

export function setupMcpConfig(targetDir: string): boolean {
  const agentsDir = path.join(targetDir, '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const mcpConfigPath = path.join(agentsDir, 'mcp_config.json');

  let configObj: any = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    try {
      configObj = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      if (!configObj.mcpServers) configObj.mcpServers = {};
    } catch {}
  }

  if (process.platform === 'win32') {
    configObj.mcpServers.esedre = {
      command: 'cmd.exe',
      args: ['/c', '.esedre\\esedre.cmd', 'mcp'],
    };
  } else {
    configObj.mcpServers.esedre = {
      command: '.esedre/esedre',
      args: ['mcp'],
    };
  }

  try {
    fs.writeFileSync(mcpConfigPath, JSON.stringify(configObj, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function setupSkill(targetDir: string, options: { force?: boolean } = {}): { status: ContentStatus; updated: boolean } {
  const skillDir = path.join(targetDir, '.agents', 'skills', 'esedre');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    fs.writeFileSync(skillFile, ESEDRE_SKILL_TEMPLATE, 'utf-8');
    return { status: 'MISSING', updated: true };
  }

  const currentContent = fs.readFileSync(skillFile, 'utf-8');
  const status = classifyContent(currentContent, ESEDRE_SKILL_TEMPLATE, HISTORIC_SKILL_HASHES);

  if (status === 'LATEST' && !options.force) {
    return { status, updated: false };
  }

  const hasBannedOrDeprecatedTerms =
    currentContent.includes('companion agent') ||
    currentContent.includes('companion LLM') ||
    currentContent.includes('tools/esedre.mjs');

  if (options.force || status === 'HISTORIC_DEFAULT' || status === 'MISSING' || hasBannedOrDeprecatedTerms) {
    fs.writeFileSync(skillFile, ESEDRE_SKILL_TEMPLATE, 'utf-8');
    return { status: 'LATEST', updated: true };
  }

  return { status, updated: false };
}

export const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.mts',
  'vite.config.cjs',
];

export function findViteConfig(targetDir: string): string | null {
  for (const name of VITE_CONFIG_FILES) {
    const fullPath = path.join(targetDir, name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

export function getRecommendedViteProxySnippet(port: number = DEFAULT_ESEDRE_PORT): string {
  return `proxy: {
  '/esedre': {
    target: 'http://127.0.0.1:${port}',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\\/esedre/, ''),
  },
}`;
}

export function detectLineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export function injectViteProxy(content: string, port: number = DEFAULT_ESEDRE_PORT): string | null {
  if (content.includes("'/esedre'") || content.includes('"/esedre"')) {
    return content;
  }

  const eol = detectLineEnding(content);

  // Case 1: Inside existing proxy: { ... }
  const proxyMatch = content.match(/(proxy\s*:\s*\{)/);
  if (proxyMatch && proxyMatch.index !== undefined) {
    const insertIdx = proxyMatch.index + proxyMatch[0].length;
    const snippet = `${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 2: Inside existing server: { ... }
  const serverMatch = content.match(/(server\s*:\s*\{)/);
  if (serverMatch && serverMatch.index !== undefined) {
    const insertIdx = serverMatch.index + serverMatch[0].length;
    const snippet = `${eol}    proxy: {${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },${eol}    },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 3: Inside returned config object (return { ... })
  const returnMatch = content.match(/(return\s*\{)/);
  if (returnMatch && returnMatch.index !== undefined) {
    const insertIdx = returnMatch.index + returnMatch[0].length;
    const snippet = `${eol}    server: {${eol}      proxy: {${eol}        '/esedre': {${eol}          target: 'http://127.0.0.1:${port}',${eol}          changeOrigin: true,${eol}          rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}        },${eol}      },${eol}    },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 4: Inside defineConfig({ ... })
  const defineMatch = content.match(/(defineConfig\s*\(\s*\{)/);
  if (defineMatch && defineMatch.index !== undefined) {
    const insertIdx = defineMatch.index + defineMatch[0].length;
    const snippet = `${eol}  server: {${eol}    proxy: {${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },${eol}    },${eol}  },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 5: Inside export default { ... }
  const exportMatch = content.match(/(export\s+default\s*\{)/);
  if (exportMatch && exportMatch.index !== undefined) {
    const insertIdx = exportMatch.index + exportMatch[0].length;
    const snippet = `${eol}  server: {${eol}    proxy: {${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },${eol}    },${eol}  },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  return null;
}

export function configureViteProxy(
  targetDir: string,
  port: number = DEFAULT_ESEDRE_PORT,
  setupProxy?: boolean
): {
  status: ViteProxyStatus;
  configFile?: string;
  recommendedProxySnippet?: string;
} {
  const configPath = findViteConfig(targetDir);
  const snippet = getRecommendedViteProxySnippet(port);

  if (!configPath) {
    return {
      status: 'NOT_APPLICABLE',
      recommendedProxySnippet: snippet,
    };
  }

  const relativeName = path.basename(configPath);
  let content = '';
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return {
      status: 'MANUAL_REQUIRED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  if (content.includes("'/esedre'") || content.includes('"/esedre"') ) {
    return {
      status: 'ALREADY_CONFIGURED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  if (setupProxy !== true) {
    return {
      status: 'SKIPPED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  const injected = injectViteProxy(content, port);
  if (!injected) {
    return {
      status: 'MANUAL_REQUIRED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  try {
    fs.writeFileSync(configPath, injected, 'utf-8');
    return {
      status: 'CONFIGURED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  } catch {
    return {
      status: 'MANUAL_REQUIRED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }
}

export function configureWorkspace(targetDir: string, options: ConfigureOptions = {}): ConfigureResult {
  const esedreDir = path.join(targetDir, '.esedre');
  if (!fs.existsSync(esedreDir)) {
    fs.mkdirSync(esedreDir, { recursive: true });
  }

  // 1. .esedre/esedre.json
  const esedreJsonPath = path.join(esedreDir, 'esedre.json');
    
  let existingRaw: any = null;
  if (fs.existsSync(esedreJsonPath)) {
    try {
      existingRaw = JSON.parse(fs.readFileSync(esedreJsonPath, 'utf-8'));
    } catch {}
  }

  let config: EsedreConfig;
  let projectCode = options.projectCode || existingRaw?.projectCode;
  if (existingRaw?.projectCode && options.projectCode && existingRaw.projectCode.toLowerCase() === options.projectCode.toLowerCase()) {
    projectCode = existingRaw.projectCode;
  }
  const projectName = options.projectName || existingRaw?.projectName || (projectCode ? projectCode : undefined);
  const dataDir = options.dataDir !== undefined ? options.dataDir : existingRaw?.dataDir;

  if (existingRaw) {
    config = migrateEsedreConfig(existingRaw, CURRENT_ESEDRE_VERSION);
    if (projectCode) config.projectCode = projectCode;
    if (projectName) config.projectName = projectName;
    if (dataDir) config.dataDir = dataDir;
    if (options.allowedProjects) {
      config.allowedProjects = options.allowedProjects;
    } else if (projectCode) {
      if (!config.allowedProjects) {
        config.allowedProjects = [projectCode];
      } else if (!config.allowedProjects.some((p) => p.toUpperCase() === projectCode.toUpperCase())) {
        config.allowedProjects.push(projectCode);
      }
    }
    if (options.port) config.port = options.port;
  } else {
    config = {
      version: CURRENT_ESEDRE_VERSION,
      projectCode: projectCode || undefined,
      projectName: projectName || undefined,
      allowedProjects: options.allowedProjects || (projectCode ? [projectCode] : undefined),
      dataDir: dataDir || undefined,
      port: options.port || undefined,
    };
  }

  fs.writeFileSync(esedreJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // Ensure in-repo tickets directory and project descriptor if projectCode is present and no hub exists
  let projectRegistered = false;
  if (projectCode) {
    const hasExistingTicketsDir =
      fs.existsSync(path.join(targetDir, 'tickets')) ||
      fs.existsSync(path.join(targetDir, 'src', 'data', 'planning', 'tickets'));

    const ticketsDir = path.join(esedreDir, 'tickets');
    if (!hasExistingTicketsDir && !fs.existsSync(ticketsDir)) {
      fs.mkdirSync(ticketsDir, { recursive: true });
    }
    const inRepoPJson = path.join(esedreDir, 'project.json');
    if (!fs.existsSync(inRepoPJson)) {
      const projDesc = {
        id: 1,
        code: projectCode.toUpperCase(),
        name: projectName || projectCode.toUpperCase(),
        description: `${projectName || projectCode.toUpperCase()} project`,
        colors: {
          badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
          dot: 'bg-cyan-400',
          border: 'border-cyan-500/40',
        },
      };
      fs.writeFileSync(inRepoPJson, JSON.stringify(projDesc, null, 2) + '\n', 'utf-8');
      projectRegistered = true;
    } else if (projectName) {
      try {
        const existing = JSON.parse(fs.readFileSync(inRepoPJson, 'utf-8'));
        if (existing.name !== projectName) {
          existing.name = projectName;
          fs.writeFileSync(inRepoPJson, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
        }
      } catch {}
    }
  }

  // 2. Wrappers (.esedre/esedre.* and .esedre/ese.*)
  plantWrappers(targetDir);

  // 3. Gitignore check & update (.esedre/snapshot.json)
  const gitignoreUpdated = appendSnapshotToGitIgnore(targetDir);

  // 4. MCP setup
  let mcpConfigured = false;
  if (options.setupMcp !== false) {
    mcpConfigured = setupMcpConfig(targetDir);
  }

  // 5. Skill setup (.agents/skills/esedre/SKILL.md)
  const skillRes = setupSkill(targetDir, { force: options.force });

  // 6. Vite proxy check & setup
  const targetPort = resolvePorts(config).gateway;
  const proxyRes = configureViteProxy(targetDir, targetPort, options.setupProxy);

  // 7. Global store check & pre-creation (resilient, never crashes configure)
  const globalStoreRes = ensureGlobalEsedreStore();
  if (!globalStoreRes.ok) {
    console.warn(`\x1b[33m⚠️ Warning: Could not initialize global store at ${globalStoreRes.path}: ${globalStoreRes.error}\x1b[0m`);
  }

  return {
    esedreJsonCreatedOrUpdated: true,
    projectRegistered,
    projectName: config.projectName || config.projectCode,
    wrappersPlanted: true,
    gitignoreUpdated,
    mcpConfigured,
    skillConfigured: skillRes.updated,
    skillStatus: skillRes.status,
    viteProxyStatus: proxyRes.status,
    viteConfigFile: proxyRes.configFile,
    recommendedProxySnippet: proxyRes.recommendedProxySnippet,
    globalStoreStatus: globalStoreRes.ok ? 'ready' : 'warning',
    globalStorePath: globalStoreRes.path,
    globalStoreError: globalStoreRes.error,
  };
}

export const initWorkspace = configureWorkspace;

export const ESEDRE_HUB_AGENTS_TEMPLATE = `# Agent Guidelines: esedre-data

## 1. Role & Storage Boundary
- **Backing Storage Repository**: \`esedre-data\` is a dedicated, decoupled data hub storing raw tickets, metadata manifests, and implementation plans managed by the Esedre engine.
- **Authorized Ingress Channels**: Ticket discovery, read-only inspection, status updates, and plan authoring strictly ingress through the Esedre application layer in consuming project workspaces:
  1. **Local Workspace Snapshot**: Check the consuming workspace's \`.esedre/snapshot.json\` first for instant, zero-latency read access to ticket summaries, plans, and statuses.
  2. **Esedre MCP Tools**: Use \`esedre_get_ticket\`, \`esedre_list_tickets\`, \`esedre_get_plan\`, \`esedre_save_plan\`, and \`esedre_update_ticket\`.
  3. **Esedre CLI**: Execute \`.esedre/ese get <id>\`, \`.esedre/ese list\`, or \`.esedre/ese plan\` from within the relevant project workspace.

## 2. Ingress Redirection Protocol
When inspecting or managing tickets for any project (such as \`Profe\`, \`Esedre\`, or \`Alce\`), navigate to that project's workspace and utilize its local \`.esedre/snapshot.json\`, Esedre MCP tools, or \`.esedre/ese\` CLI wrapper.
`;

export interface InitHubResult {
  projectsJsonCreated: boolean;
  projectsDirCreated: boolean;
  agentsMdCreated: boolean;
  hubDir: string;
}

export function initHub(targetDir: string): InitHubResult {
  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }

  const projectsDir = path.join(resolved, 'projects');
  let projectsDirCreated = false;
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
    projectsDirCreated = true;
  }

  const projectsJsonPath = path.join(resolved, 'projects.json');
  let projectsJsonCreated = false;
  if (!fs.existsSync(projectsJsonPath)) {
    fs.writeFileSync(projectsJsonPath, '[]\n', 'utf-8');
    projectsJsonCreated = true;
  }

  const agentsMdPath = path.join(resolved, 'AGENTS.md');
  let agentsMdCreated = false;
  if (!fs.existsSync(agentsMdPath)) {
    fs.writeFileSync(agentsMdPath, ESEDRE_HUB_AGENTS_TEMPLATE, 'utf-8');
    agentsMdCreated = true;
  }

  return {
    projectsJsonCreated,
    projectsDirCreated,
    agentsMdCreated,
    hubDir: resolved.replace(/\\/g, '/'),
  };
}

/**
 * Detect whether a Windows CMD wrapper (esedre.cmd) is legacy or outdated.
 * Legacy wrappers lack subroutine dispatch (call :run %*), use goto :done or goto done,
 * declare a :done label, or contain parenthesized blocks that invalidate cmd.exe token state.
 */
export function isWrapperOutdated(esedreCmdContent: string | null | undefined): boolean {
  if (!esedreCmdContent || typeof esedreCmdContent !== 'string') {
    return true;
  }
  // 1. Legacy wrappers use goto :done or goto done
  if (/goto\s+:?done\b/i.test(esedreCmdContent)) {
    return true;
  }
  // 2. Legacy wrappers declare a :done label
  if (/^:done\b/im.test(esedreCmdContent)) {
    return true;
  }
  // 3. Modern wrapper uses subroutine dispatch call :run %* and :run label
  if (!esedreCmdContent.includes('call :run %*') || !/^:run\b/im.test(esedreCmdContent)) {
    return true;
  }
  return false;
}

export interface OutdatedWrapperInfo {
  name: string;
  dir: string;
  wrapperPath: string;
}

/**
 * Scan the current workspace and registered projects from global config
 * to identify any workspaces retaining legacy CMD wrappers.
 */
export function findOutdatedWrappers(
  currentWorkspaceRoot?: string,
  globalConfig?: EsedreConfig | null
): OutdatedWrapperInfo[] {
  const outdated: OutdatedWrapperInfo[] = [];
  const checkedDirs = new Set<string>();

  const checkDir = (dir: string, name: string) => {
    const resolved = path.resolve(expandHome(dir));
    if (checkedDirs.has(resolved.toLowerCase())) return;
    checkedDirs.add(resolved.toLowerCase());
    if (!fs.existsSync(resolved)) return;

    const cmdPath = path.join(resolved, '.esedre', 'esedre.cmd');
    if (fs.existsSync(cmdPath)) {
      try {
        const content = fs.readFileSync(cmdPath, 'utf-8');
        if (isWrapperOutdated(content)) {
          outdated.push({ name, dir: resolved, wrapperPath: cmdPath });
        }
      } catch {}
    }
  };

  if (currentWorkspaceRoot) {
    checkDir(currentWorkspaceRoot, path.basename(currentWorkspaceRoot));
  }

  if (globalConfig?.projects) {
    for (const [code, p] of Object.entries(globalConfig.projects)) {
      checkDir(p, code);
    }
  }

  return outdated;
}

export interface UpgradeAllOptions {
  currentWorkspaceRoot?: string;
  globalConfig?: EsedreConfig | null;
  force?: boolean;
}

export interface WorkspaceUpgradeResult {
  dir: string;
  name: string;
  projectCode?: string;
  upgrade: ConfigureResult;
  totalTickets?: number;
  error?: string;
}

export interface UpgradeAllResult {
  workspaces: WorkspaceUpgradeResult[];
  totalUpgraded: number;
}

/**
 * Upgrade wrappers, configs, and snapshot projections across all registered workspaces
 * declared in central ~/.esedre/config.json and the active workspace.
 */
export async function upgradeAllWorkspaces(options: UpgradeAllOptions = {}): Promise<UpgradeAllResult> {
  const globalCfg = options.globalConfig !== undefined ? options.globalConfig : readGlobalConfig();
  const workspaceMap = new Map<string, string>();

  // 1. Current workspace root if present and initialized
  if (options.currentWorkspaceRoot && fs.existsSync(options.currentWorkspaceRoot)) {
    const hasEsedre =
      fs.existsSync(path.join(options.currentWorkspaceRoot, '.esedre')) ||
      fs.existsSync(path.join(options.currentWorkspaceRoot, 'esedre.json'));
    if (hasEsedre) {
      const disc = findEsedreConfig(options.currentWorkspaceRoot, { fallbackToGlobal: true });
      workspaceMap.set(
        path.resolve(options.currentWorkspaceRoot),
        disc.config?.projectCode || path.basename(options.currentWorkspaceRoot)
      );
    }
  }

  // 2. Registered projects in global config
  if (globalCfg?.projects) {
    for (const [code, p] of Object.entries(globalCfg.projects)) {
      const resolved = path.resolve(expandHome(p));
      if (fs.existsSync(resolved)) {
        if (!workspaceMap.has(resolved)) {
          workspaceMap.set(resolved, code);
        }
      }
    }
  }

  const results: WorkspaceUpgradeResult[] = [];

  for (const [targetDir, name] of workspaceMap.entries()) {
    try {
      const targetDiscovered = findEsedreConfig(targetDir, { fallbackToGlobal: true });
      const projectCode = targetDiscovered.config?.projectCode;
      const res = configureWorkspace(targetDir, {
        projectCode,
        allowedProjects: targetDiscovered.config?.allowedProjects,
        port: targetDiscovered.config?.port,
        force: options.force,
      });

      let totalTickets: number | undefined;
      if (projectCode) {
        try {
          const targetStorage = new SecurityFilter(
            new FilesystemStorageAdapter(targetDir, targetDiscovered.config),
            targetDiscovered.config
          );
          const snapshot = await generateProjectSnapshot(targetStorage, projectCode, targetDir);
          totalTickets = snapshot.totalTickets;
        } catch {
          // If storage cannot be instantiated or snapshot fails, preserve wrapper upgrade
        }
      }

      results.push({
        dir: targetDir,
        name,
        projectCode,
        upgrade: res,
        totalTickets,
      });
    } catch (err: any) {
      results.push({
        dir: targetDir,
        name,
        upgrade: {} as any,
        error: err.message || String(err),
      });
    }
  }

  const totalUpgraded = results.filter((r) => !r.error && r.upgrade.wrappersPlanted).length;
  return { workspaces: results, totalUpgraded };
}

