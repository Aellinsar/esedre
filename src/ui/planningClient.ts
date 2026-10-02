import {
  TicketMeta,
  TicketType, TicketCategory,
  TicketPriority,
  TicketComment,
  InlineComment,
  TicketHistorySnapshot,
  ProjectName,
  ProjectDescriptor,
  Milestone,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  TicketLinkRelation,
} from './types';

export interface PlanningServiceProvider {
  id: string;
  name: string;
  getAnswers(): Promise<Record<string, Record<string, string>>> | Record<string, Record<string, string>>;
  getPlans(): Promise<Record<string, string>> | Record<string, string>;
  getPlanHistory(): Promise<Record<string, { filename: string; content: string }[]>> | Record<string, { filename: string; content: string }[]>;
  getHistory(): Promise<Record<string, TicketHistorySnapshot[]>> | Record<string, TicketHistorySnapshot[]>;
  getComments(): Promise<Record<string, TicketComment[]>> | Record<string, TicketComment[]>;
  getMetas(): Promise<Record<string, TicketMeta>> | Record<string, TicketMeta>;
  getInlineComments(): Promise<Record<string, InlineComment[]>> | Record<string, InlineComment[]>;
  getTicketDetails(): Promise<Record<string, string>> | Record<string, string>;
  saveAnswer(ticketId: string | number, questionIndex: number, answer: string): Promise<Record<string, string>>;
  savePlan(ticketId: string | number, planMarkdown: string): Promise<boolean>;
  saveDetail(ticketId: string | number, detailMarkdown: string, metaUpdates?: Partial<TicketMeta>): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }>;
  saveComment(ticketId: string | number, text: string, author?: string): Promise<TicketComment[]>;
  createTicket(data: {
    title: string;
    type?: TicketType;
    category?: TicketType;
    priority?: TicketPriority;
    complexity?: string;
    focus?: string;
    rationale?: string;
    breakdown?: string;
    openQuestions?: string[];
    submittedBy?: string;
    featureFlag?: string;
    milestone?: string;
    projectId?: number;
    project?: ProjectName | string | number;
  }): Promise<{ ticketId: string; meta: TicketMeta }>;
  toggleFlag(ticketId: string | number, flagged?: boolean): Promise<TicketMeta>;
  updateMeta(ticketId: string | number, updates: Partial<TicketMeta>): Promise<TicketMeta>;
  saveInlineComment(ticketId: string | number, selectedText: string, comment: string, author?: string): Promise<InlineComment[]>;
  listMilestones?(project?: string): Promise<Milestone[]>;
  createMilestone?(data: CreateMilestoneInput): Promise<Milestone>;
  updateMilestone?(id: string | number, data: UpdateMilestoneInput, project?: string): Promise<Milestone>;
  deleteMilestone?(id: string | number, project?: string): Promise<boolean>;
  linkTicket?(sourceId: string | number, relation: TicketLinkRelation, targetId: string | number, author?: string): Promise<{ success: boolean; source?: any; target?: any; error?: string }>;
  unlinkTicket?(sourceId: string | number, targetId: string | number): Promise<{ success: boolean; source?: any; target?: any; error?: string }>;
  getProjects?(): Promise<ProjectDescriptor[]>;
  getAll?(): Promise<any>;
}

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.pathname) {
    if (window.location.pathname.startsWith('/esedre')) {
      return '/esedre/api';
    }
  }
  return '/api';
}

