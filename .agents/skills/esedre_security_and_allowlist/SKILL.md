---
name: esedre_security_and_allowlist
description: Architectural specifications for Esedre's multi-project Agent Project Allow-List, providing isolation of projects planning that you don't want an agent to access, upward hierarchy discovery, and zero-YAML policy.
---

# Esedre Agent Project Allow-List & Project Isolation

This skill outlines Esedre's multi-tenant isolation model, configuration hierarchy traversal, and Agent Project Allow-List invariants.

## 1. Zero-YAML Invariant

- **Strict Ban on YAML**: Absolutely zero YAML files (`.yml` or `.yaml`) are permitted in Esedre.
- All configuration files, settings, and manifests MUST strictly use standard JSON (`esedre.json`, `projects.json`, `meta.json`, `comments.json`).

## 2. Upward Configuration Discovery (`esedre.json`)

When Esedre runs (either via the CLI or MCP server), it does not assume a fixed working directory. Instead, it employs upward discovery via `findEsedreConfig`:

1. Begins at `startDir` (defaults to `process.cwd()`).
2. Checks for the existence of `esedre.json` in the current folder.
3. If not found, moves up to the parent directory (`path.dirname(current)`).
4. Recursively repeats until it finds `esedre.json` or reaches the filesystem root.
5. Stops at the **first** `esedre.json` found, ensuring that nested subprojects in a monorepo or workspace will strictly discover their own local configuration.

### `esedre.json` Schema

```json
{
  "projectCode": "PASRC",
  "allowedProjects": ["CORE", "DOCS"]
}
```

- `projectCode` *(string, optional)*: Default project code for commands when omitted (e.g. `esedre list` or `esedre create`).
- `allowedProjects` *(string[], optional)*: Allow-list of project codes this workspace is permitted to access.
  - If omitted or empty, all projects are permitted.
  - If contains `"*"` (wildcard), all projects are permitted.
  - Otherwise, strictly limits access to the listed project codes (case-insensitive).
- `dataDir` *(string | string[], optional)*: Optional local override. Machine-level infrastructure settings reside centrally in `~/.esedre/config.json` and are inherited by workspaces whose projects exist in the configured hub; project repositories omit `dataDir` unless it is a subdirectory within the project repository or an intentional local override.

## 3. Agent Project Allow-List Enforcement

The allow-list isolation is enforced by `SecurityFilter` across every operation:

1. `getProjects()`: Automatically filters out any registered project whose code is not in `allowedProjects`.
2. `listTickets()`:
   - When no project filter is passed, tickets belonging to unauthorized projects are silently omitted from the results.
   - When an explicit project filter is passed (e.g. `--project WEB`), if that project is not in `allowedProjects`, throws `EsedreAuthorizationError`.
3. `getTicket(id)`: If the ticket belongs to an unauthorized project, throws `EsedreAuthorizationError`.
4. `createTicket(input)`: If the target project is not authorized, throws `EsedreAuthorizationError`.
5. `updateTicket`, `getPlan`, `savePlan`, `addComment`: All resolve the ticket first and throw `EsedreAuthorizationError` if unauthorized.

## 4. Error Manifestation

- **CLI**: Traps `EsedreAuthorizationError`, writes `Access Denied: ...` in bold red to `stderr`, and exits with code 1.
- **MCP**: Traps `EsedreAuthorizationError` in `tools/call` and `resources/read`, returning JSON-RPC error `-32603` with the security message.
- **REST API Server**: Traps `EsedreAuthorizationError` and returns HTTP status code `403 Forbidden` with a JSON error payload.

## 5. Gateway Server Portfolio Visibility & Server-Side Filtering

- **Server Decoupling from Launch Directory**: The background daemon and gateway server (`ese start`) instantiate unconstrained portfolio storage. This guarantees the developer Web UI has complete visibility across all registered data hubs and projects, regardless of which workspace directory the server was launched from.
- **Server-Side Request Filtering**: HTTP clients and autonomous agents requesting `/api/*` endpoints can pass an `x-esedre-allowed-projects` header or `?allowedProjects=<codes>` query parameter. The API server dynamically wraps storage in a request-scoped `SecurityFilter`, isolating results to authorized projects and returning HTTP 403 on unauthorized requests.
- **CLI and MCP Local Isolation**: Local agent CLI executions and MCP sessions directly bind to the active workspace's `allowedProjects`, guaranteeing strict containment for autonomous LLM coding agents.

## 6. Scoped Global `projects` Inheritance, Zero Host Path Leakage & Antigravity `PreToolUse` Hook Bridge (`Esedre-92`)

- **Scoped `globalConfig.projects` Inheritance**:
  - When `findEsedreConfig()` discovers a workspace config (`.esedre/esedre.json`), it inherits only `allowedProjects`-authorized repository mappings from `~/.esedre/config.json` (`projects`) and binds `projectDir` onto hub `ResolvedProjectLocation` entries without emitting false `duplicateProjectWarnings`.
  - Running `ese init`, `ese upgrade`, or `ese configure add` automatically registers workspaces in `~/.esedre/config.json` (`projects`) while preserving canonical `projectCode` casing.
- **Zero Host Filesystem Path Leakage**:
  - Host filesystem paths (`lease.worktree`) are retained internally in storage (`lease.json`) for Git branch auto-detection and local CLI inspection, but are strictly omitted from MCP tool responses, `-32001` lease conflict error payloads, `.esedre/snapshot.json` projections, and cross-repository `SecurityFilter` outputs.
  - MCP `stderr` snapshot logs report only the project code (`[Esedre MCP] Refreshed snapshot for project '<Code>'`), never host filesystem paths.
- **Antigravity Global MCP Isolation (`PreToolUse` Hook & Active Context Bridge)**:
  - `setupGlobalAntigravityMcpConfig()` installs a self-contained hook script (`~/.esedre/agy-pre-tool-hook.mjs`) and registers an `esedre-isolation` `PreToolUse` hook in `~/.gemini/config/hooks.json`.
  - Before any Esedre MCP call (both lazy `call_mcp_tool` and eager `mcp_esedre_*`), the hook resolves `.esedre/esedre.json` from `workspacePaths`, denies unauthorized explicit project or ticket-prefix calls (`{"decision": "deny"}`), and writes the active workspace scope to `~/.esedre/mcp-active-context.json`.
  - When `EsedreMcpServer` runs in global fallback mode (`useGlobalContextBridge: true`), each JSON-RPC request dynamically reads `~/.esedre/mcp-active-context.json` to enforce a request-scoped `SecurityFilter` and qualify bare numeric ticket IDs to the active workspace's `projectCode`.
