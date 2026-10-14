# Esedre Remote Crew Architecture ("Best Hits") & Archived Dogfooding Template

> **Status**: Archived from the `Esedre-66` local single-machine crew experiment (`ticket/Esedre-66-local-crew-mvp` and `ticket/Esedre-67-crew-messaging`).
> Single-machine subagent orchestration is natively handled by Antigravity 2.0 (`invoke_subagent` + `send_message`) paired with `ese lease` (`Esedre-69`).
> The architectural patterns below are preserved specifically for **cross-machine remote node registration and task farming (`Laptop -> Desktop`)** tracked under `Esedre-51`, `Esedre-52`, and `Esedre-54`.

---

## Part 1: "Best Hits" for Remote System Registration & Cross-Machine Agent Farming (`Laptop -> Desktop`)

### 1. Explicit Remote System Registration & Heartbeat Telemetry (`Esedre-51`, `Esedre-52`)
- **Remote Server & Node Registry**:
  - Secondary compute workstations (such as a desktop workstation `Eris`) register with the Esedre Gateway (`port 5674` or configured `serverUrl`) as named execution nodes.
  - Each registered node declares:
    - `system`: Canonical host identifier (e.g. `Eris-Desktop`, `Laptop-Lead`).
    - `capabilities`: Scoped execution roles (e.g. `test-runner`, `bundler`, `agent-worker`).
    - `maxWorkers`: Maximum concurrent worker slots supported by that host's CPU/RAM budget.
    - `lastSeen`: Rolling heartbeat timestamp so the Gateway and Lead session can distinguish live remote nodes from offline or stale machines without relying on local OS PIDs.
- **Zero-Trust Capability Scoping & Disposable Sandboxing**:
  - Remote compute nodes only accept authenticated dispatch envelopes originating from an authorized Lead session.
  - Optional container sandboxing (`--sandbox=docker` / `docker run --rm`) mounts only the target workspace or worktree with zero access to host `$HOME`, `~/.ssh`, or unrelated credentials.

### 2. Cross-Machine Task Delegation & Fast-Yield Protocol (`Esedre-54`)
- **Farming Work from Laptop to Desktop**:
  - When developing interactively on a laptop, the Lead session can farm out heavy multi-project test batteries (`npm test`), production asset/ROM pipelines (`npm run build`), or bounded ticket implementations to the desktop node (`Eris`).
  - **Ticket Lease Coordination (`ese lease`)**:
    - Before executing work on a ticket, the remote worker claims an exclusive TTL-backed lease (`esedre_claim_ticket` / `ese lease claim <id> --system Eris-Desktop --worker-id worker-1`), renews heartbeats during execution, and releases the lease on completion or failure.
  - **Fast-Yield Delegation Pattern**:
    - Once a task is dispatched to a remote node, the Lead session yields immediately to the human developer with a concise handoff summary (ticket key, target system `Eris`, worker ID, and log stream URI) rather than blocking the interactive conversation in a polling loop.

### 3. Universal Agent Command Interpolation (Zero Vendor Lock-In)
- Remote worker nodes execute any configured CLI agent or shell runner using standardized token interpolation:
  - `{{prompt}}`: Quoted instruction pointing at `.esedre/TASK.md` (or `.esedre/PLAN_TASK.md`).
  - `{{taskFile}}`: Path to the generated task markdown file containing the ticket specification and active implementation plan.
  - `{{ticketId}}` / `{{ticketKey}}`: Numeric ID and compound key (`ProjectCode-id`).
- **Examples**:
  - Antigravity CLI: `ese configure set agentCommand "agy -p {{prompt}} --dangerously-skip-permissions"`
  - Claude Code CLI: `ese configure set agentCommand "claude -p {{prompt}} --dangerously-skip-permissions"`
  - Custom Runner: `ese configure set agentCommand "node scripts/worker.js --task {{taskFile}} --ticket {{ticketKey}}"`

### 4. Git Worktree Isolation & Dependency Junctions
- Remote workers execute inside isolated git worktrees (`.worktrees/<workerId>`) on dedicated child branches (`ticket/<ProjectCode>-<id>-<slug>` or `worker/<workerId>`).
- Root and subproject `node_modules` directories are linked automatically via NTFS directory junctions on Windows (requiring zero admin privileges) and symlinks on POSIX so builds and tests run immediately without redundant `npm install` cycles.

