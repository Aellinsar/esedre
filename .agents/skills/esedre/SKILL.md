---
name: esedre
description: Tooling and workflow reference for interacting with the Esedre developer ticketing and roadmap system. Use this skill whenever inspecting planned work, viewing ticket specs, updating implementation plans, or posting developer notes.
---

# Esedre Planning & Roadmap Workflow

Esedre is the developer ticketing and LLM coding partner coordination platform. The engine codebase resides in the standalone repository `aellinsar/esedre` (`../esedre`), and operates on decoupled ticket repositories (such as `aellinsar/esedre-data` configured in `.esedre/esedre.json`). Interact with tickets via in-repo shell wrappers in `.esedre/` (`.esedre/ese`), or the global `ese` CLI.

## 0. Authoritative Ingress Hierarchy & Zero-Latency Context (`.esedre/snapshot.json`)

All ticket discovery, inspection, and state management strictly follow this positive ingress hierarchy:

1. **Step 1 (Default for Read-Only Inspection) - Local Snapshot Projection**:
   Always read `.esedre/snapshot.json` in the workspace root first. It provides an immediate, zero-latency local projection containing all active and completed tickets, summaries, implementation plans, revision numbers, completion dates (`completedAt`), and staleness metrics (`daysSinceUpdate`).
2. **Step 2 (Dynamic Queries & State Mutations) - Esedre MCP Tools**:
   Use first-class MCP tools when active in the session (`esedre_list_tickets`, `esedre_get_ticket`, `esedre_get_plan`, `esedre_save_plan`, `esedre_update_ticket`, `esedre_add_comment`).
3. **Step 3 (Terminal & Script Fallback) - In-Repo CLI Wrapper**:
   Use `.esedre/ese` (`.esedre/ese get`, `.esedre/ese plan`, `.esedre/ese update`, `.esedre/ese snapshot`).
4. **Storage Boundary**:
   Backing ticket hubs (such as `esedre-data`) represent data storage managed by the engine. All agent interactions with roadmap tickets flow through the snapshot projection, MCP tools, or CLI wrappers.

## 1. Model Context Protocol (MCP) Tools

When Esedre MCP is active in your agent session (`.agents/mcp_config.json`), use these tools directly:

| Tool | Purpose | Key Arguments |
|---|---|---|
| `esedre_list_tickets` | List roadmap tickets with filters | `project` (e.g. `Profe`, `Esedre`, `Alce`), `status`, `type`, `priority`, `milestone`, `isBlocked`, `linkedTo`, `search` |
| `esedre_get_ticket` | Full specification, summary, comments, links, revision & sha1 | `ticketId` (numeric e.g. `96` or compound e.g. `Profe-96`) |
| `esedre_get_plan` | Active implementation plan markdown | `ticketId` (numeric or compound) |
| `esedre_save_plan` | Save implementation plan markdown with OCC | `ticketId`, `planMarkdown`, `lastHash` |
| `esedre_create_ticket` | Mint a new ticket with auto sequential ID | `title` (max 48 chars), `type`, `project`, `priority`, `milestone`, `effort`, `summary`, `detail` |
| `esedre_update_ticket` | Update ticket attributes with OCC | `ticketId`, `status`, `type`, `priority`, `milestone`, `title`, `complexity`, `effort`, `inDevelopment`, `featureFlag`, `lastHash` |
| `esedre_link_ticket` | Establish bi-directional ticket relationship | `sourceTicketId`, `relation` (`relates-to` \| `blocks` \| `parent-of` \| `duplicates`), `targetTicketId`, `author` |
| `esedre_unlink_ticket` | Remove bi-directional ticket relationship | `sourceTicketId`, `targetTicketId`, `relation` |
| `esedre_list_milestones` | List project milestones and deliverables progress | `project` |
| `esedre_get_milestone` | Get milestone specs, umbrella flag, and member tickets | `milestoneId` (numeric or title), `project` |
| `esedre_create_milestone` | Create a project milestone with optional umbrella flag | `title`, `project`, `featureFlag`, `status`, `targetDate`, `description` |
| `esedre_update_milestone` | Update milestone status, umbrella flag, or title | `milestoneId`, `project`, `title`, `featureFlag`, `status`, `targetDate`, `description` |
| `esedre_add_comment` | Append developer or agent comment | `ticketId`, `text`, `author` |

## 2. Core CLI Commands (Fallback via `run_command`)

Both `esedre` and `ese` work interchangeably:

### List Tickets
```bash
.esedre/ese list [-p|--project <code|all>] [-s|--status <status>] [-t|--type <type>] [-P|--priority <priority>] [-m|--milestone <name>] [--blocked] [--linked-to <ticketKey>] [-q|--search <q>] [--json]
```

### Read Ticket Details
```bash
.esedre/ese get <ticketId> [--json]
```

### Read or Update Implementation Plans
```bash
.esedre/ese plan <ticketId>
.esedre/ese plan <ticketId> --file <planFilePath>
.esedre/ese plan <ticketId> --set "<markdownContent>" [--last-hash <hash>]
```

