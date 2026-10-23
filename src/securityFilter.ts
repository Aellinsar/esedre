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
  TicketLease,
  ClaimLeaseInput,
  RenewLeaseInput,
  ReleaseLeaseInput,
  ClaimLeaseResult,
  EsedreLeaseConflictError,
} from './types.js';
import { StorageAdapter, CreateTicketInput, UpdateTicketInput, ListTicketsFilter, RegisterProjectInput, DuplicateProjectWarning } from './storage/adapter.js';
import { EsedreConfig, isProjectAuthorized, EsedreAuthorizationError } from './config.js';
import { isPathInside } from './utils/identity.js';

export class SecurityFilter implements StorageAdapter {
  constructor(
    private readonly target: StorageAdapter,
    private readonly config: EsedreConfig = {}
  ) {}

  public getTargetStorage(): StorageAdapter {
    return this.target;
  }

  public getConfig(): EsedreConfig {
    return this.config;
  }

  public getDuplicateProjectWarnings(): DuplicateProjectWarning[] {
    return this.target.getDuplicateProjectWarnings ? this.target.getDuplicateProjectWarnings() : [];
  }

  public getProjectRepoRoot(projectCode: string): string | undefined {
    if (!isProjectAuthorized(projectCode, this.config.allowedProjects)) {
      return undefined;
    }
    return this.target.getProjectRepoRoot ? this.target.getProjectRepoRoot(projectCode) : undefined;
  }

  public getWorkspaceRoot(): string | undefined {
    return this.target.getWorkspaceRoot ? this.target.getWorkspaceRoot() : undefined;
  }

  public async prewarmCache(options?: { chunkSize?: number }): Promise<void> {
    if (this.target.prewarmCache) {
      await this.target.prewarmCache(options);
    } else {
      await this.target.listTickets({});
    }
  }

  public getCacheGeneration(): number {
    return this.target.getCacheGeneration ? this.target.getCacheGeneration() : 0;
  }

