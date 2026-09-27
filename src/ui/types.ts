export type TicketType = 'Feature' | 'Platform' | 'Tools' | 'Idea' | 'Bug';
export type TicketCategory = TicketType; // Back-compat alias
export type TicketStatus = 'Planned' | 'In Development' | 'Completed' | 'Rejected';
export type TicketPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export const PRIORITIES: readonly TicketPriority[] = ['Critical', 'High', 'Medium', 'Low'] as const;

export const PRIORITY_CONFIG: Record<
  TicketPriority,
  {
    name: TicketPriority;
    badge: string;
    dot: string;
    border: string;
    bg: string;
    text: string;
  }
> = {
  Critical: {
    name: 'Critical',
    badge: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 font-semibold',
    dot: 'bg-red-500',
    border: 'border-red-500/40',
    bg: 'bg-red-500/10',
    text: 'text-red-700 dark:text-red-400',
  },
  High: {
    name: 'High',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold',
    dot: 'bg-amber-500',
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-400',
  },
  Medium: {
    name: 'Medium',
    badge: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold',
    dot: 'bg-blue-500',
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-400',
  },
  Low: {
    name: 'Low',
    badge: 'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-400 font-semibold',
    dot: 'bg-slate-400',
    border: 'border-slate-400/40',
    bg: 'bg-slate-500/10',
    text: 'text-slate-700 dark:text-slate-400',
  },
};

export const DEFAULT_ESEDRE_PORT = 5674;

export type ProjectName = string;

export interface ProjectColors {
  badge: string;
  dot: string;
  border: string;
}

export interface ProjectDescriptor {
  id: number;
  code: string;
  name: string;
  description: string;
  colors: ProjectColors;
  techStack?: Record<string, string> | string[];
  groundingRules?: string[];
  guidelinesRef?: string;
}

