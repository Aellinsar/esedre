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
- `getTicket(id: number | string): Promise<EsedreTicket | null>`
- `createTicket(input: CreateTicketInput): Promise<EsedreTicket>`
- `updateTicket(id: number | string, updates: Partial<TicketMeta>, lastHash?: string): Promise<EsedreTicket>`
- `getPlan(id: number | string): Promise<string | null>`
- `savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void>`
- `addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment>`

Methods accept both numeric IDs (`96`) and compound project keys (`Profe-96`, `Esedre-1`).

## 2. Multi-Topology Storage Resolution

`FilesystemStorageAdapter` resolves tickets across 6 distinct storage topologies:

1. **Single Hub Topology**: `dataDir: "../esedre-data"` targeting a dedicated ticket repo (`projects/<ProjectCode>/tickets/<id>/`).
2. **In-Repo Standalone Topology**: Tickets stored in the workspace repo under `.esedre/tickets/<id>/`.
3. **Multi-Hub Topology**: `dataDir: ["../hub1", "../hub2"]` aggregating multiple hubs.
4. **Disparate Multi-Repo Federation**: `projects: { "Prof": "../ProfessorArwamSleepCenter", "Alce": "../alce-web" }`.
5. **Hybrid Topology**: Combines `dataDir` hubs and `projects` federated repo paths.
6. **Monorepo / In-Workspace Hub Topology**: When `dataDir` is omitted, auto-discovers `projects/` directory directly at workspace root or `./data`, enabling zero-configuration monorepos and local ticket hubs.

## 3. Filesystem Storage Layout

`FilesystemStorageAdapter` operates directly on structured markdown and JSON files:

```
<workspaceRoot>/
├── esedre.json                           # Local repository configuration
└── projects/
    └── <ProjectCode>/
        ├── project.json                  # Project descriptor
        └── tickets/
            ├── 1/
            │   ├── meta.json             # Core metadata (id, title, type, status, sha1)
            │   ├── detail.md             # Markdown specification and breakdown
            │   ├── comments.json         # Historical developer and agent comments
            │   └── implementation_plan.md# Active implementation plan
            ├── 2/
            └── ...
```

## 4. Safe File Writing (`writeSafeFile`)

- All mutations use `writeSafeFile`, ensuring trailing newlines (`\n`) are preserved.
- Creates parent directories recursively if they do not already exist.

## 5. Ticket Metadata Schema (`meta.json`)

```json
{
  "id": 104,
  "title": "Esedre Model Context Protocol (MCP) Server",
  "type": "Feature",
  "complexity": "Medium",
  "estimatedEffort": "3.0 - 4.5 hours",
  "submittedBy": "Developer",
  "timestamp": "2026-09-08T02:00:00Z",
  "status": "In Development",
  "projectId": 3,
  "isActivePlanning": true,
  "featureFlag": "ENABLE_ESEDRE_MCP"
}
```
