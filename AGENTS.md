# Agent Guidelines & Operating Instructions: Esedre

> **Environment Notice**: `esedre` is managed within **Google Antigravity**. Antigravity discovers and loads skills from `.agents/skills/` and instructions from this `AGENTS.md`.

---

## 1. Project Overview & Scope

- **Repository Role**: Standalone open developer roadmap, ticketing engine, CLI utility (`esedre` / `ese`), web UI, and Model Context Protocol (MCP) server for developers and autonomous LLM coding agents.
- **Primary Mission & Biggest Core Feature**: Providing **long-term grounding to LLM agent context** by maintaining structured, git-backed roadmaps, architectural plans, and verification records across multi-turn sessions, context compactions, and developer handoffs.
- **Data Ecosystem**: Multi-topology project configuration via `.esedre/esedre.json` or `esedre.json` with support for centralized ticket data hubs, in-repo standalone tickets, and federated hybrid topologies.
- **Core Architecture**: Node.js (v20+), TypeScript, ESM (`"type": "module"`), esbuild bundling to `dist/esedre.mjs`, Vite/React UI, and Vitest test runner.

---

## 2. Per-Project Sequential Numbering & Case-Remembering Convention

1. **Per-Project Numbering Space (Starts at #1)**:
   - Ticket numbers are sequential per project (e.g. `Profe-1..105`, `Esedre-1..8`, `Alce-1..`).
   - Every newly created project begins its tickets at ID `#1`.

2. **Addressing & Formatting Convention**:
   - **Cross-Project & All-Projects View**: Formatted with the project code prefix: `<ProjectCode>-<id>` (e.g. `Prof-35`, `Esedre-1`, `Alce-1`).
   - **Project-Scoped View**: Inside a single project view or CLI run with `--project <Code>`, formatted as `#<id>` (e.g. `#35`, `#1`).
   - **CLI & MCP Tool Lookups**: The CLI (`ese get`, `ese plan`, `ese update`, `ese comment`) and MCP tools accept both prefixed keys (`ese get Prof-35`, `ese get Esedre-1`) and numeric IDs (`ese get 1 --project Esedre`, or `ese get 1` when scoped to the active workspace project).

3. **Case-Remembering Casing & Case-Insensitive Matching Invariant**:
   - **Case-Remembering on Registration & Storage**: Project codes are up to 8 alphanumeric characters (`^[a-zA-Z0-9]{1,8}$`). The original casing provided at project registration (e.g. `Personal`, `Esedre`, `Prof`) is canonical. Storage directories (e.g. `projects/Personal/`) and metadata manifests (`project.json`, `projects.json`, `meta.json`) permanently preserve this canonical casing. Re-registering or configuring a project preserves the existing remembered casing instead of overwriting it with different casing. Ticket metadata (`meta.project`) always stamps the canonical remembered casing.
   - **Case-Insensitive on Lookups, Matching & Security**: All ticket lookups, project queries, CLI arguments, MCP tool calls, filters, and Agent Project Allow-List checks (`allowedProjects`) are strictly case-insensitive. Lookups such as `ese get personal-1`, `ese get PERSONAL-1`, and `ese get Personal-1` resolve identically to ticket `#1` in `Personal`.
   - **Linux & Cross-Platform Filesystem Normalization**: When resolving project directories on disk, the storage engine inspects existing entries in `projects/` case-insensitively and reuses the existing directory name. This prevents creating split duplicate directories (e.g. `projects/Personal/` vs `projects/personal/`) on case-sensitive filesystems like Linux ext4/XFS and Docker containers.

---

## 3. Multi-Topology Storage Resolution

The storage engine (`FilesystemStorageAdapter`) dynamically resolves tickets across 6 supported topology patterns:

1. **Single Hub Topology**:
   - `dataDir: "../esedre-data"` points to a dedicated ticket repository structured as `projects/<ProjectCode>/tickets/<id>/` and `project.json`.
2. **In-Repo Standalone Topology**:
   - Tickets reside locally within the project repository under `.esedre/tickets/<id>/`.
3. **Multi-Hub Topology**:
   - `dataDir: ["../team-hub", "../shared-hub"]` scans and aggregates multiple hub repositories.
4. **Disparate Multi-Repo Federation Topology**:
   - `projects: { "Prof": "../ProfessorArwamSleepCenter", "Alce": "../alce-web" }` maps independent project repositories into a unified view.
5. **Hybrid Topology**:
   - Combines `dataDir` hubs and `projects` federated paths, enabling personal ticket hubs and shared repositories to be managed side-by-side in one local runner.
6. **Monorepo / In-Workspace Hub Topology**:
   - When `dataDir` is omitted, the storage adapter automatically auto-discovers a `projects/` directory containing projects directly at `workspaceRoot` (or `./data`, `./.esedre`), enabling monorepos and ticket hubs to function out-of-the-box with zero configuration.

---

## 4. STRICT BAN ON YAML FOR CONFIGURATION & DATA (ZERO EXCEPTIONS)

- **ABSOLUTE BAN ON YAML FOR DATA & SETTINGS**: All configuration files, settings, project descriptors, manifests, tickets, metadata, plans, and comments MUST strictly use standard JSON or Markdown format (`esedre.json`, `projects.json`, `meta.json`, `comments.json`, `detail.md`).
- **Config Discovery**: The configuration file is strictly named `esedre.json` (never `esedre.yml` or `esedre.yaml`).
- **Cloudflare Tunnel Invariant**: Only the lower-level `tools/tunnel/config.yml` for the `cloudflared` binary is exempt, matching Cloudflare's mandatory binary format.

---

## 5. Git Execution Rules

1. **Use `--no-pager` for Git Commands**
   - Always run Git commands (such as `git diff`, `git log`, etc.) with `--no-pager` (or `-c core.pager=cat`) to prevent terminal pagers (`less`) from blocking/hanging in non-interactive tool shells.

2. **Explicit Authorization Required for Commit and Push (Zero Exceptions)**
   - **NEVER** perform `git add`, `git commit`, or `git push` without direct, explicit instructions from the user in that specific turn.
   - Automatically staging, committing, or pushing code is strictly prohibited.

3. **Zero Turn-to-Turn Carryover for Commit/Push**
   - An explicit instruction to commit or push in one turn **DOES NOT CARRY OVER** to subsequent turns or tasks. Each commit/push action requires a separate, explicit command.

4. **Main Branch Lockdown & PR Requirement**
   - Direct merges into `main` or direct pushes to `origin/main` are strictly forbidden; production deploys and releases occur via pull requests.

5. **Mandatory Scope Clarification in Multi-Project Workspaces**
   - In a multi-project workspace, if there is ANY ambiguity regarding which repositories, projects, or modified files are intended to be committed or pushed, you MUST ask the user for explicit clarification before staging, committing, or pushing.
   - Never assume all modified repositories or workspaces should be committed or pushed together. Erroneous commits or pushes across projects are strictly prohibited.

6. **Mandatory Documentation Currency Pre-Flight Check (Zero Stale Docs)**
   - Whenever the user mentions commit, push, or package publishing, you are STRICTLY REQUIRED to halt and double-check all Esedre documentation: `README.md`, `AGENTS.md`, and the agent skills in `.agents/skills/`.
   - **Expected Behavior (Halt & Warn, Never Silent Auto-Changes)**:
     - If ANY documentation is stale, out-of-date, or missing newly added commands, flags, schema fields, or architectural invariants, you MUST **HALT** and **WARN** the user of the stale documentation, explicitly presenting the suggested fixes.
     - You are STRICTLY FORBIDDEN from automatically changing files or silently bundling unreviewed doc edits into the commit to hide the issue.
     - Wait for explicit user review and approval of the proposed documentation updates before proceeding to stage, commit, push, or publish.

---

## 6. Multi-Project Agent Isolation & Two-Tier Configuration

1. **Two-Tier Configuration Hierarchy (Global vs Workspace)**:
   - **Central Global Config (`~/.esedre/config.json`)**: Defines the central standalone portfolio configuration, including registered data hubs (`dataDir`), linked external repositories (`projects`), and default port (5674). Managed via `ese configure`.
   - **Workspace Local Config (`.esedre/esedre.json`)**: Declares the active repository's local identity (`projectCode`) and authorized access scope (`allowedProjects`). Initialized via `ese init`.
   - **Upward Resolution & Merging**: The CLI and MCP server crawl upward from `cwd` for `.esedre/esedre.json`. Local workspace settings take precedence, while infrastructure defaults (`dataDir`, `projects`, `port`) automatically inherit from `~/.esedre/config.json` when omitted locally. Outside any workspace, the central global configuration is used directly.

2. **Command Split: `ese init` vs `ese configure`**:
   - `ese init [path]`: Brings a project repository online (creates `.esedre/esedre.json`, wrappers, initial snapshot) or bootstraps a data hub repository (`ese init --hub`). Also supports workspaceless or data hub-targeted project creation via `ese init --project <Code> [--name <Name>] [--hub <hub>]`. When a single `dataDir` is configured, `--hub` is automatically resolved; when multiple hubs are configured, `--hub` disambiguates the target hub by directory basename or path without overwriting existing workspace configurations.
   - `ese configure`: Inspects and mutates the central configuration in `~/.esedre/config.json` (`ese configure add <path>`, `ese configure remove <target>`, `ese configure set <k> <v>`).

3. **Multi-Project Agent Isolation (Zero Cross-Project Leaks)**:
   - Each agent or tool execution is strictly informed and scoped only to the projects declared in its workspace's `allowedProjects`. Neither the CLI tool nor the MCP server may expose, list, query, create, update, or mutate tickets, plans, or comments belonging to projects outside `allowedProjects`.
    - Unauthorized requests MUST throw `EsedreAuthorizationError` immediately:
      - **MCP Protocol**: Caught and returned as standard JSON-RPC 2.0 error code `-32603` with message `Access Denied: Project '<code>' is outside this workspace's authorized scope.`
      - **CLI Tool**: Exits cleanly with status code `1` and prints `Access Denied: ...`.
      - **REST API**: Returns standard HTTP status code `403 Forbidden` with `{ "error": "Access Denied: ..." }`.
    - Wildcard `"*"` in `allowedProjects` permits all registered projects (used in multi-project umbrella workspaces or administrative environments).

4. **Approved Terminology: "Agent Project Allow-List" (Strictly NO "Firewall")**:
   - The term "Firewall" is **NOT** approved terminology anywhere in documentation, descriptions, CLI output, commit messages, or code comments.
   - Strictly use: **"Agent Project Allow-List, providing isolation of projects planning that you don't want an agent to access"** (or concise forms like "Agent Project Allow-List" and "Multi-Project Agent Isolation").

---

## 7. Build, Testing & Quality Standards

1. **Mandatory Build & Lint Verification (ZERO EXCEPTIONS)**:
   - **SUPER DAMN REQUIRED**: You are STRICTLY AND ABSOLUTELY REQUIRED to run `npm test` and `npm run build` ALWAYS, ANY TIME you modify code or configuration.
   - Run `npm run build:cli` to produce `dist/esedre.mjs` and `dist/web/embed.js`.
   - Run `npm run build:ui` to compile the standalone React 19 web application into `dist/web/`.
   - Run `npm run build` for full verification (linting + CLI build + UI build). Confirm zero compilation, syntax, type, or unreferenced symbol errors.

2. **Mandatory Vitest Test Suite & Headless Verification**:
   - Run `npm test` (`npx vitest run`) on every code modification.
   - All tests in `tests/` must pass cleanly (covering config discovery, storage adapter, multi-topology storage, agent project allow-list isolation, MCP protocol, and CLI execution).
   - Proactively use headless testing scripts and unit tests in `tests/` for logic verification.

3. **Assertion Integrity & Zero Silent Test Weakening**:
   - **Zero Silent Test Weakening**: Never weaken, delete, comment out, or relax unit test assertions. Diagnose the root cause and fix the implementation in the source code.
   - Proactively add and maintain unit tests for text and configuration parsing, multi-topology resolution, optimistic concurrency, and storage boundaries.

4. **Mandatory Unit Tests for Black-Boxable Logic**:
   - Write Vitest unit tests for all properly black-boxable domain logic, storage adapters, configuration crawlers, schema validators, path resolvers, and MCP/CLI argument handlers.

5. **Mandatory Root Cause Analysis Invariant**:
   - You MUST perform deep architectural root-cause diagnosis before modifying any code.
   - Never apply superficial band-aids, trial-and-error string tweaks, or downstream regex patches.
   - When unit tests fail, NEVER weaken or modify test assertions to force a pass; diagnose why the implementation failed and fix the root cause in the source code.

6. **Strict Ban on Autonomous Browser / UI Testing ("I'll Do UI Testing Unless I Say Otherwise")**:
   - **STRICTLY GET OUT OF THE UI UNLESS DIRECTED**: NEVER launch browser subagents, Chrome DevTools MCP sessions, or open/navigate browser URLs for UI testing/verification unless the user explicitly and directly commands you to do so in that specific turn. The developer will conduct UI verification manually unless they instruct otherwise.
   - Do NOT perform autonomous visual checks, browser recordings, or UI inspection on your own initiative.

7. **Local Dev & Cloudflare Tunnel Workflows**:
   - `npm run dev`: Runs local Vite development server on port 5674.
   - `npm run net`: Cloudflare tunnel targeting port 5674 for `esedre.aroomwithamoose.com` (with `planner.arwam.com` as alias) with IP whitelist protection.
   - `npm run net:all`: Public open tunnel mode for external access.
   - **Vite `server.allowedHosts`**: Configured in `vite.config.ts` with `['esedre.aroomwithamoose.com', 'planner.arwam.com', 'localhost', '127.0.0.1']` to prevent Vite 6/8 host header rejection (`403 Forbidden`).
   - **Global `--config` Flag Order**: In `cloudflared`, `--config` must precede the subcommand: `cloudflared --config tools/tunnel/config.yml tunnel run ...`.
   - **Remote vs Local Ingress Configuration**: Tunnels created or managed in the Cloudflare Zero Trust dashboard receive ingress configuration remotely, overriding local `config.yml`. When routing new hostnames (`cloudflared tunnel route dns`), remote ingress configuration must be updated via Cloudflare API (`PUT /accounts/:id/cfd_tunnel/:id/configurations`) or the Zero Trust dashboard.
   - **Private Domain Separation**: Standalone Esedre planning hub and local filesystem data endpoints are strictly hosted under the private domain `esedre.aroomwithamoose.com`. Public documentation and marketing previews run on `dev.esedre.com` (under `esedre-web`), ensuring zero external discovery of private local data hubs.
   - **Cloudflare Origin Certificate Scoping Invariant (`~/.cloudflared/`)**:
     * Runtime tunnels (`npm run net` / `cloudflared tunnel run`) authenticate via JSON credentials or tunnel tokens; they never read `.pem` certificates.
     * Administrative CLI routing (`cloudflared tunnel route dns`) uses Origin CA certificates (`.pem`), which are strictly bound to a single Cloudflare Zone ID.
     * To prevent accidental zone contamination (such as minting `.arwam.com` subdomains on external targets), dedicated certificates are preserved with distinct names (`cert-arwam.pem`, `cert-aroomwithamoose.pem`, `cert-esedre.pem`). CLI route commands must pass `--origincert` explicitly.


8. **Smart Release & Package Publishing Workflow (`npm run pub`)**:
   - **Publishing Command**: Always use `npm run pub` (or `npm run pub -- <args>`) instead of bare `npm publish`.
   - **Upfront Auth Pre-Check**: `scripts/publish.js` runs a fast `npm whoami` check (~100ms) before invoking any builds or tests.
   - **Auto-Login**: If unauthenticated, it automatically launches an interactive `npm login` prompt in local terminal sessions instead of waiting through minutes of compilation only to fail with a registry 404/403.
   - **Lifecycle Chain**: Once authenticated, it triggers `prepublishOnly` (`npm run lint`, `npm run test`, `npm run build`) and publishes with `--access public`.
   - **Strict Agent Invariant (Dry Run Only)**: Autonomous LLM coding agents are STRICTLY FORBIDDEN from executing live package publication (`npm run pub` or `npm publish`). Agents may ONLY run dry run verification (`npm run pub -- --dry-run`). Live package publishing to the npm registry is exclusively executed manually by the human developer.

9. **Trailing Newline at EOF**:
   - All code, JSON, Markdown, and config files must end with a single trailing newline (`\n`).

10. **First-Class Antigravity Tool Usage Over Scripting (No Ad-Hoc Scripts for Simple Edits)**:
   - You MUST strictly prioritize and use proper first-class Antigravity tools (`replace_file_content`, `multi_replace_file_content`, `write_to_file`, `view_file`, `grep_search`) whenever available and reasonable for code and file modifications.
   - NEVER execute ad-hoc Node, Python, or PowerShell scripts/one-liners (e.g. `node -e "fs.writeFileSync(...)"` or temporary scratch scripts) for simple edits, 1-line changes, or file replacements.
   - Scripting is strictly reserved for tasks where it is genuinely beneficial, such as bulk migrations, repo-wide codemods, or complex data transformations.

---

## 8. Daemon Lifecycle, Process Detachment & Gateway Topology

1. **Gateway Port Topology**:
   - **Unified Gateway**: Port 5674 (default) routes public traffic:
     - `/app` $\rightarrow$ internal Web UI server (port 5675)
     - `/api` $\rightarrow$ internal REST API server (port 5676)
     - `/` $\rightarrow$ transparent rewrite to `/app/`
     - Query parameters: `project=all` (portfolio overview) or `project=<Code>` (scoped view).

2. **Server Lifecycle Commands (`ese start` / `ese stop` / `ese status` / `ese logs`)**:
   - Clean top-level commands without verbose subcommands:
     - `ese start`: Starts the background server and web UI daemon (default port 5674).
     - `ese start --foreground` (or `-f`): Runs server in foreground (blocks terminal, Ctrl+C to stop).
     - `ese stop`: Shuts down the running background server daemon.
     - `ese status`: Checks health, PID, uptime, and diagnostics.
     - `ese logs`: Tails recent server output logs.
   - **Gateway Portfolio Storage Decoupling**: The background server and gateway cluster (`ese start`) instantiate unconstrained portfolio storage. This guarantees the developer Web UI has complete visibility across all registered data hubs and projects, regardless of the folder from which the server was launched.
   - **Dynamic Filesystem & Configuration Reloading**: The storage engine polls configuration and project manifests with a 3-second TTL (`ensureFreshConfig`), ensuring external data hubs and projects update in real time without server daemon restarts.
   - **Windows Readiness Watchdog**: To eliminate cold-start race condition aborts on Windows, `pingDaemon` uses a 10,000ms watchdog timeout with 500ms ping timeouts and 150ms polling intervals.
   - **Background Spawning Pattern**: Background daemons are spawned with `child_process.spawn(..., { detached: true, stdio: ['ignore', outFd, errFd] })` and detached with `child.unref()`.
   - **Windows File Descriptor Cleanup Pattern**: Immediately after `child.unref()`, the parent launcher process must explicitly close parent file handles (`fs.closeSync(outFd)`, `fs.closeSync(errFd)`). Omitting this holds Windows file locks on `.esedre/daemon.log`, preventing clean restarts or log truncation.
   - **Dual Liveness Check**: Daemon status detection and shutdown commands must verify HTTP endpoint liveness (`GET /api/ping`) alongside PID liveness (`process.kill(pid, 0)`) to protect against PID recycling false positives.
   - **State Persistence**: Daemon state resides strictly in `~/.esedre/run/daemon-<port>.json` (falling back to `.esedre/daemon.json`).

---

## 9. Universal "Type" Standardization & Schema Invariants

1. **Strict "Type" Field Invariant**:
   - All layers (storage manifests `meta.json`, CLI options `--type` / `-t`, Web UI filters, and REST/MCP payloads) strictly standardize on **`type`** (`"Feature" | "Platform" | "Tools" | "Idea" | "Bug"`).
   - The pre-v2 legacy field `category` is permanently deprecated. Never introduce `category` into new ticket templates, schemas, or tests.

2. **CLI Shorthand Flags**:
   - `-t` / `--type`: Ticket type filter or assignment.
   - `-p` / `--project`: Project code selector.
   - `-s` / `--status`: Ticket status filter or assignment.
   - `-q` / `--search`: Substring search query.

---

## 10. Multi-Project Ticket ID & Performance Architecture

1. **Compound ID Uniqueness**:
   - In cross-project or portfolio mode (`project=all`), numeric ticket IDs collide across repositories (e.g. `Profe-1` vs `Esedre-1`). All storage lookup maps, URL anchors, and React keys must use the compound key `${projectCode}-${ticketNumber}`.
   - **DOM Anchor Invariant**: Ticket cards and scroll targets must strictly use `id="feature-card-${projectCode}-${number}"`, never bare `id="feature-card-${number}"`, preventing DOM query collisions and broken jump navigation.

2. **Prohibition of N+1 Hydration Waterfalls**:
   - Initial UI load must fetch consolidated state in a single HTTP round-trip via `/api/planning/all`.
   - Sequential N+1 client fetches across `getMetas()`, `getTicketDetails()`, `getAnswers()`, `getComments()`, and `getPlanHistory()` on initial mount are strictly forbidden.

---

## 11. Standalone Mode vs Embedded View & 0-Effort Drop-in Theme Contract

1. **Standalone Mode vs Embedded View**:
   - **Standalone Mode**: Normal, primary operation of Esedre accessed via its dedicated web UI (port 5674 / `/app`). The unified server is ALWAYS run whenever Esedre is utilized (`ese start`).
   - **Embedded View**: Optional embedding of the `<PlannedWorkView />` component inside a host application (e.g. Professor Arwam's Sleep Research Center) via host dev server reverse proxy (`/esedre`).

2. **Zero-Effort Drop-in Fallback Bridge**:
   - `<PlannedWorkView />` embeds an internal CSS fallback bridge (`.esedre-host-bridge` / `.esedre-theme-root` with `ESEDRE_THEME_FALLBACK_CSS`).
   - If an embedding host application provides zero CSS variables, the planner automatically renders high-contrast, beautiful light or dark themes matching the user's OS preference (`prefers-color-scheme`) or `.dark` / `[data-theme]` classes.

2. **Custom Theme Token Inheritance**:
   - When the host application defines any of the 12 core design tokens, `PlannedWorkView` seamlessly inherits them without clashing:
     - Surface: `--bg-surface`, `--bg-surface-elevated`, `--bg-input`
     - Borders: `--border-subtle`, `--border-strong`, `--border-accent`
     - Text: `--text-primary`, `--text-secondary`, `--text-muted`
     - Accent: `--accent-primary`, `--accent-bg-subtle`, `--accent-border-subtle`

3. **Tunnel & HMR Non-Interference**:
   - Reverse proxies and gateway routes must never intercept or block WebSocket HMR channels (`/ws`, port 443 / `clientPort` tunnel traffic).

---

## 12. Terminology Standard: Strict "LLM" over "AI" & Ban on "LLM Companion"

1. **Strict Preference for "LLM" over "AI"**:
   - In documentation, code comments, schemas, CLI descriptions, commit messages, and agent instructions, strictly use the term **LLM** (e.g. "autonomous LLM coding agents", "LLM coding partner", "LLM-driven workflows") rather than the generic term "AI".
   
2. **Dual Human & LLM Coordination**:
   - Always frame Esedre as a tool engineered for **both** developers/engineers and autonomous LLM agents working together in pair-programming workflows, never as a tool exclusively for models.

3. **Strict Ban on "LLM Companion" (Approved: "LLM Agent" or "LLM Coding Partner")**:
   - The phrase "LLM Companion" (and variants such as "companion LLM", "companion LLMs", "companion agent", "AI companion") is STRICTLY BANNED in documentation, descriptions, CLI text, commit messages, and code comments.
   - Approved terms are strictly: **"LLM Agent"** or **"LLM Coding Partner"** (or plural: "LLM Agents", "LLM Coding Partners", "autonomous LLM coding agents").

---

## 13. STRICT PROHIBITION ON EM DASHES (ZERO EXCEPTIONS)

- **ABSOLUTE BAN ON EM DASHES (U+2014 / em dash)**: Never use em dashes anywhere in documentation, code, comments, CLI output, commit messages, or metadata. Use standard hyphens `-`, colons `:`, parentheses `()`, or rewrite sentences naturally without dashes.

---

## 14. Core Architectural Pillar: Long-Term Grounding for LLM Agent Context

1. **Primary Value Proposition & Biggest Core Feature**:
   - The single biggest core feature of Esedre is providing **long-term grounding to LLM agent context**.
   - LLM coding agents naturally face context window limits, context compaction, and session amnesia across multi-turn workflows. External issue trackers live in remote cloud silos that agents cannot access reliably, locally, or deterministically.

2. **Git-Backed Authoritative Memory**:
   - By structuring tickets, architectural breakdowns, decision records, and verification comments in plain JSON and Markdown directly alongside source code, Esedre functions as persistent, version-controlled ground truth for LLM agents.
   - When an LLM agent begins a new turn, recovers from a context compaction, or collaborates across developer handoffs, the roadmap anchors the model to concrete technical specifications, constraints, and upcoming milestones.

3. **Continuous Real-Time Alignment via MCP & CLI**:
   - Through the Model Context Protocol (MCP) server and CLI commands, LLM agents continuously query project priorities (`esedre_list_tickets`), inspect specifications (`esedre_get_ticket`), and update plans (`esedre_save_plan`) with optimistic concurrency checks (`sha1`), eliminating hallucinated project direction and preventing drift.

4. **Per-Project Grounding Context & Conflict-Free Guidelines Invariant**:
   - **Per-Project Grounding Parameters**: Projects configure high-level architectural mission statements, technology stack constraints (languages, runtime targets, framework versions), and grounding rules in `project.json` (or `.esedre/project.json`).
   - **Authoritative Source of Truth**: User-maintained agent guidelines (such as `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`) are strictly the primary source of truth. Esedre grounding context references and anchors to them rather than duplicating rules that can become stale.
   - **Zero-Latency Snapshot Projection**: The `ese snapshot` projection engine embeds project mission and technology stack parameters directly into `.esedre/snapshot.json`. LLM agents query this lean snapshot instantly upon session start or after context compactions.

5. **Mandatory Pre-Edit Backup Invariant for Automated Mutations (Zero Exceptions)**:
   - Any automated tool, CLI diagnostic repair, or LLM-driven fix operation (such as `ese doctor`, `ese fix`, or smart repair routines) that modifies, rewrites, or repairs configuration files, manifests, tickets, plans, or source code MUST create an atomic timestamped backup (`.bak` or `.esedre/backups/<timestamp>/`) before modifying any file on disk.

---

## 15. Planning Mode, Change Authorization & Problem Solving Philosophy

1. **Explicit Approval Required Before Code Changes**:
   - When in Planning Mode or presenting an implementation plan or design proposal, you are strictly forbidden from modifying source code, running build modifying tasks, or executing changes until the user explicitly responds with unambiguous confirmation.

2. **"Ideas?" / Brainstorming is NEVER Approval to Implement**:
   - When the user asks "Ideas?", "What do you think?", or asks for diagnosis/suggestions, treat it strictly as diagnostic planning/brainstorming and wait for unambiguous confirmation before touching any code.

3. **Strict Workspace-Relative Path Invariant**:
   - NEVER hardcode machine-specific absolute file paths (e.g. `C:\Users\...` or `file:///C:/Users/...`) in documentation, comments, scripts, or commit notes. Always use clean workspace-relative paths (e.g. `src/storage/...` or `tests/...`).

4. **Problem Solving Philosophy: Root Cause Resolution & Paving the Desire Paths**:
   - Fix underlying issues at their architectural source in parser, database, storage, or state logic; avoid superficial band-aids or downstream string patches.
   - **Pave the Desire Paths**: When the LLM agent naturally gravitates toward a pattern, officially support and structure it rather than fighting it.
   - Preserve all existing comments, docstrings, and type annotations that are unrelated to your immediate changes.

---

## 16. Package Distribution, Versioning & Release Workflow

1. **Dual Version Synchronization**:
   - Package version numbers must strictly stay synchronized across `package.json` (`"version"`) and `src/types.ts` (`CURRENT_ESEDRE_VERSION`).
   - Tests dynamically import `CURRENT_ESEDRE_VERSION` to ensure version checks remain evergreen across releases.

2. **Standard Native npm Publishing**:
   - Publishing relies on standard `npm publish` with `prepublishOnly` executing `npm run lint && npm run test && npm run build`.
   - The `"bin"` map in `package.json` must use normalized paths without leading `./` (e.g. `"dist/esedre.mjs"` instead of `"./dist/esedre.mjs"`) to satisfy npm package validation without warnings.

3. **Future CI Automation via npm Trusted Publishing (OIDC)**:
   - Automated publishing from GitHub Actions uses OIDC Trusted Publishing (`permissions: id-token: write`, `npm publish --provenance`) to generate verifiable package provenance with zero stored secret tokens.

4. **Pre-Publish Documentation Currency Check**:
   - The mandatory pre-flight check defined in Section 5.6 strictly applies before publishing any package release. Never initiate or assist with a package release if documentation is stale. Halt and present suggested fixes for user review.
