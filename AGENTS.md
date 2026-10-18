# Agent Guidelines & Operating Instructions: Esedre

> **Environment Notice**: `esedre` is managed within **Google Antigravity**. Antigravity discovers and loads skills from `.agents/skills/` and instructions from this `AGENTS.md`. Keep this file under the **24,000-byte (24 KB)** agent rule limit by placing deep-dive subsystem references in `.agents/skills/`.

---

## 1. Project Overview & Scope

- **Repository Role**: Standalone open developer roadmap, ticketing engine, CLI utility (`esedre` / `ese`), web UI, and Model Context Protocol (MCP) server for developers and autonomous LLM coding agents.
- **Primary Mission & Biggest Core Feature**: Providing **long-term grounding to LLM agent context** by maintaining structured, git-backed roadmaps, architectural plans, and verification records across multi-turn sessions, context compactions, and developer handoffs.
- **Data Ecosystem**: Multi-topology project configuration via `.esedre/esedre.json` or `esedre.json` with support for centralized ticket data hubs, in-repo standalone tickets, and federated hybrid topologies.
- **Core Architecture**: Node.js (v20+), TypeScript, ESM (`"type": "module"`), esbuild bundling to `dist/esedre.mjs`, Vite/React UI, and Vitest test runner.

---

## 2. Per-Project Sequential Numbering & Case-Remembering Convention

> **Detailed Reference**: See [esedre_storage_engine](.agents/skills/esedre_storage_engine/SKILL.md) and [esedre_cli_development](.agents/skills/esedre_cli_development/SKILL.md).

