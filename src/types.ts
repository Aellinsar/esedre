export const CURRENT_ESEDRE_VERSION = '0.1.12';

export type TicketType = 'Feature' | 'Platform' | 'Tools' | 'Idea' | 'Bug';
export type TicketCategory = TicketType; // Back-compat alias
export type TicketStatus = 'Planned' | 'In Development' | 'Completed' | 'Rejected';

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
}

export interface TicketMeta {
  id: number;
  title: string;
  type: TicketType;
  category: TicketType;
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
  complexity?: string;
  estimatedEffort?: string;
  summary?: string;
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