### 5. No-Plan Guard & Fail-Fast Escalation
- **No-Plan Guard**: Autonomous agent implementation refuses to run on a ticket that lacks an active implementation plan unless `--allow-no-plan` is explicitly supplied (raw `--exec` test/build commands are exempt).
- **Automatic Failure Escalation**: If a remote worker command exits non-zero or crashes, the runner automatically releases the ticket lease, reverts the ticket status to `Planned`, and posts an `[Escalation]` comment containing the exit reason, remote host name, and tail of the worker log.

---

## Part 2: Archived `ese crew` Dogfooding Template (Historical Reference)

```markdown
<!-- ESEDRE_DOGFOODING_START -->
- **ESEDRE DOGFOODING & DEVELOPER FEEDBACK MANDATE**:
  - **Tooling Dogfooding Priority & MCP Preference**: The developer is also the author/creator of Esedre. Always prioritize using official Esedre tooling rigorously and correctly on all planning tasks, actively dogfooding the toolchain in practice. **Crucially, PREFER MCP tools (`esedre_*`) over CLI execution for ticket inspection, planning, comments, and lease claims whenever MCP is available in the session**, using the CLI wrapper (`.esedre/ese`) for fleet execution, background dispatching (`ese crew dispatch`), or as a secondary fallback.
  - **Proactive Issue & Feature Gap Escalation**: Whenever you encounter any friction, bug, formatting limitation, concurrency quirk, missing CLI flag/option/tool, output anomaly, or feature gap in Esedre, you MUST prominently and explicitly surface it to the developer.
  - **Persistent Reminder Directive**: If you raise an Esedre tooling issue, gap, or question and the developer does not reply or acknowledge it, you MUST persistently follow up and remind them in subsequent turns until confirmed. Never let an Esedre defect, friction point, or improvement opportunity slip by unaddressed.
  - **Proactive Crew Fleet Dispatch (`crewEnabled`)**:
    - Check `.esedre/esedre.json` in the workspace root for `"crewEnabled": true` (or `"crew": { "enabled": true }`).
    - **When `crewEnabled: true`**: Do NOT wait for explicit user commands to dispatch background workers. You are expected and instructed to **proactively dispatch tasks** to background workers (via `.esedre/ese crew dispatch <ticketId> --bg`, or with `--exec "<cmd>"` / `--agent-cmd`), especially for:
      1. Long-running test suites and full regression batteries (e.g. `npm test`).
      2. Production builds or asset compilation (`npm run build`).
      3. Independent subtasks or child tickets executing in isolated worktrees (`.worktrees/<workerId>`).
    - Always follow the **Fast-Yield Delegation Pattern**: stop calling tools immediately after dispatching so terminal control yields instantly to the developer.
    - **When `crewEnabled` is false or omitted**: Fall back to Interactive Lead Direct Mode (claim lease with `ese lease claim <id>`, implement directly, and release lease upon completion).
  - **Grounding & Crew Opportunity Tracking**:
    - At the conclusion of your response, evaluate whether any action in this turn benefited from or could have further leveraged **Esedre Grounding Platform** or **`ese crew`** capabilities (or broader multi-project grounding opportunities):
      - *Active Hot Workers & Fast Yield*: Detached background workers executing tasks in isolated worktrees, returning terminal velocity instantly to the developer.
      - *Native MCP Mesh*: Communication between Lead and workers over standard MCP (2024-11-05 spec) via the Esedre Gateway (port 5674), streaming progress comments and plan updates dynamically.
      - *Isolated Git Worktrees & Child Branches*: Workers execute on isolated ticket child branches (`ticket/<ProjectCode>-<id>-<slug>`) with independent git worktrees, eliminating `.git/index.lock` collisions and file clobbering in the active editor.
      - *Disposable Sandboxing*: Ephemeral containers mounting only the workspace, preventing host pollution and script collisions.
      - *Subsystem Path & Ticket Leases*: Mutual exclusion locks preventing multiple agents from clobbering the same files or schemas concurrently.
    - *Mandatory Ledger Recording Invariant (`.esedre/GROUNDING_OPPORTUNITY_LEDGER.md`)*:
      Whenever a genuine grounding opportunity or observed friction point is identified, record the new entry into `.esedre/GROUNDING_OPPORTUNITY_LEDGER.md` before outputting the callout.
<!-- ESEDRE_DOGFOODING_END -->
```