export const PALETTES = [
  { name: 'Cyan', badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300', dot: 'bg-cyan-400', border: 'border-cyan-500/40' },
  { name: 'Indigo', badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300', dot: 'bg-indigo-400', border: 'border-indigo-500/40' },
  { name: 'Emerald', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-500/40' },
  { name: 'Fuchsia', badge: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300', dot: 'bg-fuchsia-400', border: 'border-fuchsia-500/40' },
  { name: 'Amber', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300', dot: 'bg-amber-400', border: 'border-amber-500/40' },
  { name: 'Rose', badge: 'border-rose-500/30 bg-rose-500/10 text-rose-300', dot: 'bg-rose-400', border: 'border-rose-500/40' },
];

export const ALL_PROJECTS: ProjectDescriptor[] = [
  {
    id: 1,
    code: 'Profe',
    name: 'Professor Arwam',
    description: "Professor Arwam's Sleep Research Center web application",
    colors: {
      badge: 'border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-950 dark:text-indigo-300 font-semibold',
      dot: 'bg-indigo-600 dark:bg-indigo-400',
      border: 'border-indigo-300 dark:border-indigo-500/40',
    },
  },
  {
    id: 2,
    code: 'Alce',
    name: 'Alce',
    description: 'Alce offline e-reader application and ecosystem',
    colors: {
      badge: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-950 dark:text-emerald-300 font-semibold',
      dot: 'bg-emerald-600 dark:bg-emerald-400',
      border: 'border-emerald-300 dark:border-emerald-500/40',
    },
  },
  {
    id: 3,
    code: 'Esedre',
    name: 'Esedre',
    description: 'Esedre developer roadmap, ticketing, and LLM agent coordination platform',
    colors: {
      badge: 'border-fuchsia-300 dark:border-fuchsia-500/30 bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-950 dark:text-fuchsia-300 font-semibold',
      dot: 'bg-fuchsia-600 dark:bg-fuchsia-400',
      border: 'border-fuchsia-300 dark:border-fuchsia-500/40',
    },
  },
];

let dynamicProjects: ProjectDescriptor[] = [...ALL_PROJECTS];

export function setRuntimeProjects(projects: ProjectDescriptor[]): void {
  if (Array.isArray(projects) && projects.length > 0) {
    dynamicProjects = [...projects];
  }
}

export function getRuntimeProjects(): ProjectDescriptor[] {
  return dynamicProjects;
}

export const ALL_PROJECT_IDS: number[] = ALL_PROJECTS.map((p) => p.id);
export const ALL_PROJECT_NAMES: string[] = ALL_PROJECTS.map((p) => p.name);
export const ALL_PROJECT_CODES: string[] = ALL_PROJECTS.map((p) => p.code);
export const MAX_PROJECT_CODE_LENGTH: number = 8;
export const MAX_PROJECT_NAME_LENGTH: number = 48;

export const UNASSIGNED_PROJECT_COLORS: ProjectColors = {
  badge: 'border-slate-200 dark:border-slate-600/30 bg-slate-100 dark:bg-slate-800/40 text-slate-700 dark:text-slate-400',
  dot: 'bg-slate-400',
  border: 'border-slate-300 dark:border-slate-700/40',
};

export function getProjectById(id?: number | string): ProjectDescriptor | undefined {
  if (id === undefined || id === null) return undefined;
  const num = typeof id === 'number' ? id : parseInt(String(id), 10);
  if (isNaN(num)) return undefined;
  const list = dynamicProjects.length > 0 ? dynamicProjects : ALL_PROJECTS;
  return list.find((p) => p.id === num) || ALL_PROJECTS.find((p) => p.id === num);
}

export function getProjectByName(name?: string): ProjectDescriptor | undefined {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  const list = dynamicProjects.length > 0 ? dynamicProjects : ALL_PROJECTS;
  const match = list.find(
    (p) => p.name.toLowerCase() === lower || p.code.toLowerCase() === lower
  );
  if (match) return match;

  // Fallback aliases
  if (lower === 'profe' || lower === 'prof' || lower === 'pasrc' || lower === 'professor-arwam' || lower === 'professor arwam' || lower === 'core') {
    return list.find((p) => p.id === 1) || ALL_PROJECTS[0];
  }
  if (lower === 'alce' || lower === 'web') {
    return list.find((p) => p.id === 2) || ALL_PROJECTS[1];
  }
  if (lower === 'esedre' || lower === 'ese' || lower === 'docs' || lower === 'dev-planner') {
    return list.find((p) => p.id === 3) || ALL_PROJECTS[2];
  }

  return ALL_PROJECTS.find(
    (p) => p.name.toLowerCase() === lower || p.code.toLowerCase() === lower
  );
}

export function getProjectDescriptor(input?: number | string): ProjectDescriptor | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'number') {
    return getProjectById(input);
  }
  if (typeof input === 'string') {
    const num = parseInt(input.trim(), 10);
    if (!isNaN(num) && String(num) === input.trim()) {
      return getProjectById(num);
    }
    return getProjectByName(input);
  }
  return undefined;
}

export type MilestoneStatus = 'Planned' | 'Active' | 'Completed' | 'Closed';

export interface Milestone {
  id: number | string;
  project: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  featureFlag?: string;
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
  | 'blocks'
  | 'blocked-by'
  | 'relates-to'
  | 'parent-of'
  | 'child-of'
  | 'duplicates'
  | 'duplicated-by';

export const LINK_RELATION_LABELS: Record<TicketLinkRelation, string> = {
  'relates-to': 'Relates to',
  'blocks': 'Blocks',
  'blocked-by': 'Blocked by',
  'parent-of': 'Parent of',
  'child-of': 'Child of',
  'duplicates': 'Duplicates',
  'duplicated-by': 'Duplicated by',
};

export interface TicketLink {
  relation: TicketLinkRelation;
  targetKey: string;
  targetProject: string;
  targetId: number;
  createdAt?: string;
  createdBy?: string;
}

export interface EnrichedTicketLink extends TicketLink {
  targetTitle?: string;
  targetStatus?: TicketStatus;
  targetType?: TicketType;
  isTargetCompleted?: boolean;
}

export interface TicketMeta {
  id: number;
  title: string;
  type: TicketType;
  category?: TicketType; // Back-compat alias
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
  projectId?: number;
  project?: string;
  lastHash?: string;
  sha1?: string;
  links?: TicketLink[];
  isBlocked?: boolean;
}

export interface TicketComment {
  id: string;
  timestamp: string;
  author: string;
  text: string;
}

export interface InlineComment {
  id: string;
  timestamp: string;
  author: string;
  selectedText: string;
  comment: string;
}

export interface TicketHistorySnapshot {
  id: string;
  ticketId: string;
  type: 'plan' | 'detail' | 'comments' | 'other';
  filename: string;
  timestamp: string;
  content: string;
  snapshotNumber?: number;
  sha1?: string;
  meta?: TicketMeta;
  detailMarkdown?: string;
  planMarkdown?: string;
}

export interface PlannedFeature {
  id: string;
  number: number;
  ticketId: string;
  title: string;
  type: TicketType;
  category: TicketCategory;
  priority?: TicketPriority;
  complexity: string;
  estimatedEffort?: string;
  status?: TicketStatus;
  isActivePlanning?: boolean;
  isCompleted?: boolean;
  isRejected?: boolean;
  summary?: string;
  rationale?: string;
  rawDetail?: string;
  featureFlag?: string;
  milestone?: string;
  inheritedFeatureFlag?: string;
  projectId?: number;
  project?: string;
  projectDescriptor?: ProjectDescriptor;
  submittedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  revision?: number;
  breakdown: string[];
  technicalDetails?: string[];
  openQuestions?: string[];
  planMarkdown?: string;
  comments?: TicketComment[];
  inlineComments?: InlineComment[];
  historySnapshots?: TicketHistorySnapshot[];
  rawMarkdown?: string;
  sha1?: string;
  links?: EnrichedTicketLink[];
  isBlocked?: boolean;
}

export const KNOWN_FEATURE_FLAGS: readonly string[] = [] as const;
