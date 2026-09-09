import {
  TicketMeta,
  TicketType, TicketCategory,
  TicketComment,
  InlineComment,
  TicketHistorySnapshot,
  ProjectName,
  ProjectDescriptor,
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
    complexity?: string;
    focus?: string;
    rationale?: string;
    breakdown?: string;
    openQuestions?: string[];
    submittedBy?: string;
    featureFlag?: string;
    projectId?: number;
    project?: ProjectName | string | number;
  }): Promise<{ ticketId: string; meta: TicketMeta }>;
  toggleFlag(ticketId: string | number, flagged?: boolean): Promise<TicketMeta>;
  updateMeta(ticketId: string | number, updates: Partial<TicketMeta>): Promise<TicketMeta>;
  saveInlineComment(ticketId: string | number, selectedText: string, comment: string, author?: string): Promise<InlineComment[]>;
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
    return (await this.request('/planning/all')) || {};
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        ...options,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`[Esedre API] Request failed for ${endpoint}:`, err);
      return {} as T;
    }
  }

  async getAnswers(): Promise<Record<string, Record<string, string>>> {
    return (await this.request('/planning/answers')) || {};
  }

  async getPlans(): Promise<Record<string, string>> {
    return (await this.request('/planning/plans')) || {};
  }

  async getPlanHistory(): Promise<Record<string, { filename: string; content: string }[]>> {
    return (await this.request('/planning/plan-history')) || {};
  }

  async getHistory(): Promise<Record<string, TicketHistorySnapshot[]>> {
    return (await this.request('/planning/history')) || {};
  }

  async getComments(): Promise<Record<string, TicketComment[]>> {
    return (await this.request('/planning/comments')) || {};
  }

  async getMetas(): Promise<Record<string, TicketMeta>> {
    return (await this.request('/planning/metas')) || {};
  }

  async getInlineComments(): Promise<Record<string, InlineComment[]>> {
    return (await this.request('/planning/inline-comments')) || {};
  }

  async getTicketDetails(): Promise<Record<string, string>> {
    return (await this.request('/planning/details')) || {};
  }

  async getProjects(): Promise<ProjectDescriptor[]> {
    return (await this.request('/planning/projects')) || [];
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
}

export const activePlanningProvider: PlanningServiceProvider = new EsedreHttpPlanningProvider();
