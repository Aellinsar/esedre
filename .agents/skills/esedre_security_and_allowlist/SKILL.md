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
