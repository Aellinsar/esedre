# Changelog

All notable changes to Esedre are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-10-02

### Added
- **Completed Full Set of Edit Capabilities in the UI & Interactive Planning Engine**:
  - **Open Decisions & Questions Answering**: Completed planned UI editing and persistence for developer answers to Open Decisions and Questions directly into ticket storage (`answers.json`), with real-time hydration across `/api/planning/answers` and `/api/planning/all`.
  - **Live Specification Detail Editing**: Completed planned real-time editing of ticket Markdown specifications in the UI via `POST /api/planning/details`, with direct sync to `detail.md` on disk, automatic timestamp tracking, and revision bumping.
  - **Interactive Inline Text Annotations**: Completed planned text selection commentary in the UI via `POST /api/planning/save-inline-comment` and `GET /api/planning/inline-comments`, persisting highlighted annotations to `inline-comments.json`.
  - **Discussion Media Attachments Pipeline**: Completed planned drag-and-drop and clipboard paste media attachment uploading and streaming via `POST /api/planning/upload-attachment` and `GET /api/planning/attachment`, with path traversal protections, deduplication guards, and automatic MIME detection.
  - **Local Draft Recovery**: Added automatic browser draft caching in `localStorage` (`dev_planner_question_drafts`) for developer question replies, ensuring in-progress answers are never lost during accidental reloads or tab navigation.
  - **CLI Answer Visibility**: Enhanced `ese get` output to automatically display recorded answers beneath their corresponding Open Decisions & Questions.
  - **Smart Data Hub Inheritance**: Enabled workspace configuration (`.esedre/esedre.json`) to omit `dataDir` and seamlessly inherit from user-level global configuration (`~/.esedre/config.json`) when the hub contains the project.
  - **Multi-Workspace Batch Upgrade Automation (`ese upgrade --all`)**: Extended `ese upgrade` with `--all` (`-a`) to automatically scan all registered workspace projects declared in `~/.esedre/config.json`, upgrade shell wrappers (`.esedre/esedre.cmd`, `.esedre/ese.cmd`, `.esedre/esedre.ps1`, `.esedre/ese.ps1`), synchronize agent skills, and regenerate `.esedre/snapshot.json` projections.
  - **Wrapper Health Diagnostics**: Added `isWrapperOutdated` and `findOutdatedWrappers` in `src/upgrade.ts` to detect legacy CMD wrappers containing parenthesized compound blocks or `goto :done`. Exposed non-blocking diagnostic notices in `ese status` and `ese status --json`.

