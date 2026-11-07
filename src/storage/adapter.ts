import {
  EsedreTicket,
  TicketMeta,
  TicketStatus,
  TicketStatusFilter,
  ProjectDescriptor,
  TicketComment,
  TicketType,
  TicketPriority,
  UpdateProjectInput,
  RenameProjectCodeInput,
  RenameProjectCodeResult,
  Milestone,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  TicketLinkRelation,
  TicketLease,
  ClaimLeaseInput,
  RenewLeaseInput,
  ReleaseLeaseInput,
  ClaimLeaseResult,
  GitSyncStatusReport,
  GitSyncResult,
} from '../types.js';

export interface SyncDataHubCallOptions {
  hubDir?: string;
  pull?: boolean;
  push?: boolean;
  commit?: boolean;
  force?: boolean;
}

export interface CreateTicketLinkInput {
  relation: TicketLinkRelation;
  targetTicketId?: number | string;
  targetId?: number | string;
}

export interface CreateTicketInput {
  title: string;
  type?: TicketType;
  category?: TicketType;
  priority?: TicketPriority | string;
  complexity?: string;
  estimatedEffort?: string;
  effort?: string;
  projectCode?: string;
  project?: string;
  projectId?: number;
  submittedBy?: string;
  summary?: string;
  detail?: string;
  detailMarkdown?: string;
  plan?: string;
  planMarkdown?: string;
  milestone?: string;
  featureFlag?: string;
  links?: CreateTicketLinkInput[];
}

export interface ListTicketsFilter {
  project?: string;
  status?: TicketStatusFilter | string;
  type?: TicketType;
  category?: TicketType;
  priority?: TicketPriority | 'none' | string;
  milestone?: string;
  featureFlag?: string;
  isBlocked?: boolean;
  linkedTo?: string;
  leased?: boolean;
  leasedBy?: string;
  search?: string;
}

export interface RegisterProjectInput {
  code: string;
  name?: string;
  description?: string;
  hub?: string;
  colors?: {
    name?: string;
    badge?: string;
    dot?: string;
    border?: string;
  };
}

export interface DuplicateProjectWarning {
  code: string;
  firstHub: string;
  duplicateHub: string;
}

export interface UpdateTicketInput extends Omit<Partial<TicketMeta>, 'priority' | 'featureFlag' | 'milestone'> {
  priority?: TicketPriority | 'none' | null | string;
  featureFlag?: string | null;
  milestone?: string | null;
  summary?: string;
  detail?: string;
  detailMarkdown?: string;
  plan?: string | null;
  planMarkdown?: string | null;
}

export interface StorageAdapter {
  listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]>;
  getTicket(id: number | string): Promise<EsedreTicket | null>;
  createTicket(input: CreateTicketInput): Promise<EsedreTicket>;
  updateTicket(
    id: number | string,
    updates: UpdateTicketInput,
    lastHash?: string
  ): Promise<EsedreTicket>;
  getPlan(id: number | string): Promise<string | null>;
  savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void>;
  addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment>;
  addTicketLink(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetId: number | string,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }>;
  addTicketLinks?(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetIds: Array<number | string>,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; targets: EsedreTicket[] }>;
  removeTicketLinks?(
    sourceId: number | string,
    targetIds: Array<number | string>,
    options?: { relation?: TicketLinkRelation; project?: string }
  ): Promise<{ source: EsedreTicket; targets: EsedreTicket[] }>;
  removeTicketLink(
    sourceId: number | string,
    targetId: number | string,
    options?: { relation?: TicketLinkRelation; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }>;
  getProjects(): Promise<ProjectDescriptor[]>;
  registerProject(input: RegisterProjectInput): Promise<ProjectDescriptor>;
  updateProject(input: UpdateProjectInput): Promise<ProjectDescriptor>;
  renameProjectCode(input: RenameProjectCodeInput): Promise<RenameProjectCodeResult>;
  listMilestones(projectCode?: string): Promise<Milestone[]>;
  getMilestone(id: number | string, projectCode?: string): Promise<Milestone | null>;
  createMilestone(input: CreateMilestoneInput): Promise<Milestone>;
  updateMilestone(id: number | string, input: UpdateMilestoneInput, projectCode?: string): Promise<Milestone>;
  deleteMilestone(id: number | string, projectCode?: string): Promise<boolean>;
  getAnswers(id: number | string): Promise<Record<string, string>>;
  saveAnswer(id: number | string, questionIndex: number, answer: string): Promise<Record<string, string>>;
  saveDetail(
    id: number | string,
    detailMarkdown: string,
    metaUpdates?: Partial<TicketMeta>
  ): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }>;
  getInlineComments?(id: number | string): Promise<any[]>;
  saveInlineComment?(
    id: number | string,
    selectedText: string,
    comment: string,
    author?: string
  ): Promise<any[]>;
  saveAttachment?(
    id: number | string,
    filename: string,
    buffer: Buffer
  ): Promise<{ filename: string; relativePath: string }>;
  getAttachmentPath?(id: number | string, filename: string): string | null;
  getDuplicateProjectWarnings?(): DuplicateProjectWarning[];
  getWorkspaceRoot?(): string | undefined;
  getProjectRepoRoot?(projectCode: string): string | undefined;
  prewarmCache?(options?: { chunkSize?: number }): Promise<void>;
  getCacheGeneration?(): number;
  closeWatchers?(): void;

  claimTicket(input: ClaimLeaseInput): Promise<ClaimLeaseResult>;
  renewLease(input: RenewLeaseInput): Promise<TicketLease>;
  releaseTicket(input: ReleaseLeaseInput): Promise<{ released: boolean; ticketKey: string; previousLease?: TicketLease }>;
  getTicketLease(id: number | string, projectCode?: string): Promise<TicketLease | null>;
  listLeases(projectCode?: string): Promise<TicketLease[]>;

  getSyncStatus?(hubDir?: string): Promise<GitSyncStatusReport>;
  syncDataHub?(options?: SyncDataHubCallOptions): Promise<GitSyncResult[]>;
}
