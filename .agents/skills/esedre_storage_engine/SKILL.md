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
- `claimTicket(id: number | string, input: ClaimTicketInput): Promise<EsedreTicket>`
- `renewLease(id: number | string, input: RenewLeaseInput): Promise<EsedreTicket>`
- `releaseTicket(id: number | string, input: ReleaseTicketInput): Promise<EsedreTicket>`
- `listActiveLeases(project?: string): Promise<TicketLeaseSummary[]>`
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
- `getAnswers(id: number | string): Promise<Record<string, string>>`
- `saveAnswer(id: number | string, questionIndex: number, answer: string): Promise<Record<string, string>>`
- `saveDetail(id: number | string, detailMarkdown: string, metaUpdates?: Partial<TicketMeta>): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }>`
- `getInlineComments(id: number | string): Promise<any[]>`
- `saveInlineComment(id: number | string, selectedText: string, comment: string, author?: string): Promise<any[]>`
- `saveAttachment(id: number | string, filename: string, buffer: Buffer): Promise<{ filename: string; relativePath: string }>`
- `getAttachmentPath(id: number | string, filename: string): string | null`
- `prewarmCache?(options?: { chunkSize?: number; onChunkYield?: (processedCount: number, totalCount: number) => void | Promise<void> }): Promise<void>`
- `getCacheGeneration?(): number`
- `closeWatchers?(): void`

Methods accept both numeric IDs (`96`) and compound project keys (`Profe-96`, `Esedre-1`).

## 2. Multi-Topology Storage Resolution

`FilesystemStorageAdapter` resolves tickets across 6 distinct storage topologies:

1. **Single Hub Topology**: `dataDir: "../esedre-data"` targeting a dedicated ticket repo (`projects/<ProjectCode>/tickets/<id>/`). Note: In project workspaces, `dataDir` is inherited from central user configuration (`~/.esedre/config.json`) when the hub contains the project, rather than hardcoded in `.esedre/esedre.json`, unless it is a local subdirectory of the repository.
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
            │   ├── lease.json            # Ephemeral TTL-backed advisory ticket lease
            │   ├── detail.md             # Markdown specification and breakdown
            │   ├── comments.json         # Historical developer and agent comments
            │   ├── implementation_plan.md# Active implementation plan
            │   ├── answers.json          # Developer answers to Open Decisions & Questions
            │   ├── inline-comments.json  # Highlighted text annotations & inline commentary
            │   └── attachments/          # Discussion media attachments (images/video)
            ├── 2/
            └── ...
```

## 4. Safe File Writing & `detail.md` Metadata Reconciliation

- All mutations use `writeSafeFile`, ensuring trailing newlines (`\n`) are preserved.
- Creates parent directories recursively if they do not already exist.
- **Metadata Header Reconciliation (`reconcileDetailMetadataHeaders`)**: Whenever a ticket's metadata (`title`, `type`, `status`, `priority`, `milestone`, `complexity`, `estimatedEffort`) is updated via `updateTicket`, `saveDetail`, `claimTicket`, or `releaseTicket`, `FilesystemStorageAdapter` reconciles and deduplicates top-of-file metadata header lines (both unbulleted `**Key**:` and bulleted `- **Key**:`) in `detail.md` so `detail.raw` never drifts from `meta.json`.
- **Canonical `detail.md` Section Parsing**: `parseDetailMarkdown` recognizes `### Feature Breakdown`, `### Task Breakdown`, `### Fix Breakdown`, and `### Implementation Breakdown` as first-class breakdown headings (preserving indented sub-bullets under numbered items), and accurately routes `- **Technical Detail**:`, `- **Architecture**:`, and `- **Root Cause**:` bullets to `technicalDetails[]` while keeping `openQuestions[]` scoped to open question bullets.

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

## 8. Cross-Project Ticket Linking & Dependency Graph Architecture

1. **Semantic Relations & Inverse Mapping**:
   - Tickets support bi-directional linked relationships across the same project or across different projects:
     - `relates-to` <-> `relates-to` (symmetric)
     - `blocks` <-> `blocked-by` (inverse asymmetric)
     - `parent-of` <-> `child-of` (inverse hierarchy)
     - `duplicates` <-> `duplicated-by` (inverse deduplication)
2. **Bi-Directional Synchronization & Consistency**:
   - Adding a link on Ticket A automatically registers the reciprocal inverse link on Ticket B when both are in storage scope.
   - Removing a link on either ticket automatically clears both sides.
3. **Dependency & Blocker Awareness**:
   - When any link with relation `blocked-by` points to a target ticket with status !== `'Completed'`, the ticket is dynamically projected with `isBlocked: true`.
   - The CLI formatter decorates blocked tickets with `[BLOCKED]` warning badges.
   - LLM agents query unblocked ready work via `ese list --blocked` or `esedre_list_tickets` with `isBlocked: false`.
