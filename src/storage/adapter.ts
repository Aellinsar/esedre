import { EsedreTicket, TicketMeta, TicketStatus, ProjectDescriptor, TicketComment, TicketType } from '../types.js';

export interface CreateTicketInput {
  title: string;
  type?: TicketType;
  category?: TicketType;
  complexity?: string;
  estimatedEffort?: string;
  effort?: string;
  projectCode?: string;
  projectId?: number;
  submittedBy?: string;
  summary?: string;
}

export interface ListTicketsFilter {
  project?: string;
  status?: TicketStatus;
  type?: TicketType;
  category?: TicketType;
  search?: string;
}

export interface RegisterProjectInput {
  code: string;
  name?: string;
  description?: string;
  colors?: {
    name?: string;
    badge?: string;
    dot?: string;
    border?: string;
  };
}

export interface StorageAdapter {
  listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]>;
  getTicket(id: number | string): Promise<EsedreTicket | null>;
  createTicket(input: CreateTicketInput): Promise<EsedreTicket>;
  updateTicket(id: number | string, updates: Partial<TicketMeta>, lastHash?: string): Promise<EsedreTicket>;
  getPlan(id: number | string): Promise<string | null>;
  savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void>;
  addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment>;
  getProjects(): Promise<ProjectDescriptor[]>;
  registerProject(input: RegisterProjectInput): Promise<ProjectDescriptor>;
}