  public closeWatchers(): void {
    if (this.target.closeWatchers) {
      this.target.closeWatchers();
    }
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

  private redactLease(lease?: TicketLease | null): TicketLease | undefined {
    if (!lease) return undefined;
    if (!lease.worktree) return { ...lease };
    const wsRoot = this.getWorkspaceRoot();
    if (wsRoot && isPathInside(lease.worktree, wsRoot)) {
      return { ...lease };
    }
    const { worktree: _worktree, ...clean } = lease;
    return clean;
  }

  private redactLinks(ticket: EsedreTicket): EsedreTicket {
    let clonedTicket: EsedreTicket = ticket;
    if (ticket.lease || ticket.meta?.lease) {
      const redactedTopLease = this.redactLease(ticket.lease);
      const redactedMetaLease = this.redactLease(ticket.meta?.lease);
      clonedTicket = {
        ...ticket,
        ...(redactedTopLease ? { lease: redactedTopLease } : {}),
        meta: {
          ...ticket.meta,
          ...(redactedMetaLease ? { lease: redactedMetaLease } : {}),
        },
      };
    }

    if (!clonedTicket.links || clonedTicket.links.length === 0) return clonedTicket;
    if (!this.config.allowedProjects || this.config.allowedProjects.includes('*')) {
      return clonedTicket;
    }
    const redactedLinks = clonedTicket.links.map((link) => {
      if (link.targetProject && !isProjectAuthorized(link.targetProject, this.config.allowedProjects)) {
        const copy = { ...link, targetTitle: '[Restricted Project]', isResolved: false };
        delete copy.targetType;
        delete copy.targetStatus;
        delete copy.targetPriority;
        delete copy.isBlockedByUncompleted;
        return copy;
      }
      return link;
    });
    return {
      ...clonedTicket,
      links: redactedLinks,
    };
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

  private async resolveTicketLookup(
    id: number | string,
    project?: string
  ): Promise<{ lookupId: number | string; ticket: EsedreTicket | null }> {
    if (project && project.trim() && project.trim().toLowerCase() !== 'all') {
      const qualified = this.qualifyTicketId(id, project);
      const ticket = await this.target.getTicket(qualified);
      return { lookupId: qualified, ticket };
    }
    try {
      const ticket = await this.target.getTicket(id);
      if (ticket) {
        return { lookupId: id, ticket };
      }
    } catch (err: any) {
      if (this.config.projectCode && /Ambiguous ticket/i.test(String(err?.message || ''))) {
        const qualified = this.qualifyTicketId(id);
        const ticket = await this.target.getTicket(qualified);
        return { lookupId: qualified, ticket };
      }
      throw err;
    }

    const qualified = this.qualifyTicketId(id);
    if (qualified !== id) {
      const ticket = await this.target.getTicket(qualified);
      if (ticket) {
        return { lookupId: qualified, ticket };
      }
    }
    return { lookupId: id, ticket: null };
  }

  public async getTicket(id: number | string): Promise<EsedreTicket | null> {
    const { ticket } = await this.resolveTicketLookup(id);
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
    const created = await this.target.createTicket({
      ...input,
      ...(targetCode ? { projectCode: targetCode } : {}),
    });
    return this.redactLinks(created);
  }

  public async updateTicket(id: number | string, updates: UpdateTicketInput, lastHash?: string): Promise<EsedreTicket> {
    const { lookupId, ticket: existing } = await this.resolveTicketLookup(id, updates.project);
    if (existing) {
      const code = existing.projectDescriptor?.code || existing.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    if (updates.project && !isProjectAuthorized(updates.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(updates.project);
    }
    const updated = await this.target.updateTicket(lookupId, updates, lastHash);
    return this.redactLinks(updated);
  }

  public async getPlan(id: number | string): Promise<string | null> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.getPlan(lookupId);
  }

  public async savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.savePlan(lookupId, planMarkdown, lastHash);
  }

  public async addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.addComment(lookupId, comment);
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
    const milestone = await this.target.getMilestone(id, projectCode || this.config.projectCode);
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
    return this.target.createMilestone({
      ...input,
      ...(targetCode ? { projectCode: targetCode } : {}),
    });
  }

  public async updateMilestone(id: number | string, input: UpdateMilestoneInput, projectCode?: string): Promise<Milestone> {
    const effectiveProject = projectCode || this.config.projectCode;
    const existing = await this.target.getMilestone(id, effectiveProject);
    if (existing) {
      if (existing.project && !isProjectAuthorized(existing.project, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(existing.project);
      }
    }
    return this.target.updateMilestone(id, input, effectiveProject);
  }

  public async deleteMilestone(id: number | string, projectCode?: string): Promise<boolean> {
    const effectiveProject = projectCode || this.config.projectCode;
    const existing = await this.target.getMilestone(id, effectiveProject);
    if (existing) {
      if (existing.project && !isProjectAuthorized(existing.project, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(existing.project);
      }
    }
    return this.target.deleteMilestone(id, effectiveProject);
  }

  private qualifyTicketId(id: number | string, project?: string): number | string {
    const effectiveProject = project || this.config.projectCode;
    const clean = String(id).trim().replace(/^#/, '');
    if (
      effectiveProject &&
      effectiveProject.trim() &&
      effectiveProject.trim().toLowerCase() !== 'all' &&
      /^\d+$/.test(clean)
    ) {
      return `${effectiveProject.trim()}-${clean}`;
    }
    return id;
  }

  public async addTicketLink(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetId: number | string,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    const lookupSourceId = this.qualifyTicketId(sourceId, options?.project);
    const lookupTargetId = this.qualifyTicketId(targetId, options?.project);
    const sourceTicket = await this.target.getTicket(lookupSourceId);
    if (sourceTicket) {
      const code = sourceTicket.projectDescriptor?.code || sourceTicket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    } else if (options?.project && !isProjectAuthorized(options.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(options.project);
    }
    const result = await this.target.addTicketLink(lookupSourceId, relation, lookupTargetId, options);
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
    const lookupSourceId = this.qualifyTicketId(sourceId, options?.project);
    const lookupTargetId = this.qualifyTicketId(targetId, options?.project);
    const sourceTicket = await this.target.getTicket(lookupSourceId);
    if (sourceTicket) {
      const code = sourceTicket.projectDescriptor?.code || sourceTicket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    } else if (options?.project && !isProjectAuthorized(options.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(options.project);
    }
    const result = await this.target.removeTicketLink(lookupSourceId, lookupTargetId, options);
    return {
      source: this.redactLinks(result.source),
      target: result.target ? this.redactLinks(result.target) : undefined,
    };
  }

  public async getAnswers(id: number | string): Promise<Record<string, string>> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.getAnswers(lookupId);
  }

  public async saveAnswer(id: number | string, questionIndex: number, answer: string): Promise<Record<string, string>> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.saveAnswer(lookupId, questionIndex, answer);
  }

  public async saveDetail(
    id: number | string,
    detailMarkdown: string,
    metaUpdates?: Partial<TicketMeta>
  ): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.saveDetail(lookupId, detailMarkdown, metaUpdates);
  }

  public async getInlineComments(id: number | string): Promise<any[]> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.getInlineComments ? this.target.getInlineComments(lookupId) : [];
  }

  public async saveInlineComment(
    id: number | string,
    selectedText: string,
    comment: string,
    author?: string
  ): Promise<any[]> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    return this.target.saveInlineComment ? this.target.saveInlineComment(lookupId, selectedText, comment, author) : [];
  }

  public async saveAttachment(
    id: number | string,
    filename: string,
    buffer: Buffer
  ): Promise<{ filename: string; relativePath: string }> {
    const { lookupId, ticket } = await this.resolveTicketLookup(id);
    if (ticket) {
      const code = ticket.projectDescriptor?.code || ticket.meta.project;
      if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
        throw new EsedreAuthorizationError(code);
      }
    }
    if (!this.target.saveAttachment) {
      throw new Error('Attachments are not supported by target storage adapter.');
    }
    return this.target.saveAttachment(lookupId, filename, buffer);
  }

