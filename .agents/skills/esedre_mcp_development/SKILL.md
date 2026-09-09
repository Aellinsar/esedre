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
   - Parameters: `{ project?: string, status?: string, category?: string, search?: string }`
   - Returns a structured list of roadmap tickets matching filters.
2. `esedre_get_ticket`:
   - Parameters: `{ ticketId: number }`
   - Returns full metadata, summary, feature breakdown, technical details, and comments.
3. `esedre_get_plan`:
   - Parameters: `{ ticketId: number }`
   - Returns implementation plan markdown.
4. `esedre_save_plan`:
   - Parameters: `{ ticketId: number, planMarkdown: string }`
   - Persists updated plan markdown.
5. `esedre_create_ticket`:
   - Parameters: `{ title: string, category: string, project?: string, complexity?: string, effort?: string, summary?: string, author?: string }`
   - Creates a new ticket.
6. `esedre_update_ticket`:
   - Parameters: `{ ticketId: number, status?: string, title?: string, inDevelopment?: boolean, featureFlag?: string }`
   - Modifies ticket attributes.
7. `esedre_add_comment`:
   - Parameters: `{ ticketId: number, text: string, author?: string }`
   - Appends a comment to the ticket.
8. `esedre_list_projects`:
   - Parameters: `{}`
   - Returns authorized project definitions.

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
