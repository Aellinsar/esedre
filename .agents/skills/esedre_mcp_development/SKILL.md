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

## 2. Standard Tools Specification

The server registers the following tools in `tools/list`:

1. `esedre_list_tickets`:
   - Parameters: `{ project?: string, status?: string, type?: string, priority?: string, milestone?: string, isBlocked?: boolean, linkedTo?: string, search?: string }`
   - Returns a structured list of roadmap tickets matching filters.
2. `esedre_get_ticket`:
   - Parameters: `{ ticketId: number | string }`
   - Returns full metadata, summary, feature breakdown, technical details, comments, links, blocker status, and SHA-1 hash.
3. `esedre_get_plan`:
   - Parameters: `{ ticketId: number | string }`
   - Returns implementation plan markdown.
4. `esedre_save_plan`:
   - Parameters: `{ ticketId: number | string, planMarkdown: string, lastHash?: string }`
   - Persists updated plan markdown with optimistic concurrency control.
5. `esedre_create_ticket`:
   - Parameters: `{ title: string, type?: string, priority?: string, milestone?: string, project?: string, complexity?: string, effort?: string, summary?: string, detail?: string, author?: string }`
   - Creates a new ticket with optional priority, milestone, and specification markdown.
6. `esedre_update_ticket`:
   - Parameters: `{ ticketId: number | string, status?: string, type?: string, priority?: string | null, milestone?: string, title?: string, complexity?: string, effort?: string, inDevelopment?: boolean, featureFlag?: string, lastHash?: string }`
   - Modifies ticket attributes with optimistic concurrency control.
7. `esedre_link_ticket`:
   - Parameters: `{ sourceTicketId: number | string, relation: string, targetTicketId: number | string, author?: string }`
   - Creates a bi-directional link between two tickets (`relates-to`, `blocks`, `parent-of`, `duplicates`).
8. `esedre_unlink_ticket`:
   - Parameters: `{ sourceTicketId: number | string, targetTicketId: number | string, relation?: string }`
   - Removes a bi-directional link between two tickets.
9. `esedre_add_comment`:
   - Parameters: `{ ticketId: number | string, text: string, author?: string }`
   - Appends a developer or LLM agent verification note to the ticket.
10. `esedre_list_milestones`:
   - Parameters: `{ project?: string }`
   - Returns project milestones with status, umbrella feature flag, target date, and deliverables progress metrics.
11. `esedre_get_milestone`:
   - Parameters: `{ milestoneId: number | string, project?: string }`
   - Returns milestone specifications, umbrella feature flag, and all member tickets.
12. `esedre_create_milestone`:
   - Parameters: `{ title: string, project?: string, featureFlag?: string, status?: string, targetDate?: string, description?: string }`
   - Creates a new milestone with optional umbrella feature flag and target date.
13. `esedre_update_milestone`:
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
| `-32603` | Internal / Security error | Thrown when storage operation fails or when the Agent Project Allow-List denies access (`EsedreAuthorizationError`). |
