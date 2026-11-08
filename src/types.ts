export const CURRENT_ESEDRE_VERSION = '1.3.0';

export type TicketType = 'Feature' | 'Platform' | 'Tools' | 'Idea' | 'Bug';
export type TicketCategory = TicketType; // Back-compat alias
export type TicketStatus = 'Planned' | 'In Development' | 'Completed' | 'Rejected';
export type TicketStatusFilter = TicketStatus | 'active' | 'open' | 'closed';

export function isTerminalTicketStatus(status?: string | null): boolean {
  if (!status || typeof status !== 'string') return false;
  const norm = status.trim().toLowerCase();
  return norm === 'completed' || norm === 'complete' || norm === 'rejected';
}

export function matchesTicketStatusFilter(
  ticketStatus: string | undefined | null,
  filterStatus?: string | null
): boolean {
  if (!filterStatus || typeof filterStatus !== 'string') return true;
  const f = filterStatus.trim().toLowerCase();
  if (!f) return true;
  const s = (ticketStatus || '').trim().toLowerCase();
  if (f === 'active' || f === 'open') {
    return !isTerminalTicketStatus(ticketStatus);
  }
  if (f === 'closed') {
    return isTerminalTicketStatus(ticketStatus);
  }
  if (f === 'completed' || f === 'complete') {
    return s === 'completed' || s === 'complete';
  }
  if (
    f === 'in development' ||
    f === 'in-development' ||
    f === 'in_development' ||
    f === 'in-dev' ||
    f === 'indev' ||
    f === 'in progress' ||
    f === 'in-progress' ||
    f === 'in_progress'
  ) {
    return s === 'in development';
  }
  return s === f;
}

export type TicketPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface ProjectDescriptor {
  id: number;
  code: string;
  name: string;
  description: string;
  colors?: {
    name?: string;
    badge?: string;
    dot?: string;
    border?: string;
  };
  techStack?: Record<string, string> | string[];
  groundingRules?: string[];
  guidelinesRef?: string;
  pinSchemaVersion?: boolean;
  schemaVersion?: string;
  esedreVersion?: string;
}

export interface UpdateProjectInput {
  code: string;
  name?: string;
  description?: string;
  colors?: {
    name?: string;
    badge?: string;
    dot?: string;
    border?: string;
  };
  techStack?: Record<string, string> | string[];
  groundingRules?: string[];
  guidelinesRef?: string;
  pinSchemaVersion?: boolean;
}

export interface RenameProjectCodeInput {
  oldCode: string;
  newCode: string;
  newName?: string;
}

export interface RenameProjectCodeResult {
  success: boolean;
  oldCode: string;
  newCode: string;
  project: ProjectDescriptor;
  migratedTicketsCount: number;
  updatedHubs: string[];
  updatedConfigs: string[];
}

export type MilestoneStatus = 'Planned' | 'Active' | 'Completed' | 'Closed';

export interface Milestone {
  id: number;
  project: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  featureFlag?: string; // Optional umbrella feature flag inherited by tickets in this milestone
  targetDate?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface CreateMilestoneInput {
  projectCode?: string;
  title: string;
  description?: string;
  status?: MilestoneStatus;
  featureFlag?: string;
  targetDate?: string;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  status?: MilestoneStatus;
  featureFlag?: string | null;
  targetDate?: string | null;
}

export type TicketLinkRelation =
  | 'relates-to'
  | 'blocks'
  | 'blocked-by'
  | 'parent-of'
  | 'child-of'
  | 'duplicates'
  | 'duplicated-by';

export const INVERSE_RELATIONS: Record<TicketLinkRelation, TicketLinkRelation> = {
  'relates-to': 'relates-to',
  'blocks': 'blocked-by',
  'blocked-by': 'blocks',
  'parent-of': 'child-of',
  'child-of': 'parent-of',
  'duplicates': 'duplicated-by',
  'duplicated-by': 'duplicates',
};

export interface TicketLink {
  relation: TicketLinkRelation;
  targetKey: string;      // Canonical compound key, e.g. "Lab151-1" or "Esedre-12"
  targetProject: string;  // Canonical project code, e.g. "Lab151"
  targetId: number;       // Numeric ticket ID, e.g. 1
  createdAt: string;      // ISO 8601 timestamp
  createdBy?: string;     // Author or LLM Agent identifier
}

export interface EnrichedTicketLink extends TicketLink {
  targetTitle?: string;
  targetType?: TicketType;
  targetStatus?: TicketStatus;
  targetPriority?: TicketPriority;
  isResolved?: boolean;
  isTargetCompleted?: boolean;
  isBlockedByUncompleted?: boolean;
}

export interface TicketMeta {
  id: number;
  title: string;
  type: TicketType;
  category: TicketType;
  priority?: TicketPriority;
  complexity: string;
  estimatedEffort?: string;
  submittedBy?: string;
  timestamp?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  revision?: number;
  status: TicketStatus;
  isActivePlanning?: boolean;
  featureFlag?: string;
  milestone?: string;
  inheritedFeatureFlag?: string;
  links?: TicketLink[];
  lease?: TicketLease | null;
  projectId?: number;
  project?: string;
  schemaVersion?: string;
  esedreVersion?: string;
  lastHash?: string;
  sha1?: string;
}

export interface TicketUpdatePayload extends Omit<Partial<TicketMeta>, 'priority' | 'featureFlag' | 'milestone'> {
  priority?: TicketPriority | 'none' | null | string;
  featureFlag?: string | null;
  milestone?: string | null;
  detail?: string;
  detailMarkdown?: string;
  plan?: string | null;
  planMarkdown?: string | null;
}

export interface TicketComment {
  id: string;
  timestamp: string;
  author: string;
  text: string;
}

export interface TicketDetail {
  title: string;
  type?: TicketType;
  category?: TicketType; // Back-compat alias
  priority?: TicketPriority;
  complexity?: string;
  estimatedEffort?: string;
  summary?: string;
  milestone?: string;
  inheritedFeatureFlag?: string;
  breakdown: string[];
  technicalDetails?: string[];
  openQuestions?: string[];
  raw: string;
}

export interface EsedreTicket {
  meta: TicketMeta;
  detail?: TicketDetail;
  planMarkdown?: string;
  comments: TicketComment[];
  answers?: Record<string, string>;
  inlineComments?: any[];
  links?: EnrichedTicketLink[];
  isBlocked?: boolean;
  lease?: TicketLease | null;
  projectDescriptor?: ProjectDescriptor;
  lastHash?: string;
  sha1?: string;
}

export const DEFAULT_LEASE_TTL_MINUTES = 60;

export interface TicketLease {
  ticketId: number;
  ticketKey: string;
  project: string;
  holder: string;
  agentType?: string;
  hostname?: string;
  sessionId?: string;
  branch?: string;
  worktree?: string;
  claimedAt: string;
  renewedAt: string;
  expiresAt: string;
  ttlMinutes: number;
  preClaimSha1?: string;
  claimRevision?: number;
}

export interface ClaimLeaseInput {
  ticketId: number | string;
  holder?: string;
  agentType?: string;
  hostname?: string;
  sessionId?: string;
  branch?: string;
  worktree?: string;
  ttlMinutes?: number;
  force?: boolean;
  statusOnClaim?: TicketStatus;
  project?: string;
}

export interface RenewLeaseInput {
  ticketId: number | string;
  holder?: string;
  ttlMinutes?: number;
  force?: boolean;
  project?: string;
}

export interface ReleaseLeaseInput {
  ticketId: number | string;
  holder?: string;
  force?: boolean;
  project?: string;
}

export interface ClaimLeaseResult {
  lease: TicketLease;
  ticket: EsedreTicket;
  renewed: boolean;
  overridden?: boolean;
}

export class EsedreLeaseConflictError extends Error {
  public readonly ticketKey: string;
  public readonly activeLease: TicketLease;