export class EsedreHttpPlanningProvider implements PlanningServiceProvider {
  id = 'esedre_http';
  name = 'Esedre HTTP Gateway Provider';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || getApiBaseUrl()).replace(/\/+$/, '');
  }

  async getAll(): Promise<any> {
    try {
      return (await this.request('/planning/all')) || {};
    } catch {
      return {};
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    if (!res.ok) {
      let errBody: any = null;
      try { errBody = await res.json(); } catch {}
      const msg = errBody?.error || `HTTP ${res.status}: ${res.statusText}`;
      console.warn(`[Esedre API] Request failed for ${endpoint}:`, msg);
      throw new Error(msg);
    }
    return await res.json();
  }

  async getAnswers(): Promise<Record<string, Record<string, string>>> {
    try {
      return (await this.request('/planning/answers')) || {};
    } catch {
      return {};
    }
  }

  async getPlans(): Promise<Record<string, string>> {
    try {
      return (await this.request('/planning/plans')) || {};
    } catch {
      return {};
    }
  }

  async getPlanHistory(): Promise<Record<string, { filename: string; content: string }[]>> {
    try {
      return (await this.request('/planning/plan-history')) || {};
    } catch {
      return {};
    }
  }

  async getHistory(): Promise<Record<string, TicketHistorySnapshot[]>> {
    try {
      return (await this.request('/planning/history')) || {};
    } catch {
      return {};
    }
  }

  async getComments(): Promise<Record<string, TicketComment[]>> {
    try {
      return (await this.request('/planning/comments')) || {};
    } catch {
      return {};
    }
  }

  async getMetas(): Promise<Record<string, TicketMeta>> {
    try {
      return (await this.request('/planning/metas')) || {};
    } catch {
      return {};
    }
  }

  async getInlineComments(): Promise<Record<string, InlineComment[]>> {
    try {
      return (await this.request('/planning/inline-comments')) || {};
    } catch {
      return {};
    }
  }

  async getTicketDetails(): Promise<Record<string, string>> {
    try {
      return (await this.request('/planning/details')) || {};
    } catch {
      return {};
    }
  }

  async getProjects(): Promise<ProjectDescriptor[]> {
    try {
      return (await this.request('/planning/projects')) || [];
    } catch {
      return [];
    }
  }

  async saveAnswer(ticketId: string | number, questionIndex: number, answer: string): Promise<Record<string, string>> {
    return await this.request('/planning/answers', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), questionIndex, answer }),
    });
  }

  async savePlan(ticketId: string | number, planMarkdown: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>('/planning/plans', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), planMarkdown }),
    });
    return !!res?.success;
  }

  async saveDetail(ticketId: string | number, detailMarkdown: string, metaUpdates?: Partial<TicketMeta>): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }> {
    return await this.request('/planning/details', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), detailMarkdown, metaUpdates }),
    });
  }

  async saveComment(ticketId: string | number, text: string, author?: string): Promise<TicketComment[]> {
    const res = await this.request<{ comments: TicketComment[] }>('/planning/comments', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), text, author }),
    });
    return res?.comments || [];
  }

  async createTicket(data: any): Promise<{ ticketId: string; meta: TicketMeta }> {
    return await this.request('/planning/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async toggleFlag(ticketId: string | number, flagged?: boolean): Promise<TicketMeta> {
    const res = await this.request<{ meta: TicketMeta }>('/planning/toggle-flag', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), flagged }),
    });
    return res?.meta;
  }

  async updateMeta(ticketId: string | number, updates: Partial<TicketMeta>): Promise<TicketMeta> {
    const res = await this.request<{ meta: TicketMeta }>('/planning/update-meta', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), updates }),
    });
    return res?.meta;
  }

  async saveInlineComment(ticketId: string | number, selectedText: string, comment: string, author?: string): Promise<InlineComment[]> {
    const res = await this.request<{ inlineComments: InlineComment[] }>('/planning/save-inline-comment', {
      method: 'POST',
      body: JSON.stringify({ ticketId: String(ticketId), selectedText, comment, author }),
    });
    return res?.inlineComments || [];
  }

  async listMilestones(project?: string): Promise<Milestone[]> {
    const p = project && project !== 'all' ? `?project=${encodeURIComponent(project)}` : '';
    const res = await this.request<{ milestones: Milestone[] }>(`/planning/milestones${p}`);
    return res?.milestones || [];
  }

  async createMilestone(data: CreateMilestoneInput): Promise<Milestone> {
    const res = await this.request<{ milestone: Milestone }>('/planning/milestones', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res?.milestone;
  }

  async updateMilestone(id: string | number, data: UpdateMilestoneInput, project?: string): Promise<Milestone> {
    const res = await this.request<{ milestone: Milestone }>('/planning/update-milestone', {
      method: 'POST',
      body: JSON.stringify({ id, projectCode: project, ...data }),
    });
    return res?.milestone;
  }

  async deleteMilestone(id: string | number, project?: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>('/planning/delete-milestone', {
      method: 'POST',
      body: JSON.stringify({ id, projectCode: project }),
    });
    return Boolean(res?.success);
  }

  async linkTicket(sourceId: string | number, relation: TicketLinkRelation, targetId: string | number, author?: string): Promise<{ success: boolean; source?: any; target?: any; error?: string }> {
    return await this.request('/planning/link', {
      method: 'POST',
      body: JSON.stringify({ sourceId, relation, targetId, author }),
    });
  }

  async unlinkTicket(sourceId: string | number, targetId: string | number): Promise<{ success: boolean; source?: any; target?: any; error?: string }> {
    return await this.request('/planning/unlink', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId }),
    });
  }
}

export const activePlanningProvider: PlanningServiceProvider = new EsedreHttpPlanningProvider();

export const CLIENT_PLANNING_CACHE_KEY = 'esedre_planning_client_cache_v1';

export interface PlanningClientCache {
  metas: Record<string, TicketMeta>;
  details: Record<string, string>;
  plans: Record<string, string>;
  comments: Record<string, TicketComment[]>;
  answers: Record<string, Record<string, string>>;
  inlineComments: Record<string, InlineComment[]>;
  projects: ProjectDescriptor[];
  cachedAt: number;
}

export function loadPlanningClientCache(): PlanningClientCache | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CLIENT_PLANNING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.metas === 'object' && parsed.metas !== null) {
      return parsed as PlanningClientCache;
    }
  } catch {
    // Corrupted JSON or storage failure
  }
  return null;
}

export function savePlanningClientCache(data: {
  metas?: Record<string, TicketMeta>;
  details?: Record<string, string>;
  plans?: Record<string, string>;
  comments?: Record<string, TicketComment[]>;
  answers?: Record<string, Record<string, string>>;
  inlineComments?: Record<string, InlineComment[]>;
  projects?: ProjectDescriptor[];
}): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const payload: PlanningClientCache = {
    metas: data.metas || {},
    details: data.details || {},
    plans: data.plans || {},
    comments: data.comments || {},
    answers: data.answers || {},
    inlineComments: data.inlineComments || {},
    projects: data.projects || [],
    cachedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(CLIENT_PLANNING_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // QuotaExceededError safeguard: strip large markdown details/plans and retain compact ticket metadata
    try {
      const slimPayload: PlanningClientCache = {
        ...payload,
        details: {},
        plans: {},
      };
      window.localStorage.setItem(CLIENT_PLANNING_CACHE_KEY, JSON.stringify(slimPayload));
    } catch {
      // If even slim metadata fails, ignore silently
    }
  }
}

