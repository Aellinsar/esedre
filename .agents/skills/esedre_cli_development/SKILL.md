---
name: esedre_cli_development
description: Guidelines and architectural reference for developing, extending, and testing the Esedre Command Line Interface (CLI).
---

# Esedre CLI Development

This skill documents how to maintain, extend, and debug the Esedre CLI executable (`bin/esedre.ts`).

## 1. Architecture & Execution Flow

1. **Shebang & Invocation**:
   - `bin/esedre.ts` begins with `#!/usr/bin/env node`.
   - In development: `npx tsx bin/esedre.ts <command> [options]`.
   - In production / bundle: `node dist/esedre.mjs <command> [options]`.

2. **Configuration Auto-Discovery**:
   - Every CLI execution begins by calling `findEsedreConfig(process.cwd())`.
   - The crawler climbs upward until it locates `esedre.json` (or reaches the filesystem root).
   - The discovered `workspaceRoot` and `config` are passed directly into `FilesystemStorageAdapter`.

3. **Argument Parsing (`parseArgs`)**:
   - Lightweight custom parser with zero external dependencies.
   - Converts `--flag value` and `--flag` (boolean) into `flags` map.
   - Extracts positional arguments (e.g. ticket ID for `get`, `plan`, `update`, `comment`).

## 2. Standard CLI Commands

| Command | Syntax | Description |
|---|---|---|
| `init` | `esedre init [path] [--hub <name\|path>] [--project <code>] [--name "<name>"]` | Brings a repository online (creates `.esedre/esedre.json`, wrappers, initial snapshot), bootstraps a data hub (`--hub`), or registers a project directly into a data hub (`--project <code> [--hub <name\|path>]`). |
| `configure` | `esedre configure [add <path> \| remove <code\|path> \| set <k> <v>]` | Inspects or mutates central configuration in `~/.esedre/config.json`. |
| `start` | `esedre start [--port <n>] [--foreground | -f] [--quiet] [--json]` | Starts the background server daemon (or foreground with `-f`). |
| `stop` | `esedre stop [--port <n>] [--quiet] [--json]` | Stops the running background server daemon. |
| `status` | `esedre status [--port <n>] [--json]` | Checks health, PID, uptime, and diagnostics of the running server. |
| `logs` | `esedre logs [--port <n>] [--lines <n>]` | Tails recent server logs. |
| `list` | `esedre list [--project <code\|all>] [-s\|--status <status>] [-t\|--type <type>] [-P\|--priority <priority>] [-m\|--milestone <name>] [--blocked] [--linked-to <key>] [--json]` | Lists tickets. Defaults to the active repo's `projectCode` in `esedre.json`. `--project all` lists all permitted tickets. |
| `get` | `esedre get <id> [--json]` | Displays complete ticket metadata, summary, feature breakdown, comments, links, and blocker status. |
| `plan` | `esedre plan <id> [--json] [--set "<markdown>"] [--file <path>]` | Reads or updates the implementation plan markdown. |
| `create` | `esedre create --title "..." [--project <code>] [--type <type>] [-P\|--priority <priority>] [-m\|--milestone <name>] [--effort "..."] [--detail "<md>"] [--file <path>]` | Creates a new roadmap ticket with sequential ID, optional priority, optional milestone, and specification markdown. Defaults to active project. |
| `update` | `esedre update <id> [-p\|--project <code>] [-s\|--status <status>] [-t\|--type <type>] [-P\|--priority <priority\|none>] [-m\|--milestone <name\|none>] [--title "..."] [--flag] [--last-hash <sha1>] [--force]` | Updates ticket status, type, priority, milestone, title, active planning flag, or feature flag. Accepts compound ID (e.g. `Profe-96`) or numeric with `-p`. |
| `link` | `esedre link <sourceId> <relation> <targetId> [--author "..."]` | Creates a bi-directional link between two tickets. Relations: `relates-to`, `blocks`, `parent-of`, `duplicates`. |
| `unlink` | `esedre unlink <sourceId> <targetId> [--relation <relation>]` | Removes a bi-directional link between two tickets. |
| `milestone` | `esedre milestone [list\|get\|create\|update\|delete]` | Manages project milestones and umbrella feature flags with deliverables tracking. |
| `comment` | `esedre comment <id> [-p\|--project <code>] --text "..." [--author "..."]` | Appends a developer or agent comment to the ticket's history. Accepts compound ID or numeric with `-p`. |
| `projects` | `esedre projects [--json]` | Lists registered projects that are within the current authorized scope. |
| `rename-project` | `esedre rename-project <oldCode> <newCode> [--name "<name>"]` | Renames a project code across directory storage paths, manifests, and tickets. |
| `project` | `esedre project set <code> [--name "<name>"]` | Updates project metadata (such as display name). |
| `snapshot`, `refresh` | `esedre snapshot [--project <code>]` | Re-generates or refreshes `.esedre/snapshot.json` projection for zero-latency agent context. |
| `upgrade` | `esedre upgrade [--all \| -a] [--force \| -f] [--json]` | Upgrades workspace configuration, scripts, wrappers, and agent skills across current or all registered workspaces. |
| `mcp` | `esedre mcp` | Starts the Model Context Protocol stdio server. |

## 3. Machine-Readable `--json` Mode

- Autonomous LLM coding agents should always invoke CLI commands with `--json` for predictable, programmatic JSON output.
- All non-error output in `--json` mode must be strictly valid JSON written to `stdout`.
- Diagnostic messages or progress logs must be routed strictly to `stderr`.

## 4. Exit Codes & Error Handling

- **Code 0**: Successful execution.
- **Code 1**: Handled user or validation error (e.g. missing required flags, ticket not found).
- **Access Denied**: When a `EsedreAuthorizationError` is caught, the CLI writes `Access Denied: <message>` to `stderr` in bold red and exits with code 1.

## 5. Automated Diagnostic & Repair Invariants

- **Mandatory Pre-Edit Backup Invariant**: Any diagnostic, repair, or automated fix operation (such as future `ese doctor` or `ese fix` routines) that mutates, rewrites, or repairs configuration files, manifests, tickets, plans, or source code MUST create an atomic timestamped backup (`.bak` or `.esedre/backups/<timestamp>/`) before modifying any file on disk.

## 6. Windows Shell & Batch Wrapper Invariants

1. **Windows CMD Wrapper (`ese.cmd` / `esedre.cmd`)**:
   - Subroutine dispatch: `call :run %*` with `goto :eof` and `exit /b %ERRORLEVEL%`. Eliminates legacy parenthesized blocks around `goto :done` that invalidate `cmd.exe` token stream memory in consuming repositories.
   - All internal batch invocations (`ese`, `esedre`, `npx`, and local `.bin\ese.cmd`) MUST use `call` (`call ese %*`).
   - Terminate with `exit /b %ERRORLEVEL%` to preserve and propagate return codes.
   - Diagnostic detection: `isWrapperOutdated()` identifies legacy wrappers and `ese status` prompts running `ese upgrade --all`.
2. **PowerShell Wrapper (`ese.ps1` / `esedre.ps1`)**:
   - Set console and output encoding to UTF-8 at startup (`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`, `$OutputEncoding = [System.Text.Encoding]::UTF8`).
   - Ensures non-ASCII Unicode characters render cleanly across Windows hosts.
