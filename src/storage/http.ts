import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
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
  EsedreConflictError,
  EsedreLeaseConflictError,
  GitSyncStatusReport,
  GitSyncResult,
} from '../types.js';
import {
  StorageAdapter,
  CreateTicketInput,
  UpdateTicketInput,
  ListTicketsFilter,
  RegisterProjectInput,
  DuplicateProjectWarning,
  SyncDataHubCallOptions,
} from './adapter.js';
import {
  EsedreConfig,
  EsedreAuthorizationError,
  normalizeRemoteHostUrl,
  expandHome,
  readGlobalConfig,
} from '../config.js';
import { EsedreVersionError } from '../migrations/index.js';
import {
  resolveWorkerIdentity,
  isPathInside,
  isWorkspaceOrGitDir,
} from '../utils/identity.js';

export interface HttpStorageOptions {
  host: string;
  timeoutMs?: number;
  workspaceRoot?: string;
  config?: EsedreConfig;
}

export class HttpStorageAdapter implements StorageAdapter {
  public readonly host: string;
  private readonly timeoutMs: number;
  private readonly workspaceRoot?: string;
  private readonly config: EsedreConfig;

  constructor(options: HttpStorageOptions) {
    const normalized = normalizeRemoteHostUrl(options.host);
    if (!normalized || normalized === 'local') {
      throw new Error(`Invalid remote Esedre host URL: '${options.host}'`);
    }
    this.host = normalized;
    this.timeoutMs = options.timeoutMs ?? options.config?.server?.timeoutMs ?? 10000;
    this.workspaceRoot = options.workspaceRoot;
    this.config = options.config || {};
  }

  public getRemoteHost(): string {
    return this.host;
  }

