# Agent Guidelines & Operating Instructions: Esedre

> **Environment Notice**: `esedre` is managed within **Google Antigravity**. Antigravity discovers and loads skills from `.agents/skills/` and instructions from this `AGENTS.md`.

---

## 1. Project Overview & Scope

- **Repository Role**: Standalone open developer roadmap, ticketing engine, CLI utility (`esedre` / `ese`), web UI, and Model Context Protocol (MCP) server for developers and autonomous companion LLM coding agents.
- **Data Ecosystem**: Multi-topology project configuration via `.esedre/esedre.json` or `esedre.json` with support for centralized ticket data hubs, in-repo standalone tickets, and federated hybrid topologies.
- **Core Architecture**: Node.js (v20+), TypeScript, ESM (`"type": "module"`), esbuild bundling to `dist/esedre.mjs`, Vite/React UI, and Vitest test runner.

---

## 2. Per-Project Sequential Numbering Convention

1. **Per-Project Numbering Space (Starts at #1)**:
   - Ticket numbers are sequential per project (e.g. `Profe-1..105`, `Esedre-1..8`, `Alce-1..`).
   - Every newly created project begins its tickets at ID `#1`.

2. **Addressing & Formatting Convention**:
   - **Cross-Project & All-Projects View**: Formatted with the project code prefix: `<ProjectCode>-<id>` (e.g. `Prof-35`, `Esedre-1`, `Alce-1`).
   - **Project-Scoped View**: Inside a single project view or CLI run with `--project <Code>`, formatted as `#<id>` (e.g. `#35`, `#1`).
   - **CLI & MCP Tool Lookups**: The CLI (`ese get`, `ese plan`, `ese update`, `ese comment`) and MCP tools accept both prefixed keys (`ese get Prof-35`, `ese get Esedre-1`) and numeric IDs (`ese get 1 --project Esedre`, or `ese get 1` when scoped to the active workspace project).

---

## 3. Multi-Topology Storage Resolution

The storage engine (`FilesystemStorageAdapter`) dynamically resolves tickets across 5 supported topology patterns:

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

---

## 6. Multi-Project Agent Isolation & Scope Invariants

1. **Upward Configuration Discovery**
   - When the CLI or MCP server executes, it begins at `cwd` and traverses upward directory by directory, stopping at the **first** `esedre.json` it finds.
   - That file defines the active repo's `projectCode` and authorized access scope (`allowedProjects`).

2. **Multi-Project Agent Isolation (Zero Cross-Project Leaks)**
   - Each agent or tool execution is strictly informed and scoped only to the projects declared in its workspace's `allowedProjects`. Neither the CLI tool nor the MCP server may expose, list, query, create, update, or mutate tickets, plans, or comments belonging to projects outside `allowedProjects`.
   - Unauthorized requests MUST throw `EsedreAuthorizationError` immediately:
     - **MCP Protocol**: Caught and returned as standard JSON-RPC 2.0 error code `-32603` with message `Access Denied: Project '<code>' is outside this workspace's authorized scope.`
     - **CLI Tool**: Exits cleanly with status code `1` and prints `Access Denied: ...`.
   - Wildcard `"*"` in `allowedProjects` permits all registered projects (used in multi-project umbrella workspaces or administrative environments).

3. **Approved Terminology: "Agent Project Allow-List" (Strictly NO "Firewall")**
   - The term "Firewall" is **NOT** approved terminology anywhere in documentation, descriptions, CLI output, commit messages, or code comments.
   - Strictly use: **"Agent Project Allow-List, providing isolation of projects planning that you don't want an agent to access"** (or concise forms like "Agent Project Allow-List" and "Multi-Project Agent Isolation").

---

## 7. Build, Packaging & Quality Standards

1. **Single-File Bundling & UI Build**
   - Run `npm run build:cli` to produce `dist/esedre.mjs` and `dist/web/embed.js`.
   - Run `npm run build:ui` to compile the standalone React 19 web application into `dist/web/`.
   - Run `npm run build` for full verification (linting + CLI build + UI build).

2. **Mandatory Vitest Test Suite**
   - Run `npm test` (`npx vitest run`) on every code modification.
   - All tests in `tests/` must pass cleanly (covering config discovery, storage adapter, multi-topology storage, agent project allow-list isolation, MCP protocol, and CLI execution).

3. **Local Dev & Cloudflare Tunnel Workflows**
   - `npm run dev`: Runs local Vite development server on port 5674.
   - `npm run net`: Cloudflare tunnel targeting port 5674 for `dev.esedre.com` (with `planner.arwam.com` as alias) with IP whitelist protection.
   - `npm run net:all`: Public open tunnel mode for external access.

4. **Trailing Newline at EOF**
   - All code, JSON, Markdown, and config files must end with a single trailing newline (`\n`).
---

## 8. Daemon Lifecycle, Process Detachment & Gateway Topology

1. **Gateway Port Topology**:
   - **Unified Gateway**: Port 5674 (default) routes public traffic:
     - `/app` $\rightarrow$ internal Web UI server (port 5675)
     - `/api` $\rightarrow$ internal REST API server (port 5676)
     - `/` $\rightarrow$ transparent rewrite to `/app/`
     - Query parameters: `project=all` (portfolio overview) or `project=<Code>` (scoped view).

2. **Detached Daemon Process Execution (`ese daemon`)**:
   - **Background Spawning Pattern**: Background daemons are spawned with `child_process.spawn(..., { detached: true, stdio: ['ignore', outFd, errFd] })` and detached with `child.unref()`.
   - **Windows File Descriptor Cleanup Pattern**: Immediately after `child.unref()`, the parent launcher process must explicitly close parent file handles (`fs.closeSync(outFd)`, `fs.closeSync(errFd)`). Omitting this holds Windows file locks on `.esedre/daemon.log`, preventing clean restarts or log truncation.
   - **Dual Liveness Check**: Daemon status detection and shutdown commands must verify HTTP endpoint liveness (`GET /api/ping`) alongside PID liveness (`process.kill(pid, 0)`) to protect against PID recycling false positives.
   - **State Persistence**: Daemon state resides strictly in `.esedre/daemon.json` (containing `pid`, `port`, `startedAt`, `version`, `projects`).

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

## 11. Embedded View & 0-Effort Drop-in Theme Contract

1. **Zero-Effort Drop-in Fallback Bridge**:
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

## 12. Terminology Standard: Strict "LLM" over "AI"

1. **Strict Preference for "LLM" over "AI"**:
   - In documentation, code comments, schemas, CLI descriptions, commit messages, and agent instructions, strictly use the term **LLM** (e.g. "autonomous LLM coding agents", "companion LLM", "LLM-driven workflows") rather than the generic term "AI".
   
2. **Dual Human & LLM Coordination**:
   - Always frame Esedre as a tool engineered for **both** developers/engineers and autonomous companion LLMs working together in pair-programming workflows, never as a tool exclusively for models.

---

## 13. STRICT PROHIBITION ON EM DASHES (ZERO EXCEPTIONS)

- **ABSOLUTE BAN ON EM DASHES (U+2014 / em dash)**: Never use em dashes anywhere in documentation, code, comments, CLI output, commit messages, or metadata. Use standard hyphens `-`, colons `:`, parentheses `()`, or rewrite sentences naturally without dashes.