### Create a Ticket
```bash
.esedre/ese create --title "..." [-p|--project <code>] [-t|--type Feature] [-P|--priority High] [-m|--milestone <name>] [--complexity Medium] [--effort "2.0 - 4.0 hours"] [--detail "<md>"] [--file <path>] [--json]
```

### Update Ticket Status & Attributes
```bash
.esedre/ese update <ticketId> --status "In Development"
.esedre/ese update <ticketId> --status "Completed"
.esedre/ese update <ticketId> --type Feature -P High --complexity Medium --effort "2.0 - 4.0 hours"
.esedre/ese update <ticketId> -P none           # Clears priority
.esedre/ese update <ticketId> -m "Release 1.0"  # Links ticket to milestone (inherits umbrella feature flag)
.esedre/ese update <ticketId> -m none           # Unlinks ticket from milestone
```

### Link or Unlink Tickets
```bash
.esedre/ese link <sourceId> <relation> <targetId> [--author "..."]
.esedre/ese unlink <sourceId> <targetId> [--relation <relation>]
# Supported relations: relates-to, blocks, parent-of, duplicates
# Inverse reciprocal links are automatically synchronized.
```

### Manage Milestones & Umbrella Feature Flags
```bash
.esedre/ese milestone list [-p|--project <code>] [--json]
.esedre/ese milestone get <id|title> [-p|--project <code>] [--json]
.esedre/ese milestone create --title "..." [-p|--project <code>] [--flag <flag>] [--status <status>] [--target-date <YYYY-MM-DD>] [--description "..."] [--json]
.esedre/ese milestone update <id|title> [-p|--project <code>] [--title "..."] [--flag <flag|none>] [--status <status>] [--target-date <YYYY-MM-DD>] [--description "..."] [--json]
.esedre/ese milestone delete <id|title> [-p|--project <code>] [--json]
```

### Append Comments or Notes
```bash
.esedre/ese comment <ticketId> "Verified implementation." --author "Agent"
.esedre/ese comment <ticketId> --text "Verified implementation." --author "Agent"
```

### Regenerate Snapshot
```bash
.esedre/ese snapshot
.esedre/ese refresh
```

### Server Lifecycle & Daemon Management
```bash
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
```

## 3. Embedded View & Theme Token Contract

When embedding `<PlannedWorkView />` inside a host app (e.g. `PlannedWorkModal.tsx`):

### Zero-Effort Drop-in (Default Fallback)
`PlannedWorkView` incorporates an internal CSS fallback bridge (`.esedre-host-bridge` / `.esedre-theme-root` with `ESEDRE_THEME_FALLBACK_CSS`).
If an embedding application supplies **zero CSS variables**, the component automatically falls back to clean, high-contrast light or dark themes matching the user's OS preference (`prefers-color-scheme: dark`) or host `.dark` / `[data-theme="night"]` classes.

### Theme Token Customization
If the host application declares any or all of the 12 core design tokens on `:root` or an ancestor container, `PlannedWorkView` automatically adopts them:
- **Surface**: `--bg-surface`, `--bg-surface-elevated`, `--bg-input`
- **Borders**: `--border-subtle`, `--border-strong`, `--border-accent`
- **Text**: `--text-primary`, `--text-secondary`, `--text-muted`
- **Accent**: `--accent-primary`, `--accent-bg-subtle`, `--accent-border-subtle`

## 4. Safety & Invariants
- **Always use `--json`** for CLI programmatic inspection.
- **Optimistic Concurrency**: Writes support `--last-hash <hash>` to prevent overwriting concurrent updates.
- **Universal Type Naming**: Always use `type` (`Feature`, `Platform`, `Tools`, `Idea`, `Bug`). The legacy name `category` is deprecated.
- **Ticket Priority**: The `priority` field is optional (`Critical`, `High`, `Medium`, `Low`, or unset/null). Backwards compatible with legacy tickets lacking a priority field. To clear via CLI use `-P none` or `--priority none` (in code/MCP, pass `null` or `'none'`).
- **Milestones & Umbrella Feature Flags**: Milestones group tickets into deliverables with completion metrics. Milestones can declare an optional umbrella feature flag which member tickets inherit automatically. Unlinking a ticket (`-m none`) removes inherited flags.
- **Compound IDs for Multi-Project Portfolios**: In `project=all`, ticket IDs are `${projectCode}-${id}` (e.g. `Profe-1`, `Esedre-1`). DOM anchors strictly use `feature-card-${projectCode}-${id}`.
- **Never delete tickets** directly via filesystem.
- **Workspace Scoping**: An LLM coding partner operates strictly within the authorized project scope declared in the local repository configuration. Central repository linking and system-level configuration are managed separately; focus roadmap work, implementation plans, and verification notes on this project.
- **Secret Developer Hash Route (`#/planner`, `#/plan`, `#planner`, `#plan`)**:
  - In web applications embedding Esedre (such as your host web app), `#/planner` and `#/plan` serve as direct secret developer entry routes.
  - **SEO Invariant**: These developer routes are private and MUST NEVER be exposed in `sitemap.xml`, `robots.txt`, `llms.txt`, or public navigation links.
  - The URL hash is preserved across hard page refreshes (F5) without falling back to `#/chat` or other views.