  public getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  public getProjectRepoRoot(projectCode: string): string | undefined {
    if (!projectCode || !projectCode.trim()) return undefined;
    const lower = projectCode.trim().toLowerCase();

    if (
      this.workspaceRoot &&
      this.config.projectCode &&
      this.config.projectCode.trim().toLowerCase() === lower &&
      fs.existsSync(this.workspaceRoot)
    ) {
      return this.workspaceRoot;
    }

    const sources = [this.config.projects, readGlobalConfig()?.projects];
    for (const map of sources) {
      if (!map || typeof map !== 'object') continue;
      const key = Object.keys(map).find((k) => k.toLowerCase() === lower);
      if (key && typeof map[key] === 'string') {
        const val = map[key].trim();
        if (!val || /^https?:\/\//i.test(val)) continue;
        const resolved = path.resolve(this.workspaceRoot || process.cwd(), expandHome(val));
        if (fs.existsSync(resolved)) {
          return resolved;
        }
      }
    }

    return undefined;
  }

  public getDuplicateProjectWarnings(): DuplicateProjectWarning[] {
    return [];
  }

  private qualifyTicketId(id: number | string, explicitProject?: string): string {
    const clean = String(id).trim().replace(/^#/, '');
    const proj = (explicitProject || this.config.projectCode || '').trim();
    if (proj && proj.toLowerCase() !== 'all' && /^\d+$/.test(clean)) {
      return `${proj}-${clean}`;
    }
    return clean;
  }

  private request<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    apiPath: string,
    body?: any
  ): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
      const targetUrl = new URL(apiPath, `${this.host}/`);
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      if (
        Array.isArray(this.config.allowedProjects) &&
        this.config.allowedProjects.length > 0 &&
        !this.config.allowedProjects.includes('*')
      ) {
        headers['x-esedre-allowed-projects'] = this.config.allowedProjects.join(',');
      }

      let payloadBuffer: Buffer | undefined;
      if (body !== undefined) {
        payloadBuffer = Buffer.from(JSON.stringify(body), 'utf-8');
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Content-Length'] = String(payloadBuffer.length);
      }

      const req = transport.request(
        targetUrl,
        {
          method,
          headers,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const rawText = Buffer.concat(chunks).toString('utf-8');
            const status = res.statusCode || 500;
            let parsed: any = null;
            if (rawText.trim()) {
              try {
                parsed = JSON.parse(rawText);
              } catch {
                parsed = { error: rawText };
              }
            }

            if (status >= 200 && status < 300) {
              resolve({ status, data: parsed as T });
              return;
            }

            reject(this.createDomainError(status, parsed));
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(
          new Error(
            `Connection timed out after ${this.timeoutMs}ms while contacting remote Esedre server at ${this.host}. Verify the remote daemon is running ('ese status --host ${this.host}') and reachable on your network.`
          )
        );
      });

      req.on('error', (err: any) => {
        reject(
          new Error(
            `Could not connect to remote Esedre server at ${this.host} (${err.code || err.message}). Verify the remote daemon is running ('ese status --host ${this.host}') and reachable on your network.`
          )
        );
      });

      if (payloadBuffer) {
        req.write(payloadBuffer);
      }
      req.end();
    });
  }

  private createDomainError(status: number, data: any): Error {
    const msg = data?.error || `Remote Esedre server returned HTTP ${status}`;

    if (status === 403) {
      return new EsedreAuthorizationError(data?.projectCode || 'unknown', msg);
    }

    if (status === 409) {
      if (data?.activeLease) {
        return new EsedreLeaseConflictError(data.ticketKey || 'unknown', data.activeLease);
      }
      if (data?.code === 'CONFLICT' || (data?.currentHash && data?.lastHash)) {
        return new EsedreConflictError(
          data.ticketId ?? 'unknown',
          data.currentHash || '',
          data.lastHash || ''
        );
      }
      if (data?.requiredSchemaVersion && data?.reason) {
        return new EsedreVersionError({
          projectCode: data.projectCode || 'unknown',
          currentSchemaVersion: data.currentSchemaVersion || '1.0.0',
          requiredSchemaVersion: data.requiredSchemaVersion,
          reason: data.reason,
          featureName: data.featureName,
        });
      }
    }

    const err: any = new Error(msg);
    err.statusCode = status;
    err.notFound = Boolean(status === 404 || data?.notFound || /not found/i.test(msg));
    return err;
  }

  public async listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]> {
    const params = new URLSearchParams();
    const effectiveProject = filter?.project ?? this.config.projectCode;
    if (effectiveProject) {
      params.set('project', effectiveProject);
    }
    if (filter?.status) params.set('status', String(filter.status));
    if (filter?.type) params.set('type', String(filter.type));
    else if (filter?.category) params.set('category', String(filter.category));
    if (filter?.priority) params.set('priority', String(filter.priority));
    if (filter?.milestone) params.set('milestone', String(filter.milestone));
    if (filter?.featureFlag) params.set('featureFlag', String(filter.featureFlag));
    if (filter?.isBlocked !== undefined) params.set('isBlocked', String(filter.isBlocked));
    if (filter?.linkedTo) params.set('linkedTo', String(filter.linkedTo));
    if (filter?.leased !== undefined) params.set('leased', String(filter.leased));
    if (filter?.leasedBy) params.set('leasedBy', String(filter.leasedBy));
    if (filter?.search) params.set('search', String(filter.search));

    const qs = params.toString();
    const { data } = await this.request<EsedreTicket[]>(
      'GET',
      `/api/planning/tickets${qs ? `?${qs}` : ''}`
    );
    return Array.isArray(data) ? data : [];
  }

  public async getTicket(id: number | string): Promise<EsedreTicket | null> {
    const qualified = this.qualifyTicketId(id);
    try {
      const { data } = await this.request<EsedreTicket>(
        'GET',
        `/api/planning/ticket/${encodeURIComponent(qualified)}`
      );
      return data || null;
    } catch (err: any) {
      if (err?.notFound) {
        return null;
      }
      throw err;
    }
  }

  public async createTicket(input: CreateTicketInput): Promise<EsedreTicket> {
    const payload: CreateTicketInput = {
      ...input,
      projectCode: input.projectCode || input.project || this.config.projectCode,
    };
    const { data } = await this.request<{ ticketId: string; meta: TicketMeta; ticket?: EsedreTicket }>(
      'POST',
      '/api/planning/tickets',
      payload
    );
    if (data?.ticket) {
      return data.ticket;
    }
    const fetched = await this.getTicket(
      payload.projectCode ? `${payload.projectCode}-${data.ticketId}` : data.ticketId
    );
    if (fetched) return fetched;
    return { meta: data.meta, comments: [] };
  }

  public async updateTicket(
    id: number | string,
    updates: UpdateTicketInput,
    lastHash?: string
  ): Promise<EsedreTicket> {
    const qualified = this.qualifyTicketId(id, updates.project);
    const { data } = await this.request<{ meta: TicketMeta; ticket?: EsedreTicket }>(
      'POST',
      '/api/planning/update-meta',
      {
        ticketId: qualified,
        updates,
        lastHash,
      }
    );
    if (data?.ticket) {
      return data.ticket;
    }
    const fetched = await this.getTicket(qualified);
    if (fetched) return fetched;
    return { meta: data.meta, comments: [] };
  }

  public async getPlan(id: number | string): Promise<string | null> {
    const ticket = await this.getTicket(id);
    if (!ticket) return null;
    return ticket.planMarkdown ?? null;
  }

  public async savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void> {
    const qualified = this.qualifyTicketId(id);
    await this.request('POST', '/api/planning/plans', {
      ticketId: qualified,
      planMarkdown,
      lastHash,
    });
  }

  public async addComment(
    id: number | string,
    comment: { author: string; text: string }
  ): Promise<TicketComment> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<{ comment?: TicketComment; comments?: TicketComment[] }>(
      'POST',
      '/api/planning/comments',
      {
        ticketId: qualified,
        author: comment.author,
        text: comment.text,
      }
    );
    if (data?.comment) {
      return data.comment;
    }
    const comments = data?.comments || [];
    return (
      comments[comments.length - 1] || {
        id: String(Date.now()),
        timestamp: new Date().toISOString(),
        author: comment.author,
        text: comment.text,
      }
    );
  }

  public async addTicketLink(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetId: number | string,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    const qualifiedSource = this.qualifyTicketId(sourceId, options?.project);
    const qualifiedTarget = this.qualifyTicketId(targetId, options?.project);
    const { data } = await this.request<{ source: EsedreTicket; target?: EsedreTicket }>(
      'POST',
      '/api/planning/link',
      {
        sourceId: qualifiedSource,
        relation,
        targetId: qualifiedTarget,
        author: options?.author,
        project: options?.project || this.config.projectCode,
      }
    );
    return { source: data.source, target: data.target };
  }

  public async addTicketLinks(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetIds: Array<number | string>,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; targets: EsedreTicket[] }> {
    const qualifiedSource = this.qualifyTicketId(sourceId, options?.project);
    const qualifiedTargets = targetIds.map((t) => this.qualifyTicketId(t, options?.project));
    const { data } = await this.request<{
      source: EsedreTicket;
      target?: EsedreTicket;
      targets?: EsedreTicket[];
    }>('POST', '/api/planning/link', {
      sourceId: qualifiedSource,
      relation,
      targetIds: qualifiedTargets,
      author: options?.author,
      project: options?.project || this.config.projectCode,
    });
    return {
      source: data.source,
      targets: data.targets || (data.target ? [data.target] : []),
    };
  }

  public async removeTicketLink(
    sourceId: number | string,
    targetId: number | string,
    options?: { relation?: TicketLinkRelation; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    const qualifiedSource = this.qualifyTicketId(sourceId, options?.project);
    const qualifiedTarget = this.qualifyTicketId(targetId, options?.project);
    const { data } = await this.request<{ source: EsedreTicket; target?: EsedreTicket }>(
      'POST',
      '/api/planning/unlink',
      {
        sourceId: qualifiedSource,
        targetId: qualifiedTarget,
        relation: options?.relation,
        project: options?.project || this.config.projectCode,
      }
    );
    return { source: data.source, target: data.target };
  }

  public async removeTicketLinks(
    sourceId: number | string,
    targetIds: Array<number | string>,
    options?: { relation?: TicketLinkRelation; project?: string }
  ): Promise<{ source: EsedreTicket; targets: EsedreTicket[] }> {
    const qualifiedSource = this.qualifyTicketId(sourceId, options?.project);
    const qualifiedTargets = targetIds.map((t) => this.qualifyTicketId(t, options?.project));
    const { data } = await this.request<{
      source: EsedreTicket;
      target?: EsedreTicket;
      targets?: EsedreTicket[];
    }>('POST', '/api/planning/unlink', {
      sourceId: qualifiedSource,
      targetIds: qualifiedTargets,
      relation: options?.relation,
      project: options?.project || this.config.projectCode,
    });
    return {
      source: data.source,
      targets: data.targets || (data.target ? [data.target] : []),
    };
  }

  public async getProjects(): Promise<ProjectDescriptor[]> {
    const { data } = await this.request<ProjectDescriptor[]>('GET', '/api/planning/projects');
    return Array.isArray(data) ? data : [];
  }

  public async registerProject(input: RegisterProjectInput): Promise<ProjectDescriptor> {
    const { data } = await this.request<ProjectDescriptor>(
      'POST',
      '/api/planning/create-project',
      input
    );
    return data;
  }

  public async updateProject(input: UpdateProjectInput): Promise<ProjectDescriptor> {
    const { data } = await this.request<ProjectDescriptor>(
      'POST',
      '/api/planning/update-project',
      input
    );
    return data;
  }

  public async renameProjectCode(input: RenameProjectCodeInput): Promise<RenameProjectCodeResult> {
    const { data } = await this.request<RenameProjectCodeResult>(
      'POST',
      '/api/planning/rename-project',
      input
    );
    return data;
  }

  public async listMilestones(projectCode?: string): Promise<Milestone[]> {
    const effectiveProject = projectCode ?? this.config.projectCode;
    const qs = effectiveProject ? `?project=${encodeURIComponent(effectiveProject)}` : '';
    const { data } = await this.request<{ milestones: Milestone[] }>(
      'GET',
      `/api/planning/milestones${qs}`
    );
    return Array.isArray(data?.milestones) ? data.milestones : [];
  }

  public async getMilestone(id: number | string, projectCode?: string): Promise<Milestone | null> {
    const effectiveProject = projectCode ?? this.config.projectCode;
    const qs = effectiveProject ? `?project=${encodeURIComponent(effectiveProject)}` : '';
    try {
      const { data } = await this.request<{ milestone: Milestone }>(
        'GET',
        `/api/planning/milestone/${encodeURIComponent(String(id))}${qs}`
      );
      return data?.milestone || null;
    } catch (err: any) {
      if (err?.notFound) {
        return null;
      }
      throw err;
    }
  }

  public async createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
    const { data } = await this.request<{ milestone: Milestone }>('POST', '/api/planning/milestones', {
      ...input,
      projectCode: input.projectCode || this.config.projectCode,
    });
    return data.milestone;
  }

  public async updateMilestone(
    id: number | string,
    input: UpdateMilestoneInput,
    projectCode?: string
  ): Promise<Milestone> {
    const { data } = await this.request<{ milestone: Milestone }>(
      'POST',
      '/api/planning/update-milestone',
      {
        id,
        projectCode: projectCode || this.config.projectCode,
        ...input,
      }
    );
    return data.milestone;
  }

  public async deleteMilestone(id: number | string, projectCode?: string): Promise<boolean> {
    const { data } = await this.request<{ success: boolean }>(
      'POST',
      '/api/planning/delete-milestone',
      {
        id,
        projectCode: projectCode || this.config.projectCode,
      }
    );
    return Boolean(data?.success);
  }

  public async getAnswers(id: number | string): Promise<Record<string, string>> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<Record<string, string>>(
      'GET',
      `/api/planning/answers?ticketId=${encodeURIComponent(qualified)}`
    );
    return data || {};
  }

  public async saveAnswer(
    id: number | string,
    questionIndex: number,
    answer: string
  ): Promise<Record<string, string>> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<Record<string, string>>('POST', '/api/planning/answers', {
      ticketId: qualified,
      questionIndex,
      answer,
    });
    return data || {};
  }

  public async saveDetail(
    id: number | string,
    detailMarkdown: string,
    metaUpdates?: Partial<TicketMeta>
  ): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<{ success: boolean; meta?: TicketMeta; detail?: string }>(
      'POST',
      '/api/planning/details',
      {
        ticketId: qualified,
        detailMarkdown,
        metaUpdates,
      }
    );
    return data;
  }

  public async getInlineComments(id: number | string): Promise<any[]> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<any[]>(
      'GET',
      `/api/planning/inline-comments?ticketId=${encodeURIComponent(qualified)}`
    );
    return Array.isArray(data) ? data : [];
  }

  public async saveInlineComment(
    id: number | string,
    selectedText: string,
    comment: string,
    author?: string
  ): Promise<any[]> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<{ inlineComments: any[] }>(
      'POST',
      '/api/planning/inline-comments',
      {
        ticketId: qualified,
        selectedText,
        comment,
        author,
      }
    );
    return Array.isArray(data?.inlineComments) ? data.inlineComments : [];
  }

  public async saveAttachment(
    id: number | string,
    filename: string,
    buffer: Buffer
  ): Promise<{ filename: string; relativePath: string }> {
    const qualified = this.qualifyTicketId(id);
    const { data } = await this.request<{ success: boolean; filename: string; url: string }>(
      'POST',
      '/api/planning/upload-attachment',
      {
        ticketId: qualified,
        filename,
        base64Data: buffer.toString('base64'),
      }
    );
    return {
      filename: data.filename,
      relativePath: data.url,
    };
  }

  public getAttachmentPath(_id: number | string, _filename: string): string | null {
    return null;
  }

  private resolveClientIdentity(input: {
    holder?: string;
    agentType?: string;
    hostname?: string;
    sessionId?: string;
    branch?: string;
    worktree?: string;
    project?: string;
  }) {
    let effectiveWorktree: string | undefined;
    if (input.worktree?.trim()) {
      effectiveWorktree = path.resolve(input.worktree.trim());
    } else {
      const effectiveProject = input.project || this.config.projectCode;
      const projectRepoRoot = effectiveProject ? this.getProjectRepoRoot(effectiveProject) : undefined;
      if (projectRepoRoot) {
        effectiveWorktree =
          isPathInside(process.cwd(), projectRepoRoot) && isWorkspaceOrGitDir(process.cwd())
            ? process.cwd()
            : projectRepoRoot;
      } else if (this.workspaceRoot && isWorkspaceOrGitDir(this.workspaceRoot)) {
        effectiveWorktree = this.workspaceRoot;
      }
    }

    return resolveWorkerIdentity({
      holder: input.holder,
      agentType: input.agentType,
      hostname: input.hostname,
      sessionId: input.sessionId,
      branch: input.branch,
      worktree: effectiveWorktree,
      configDefaultAuthor: this.config.defaultAuthor,
    });
  }

  public async claimTicket(input: ClaimLeaseInput): Promise<ClaimLeaseResult> {
    const effectiveProject = input.project || this.config.projectCode;
    const qualified = this.qualifyTicketId(input.ticketId, effectiveProject);
    const prefixMatch = String(qualified).match(/^([a-zA-Z0-9]{1,8})-\d+$/);
    const resolvedProject = prefixMatch ? prefixMatch[1] : effectiveProject;
    const identity = this.resolveClientIdentity({ ...input, project: resolvedProject });
    const { worktree: _omitLocalWorktree, ...restInput } = input;
    const { data } = await this.request<ClaimLeaseResult>('POST', '/api/planning/leases/claim', {
      ...restInput,
      ticketId: qualified,
      project: resolvedProject,
      holder: identity.holder,
      hostname: identity.hostname,
      ...(identity.agentType ? { agentType: identity.agentType } : {}),
      ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
      ...(identity.branch ? { branch: identity.branch } : {}),
    });
    return data;
  }

  public async renewLease(input: RenewLeaseInput): Promise<TicketLease> {
    const effectiveProject = input.project || this.config.projectCode;
    const qualified = this.qualifyTicketId(input.ticketId, effectiveProject);
    const identity = this.resolveClientIdentity({ holder: input.holder, project: effectiveProject });
    const { data } = await this.request<{ lease: TicketLease }>('POST', '/api/planning/leases/renew', {
      ...input,
      ticketId: qualified,
      project: effectiveProject,
      holder: input.holder || identity.holder,
    });
    return data.lease;
  }

  public async releaseTicket(
    input: ReleaseLeaseInput
  ): Promise<{ released: boolean; ticketKey: string; previousLease?: TicketLease }> {
    const effectiveProject = input.project || this.config.projectCode;
    const qualified = this.qualifyTicketId(input.ticketId, effectiveProject);
    const identity = this.resolveClientIdentity({ holder: input.holder, project: effectiveProject });
    const { data } = await this.request<{
      released: boolean;
      ticketKey: string;
      previousLease?: TicketLease;
    }>('POST', '/api/planning/leases/release', {
      ...input,
      ticketId: qualified,
      project: effectiveProject,
      holder: input.holder || identity.holder,
    });
    return {
      released: Boolean(data?.released),
      ticketKey: data?.ticketKey || String(qualified),
      ...(data?.previousLease ? { previousLease: data.previousLease } : {}),
    };
  }

  public async getTicketLease(id: number | string, projectCode?: string): Promise<TicketLease | null> {
    const effectiveProject = projectCode || this.config.projectCode;
    const qualified = this.qualifyTicketId(id, effectiveProject);
    const ticket = await this.getTicket(qualified);
    return ticket?.lease || ticket?.meta?.lease || null;
  }

  public async listLeases(projectCode?: string): Promise<TicketLease[]> {
    const effectiveProject = projectCode ?? this.config.projectCode;
    const qs =
      effectiveProject && effectiveProject.toLowerCase() !== 'all'
        ? `?project=${encodeURIComponent(effectiveProject)}`
        : '';
    const { data } = await this.request<{ leases: TicketLease[] }>(
      'GET',
      `/api/planning/leases${qs}`
    );
    return Array.isArray(data?.leases) ? data.leases : [];
  }

  public async getSyncStatus(hubDir?: string): Promise<GitSyncStatusReport> {
    const qs = hubDir ? `?hub=${encodeURIComponent(hubDir)}` : '';
    const { data } = await this.request<GitSyncStatusReport>(
      'GET',
      `/api/planning/sync/status${qs}`
    );
    return data;
  }

  public async syncDataHub(options: SyncDataHubCallOptions = {}): Promise<GitSyncResult[]> {
    const { data } = await this.request<{ success: boolean; results: GitSyncResult[] }>(
      'POST',
      '/api/planning/sync',
      {
        ...(options.hubDir ? { hubDir: options.hubDir } : {}),
        ...(options.pull !== undefined ? { pull: options.pull } : {}),
        ...(options.push !== undefined ? { push: options.push } : {}),
        ...(options.commit !== undefined ? { commit: options.commit } : {}),
        force: options.force ?? true,
      }
    );
    return Array.isArray(data?.results) ? data.results : [];
  }
}
