import {
  EsedreTicket,
  TicketMeta,
  ProjectDescriptor,
  TicketComment,
  UpdateProjectInput,
  RenameProjectCodeInput,
  RenameProjectCodeResult,
  Milestone,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  TicketLinkRelation,
} from './types.js';
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

  public async updateProject(input: UpdateProjectInput): Promise<ProjectDescriptor> {
    if (!isProjectAuthorized(input.code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(input.code);
    }
    return this.target.updateProject(input);
  }

  public async renameProjectCode(input: RenameProjectCodeInput): Promise<RenameProjectCodeResult> {
    if (!isProjectAuthorized(input.oldCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(input.oldCode);
    }
    const result = await this.target.renameProjectCode(input);
    if (this.config.allowedProjects && !this.config.allowedProjects.includes('*')) {
      const oldUpper = input.oldCode.toUpperCase();
      const idx = this.config.allowedProjects.findIndex((p) => p.toUpperCase() === oldUpper);
      if (idx >= 0) {
        this.config.allowedProjects[idx] = result.newCode;
      }
    }
    return result;
  }

  private redactLinks(ticket: EsedreTicket): EsedreTicket {
    if (!ticket.links || ticket.links.length === 0) return ticket;
    if (!this.config.allowedProjects || this.config.allowedProjects.includes('*')) {
      return ticket;
    }
    for (const link of ticket.links) {
      if (link.targetProject && !isProjectAuthorized(link.targetProject, this.config.allowedProjects)) {
        link.targetTitle = '[Restricted Project]';
        delete link.targetType;
        delete link.targetStatus;
        delete link.targetPriority;
        delete link.isBlockedByUncompleted;
        link.isResolved = false;
      }
    }
    return ticket;
  }

  public async listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]> {
    if (filter?.project && !isProjectAuthorized(filter.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(filter.project);
    }
    const tickets = await this.target.listTickets(filter);
    if (!this.config.allowedProjects || this.config.allowedProjects.length === 0) {
      return tickets.map((t) => this.redactLinks(t));
    }
    return tickets
      .filter((t) => {
        const code = t.projectDescriptor?.code || t.meta.project;
        if (!code) return true;
        return isProjectAuthorized(code, this.config.allowedProjects);
      })
      .map((t) => this.redactLinks(t));
  }

  public async getTicket(id: number | string): Promise<EsedreTicket | null> {
    const ticket = await this.target.getTicket(id);
    if (!ticket) return null;
    const code = ticket.projectDescriptor?.code || ticket.meta.project;
    if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(code);
    }
    return this.redactLinks(ticket);
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

  public async listMilestones(projectCode?: string): Promise<Milestone[]> {
    if (projectCode && projectCode !== 'all' && !isProjectAuthorized(projectCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(projectCode);
    }
    const all = await this.target.listMilestones(projectCode);
    if (!this.config.allowedProjects || this.config.allowedProjects.length === 0) {
      return all;
    }
    if (this.config.allowedProjects.includes('*')) {
      return all;
    }
    return all.filter((m) => isProjectAuthorized(m.project, this.config.allowedProjects));
  }

  public async getMilestone(id: number | string, projectCode?: string): Promise<Milestone | null> {
    if (projectCode && projectCode !== 'all' && !isProjectAuthorized(projectCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(projectCode);
    }
    const milestone = await this.target.getMilestone(id, projectCode);
    if (!milestone) return null;
    if (milestone.project && !isProjectAuthorized(milestone.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(milestone.project);
    }
    return milestone;
  }

  public async createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
    const targetCode = input.projectCode || this.config.projectCode;
    if (targetCode && !isProjectAuthorized(targetCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(targetCode);
    }
    return this.target.createMilestone(input);
  }

  public async updateMilestone(id: number | string, input: UpdateMilestoneInput, projectCode?: string): Promise<Milestone> {
    const existing = await this.target.getMilestone(id, projectCode);
    if (existing) {
      if (existing.project && !isProjectAuthorized(existing.project, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(existing.project);
      }
    }
    return this.target.updateMilestone(id, input, projectCode);
  }

  public async deleteMilestone(id: number | string, projectCode?: string): Promise<boolean> {
    const existing = await this.target.getMilestone(id, projectCode);
    if (existing) {
      if (existing.project && !isProjectAuthorized(existing.project, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(existing.project);
      }
    }
    return this.target.deleteMilestone(id, projectCode);
  }

  public async addTicketLink(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetId: number | string,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    const sourceTicket = await this.target.getTicket(sourceId);
    if (sourceTicket) {
      const code = sourceTicket.projectDescriptor?.code || sourceTicket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    } else if (options?.project && !isProjectAuthorized(options.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(options.project);
    }
    const result = await this.target.addTicketLink(sourceId, relation, targetId, options);
    return {
      source: this.redactLinks(result.source),
      target: result.target ? this.redactLinks(result.target) : undefined,
    };
  }

  public async removeTicketLink(
    sourceId: number | string,
    targetId: number | string,
    options?: { relation?: TicketLinkRelation; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    const sourceTicket = await this.target.getTicket(sourceId);
    if (sourceTicket) {
      const code = sourceTicket.projectDescriptor?.code || sourceTicket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    } else if (options?.project && !isProjectAuthorized(options.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(options.project);
    }
    const result = await this.target.removeTicketLink(sourceId, targetId, options);
    return {
      source: this.redactLinks(result.source),
      target: result.target ? this.redactLinks(result.target) : undefined,
    };
  }
}
