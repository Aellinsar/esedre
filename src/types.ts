export const CURRENT_ESEDRE_VERSION = '0.1.12';

export type TicketType = 'Feature' | 'Platform' | 'Tools' | 'Idea' | 'Bug';
export type TicketCategory = TicketType; // Back-compat alias
export type TicketStatus = 'Planned' | 'In Development' | 'Completed' | 'Rejected';
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
  description?: string;
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
  projectId?: number;
  project?: string;
  lastHash?: string;
  sha1?: string;
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
  links?: EnrichedTicketLink[];
  isBlocked?: boolean;
  projectDescriptor?: ProjectDescriptor;
  lastHash?: string;
  sha1?: string;
}

export type Ticket = EsedreTicket;

export class EsedreConflictError extends Error {
  constructor(
    public readonly ticketId: string | number,
    public readonly currentHash: string,
    public readonly lastHash: string
  ) {
    super(
      `Conflict: Ticket #${ticketId} has been modified (current: ${currentHash.slice(0, 8)}, provided lastHash: ${lastHash.slice(0, 8)}). Refresh state and retry.`
    );
    this.name = 'EsedreConflictError';
  }
}