  public getAttachmentPath(id: number | string, filename: string): string | null {
    if ((this.target as any).findTicketLocation) {
      const locInfo =
        (this.target as any).findTicketLocation(id) ||
        (this.target as any).findTicketLocation(this.qualifyTicketId(id));
      if (locInfo) {
        const code = locInfo.loc?.project?.code;
        if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
          throw new EsedreAuthorizationError(code);
        }
      }
    }
    return this.target.getAttachmentPath ? this.target.getAttachmentPath(id, filename) : null;
  }

  public async claimTicket(input: ClaimLeaseInput): Promise<ClaimLeaseResult> {
    if (input.project && !isProjectAuthorized(input.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(input.project);
    }
    const { lookupId, ticket } = await this.resolveTicketLookup(input.ticketId, input.project);
    if (!ticket) {
      throw new Error(`Ticket #${input.ticketId} not found`);
    }
    const code = ticket.projectDescriptor?.code || ticket.meta.project;
    if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(code);
    }
    try {
      const res = await this.target.claimTicket({
        ...input,
        ticketId: lookupId,
        project: input.project || code || this.config.projectCode,
      });
      return {
        ...res,
        lease: this.redactLease(res.lease)!,
        ticket: this.redactLinks(res.ticket),
      };
    } catch (err: any) {
      if (err instanceof EsedreLeaseConflictError) {
        throw new EsedreLeaseConflictError(err.ticketKey, this.redactLease(err.activeLease)!);
      }
      throw err;
    }
  }

  public async renewLease(input: RenewLeaseInput): Promise<TicketLease> {
    if (input.project && !isProjectAuthorized(input.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(input.project);
    }
    const { lookupId, ticket } = await this.resolveTicketLookup(input.ticketId, input.project);
    if (!ticket) {
      throw new Error(`Ticket #${input.ticketId} not found`);
    }
    const code = ticket.projectDescriptor?.code || ticket.meta.project;
    if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(code);
    }
    const lease = await this.target.renewLease({
      ...input,
      ticketId: lookupId,
      project: input.project || code || this.config.projectCode,
    });
    return this.redactLease(lease)!;
  }

  public async releaseTicket(
    input: ReleaseLeaseInput
  ): Promise<{ released: boolean; ticketKey: string; previousLease?: TicketLease }> {
    if (input.project && !isProjectAuthorized(input.project, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(input.project);
    }
    const { lookupId, ticket } = await this.resolveTicketLookup(input.ticketId, input.project);
    if (!ticket) {
      throw new Error(`Ticket #${input.ticketId} not found`);
    }
    const code = ticket.projectDescriptor?.code || ticket.meta.project;
    if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(code);
    }
    const res = await this.target.releaseTicket({
      ...input,
      ticketId: lookupId,
      project: input.project || code || this.config.projectCode,
    });
    return {
      ...res,
      ...(res.previousLease ? { previousLease: this.redactLease(res.previousLease) } : {}),
    };
  }

  public async getTicketLease(id: number | string, projectCode?: string): Promise<TicketLease | null> {
    if (projectCode && !isProjectAuthorized(projectCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(projectCode);
    }
    const { lookupId, ticket } = await this.resolveTicketLookup(id, projectCode);
    if (!ticket) return null;
    const code = ticket.projectDescriptor?.code || ticket.meta.project;
    if (code && !isProjectAuthorized(code, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(code);
    }
    const lease = await this.target.getTicketLease(lookupId, projectCode || code || this.config.projectCode);
    return this.redactLease(lease) || null;
  }

  public async listLeases(projectCode?: string): Promise<TicketLease[]> {
    if (projectCode && projectCode !== 'all' && !isProjectAuthorized(projectCode, this.config.allowedProjects)) {
      throw new EsedreAuthorizationError(projectCode);
    }
    const allLeases = await this.target.listLeases(projectCode);
    return allLeases
      .filter((l) => isProjectAuthorized(l.project, this.config.allowedProjects))
      .map((l) => this.redactLease(l)!);
  }
}
