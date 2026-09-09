---
name: esedre_storage_engine
description: Storage architecture, filesystem data layouts, and adapter interfaces for Esedre.
---

# Esedre Storage Engine & Adapter Architecture

This skill documents how Esedre persists ticket data, parses metadata, and how storage adapters are designed.

## 1. The `StorageAdapter` Interface

All storage engines implement the `StorageAdapter` contract defined in `src/storage/adapter.ts`:

- `getProjects(): Promise<ProjectDescriptor[]>`
- `listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]>`
- `getTicket(id: number): Promise<EsedreTicket | null>`
- `createTicket(input: CreateTicketInput): Promise<EsedreTicket>`
- `updateTicket(id: number, updates: Partial<TicketMeta>): Promise<EsedreTicket>`
- `getPlan(id: number): Promise<string | null>`
- `savePlan(id: number, planMarkdown: string): Promise<void>`
- `addComment(id: number, comment: { author: string; text: string }): Promise<TicketComment>`

This decoupling allows Esedre to support alternative backends in the future (e.g. Git-backed storage, REST API server, or PostgreSQL) without changing the CLI or MCP server layers.

## 2. Filesystem Storage Layout

`FilesystemStorageAdapter` operates directly on structured markdown and JSON files:

```
<workspaceRoot>/
├── esedre.json                           # Local repository configuration
└── src/data/planning/
    ├── projects/
    │   └── projects.json               # Registered workspace projects
    └── tickets/
        ├── 1/
        │   ├── meta.json               # Core metadata (id, title, category, projectId, status)
        │   ├── detail.md               # Markdown specification and breakdown
        │   ├── comments.json           # Historical developer and agent comments
        │   └── implementation_plan.md  # Active implementation plan
        ├── 2/
        └── ...
```

## 3. Safe File Writing (`writeSafeFile`)

- All mutations use `writeSafeFile`, ensuring trailing newlines (`\n`) are preserved.
- Creates parent directories recursively if they do not already exist.

## 4. Ticket Metadata Schema (`meta.json`)

```json
{
  "id": 104,
  "title": "Esedre Model Context Protocol (MCP) Server",
  "category": "Feature",
  "complexity": "Medium",
  "estimatedEffort": "3.0 – 4.5 hours",
  "submittedBy": "Developer",
  "timestamp": "2026-09-08T02:00:00Z",
  "status": "In Development",
  "projectId": 3,
  "isActivePlanning": true,
  "featureFlag": "ENABLE_ESEDRE_MCP"
}
```