### Fixed
- **Windows CMD Batch Label Error in Consuming Workspaces**: Hardened `WRAPPER_CMD` subroutine dispatch and eliminated legacy parenthesized `goto :done` blocks in downstream consuming repositories that caused `cmd.exe` to fail with `'The system cannot find the batch label specified - done'` (Ticket #43).
- **Root URL Hash Push Bug**: Fixed bug where navigating to the root standalone UI URL (`http://localhost:5674/`) automatically forced and pushed `#ticket-1` to the browser address bar. The UI now preserves clean root URLs without pushing ticket hashes unless a ticket is explicitly clicked or deep-linked.

### Security & Hardening
- **REST Endpoint Parameter Validation & Cache Invalidation**:
  - Added strict parameter checks on mutating planning endpoints (`ticketId` required on plans, comments, details, meta updates, and flags).
  - Wired real-time API cache invalidation across all mutating endpoints to ensure `/api/planning/all` never returns stale projections.
  - Hardened attachment endpoints against path traversal attacks (`..`, `.`, subpaths) and directory reads, verifying regular file integrity.
  - Enforced Agent Project Allow-List authorization across all attachment lookups and new storage endpoints.

## [1.0.1] - 2026-09-28

### Added
- **Public Open-Source Readiness & Repository Sanitization**:
  - Decoupled and gitignored local development tunnel credentials and endpoint configurations (`tools/tunnel/config.yml`), providing `tools/tunnel/config.yml.example` reference template for public contributors.
  - Dynamically resolve Vite allowed hostnames (`resolveAllowedHosts`) from local tunnel configurations and `ESEDRE_ALLOWED_HOSTS` environment variable, eliminating hardcoded domains.
  - Dynamically resolve development build artifact bridge destinations (`scripts/bridge.js`) via local gitignored `.bridge-dest` file or `ESEDRE_BRIDGE_DEST` environment variable.
  - Genericized documentation, agent skills, and built-in skill templates (`AGENTS.md`, `esedre_storage_engine`, `src/upgrade.ts`) to eliminate proprietary repository paths and internal domain references.

## [1.0.0] - 2026-09-27

### Added
- **Cross-Project Milestones & Deliverables Tracking**:
  - Support cross-project milestone grouping allowing tickets across multiple projects to be associated with a unified milestone deliverable.
  - Compound milestone selector syntax (`ProjectCode:MilestoneTitle` or `ProjectCode:MilestoneId`) for precise cross-project targeting and filtering.
  - Embedded view and allow-list isolation: Out-of-scope tickets in a milestone render as masked placeholders when viewed in embedded host applications or restricted agent scopes.
  - Dedicated CLI commands: `ese milestone list`, `ese milestone get`, `ese milestone create`, `ese milestone update`, `ese milestone delete`.
  - Dedicated MCP tools: `esedre_list_milestones`, `esedre_get_milestone`, `esedre_create_milestone`, `esedre_update_milestone`.
  - Web UI: Milestones view with real-time completion progress bars, umbrella feature flag status, and assigned ticket chips.
- **Cross-Project Ticket Linking & Dependencies**:
  - Support bi-directional linked issues across tickets in the same project or across different projects (e.g. `Profe-136` relates to `Lab151-1`).
  - Standard relations with inverse pairs: `relates-to` <-> `relates-to` (symmetric), `blocks` <-> `blocked-by` (inverse), `parent-of` <-> `child-of` (inverse), and `duplicates` <-> `duplicated-by` (inverse).
  - Cycle detection preventing circular dependencies on `blocks` and `parent-of` trees.
  - Automatic blocker detection (`isBlocked: true`) on tickets with uncompleted blockers.
  - Agent Project Allow-List isolation: Redacts target metadata to `[Restricted Project]` when target project is outside `allowedProjects`.
  - CLI commands: `ese link <sourceId> <relation> <targetId>` and `ese unlink <sourceId> <targetId>`, plus `--blocked` and `--linked-to <ticketKey>` query filters for `ese list`.
  - MCP tools: `esedre_link_ticket` and `esedre_unlink_ticket`, with `isBlocked` and `linkedTo` filter arguments on `esedre_list_tickets`.
  - Web UI: Standalone `LinkTicketModal`, Sub-tab 5: "Links" with relation badges and unlink actions, and `Blocked` warning pill in ticket headers.
- **Project Settings & Code Rename Engine**:
  - CLI commands: `ese rename-project <oldCode> <newCode> [--name "<name>"]` and `ese project set <code> [--name "<name>"]`.
  - Web UI: Project settings modal supporting live display name and code updates with automatic link and ticket migration.
- **Table of Contents Alignment & Layout Stability**:
  - Web UI: Fixed-width ticket numbering eliminating zig-zag alignment in All Projects view, expanded title area, and static Type and Status pills at the far right.

### Fixed
- **Windows CMD Batch Label Search Bug (`ese.cmd` / `esedre.cmd`)**:
  - Refactored `WRAPPER_CMD` to dispatch through a `:run` subroutine and return via `goto :eof`, eliminating user-defined `:done` labels entirely.
  - Resolved `cmd.exe` error `'The system cannot find the batch label specified - done'` caused when nested `call` invocations corrupted parent label search contexts.
  - Added direct in-repo (`..\dist\esedre.mjs`) and local `node_modules` detection to invoke Node directly without batch hopping.

### Security
- **API Server Hardening**:
  - Added 10MB payload ceiling to `readJsonBody` to prevent runaway memory allocation.
  - Added `x-esedre-allowed-projects` to CORS preflight `Access-Control-Allow-Headers` response for cross-origin browser requests.
  - Cleaned developer machine paths from staging tunnel configurations.

## [0.1.12] - 2026-09-26

### Fixed
- **UTF-8 En-Dash Mojibake Normalization**: Added `normalizeDashesAndMojibake` and `normalizeTicketFields` to transparently sanitize Windows-1252 mojibake (`â€“`), double-encoded UTF-8, and non-ASCII Unicode dashes (`\u2013`, `\u2014`, `\u2015`, `\u2012`, `\u2212`) into clean standard ASCII hyphens (`-`) across CLI tables, JSON projections, storage reads, and ticket mutations.

## [0.1.11] - 2026-09-26

### Fixed
- **Prevent Project Query Leak in Embedded Mode**: Guarded `window.history.replaceState` behind `!isEmbedded` in `PlannedWorkView` when switching project filters, added an explicit `isEmbedded` prop to `PlannedWorkViewProps`, and introduced `detectIsEmbedded` and `updateProjectUrlSearchParam` helpers to ensure embedded planners never mutate the host window's URL search parameters.
- **Published Version Collision Guard**: Added upfront registry version pre-check to `scripts/publish.js` to immediately detect and reject attempts to republish already-published versions before running the full build/test lifecycle.

## [0.1.10] - 2026-09-26

### Added
- **Single-Step Ticket Creation (`--detail` & `--file`)**: `ese create` accepts `--detail "<md>"` and `--file <path>` to populate `detail.md` specifications during ticket creation without requiring a secondary `ese plan` call.
- **MCP `esedre_create_ticket` Specification Markdown**: Added optional `detail` parameter to the MCP create tool for agents to mint tickets with full specifications in a single turn.
- **`ese refresh` CLI Alias**: Added `refresh` as a direct alias for `ese snapshot` to regenerate the `.esedre/snapshot.json` projection.

### Fixed
- **Windows CMD Batch Label Syntax Error**: Refactored `WRAPPER_CMD` (`ese.cmd` / `esedre.cmd`) to eliminate parenthesized `if (...)` blocks around `goto` statements, converted jump points to top-level labels, and prefixed all batch script invocations with `call` to prevent `'The system cannot find the batch label specified - done'` crashes on Windows.
- **PowerShell Console Stream UTF-8 Encoding**: Enforced `[Console]::OutputEncoding`, `[Console]::InputEncoding`, and `$OutputEncoding = UTF-8` in `ese.ps1` to prevent Unicode characters (en-dashes, quotes) from rendering as mojibake.
- **Structured JSON Output for `ese plan --json`**: Corrected `ese plan <id> --json` to emit a machine-readable JSON payload (`{ success, ticketId, project, planMarkdown, sha1 }`) instead of ANSI terminal text.

## [0.1.9] - 2026-09-25

### Added
- **Smart npm Publish Lifecycle Wrapper (`npm run pub`)**: Upfront authentication pre-check (`npm whoami`) with automatic interactive login before compilation, executing full prepublish test/lint/build lifecycle.
- **Multi-Layer Zero-Crawl Protection**: Edge and Vite middleware security preventing search spiders and AI crawler cataloging on development Cloudflare tunnels.
- **Canonical Apex Ecosystem Links**: Standardized all portfolio ecosystem references to canonical apex `https://arwam.com`.

## [0.1.8] - 2026-09-11

### Added
- **Dynamic Configuration & Manifest Reloading**: 3-second TTL polling (`ensureFreshConfig`) reloading external hubs and manifests in real time without daemon restarts.

### Changed
- **Gateway Server Portfolio Decoupling**: Background daemon and gateway cluster (`ese start`) serve unconstrained portfolio views across all registered data hubs regardless of which workspace directory the server was launched from.
- **Slug Normalization**: Removed redundant `slug` field from `ProjectDescriptor`, manifests, and storage adapters in favor of canonical case-remembering `code`.

## [0.1.7] - 2026-09-11

### Added
- **Case-Remembering Project Resolution**: Preserves canonical casing for project codes up to 8 characters on disk and manifests while supporting case-insensitive lookups across CLI, MCP, and REST endpoints.
- **Workspaceless & Multi-Hub Project Init**: `ese init --project <Code> [--hub <name|path>]` creates projects directly in configured hubs without overwriting existing workspace configurations.

## [0.1.6] - 2026-09-10

### Added
- **Multi-Manifest Detection in `ese init`**: Auto-detects project codes and names from `Cargo.toml`, `pyproject.toml`, `settings.gradle.kts`, `app/build.gradle.kts`, and `go.mod`.
- **Global Port Settings**: Centralized port configuration in `~/.esedre/config.json` with CLI overrides and workspace inheritance.
- **Agent Project Allow-List Isolation**: Multi-tenant workspace scoping strictly limiting CLI and MCP access to declared `allowedProjects`.

## [0.1.5] - 2026-09-09

### Added
- **Interactive Web UI Assets & Previews**: Standalone React 19 web dashboard assets, dark and light preview cards, and documentation guides.

## [0.1.4] - 2026-09-08

### Added
- **MPL-2.0 License Transition**: Open source licensing under Mozilla Public License 2.0.
- **LLM Agent Long-Term Grounding Mission**: Formalized ground-truth architecture providing persistent context across compaction events.

## [0.1.1] - 2026-09-08

### Added
- **Project Onboarding & Configuration Tools**: Initial interactive setup via `ese configure` and `ese init`.

## [0.1.0] - 2026-09-08

### Added
- Initial release of the Esedre ticketing engine, CLI (`ese` / `esedre`), background daemon, and Model Context Protocol (MCP) server.
