---
name: esedre_mcp_development
description: Architectural specifications and developer guide for the Esedre Model Context Protocol (MCP) server.
---

# Esedre MCP Server Architecture & Development

This skill details how the Esedre Model Context Protocol (MCP) server is structured, how agents connect over JSON-RPC 2.0 stdio, and how to add or test MCP tools and resources.

## 1. Protocol Architecture & Transports

- **Transport**: Standard I/O (`stdio`).
  - Input: Agents send newline-delimited JSON-RPC 2.0 messages via `stdin`.
  - Output: The server responds with newline-delimited JSON-RPC 2.0 messages via `stdout`.
  - **Diagnostic Invariant**: All server logs, heartbeat diagnostics, and stack traces MUST strictly be written to `stderr` (`process.stderr.write`). Writing non-JSON text to `stdout` corrupts the stdio JSON-RPC stream.
- **Specification Version**: Compatible with the MCP protocol specification (`2024-11-05`).
- **Workspace & Global Antigravity Discovery**: `setupMcpConfig` writes `.agents/mcp.json`, `.agents/mcp_config.json`, and registers `esedre` in the user's global `~/.gemini/config/mcp_config.json` (used by Antigravity 2.x standalone `language_server.exe` hub daemon) with a resilient launcher that prefers `.esedre\esedre.cmd` when inside an initialized workspace and falls back to global `ese mcp`.

## 2. Standard Tools Specification

The server registers the following tools in `tools/list`:

1. `esedre_list_tickets`:
   - Parameters: `{ project?: string, status?: string, type?: string, priority?: string, milestone?: string, isBlocked?: boolean, leased?: boolean, leasedBy?: string, linkedTo?: string, search?: string, includePlan?: boolean }`
   - Returns a structured list of roadmap tickets matching filters, including `hasPlan` and `summary`, with optional `planMarkdown` hydration when `includePlan: true`.
2. `esedre_get_ticket`:
   - Parameters: `{ ticketId: number | string }`
   - Returns full metadata, summary, feature/task/fix breakdown, technical details, comments, links, lease state, blocker status, and SHA-1 hash.
3. `esedre_get_plan`:
   - Parameters: `{ ticketId: number | string }`
   - Returns implementation plan markdown.
4. `esedre_save_plan`:
   - Parameters: `{ ticketId: number | string, planMarkdown?: string, plan?: string, lastHash?: string }`
   - Persists updated plan markdown with optimistic concurrency control. Accepts either `planMarkdown` or `plan` as alias with validated required parameter presence.
5. `esedre_create_ticket`:
   - Parameters: `{ title: string, type?: string, priority?: string, milestone?: string, project?: string, complexity?: string, effort?: string, summary?: string, detail?: string, plan?: string, planMarkdown?: string, author?: string, includeRaw?: boolean }`
   - Creates a new ticket with optional priority, milestone, specification markdown, and implementation plan in a single atomic call. By default, omits `detail.raw` to keep response payloads compact unless `includeRaw: true`.
6. `esedre_update_ticket`:
   - Parameters: `{ ticketId: number | string, status?: string, type?: string, priority?: string | null, milestone?: string, title?: string, detail?: string, detailMarkdown?: string, plan?: string, planMarkdown?: string, complexity?: string, effort?: string, inDevelopment?: boolean, featureFlag?: string, lastHash?: string, includeRaw?: boolean }`
   - Modifies ticket attributes, specification detail, and implementation plan with optimistic concurrency control and automatic `detail.md` header reconciliation. By default, omits `detail.raw` unless `includeRaw: true`.
7. `esedre_claim_ticket`:
   - Parameters: `{ ticketId: number | string, holder?: string, workerId?: string, system?: string, branch?: string, ttlMinutes?: number, force?: boolean }`
   - Acquires a TTL-backed lease on a ticket (`In Development`, default 60m TTL) and prevents concurrent edits by other agents (`-32001`).
8. `esedre_renew_lease`:
   - Parameters: `{ ticketId: number | string, holder?: string, workerId?: string, system?: string, ttlMinutes?: number }`
   - Extends the expiration timestamp (`expiresAt`) for an active ticket lease.
9. `esedre_release_ticket`:
   - Parameters: `{ ticketId: number | string, holder?: string, workerId?: string, status?: string, finalStatus?: string, notes?: string, force?: boolean }`
   - Releases an active ticket lease, optionally transitions ticket status, and optionally records completion notes.
10. `esedre_list_leases`:
    - Parameters: `{ project?: string }`
    - Lists all active unexpired ticket leases across authorized projects.