  constructor(ticketKey: string, activeLease: TicketLease) {
    super(
      `Lease Conflict on Ticket ${ticketKey}: currently leased by '${activeLease.holder}'${
        activeLease.hostname ? ` on ${activeLease.hostname}` : ''
      } until ${activeLease.expiresAt}. Pass --force (or force: true) to override.`
    );
    this.name = 'EsedreLeaseConflictError';
    this.ticketKey = ticketKey;
    this.activeLease = activeLease;
  }
}

export type Ticket = EsedreTicket;

export class EsedreConflictError extends Error {
  constructor(
    public readonly ticketId: string | number,
    public readonly currentHash: string,
    public readonly lastHash: string
  ) {
    super(
      `Conflict: Ticket #${ticketId} has been modified (current: ${currentHash}, provided lastHash: ${lastHash}). Refresh state and retry.`
    );
    this.name = 'EsedreConflictError';
  }
}

export interface GitSyncConfig {
  enabled?: boolean;
  remote?: string;
  branch?: string;
  push?: boolean;
  pullOnStart?: boolean;
  debounceSeconds?: number;
  intervalMinutes?: number;
}

export type SyncMutationAction =
  | 'create-ticket'
  | 'update-ticket'
  | 'complete-ticket'
  | 'reject-ticket'
  | 'save-plan'
  | 'add-comment'
  | 'link-ticket'
  | 'unlink-ticket'
  | 'create-milestone'
  | 'update-milestone'
  | 'upgrade-project'
  | 'update-project';

export interface SyncMutationEvent {
  hubDir: string;
  action: SyncMutationAction;
  project: string;
  ticketId?: number;
  ticketKey?: string;
  title?: string;
  changedFields?: string[];
  targetKey?: string;
  milestoneId?: string | number;
  timestamp: string;
}

export type GitSyncStatusState = 'idle' | 'syncing' | 'offline' | 'conflict' | 'error' | 'disabled';

export interface GitSyncHubMetrics {
  totalSyncs: number;
  totalCommits: number;
  totalPulls: number;
  totalPushes: number;
  totalConflicts: number;
  totalErrors: number;
  lastDurationMs?: number;
}

export interface GitSyncHubStatus {
  hubDir: string;
  enabled: boolean;
  remote: string;
  branch: string;
  push: boolean;
  status: GitSyncStatusState;
  pendingCommits: number;
  dirtyFilesCount?: number;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  lastSyncedAt?: string;
  lastError?: string;
  projects?: string[];
  metrics?: GitSyncHubMetrics;
}

export interface ProjectSyncMode {
  code: string;
  name: string;
  storageMode: 'hub' | 'in-repo';
  hubDir?: string;
  autoSyncEligible: boolean;
}

export interface GitSyncResult {
  hubDir: string;
  committed: boolean;
  pulled: boolean;
  pushed: boolean;
  commitSha?: string;
  commitMessage?: string;
  pendingCommits: number;
  status: GitSyncStatusState;
  error?: string;
}

export interface GitSyncStatusReport {
  enabled: boolean;
  config: Required<GitSyncConfig>;
  hubs: GitSyncHubStatus[];
  projectModes?: ProjectSyncMode[];
}

