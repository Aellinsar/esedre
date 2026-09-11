import { EsedreTicket, TicketMeta, ProjectDescriptor, TicketComment } from './types.js';
import { StorageAdapter, CreateTicketInput, ListTicketsFilter, RegisterProjectInput, DuplicateProjectWarning } from './storage/adapter.js';
import { EsedreConfig, isProjectAuthorized, EsedreAuthorizationError } from './config.js';

export class SecurityFilter implements StorageAdapter {
  constructor(
    private readonly target: StorageAdapter,
    private readonly config: EsedreConfig = {}
  ) {}

  public getDuplicateProjectWarnings(): DuplicateProjectWarning[] {
    return this.target.getDuplicateProjectWarnings ? this.target.getDuplicateProjectWarnings() : [];
  }

  public async getProjects(): Promise<ProjectDescriptor[]> {
    const projs = await this.target.getProjects();
    if (!this.config.allowedProjects || this.config.allowedProjects.length === 0) {
      return projs;
    }
    return projs.filter((p) => isProjectAuthorized(p.code, this.config.allowedProjects));
  }

  public async registerProject(input: RegisterProjectInput): Promise<ProjectDescriptor> {
    const proj = await this.target.registerProject(input);
    if (this.config.allowedProjects && !this.config.allowedProjects.includes('*')) {
      const upper = proj.code.toUpperCase();
      if (!this.config.allowedProjects.some((p) => p.toUpperCase() === upper)) {
        this.config.allowedProjects.push(proj.code);
      }
    }
    return proj;
  }

  public async listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]> {
    if (filter?.project && !isProjectAuthorized(filter.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(filter.project);
    }
    const tickets = await this.target.listTickets(filter);
    if (!this.config.allowedProjects || this.config.allowedProjects.length === 0) {
      return tickets;
    }
    return tickets.filter((t) => {
      const code = t.projectDescriptor?.code || t.meta.project;
      if (!code) return true;
      return isProjectAuthorized(code, this.config.allowedProjects);
    });
  }

  public async getTicket(id: number | string): Promise<EsedreTicket | null> {
    const ticket = await this.target.getTicket(id);
    if (!ticket) return null;
    const code = ticket.projectDescriptor?.code || ticket.meta.project;
    if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(code);
    }
    return ticket;
  }

  public async createTicket(input: CreateTicketInput): Promise<EsedreTicket> {
    const targetCode = input.projectCode || this.config.projectCode;
    if (targetCode && !isProjectAuthorized(targetCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(targetCode);
    }
    return this.target.createTicket(input);
  }

  public async updateTicket(id: number | string, updates: Partial<TicketMeta>, lastHash?: string): Promise<EsedreTicket> {
    const existing = await this.target.getTicket(id);
    if (existing) {
      const code = existing.projectDescriptor?.code || existing.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    if (updates.project && !isProjectAuthorized(updates.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(updates.project);
    }
    return this.target.updateTicket(id, updates, lastHash);
  }

  public async getPlan(id: number | string): Promise<string | null> {
    const ticket = await this.target.getTicket(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.getPlan(id);
  }

  public async savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void> {
    const ticket = await this.target.getTicket(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.savePlan(id, planMarkdown, lastHash);
  }

  public async addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment> {
    const ticket = await this.target.getTicket(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.addComment(id, comment);
  }
}