1. **Per-Project Numbering Space (Starts at #1)**:
   - Ticket numbers are sequential per project (e.g. `Profe-1..105`, `Esedre-1..69`, `Alce-1..`). Every newly created project begins its tickets at ID `#1`.
2. **Addressing & Formatting Convention**:
   - **Cross-Project & All-Projects View**: `<ProjectCode>-<id>` (e.g. `Prof-35`, `Esedre-1`).
   - **Project-Scoped View**: `#<id>` (e.g. `#35`, `#1`).
   - **CLI & MCP Lookups**: Accept both prefixed keys (`ese get Esedre-1`) and numeric IDs (`ese get 1 --project Esedre` or `ese get 1` when scoped to the active project).
3. **Case-Remembering Casing & Case-Insensitive Matching Invariant**:
   - **Registration & Storage**: Project codes are 1-8 alphanumeric characters (`^[a-zA-Z0-9]{1,8}$`). The original casing provided at registration (e.g. `Personal`, `Esedre`, `Prof`) is canonical and preserved in `projects/<Code>/`, `project.json`, `projects.json`, and `meta.project`.
   - **Lookups & Security**: All lookups, CLI flags, MCP calls, filters, and `allowedProjects` checks are strictly case-insensitive (`personal-1`, `PERSONAL-1`, and `Personal-1` resolve identically).
   - **Cross-Platform Filesystem Normalization**: Storage resolution inspects existing entries in `projects/` case-insensitively and reuses the existing directory name to prevent duplicate directories on Linux ext4/XFS and Docker.

---

## 3. Multi-Topology Storage Resolution & Ingress Hierarchy

> **Detailed Reference**: See [esedre_storage_engine](.agents/skills/esedre_storage_engine/SKILL.md) and [esedre](.agents/skills/esedre/SKILL.md).

`FilesystemStorageAdapter` resolves tickets across 6 supported topologies:
1. **Single Hub**: `dataDir: "../esedre-data"` (`projects/<ProjectCode>/tickets/<id>/` and `project.json`).
2. **In-Repo Standalone**: `.esedre/tickets/<id>/` inside the project repository.
3. **Multi-Hub**: `dataDir: ["../team-hub", "../shared-hub"]`.
4. **Disparate Multi-Repo Federation**: `projects: { "Core": "../core-engine", "Web": "../frontend-app" }`.
5. **Hybrid**: Combines `dataDir` hubs and `projects` federated paths.
6. **Monorepo / In-Workspace Hub**: Auto-discovers `projects/` at `workspaceRoot`, `./data`, or `./.esedre` when `dataDir` is omitted.

**Authoritative Ingress Hierarchy (Zero-Latency Snapshot First)**:
1. **Primary Read-Only Inspection**: Always check `.esedre/snapshot.json` in the workspace root first for zero-latency access to all tickets, summaries, plans, and revision hashes.
2. **Dynamic Lookups & Mutations (MCP)**: Use Esedre MCP tools (`esedre_list_tickets`, `esedre_get_ticket`, `esedre_get_plan`, `esedre_save_plan`, `esedre_create_ticket`, `esedre_update_ticket`, `esedre_claim_ticket`, `esedre_renew_lease`, `esedre_release_ticket`, `esedre_list_leases`, `esedre_link_ticket`, `esedre_unlink_ticket`, `esedre_list_milestones`, `esedre_get_milestone`, `esedre_create_milestone`, `esedre_update_milestone`, `esedre_add_comment`) when MCP is active.
3. **CLI Ingress**: Use `.esedre/ese` or global `ese` (`get`, `list`, `plan`, `update`, `comment`, `create`, `lease`, `link`, `unlink`, `milestone`, `snapshot`, `refresh`).
4. **Storage Boundary**: Backing hubs (`esedre-data`) are managed strictly through the snapshot projection, MCP tools, or `ese` CLI.

---

## 4. STRICT BAN ON YAML FOR CONFIGURATION & DATA (ZERO EXCEPTIONS)

- **ABSOLUTE BAN ON YAML FOR DATA & SETTINGS**: All configuration files, settings, project descriptors, manifests, tickets, metadata, plans, and comments MUST strictly use JSON or Markdown (`esedre.json`, `projects.json`, `meta.json`, `comments.json`, `detail.md`).
- **Config Discovery**: Strictly named `esedre.json` (never `esedre.yml` or `esedre.yaml`).
- **Cloudflare Tunnel Exception**: Only `tools/tunnel/config.yml` for the `cloudflared` binary is exempt.

---

## 5. Git Execution Rules

> **Detailed Reference**: See [git_branching_and_release_workflow](.agents/skills/git_branching_and_release_workflow/SKILL.md).

1. **Use `--no-pager` for Git Commands**: Always pass `--no-pager` (or `-c core.pager=cat`) to `git diff`, `git log`, etc.
2. **Explicit Authorization Required for Commit and Push (Zero Exceptions)**:
   - **NEVER** perform `git add`, `git commit`, or `git push` without direct, explicit instructions from the user in that specific turn.
   - Zero turn-to-turn carryover for commit or push authorization.
3. **Git Branching Strategy (`release/upcoming`) & Ticket Child Branches**:
   - `release/upcoming` is the central integration and staging branch.
   - Always create and switch to a dedicated child branch off `release/upcoming` (`ticket/<ProjectCode>-<id>-<slug>`, `feature/<ticketId>-<slug>`, or `fix/<ticketId>-<slug>`) before making code modifications or commits. Never work or commit directly on `main` or `release/upcoming`.
   - Once verified (`npm test`, `npm run build`, `npm run lint`) and approved by the user, merge the child branch back into `release/upcoming`.
   - Production releases promote from `release/upcoming` into `main` exclusively via Pull Requests with clean human titles (e.g. `v0.4.0: Support File and Detail in Ticket Updates (#49)`), followed by merging `main` back into `release/upcoming`.
4. **Clean Human Commit Message Standards (`[#<ticket>] <Action Summary>`)**:
   - **Strict Ban on Conventional Commit Prefixes**: `feat:`, `fix:`, `chore:`, `refactor:`, etc. are strictly prohibited in commit messages and PR titles.
   - **Ticket Anchor Format**: `[#<id>] <Imperative Action Summary>` (e.g. `[#49] Support file and detail specification updates in CLI and MCP`) or `[#<ProjectCode>-<id>] <Imperative Action Summary>`.
   - **Non-Ticket Commits**: Use `[Docs]`, `[Infra]`, or `[Release]` followed by an imperative summary.
   - **Style**: Always use imperative present tense (`Support`, `Add`, `Fix`, `Refactor`, `Update`) and zero em dashes.
5. **Mandatory Scope Clarification in Multi-Project Workspaces**:
   - If there is any ambiguity regarding which repositories or files are intended to be committed or pushed across `esedre`, `esedre-data`, or `esedre-web`, ask the user for explicit clarification first.
6. **Mandatory Documentation Currency Pre-Flight Check (Zero Stale Docs)**:
   - Whenever the user mentions commit, push, or package publishing, halt and verify `README.md`, `AGENTS.md`, and `.agents/skills/`. If any documentation is stale or missing new commands/flags/invariants, **HALT** and **WARN** the user with suggested fixes before staging or committing.

---

## 6. Multi-Project Agent Isolation & Two-Tier Configuration

> **Detailed Reference**: See [esedre_security_and_allowlist](.agents/skills/esedre_security_and_allowlist/SKILL.md).

1. **Two-Tier Configuration Hierarchy**:
   - **Central Global Config (`~/.esedre/config.json`)**: Portfolio hubs (`dataDir`), linked repositories (`projects`), and default port (`5674`), managed via `ese configure`.
   - **Workspace Local Config (`.esedre/esedre.json`)**: Local `projectCode` and `allowedProjects`, initialized via `ese init`.
   - **Smart `dataDir` Hoisting**: When `dataDir` is omitted locally, the loader checks whether `~/.esedre/config.json`'s `dataDir` contains the workspace's project (`hubContainsProject`) before inheriting it, keeping machine paths out of repo configs while preserving standalone in-repo projects.
2. **Configuration & Upgrade Commands**:
   - `ese init [path]`: Initializes a workspace, data hub (`--hub`), or hub project (`--project <Code> [--name <Name>] [--hub <hub>]`).
   - `ese configure`: Manages `~/.esedre/config.json` (`add`, `remove`, `set`).
   - `ese upgrade [<path>] [-p|--project <Code>] [--all|-a] [--force|-f]`: Upgrades workspace config schema, project storage schema versions (`schemaVersion` / `esedreVersion` with pre-migration backups in `~/.esedre/backups/`), wrappers, MCP config, and `.agents/skills/esedre/SKILL.md` (with warnings if `AGENTS.md` or `GEMINI.md` exceeds 24,000 bytes).
   - `ese rename-project <oldCode> <newCode> [--name "<name>"]` and `ese project set <code> [--name "<name>"]`.
3. **Multi-Project Agent Isolation (`allowedProjects`)**:
   - Agents are strictly scoped to projects in `.esedre/esedre.json`'s `allowedProjects` (or `"*"` for umbrella workspaces).
   - Unauthorized requests throw `EsedreAuthorizationError` immediately (MCP `-32603`, CLI exit `1`, REST `403 Forbidden`).
4. **Approved Terminology**: Strictly use **"Agent Project Allow-List"** or **"Multi-Project Agent Isolation"**. Never use the word "Firewall".

---

## 7. Build, Testing & Quality Standards

> **Detailed Reference**: See [esedre_testing_and_verification](.agents/skills/esedre_testing_and_verification/SKILL.md).

1. **Mandatory Build & Test Verification (Zero Exceptions)**:
   - **SUPER DAMN REQUIRED**: Always run `npm test` and `npm run build` (`npm run lint` + `npm run build:ui` + `npm run build:cli`) any time you modify code or configuration. Confirm zero TypeScript, lint, or test errors.
2. **Assertion Integrity & Root Cause Analysis**:
   - **Zero Silent Test Weakening**: Never weaken, delete, or relax unit test assertions to force a pass.
   - **Root Cause Analysis**: Diagnose bugs at their architectural source; never apply superficial band-aids or regex hacks.
   - Write Vitest unit tests in `tests/` for all black-boxable domain, storage, config, CLI, and MCP logic.
3. **Strict Ban on Autonomous Browser / UI Testing**:
   - **STRICTLY GET OUT OF THE UI UNLESS DIRECTED**: Never launch browser subagents, Chrome DevTools MCP sessions, or open browser URLs unless the user explicitly commands you to do so in that specific turn.
4. **Local Dev & Cloudflare Tunnel Workflows**:
   - `npm run dev` (local Vite on port 5674), `npm run net` (IP-whitelisted Cloudflare tunnel), `npm run net:all` (open tunnel).
   - `tools/tunnel/config.yml` is gitignored (`tools/tunnel/config.yml.example` is the template). In `cloudflared`, `--config` must precede `tunnel run`. All dev tunnel responses enforce `X-Robots-Tag: noindex, nofollow` and `robots.txt` `Disallow: /`.
5. **Smart Release & Package Publishing (`npm run pub`)**:
   - Always use `npm run pub` (which checks `npm whoami` and published registry versions before building).
   - **Strict Agent Invariant**: Agents are **STRICTLY FORBIDDEN** from running live `npm run pub` or `npm publish`; agents may ONLY run `npm run pub -- --dry-run` and must check `npm view esedre versions --json` first to prevent version collisions (`E403`).
   - Keep `version` synchronized across `package.json`, `package-lock.json`, and `src/types.ts` (`CURRENT_ESEDRE_VERSION`).
6. **File Editing & Formatting Hygiene**:
   - Strictly use first-class tools (`replace_file_content`, `write_to_file`, `view_file`) instead of ad-hoc one-liner scripts for normal edits.
   - Never use `view_file` on protected `.git/*` paths; run single, unchained shell commands so prefix allowlists work cleanly.
   - Every file must end with a single trailing newline (`\n`).

---

## 8. Daemon Lifecycle, Schema, Linking, UI & Wrapper Invariants

> **Detailed Reference**:
> - Daemon, Gateway & Embedded Theme Contract: [esedre_daemon_and_gateway](.agents/skills/esedre_daemon_and_gateway/SKILL.md)
> - Storage Schema, Milestones, Linking & Leases: [esedre_storage_engine](.agents/skills/esedre_storage_engine/SKILL.md)
> - CLI Flags, Commands & Windows Wrappers: [esedre_cli_development](.agents/skills/esedre_cli_development/SKILL.md)
> - MCP Server & JSON-RPC Tools: [esedre_mcp_development](.agents/skills/esedre_mcp_development/SKILL.md)

1. **Daemon & Gateway (`ese start | stop | status | logs`)**:
   - Unified gateway on port `5674` routes `/app` to Web UI (`5675`) and `/api` to REST API (`5676`) with unconstrained portfolio storage and a 3s config reload TTL.
   - On Windows, parent processes must call `fs.closeSync(outFd)` and `fs.closeSync(errFd)` immediately after `child.unref()`, and liveness checks must verify both `GET /api/ping` and PID liveness.
2. **Schema, Milestones & Cross-Project Linking**:
   - Always use `type` (`Feature`, `Platform`, `Tools`, `Idea`, `Bug`); legacy `category` is deprecated. Optional `priority` supports `Critical`, `High`, `Medium`, `Low` (or `none` to clear).
   - Milestones (`milestones.json`) support optional umbrella `featureFlag` inheritance (`meta.inheritedFeatureFlag`).
   - Bi-directional ticket links (`relates-to`, `blocks`/`blocked-by`, `parent-of`/`child-of`, `duplicates`/`duplicated-by`) enforce cycle detection, project `isBlocked: true` when blocked by uncompleted tickets, and redact restricted cross-project targets.
3. **Compound IDs, Hydration & Embedded Theme Contract**:
   - Portfolio views use compound keys `${projectCode}-${ticketNumber}` and DOM anchors `id="feature-card-${projectCode}-${number}"`. Initial hydration fetches consolidated state via `/api/planning/all` (no N+1 client waterfalls).
   - `<PlannedWorkView />` includes a zero-effort CSS fallback bridge (`ESEDRE_THEME_FALLBACK_CSS`) and inherits any of the 12 core CSS custom properties (`--bg-surface`, `--text-primary`, `--accent-primary`, etc.) from host apps.
4. **Windows CMD & PowerShell Wrappers**:
   - `ese.cmd` / `esedre.cmd` must dispatch via `call :run %*` and `goto :eof` without `:done` labels. `ese.ps1` / `esedre.ps1` must enforce UTF-8 console encodings at startup.
5. **Ticket Leases (`ese lease`)**:
   - Ephemeral ticket leases (`projects/<Code>/tickets/<id>/lease.json`) provide TTL-backed mutual exclusion across concurrent agent sessions, subagents, CLI workflows, and remote machines without overwriting durable `meta.assignee`.
   - CLI: `ese lease [claim|release|renew|list]` (and top-level aliases `ese claim|release|renew|leases`). MCP: `esedre_claim_ticket`, `esedre_renew_lease`, `esedre_release_ticket`, `esedre_list_leases`.
6. **Storage Migration & Multi-Version Compatibility Engine (`src/migrations/`)**:
   - `project.json` and ticket `meta.json` stamp `schemaVersion` (`CURRENT_DATA_VERSION`) and `esedreVersion` (`CURRENT_ESEDRE_VERSION`).
   - Normal read/write operations never silently auto-migrate older projects across multi-owner hubs; mutations enforce `assertProjectCompatible` (`EsedreVersionError`: `BELOW_MIN_SUPPORTED`, `ABOVE_CURRENT_ENGINE`, `FEATURE_REQUIRES_UPGRADE`, MCP `-32002`, REST `409`).
   - Explicit schema migrations run via `ese upgrade`, `ese upgrade --project <Code>`, or `ese upgrade --all` after creating an atomic timestamped backup in `~/.esedre/backups/`.

---

## 9. Terminology, Grounding & Planning Invariants

1. **Strict "LLM" over "AI" & Ban on "LLM Companion"**:
   - Always use **LLM** (never "AI"). Frame Esedre for **both** human developers and autonomous LLM agents.
   - The phrase **"LLM Companion"** (and "companion LLM/agent") is **STRICTLY BANNED**; use **"LLM Agent"** or **"LLM Coding Partner"**.
2. **STRICT PROHIBITION ON EM DASHES (ZERO EXCEPTIONS)**:
   - **ABSOLUTE BAN ON EM DASHES (U+2014)**: Never use em dashes anywhere in documentation, code, comments, CLI output, commit messages, or metadata. Use hyphens `-`, colons `:`, or parentheses `()`.
3. **Long-Term Grounding & Pre-Edit Backup Invariant**:
   - User-maintained guidelines (`AGENTS.md`, `CLAUDE.md`) are the authoritative source of truth; `.esedre/snapshot.json` projects mission and stack grounding for instant post-compaction recovery.
   - Any automated repair/mutation utility (`ese doctor`, `ese fix`) must create an atomic timestamped backup before modifying files on disk.
4. **Planning Mode & Workspace-Relative Paths**:
   - When in Planning Mode or asked "Ideas?" / "What do you think?", never modify code until the user gives explicit approval.
   - Never hardcode machine-specific absolute paths (`C:\Users\...` or `file:///...`) in repository documentation, comments, or commit messages.

---

## 10. Esedre Dogfooding & Bootstrapping Mandate

<!-- ESEDRE_DOGFOODING_START -->
1. **Self-Bootstrapping Engine Mandate**:
   - You are working directly inside the source engine repository of Esedre. All roadmap management, task tracking, plan authoring, lease claims, and verification records for this repository MUST strictly dogfood Esedre itself.
   - **Crucially, PREFER MCP tools (`esedre_*`) over CLI execution whenever MCP is available in the session**, using the in-repo CLI wrapper (`.esedre/ese`) purely as a secondary fallback.
2. **In-Tree Build Freshness Invariant**:
   - In this repository, the CLI wrapper (`.esedre/ese`) executes compiled artifacts in `dist/esedre.mjs`.
   - When dogfooding or testing in-tree CLI changes, always compile via `npm run build:cli` (or `npm run build`) first so the toolchain exercises active source modifications rather than stale bundled artifacts.
3. **Immediate Root-Cause Escalation & In-Source Repair**:
   - Whenever you encounter any friction, bug, formatting limitation, concurrency quirk, missing CLI flag/option/tool, or output anomaly in Esedre, prominently and explicitly surface it to the developer, diagnose the architectural root cause, and propose a source fix or mint an official roadmap ticket.
   - If an issue is raised and unacknowledged, persistently follow up in subsequent turns until confirmed. Never let an internal defect or friction point slip by unaddressed.
<!-- ESEDRE_DOGFOODING_END -->