11. `esedre_link_ticket`:
    - Parameters: `{ sourceTicketId: number | string, relation: string, targetTicketId: number | string, author?: string, project?: string }` (also accepts aliases `id`, `sourceId`, or `ticketId` for source, and `targetId` for target).
    - Creates a bi-directional link between two tickets (`relates-to`, `blocks`, `parent-of`, `duplicates`). Returns a compact confirmation payload `{ success: true, sourceKey, relation, targetKey, sourceRevision, targetRevision, links }`.
12. `esedre_unlink_ticket`:
    - Parameters: `{ sourceTicketId: number | string, targetTicketId: number | string, project?: string }` (also accepts aliases `id`, `sourceId`, or `ticketId` for source, and `targetId` for target).
    - Removes a bi-directional link between two tickets. Returns a compact confirmation payload `{ success: true, sourceKey, targetKey, sourceRevision, targetRevision, links }`.
13. `esedre_add_comment`:
    - Parameters: `{ ticketId: number | string, text?: string, file?: string, author?: string }`
    - Appends a developer or LLM agent verification note to the ticket.
14. `esedre_list_milestones`:
    - Parameters: `{ project?: string }`
    - Returns project milestones with status, umbrella feature flag, target date, and deliverables progress metrics.
15. `esedre_get_milestone`:
    - Parameters: `{ milestoneId: number | string, project?: string }`
    - Returns milestone specifications, umbrella feature flag, and all member tickets.
16. `esedre_create_milestone`:
    - Parameters: `{ title: string, project?: string, featureFlag?: string, status?: string, targetDate?: string, description?: string }`
    - Creates a new milestone with optional umbrella feature flag and target date.
17. `esedre_update_milestone`:
    - Parameters: `{ milestoneId: number | string, project?: string, title?: string, featureFlag?: string, status?: string, targetDate?: string, description?: string }`
    - Updates milestone attributes or unlinks umbrella flag.

## 3. Resource Endpoints

The server exposes read-only markdown resources for dynamic agent context injection:

- **URI Format**: `esedre://tickets/{id}`
- **MIME Type**: `text/markdown`
- **Behavior**:
  - `resources/list`: Returns URIs for all tickets within the authorized scope.
  - `resources/read`: Delivers the complete ticket specification markdown. Rejects unauthorized tickets with code `-32603`.

## 4. MCP Error Codes

| Code | Meaning | Usage in Esedre |
|---|---|---|
| `-32700` | Parse error | Invalid JSON sent on `stdin`. |
| `-32601` | Method not found | Unknown JSON-RPC method requested. |
| `-32602` | Invalid params | Missing required argument (e.g. ticket ID or URI). |
| `-32603` | Internal / Security / Lease Conflict error | Thrown when storage operation fails, when the Agent Project Allow-List denies access (`EsedreAuthorizationError`), or when a ticket is actively leased by another agent (`EsedreLeaseConflictError`). |

## 5. Automatic Snapshot Projection Refresh on Mutations

Whenever any mutating MCP tool completes (`create_ticket`, `update_ticket`, `save_plan`, `add_comment`, `claim_ticket`, `renew_lease`, `release_ticket`, `link_ticket`, `unlink_ticket`, `create_milestone`, `update_milestone`):
- **Workspace Resolution**: The server identifies target repository directories for the affected project code(s) by inspecting the active workspace root (`options.workspaceRoot`, `storage.getWorkspaceRoot()`, or `discovered.workspaceRoot`), local project configuration or existing `snapshot.json`, and any registered project repositories in central `~/.esedre/config.json`.
- **Zero-Latency Ingress Parity**: The server automatically regenerates `.esedre/snapshot.json` in the consuming project repository so that local snapshot projections stay 100% synchronized with zero manual CLI intervention.
- **Resilient Stdio Diagnostics**: Snapshot regeneration is wrapped in safe error handling: any write or filesystem issues are reported to `stderr` (`process.stderr.write`), strictly preventing `stdout` JSON-RPC stream corruption and ensuring the mutation tool response succeeds.

## 6. Request Serialization & Non-Blocking Stdio

- **Decoupled Stdio**: `readline.createInterface` reads strictly from `process.stdin` without binding `output: process.stdout`, preventing anonymous pipe buffer deadlocks on Windows and UNIX platforms.
- **Sequential Request Queue**: Incoming JSON-RPC requests are queued and processed sequentially via an internal promise queue, ensuring tool responses and diagnostics write cleanly to stdout and stderr without interleaving.
- **Snapshot Lock Map**: Concurrent mutations targeting the same repository directory serialize snapshot generation through a per-directory lock map (`snapshotLocks`), preventing concurrent file collisions on `.esedre/snapshot.json`.


