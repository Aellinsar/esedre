# 🏛️ Esedre (`/eh-ˈseh-dreh/`)

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/esedre/docs/assets/esedre-hero.png" alt="Esedre: The Classical Council Forum for Developers & LLM Agents" width="100%" />
</p>

> **The open developer roadmap and ticketing engine engineered to provide long-term grounding for LLM agent context, powered by a fast CLI, local Web UI, and Model Context Protocol (MCP) server.**

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-100%25%20Passing-emerald.svg)](tests/)
[![Website: arwam.com](https://img.shields.io/badge/Website-arwam.com-cyan.svg)](https://arwam.com)

---

## 🌟 Overview

**Esedre** (with short CLI alias **`ese`**) is an open-source developer planning engine backed by plain text files (Markdown & JSON) that are easily version-controlled in git. Designed from the ground up for software engineers and autonomous LLM coding agents (such as Google Antigravity, Claude Code, and Cursor) to coordinate together, Esedre solves the single biggest bottleneck in LLM-assisted development: **agent context drift and session amnesia**.

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/esedre/docs/assets/esedre-dashboard-light.png" alt="Esedre Web Dashboard (Light Theme)" width="100%" />
</p>

### ⚓ Core Pillar: Long-Term Grounding for LLM Agent Context

LLM coding agents possess extraordinary implementation speed, but face a fundamental architectural ceiling: **context windows fill up, compact, and reset between turns and sessions**. External issue trackers live in distant web silos that agents cannot inspect reliably or locally without API keys and network overhead. Over multi-turn pair programming sessions, models lose track of architectural intent, past verification history, and upcoming milestones.

**Esedre's core feature is providing persistent, authoritative long-term grounding to LLM agent context:**

* **Git-Backed Ground Truth**: Tickets, feature breakdowns, architecture plans, and verification comments reside right alongside source code in git. They branch, merge, and stay synchronized with the codebase.
* **First-Class MCP Integration**: Through the official Model Context Protocol, LLM agents query roadmap priorities (`esedre_list_tickets`), inspect deep specifications (`esedre_get_ticket`), and update plans (`esedre_save_plan`) in real time.
* **Cross-Session Memory & Grounding**: When an LLM agent begins a new turn, recovers from a context compaction, or transitions across developer handoffs, Esedre grounds the model to concrete technical specifications, constraints, and upcoming milestones: preventing drift and hallucinated direction.
* **Optimistic Concurrency Protection**: Multi-agent pair-programming remains safe through SHA-1 content hash versioning, ensuring concurrent agents or developers never silently overwrite each other's work.

### ⚡ Key Capabilities

1. **Long-Term LLM Agent Grounding**: The primary architectural foundation: anchoring LLM agents to persistent project memory, architectural plans, and git-backed roadmap milestones across multi-turn sessions and context compactions.
2. **CLI Commands (`esedre` / `ese`)**: List, query, plan, create, and update tickets via simple terminal commands with human-readable colored tables or machine-readable `--json` output.
3. **Model Context Protocol (MCP) Server**: Full JSON-RPC 2.0 stdio server implementing the official MCP specification (`2024-11-05`), exposing roadmap tickets as first-class tools and URI resources.
4. **Agent Project Allow-List (Multi-Project Isolation)**: Informs each LLM agent only of the projects it is authorized to access, keeping unrelated project tickets, specifications, and plans completely isolated.
5. **Optimistic Concurrency Control**: SHA-1 content hashing on all tickets and plans, preventing concurrent agents or humans from clobbering each other's edits.
6. **Local Web Dashboard & Embeddable Component**: Run a visual dashboard with `ese start` to manage tickets in your browser, or embed `<esedre-planner>` into any web app without adding UI framework dependencies to your project.

---

## 🏛️ About the Name

### Origin

**Esedre** derives from classical Latin *exedra* (plural *esedre*), the semicircular architectural council pavilions where ancient architects, master builders, and planners gathered to debate designs, draft blueprints, and coordinate construction. That classical forum mirrors Esedre's mission: a structured, open workspace where developers and LLM coding partners collaborate to scope work, align on plans, and ship software.

### Pronunciation Guide

Esedre is pronounced **`eh-SEH-dreh`** (phonetically: **`/ɛˈsɛ.drɛ/`**).

* Short CLI alias: **`ese`** (pronounced **`/ˈɛ.sɛ/`**).

---

## 🚀 Quick Start

### 1. Installation

```bash
# Global CLI installation (recommended)
npm install -g esedre

# Or run instantly without global installation via npx
npx esedre init
```

### 2. Initialize Your Project

Run `ese init` inside any project repository. It automatically configures `.esedre/esedre.json`, plants in-repo shell wrappers (`.esedre/ese`), configures MCP for LLM agents, and generates your initial snapshot:

```bash
ese init

# Or non-interactive with custom project code and display name:
ese init --project MYAPP --name "My App" -y
```

### 3. Start the Web UI & Server

```bash
# Start background server daemon on port 5674
ese start

# Open dashboard: http://localhost:5674/app
```

The server launches with unconstrained portfolio visibility across all registered data hubs and projects, allowing the main Esedre Web UI (as opposed to embedded component and LLM agent project-scoped behavior) to manage them seamlessly. Incoming agent requests enforce project scoping dynamically via the `x-esedre-allowed-projects` header or `?allowedProjects=...` query parameter.

### 4. Create Your First Ticket

```bash
ese create --title "Build authentication flow" --type Feature
ese list
ese get 1
```

> **Multi-Project Tip**: Passing `"allowedProjects": ["*"]` in `.esedre/esedre.json` authorizes access to all registered projects in the workspace.

---

## 💻 CLI Commands

Both `esedre` and `ese` can be used interchangeably. Commands are structured into semantic categories:

### Roadmap Commands (Pair Programming & LLM Agents)

Core day-to-day workflow commands for scoping, viewing, planning, and verifying tickets:

| Command | Usage | Description |
|---|---|---|
| `list` | `ese list [-p\|--project <code\|all>] [-s\|--status <status>] [-t\|--type <type>] [--json]` | List roadmap tickets with optional filters. Defaults to the active project. |
| `get` | `ese get <id> [--json]` | View ticket specifications, feature breakdown, comments, and SHA-1 hash. |
| `plan` | `ese plan <id> [--set "<markdown>"] [--file <path>] [--last-hash <h>]` | Read or update the active implementation plan markdown. |
| `create` | `ese create --title "..." [-p\|--project <code>] [-t\|--type <type>] [--detail "<md>"] [--file <path>]` | Create a new ticket with auto-sequential ID and optional specification markdown. Title strictly capped at 48 chars. |
| `update` | `ese update <id> [-s\|--status <status>] [-t\|--type <type>] [--title "..."] [--last-hash <h>]` | Update ticket status, type, or title with optimistic concurrency protection. |
| `comment` | `ese comment <id> ["<text>"] [--text "..."] [--author "..."]` | Append a developer or LLM agent note to ticket history. |
| `snapshot`, `refresh` | `ese snapshot [--project <code>] [--json]` | Generate or refresh projection `.esedre/snapshot.json` for zero-latency agent context. |
| `projects` | `ese projects [--json]` | List registered projects within authorized scope. |

### Service Daemon Commands

Manage the local web dashboard and API server:

| Command | Usage | Description |
|---|---|---|
| `start` | `ese start [--port <n>] [--foreground \| -f]` | Start the Esedre background server daemon (or foreground with `-f`). |
| `stop` | `ese stop [--port <n>]` | Stop the running Esedre background server daemon. |
| `status` | `ese status [--port <n>]` | Check health, uptime, and diagnostics of the running server. |
| `logs` | `ese logs [--port <n>] [--lines <n>]` | Tail recent server output logs. |
| `mcp` | `ese mcp` | Launch the Model Context Protocol stdio server for LLM agents. |

### Developer Administration (Human Machine Setup)

Commands for repository onboarding, central machine linking, and maintenance:

| Command | Usage | Description |
|---|---|---|
| `init` | `ese init [<path>] [--project <code>] [--name <name>] [--hub <name\|path>] [-y]` | Bring a project repository online, bootstrap a dedicated data hub (`--hub`), or create a project directly in a data hub (`--project <code>`). |
| `configure` | `ese configure [add <path> \| remove <code\|path> \| set <k> <v>]` | Inspect or mutate central configuration (`~/.esedre/config.json`). Link external project repositories or data hubs. |
| `upgrade` | `ese upgrade [<path>] [--force \| -f]` | Upgrade workspace configuration schema, in-repo wrappers, and agent skills. |

> **Human vs LLM Agent Workflows**: Developer Administration commands (`init`, `configure`, `upgrade`) manage system-level repository linking and central machine configuration. They are intended for human developers during initial setup. Autonomous LLM coding partners operate within the authorized workspace scope using Roadmap and Service Daemon commands (`list`, `get`, `plan`, `create`, `update`, `comment`, `snapshot`, `start`, `status`).

#### Linking External Repositories vs Data Hub Projects

Esedre cleanly separates external repository linking from centralized data hub projects:
* **Link Existing Repositories (`ese configure add <repoPath>`)**: Registers an external code repository in your central `projects` map (`~/.esedre/config.json`) for federated multi-repo workflows.
* **Create Data Hub Projects (`ese init --project <code> [--name "<name>"] [--hub <hub>]`)**: Registers a non-development or standalone project directly inside your configured ticket data hub (`dataDir`). When multiple data hubs exist, pass `--hub <name|path>` to disambiguate.

#### Unique Project Codes Across Data Hubs

Project codes must be unique across all configured data hubs. Esedre does not support duplicate project codes across data hubs. If duplicate project codes are detected across multiple hubs:
* The storage engine loads only the first registered location.
* The CLI issues a warning notifying you of the collision (`⚠️ Warning: Duplicate project code '<CODE>' detected across multiple data hubs...`).
* Registering a new project that matches a code already present in another hub is rejected.

#### Case-Remembering Casing & Case-Insensitive Matching

Esedre follows a strict **case-remembering but case-insensitive on matches** design across all storage, CLI, MCP, and configuration layers:
* **Case-Remembering Storage**: Project codes preserve their original registered casing (e.g. `Personal`, `Esedre`, `Prof`) in directory names on disk (`projects/Personal/`) and in all metadata manifests (`project.json`, `meta.json`). Ticket metadata always records the canonical remembered casing. Re-registering or re-configuring a project preserves the existing remembered casing.
* **Case-Insensitive Lookups & Access**: All queries, CLI flags, MCP tool calls, ticket lookups (`ese get personal-1`, `ese get PERSONAL-1`, `ese get Personal-1`), and Agent Project Allow-List permissions (`allowedProjects`) match case-insensitively.
* **Cross-Platform Filesystem Normalization**: To prevent split directory fragmentation on case-sensitive filesystems (such as Linux ext4 or Docker), directory resolution matches existing parent directory entries case-insensitively, automatically reusing existing directory casing regardless of input variation.

---

## 🤖 Model Context Protocol (MCP) Setup

To connect Esedre to **Google Antigravity**, **Claude Code**, **Cursor**, or any MCP-compatible LLM agent:

```json
{
  "mcpServers": {
    "esedre": {
      "command": "esedre",
      "args": ["mcp"]
    }
  }
}
```

### Registered Tools
- `esedre_list_tickets`: List tickets with optional project, status, category, or search filter.
- `esedre_get_ticket`: Retrieve full specification, summary, comments, revision, and content hash (`sha1`).
- `esedre_get_plan` & `esedre_save_plan`: Inspect and update implementation plans with optimistic concurrency (`lastHash`).
- `esedre_create_ticket`: Mint new roadmap tickets with project code validation (up to 8 chars) and optional specification detail markdown.
- `esedre_update_ticket`: Modify status, title, complexity, or effort with optimistic concurrency (`lastHash`).
- `esedre_add_comment`: Append developer or LLM agent verification notes.

### Resources
- URI Scheme: `esedre://tickets/{id}` (MIME type: `text/markdown`)

---

## 🎨 Embeddable Component & Theming

Esedre includes a drop-in Web Component (`<esedre-planner>`) that allows you to embed the visual developer planner directly into any host web application (React, Vue, Svelte, or vanilla HTML) without adding UI framework dependencies to your project.

### Component Usage

```html
<!-- Load the Esedre embed script -->
<script type="module" src="node_modules/esedre/dist/web/embed.js"></script>

<!-- Embed the planner -->
<esedre-planner
  project="MYAPP"
  api-url="/esedre"
  show-header="false">
</esedre-planner>
```

### Component Attributes

| Attribute | Default | Description |
|---|---|---|
| `project` | `"all"` | Filter tickets to a specific project code (e.g. `Profe`, `Alce`) or `"all"` |
| `api-url` | `"/api/planning"` | Base URL of the Esedre server or reverse proxy endpoint |
| `show-header` | `"true"` | Set to `"false"` to hide the top navigation header for seamless dialog/drawer embedding |
| `read-only` | `"false"` | Disable ticket creation, editing, and plan modification |

### Theming with CSS Tokens

The planner UI is styled entirely using CSS custom properties. When embedding inside host applications, you can override these tokens to match your app's visual identity:

```css
:root {
  /* Surfaces & Backgrounds */
  --bg-main: #060812;              /* Main canvas background */
  --bg-card: #0b0f19;              /* Card containers */
  --bg-surface: #0a0e1a;           /* Surface panels */
  --bg-surface-elevated: #0f172a;  /* Headers & elevated panels */

  /* Borders & Accents */
  --border-subtle: #1e293b;        /* Subtle divider borders */
  --border-strong: #334155;        /* Interactive/hover borders */
  --accent-primary: #818cf8;       /* Primary interactive accent */

  /* Typography */
  --text-primary: #f8fafc;         /* High-contrast headings and titles */
  --text-secondary: #94a3b8;       /* Body and secondary text */
  --text-muted: #64748b;           /* Metadata and subtle labels */
}
```

* **Standalone Theme Toggle**: When running via `ese start`, users can toggle between Day (Light) and Night (Dark) themes with one click in the header. Theme preferences persist automatically in `localStorage`.

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/esedre/docs/assets/esedre-dashboard-dark.png" alt="Esedre Web Dashboard (Dark Theme)" width="100%" />
</p>

---

## 🛡️ Multi-Project Agent Isolation & Upward Discovery

Esedre enforces clean project isolation so each LLM agent is informed only of the projects it is authorized to access:
- **Upward Discovery**: When invoked in any subdirectory, Esedre climbs upward until it encounters the nearest `.esedre/esedre.json` or `esedre.json`, binding its execution to that repository's scope.
- **Scoped Project Awareness**: Storage operations and tools only inform and expose projects declared in `allowedProjects`. LLM agents cannot query, list, or mutate tickets outside their authorized scope.
- Unauthorized requests throw `EsedreAuthorizationError`:
  - **CLI**: Prints `Access Denied: ...` and exits with status code 1.
  - **MCP**: Responds with standard JSON-RPC error `-32603`.
  - **REST API**: Responds with HTTP status code `403 Forbidden`.

---

## 🛠️ Development & Testing

```bash
# Run full unit and integration test suite
npm test

# Lint TypeScript types
npm run lint

# Build bundled standalone distribution & web components
npm run build
```

---

## 📄 License & Changelog

- **License**: [Mozilla Public License 2.0 (MPL-2.0)](LICENSE) © [ARWAM](https://arwam.com)
- **Changelog**: See [CHANGELOG.md](CHANGELOG.md) for detailed release notes and version history.
