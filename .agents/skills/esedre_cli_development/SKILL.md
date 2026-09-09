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
| `list` | `esedre list [--project <code\|all>] [--status <status>] [--json]` | Lists tickets. Defaults to the active repo's `projectCode` in `esedre.json`. `--project all` lists all permitted tickets. |
| `get` | `esedre get <id> [--json]` | Displays complete ticket metadata, summary, feature breakdown, and comments. |
| `plan` | `esedre plan <id> [--json] [--set "<markdown>"] [--file <path>]` | Reads or updates the implementation plan markdown. |
| `create` | `esedre create --title "..." [--project <code>] [--category <cat>] [--effort "..."]` | Creates a new roadmap ticket with sequential ID. Defaults to active project. |
| `update` | `esedre update <id> [--status <status>] [--title "..."] [--in-dev]` | Updates ticket status, title, active planning flag, or feature flag. |
| `comment` | `esedre comment <id> --text "..." [--author "..."]` | Appends a developer or agent comment to the ticket's history. |
| `projects` | `esedre projects [--json]` | Lists registered projects that are within the current authorized scope. |
| `mcp` | `esedre mcp` | Starts the Model Context Protocol stdio server. |
| `skill` | `esedre skill` | Outputs the self-contained agent skill markdown. |

## 3. Machine-Readable `--json` Mode

- AI coding agents should always invoke CLI commands with `--json` for predictable, programmatic JSON output.
- All non-error output in `--json` mode must be strictly valid JSON written to `stdout`.
- Diagnostic messages or progress logs must be routed strictly to `stderr`.

## 4. Exit Codes & Error Handling

- **Code 0**: Successful execution.
- **Code 1**: Handled user or validation error (e.g. missing required flags, ticket not found).
- **Access Denied**: When a `EsedreAuthorizationError` is caught, the CLI writes `Access Denied: <message>` to `stderr` in bold red and exits with code 1.
