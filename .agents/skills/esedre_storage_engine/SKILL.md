---
name: esedre_storage_engine
description: Storage architecture, filesystem data layouts, and adapter interfaces for Esedre.
---

# Esedre Storage Engine & Adapter Architecture

This skill documents how Esedre persists ticket data, parses metadata, and how storage adapters are designed.

## 1. The `StorageAdapter` Interface

All storage engines implement the `StorageAdapter` contract defined in `src/storage/adapter.ts`:

- `getProjects(): Promise<ProjectDescriptor[]>`
- `registerProject(input: RegisterProjectInput): Promise<ProjectDescriptor>`
- `updateProject(code: string, updates: Partial<ProjectDescriptor>): Promise<ProjectDescriptor>`
- `renameProjectCode(oldCode: string, newCode: string): Promise<ProjectDescriptor>`
- `listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]>`
- `getTicket(id: number | string): Promise<EsedreTicket | null>`
- `createTicket(input: CreateTicketInput): Promise<EsedreTicket>`
- `updateTicket(id: number | string, updates: Partial<TicketMeta>, lastHash?: string): Promise<EsedreTicket>`
- `addTicketLink(sourceId: number | string, relation: TicketLinkRelation, targetId: number | string, options?: { author?: string; project?: string }): Promise<{ source: EsedreTicket; target?: EsedreTicket }>`
- `removeTicketLink(sourceId: number | string, targetId: number | string, options?: { relation?: TicketLinkRelation; project?: string }): Promise<{ source: EsedreTicket; target?: EsedreTicket }>`
- `getPlan(id: number | string): Promise<string | null>`
- `savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void>`
- `addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment>`
- `listMilestones(project?: string): Promise<Milestone[]>`
- `getMilestone(id: number | string, project?: string): Promise<Milestone | null>`
- `createMilestone(input: CreateMilestoneInput): Promise<Milestone>`
- `updateMilestone(id: number | string, updates: UpdateMilestoneInput, project?: string): Promise<Milestone>`
- `deleteMilestone(id: number | string, project?: string): Promise<boolean>`

Methods accept both numeric IDs (`96`) and compound project keys (`Profe-96`, `Esedre-1`).

## 2. Multi-Topology Storage Resolution

`FilesystemStorageAdapter` resolves tickets across 6 distinct storage topologies:

1. **Single Hub Topology**: `dataDir: "../esedre-data"` targeting a dedicated ticket repo (`projects/<ProjectCode>/tickets/<id>/`).
2. **In-Repo Standalone Topology**: Tickets stored in the workspace repo under `.esedre/tickets/<id>/`.
3. **Multi-Hub Topology**: `dataDir: ["../hub1", "../hub2"]` aggregating multiple hubs.
4. **Disparate Multi-Repo Federation**: `projects: { "Core": "../core-engine", "Web": "../frontend-app" }`.
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
        ├── milestones.json               # Project milestones & umbrella feature flags
        └── tickets/
            ├── 1/
            │   ├── meta.json             # Core metadata (id, title, type, priority, milestone, sha1)
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
  "priority": "High",
  "complexity": "Medium",
  "estimatedEffort": "3.0 - 4.5 hours",
  "submittedBy": "Developer",
  "timestamp": "2026-09-08T02:00:00Z",
  "status": "In Development",
  "projectId": 3,
  "isActivePlanning": true,
  "featureFlag": "ENABLE_ESEDRE_MCP",
  "links": [
    {
      "relation": "blocks",
      "targetKey": "Esedre-105",
      "targetProject": "Esedre",
      "targetId": 105,
      "createdAt": "2026-09-08T02:05:00Z"
    }
  ]
}
```

Tickets with uncompleted `blocked-by` links have `isBlocked: true` projected dynamically in memory, snapshot, and API responses.

## 6. Case-Remembering Storage & Case-Insensitive Matching

- **Canonical Remembered Casing**: The original casing at registration time (e.g. `Personal`, `Esedre`) is preserved on disk in directory names (`projects/Personal/`) and metadata manifests (`project.json`, `meta.json`).
- **Directory Casing Re-use**: To avoid split duplicate directories on case-sensitive filesystems (Linux ext4/XFS, Docker), `registerProject` scans existing directory entries case-insensitively and reuses the existing directory name.
- **Case-Insensitive Queries & Lookups**: Lookups (`getTicket`, `listTickets`), CLI commands, and MCP tools match project codes case-insensitively (`personal-1`, `PERSONAL-1`, `Personal-1`).

## 7. Per-Project Grounding Context & Authoritative Guidelines

- **Project Grounding Manifests**: Per-project metadata in `project.json` (for hubs) or `.esedre/project.json` (for in-repo/federated repos) stores high-level architectural mission statements, technology stack constraints, and guidelines references.
- **Authoritative Source of Truth**: User-maintained agent guidelines (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) are strictly the primary source of truth. Esedre references and anchors to them rather than duplicating rules that can become stale.