4. **Cycle Detection Invariant**:
   - Cycle detection inspects `blocks` and `parent-of` relationship trees before persisting links.
   - Attempting to establish a circular dependency throws an error (`Cannot link ... would create a cycle`).
5. **Agent Project Allow-List Redaction**:
   - If an authorized ticket links to a target in a project outside the active workspace's `allowedProjects`, the link record is preserved, but target metadata is redacted to `targetTitle: '[Restricted Project]'` and target status/type are stripped.

## 9. Dedicated Milestones & Umbrella Feature Flags

1. **First-Class Entities**:
   - Milestones are stored in `projects/<Code>/milestones.json` (or `.esedre/milestones.json` in standalone repo mode), distinct from tickets.
   - Schema: `{ id: number, project: string, title: string, description?: string, status: 'Planned' | 'Active' | 'Completed' | 'Closed', featureFlag?: string, targetDate?: string, createdAt: string, updatedAt: string, completedAt?: string }`.
2. **Umbrella Feature Flag Inheritance**:
   - When a milestone declares an optional `featureFlag`, all member tickets linked to that milestone inherit the flag automatically (`meta.inheritedFeatureFlag = milestone.featureFlag`). If a member ticket does not specify its own `featureFlag`, it defaults to the milestone's umbrella flag. Setting `milestone: 'none'` unlinks the ticket and clears inherited flags.
3. **CLI & MCP Surface**:
   - CLI: `ese milestone [list|get|create|update|delete]`.
   - MCP: `esedre_list_milestones`, `esedre_get_milestone`, `esedre_create_milestone`, `esedre_update_milestone`.

## 10. Ticket Leases & Mutual Exclusion (`ese lease`)

1. **Ephemeral Lease File (`lease.json` & `ticket.lease`)**:
   - Stored in `projects/<Code>/tickets/<id>/lease.json` orthogonally to durable `meta.assignee`:
     `{ holder: string, system?: string, claimedAt: string, expiresAt: string, ttlMinutes: number, branch?: string, pid?: number }`.
2. **Storage Adapter Lease Methods**:
   - `claimTicket(id, input)`: Acquires a lease on a ticket (`In Development`, default 60m TTL). Throws `EsedreLeaseConflictError` if an unexpired lease is held by a different `holder` unless `force: true` is passed. Expired leases (`expiresAt <= now`) are automatically reclaimed.
   - `renewLease(id, input)`: Extends `expiresAt` for the active lease holder.
   - `releaseTicket(id, input)`: Removes `lease.json`, optionally transitions `status` (`Completed`, `Rejected`, or `Planned`, automatically clearing `isActivePlanning: false` on `Completed` or `Rejected`), and optionally appends completion notes to ticket comments.
   - `listActiveLeases(project?)`: Returns all unexpired leases across authorized projects.

## 11. Storage Migration & Multi-Version Compatibility Engine (`src/migrations/`)

1. **Version Stamping (`schemaVersion` & `esedreVersion`)**:
   - `project.json` and ticket `meta.json` record `schemaVersion` (`CURRENT_DATA_VERSION`, e.g. `'1.0.0'`) and `esedreVersion` (`CURRENT_ESEDRE_VERSION`, e.g. `'1.3.0'`).
   - Legacy manifests lacking `schemaVersion` default to `'1.0.0'`.
2. **Multi-Owner Compatibility Guards (`assertProjectCompatible`)**:
   - Normal read and write operations never silently auto-migrate older projects on shared or federated hubs.
   - Mutating adapter methods enforce `assertProjectCompatible(project, featureName?)`, throwing `EsedreVersionError`:
     - `BELOW_MIN_SUPPORTED`: Project schema is older than `MIN_SUPPORTED_DATA_VERSION`.
     - `ABOVE_CURRENT_ENGINE`: Project schema is newer than `CURRENT_DATA_VERSION` (prevents older Esedre clients from corrupting newer schemas).
     - `FEATURE_REQUIRES_UPGRADE`: A specific feature in `FEATURE_MIN_SCHEMA_VERSION` requires a higher schema version than the project currently uses.
3. **Explicit Upgrades & Atomic Backups (`runProjectMigrations`)**:
   - Triggered explicitly via `ese upgrade`, `ese upgrade --project <Code>`, or `ese upgrade --all`.
   - Before any schema transformation runs, `createProjectMigrationBackup` snapshots `project.json`, `milestones.json`, and `tickets/` into `~/.esedre/backups/<ProjectCode>-<timestamp>-v<from>/` with a `backup-manifest.json`.

