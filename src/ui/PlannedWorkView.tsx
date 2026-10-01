import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Lightbulb, ShieldAlert, FileText, Search, ChevronRight, ChevronLeft, CheckCircle2, HelpCircle, Clock, Zap, List, Save, Edit3, Check, MessageSquare, Flag, Tag, User, Plus, Quote, Highlighter, Paperclip, GripHorizontal, ArrowRight, ArrowUp, ArrowDown, Trash2, Image as ImageIcon, RotateCcw, Columns, FileCode, Sliders, Split, History, Eye, XCircle, FolderKanban, Settings, Sun, Moon, ExternalLink, Milestone as MilestoneIcon, Link2 } from 'lucide-react';
import { TicketComment, TicketMeta, InlineComment, PlannedFeature, TicketHistorySnapshot, KNOWN_FEATURE_FLAGS, ProjectName, ALL_PROJECTS, ALL_PROJECT_NAMES, UNASSIGNED_PROJECT_COLORS, getProjectDescriptor, getProjectById, ProjectDescriptor, setRuntimeProjects, getRuntimeProjects, DEFAULT_ESEDRE_PORT, TicketPriority, PRIORITIES, PRIORITY_CONFIG, Milestone, LINK_RELATION_LABELS } from './types';
import { activePlanningProvider } from './planningClient';
import { parsePlannedWorkMarkdown } from './planParser';
import { CreateTicketModal } from './CreateTicketModal';
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { TicketHelpModal } from './TicketHelpModal';
import { MilestonesView } from './MilestonesView';
import { MilestoneModal } from './MilestoneModal';
import { LinkTicketModal } from './LinkTicketModal';
import { EsedreIcon } from './EsedreIcon';

export interface PlannedWorkViewProps {
  className?: string;
  onClose?: () => void;
  showHeader?: boolean;
  isEmbedded?: boolean;
  initialProject?: string;
  allowedProjects?: string[];
  readOnly?: boolean;
  standalonePort?: number;
  standaloneUrl?: string;
}

export function renderFormattedInlineMarkdown(text: string | undefined): React.ReactNode {
  if (!text) return null;

  const rawLines = text.split('\n');
  if (rawLines.length === 1 && !rawLines[0].trim().startsWith('|')) {
    return formatInlineTokens(text);
  }

  // Parse lines into structured chunks: table, headers, hr, blockquote, bullet, paragraph
  type Chunk =
    | { type: 'table'; header: string[]; rows: string[][] }
    | { type: 'h1'; text: string }
    | { type: 'h2'; text: string }
    | { type: 'h3'; text: string }
    | { type: 'hr' }
    | { type: 'blockquote'; lines: string[] }
    | { type: 'bullet'; text: string; isSub: boolean }
    | { type: 'paragraph'; text: string };

  const chunks: Chunk[] = [];
  let currentTableRows: string[][] = [];

  const flushTable = () => {
    if (currentTableRows.length > 0) {
      // Filter out separator rows (| :--- |)
      const cleanRows = currentTableRows.filter(
        (row) => !row.every((c) => c.replace(/[:\-]/g, '').trim() === '')
      );
      if (cleanRows.length > 0) {
        const header = cleanRows[0];
        const rows = cleanRows.slice(1);
        chunks.push({ type: 'table', header, rows });
      }
      currentTableRows = [];
    }
  };

  const isTableRow = (l: string) => {
    const trimmed = l.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 2;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (isTableRow(line)) {
      // Split by | while ignoring outer empty elements
      const rawCells = trimmed.slice(1, -1).split('|');
      const cells = rawCells.map((c) => c.trim());
      currentTableRows.push(cells);
      continue;
    } else {
      flushTable();
    }

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('# ')) {
      chunks.push({ type: 'h1', text: trimmed.replace(/^#\s+/, '') });
    } else if (trimmed.startsWith('## ')) {
      chunks.push({ type: 'h2', text: trimmed.replace(/^##\s+/, '') });
    } else if (trimmed.startsWith('### ')) {
      chunks.push({ type: 'h3', text: trimmed.replace(/^###\s+/, '') });
    } else if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      chunks.push({ type: 'hr' });
    } else if (trimmed.startsWith('>')) {
      const bqText = trimmed.replace(/^>\s?/, '');
      chunks.push({ type: 'blockquote', lines: [bqText] });
    } else if (/^[-\u2022*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const isSubBullet = line.startsWith('  ') || line.startsWith('\t');
      const cleanText = trimmed.replace(/^[-\u2022*]\s+/, '').replace(/^\d+\.\s+/, '');
      chunks.push({ type: 'bullet', text: cleanText, isSub: isSubBullet });
    } else {
      chunks.push({ type: 'paragraph', text: line });
    }
  }
  flushTable();

  return (
    <div className="space-y-2">
      {chunks.map((chunk, cIdx) => {
        if (chunk.type === 'table') {
          return (
            <div key={cIdx} className="overflow-x-auto my-3 w-full border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-surface)] shadow-2xs">
              <table className="w-full text-left border-collapse text-xs">
                {chunk.header.length > 0 && (
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
                      {chunk.header.map((cell, cellIdx) => (
                        <th key={cellIdx} className="px-3 py-2 font-bold text-[var(--accent-primary)] font-mono">
                          {formatInlineTokens(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {chunk.rows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--accent-bg-subtle)] transition-colors">
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="px-3 py-2 text-[var(--text-primary)] align-top">
                          {formatInlineTokens(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (chunk.type === 'h1') {
          return (
            <h3 key={cIdx} className="text-base font-bold text-[var(--text-primary)] mt-3 mb-1 font-display">
              {formatInlineTokens(chunk.text)}
            </h3>
          );
        }

        if (chunk.type === 'h2') {
          return (
            <h4 key={cIdx} className="text-sm font-bold text-[var(--accent-primary)] mt-2.5 mb-1 flex items-center gap-1.5">
              {formatInlineTokens(chunk.text)}
            </h4>
          );
        }

        if (chunk.type === 'h3') {
          return (
            <h5 key={cIdx} className="text-xs font-bold text-[var(--text-secondary)] mt-2 mb-0.5 font-mono">
              {formatInlineTokens(chunk.text)}
            </h5>
          );
        }

        if (chunk.type === 'hr') {
          return <hr key={cIdx} className="my-3 border-t border-[var(--border-subtle)]" />;
        }

        if (chunk.type === 'blockquote') {
          return (
            <div key={cIdx} className="border-l-2 border-[var(--accent-primary)] pl-3 py-1.5 my-1.5 text-[var(--text-secondary)] italic bg-[var(--accent-bg-subtle)] rounded-r-lg">
              {chunk.lines.map((l, lIdx) => (
                <p key={lIdx}>{formatInlineTokens(l)}</p>
              ))}
            </div>
          );
        }

        if (chunk.type === 'bullet') {
          return (
            <div
              key={cIdx}
              className={`leading-relaxed flex items-start gap-1.5 ${
                chunk.isSub ? 'pl-4 text-[var(--text-muted)] before:content-["-"] before:text-[var(--accent-primary)] before:font-bold' : 'text-[var(--text-secondary)] before:content-["•"] before:text-[var(--accent-primary)] before:font-bold'
              }`}
            >
              <div className="flex-1 min-w-0">{formatInlineTokens(chunk.text)}</div>
            </div>
          );
        }

        return (
          <p key={cIdx} className="text-[var(--text-secondary)] leading-relaxed">
            {formatInlineTokens(chunk.text)}
          </p>
        );
      })}
    </div>
  );
}

function formatInlineTokens(text: string): React.ReactNode {
  if (!text) return null;

  // Handle <br> tags
  const brSplit = text.split(/<br\s*\/?>/i);
  if (brSplit.length > 1) {
    return brSplit.map((segment, sIdx) => (
      <React.Fragment key={sIdx}>
        {sIdx > 0 && <br />}
        {formatInlineTokens(segment)}
      </React.Fragment>
    ));
  }

  // Handle markdown links [text](url), bold **text**, `code`, and *italic*
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g);

  return tokens.map((token, idx) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-semibold select-text"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      const inner = token.slice(2, -2);
      return (
        <strong key={idx} className="font-bold text-[var(--text-primary)]">
          {formatInlineTokens(inner)}
        </strong>
      );
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2 && !token.startsWith('**')) {
      const inner = token.slice(1, -1);
      return (
        <em key={idx} className="italic text-[var(--text-secondary)]">
          {formatInlineTokens(inner)}
        </em>
      );
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-700 dark:text-[var(--accent-primary)] hover:underline font-medium"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return token;
  });
}

export interface DiffLine {
  type: 'add' | 'remove' | 'same';
  text: string;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  const matrix: number[][] = Array(oldLines.length + 1)
    .fill(0)
    .map(() => Array(newLines.length + 1).fill(0));

  for (let i = 0; i < oldLines.length; i++) {
    for (let j = 0; j < newLines.length; j++) {
      if (oldLines[i] === newLines[j]) {
        matrix[i + 1][j + 1] = matrix[i][j] + 1;
      } else {
        matrix[i + 1][j + 1] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }

  let i = oldLines.length;
  let j = newLines.length;

  const temp: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({ type: 'same', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      temp.push({ type: 'add', text: newLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
      temp.push({ type: 'remove', text: oldLines[i - 1] });
      i--;
    }
  }

  return temp.reverse();
}

type TabType = 'features' | 'completed' | 'rejected' | 'milestones' | 'flags';


const ESEDRE_THEME_FALLBACK_CSS = `
.esedre-host-bridge {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  --esedre-host-bg-surface: var(--bg-surface);
  --esedre-host-bg-surface-elevated: var(--bg-surface-elevated);
  --esedre-host-bg-input: var(--bg-input);
  --esedre-host-border-subtle: var(--border-subtle);
  --esedre-host-border-strong: var(--border-strong);
  --esedre-host-border-accent: var(--border-accent);
  --esedre-host-accent-primary: var(--accent-primary);
  --esedre-host-accent-bg-subtle: var(--accent-bg-subtle);
  --esedre-host-accent-border-subtle: var(--accent-border-subtle);
  --esedre-host-text-primary: var(--text-primary);
  --esedre-host-text-secondary: var(--text-secondary);
  --esedre-host-text-muted: var(--text-muted);
}

.esedre-theme-root {
  /* Sane default light theme fallbacks */
  --esedre-default-bg-surface: #ffffff;
  --esedre-default-bg-surface-elevated: #f1f5f9;
  --esedre-default-bg-input: #ffffff;
  --esedre-default-border-subtle: #e2e8f0;
  --esedre-default-border-strong: #cbd5e1;
  --esedre-default-border-accent: rgba(14, 116, 144, 0.4);
  --esedre-default-accent-primary: #0284c7;
  --esedre-default-accent-bg-subtle: rgba(2, 132, 199, 0.08);
  --esedre-default-accent-border-subtle: rgba(2, 132, 199, 0.25);
  --esedre-default-text-primary: #0f172a;
  --esedre-default-text-secondary: #334155;
  --esedre-default-text-muted: #64748b;

  /* Bind CSS variables: host values take precedence; fall back to defaults if unset */
  --bg-surface: var(--esedre-host-bg-surface, var(--esedre-default-bg-surface));
  --bg-surface-elevated: var(--esedre-host-bg-surface-elevated, var(--esedre-default-bg-surface-elevated));
  --bg-input: var(--esedre-host-bg-input, var(--esedre-default-bg-input));
  --border-subtle: var(--esedre-host-border-subtle, var(--esedre-default-border-subtle));
  --border-strong: var(--esedre-host-border-strong, var(--esedre-default-border-strong));
  --border-accent: var(--esedre-host-border-accent, var(--esedre-default-border-accent));
  --accent-primary: var(--esedre-host-accent-primary, var(--esedre-default-accent-primary));
  --accent-bg-subtle: var(--esedre-host-accent-bg-subtle, var(--esedre-default-accent-bg-subtle));
  --accent-border-subtle: var(--esedre-host-accent-border-subtle, var(--esedre-default-accent-border-subtle));
  --text-primary: var(--esedre-host-text-primary, var(--esedre-default-text-primary));
  --text-secondary: var(--esedre-host-text-secondary, var(--esedre-default-text-secondary));
  --text-muted: var(--esedre-host-text-muted, var(--esedre-default-text-muted));
}

/* Dark theme fallbacks when host or ancestor has .dark, night theme attribute, or system dark mode */
.dark .esedre-theme-root,
.esedre-theme-root.dark,
[data-theme="night"] .esedre-theme-root,
[data-theme="dark"] .esedre-theme-root {
  --esedre-default-bg-surface: #0a0e1a;
  --esedre-default-bg-surface-elevated: #0f172a;
  --esedre-default-bg-input: #0b0f19;
  --esedre-default-border-subtle: #1e293b;
  --esedre-default-border-strong: #334155;
  --esedre-default-border-accent: rgba(99, 102, 241, 0.5);
  --esedre-default-accent-primary: #818cf8;
  --esedre-default-accent-bg-subtle: rgba(99, 102, 241, 0.12);
  --esedre-default-accent-border-subtle: rgba(99, 102, 241, 0.3);
  --esedre-default-text-primary: #f8fafc;
  --esedre-default-text-secondary: #94a3b8;
  --esedre-default-text-muted: #64748b;
}

@media (prefers-color-scheme: dark) {
  :not(.light) > .esedre-theme-root:not(.light) {
    --esedre-default-bg-surface: #0a0e1a;
    --esedre-default-bg-surface-elevated: #0f172a;
    --esedre-default-bg-input: #0b0f19;
    --esedre-default-border-subtle: #1e293b;
    --esedre-default-border-strong: #334155;
    --esedre-default-border-accent: rgba(99, 102, 241, 0.5);
    --esedre-default-accent-primary: #818cf8;
    --esedre-default-accent-bg-subtle: rgba(99, 102, 241, 0.12);
    --esedre-default-accent-border-subtle: rgba(99, 102, 241, 0.3);
    --esedre-default-text-primary: #f8fafc;
    --esedre-default-text-secondary: #94a3b8;
    --esedre-default-text-muted: #64748b;
  }
}
`;

export interface DetectIsEmbeddedOptions {
  isEmbeddedProp?: boolean;
  showHeader?: boolean;
  allowedProjects?: string[];
  search?: string;
  isIframe?: boolean;
}

export function detectIsEmbedded(options: DetectIsEmbeddedOptions): boolean {
  if (typeof options.isEmbeddedProp === 'boolean') {
    return options.isEmbeddedProp;
  }
  if (typeof options.isIframe === 'boolean' && options.isIframe) {
    return true;
  }
  if (options.search) {
    try {
      if (new URLSearchParams(options.search).get('embedded') === 'true') {
        return true;
      }
    } catch {}
  }
  if (options.showHeader === false) {
    return true;
  }
  if (
    options.allowedProjects &&
    options.allowedProjects.length > 0 &&
    !options.allowedProjects.includes('*')
  ) {
    return true;
  }
  return false;
}

export function updateProjectUrlSearchParam(val: string, isEmbedded: boolean): void {
  if (isEmbedded) return;
  if (typeof window === 'undefined' || !window.location) return;
  try {
    const url = new URL(window.location.href);
    if (val === 'all') {
      url.searchParams.delete('project');
    } else {
      url.searchParams.set('project', val);
    }
    window.history.replaceState({}, '', url.toString());
  } catch (err) {}
}

export function PlannedWorkView({
  className = '',
  onClose,
  showHeader = true,
  isEmbedded: isEmbeddedProp,
  initialProject,
  allowedProjects,
  readOnly = false,
  standalonePort,
  standaloneUrl,
}: PlannedWorkViewProps) {
  const researcherUsername = typeof window !== 'undefined'
    ? (localStorage.getItem('esedre_username') || localStorage.getItem('developer_name') || localStorage.getItem('sleep_professor_username') || '').trim()
    : '';
  const isOwner = !readOnly; // In DEV mode, developer has full read/write permissions unless readOnly
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  // Autonomous, DNS-agnostic detection of whether Esedre is running in an embedded context
  const isEmbedded = useMemo(() => {
    return detectIsEmbedded({
      isEmbeddedProp,
      showHeader,
      allowedProjects,
      search: typeof window !== 'undefined' ? window.location?.search : '',
      isIframe: typeof window !== 'undefined' ? window.parent !== window : false,
    });
  }, [isEmbeddedProp, showHeader, allowedProjects]);

  // Standalone dedicated UI theme state (only active when showHeader is true)
  const [dedicatedTheme, setDedicatedTheme] = useState<'day' | 'night'>(() => {
    if (typeof window === 'undefined') return 'night';
    const saved = localStorage.getItem('theme') || localStorage.getItem('themeVariant');
    if (saved === 'day' || saved === 'light') return 'day';
    return 'night';
  });

  const toggleDedicatedTheme = () => {
    const next = dedicatedTheme === 'night' ? 'day' : 'night';
    setDedicatedTheme(next);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('theme', next);
        localStorage.setItem('themeVariant', next);
      } catch (e) {}
    }
  };

  useEffect(() => {
    if (!showHeader || typeof document === 'undefined') return;
    const root = document.documentElement;
    const isDay = dedicatedTheme === 'day';
    root.setAttribute('data-theme', dedicatedTheme);
    root.setAttribute('data-color-scheme', isDay ? 'light' : 'dark');
    if (isDay) {
      root.classList.add('theme-light');
      root.classList.remove('dark');
    } else {
      root.classList.remove('theme-light');
      root.classList.add('dark');
    }
  }, [showHeader, dedicatedTheme]);

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('dev_plan_modal_tab') as TabType;
      if (['features', 'completed', 'rejected', 'milestones', 'flags'].includes(saved)) return saved;
    }
    return 'features';
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('dev_plan_search_query') || '';
    }
    return '';
  });
  const [complexityFilter, setComplexityFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('dev_plan_complexity_filter') || 'all';
    }
    return 'all';
  });
  const [priorityFilter, setPriorityFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('dev_plan_priority_filter') || 'all';
    }
    return 'all';
  });
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('dev_plan_type_filter') || sessionStorage.getItem('dev_plan_category_filter') || 'all';
    }
    return 'all';
  });
  const [milestoneFilter, setMilestoneFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('dev_plan_milestone_filter') || 'all';
    }
    return 'all';
  });
  const [projectFilter, setProjectFilter] = useState<string>(() => {
    if (initialProject) return initialProject;
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('dev_plan_project_filter');
      if (saved) {
        if (!allowedProjects || allowedProjects.length === 0 || allowedProjects.map((p) => p.toUpperCase()).includes(saved.toUpperCase()) || saved === 'all') {
          return saved;
        }
      }
    }
    return (allowedProjects && allowedProjects.length > 0) ? allowedProjects[0] : 'all';
  });
  const [availableProjects, setAvailableProjects] = useState<ProjectDescriptor[]>(() => {
    if (allowedProjects && allowedProjects.length > 0) {
      const normalized = allowedProjects.map((p) => p.trim().toUpperCase());
      return ALL_PROJECTS.filter((p) => normalized.includes(p.code.toUpperCase()));
    }
    return ALL_PROJECTS;
  });

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isMilestoneModalOpen, setIsMilestoneModalOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [linkingTicket, setLinkingTicket] = useState<PlannedFeature | null>(null);

  const loadMilestones = useCallback(async () => {
    if (!activePlanningProvider.listMilestones) return;
    try {
      const ms = await activePlanningProvider.listMilestones(projectFilter === 'all' ? undefined : projectFilter);
      setMilestones(ms || []);
    } catch (err) {
      console.error('Failed to load milestones:', err);
    }
  }, [projectFilter]);

  useEffect(() => {
    loadMilestones();
  }, [loadMilestones]);
  type SortField = 'ticketNumber' | 'lastUpdated';
  type SortOrder = 'asc' | 'desc';

  const DEFAULT_SORT_ORDERS: Record<SortField, SortOrder> = {
    ticketNumber: 'asc',
    lastUpdated: 'desc',
  };

  const [sortDirectionsMap, setSortDirectionsMap] = useState<Partial<Record<SortField, SortOrder>>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('dev_plan_sort_directions_map') || sessionStorage.getItem('dev_plan_sort_directions_map');
        if (raw) {
          const parsed = JSON.parse(raw);
          const result: Partial<Record<SortField, SortOrder>> = {};
          if (parsed.ticketNumber === 'asc' || parsed.ticketNumber === 'desc') {
            result.ticketNumber = parsed.ticketNumber;
          }
          if (parsed.lastUpdated === 'asc' || parsed.lastUpdated === 'desc') {
            result.lastUpdated = parsed.lastUpdated;
          }
          return result;
        }
      } catch (e) {}
    }
    return {};
  });

  const [sortBy, setSortBy] = useState<SortField>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dev_plan_sort_by') || sessionStorage.getItem('dev_plan_sort_by');
      if (saved === 'ticketNumber' || saved === 'lastUpdated') return saved as SortField;
    }
    return 'ticketNumber';
  });

  const sortOrder: SortOrder = sortDirectionsMap[sortBy] || DEFAULT_SORT_ORDERS[sortBy];

  const toggleSortDirection = (targetSortBy: SortField = sortBy) => {
    setSortDirectionsMap((prev) => {
      const currentDir = prev[targetSortBy] || DEFAULT_SORT_ORDERS[targetSortBy];
      const nextOrder: SortOrder = currentDir === 'asc' ? 'desc' : 'asc';
      const updated = {
        ...prev,
        [targetSortBy]: nextOrder,
      };
      try {
        localStorage.setItem('dev_plan_sort_directions_map', JSON.stringify(updated));
        sessionStorage.setItem('dev_plan_sort_directions_map', JSON.stringify(updated));
      } catch (err) {}
      return updated;
    });
  };
  const [inDevOnly, setInDevOnly] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('dev_plan_in_dev_filter');
      return saved === 'true';
    }
    return false;
  });
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('detail');
  const [headerPopover, setHeaderPopover] = useState<{
    ticketId: string;
    type: 'flag' | 'category' | 'complexity' | 'priority' | 'flagPicker' | 'status' | 'project';
    x: number;
    y: number;
  } | null>(null);
  const headerPopoverRef = useRef<HTMLDivElement>(null);
  const [customFlagText, setCustomFlagText] = useState('');
  const [expandedFeatureId, setExpandedFeatureId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      if (!isEmbedded && window.location.hash) {
        const match = window.location.hash.match(/^#(?:ticket-|feature-)?(\d+)$/i);
        if (match) {
          return `feature-${match[1]}`;
        }
      }
      if (isEmbedded) {
        return sessionStorage.getItem('dev_plan_modal_expanded_feat');
      }
      return null;
    }
    return null;
  });
  const [showToc, setShowToc] = useState(true);
  const [tocWidth, setTocWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dev_plan_toc_width') || sessionStorage.getItem('dev_plan_toc_width');
      if (saved) return parseInt(saved, 10);
    }
    return 320;
  });
  const [isResizing, setIsResizing] = useState(false);



  const handleUpdateTocWidth = (newWidth: number) => {
    const clamped = Math.max(220, Math.min(650, newWidth));
    setTocWidth(clamped);
    try {
      localStorage.setItem('dev_plan_toc_width', clamped.toString());
      sessionStorage.setItem('dev_plan_toc_width', clamped.toString());
    } catch (err) {}
  };

  // Ticket answers, plans & comments states
  const [answersMap, setAnswersMap] = useState<Record<string, Record<string, string>>>(() => {
    const res = activePlanningProvider.getAnswers();
    return res instanceof Promise ? {} : res;
  });
  const [plansMap, setPlansMap] = useState<Record<string, string>>(() => {
    const res = activePlanningProvider.getPlans();
    return res instanceof Promise ? {} : res;
  });
  const [commentsMap, setCommentsMap] = useState<Record<string, TicketComment[]>>(() => {
    const res = activePlanningProvider.getComments();
    return res instanceof Promise ? {} : res;
  });
  const [metasMap, setMetasMap] = useState<Record<string, TicketMeta>>(() => {
    const res = activePlanningProvider.getMetas();
    return res instanceof Promise ? {} : res;
  });
  const [inlineCommentsMap, setInlineCommentsMap] = useState<Record<string, InlineComment[]>>(() => {
    const res = activePlanningProvider.getInlineComments();
    return res instanceof Promise ? {} : res;
  });
  const [planHistoryMap, setPlanHistoryMap] = useState<Record<string, { filename: string; content: string }[]>>(() => {
    const res = activePlanningProvider.getPlanHistory();
    return res instanceof Promise ? {} : res;
  });
  const [ticketHistoryMap, setTicketHistoryMap] = useState<Record<string, TicketHistorySnapshot[]>>(() => {
    const res = activePlanningProvider.getHistory();
    return res instanceof Promise ? {} : res;
  });
  const [detailsMap, setDetailsMap] = useState<Record<string, string>>(() => {
    const res = activePlanningProvider.getTicketDetails();
    return res instanceof Promise ? {} : res;
  });
  const [historyActiveSnapshotIdx, setHistoryActiveSnapshotIdx] = useState<Record<string, number>>({});
  const [historyViewMode, setHistoryViewMode] = useState<Record<string, 'diff' | 'rendered' | 'side-by-side'>>({});

  const [editingDetailTicketId, setEditingDetailTicketId] = useState<string | null>(null);
  const [detailEditorMode, setDetailEditorMode] = useState<'structured' | 'raw'>('structured');
  const [structuredRationale, setStructuredRationale] = useState<string>('');
  const [structuredBreakdown, setStructuredBreakdown] = useState<string[]>([]);
  const [structuredTechDetails, setStructuredTechDetails] = useState<string[]>([]);
  const [structuredOpenQuestions, setStructuredOpenQuestions] = useState<string[]>([]);
  const [rawDetailDraft, setRawDetailDraft] = useState<string>('');

  const [cardSubTabs, setCardSubTabs] = useState<Record<string, 'spec' | 'plan' | 'notes' | 'history' | 'links'>>({});
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [selectedSettingsProjectCode, setSelectedSettingsProjectCode] = useState<string | null>(null);

  const currentProject = useMemo(() => {
    if (projectFilter === 'all') return null;
    const lower = projectFilter.toLowerCase();
    return (
      availableProjects.find((p) => p.code.toLowerCase() === lower || String(p.id) === projectFilter) ||
      getProjectDescriptor(projectFilter) ||
      null
    );
  }, [projectFilter, availableProjects]);

  const activeSettingsProject = useMemo(() => {
    if (selectedSettingsProjectCode) {
      const found = availableProjects.find((p) => p.code.toLowerCase() === selectedSettingsProjectCode.toLowerCase());
      if (found) return found;
    }
    return currentProject || (availableProjects.length > 0 ? availableProjects[0] : null);
  }, [selectedSettingsProjectCode, currentProject, availableProjects]);
  const [editingAuthorTicketId, setEditingAuthorTicketId] = useState<string | null>(null);
  const [authorDraftText, setAuthorDraftText] = useState<string>('');
  const [editingTitleTicketId, setEditingTitleTicketId] = useState<string | null>(null);
  const [titleDraftText, setTitleDraftText] = useState<string>('');

  const [selectionPopover, setSelectionPopover] = useState<{
    x: number;
    y: number;
    text: string;
    ticketId: string;
  } | null>(null);
  const [inlineCommentInput, setInlineCommentInput] = useState<{
    ticketId: string;
    selectedText: string;
    comment: string;
    x?: number;
    y?: number;
  } | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dev_planner_inline_comment_draft');
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return null;
  });

  const [expandedQuestionKey, setExpandedQuestionKey] = useState<string | null>(null);
  const [newCommentDraft, setNewCommentDraft] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dev_planner_comment_drafts');
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return {};
  });
  const [planDraftsMap, setPlanDraftsMap] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dev_planner_plan_drafts');
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return {};
  });
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dev_planner_question_drafts');
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return {};
  });

  const handleUpdateQuestionDraft = (ticketId: string, questionIndex: number, text: string) => {
    const key = `${ticketId}_${questionIndex}`;
    setQuestionDrafts((prev) => {
      const updated = { ...prev, [key]: text };
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('dev_planner_question_drafts', JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
  };
  const [saveStatus, setSaveStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [editingPlanTicketId, setEditingPlanTicketId] = useState<string | null>(null);
  const [planDraftText, setPlanDraftText] = useState<string>('');

  const handleUpdateCommentDraft = (ticketId: string, text: string) => {
    setNewCommentDraft((prev) => {
      const updated = { ...prev };
      if (!text) {
        delete updated[ticketId];
      } else {
        updated[ticketId] = text;
      }
      if (typeof localStorage !== 'undefined') {
        try {
          if (Object.keys(updated).length === 0) {
            localStorage.removeItem('dev_planner_comment_drafts');
          } else {
            localStorage.setItem('dev_planner_comment_drafts', JSON.stringify(updated));
          }
        } catch (e) {}
      }
      return updated;
    });
  };

  const handleUpdatePlanDraft = (ticketId: string, text: string) => {
    setPlanDraftText(text);
    setPlanDraftsMap((prev) => {
      const updated = { ...prev, [ticketId]: text };
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('dev_planner_plan_drafts', JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
  };

  const handleClearPlanDraft = (ticketId: string) => {
    setPlanDraftsMap((prev) => {
      const updated = { ...prev };
      delete updated[ticketId];
      if (typeof localStorage !== 'undefined') {
        try {
          if (Object.keys(updated).length === 0) {
            localStorage.removeItem('dev_planner_plan_drafts');
          } else {
            localStorage.setItem('dev_planner_plan_drafts', JSON.stringify(updated));
          }
        } catch (e) {}
      }
      return updated;
    });
  };

  const handleUpdateInlineDraft = (val: typeof inlineCommentInput) => {
    setInlineCommentInput(val);
    if (typeof localStorage !== 'undefined') {
      try {
        if (!val || !val.comment) {
          localStorage.removeItem('dev_planner_inline_comment_draft');
        } else {
          localStorage.setItem('dev_planner_inline_comment_draft', JSON.stringify(val));
        }
      } catch (e) {}
    }
  };

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const handleRefresh = useCallback(() => setRefreshTrigger((v) => v + 1), []);

  useEffect(() => {
    const loadAsyncData = async () => {
      try {
        if (activePlanningProvider.getAll) {
          const allData = await activePlanningProvider.getAll();
          if (allData && allData.success) {
            if (allData.answers) setAnswersMap(allData.answers);
            if (allData.plans) setPlansMap(allData.plans);
            if (allData.comments) setCommentsMap(allData.comments);
            if (allData.metas) setMetasMap(allData.metas);
            if (allData.inlineComments) setInlineCommentsMap(allData.inlineComments);
            if (allData.planHistory) setPlanHistoryMap(allData.planHistory);
            if (allData.details) setDetailsMap(allData.details);
            if (allData.ticketHistory) setTicketHistoryMap(allData.ticketHistory);
            const areProjectsEqual = (a: ProjectDescriptor[], b: ProjectDescriptor[]) =>
              a.length === b.length &&
              a.every((p, i) =>
                p.id === b[i].id &&
                p.code === b[i].code &&
                p.name === b[i].name &&
                p.description === b[i].description &&
                p.guidelinesRef === b[i].guidelinesRef &&
                JSON.stringify(p.techStack) === JSON.stringify(b[i].techStack) &&
                JSON.stringify(p.groundingRules) === JSON.stringify(b[i].groundingRules) &&
                p.colors?.badge === b[i].colors?.badge
              );

            if (Array.isArray(allData.projects) && allData.projects.length > 0) {
              setRuntimeProjects(allData.projects);
              const filtered = (allowedProjects && allowedProjects.length > 0)
                ? allData.projects.filter((p: ProjectDescriptor) => allowedProjects.map((a) => a.toUpperCase()).includes(p.code.toUpperCase()))
                : allData.projects;
              setAvailableProjects((prev) => areProjectsEqual(prev, filtered) ? prev : filtered);
            } else if (activePlanningProvider.getProjects) {
              const projs = await activePlanningProvider.getProjects();
              if (Array.isArray(projs) && projs.length > 0) {
                setRuntimeProjects(projs);
                const filtered = (allowedProjects && allowedProjects.length > 0)
                  ? projs.filter((p: ProjectDescriptor) => allowedProjects.map((a) => a.toUpperCase()).includes(p.code.toUpperCase()))
                  : projs;
                setAvailableProjects((prev) => areProjectsEqual(prev, filtered) ? prev : filtered);
              }
            }
            return;
          }
        }
        const [answers, plans, comments, metas, inlines, history, details, ticketHistory] = await Promise.all([
          activePlanningProvider.getAnswers(),
          activePlanningProvider.getPlans(),
          activePlanningProvider.getComments(),
          activePlanningProvider.getMetas(),
          activePlanningProvider.getInlineComments(),
          activePlanningProvider.getPlanHistory(),
          activePlanningProvider.getTicketDetails(),
          activePlanningProvider.getHistory(),
        ]);
        setAnswersMap(answers || {});
        setPlansMap(plans || {});
        setCommentsMap(comments || {});
        setMetasMap(metas || {});
        setInlineCommentsMap(inlines || {});
        setPlanHistoryMap(history || {});
        setDetailsMap(details || {});
        setTicketHistoryMap(ticketHistory || {});
        if (activePlanningProvider.getProjects) {
          const projs = await activePlanningProvider.getProjects();
          if (Array.isArray(projs) && projs.length > 0) {
            setRuntimeProjects(projs);
            const filtered = (allowedProjects && allowedProjects.length > 0)
              ? projs.filter((p: ProjectDescriptor) => allowedProjects.map((a) => a.toUpperCase()).includes(p.code.toUpperCase()))
              : projs;
            const areProjectsEqual = (a: ProjectDescriptor[], b: ProjectDescriptor[]) =>
              a.length === b.length &&
              a.every((p, i) =>
                p.id === b[i].id &&
                p.code === b[i].code &&
                p.name === b[i].name &&
                p.description === b[i].description &&
                p.guidelinesRef === b[i].guidelinesRef &&
                JSON.stringify(p.techStack) === JSON.stringify(b[i].techStack) &&
                JSON.stringify(p.groundingRules) === JSON.stringify(b[i].groundingRules) &&
                p.colors?.badge === b[i].colors?.badge
              );
            setAvailableProjects((prev) => areProjectsEqual(prev, filtered) ? prev : filtered);
          }
        }
      } catch (err) {
        console.error('Failed to load async planning data:', err);
      }
    };

    loadAsyncData();
    const interval = setInterval(loadAsyncData, 3000);
    window.addEventListener('focus', loadAsyncData);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', loadAsyncData);
    };
  }, [refreshTrigger]);

  const [flagDescriptionsMap, setFlagDescriptionsMap] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dev_feature_flags_descriptions');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load dev_feature_flags_descriptions', e);
      }
    }
    return {};
  });
  const [deletedFlags, setDeletedFlags] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dev_deleted_feature_flags');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load dev_deleted_feature_flags', e);
      }
    }
    return [];
  });
  const [editingFlagDescName, setEditingFlagDescName] = useState<string | null>(null);
  const [editingFlagDescText, setEditingFlagDescText] = useState<string>('');

  const handleDeleteFlag = (flagName: string) => {
    const updatedDeleted = [...deletedFlags, flagName];
    setDeletedFlags(updatedDeleted);
    localStorage.setItem('dev_deleted_feature_flags', JSON.stringify(updatedDeleted));

    const updatedDescs = { ...flagDescriptionsMap };
    delete updatedDescs[flagName];
    setFlagDescriptionsMap(updatedDescs);
    localStorage.setItem('dev_feature_flags_descriptions', JSON.stringify(updatedDescs));
  };

  const handleLinkFlagToTicket = async (ticketId: string, flagName: string) => {
    setHeaderPopover(null);
    setCustomFlagText('');
    try {
      await activePlanningProvider.updateMeta(ticketId, { featureFlag: flagName });
      setMetasMap((prev) => ({
        ...prev,
        [ticketId]: { ...prev[ticketId], featureFlag: flagName },
      }));

      if (deletedFlags.includes(flagName)) {
        const updatedDeleted = deletedFlags.filter((f) => f !== flagName);
        setDeletedFlags(updatedDeleted);
        localStorage.setItem('dev_deleted_feature_flags', JSON.stringify(updatedDeleted));
      }

      if (!flagDescriptionsMap[flagName]) {
        const updatedDescs = { ...flagDescriptionsMap, [flagName]: `Feature flag linked to Ticket #${ticketId}` };
        setFlagDescriptionsMap(updatedDescs);
        localStorage.setItem('dev_feature_flags_descriptions', JSON.stringify(updatedDescs));
      }
    } catch (err) {
      console.error('Failed to set feature flag:', err);
    }
  };



  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionPopover(null);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  // Stack-based Escape key & backdrop click handlers for floating popovers / dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        if (headerPopover) {
          setHeaderPopover(null);
        } else if (inlineCommentInput) {
          setInlineCommentInput(null);
        } else if (selectionPopover) {
          setSelectionPopover(null);
        } else if (editingAuthorTicketId) {
          setEditingAuthorTicketId(null);
        } else if (isHelpModalOpen) {
          setIsHelpModalOpen(false);
        } else if (isCreateModalOpen) {
          setIsCreateModalOpen(false);
        } else if (isCreateProjectOpen) {
          setIsCreateProjectOpen(false);
        } else if (editingDetailTicketId) {
          setEditingDetailTicketId(null);
        } else if (onClose) {
          onClose();
        }
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (headerPopover) {
        if (
          headerPopoverRef.current &&
          !headerPopoverRef.current.contains(e.target as Node)
        ) {
          const targetEl = e.target as HTMLElement;
          if (targetEl.closest('[data-popover-trigger="true"]')) {
            return;
          }
          setHeaderPopover(null);
          setCustomFlagText('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('mousedown', handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('mousedown', handlePointerDown, { capture: true });
    };
  }, [
    headerPopover,
    inlineCommentInput,
    selectionPopover,
    editingAuthorTicketId,
    isHelpModalOpen,
    isCreateModalOpen,
    isCreateProjectOpen,
    editingDetailTicketId,
    onClose,
  ]);

  const handleSaveAuthor = async (ticketId: string, newAuthor: string) => {
    const trimmed = newAuthor.trim() || researcherUsername || 'Developer';
    setEditingAuthorTicketId(null);
    setMetasMap((prev) => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], submittedBy: trimmed },
    }));

    try {
      await activePlanningProvider.updateMeta(ticketId, { submittedBy: trimmed });
    } catch (err) {
      console.error('Failed to update author:', err);
    }
  };

  const handleSaveTitle = async (ticketId: string, newTitle: string) => {
    const trimmed = newTitle.slice(0, 48).trim();
    setEditingTitleTicketId(null);
    if (!trimmed) return;

    setMetasMap((prev) => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], title: trimmed },
    }));

    try {
      await activePlanningProvider.updateMeta(ticketId, { title: trimmed });
    } catch (err) {
      console.error('Failed to update ticket title:', err);
    }
  };

  const handleTextSelection = (ticketId: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!isOwner) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }
    const text = selection.toString().trim();
    if (text.length < 2) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSelectionPopover({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
          text,
          ticketId,
        });
      }
    } catch {
      setSelectionPopover({
        x: e.clientX,
        y: e.clientY - 20,
        text,
        ticketId,
      });
    }
  };

  const handleCommentHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const panelWidth = 384;
    const initialX = inlineCommentInput?.x ?? Math.min(window.innerWidth - panelWidth - 12, Math.max(12, window.innerWidth / 2 - panelWidth / 2));
    const initialY = inlineCommentInput?.y ?? Math.min(window.innerHeight - 280, Math.max(60, window.innerHeight / 2 + 12));

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const panelHeight = 250;
      const newX = Math.min(window.innerWidth - panelWidth - 12, Math.max(12, initialX + deltaX));
      const newY = Math.min(window.innerHeight - panelHeight - 12, Math.max(12, initialY + deltaY));

      setInlineCommentInput((prev) => (prev ? { ...prev, x: newX, y: newY } : null));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleSaveInlineComment = async (ticketId: string, selectedText: string, commentText: string) => {
    if (!commentText.trim()) return;
    try {
      const updatedInline = await activePlanningProvider.saveInlineComment(ticketId, selectedText, commentText);
      setInlineCommentsMap((prev) => ({
        ...prev,
        [ticketId]: updatedInline,
      }));
      handleUpdateInlineDraft(null);
      setSelectionPopover(null);
    } catch (err) {
      console.error('Failed to save inline comment:', err);
    }
  };

  const handleUploadFile = async (ticketId: string, file: File) => {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      try {
        const res = await fetch('/api/planning/upload-attachment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, filename: file.name, base64Data }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.url) {
            const tag = isVideo
              ? `\n<video src="${data.url}" controls class="max-h-60 rounded-xl border border-slate-800 my-2" />\n`
              : `\n![${data.filename}](${data.url})\n`;
            handleUpdateCommentDraft(ticketId, (newCommentDraft[ticketId] || '') + tag);
          }
        }
      } catch (err) {
        console.error('Failed to upload media attachment:', err);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePasteMedia = (ticketId: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        e.preventDefault();
        handleUploadFile(ticketId, file);
      }
    }
  };

  const renderCommentWithMedia = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(!\[.*?\]\(.*?\)|<video src=".*?" controls.*?\/>)/g);

    return (
      <div className="space-y-1.5">
        {parts.map((part, idx) => {
          const imgMatch = /^!\[(.*?)\]\((.*?)\)$/.exec(part);
          if (imgMatch) {
            return (
              <img
                key={idx}
                src={imgMatch[2]}
                alt={imgMatch[1]}
                className="max-h-60 rounded-xl border border-[var(--border-subtle)] my-1 object-contain bg-[var(--bg-input)] shadow-md"
              />
            );
          }
          const vidMatch = /^<video src="(.*?)" controls.*?\/>$/.exec(part);
          if (vidMatch) {
            return (
              <video
                key={idx}
                src={vidMatch[1]}
                controls
                className="max-h-60 rounded-xl border border-[var(--border-subtle)] my-1 w-full bg-[var(--bg-input)] shadow-md"
              />
            );
          }
          if (!part.trim()) return null;
          return <p key={idx} className="text-xs text-[var(--text-secondary)] leading-relaxed font-sans whitespace-pre-wrap">{part}</p>;
        })}
      </div>
    );
  };

  const handleSaveAnswer = async (ticketId: string, questionIndex: number, answerText: string) => {
    const key = `${ticketId}_${questionIndex}`;
    setSaveStatus((prev) => ({ ...prev, [key]: 'saving' }));
    try {
      const updatedAnswers = await activePlanningProvider.saveAnswer(ticketId, questionIndex, answerText);
      if ((updatedAnswers as any)?.error || (updatedAnswers as any)?.success === false) {
        throw new Error((updatedAnswers as any)?.error || 'Save failed');
      }
      setAnswersMap((prev) => ({
        ...prev,
        [ticketId]: updatedAnswers,
      }));
      setQuestionDrafts((prev) => {
        const updated = { ...prev };
        delete updated[key];
        if (typeof localStorage !== 'undefined') {
          try {
            if (Object.keys(updated).length === 0) {
              localStorage.removeItem('dev_planner_question_drafts');
            } else {
              localStorage.setItem('dev_planner_question_drafts', JSON.stringify(updated));
            }
          } catch (e) {}
        }
        return updated;
      });
      setSaveStatus((prev) => ({ ...prev, [key]: 'saved' }));
      setTimeout(() => {
        setSaveStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('Failed to save answer:', err);
      setSaveStatus((prev) => ({ ...prev, [key]: 'error' }));
    }
  };

  const handleSaveComment = async (ticketId: string, text: string) => {
    if (!text.trim()) return;
    const key = `comment_${ticketId}`;
    setSaveStatus((prev) => ({ ...prev, [key]: 'saving' }));
    try {
      const updatedComments = await activePlanningProvider.saveComment(ticketId, text);
      setCommentsMap((prev) => ({
        ...prev,
        [ticketId]: updatedComments,
      }));
      handleUpdateCommentDraft(ticketId, '');
      setSaveStatus((prev) => ({ ...prev, [key]: 'saved' }));
      setTimeout(() => {
        setSaveStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('Failed to save comment:', err);
      setSaveStatus((prev) => ({ ...prev, [key]: 'error' }));
    }
  };

  const handleSavePlan = async (ticketId: string, markdown: string) => {
    const key = `plan_${ticketId}`;
    setSaveStatus((prev) => ({ ...prev, [key]: 'saving' }));
    try {
      await activePlanningProvider.savePlan(ticketId, markdown);
      setPlansMap((prev) => ({
        ...prev,
        [ticketId]: markdown,
      }));
      setSaveStatus((prev) => ({ ...prev, [key]: 'saved' }));
      handleClearPlanDraft(ticketId);
      setEditingPlanTicketId(null);
      const hist = await activePlanningProvider.getHistory();
      if (hist && !(hist instanceof Promise)) {
        setTicketHistoryMap(hist);
      }
      setTimeout(() => {
        setSaveStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('Failed to save plan:', err);
      setSaveStatus((prev) => ({ ...prev, [key]: 'error' }));
    }
  };

  const composeDetailMarkdown = (
    feat: PlannedFeature,
    overrideRationale?: string,
    overrideBreakdown?: string[],
    overrideTech?: string[],
    overrideOq?: string[]
  ) => {
    const title = metasMap[feat.ticketId]?.title || feat.title;
    const cat = metasMap[feat.ticketId]?.category || feat.category;
    const complexity = metasMap[feat.ticketId]?.complexity || feat.complexity;
    const effort = metasMap[feat.ticketId]?.estimatedEffort || feat.estimatedEffort || '2.0 - 4.0 hours';
    const rationale = overrideRationale !== undefined ? overrideRationale : (feat.rationale || '');
    const breakdown = overrideBreakdown !== undefined ? overrideBreakdown : (feat.breakdown || []);
    const tech = overrideTech !== undefined ? overrideTech : (feat.technicalDetails || []);
    const oq = overrideOq !== undefined ? overrideOq : (feat.openQuestions || []);

    let md = `# Ticket #${feat.ticketId}: ${title}\n**Category**: ${cat}  \n**Complexity**: ${complexity}  \n**Estimated Effort**: ${effort}  \n\n`;
    if (rationale.trim()) {
      md += `### Summary\n${rationale.trim()}\n\n`;
    }
    if (breakdown.length > 0) {
      md += `### Feature Breakdown\n`;
      breakdown.forEach((item, idx) => {
        if (item.trim()) {
          md += `${idx + 1}. **${item.replace(/^\d+\.\s*/, '')}**\n`;
        }
      });
      md += `\n`;
    }
    if (tech.length > 0 || oq.length > 0) {
      md += `### Technical Detail & Open Questions\n`;
      tech.forEach((t) => {
        if (t.trim()) md += `- **Technical Detail**: ${t.trim().replace(/^- \*\*Technical Detail\*\*:\s*/, '')}\n`;
      });
      oq.forEach((q) => {
        if (q.trim()) md += `- **Open Question**: ${q.trim().replace(/^- \*\*Open Question\*\*:\s*/, '')}\n`;
      });
      md += `\n`;
    }
    return md.trim();
  };

  const handleStartEditingDetail = (feat: PlannedFeature) => {
    setEditingDetailTicketId(feat.ticketId);
    setDetailEditorMode('structured');
    setStructuredRationale(feat.rationale || (feat.breakdown.length === 0 ? feat.rawDetail || '' : ''));
    setStructuredBreakdown(feat.breakdown ? [...feat.breakdown] : []);
    setStructuredTechDetails(feat.technicalDetails ? [...feat.technicalDetails] : []);
    setStructuredOpenQuestions(feat.openQuestions ? [...feat.openQuestions] : []);
    setRawDetailDraft(feat.rawDetail || composeDetailMarkdown(feat));
  };

  const handleSaveDetail = async (ticketId: string) => {
    const feat = parsedData.plannedFeatures.find((f) => f.ticketId === ticketId);
    if (!feat) return;

    let finalMarkdown = '';
    if (detailEditorMode === 'raw') {
      finalMarkdown = rawDetailDraft;
    } else {
      finalMarkdown = composeDetailMarkdown(
        feat,
        structuredRationale,
        structuredBreakdown,
        structuredTechDetails,
        structuredOpenQuestions
      );
    }

    const key = `detail_${ticketId}`;
    setSaveStatus((prev) => ({ ...prev, [key]: 'saving' }));

    try {
      const res = await activePlanningProvider.saveDetail(ticketId, finalMarkdown);
      if (res && res.meta) {
        setMetasMap((prev) => ({ ...prev, [ticketId]: res.meta! }));
      }
      setDetailsMap((prev) => ({ ...prev, [ticketId]: finalMarkdown }));
      setSaveStatus((prev) => ({ ...prev, [key]: 'saved' }));
      setEditingDetailTicketId(null);

      // Refresh history immediately
      const hist = await activePlanningProvider.getHistory();
      if (hist && !(hist instanceof Promise)) {
        setTicketHistoryMap(hist);
      }

      setTimeout(() => {
        setSaveStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error('Failed to save ticket detail:', err);
      setSaveStatus((prev) => ({ ...prev, [key]: 'error' }));
    }
  };

  const handleRestoreSnapshot = async (ticketId: string, snapshot: TicketHistorySnapshot) => {
    if (snapshot.type === 'plan') {
      await handleSavePlan(ticketId, snapshot.content);
    } else {
      await activePlanningProvider.saveDetail(ticketId, snapshot.content);
      setDetailsMap((prev) => ({ ...prev, [ticketId]: snapshot.content }));
      const hist = await activePlanningProvider.getHistory();
      if (hist && !(hist instanceof Promise)) {
        setTicketHistoryMap(hist);
      }
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_modal_tab', activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window !== 'undefined' && isEmbedded) {
      if (expandedFeatureId) {
        sessionStorage.setItem('dev_plan_modal_expanded_feat', expandedFeatureId);
      } else {
        sessionStorage.removeItem('dev_plan_modal_expanded_feat');
      }
    }
    if (!isEmbedded && typeof window !== 'undefined') {
      if (expandedFeatureId) {
        const match = expandedFeatureId.match(/^feature-(\d+)$/);
        const num = match ? match[1] : null;
        if (num) {
          const expectedHash = `#ticket-${num}`;
          if (window.location.hash !== expectedHash && window.location.hash !== `#feature-${num}`) {
            window.location.hash = `ticket-${num}`;
          }
        }
      } else {
        if (window.location.hash && /^#(?:ticket-|feature-)?\d+$/i.test(window.location.hash)) {
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
        }
      }
    }
  }, [expandedFeatureId, isEmbedded]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_toc_width', String(tocWidth));
    }
  }, [tocWidth]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_search_query', searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_complexity_filter', complexityFilter);
    }
  }, [complexityFilter]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_priority_filter', priorityFilter);
    }
  }, [priorityFilter]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_type_filter', typeFilter);
    }
  }, [typeFilter]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_milestone_filter', milestoneFilter);
    }
  }, [milestoneFilter]);

  useEffect(() => {
    if (milestoneFilter !== 'all' && milestoneFilter !== 'none') {
      const existsInProject = milestones.some(
        (m) =>
          (projectFilter === 'all' || m.project.toLowerCase() === projectFilter.toLowerCase()) &&
          m.title.toLowerCase() === milestoneFilter.toLowerCase()
      );
      if (!existsInProject && milestones.length > 0) {
        setMilestoneFilter('all');
      }
    }
  }, [projectFilter, milestones]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_project_filter', projectFilter);
    }
  }, [projectFilter]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dev_plan_in_dev_filter', String(inDevOnly));
    }
  }, [inDevOnly]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = tocWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(220, Math.min(650, startWidth + delta));
      setTocWidth(newWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsResizing(false);
      const delta = upEvent.clientX - startX;
      const finalWidth = Math.max(220, Math.min(650, startWidth + delta));
      handleUpdateTocWidth(finalWidth);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const parsedData = React.useMemo(() => {
    return parsePlannedWorkMarkdown('', true, detailsMap, metasMap);
  }, [metasMap, detailsMap]);

  const allFeatureFlags = useMemo(() => {
    const flagsMap = new Map<string, { description: string; projectId?: number }>();

    // 1. Static candidates from markdown parser
    parsedData.featureFlags.forEach((ff) => {
      if (!deletedFlags.includes(ff.name)) {
        flagsMap.set(ff.name, {
          description: flagDescriptionsMap[ff.name] || ff.description,
          projectId: ff.projectId ?? 1,
        });
      }
    });

    // 2. Dynamic feature flags linked to any ticket in metasMap
    Object.values(metasMap).forEach((meta: any) => {
      if (meta.featureFlag && !deletedFlags.includes(meta.featureFlag)) {
        const ticketProj = getProjectDescriptor(meta.projectId ?? meta.project) || getProjectDescriptor(1);
        if (!flagsMap.has(meta.featureFlag)) {
          const customDesc = flagDescriptionsMap[meta.featureFlag] || `Linked to Ticket #${meta.id || meta.ticketId}`;
          flagsMap.set(meta.featureFlag, {
            description: customDesc,
            projectId: ticketProj?.id ?? 1,
          });
        }
      }
    });

    // 3. Additional saved flag descriptions from localStorage
    Object.entries(flagDescriptionsMap).forEach(([flagName, desc]) => {
      if (!deletedFlags.includes(flagName) && !flagsMap.has(flagName)) {
        flagsMap.set(flagName, {
          description: desc as string,
          projectId: undefined,
        });
      }
    });

    return Array.from(flagsMap.entries())
      .map(([name, data]) => {
        const proj = getProjectDescriptor(data.projectId);
        return {
          name,
          description: data.description,
          projectId: proj?.id,
          projectCode: proj?.code || 'UNASSIGNED',
          projectName: proj?.name || 'Unassigned',
          projectColors: proj?.colors || UNASSIGNED_PROJECT_COLORS,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsedData.featureFlags, metasMap, flagDescriptionsMap, deletedFlags]);

  const filteredFeatureFlags = useMemo(() => {
    if (projectFilter === 'all') {
      if (allowedProjects && allowedProjects.length > 0) {
        const normalized = allowedProjects.map((p) => p.trim().toUpperCase());
        return allFeatureFlags.filter((ff) => normalized.includes(ff.projectCode.toUpperCase()));
      }
      return allFeatureFlags;
    }
    const filterDesc = getProjectDescriptor(projectFilter);
    return allFeatureFlags.filter(
      (ff) => ff.projectCode === projectFilter || (filterDesc !== undefined && ff.projectId === filterDesc.id)
    );
  }, [allFeatureFlags, projectFilter, allowedProjects]);

  const handleJumpToFeature = (featId: string, featNum: number) => {
    setExpandedFeatureId(featId);
    setMobileView('detail');
    setTimeout(() => {
      const scrollContainer = document.getElementById('planned-work-cards-scroll-container');
      const el = document.getElementById(`feature-card-${featNum}`);
      if (scrollContainer && el) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const cardRect = el.getBoundingClientRect();
        const targetScrollTop = scrollContainer.scrollTop + (cardRect.top - containerRect.top) - 8;
        scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
      }
    }, 100);
  };

  // Standalone UI URL Hash Navigation (ticket deep-linking & history traversal)
  useEffect(() => {
    if (isEmbedded || typeof window === 'undefined') return;
    const handleHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#(?:ticket-|feature-)?(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const featId = `feature-${num}`;
        setExpandedFeatureId(featId);
        setActiveTab('features');
        handleJumpToFeature(featId, num);
      } else if (!hash || hash === '#') {
        setExpandedFeatureId(null);
      }
    };

    window.addEventListener('hashchange', handleHash);
    if (window.location.hash) {
      setTimeout(handleHash, 150);
    }
    return () => window.removeEventListener('hashchange', handleHash);
  }, [isEmbedded]);



  const isFeatureCompleted = React.useCallback(
    (f: PlannedFeature) => {
      const metaStatus = metasMap[f.ticketId]?.status;
      if (metaStatus === 'Completed') return true;
      if (metaStatus === 'Planned' || metaStatus === 'In Development' || metaStatus === 'Rejected') return false;
      return !!f.isCompleted;
    },
    [metasMap]
  );

  const isFeatureRejected = React.useCallback(
    (f: PlannedFeature) => {
      const metaStatus = metasMap[f.ticketId]?.status;
      if (metaStatus === 'Rejected') return true;
      if (metaStatus === 'Planned' || metaStatus === 'In Development' || metaStatus === 'Completed') return false;
      return !!f.isRejected;
    },
    [metasMap]
  );

  const isFeatureInDevelopment = React.useCallback(
    (f: PlannedFeature) => {
      const metaStatus = metasMap[f.ticketId]?.status;
      return metaStatus === 'In Development';
    },
    [metasMap]
  );

  const matchesProject = React.useCallback(
    (f: PlannedFeature) => {
      const meta = metasMap[f.ticketId];
      const desc =
        getProjectDescriptor(meta?.projectId ?? meta?.project ?? f.projectId ?? f.project) ||
        getProjectDescriptor(1);
      if (!desc) return false;

      // In embedded mode or when constrained by allowedProjects, enforce membership in availableProjects:
      if (availableProjects && availableProjects.length > 0 && (isEmbedded || (allowedProjects && allowedProjects.length > 0 && !allowedProjects.includes('*')))) {
        const isAllowed = availableProjects.some((p) => p.id === desc.id || p.code.toUpperCase() === desc.code.toUpperCase());
        if (!isAllowed) return false;
      }

      if (projectFilter === 'all') return true;

      const filterDesc = getProjectDescriptor(projectFilter);
      if (!filterDesc) return false;
      return desc.id === filterDesc.id || desc.code.toUpperCase() === filterDesc.code.toUpperCase();
    },
    [projectFilter, metasMap, availableProjects, isEmbedded, allowedProjects]
  );

  const activeFeatures = React.useMemo(() => {
    return parsedData.plannedFeatures.filter(
      (f) => matchesProject(f) && !isFeatureCompleted(f) && !isFeatureRejected(f)
    );
  }, [parsedData, matchesProject, isFeatureCompleted, isFeatureRejected]);

  const completedFeatures = React.useMemo(() => {
    return parsedData.plannedFeatures.filter(
      (f) => matchesProject(f) && isFeatureCompleted(f)
    );
  }, [parsedData, matchesProject, isFeatureCompleted]);

  const rejectedFeatures = React.useMemo(() => {
    return parsedData.plannedFeatures.filter(
      (f) => matchesProject(f) && isFeatureRejected(f)
    );
  }, [parsedData, matchesProject, isFeatureRejected]);

  const currentTabFeatures =
    activeTab === 'completed'
      ? completedFeatures
      : activeTab === 'rejected'
      ? rejectedFeatures
      : activeFeatures;

  const filteredFeatures = currentTabFeatures.filter((f) => {
    const safeTitle = f.title || '';
    const safeSearchQuery = searchQuery || '';
    
    const matchesSearch =
      safeTitle.toLowerCase().includes(safeSearchQuery.toLowerCase()) ||
      (f.rationale && f.rationale.toLowerCase().includes(safeSearchQuery.toLowerCase())) ||
      (f.breakdown || []).some((b) => b && b.toLowerCase().includes(safeSearchQuery.toLowerCase()));

    const safeComplexity = f.complexity || '';
    const matchesComplexity =
      complexityFilter === 'all' ||
      safeComplexity.toLowerCase().replace('-', '') === (complexityFilter || '').toLowerCase().replace('-', '');

    const itemType = (metasMap[f.ticketId]?.type || metasMap[f.ticketId]?.category || f.category) as string;
    const matchesType =
      typeFilter === "all" ||
      (typeFilter === "feature" && itemType === "Feature") ||
      (typeFilter === "platform" && (itemType === "Platform" || itemType === "Technical Enhancement")) ||
      (typeFilter === "tools" && itemType === "Tools") ||
      (typeFilter === "idea" && itemType === "Idea") ||
      (typeFilter === "bug" && itemType === "Bug");

    const itemPriority = metasMap[f.ticketId]?.priority || f.priority;
    const matchesPriority =
      priorityFilter === 'all' ||
      (priorityFilter === 'none' && !itemPriority) ||
      (Boolean(itemPriority) && itemPriority!.toLowerCase() === priorityFilter.toLowerCase());

    const itemMilestone = metasMap[f.ticketId]?.milestone || f.milestone;
    const matchesMilestone =
      milestoneFilter === 'all' ||
      (milestoneFilter === 'none' && !itemMilestone) ||
      (Boolean(itemMilestone) && (
        itemMilestone!.toLowerCase() === milestoneFilter.toLowerCase() ||
        milestones.some((m) => {
          const mTitleLower = m.title.toLowerCase();
          const mIdStr = String(m.id);
          const filterLower = milestoneFilter.toLowerCase();
          const isTargetMilestone =
            mTitleLower === filterLower ||
            mIdStr === filterLower ||
            `${m.project}:${m.title}`.toLowerCase() === filterLower ||
            `${m.project}:${m.id}`.toLowerCase() === filterLower;

          if (!isTargetMilestone) return false;

          const itemLower = itemMilestone!.toLowerCase();
          return (
            itemLower === mTitleLower ||
            itemLower === mIdStr ||
            itemLower === `${m.project}:${m.title}`.toLowerCase() ||
            itemLower === `${m.project}:${m.id}`.toLowerCase()
          );
        })
      ));

    const matchesInDev = !inDevOnly || isFeatureInDevelopment(f);

    return matchesSearch && matchesComplexity && matchesPriority && matchesType && matchesMilestone && matchesInDev;
  });

  const getLastUpdated = React.useCallback(
    (feat: PlannedFeature): number => {
      let latest = 0;

      // 1. Meta timestamp
      const metaTime = metasMap[feat.ticketId]?.timestamp;
      if (metaTime) {
        const t = new Date(metaTime).getTime();
        if (!isNaN(t) && t > latest) latest = t;
      }

      // 2. History snapshots
      const historyList = ticketHistoryMap[feat.ticketId];
      if (historyList && historyList.length > 0) {
        for (const h of historyList) {
          if (h.timestamp) {
            const t = new Date(h.timestamp).getTime();
            if (!isNaN(t) && t > latest) latest = t;
          }
        }
      }

      // 3. Comments
      const comments = commentsMap[feat.ticketId];
      if (comments && comments.length > 0) {
        for (const c of comments) {
          if (c.timestamp) {
            const t = new Date(c.timestamp).getTime();
            if (!isNaN(t) && t > latest) latest = t;
          }
        }
      }

      // 4. Inline comments
      const inlineComments = inlineCommentsMap[feat.ticketId];
      if (inlineComments && inlineComments.length > 0) {
        for (const ic of inlineComments) {
          if (ic.timestamp) {
            const t = new Date(ic.timestamp).getTime();
            if (!isNaN(t) && t > latest) latest = t;
          }
        }
      }

      return latest || feat.number;
    },
    [metasMap, ticketHistoryMap, commentsMap, inlineCommentsMap]
  );

  const sortedFeatures = React.useMemo(() => {
    return [...filteredFeatures].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'ticketNumber') {
        comparison = a.number - b.number;
      } else if (sortBy === 'lastUpdated') {
        const timeA = getLastUpdated(a);
        const timeB = getLastUpdated(b);
        comparison = timeA - timeB;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredFeatures, sortBy, sortOrder, getLastUpdated]);

  const maxTicketLabelLen = React.useMemo(() => {
    if (sortedFeatures.length === 0) return 6;
    const isSingleProject = projectFilter !== 'all';
    let maxLen = 0;
    for (const feat of sortedFeatures) {
      const projDesc =
        getProjectDescriptor(
          metasMap[feat.ticketId]?.projectId ??
          metasMap[feat.ticketId]?.project ??
          feat.projectId ??
          feat.project
        ) || getProjectDescriptor(1);
      const label = isSingleProject
        ? `#${feat.number}`
        : `${projDesc ? projDesc.code : 'Core'}-${feat.number}`;
      if (label.length > maxLen) {
        maxLen = label.length;
      }
    }
    return Math.max(maxLen, 3);
  }, [sortedFeatures, projectFilter, metasMap]);

  const getComplexityBadgeColor = (complexity: string) => {
    const c = (complexity || '').toLowerCase();
    if (c.includes('high')) return 'bg-blue-100 dark:bg-blue-500/20 text-blue-950 dark:text-blue-300 border-blue-300 dark:border-blue-500/30 hover:bg-blue-200/70 dark:hover:bg-blue-500/30 font-semibold';
    if (c.includes('medium')) return 'bg-teal-100 dark:bg-teal-500/20 text-teal-950 dark:text-teal-300 border-teal-300 dark:border-teal-500/30 hover:bg-teal-200/70 dark:hover:bg-teal-500/30 font-semibold';
    if (c.includes('low')) return 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] font-semibold';
    return 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] font-semibold';
  };

  return (
    <div className="esedre-host-bridge w-full h-full flex flex-col">
      <style>{ESEDRE_THEME_FALLBACK_CSS}</style>
      <div
        id="planned-work-view-container"
        className={`esedre-theme-root w-full h-full bg-[var(--bg-surface)] overflow-hidden flex flex-col text-[var(--text-primary)] relative ${className}`}
      >
      {/* Header */}
      {showHeader && (
        <div className="bg-[var(--bg-surface-elevated)] px-3.5 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] flex items-center justify-center text-[var(--accent-primary)] shadow-xs">
              <EsedreIcon size={18} />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">
                Esedre Development Planner
              </h2>
              {!isOwner && (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30 uppercase flex items-center gap-1">
                  <Eye size={10} /> READ-ONLY
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDedicatedTheme}
              className="p-1.5 px-2.5 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title={`Switch to ${dedicatedTheme === 'night' ? 'Day (Light)' : 'Night (Dark)'} theme`}
            >
              {dedicatedTheme === 'night' ? (
                <>
                  <Sun size={14} className="text-amber-400" />
                  <span className="text-[11px] font-medium hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon size={14} className="text-indigo-600" />
                  <span className="text-[11px] font-medium hidden sm:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

        {/* Top Tab Bar */}
        <div className="bg-[var(--bg-surface-elevated)] border-b border-[var(--border-subtle)] px-2.5 sm:px-4 pt-2 pb-1 flex items-center justify-between overflow-x-auto shrink-0 gap-1.5 sm:gap-2 scrollbar-none">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('features')}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer shrink-0 ${
                activeTab === 'features'
                  ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--accent-primary)] shadow-xs'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <Zap size={14} className="shrink-0" />
              <span className="hidden sm:inline">Planned Features ({activeFeatures.length})</span>
              <span className="sm:hidden">Planned ({activeFeatures.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer shrink-0 ${
                activeTab === 'completed'
                  ? 'bg-[var(--bg-surface)] border-emerald-500/40 text-emerald-600 dark:text-emerald-300 shadow-xs'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <Check size={14} strokeWidth={2.5} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Completed ({completedFeatures.length})</span>
              <span className="sm:hidden">Done ({completedFeatures.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('rejected')}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer shrink-0 ${
                activeTab === 'rejected'
                  ? 'bg-[var(--bg-surface)] border-rose-500/40 text-rose-600 dark:text-rose-300 shadow-xs'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <XCircle size={14} className="text-rose-500 dark:text-rose-400 shrink-0" />
              <span className="hidden sm:inline">Rejected ({rejectedFeatures.length})</span>
              <span className="sm:hidden">Rejected ({rejectedFeatures.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('milestones')}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer shrink-0 ${
                activeTab === 'milestones'
                  ? 'bg-[var(--bg-surface)] border-indigo-500/40 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <MilestoneIcon size={14} className="shrink-0" />
              <span className="hidden sm:inline">Milestones ({milestones.length})</span>
              <span className="sm:hidden">Milestones ({milestones.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('flags')}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer shrink-0 ${
                activeTab === 'flags'
                  ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--accent-primary)] shadow-xs'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <ShieldAlert size={14} className="shrink-0" />
              <span className="hidden sm:inline">Feature Flags ({filteredFeatureFlags.length})</span>
              <span className="sm:hidden">Flags ({filteredFeatureFlags.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 mb-1 shrink-0">
            {/* Project Filter */}
            {(!isEmbedded || availableProjects.length > 1) && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-xl text-xs transition-colors shadow-xs">
                <FolderKanban size={13} className="text-[var(--accent-primary)] shrink-0" />
                <span className="text-[10px] font-mono text-[var(--text-muted)] hidden sm:inline">Project:</span>
                <select
                  value={projectFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__new__') {
                      setIsCreateProjectOpen(true);
                      return;
                    }
                    setProjectFilter(val);
                    try {
                      sessionStorage.setItem('dev_plan_project_filter', val);
                      localStorage.setItem('dev_plan_project_filter', val);
                      updateProjectUrlSearchParam(val, isEmbedded);
                    } catch (err) {}
                  }}
                  className="bg-transparent text-[var(--text-primary)] text-xs font-semibold focus:outline-none cursor-pointer pr-1 border-0"
                  aria-label="Filter tickets by project"
                >
                  {availableProjects.length > 1 && (
                    <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-primary)] py-1">All Projects</option>
                  )}
                  {availableProjects.map((proj) => (
                    <option key={proj.id} value={proj.code} className="bg-[var(--bg-surface)] text-[var(--text-primary)] py-1">
                      {proj.name}
                    </option>
                  ))}
                  {isOwner && !isEmbedded && (
                    <option value="__new__" className="bg-[var(--bg-surface)] text-cyan-600 dark:text-cyan-400 font-semibold py-1">
                      + New Project...
                    </option>
                  )}
                </select>
              </div>
            )}

            {/* Project Settings Button */}
            {availableProjects.length > 0 && isOwner && !isEmbedded && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSettingsProjectCode(currentProject ? currentProject.code : (availableProjects[0]?.code || null));
                  setIsProjectSettingsOpen(true);
                }}
                className="p-2 sm:px-2.5 sm:py-2 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] rounded-xl text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer shadow-xs shrink-0"
                title={currentProject ? `Project Settings (${currentProject.name})` : 'Project Settings'}
                aria-label={currentProject ? `Project Settings (${currentProject.name})` : 'Project Settings'}
              >
                <Settings size={15} />
              </button>
            )}

            {isOwner && (
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="px-2.5 sm:px-3 py-1.5 bg-[var(--accent-primary)] hover:brightness-110 text-white rounded-xl text-xs font-semibold flex items-center gap-1 sm:gap-1.5 shadow-md transition-all cursor-pointer shrink-0"
              >
                <Plus size={14} />
                <span className="hidden sm:inline">Create Ticket</span>
                <span className="sm:hidden">New</span>
              </button>
            )}

            {/* Open Standalone Link (Embedded View Only) */}
            {isEmbedded && (
              <a
                href={`${standaloneUrl || `http://localhost:${standalonePort || DEFAULT_ESEDRE_PORT}`}/${projectFilter && projectFilter !== 'all' ? `?project=${encodeURIComponent(projectFilter)}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 sm:px-2.5 sm:py-2 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] rounded-xl text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer shadow-xs shrink-0"
                title={`Open Standalone Esedre Planner (${standaloneUrl || `http://localhost:${standalonePort || DEFAULT_ESEDRE_PORT}/`})`}
                aria-label="Open Standalone Esedre Planner"
              >
                <ExternalLink size={15} />
              </a>
            )}

            {/* Help Button (Icon Only) */}
            <button
              type="button"
              onClick={() => setIsHelpModalOpen(true)}
              className="p-2 sm:px-2.5 sm:py-2 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] rounded-xl text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer shadow-xs shrink-0"
              title="Help & About"
              aria-label="Help & About"
            >
              <HelpCircle size={15} />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-hidden p-2 sm:p-3 md:px-5 md:py-3">

          {/* TAB 1, 2 & 3: PLANNED, COMPLETED OR REJECTED FEATURES */}
          {(activeTab === 'features' || activeTab === 'completed' || activeTab === 'rejected') && (
            <div className="flex flex-col md:flex-row gap-2 md:gap-3 items-stretch h-full min-h-0 relative">
              {/* Left Vertical Table of Contents */}
              <div
                className={`${
                  mobileView === 'list' ? 'flex' : 'hidden md:flex'
                } w-full md:h-full shrink-0 bg-[var(--bg-surface-elevated)] p-3 rounded-2xl border border-[var(--border-subtle)] flex-col min-h-0 overflow-hidden`}
                style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? `${tocWidth}px` : '100%' }}
              >
                <div className="flex items-center justify-between shrink-0 pb-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[11px] font-mono font-bold text-[var(--accent-primary)] uppercase tracking-wider flex items-center gap-1.5 truncate">
                    <List size={14} className="text-[var(--accent-primary)] shrink-0" />
                    TOC ({sortedFeatures.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileView('detail')}
                    className="md:hidden px-2 py-0.5 rounded-lg bg-[var(--accent-bg-subtle)] hover:bg-[var(--accent-bg-subtle)]/80 text-[var(--accent-primary)] text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>View Cards</span>
                    <ArrowRight size={12} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-xs font-mono scrollbar-thin">
                  {sortedFeatures.map((feat) => {
                    const isSelected = expandedFeatureId === feat.id;
                    const isSingleProject = projectFilter !== 'all';
                    const projDesc =
                      getProjectDescriptor(
                        metasMap[feat.ticketId]?.projectId ??
                        metasMap[feat.ticketId]?.project ??
                        feat.projectId ??
                        feat.project
                      ) || getProjectDescriptor(1);
                    const ticketLabel = isSingleProject
                      ? `#${feat.number}`
                      : `${projDesc ? projDesc.code : 'Core'}-${feat.number}`;

                    return (
                      <button
                        key={feat.id}
                        type="button"
                        onClick={() => handleJumpToFeature(feat.id, feat.number)}
                        className={`w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--accent-bg-subtle)] border-[var(--accent-border-subtle)] text-[var(--text-primary)] font-bold shadow-xs'
                            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)]/50'
                        }`}
                        title={`${ticketLabel}: ${metasMap[feat.ticketId]?.title || feat.title}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span
                            className="text-[10px] font-mono font-bold text-[var(--accent-primary)] shrink-0 inline-block text-left whitespace-nowrap"
                            style={{ width: `${maxTicketLabelLen}ch`, minWidth: `${maxTicketLabelLen}ch` }}
                          >
                            {ticketLabel}
                          </span>
                          <span
                            className={`text-[11px] font-medium leading-tight truncate flex-1 min-w-0 ${
                              isFeatureCompleted(feat) ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {metasMap[feat.ticketId]?.title || feat.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* 1. Type Pill (w-[56px] h-[20px]) */}
                          <span
                            className={`text-[10px] font-mono font-semibold h-[20px] rounded-md border shrink-0 w-[56px] text-center flex items-center justify-center select-none ${
                              (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Bug'
                                ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-950 dark:text-rose-300 border-rose-300 dark:border-rose-500/30'
                                : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Idea'
                                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-950 dark:text-amber-300 border-amber-300 dark:border-amber-500/30'
                                : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Tools'
                                ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-950 dark:text-purple-300 border-purple-300 dark:border-purple-500/30'
                                : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Platform'
                                ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-950 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/30'
                                : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30'
                            }`}
                          >
                            {(metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Bug'
                              ? 'Bug'
                              : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Idea'
                              ? 'Idea'
                              : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Tools'
                              ? 'Tools'
                              : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Platform'
                              ? 'Platform'
                              : 'Feature'}
                          </span>

                          {/* 2. Status Pill (w-[20px] h-[20px]) */}
                          {(() => {
                            const isCompleted = isFeatureCompleted(feat);
                            const isRejected = isFeatureRejected(feat);
                            const isDev = isFeatureInDevelopment(feat);

                            if (isRejected) {
                              return (
                                <span
                                  title="Rejected"
                                  className="w-[20px] h-[20px] rounded-md border flex items-center justify-center shrink-0 bg-rose-50 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-500/30 select-none"
                                >
                                  <XCircle size={10} className="text-rose-700 dark:text-rose-400" />
                                </span>
                              );
                            }
                            if (isCompleted) {
                              return (
                                <span
                                  title="Completed"
                                  className="w-[20px] h-[20px] rounded-md border flex items-center justify-center shrink-0 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 select-none"
                                >
                                  <Check size={10} strokeWidth={3} className="text-emerald-700 dark:text-emerald-400" />
                                </span>
                              );
                            }
                            return (
                              <span
                                title={isDev ? 'In Development' : 'Planned'}
                                className={`w-[20px] h-[20px] rounded-md border flex items-center justify-center shrink-0 select-none ${
                                  isDev
                                    ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)] opacity-40'
                                }`}
                              >
                                <ArrowRight size={10} className={isDev ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-muted)]'} />
                              </span>
                            );
                          })()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Horizontal Drag Resize Handle (Desktop Only) */}
              <div
                onMouseDown={handleMouseDown}
                onDoubleClick={() => handleUpdateTocWidth(tocWidth === 320 ? 480 : 320)}
                className={`hidden md:flex w-3 hover:w-3 shrink-0 items-center justify-center cursor-ew-resize group self-stretch py-2 relative z-10 transition-colors ${
                  isResizing ? 'bg-[var(--accent-bg-subtle)]' : 'hover:bg-[var(--accent-bg-subtle)]'
                }`}
                title="Drag horizontally to resize Table of Contents width (Double click to toggle expansion)"
              >
                <div className={`w-1 h-12 rounded-full transition-colors ${
                  isResizing ? 'bg-[var(--accent-primary)]' : 'bg-[var(--border-subtle)] group-hover:bg-[var(--accent-primary)]'
                }`} />
              </div>

              {/* Right Main Content Area */}
              <div className={`${mobileView === 'detail' ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 h-full flex flex-col min-h-0 overflow-hidden gap-2 sm:gap-3`}>
                {/* Search & Filter Toolbar opposing TOC */}
                <div className="shrink-0 flex flex-col gap-1.5 bg-[var(--bg-surface-elevated)] px-3 py-2 rounded-2xl border border-[var(--border-subtle)]">
                  {/* Row 1: Search */}
                  <div className="flex items-center gap-2 w-full">
                    <button
                      type="button"
                      onClick={() => setMobileView('list')}
                      className="md:hidden px-2.5 py-1 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] border border-[var(--border-subtle)] rounded-lg text-xs font-semibold text-[var(--accent-primary)] flex items-center gap-1 shrink-0 cursor-pointer"
                      title="Back to Table of Contents list"
                    >
                      <ChevronLeft size={13} />
                      <span>TOC</span>
                    </button>
                    <div className="relative flex-1 min-w-0">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search tickets by title, tag, or content..."
                        className="w-full pl-8 pr-3 py-1 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)]"
                      />
                    </div>
                  </div>

                  {/* Row 2: Filter Selects & Sorting Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">Type:</span>
                        <select
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value)}
                          className="bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] rounded-lg px-2 py-0.5 focus:outline-none focus:border-[var(--border-accent)] cursor-pointer"
                        >
                          <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">All</option>
                          <option value="feature" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Feature</option>
                          <option value="technical" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Tech Enh.</option>
                          <option value="idea" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Idea</option>
                          <option value="bug" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Bug</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">Complexity:</span>
                        <select
                          value={complexityFilter}
                          onChange={(e) => setComplexityFilter(e.target.value)}
                          className="bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] rounded-lg px-2 py-0.5 focus:outline-none focus:border-[var(--border-accent)] cursor-pointer"
                        >
                          <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">All</option>
                          <option value="low" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Low</option>
                          <option value="medium" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Medium</option>
                          <option value="high" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">High</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">Priority:</span>
                        <select
                          value={priorityFilter}
                          onChange={(e) => setPriorityFilter(e.target.value)}
                          className="bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] rounded-lg px-2 py-0.5 focus:outline-none focus:border-[var(--border-accent)] cursor-pointer"
                        >
                          <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">All</option>
                          <option value="critical" className="bg-[var(--bg-surface)] text-rose-600 dark:text-rose-400 font-semibold">Critical</option>
                          <option value="high" className="bg-[var(--bg-surface)] text-amber-600 dark:text-amber-400 font-semibold">High</option>
                          <option value="medium" className="bg-[var(--bg-surface)] text-blue-600 dark:text-blue-400">Medium</option>
                          <option value="low" className="bg-[var(--bg-surface)] text-[var(--text-muted)]">Low</option>
                          <option value="none" className="bg-[var(--bg-surface)] text-[var(--text-muted)] italic">None (Unset)</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">Milestone:</span>
                        <select
                          value={milestoneFilter}
                          onChange={(e) => setMilestoneFilter(e.target.value)}
                          className={`bg-[var(--bg-input)] border text-xs rounded-lg px-2 py-0.5 focus:outline-none cursor-pointer max-w-[150px] truncate ${
                            milestoneFilter !== 'all'
                              ? 'border-indigo-500/60 text-indigo-700 dark:text-indigo-300 font-semibold bg-indigo-500/10'
                              : 'border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--border-accent)]'
                          }`}
                        >
                          <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">All</option>
                          <option value="none" className="bg-[var(--bg-surface)] text-[var(--text-muted)] italic">None (Unset)</option>
                          {milestones
                            .filter((m) => projectFilter === 'all' || m.project.toLowerCase() === projectFilter.toLowerCase())
                            .map((m) => (
                              <option key={`${m.project}-${m.id}`} value={m.title} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                                {projectFilter === 'all' ? `[${m.project}] ${m.title}` : m.title}
                              </option>
                            ))}
                        </select>
                        {milestoneFilter !== 'all' && (
                          <button
                            type="button"
                            onClick={() => setMilestoneFilter('all')}
                            className="text-[var(--text-muted)] hover:text-rose-500 p-0.5 transition-colors cursor-pointer"
                            title="Clear milestone filter"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">Sort By:</span>
                        <select
                          value={sortBy}
                          onChange={(e) => {
                            const val = e.target.value as SortField;
                            setSortBy(val);
                            try {
                              localStorage.setItem('dev_plan_sort_by', val);
                              sessionStorage.setItem('dev_plan_sort_by', val);
                            } catch (err) {}
                          }}
                          className="bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] rounded-lg px-2 py-0.5 focus:outline-none focus:border-[var(--border-accent)] cursor-pointer"
                        >
                          <option value="ticketNumber" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Ticket #</option>
                          <option value="lastUpdated" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Last Updated</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => toggleSortDirection(sortBy)}
                          title={`Sort ${sortOrder === 'asc' ? 'Ascending (Click for Descending)' : 'Descending (Click for Ascending)'}`}
                          className="p-1 bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center cursor-pointer"
                        >
                          {sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        </button>
                      </div>
                      <label
                        className={`flex items-center gap-1.5 text-[11px] font-mono font-semibold cursor-pointer select-none px-2 py-0.5 rounded-lg transition-colors border ${
                          inDevOnly
                            ? 'bg-[var(--accent-bg-subtle)] border-[var(--accent-primary)] text-[var(--accent-primary)] font-bold shadow-xs'
                            : 'bg-[var(--bg-input)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={inDevOnly}
                          onChange={(e) => {
                            setInDevOnly(e.target.checked);
                            try {
                              sessionStorage.setItem('dev_plan_in_dev_filter', String(e.target.checked));
                            } catch (err) {}
                          }}
                          className="rounded bg-[var(--bg-surface)] border-[var(--border-strong)] text-[var(--accent-primary)] focus:ring-0 cursor-pointer w-3.5 h-3.5"
                        />
                        <span className={inDevOnly ? 'text-[var(--accent-primary)] font-bold' : 'text-[var(--text-secondary)] font-medium'}>
                          In Development
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Feature Cards List Container */}
                <div className="flex-1 min-h-0 h-full overflow-hidden rounded-2xl">
                  <div id="planned-work-cards-scroll-container" className="h-full overflow-y-auto space-y-3 p-1 pr-1.5 scrollbar-thin">
                  {sortedFeatures.map((feat) => {
                    const isExpanded = expandedFeatureId === feat.id;
                    return (
                      <div
                        key={feat.id}
                        id={`feature-card-${feat.number}`}
                        className={`border rounded-2xl transition-all duration-200 overflow-hidden ${
                          isExpanded
                            ? 'bg-[var(--bg-surface-elevated)] border-[var(--border-accent)] shadow-md ring-1 ring-[var(--border-accent)]'
                            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] shadow-xs hover:shadow-sm'
                        }`}
                      >
                        {/* Card Header */}
                        <div
                          onClick={() => setExpandedFeatureId(isExpanded ? null : feat.id)}
                          className="w-full text-left p-3.5 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 cursor-pointer"
                        >
                          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                            <div className="px-2 h-7 rounded-lg bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] flex items-center justify-center text-xs font-mono font-bold text-[var(--accent-primary)] shrink-0 mt-0.5 sm:mt-0">
                              {(() => {
                                if (projectFilter !== 'all') {
                                  return `#${feat.number}`;
                                }
                                const desc =
                                  getProjectDescriptor(
                                    metasMap[feat.ticketId]?.projectId ??
                                    metasMap[feat.ticketId]?.project ??
                                    feat.projectId ??
                                    feat.project
                                  ) || getProjectDescriptor(1);
                                return `${desc ? desc.code : 'Core'}-${feat.number}`;
                              })()}
                            </div>
                            <div className="min-w-0 flex-1">
                              {editingTitleTicketId === feat.ticketId ? (
                                <input
                                  type="text"
                                  value={titleDraftText}
                                  maxLength={48}
                                  onChange={(e) => setTitleDraftText(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={() => handleSaveTitle(feat.ticketId, titleDraftText)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveTitle(feat.ticketId, titleDraftText);
                                  }}
                                  autoFocus
                                  className="bg-[var(--bg-input)] border border-[var(--border-accent)] rounded px-2 py-0.5 text-[var(--text-primary)] text-sm font-bold focus:outline-none w-full"
                                />
                              ) : (
                                <h3 className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5 group/header">
                                  <span className="truncate">{metasMap[feat.ticketId]?.title || feat.title}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTitleDraftText(metasMap[feat.ticketId]?.title || feat.title);
                                      setEditingTitleTicketId(feat.ticketId);
                                    }}
                                    className="p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-primary)] opacity-0 group-hover/header:opacity-100 transition-opacity cursor-pointer shrink-0"
                                    title="Click to rename ticket"
                                  >
                                    <Edit3 size={11} />
                                  </button>
                                </h3>
                              )}
                              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] font-mono mt-0.5 group/author">
                                <User size={11} className="text-[var(--accent-primary)] shrink-0" />
                                <span>Submitted by:</span>
                                {editingAuthorTicketId === feat.ticketId ? (
                                  <input
                                    type="text"
                                    value={authorDraftText}
                                    onChange={(e) => setAuthorDraftText(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={() => handleSaveAuthor(feat.ticketId, authorDraftText)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveAuthor(feat.ticketId, authorDraftText);
                                    }}
                                    autoFocus
                                    className="bg-[var(--bg-input)] border border-[var(--border-accent)] rounded px-1.5 py-0.5 text-[var(--accent-primary)] text-[11px] focus:outline-none"
                                  />
                                ) : (
                                  <span className="text-[var(--accent-primary)] font-semibold flex items-center gap-1">
                                    {metasMap[feat.ticketId]?.submittedBy || researcherUsername || 'Developer'}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAuthorDraftText(metasMap[feat.ticketId]?.submittedBy || researcherUsername || 'Developer');
                                        setEditingAuthorTicketId(feat.ticketId);
                                      }}
                                      className="p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-primary)] opacity-0 group-hover/author:opacity-100 transition-opacity cursor-pointer shrink-0"
                                      title="Click to edit author name"
                                    >
                                      <Edit3 size={10} />
                                    </button>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t border-[var(--border-subtle)] sm:border-t-0">
                            <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
                              {/* ROW 1: Project -> Type (60px) -> Complexity (84px) -> Status (112px) */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {/* 0. Project Badge (Only displayed in All Projects view) */}
                                {projectFilter === 'all' && (() => {
                                  const desc = getProjectDescriptor(metasMap[feat.ticketId]?.projectId ?? metasMap[feat.ticketId]?.project ?? feat.projectId ?? feat.project);
                                  const colors = desc?.colors || UNASSIGNED_PROJECT_COLORS;
                                  const label = desc ? desc.name : 'Unassigned Project';
                                  return isOwner ? (
                                    <button
                                      type="button"
                                      data-popover-trigger="true"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHeaderPopover((prev) =>
                                          prev?.ticketId === feat.ticketId && prev?.type === 'project'
                                            ? null
                                            : { ticketId: feat.ticketId, type: 'project', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                        );
                                      }}
                                      className={`px-2 py-0.5 text-center inline-flex items-center gap-1 text-[10px] font-mono font-semibold rounded-full border transition-colors cursor-pointer ${colors.badge} hover:brightness-110`}
                                      title={desc ? `Project: ${desc.name}. Click to edit.` : 'No project assigned. Click to assign.'}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0`} />
                                      <span>{label}</span>
                                    </button>
                                  ) : (
                                    <span
                                      className={`px-2 py-0.5 text-center inline-flex items-center gap-1 text-[10px] font-mono font-semibold rounded-full border cursor-default ${colors.badge}`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0`} />
                                      <span>{label}</span>
                                    </span>
                                  );
                                })()}

                                {/* 1. Type (Category) (Leftmost, 60px) */}
                                {isOwner ? (
                                  <button
                                    type="button"
                                    data-popover-trigger="true"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setHeaderPopover((prev) =>
                                        prev?.ticketId === feat.ticketId && prev?.type === 'category'
                                          ? null
                                          : { ticketId: feat.ticketId, type: 'category', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                      );
                                    }}
                                    className={`w-[60px] text-center inline-flex items-center justify-center text-[10px] font-mono font-semibold py-0.5 rounded-full border transition-colors cursor-pointer ${
                                      (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Bug'
                                        ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-950 dark:text-rose-300 border-rose-300 dark:border-rose-500/30 hover:bg-rose-200/70 dark:hover:bg-rose-500/30'
                                        : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Idea'
                                        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-950 dark:text-amber-300 border-amber-300 dark:border-amber-500/30 hover:bg-amber-200/70 dark:hover:bg-amber-500/30'
                                        : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Tools'
                                        ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-950 dark:text-purple-300 border-purple-300 dark:border-purple-500/30 hover:bg-purple-200/70 dark:hover:bg-purple-500/30'
                                        : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Platform'
                                        ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-950 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/30 hover:bg-cyan-200/70 dark:hover:bg-cyan-500/30'
                                        : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-200/70 dark:hover:bg-emerald-500/30'
                                    }`}
                                    title="Click to edit Category"
                                  >
                                    {(metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Bug'
                                      ? 'Bug'
                                      : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Idea'
                                      ? 'Idea'
                                      : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Tools'
                                      ? 'Tools'
                                      : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Platform'
                                      ? 'Platform'
                                      : 'Feature'}
                                  </button>
                                ) : (
                                  <span
                                    className={`w-[60px] text-center inline-flex items-center justify-center text-[10px] font-mono font-semibold py-0.5 rounded-full border cursor-default ${
                                      (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Bug'
                                        ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-950 dark:text-rose-300 border-rose-300 dark:border-rose-500/30'
                                        : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Idea'
                                        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-950 dark:text-amber-300 border-amber-300 dark:border-amber-500/30'
                                        : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Tools'
                                        ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-950 dark:text-purple-300 border-purple-300 dark:border-purple-500/30'
                                        : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Platform'
                                        ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-950 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/30'
                                        : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30'
                                    }`}
                                  >
                                    {(metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Bug'
                                      ? 'Bug'
                                      : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Idea'
                                      ? 'Idea'
                                      : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Tools'
                                      ? 'Tools'
                                      : (metasMap[feat.ticketId]?.type || metasMap[feat.ticketId]?.category || feat.category) === 'Platform'
                                      ? 'Platform'
                                      : 'Feature'}
                                  </span>
                                )}

                                {/* 2. Complexity (84px, just prior to the status pill) */}
                                {isOwner ? (
                                  <button
                                    type="button"
                                    data-popover-trigger="true"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setHeaderPopover((prev) =>
                                        prev?.ticketId === feat.ticketId && prev?.type === 'complexity'
                                          ? null
                                          : { ticketId: feat.ticketId, type: 'complexity', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                      );
                                    }}
                                    className={`w-[84px] text-center inline-flex items-center justify-center text-[10px] font-mono font-semibold py-0.5 rounded-full border transition-colors cursor-pointer ${getComplexityBadgeColor(
                                      metasMap[feat.ticketId]?.complexity || feat.complexity
                                    )}`}
                                    title="Click to edit Complexity"
                                  >
                                    {metasMap[feat.ticketId]?.complexity || feat.complexity}
                                  </button>
                                ) : (
                                  <span
                                    className={`w-[84px] text-center inline-flex items-center justify-center text-[10px] font-mono font-semibold py-0.5 rounded-full border cursor-default ${getComplexityBadgeColor(
                                      metasMap[feat.ticketId]?.complexity || feat.complexity
                                    )}`}
                                  >
                                    {metasMap[feat.ticketId]?.complexity || feat.complexity}
                                  </span>
                                )}

                                {/* Priority Badge / Picker */}
                                {(() => {
                                  const prio = metasMap[feat.ticketId]?.priority || feat.priority;
                                  if (!prio && !isOwner) return null;
                                  const conf = prio ? PRIORITY_CONFIG[prio] : null;
                                  if (isOwner) {
                                    return (
                                      <button
                                        type="button"
                                        data-popover-trigger="true"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setHeaderPopover((prev) =>
                                            prev?.ticketId === feat.ticketId && prev?.type === 'priority'
                                              ? null
                                              : { ticketId: feat.ticketId, type: 'priority', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                          );
                                        }}
                                        className={`text-center inline-flex items-center justify-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                                          conf
                                            ? `${conf.border} ${conf.bg} ${conf.text}`
                                            : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:border-[var(--border-strong)]'
                                        }`}
                                        title="Click to edit Priority"
                                      >
                                        {conf && <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />}
                                        {prio || 'Priority'}
                                      </button>
                                    );
                                  }
                                  return (
                                    <span
                                      className={`text-center inline-flex items-center justify-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border cursor-default ${
                                        conf ? `${conf.border} ${conf.bg} ${conf.text}` : ''
                                      }`}
                                    >
                                      {conf && <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />}
                                      {prio}
                                    </span>
                                  );
                                })()}

                                {/* Blocked Badge */}
                                {(feat.isBlocked || metasMap[feat.ticketId]?.isBlocked) && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 cursor-default"
                                    title="Blocked by uncompleted ticket"
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                    Blocked
                                  </span>
                                )}

                                {/* 3. Status State Pill (Rightmost in Row 1, 112px) */}
                                {isOwner ? (
                                  <button
                                    type="button"
                                    data-popover-trigger="true"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setHeaderPopover((prev) =>
                                        prev?.ticketId === feat.ticketId && prev?.type === 'status'
                                          ? null
                                          : { ticketId: feat.ticketId, type: 'status', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                      );
                                    }}
                                    className={`w-[112px] text-center inline-flex items-center justify-center gap-1 text-[10px] font-mono font-semibold py-0.5 rounded-full border transition-colors cursor-pointer ${
                                      (metasMap[feat.ticketId]?.status === 'Rejected' || isFeatureRejected(feat))
                                        ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-950 dark:text-rose-300 border-rose-300 dark:border-rose-500/40 hover:bg-rose-200/70 dark:hover:bg-rose-500/30'
                                        : isFeatureCompleted(feat)
                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40 hover:bg-emerald-200/70 dark:hover:bg-emerald-500/30'
                                        : isFeatureInDevelopment(feat)
                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40 hover:bg-emerald-200/70 dark:hover:bg-emerald-500/30 font-bold'
                                        : 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                                    }`}
                                    title="Click to change Status"
                                  >
                                    {(isFeatureRejected(feat)) ? (
                                      <>
                                        <XCircle size={10} className="text-rose-600 dark:text-rose-400" />
                                        <span>Rejected</span>
                                      </>
                                    ) : isFeatureCompleted(feat) ? (
                                      <>
                                        <Check size={10} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
                                        <span>Completed</span>
                                      </>
                                    ) : isFeatureInDevelopment(feat) ? (
                                      <>
                                        <ArrowRight size={10} className="text-emerald-600 dark:text-emerald-400" />
                                        <span>In Development</span>
                                      </>
                                    ) : (
                                      <>
                                        <Clock size={10} className="text-[var(--text-muted)]" />
                                        <span>Planned</span>
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  <span
                                    className={`w-[112px] text-center inline-flex items-center justify-center gap-1 text-[10px] font-mono font-semibold py-0.5 rounded-full border cursor-default ${
                                      isFeatureRejected(feat)
                                        ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-950 dark:text-rose-300 border-rose-300 dark:border-rose-500/40'
                                        : isFeatureCompleted(feat)
                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40'
                                        : isFeatureInDevelopment(feat)
                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40 font-bold'
                                        : 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                                    }`}
                                  >
                                    {isFeatureRejected(feat) ? (
                                      <>
                                        <XCircle size={10} className="text-rose-600 dark:text-rose-400" />
                                        <span>Rejected</span>
                                      </>
                                    ) : isFeatureCompleted(feat) ? (
                                      <>
                                        <Check size={10} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
                                        <span>Completed</span>
                                      </>
                                    ) : isFeatureInDevelopment(feat) ? (
                                      <>
                                        <ArrowRight size={10} className="text-emerald-600 dark:text-emerald-400" />
                                        <span>In Development</span>
                                      </>
                                    ) : (
                                      <>
                                        <Clock size={10} className="text-[var(--text-muted)]" />
                                        <span>Planned</span>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>

                              {/* ROW 2: Feature Flag (Leftmost) */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {/* Feature Flag (Compact Icon when unlinked, 118px Pill when linked) */}
                                {(() => {
                                  const flagKey = metasMap[feat.ticketId]?.featureFlag || feat.featureFlag;
                                  if (flagKey) {
                                    return isOwner ? (
                                      <button
                                        type="button"
                                        data-popover-trigger="true"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setHeaderPopover((prev) =>
                                            prev?.ticketId === feat.ticketId && (prev?.type === 'flag' || prev?.type === 'flagPicker')
                                              ? null
                                              : { ticketId: feat.ticketId, type: 'flag', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                          );
                                        }}
                                        className="max-w-[140px] truncate flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40 hover:bg-purple-200/70 dark:hover:bg-purple-500/30 text-[10px] font-mono font-semibold transition-colors cursor-pointer shrink-0"
                                        title={`Feature Flag: ${flagKey}`}
                                      >
                                        <Flag size={10} className="text-purple-700 dark:text-purple-400 shrink-0" />
                                        <span className="truncate">{flagKey}</span>
                                      </button>
                                    ) : (
                                      <span
                                        className="max-w-[140px] truncate flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40 text-[10px] font-mono font-semibold shrink-0 cursor-default"
                                      >
                                        <Flag size={10} className="text-purple-700 dark:text-purple-400 shrink-0" />
                                        <span className="truncate">{flagKey}</span>
                                      </span>
                                    );
                                  }
                                  return isOwner ? (
                                    <button
                                      type="button"
                                      data-popover-trigger="true"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHeaderPopover((prev) =>
                                          prev?.ticketId === feat.ticketId && (prev?.type === 'flag' || prev?.type === 'flagPicker')
                                            ? null
                                            : { ticketId: feat.ticketId, type: 'flagPicker', x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                        );
                                      }}
                                      className="px-1.5 py-0.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                                      title="Link to Feature Flag..."
                                    >
                                      <Flag size={12} className="text-[var(--text-muted)]" />
                                    </button>
                                  ) : null;
                                })()}

                                {/* Milestone Pill */}
                                {(() => {
                                  const msRaw = metasMap[feat.ticketId]?.milestone || feat.milestone;
                                  if (!msRaw) return null;
                                  const projectCode = metasMap[feat.ticketId]?.project || feat.project;
                                  const cleanMs = String(msRaw).trim();
                                  const colonIdx = cleanMs.indexOf(':');
                                  const prefixProj = colonIdx > 0 ? cleanMs.substring(0, colonIdx).trim().toLowerCase() : null;
                                  const targetKey = colonIdx > 0 ? cleanMs.substring(colonIdx + 1).trim().toLowerCase() : cleanMs.toLowerCase();

                                  const foundMs = milestones.find((m) => {
                                    const mProj = m.project.toLowerCase();
                                    const mTitle = m.title.toLowerCase();
                                    const mId = String(m.id);
                                    if (prefixProj) {
                                      return mProj === prefixProj && (mTitle === targetKey || mId === targetKey);
                                    }
                                    if (projectCode && mProj === projectCode.toLowerCase()) {
                                      return mTitle === targetKey || mId === targetKey;
                                    }
                                    return mTitle === targetKey;
                                  });
                                  const msDisplay = foundMs
                                    ? (projectCode && foundMs.project.toUpperCase() !== projectCode.toUpperCase()
                                        ? `[${foundMs.project}] ${foundMs.title}`
                                        : foundMs.title)
                                    : msRaw;
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveTab('milestones');
                                      }}
                                      className="max-w-[140px] truncate flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-950 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/40 hover:bg-indigo-200/70 dark:hover:bg-indigo-500/30 text-[10px] font-mono font-semibold transition-colors cursor-pointer shrink-0"
                                      title={`Milestone: ${msDisplay}. Click to open Milestones view.`}
                                    >
                                      <MilestoneIcon size={10} className="text-indigo-700 dark:text-indigo-400 shrink-0" />
                                      <span className="truncate">{msDisplay}</span>
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                            <ChevronRight
                              size={16}
                              className={`text-[var(--text-muted)] dark:text-[var(--text-muted)] transition-transform duration-200 shrink-0 ${
                                isExpanded ? 'rotate-90 text-sky-600 dark:text-indigo-400' : ''
                              }`}
                            />
                          </div>
                        </div>

                        {/* Card Expanded Content */}
                        {isExpanded && (
                          <div
                            onMouseUp={(e) => handleTextSelection(feat.ticketId, e)}
                            className="p-4 pt-0 border-t border-[var(--border-subtle)]/80 space-y-3 text-xs leading-relaxed"
                          >
                            {(() => {
                              const currentCardTab = cardSubTabs[feat.ticketId] || 'spec';
                              const notesCount = (commentsMap[feat.ticketId]?.length || 0) + (inlineCommentsMap[feat.ticketId]?.length || 0);
                              const rawSnapshots = ticketHistoryMap[feat.ticketId] || [];
                              const totalRevisionsCount = rawSnapshots.length + 1;

                              return (
                                <>
                                  {/* Sub-Tab Navigation Bar */}
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 mb-3">
                                    <div className="flex flex-wrap items-center gap-1 bg-[var(--bg-input)] p-1 rounded-xl border border-[var(--border-subtle)] text-xs">
                                      {/* Tab 1: Specification */}
                                      <button
                                        type="button"
                                        onClick={() => setCardSubTabs((prev) => ({ ...prev, [feat.ticketId]: 'spec' }))}
                                        className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer text-[11px] ${
                                          currentCardTab === 'spec'
                                            ? 'bg-[var(--bg-surface-elevated)] text-[var(--accent-primary)] border border-[var(--border-strong)] font-bold shadow-xs'
                                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)]'
                                        }`}
                                      >
                                        <FileText size={12} />
                                        <span>Specification</span>
                                      </button>

                                      {/* Tab 2: Plan */}
                                      <button
                                        type="button"
                                        onClick={() => setCardSubTabs((prev) => ({ ...prev, [feat.ticketId]: 'plan' }))}
                                        className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer text-[11px] ${
                                          currentCardTab === 'plan'
                                            ? 'bg-[var(--bg-surface-elevated)] text-emerald-400 border border-emerald-500/40 font-bold shadow-xs'
                                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)]'
                                        }`}
                                      >
                                        <CheckCircle2 size={12} />
                                        <span>Plan</span>
                                        <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                                          plansMap[feat.ticketId]
                                            ? (currentCardTab === 'plan' ? 'bg-emerald-100 text-emerald-800 dark:bg-indigo-700 dark:text-indigo-100' : 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30')
                                            : (currentCardTab === 'plan' ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]')
                                        }`}>
                                          {plansMap[feat.ticketId] ? 'Active' : 'Draft'}
                                        </span>
                                      </button>

                                      {/* Tab 3: Notes & Discussion */}
                                      <button
                                        type="button"
                                        onClick={() => setCardSubTabs((prev) => ({ ...prev, [feat.ticketId]: 'notes' }))}
                                        className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer text-[11px] ${
                                          currentCardTab === 'notes'
                                            ? 'bg-[var(--bg-surface-elevated)] text-indigo-400 border border-indigo-500/40 font-bold shadow-xs'
                                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)]'
                                        }`}
                                      >
                                        <MessageSquare size={12} />
                                        <span>Notes</span>
                                        {notesCount > 0 && (
                                          <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                                            currentCardTab === 'notes' ? 'bg-sky-100 text-sky-800 dark:bg-indigo-700 dark:text-indigo-100' : 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30'
                                          }`}>
                                            {notesCount}
                                          </span>
                                        )}
                                      </button>

                                      {/* Tab 4: History & Revision Archive */}
                                      <button
                                        type="button"
                                        onClick={() => setCardSubTabs((prev) => ({ ...prev, [feat.ticketId]: 'history' }))}
                                        className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer text-[11px] ${
                                          currentCardTab === 'history'
                                            ? 'bg-[var(--bg-surface-elevated)] text-purple-400 border border-purple-500/40 font-bold shadow-xs'
                                            : 'text-[var(--text-muted)] hover:text-purple-400 hover:bg-purple-500/10'
                                        }`}
                                      >
                                        <Clock size={12} />
                                        <span>History</span>
                                        <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                                          currentCardTab === 'history' ? 'bg-purple-100 text-purple-800 dark:bg-purple-700 dark:text-purple-100' : 'bg-purple-50 text-purple-800 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30'
                                        }`}>
                                          {totalRevisionsCount}
                                        </span>
                                      </button>

                                      {/* Tab 5: Linked Issues */}
                                      <button
                                        type="button"
                                        onClick={() => setCardSubTabs((prev) => ({ ...prev, [feat.ticketId]: 'links' }))}
                                        className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer text-[11px] ${
                                          currentCardTab === 'links'
                                            ? 'bg-[var(--bg-surface-elevated)] text-cyan-400 border border-cyan-500/40 font-bold shadow-xs'
                                            : 'text-[var(--text-muted)] hover:text-cyan-400 hover:bg-cyan-500/10'
                                        }`}
                                      >
                                        <Link2 size={12} />
                                        <span>Links</span>
                                        {((feat.links || metasMap[feat.ticketId]?.links || []).length > 0) && (
                                          <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                                            currentCardTab === 'links' ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-700 dark:text-cyan-100' : 'bg-cyan-50 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30'
                                          }`}>
                                            {(feat.links || metasMap[feat.ticketId]?.links || []).length}
                                          </span>
                                        )}
                                      </button>
                                    </div>

                                    {isOwner && currentCardTab === 'spec' && editingDetailTicketId !== feat.ticketId && (
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditingDetail(feat)}
                                        className="px-2.5 py-1 rounded-lg bg-[var(--accent-bg-subtle)] hover:bg-[var(--accent-bg-subtle)] text-[var(--accent-primary)] border border-[var(--accent-border-subtle)] text-[10px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                                        title="Edit ticket summary and breakdown"
                                      >
                                        <Edit3 size={11} /> Edit Spec
                                      </button>
                                    )}
                                  </div>

                                  {/* SUB-TAB 1: SPECIFICATION & SCOPE */}
                                  {currentCardTab === 'spec' && (
                                    <>
                                      {editingDetailTicketId === feat.ticketId ? (
                                        <div className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-accent)] rounded-2xl space-y-3 animate-fade-in shadow-xs">
                                          <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                                            <div className="flex items-center gap-2">
                                              <Edit3 size={15} className="text-sky-600 dark:text-indigo-400" />
                                              <h4 className="text-xs font-bold text-[var(--text-primary)]">Editing Specification: Ticket #{feat.ticketId}</h4>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg p-0.5 text-[10px]">
                                                <button
                                                  type="button"
                                                  onClick={() => setDetailEditorMode('structured')}
                                                  className={`px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                                    detailEditorMode === 'structured' ? 'bg-[var(--accent-primary)] text-white shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                                  }`}
                                                >
                                                  <List size={11} /> Structured Form
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    if (detailEditorMode === 'structured') {
                                                      setRawDetailDraft(
                                                        composeDetailMarkdown(
                                                          feat,
                                                          structuredRationale,
                                                          structuredBreakdown,
                                                          structuredTechDetails,
                                                          structuredOpenQuestions
                                                        )
                                                      );
                                                    }
                                                    setDetailEditorMode('raw');
                                                  }}
                                                  className={`px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                                    detailEditorMode === 'raw' ? 'bg-[var(--accent-primary)] text-white shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                                  }`}
                                                >
                                                  <FileCode size={11} /> Raw Markdown
                                                </button>
                                              </div>
                                            </div>
                                          </div>

                                          {detailEditorMode === 'structured' ? (
                                            <div className="space-y-3">
                                              <div>
                                                <label className="text-[11px] font-bold text-[var(--text-secondary)] block mb-1">Summary / Rationale:</label>
                                                <textarea
                                                  value={structuredRationale}
                                                  onChange={(e) => setStructuredRationale(e.target.value)}
                                                  rows={3}
                                                  placeholder="Why this feature or idea is valuable and what problem it solves..."
                                                  className="w-full p-2.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] focus:border-sky-500 dark:focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] focus:outline-none resize-y"
                                                />
                                              </div>

                                              <div>
                                                <div className="flex items-center justify-between mb-1.5">
                                                  <label className="text-[11px] font-bold text-[var(--text-secondary)]">Feature Breakdown Items ({structuredBreakdown.length}):</label>
                                                  <button
                                                    type="button"
                                                    onClick={() => setStructuredBreakdown((prev) => [...prev, ''])}
                                                    className="px-2 py-0.5 bg-sky-50 dark:bg-indigo-600/20 hover:bg-sky-100 dark:hover:bg-indigo-600/30 text-sky-800 dark:text-indigo-300 border border-sky-200 dark:border-indigo-500/30 rounded-lg text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                                                  >
                                                    <Plus size={11} /> Add Step
                                                  </button>
                                                </div>
                                                <div className="space-y-1.5">
                                                  {structuredBreakdown.map((item, idx) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                      <span className="text-[10px] font-mono font-bold text-sky-700 dark:text-indigo-400 w-5 text-right shrink-0">{idx + 1}.</span>
                                                      <input
                                                        type="text"
                                                        value={item}
                                                        onChange={(e) => {
                                                          const next = [...structuredBreakdown];
                                                          next[idx] = e.target.value;
                                                          setStructuredBreakdown(next);
                                                        }}
                                                        placeholder={`Breakdown step ${idx + 1}...`}
                                                        className="flex-1 p-1.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] focus:border-sky-500 dark:focus:border-indigo-500/50 rounded-lg text-xs text-[var(--text-primary)] focus:outline-none"
                                                      />
                                                      <button
                                                        type="button"
                                                        onClick={() => setStructuredBreakdown((prev) => prev.filter((_, i) => i !== idx))}
                                                        className="p-1.5 text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                                                        title="Remove step"
                                                      >
                                                        <Trash2 size={13} />
                                                      </button>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>

                                              <div>
                                                <label className="text-[11px] font-bold text-[var(--text-secondary)] block mb-1">Technical Details & Notes (one per line):</label>
                                                <textarea
                                                  value={structuredTechDetails.join('\n')}
                                                  onChange={(e) => setStructuredTechDetails(e.target.value.split('\n').filter((l) => l.trim().length > 0))}
                                                  rows={2}
                                                  placeholder="Technical details..."
                                                  className="w-full p-2.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] focus:border-sky-500 dark:focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] focus:outline-none resize-y"
                                                />
                                              </div>
                                            </div>
                                          ) : (
                                            <div>
                                              <label className="text-[11px] font-bold text-[var(--text-secondary)] block mb-1">Raw Specification Markdown (`detail.md`):</label>
                                              <textarea
                                                value={rawDetailDraft}
                                                onChange={(e) => setRawDetailDraft(e.target.value)}
                                                rows={12}
                                                className="w-full p-3 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-strong)] rounded-xl text-xs font-mono text-[var(--text-primary)] focus:outline-none resize-y leading-relaxed"
                                                placeholder="# Ticket #... Specification Markdown"
                                              />
                                            </div>
                                          )}

                                          <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                              {saveStatus[`detail_${feat.ticketId}`] === 'saving' && <span className="text-amber-600 dark:text-amber-400 animate-pulse">Saving & archiving to disk...</span>}
                                              {saveStatus[`detail_${feat.ticketId}`] === 'saved' && <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1"><CheckCircle2 size={12} /> Spec saved & revision archived!</span>}
                                              {saveStatus[`detail_${feat.ticketId}`] === 'error' && <span className="text-rose-600 dark:text-rose-400">Failed to save specification</span>}
                                            </span>
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => setEditingDetailTicketId(null)}
                                                className="px-3 py-1.5 bg-[var(--bg-surface-elevated)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-xl text-xs cursor-pointer transition-colors"
                                              >
                                                Cancel
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleSaveDetail(feat.ticketId)}
                                                className="px-3.5 py-1.5 bg-[var(--accent-primary)] text-white hover:brightness-110 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                                              >
                                                <Save size={13} /> Save Spec to Disk
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-3 animate-fade-in">
                                          {/* Summary / Specification */}
                                          {(feat.rationale || feat.rawDetail) && (
                                            <div className="p-3 bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] rounded-xl text-[var(--text-primary)]">
                                              <span className="font-bold text-[var(--accent-primary)] block mb-1">
                                                {feat.breakdown.length > 0 ? 'Summary:' : 'Specification & Details:'}
                                              </span>
                                              {renderFormattedInlineMarkdown(feat.breakdown.length > 0 ? feat.rationale : (feat.rawDetail || feat.rationale))}
                                            </div>
                                          )}

                                          {/* Breakdown */}
                                          {feat.breakdown.length > 0 && (
                                            <div className="space-y-1.5">
                                              <h4 className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                                <CheckCircle2 size={13} className="text-emerald-700 dark:text-emerald-400" />
                                                Feature Breakdown:
                                              </h4>
                                              <ul className="space-y-1.5 pl-2">
                                                {feat.breakdown.map((item, idx) => (
                                                  <li key={idx} className="text-[var(--text-secondary)] flex items-start gap-2">
                                                    <span className="text-sky-600 dark:text-indigo-400 font-bold mt-0.5">•</span>
                                                    <div className="flex-1 min-w-0">{renderFormattedInlineMarkdown(item)}</div>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}

                                          {/* Technical Details */}
                                          {feat.technicalDetails && feat.technicalDetails.length > 0 && (
                                            <div className="p-3 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-xl space-y-1">
                                              <h4 className="font-bold text-[var(--text-primary)] flex items-center gap-1.5 mb-1">
                                                <Zap size={13} className="text-sky-600 dark:text-indigo-400" />
                                                Technical Detail:
                                              </h4>
                                              {feat.technicalDetails.map((td, idx) => (
                                                <div key={idx} className="text-[var(--text-secondary)] flex items-start gap-2">
                                                  <span className="text-sky-600 dark:text-indigo-400 font-bold">•</span>
                                                  <div className="flex-1 min-w-0">{renderFormattedInlineMarkdown(td)}</div>
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {/* Open Questions with Collapsible Developer Answer Fields */}
                                          {feat.openQuestions && feat.openQuestions.length > 0 && (
                                            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
                                              <div className="flex items-center justify-between">
                                                <h4 className="font-bold text-amber-400 text-xs flex items-center gap-1.5">
                                                  <HelpCircle size={14} className="text-amber-700 dark:text-amber-400" />
                                                  Open Questions ({feat.openQuestions.length})
                                                </h4>
                                                <span className="text-[10px] font-mono text-amber-800/80 dark:text-amber-400/80 hidden sm:inline">
                                                  Saved to <code className="bg-[var(--bg-surface)] px-1 py-0.5 rounded text-amber-400 border border-amber-500/30">answers.json</code>
                                                </span>
                                              </div>

                                              {feat.openQuestions.map((oq, qIdx) => {
                                                const savedAnswer = answersMap[feat.ticketId]?.[String(qIdx)] || '';
                                                const qKey = `${feat.ticketId}_${qIdx}`;
                                                const isInputExpanded = expandedQuestionKey === qKey;
                                                const statusKey = `${feat.ticketId}_${qIdx}`;
                                                const currentStatus = saveStatus[statusKey];
                                                const currentDraftValue = questionDrafts[qKey] !== undefined ? questionDrafts[qKey] : savedAnswer;

                                                return (
                                                  <div key={qIdx} className="p-3 bg-[var(--bg-surface)] border border-amber-500/30 rounded-xl space-y-2 shadow-2xs">
                                                    <div className="flex items-start justify-between gap-3">
                                                      <div className="text-[var(--text-primary)] text-xs flex items-start gap-2 flex-1 min-w-0">
                                                        <span className="text-amber-700 dark:text-amber-400 font-bold">•</span>
                                                        <div className="flex-1 min-w-0">{renderFormattedInlineMarkdown(oq)}</div>
                                                      </div>

                                                      {isOwner && (
                                                        <button
                                                          type="button"
                                                          onClick={() => setExpandedQuestionKey(isInputExpanded ? null : qKey)}
                                                          className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 shrink-0 border transition-colors cursor-pointer ${
                                                            savedAnswer
                                                              ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                                              : 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 text-amber-900 dark:text-amber-300 border-emerald-200 dark:border-amber-500/30'
                                                          }`}
                                                        >
                                                          <Edit3 size={11} />
                                                          {savedAnswer ? (isInputExpanded ? 'Close Edit' : 'Edit Answer') : (isInputExpanded ? 'Close' : 'Answer Question')}
                                                        </button>
                                                      )}
                                                    </div>

                                                    {/* Saved Answer Preview (When Collapsed) */}
                                                    {!isInputExpanded && savedAnswer && (
                                                      <div className="ml-4 p-2.5 bg-[var(--bg-surface-elevated)] border border-emerald-500/30 rounded-xl text-xs text-[var(--text-primary)] leading-relaxed font-sans">
                                                        <strong className="text-emerald-400 font-mono text-[10px] block mb-0.5">Developer Answer:</strong>
                                                        {savedAnswer}
                                                      </div>
                                                    )}

                                                    {/* Collapsible Answer Input Form */}
                                                    {isInputExpanded && (
                                                      <div className="ml-4 space-y-1.5 pt-1 animate-fade-in">
                                                        <textarea
                                                          value={currentDraftValue}
                                                          onChange={(e) => handleUpdateQuestionDraft(feat.ticketId, qIdx, e.target.value)}
                                                          onBlur={(e) => {
                                                            const val = e.target.value;
                                                            if (val !== savedAnswer) {
                                                              handleSaveAnswer(feat.ticketId, qIdx, val);
                                                            }
                                                          }}
                                                          placeholder="Type developer answer here... (Saves directly to disk on blur or clicking Save)"
                                                          rows={3}
                                                          className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-amber-500/50 rounded-xl text-xs text-[var(--text-primary)] placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-y font-sans"
                                                        />
                                                        <div className="flex items-center justify-between text-[11px]">
                                                          <span className="text-[10px]">
                                                            {currentStatus === 'saving' && <span className="text-amber-600 dark:text-amber-400 animate-pulse">Saving to disk...</span>}
                                                            {currentStatus === 'saved' && <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1"><CheckCircle2 size={12} /> Answer saved to disk</span>}
                                                            {currentStatus === 'error' && <span className="text-rose-600 dark:text-rose-400">Failed to save answer</span>}
                                                          </span>
                                                          <div className="flex items-center gap-2">
                                                            <button
                                                              type="button"
                                                              onClick={() => setExpandedQuestionKey(null)}
                                                              className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[10px] cursor-pointer"
                                                            >
                                                              Done
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => {
                                                                handleSaveAnswer(feat.ticketId, qIdx, currentDraftValue);
                                                              }}
                                                              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                                            >
                                                              <Save size={11} /> Save Answer
                                                            </button>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {/* SUB-TAB 2: IMPLEMENTATION PLAN */}
                                  {currentCardTab === 'plan' && (
                                    <div className="space-y-3 animate-fade-in">
                                      <div className="p-3.5 bg-sky-50/50 dark:bg-indigo-950/20 border border-sky-200 dark:border-indigo-500/20 rounded-2xl space-y-3">
                                        <div className="flex items-center justify-between">
                                          <h4 className="font-bold text-sky-950 dark:text-indigo-300 text-xs flex items-center gap-1.5">
                                            <FileText size={14} className="text-sky-600 dark:text-indigo-400" />
                                            Implementation Plan ({plansMap[feat.ticketId] ? 'Active' : 'Not Drafted'})
                                          </h4>
                                          {plansMap[feat.ticketId] && (
                                            <span className="text-[10px] font-mono text-sky-800/80 dark:text-indigo-400/80 hidden sm:inline">
                                              <code className="bg-[var(--bg-surface)] px-1 py-0.5 rounded text-[var(--accent-primary)] border border-[var(--border-subtle)]">src/data/planning/tickets/{feat.ticketId}/implementation_plan.md</code>
                                            </span>
                                          )}
                                        </div>

                                        {editingPlanTicketId === feat.ticketId ? (
                                          <div className="space-y-2">
                                            <textarea
                                              value={planDraftText}
                                              onChange={(e) => handleUpdatePlanDraft(feat.ticketId, e.target.value)}
                                              rows={12}
                                              className="w-full p-3 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-strong)] rounded-xl text-xs font-mono text-[var(--text-primary)] focus:outline-none resize-y leading-relaxed"
                                              placeholder="Write or paste ticket implementation plan markdown..."
                                            />
                                            <div className="flex items-center justify-between pt-1">
                                              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                                {saveStatus[`plan_${feat.ticketId}`] === 'saving' && <span className="text-amber-600 dark:text-amber-400 animate-pulse">Saving plan to disk...</span>}
                                                {saveStatus[`plan_${feat.ticketId}`] === 'saved' && <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1"><CheckCircle2 size={12} /> Plan saved!</span>}
                                                {saveStatus[`plan_${feat.ticketId}`] === 'error' && <span className="text-rose-600 dark:text-rose-400">Failed to save plan</span>}
                                              </span>
                                              <div className="flex items-center gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    handleClearPlanDraft(feat.ticketId);
                                                    setEditingPlanTicketId(null);
                                                  }}
                                                  className="px-3 py-1 bg-[var(--bg-surface-elevated)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] rounded-lg text-xs cursor-pointer border border-[var(--border-subtle)]"
                                                >
                                                  Cancel
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleSavePlan(feat.ticketId, planDraftText)}
                                                  className="px-3 py-1 bg-[var(--accent-primary)] text-white hover:brightness-110 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-xs"
                                                >
                                                  <Save size={12} /> Save Plan to Disk
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        ) : plansMap[feat.ticketId] ? (
                                          <div className="space-y-3">
                                            <div className="p-3.5 bg-[var(--bg-input)] rounded-xl border border-[var(--border-subtle)] max-h-96 overflow-y-auto scrollbar-thin">
                                              <pre className="text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                                                {plansMap[feat.ticketId]}
                                              </pre>
                                            </div>
                                            {isOwner && (
                                              <div className="flex justify-end">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setPlanDraftText(planDraftsMap[feat.ticketId] || plansMap[feat.ticketId] || '');
                                                    setEditingPlanTicketId(feat.ticketId);
                                                  }}
                                                  className="px-3 py-1.5 bg-[var(--accent-bg-subtle)] hover:bg-[var(--accent-bg-subtle)] text-[var(--accent-primary)] border border-[var(--accent-border-subtle)] rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                                                >
                                                  <Edit3 size={12} /> Edit Plan
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="p-6 bg-[var(--bg-surface-elevated)] rounded-xl border border-dashed border-[var(--border-subtle)] flex flex-col items-center justify-center gap-2 text-center text-xs text-[var(--text-muted)]">
                                            <span>No implementation plan drafted yet for Ticket #{feat.ticketId}.</span>
                                            {isOwner && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setPlanDraftText(planDraftsMap[feat.ticketId] || `# Implementation Plan: Ticket #${feat.ticketId} - ${feat.title}\n\n## Goal\n\n## Proposed Changes\n\n## Verification Plan\n`);
                                                  setEditingPlanTicketId(feat.ticketId);
                                                }}
                                                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs mt-1"
                                              >
                                                <Plus size={13} /> Draft Implementation Plan
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* SUB-TAB 3: NOTES & DISCUSSION */}
                                  {currentCardTab === 'notes' && (
                                    <div className="space-y-3 animate-fade-in">
                                      <div className="p-3.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl space-y-3">
                                        <div className="flex items-center justify-between">
                                          <h4 className="font-bold text-[var(--text-primary)] text-xs flex items-center gap-1.5">
                                            <MessageSquare size={14} className="text-sky-600 dark:text-indigo-400" />
                                            Developer Notes & Comments ({(commentsMap[feat.ticketId] || []).length})
                                          </h4>
                                          <span className="text-[10px] font-mono text-[var(--text-muted)] hidden sm:inline">
                                            Saved to <code className="bg-[var(--bg-surface)] px-1 py-0.5 rounded text-[var(--accent-primary)] border border-[var(--border-subtle)]">src/data/planning/tickets/{feat.ticketId}/comments.json</code>
                                          </span>
                                        </div>

                                        {/* Comments List */}
                                        {(commentsMap[feat.ticketId] || []).length > 0 ? (
                                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
                                            {(commentsMap[feat.ticketId] || []).map((cmt) => (
                                              <div key={cmt.id} className="p-2.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl space-y-1 shadow-2xs">
                                                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                                                  <span className="font-bold text-sky-800 dark:text-indigo-300">{cmt.author || 'Developer'}</span>
                                                  <span>{new Date(cmt.timestamp).toLocaleString()}</span>
                                                </div>
                                                {renderCommentWithMedia(cmt.text)}
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-[11px] text-[var(--text-muted)] italic">No developer comments or notes recorded for Ticket #{feat.ticketId} yet.</p>
                                        )}

                                        {/* Add Comment Input Form */}
                                        {isOwner && (
                                          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]/80">
                                            <div className="relative">
                                              <textarea
                                                value={newCommentDraft[feat.ticketId] || ''}
                                                onChange={(e) => handleUpdateCommentDraft(feat.ticketId, e.target.value)}
                                                onPaste={(e) => handlePasteMedia(feat.ticketId, e)}
                                                placeholder="Type note or paste images/videos (Ctrl+V) directly into comments..."
                                                rows={2}
                                                className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-primary)] placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-y pr-9"
                                              />
                                              <label
                                                className="absolute right-2.5 top-2.5 text-[var(--text-muted)] hover:text-sky-700 dark:hover:text-indigo-300 cursor-pointer p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                                                title="Attach Image or Video"
                                              >
                                                <Paperclip size={15} />
                                                <input
                                                  type="file"
                                                  accept="image/*,video/*"
                                                  className="hidden"
                                                  onChange={(e) => {
                                                    if (e.target.files && e.target.files[0]) {
                                                      handleUploadFile(feat.ticketId, e.target.files[0]);
                                                    }
                                                  }}
                                                />
                                              </label>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px]">
                                              <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 font-mono">
                                                <ImageIcon size={10} /> Tip: Press Ctrl+V to paste screenshot / video directly
                                              </span>
                                              <div className="flex items-center gap-2">
                                                {saveStatus[`comment_${feat.ticketId}`] === 'saving' && <span className="text-sky-700 dark:text-indigo-400 animate-pulse text-[10px]">Saving note...</span>}
                                                {saveStatus[`comment_${feat.ticketId}`] === 'saved' && <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-[10px] flex items-center gap-1"><CheckCircle2 size={12} /> Note saved</span>}
                                                {saveStatus[`comment_${feat.ticketId}`] === 'error' && <span className="text-rose-600 dark:text-rose-400 text-[10px]">Failed to save note</span>}
                                                <button
                                                  type="button"
                                                  onClick={() => handleSaveComment(feat.ticketId, newCommentDraft[feat.ticketId] || '')}
                                                  disabled={!newCommentDraft[feat.ticketId]?.trim()}
                                                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 dark:bg-indigo-600/30 dark:hover:bg-indigo-600/50 text-white dark:text-indigo-200 border border-sky-600 dark:border-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                                >
                                                  <Save size={12} /> Add Note
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Highlighted Text Annotations */}
                                      {(inlineCommentsMap[feat.ticketId] || []).length > 0 && (
                                        <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-500/20 rounded-2xl space-y-2">
                                          <h4 className="font-bold text-indigo-900 dark:text-indigo-300 text-xs flex items-center gap-1.5">
                                            <Highlighter size={13} className="text-indigo-600 dark:text-indigo-400" />
                                            Highlighted Text Annotations ({(inlineCommentsMap[feat.ticketId] || []).length})
                                          </h4>
                                          <div className="space-y-1.5">
                                            {(inlineCommentsMap[feat.ticketId] || []).map((ic) => (
                                              <div key={ic.id} className="p-2.5 bg-[var(--bg-surface)] border border-[var(--border-accent)] rounded-xl text-xs space-y-1 shadow-2xs">
                                                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                                                  <span className="text-indigo-900 dark:text-indigo-300 font-semibold flex items-center gap-1">
                                                    <Quote size={10} /> "{ic.selectedText}"
                                                  </span>
                                                  <span>{ic.author || 'Developer'}</span>
                                                </div>
                                                <p className="text-[var(--text-primary)] text-xs">{ic.comment}</p>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* SUB-TAB 4: HISTORY & REVISION ARCHIVE */}
                                  {currentCardTab === 'history' && (() => {
                                    const rawSnapshots = ticketHistoryMap[feat.ticketId] || [];
                                    const chronologicalArchives = rawSnapshots.slice().reverse();
                                    const currentActiveText = feat.rawDetail || composeDetailMarkdown(feat);

                                    const timelineRevisions: {
                                      id: string;
                                      type: 'archive' | 'current';
                                      snapshotType: 'plan' | 'detail' | 'comments' | 'other';
                                      filename: string;
                                      timestamp: string;
                                      content: string;
                                      isCurrentActive: boolean;
                                    }[] = [
                                      ...chronologicalArchives.map((s) => ({
                                        id: s.id,
                                        type: 'archive' as const,
                                        snapshotType: s.type,
                                        filename: s.filename,
                                        timestamp: s.timestamp,
                                        content: s.content,
                                        isCurrentActive: false,
                                      })),
                                      {
                                        id: `${feat.ticketId}-current-active`,
                                        type: 'current' as const,
                                        snapshotType: 'detail' as const,
                                        filename: 'Current Active on Disk',
                                        timestamp: new Date().toISOString(),
                                        content: currentActiveText,
                                        isCurrentActive: true,
                                      },
                                    ];

                                    const totalRevs = timelineRevisions.length;
                                    const activeIdx = historyActiveSnapshotIdx[feat.ticketId] ?? (totalRevs - 1);
                                    const safeIdx = Math.min(totalRevs - 1, Math.max(0, activeIdx));
                                    const currentRev = timelineRevisions[safeIdx];
                                    const viewMode = historyViewMode[feat.ticketId] || 'diff';

                                    const comparisonBase = currentRev.isCurrentActive && totalRevs > 1
                                      ? timelineRevisions[totalRevs - 2].content
                                      : currentRev.content;
                                    const comparisonTarget = currentActiveText;

                                    const diffLines = computeLineDiff(comparisonBase, comparisonTarget);

                                    return (
                                      <div className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-accent)] rounded-2xl space-y-3 animate-fade-in">
                                        <div className="flex items-center justify-between pb-2 border-b border-purple-200 dark:border-purple-500/20">
                                          <div className="flex items-center gap-2">
                                            <History size={16} className="text-purple-600 dark:text-purple-400" />
                                            <h4 className="text-xs font-bold text-purple-950 dark:text-white flex items-center gap-2">
                                              <span>Ticket Revision History & Archive</span>
                                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30">
                                                {totalRevs} Total Versions ({rawSnapshots.length} Archived)
                                              </span>
                                            </h4>
                                          </div>
                                        </div>

                                        {/* Timeline Range Scrubber */}
                                        <div className="p-3 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-xl space-y-2">
                                          <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2">
                                              <Sliders size={13} className="text-purple-600 dark:text-purple-400" />
                                              <span className="font-bold text-[var(--text-primary)]">Revision Timeline Scrubber</span>
                                            </div>
                                            <span className="text-[11px] font-mono text-purple-800 dark:text-purple-300 font-semibold">
                                              Revision {safeIdx + 1} of {totalRevs} {currentRev.isCurrentActive ? '(Current Active)' : '(Archived Snapshot)'}
                                            </span>
                                          </div>

                                          <div className="flex items-center gap-3">
                                            <button
                                              type="button"
                                              disabled={safeIdx <= 0}
                                              onClick={() => setHistoryActiveSnapshotIdx((prev) => ({ ...prev, [feat.ticketId]: Math.max(0, safeIdx - 1) }))}
                                              className="p-1.5 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-primary)] rounded-lg transition-colors cursor-pointer shrink-0 border border-[var(--border-subtle)]"
                                              title="Step Back (Older revision)"
                                            >
                                              <ChevronLeft size={14} />
                                            </button>

                                            <input
                                              type="range"
                                              min={0}
                                              max={totalRevs - 1}
                                              step={1}
                                              value={safeIdx}
                                              onChange={(e) => setHistoryActiveSnapshotIdx((prev) => ({ ...prev, [feat.ticketId]: Number(e.target.value) }))}
                                              className="flex-1 accent-purple-500 h-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg cursor-pointer"
                                            />

                                            <button
                                              type="button"
                                              disabled={safeIdx >= totalRevs - 1}
                                              onClick={() => setHistoryActiveSnapshotIdx((prev) => ({ ...prev, [feat.ticketId]: Math.min(totalRevs - 1, safeIdx + 1) }))}
                                              className="p-1.5 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-primary)] rounded-lg transition-colors cursor-pointer shrink-0 border border-[var(--border-subtle)]"
                                              title="Step Forward (Newer revision)"
                                            >
                                              <ChevronRight size={14} />
                                            </button>
                                          </div>
                                        </div>

                                        {/* Snapshot Info & View Controls Header */}
                                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-xl text-xs">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                                              currentRev.isCurrentActive
                                                ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/40'
                                                : currentRev.snapshotType === 'plan'
                                                ? 'bg-sky-50 dark:bg-indigo-500/20 text-sky-800 dark:text-indigo-300 border border-sky-200 dark:border-indigo-500/30'
                                                : currentRev.snapshotType === 'detail'
                                                ? 'bg-teal-50 dark:bg-teal-500/20 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30'
                                                : 'bg-amber-50 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
                                            }`}>
                                              {currentRev.isCurrentActive ? 'Current Active' : currentRev.snapshotType === 'plan' ? 'Plan Snapshot' : 'Spec Snapshot'}
                                            </span>
                                            <span className="font-mono text-[11px] text-[var(--text-secondary)] font-semibold">
                                              {currentRev.filename}
                                            </span>
                                            {currentRev.timestamp && !currentRev.isCurrentActive && (
                                              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                                ({new Date(currentRev.timestamp).toLocaleString()})
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-2">
                                            <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5 text-[10px]">
                                              <button
                                                type="button"
                                                onClick={() => setHistoryViewMode((prev) => ({ ...prev, [feat.ticketId]: 'diff' }))}
                                                className={`px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                                  viewMode === 'diff' ? 'bg-purple-600 text-white shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                                }`}
                                              >
                                                <Split size={11} /> Markdown Diff
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setHistoryViewMode((prev) => ({ ...prev, [feat.ticketId]: 'rendered' }))}
                                                className={`px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                                  viewMode === 'rendered' ? 'bg-purple-600 text-white shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                                }`}
                                              >
                                                <Eye size={11} /> Rendered
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setHistoryViewMode((prev) => ({ ...prev, [feat.ticketId]: 'side-by-side' }))}
                                                className={`px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                                  viewMode === 'side-by-side' ? 'bg-purple-600 text-white shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                                }`}
                                              >
                                                <Columns size={11} /> Side-by-Side
                                              </button>
                                            </div>

                                            {isOwner && !currentRev.isCurrentActive && (
                                              <button
                                                type="button"
                                                onClick={() => handleRestoreSnapshot(feat.ticketId, {
                                                  id: currentRev.id,
                                                  ticketId: feat.ticketId,
                                                  type: currentRev.snapshotType as any,
                                                  filename: currentRev.filename,
                                                  timestamp: currentRev.timestamp,
                                                  content: currentRev.content,
                                                })}
                                                className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 dark:bg-purple-600/30 dark:hover:bg-purple-600/50 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-500/40 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                                title="Restore this revision into active ticket"
                                              >
                                                <RotateCcw size={11} /> Restore Revision
                                              </button>
                                            )}
                                          </div>
                                        </div>

                                        {/* Diff / Content Body */}
                                        {viewMode === 'diff' && (
                                          <div className="p-3 bg-[var(--bg-input)] rounded-xl border border-[var(--border-subtle)] max-h-96 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-0.5 scrollbar-thin">
                                            <div className="flex items-center gap-4 pb-2 mb-2 border-b border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
                                              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> + Lines in active version</span>
                                              <span className="flex items-center gap-1 text-rose-700 dark:text-rose-400 font-semibold"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span> - Lines in historic revision</span>
                                            </div>
                                            {diffLines.map((line, lIdx) => {
                                              if (line.type === 'add') {
                                                return (
                                                  <div key={lIdx} className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5 rounded-r">
                                                    + {line.text}
                                                  </div>
                                                );
                                              }
                                              if (line.type === 'remove') {
                                                return (
                                                  <div key={lIdx} className="bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-300 border-l-2 border-rose-500 px-2 py-0.5 rounded-r">
                                                    - {line.text}
                                                  </div>
                                                );
                                              }
                                              return (
                                                <div key={lIdx} className="text-[var(--text-muted)] px-2 py-0.5">
                                                  &nbsp;&nbsp;{line.text}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}

                                        {viewMode === 'rendered' && (
                                          <div className="p-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] max-h-96 overflow-y-auto text-[var(--text-secondary)] text-xs leading-relaxed space-y-2 scrollbar-thin">
                                            {renderFormattedInlineMarkdown(currentRev.content)}
                                          </div>
                                        )}

                                        {viewMode === 'side-by-side' && (
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-hidden">
                                            <div className="p-3 bg-[var(--bg-input)] rounded-xl border border-[var(--border-subtle)] overflow-y-auto scrollbar-thin space-y-1">
                                              <div className="text-[10px] font-mono font-bold text-purple-900 dark:text-purple-400 pb-1 border-b border-[var(--border-subtle)]">
                                                {currentRev.isCurrentActive ? 'Current Active on Disk' : `Historic Revision (${currentRev.filename})`}
                                              </div>
                                              <pre className="text-[11px] font-mono text-purple-900 dark:text-purple-200 whitespace-pre-wrap">
                                                {currentRev.content}
                                              </pre>
                                            </div>

                                            <div className="p-3 bg-[var(--bg-input)] rounded-xl border border-[var(--border-subtle)] overflow-y-auto scrollbar-thin space-y-1">
                                              <div className="text-[10px] font-mono font-bold text-sky-900 dark:text-indigo-400 pb-1 border-b border-[var(--border-subtle)]">
                                                Current Active on Disk
                                              </div>
                                              <pre className="text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap">
                                                {currentActiveText}
                                              </pre>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* SUB-TAB 5: LINKED ISSUES */}
                                  {currentCardTab === 'links' && (
                                    <div className="space-y-3 animate-fade-in">
                                      <div className="p-3.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl space-y-3">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-[var(--text-primary)] text-xs flex items-center gap-1.5">
                                              <Link2 size={14} className="text-cyan-600 dark:text-cyan-400" />
                                              Linked Issues ({((feat.links || metasMap[feat.ticketId]?.links || []) as any[]).length})
                                            </h4>
                                            {(feat.isBlocked || metasMap[feat.ticketId]?.isBlocked) && (
                                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 font-semibold">
                                                Blocked
                                              </span>
                                            )}
                                          </div>
                                          {isOwner && (
                                            <button
                                              type="button"
                                              onClick={() => setLinkingTicket(feat)}
                                              className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                                            >
                                              <Plus size={12} /> Link Ticket
                                            </button>
                                          )}
                                        </div>

                                        {((feat.links || metasMap[feat.ticketId]?.links || []) as any[]).length > 0 ? (
                                          <div className="space-y-2">
                                            {((feat.links || metasMap[feat.ticketId]?.links || []) as any[]).map((link, lIdx) => {
                                              const relLabel = LINK_RELATION_LABELS[link.relation as keyof typeof LINK_RELATION_LABELS] || link.relation;
                                              const isBlocksOrBlocked = link.relation === 'blocks' || link.relation === 'blocked-by';
                                              const isBlockerUncompleted = link.relation === 'blocked-by' && !link.isTargetCompleted;

                                              return (
                                                <div
                                                  key={lIdx}
                                                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                                                    isBlockerUncompleted
                                                      ? 'bg-red-500/5 border-red-500/30'
                                                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)]'
                                                  }`}
                                                >
                                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                    <span
                                                      className={`shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border ${
                                                        isBlocksOrBlocked
                                                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                                                          : link.relation === 'parent-of' || link.relation === 'child-of'
                                                          ? 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-400'
                                                          : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-400'
                                                      }`}
                                                    >
                                                      {relLabel}
                                                    </span>

                                                    <div className="min-w-0 flex-1 flex items-center gap-2">
                                                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                                                        {link.targetKey || `#${link.targetId}`}
                                                      </span>
                                                      {link.targetTitle && (
                                                        <span className="truncate text-slate-700 dark:text-slate-300">
                                                          {link.targetTitle}
                                                        </span>
                                                      )}
                                                    </div>

                                                    {link.targetStatus && (
                                                      <span
                                                        className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
                                                          link.isTargetCompleted
                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-semibold'
                                                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                                                        }`}
                                                      >
                                                        {link.targetStatus}
                                                      </span>
                                                    )}
                                                  </div>

                                                  {isOwner && (
                                                    <button
                                                      type="button"
                                                      onClick={async () => {
                                                        try {
                                                          if (activePlanningProvider.unlinkTicket) {
                                                            await activePlanningProvider.unlinkTicket(
                                                              feat.ticketId || feat.id,
                                                              link.targetKey || link.targetId
                                                            );
                                                            handleRefresh();
                                                          }
                                                        } catch (err) {
                                                          console.error('Failed to unlink ticket:', err);
                                                        }
                                                      }}
                                                      className="shrink-0 p-1 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-500/10"
                                                      title="Remove link"
                                                    >
                                                      <Trash2 size={13} />
                                                    </button>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <div className="p-6 bg-[var(--bg-surface-elevated)] rounded-xl border border-dashed border-[var(--border-subtle)] flex flex-col items-center justify-center gap-2 text-center text-xs text-[var(--text-muted)]">
                                            <span>No linked issues yet for Ticket #{feat.ticketId}.</span>
                                            {isOwner && (
                                              <button
                                                type="button"
                                                onClick={() => setLinkingTicket(feat)}
                                                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs mt-1"
                                              >
                                                <Plus size={13} /> Link Ticket
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* TAB: MILESTONES */}
          {activeTab === 'milestones' && (
            <MilestonesView
              milestones={milestones}
              plannedFeatures={parsedData.plannedFeatures}
              metasMap={metasMap}
              projectFilter={projectFilter}
              isOwner={isOwner}
              onOpenCreateMilestone={() => {
                setEditingMilestone(null);
                setIsMilestoneModalOpen(true);
              }}
              onEditMilestone={(m) => {
                setEditingMilestone(m);
                setIsMilestoneModalOpen(true);
              }}
              onMilestonesChanged={loadMilestones}
              onSelectTicket={(ticketId) => {
                const targetProject = metasMap[ticketId]?.project;
                if (targetProject && projectFilter !== 'all' && projectFilter.toLowerCase() !== targetProject.toLowerCase()) {
                  setProjectFilter(targetProject);
                  try {
                    sessionStorage.setItem('dev_plan_project_filter', targetProject);
                    localStorage.setItem('dev_plan_project_filter', targetProject);
                    updateProjectUrlSearchParam(targetProject, isEmbedded);
                  } catch (e) {}
                }
                setActiveTab('features');
                setExpandedFeatureId(`feature-${ticketId}`);
                handleJumpToFeature(`feature-${ticketId}`, Number(ticketId));
              }}
              onSelectMilestone={(msTitle, msProject) => {
                if (msProject && projectFilter !== 'all' && projectFilter.toLowerCase() !== msProject.toLowerCase()) {
                  setProjectFilter(msProject);
                  try {
                    sessionStorage.setItem('dev_plan_project_filter', msProject);
                    localStorage.setItem('dev_plan_project_filter', msProject);
                    updateProjectUrlSearchParam(msProject, isEmbedded);
                  } catch (e) {}
                }
                setMilestoneFilter(msTitle);
                setActiveTab('features');
              }}
              availableProjects={availableProjects}
              isEmbedded={isEmbedded}
              allowedProjects={allowedProjects}
            />
          )}

          {/* TAB 2: FEATURE FLAGS */}
          {activeTab === 'flags' && (
            <div className="h-full min-h-0 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
              <div className="p-4 bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] rounded-2xl text-xs text-slate-800 dark:text-indigo-200">
                <h3 className="font-bold text-sky-950 dark:text-indigo-300 text-sm mb-1 flex items-center gap-2">
                  <ShieldAlert size={16} />
                  Feature Flagging Strategy
                </h3>
                <p>
                  Features flagged during development can be safely merged into main without exposing unfinished state to users until ready.
                </p>
              </div>

              {filteredFeatureFlags.length === 0 ? (
                <div className="p-8 text-center bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl">
                  <Flag size={28} className="mx-auto text-[var(--text-muted)] dark:text-slate-600 mb-2" />
                  <div className="text-sm font-semibold text-[var(--text-secondary)]">No Feature Flags for this Project</div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">
                    {projectFilter === 'all'
                      ? 'No feature flags defined across any project.'
                      : `No feature flags are currently defined or linked to ${getProjectDescriptor(projectFilter)?.name || projectFilter}.`}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredFeatureFlags.map((flag, idx) => {
                    const linkedTickets = parsedData.plannedFeatures.filter(
                      (f) => (metasMap[f.ticketId]?.featureFlag || f.featureFlag) === flag.name
                    );
                    const isLiveInApp = (KNOWN_FEATURE_FLAGS as readonly string[]).includes(flag.name);

                    return (
                      <div key={idx} className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl space-y-2 flex flex-col justify-between shadow-xs">
                        <div>
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <h4 className="font-bold text-purple-900 dark:text-purple-300 font-mono text-sm flex items-center gap-1.5 min-w-0 truncate">
                                <Flag size={14} className="text-purple-600 dark:text-purple-400 shrink-0" />
                                <span className="truncate">{flag.name}</span>
                              </h4>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold shrink-0 ${flag.projectColors?.badge || 'border-[var(--border-subtle)] bg-slate-100 dark:bg-slate-800 text-[var(--text-secondary)]'}`}>
                                {flag.projectCode}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isLiveInApp && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" />
                                  Live in App
                                </span>
                              )}

                            {linkedTickets.length === 0 ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteFlag(flag.name)}
                                className="p-1 text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/20 rounded transition-colors cursor-pointer"
                                title="Delete unlinked Feature Flag"
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="p-1 text-slate-300 dark:text-slate-600 cursor-not-allowed rounded opacity-50"
                                title="Cannot delete flag while tickets are linked. Unlink tickets first."
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {editingFlagDescName === flag.name ? (
                          <div className="space-y-1.5 mt-2">
                            <textarea
                              value={editingFlagDescText}
                              onChange={(e) => setEditingFlagDescText(e.target.value)}
                              rows={2}
                              className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-accent)] rounded-lg text-xs font-sans text-[var(--text-primary)] focus:outline-none focus:border-purple-500"
                              placeholder="Enter flag description..."
                              autoFocus
                            />
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => setEditingFlagDescName(null)}
                                className="px-2 py-0.5 rounded text-[11px] font-mono text-[var(--text-muted)] hover:bg-[var(--accent-bg-subtle)] transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = { ...flagDescriptionsMap, [flag.name]: editingFlagDescText.trim() };
                                  setFlagDescriptionsMap(updated);
                                  localStorage.setItem('dev_feature_flags_descriptions', JSON.stringify(updated));
                                  setEditingFlagDescName(null);
                                }}
                                className="px-2.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-[11px] font-mono font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Check size={11} /> Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="group relative flex items-start justify-between gap-2 mt-1">
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed flex-1">{flag.description}</p>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingFlagDescName(flag.name);
                                setEditingFlagDescText(flag.description);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-purple-300 hover:bg-purple-500/20 rounded transition-all cursor-pointer shrink-0"
                              title="Edit Flag Description"
                            >
                              <Edit3 size={12} />
                            </button>
                          </div>
                        )}
                      </div>

                      {linkedTickets.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/80 flex items-start justify-start gap-2">
                          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap shrink-0 pt-1">
                            Linked Tickets:
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                            {linkedTickets.map((lt) => (
                              <button
                                key={lt.id}
                                type="button"
                                onClick={() => {
                                  setActiveTab('features');
                                  handleJumpToFeature(lt.id, lt.number);
                                }}
                                className="px-2.5 py-1 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/30 text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                                title={`Jump to Ticket #${lt.number}`}
                              >
                                <Flag size={11} className="text-purple-400 shrink-0" />
                                <span className="truncate">Ticket #{lt.number}: {lt.title}</span>
                                <ArrowRight size={10} className="shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          )}



        </div>

      {/* Floating Selection Comment Popover */}
      {selectionPopover && (
        <div
          className="fixed z-[60] -translate-x-1/2 -translate-y-full mb-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xl border border-indigo-400 flex items-center gap-1.5 cursor-pointer animate-fade-in"
          style={{ left: Math.min(window.innerWidth - 100, Math.max(100, selectionPopover.x)), top: Math.max(60, selectionPopover.y) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            const panelWidth = 384;
            const panelHeight = 250;
            const posX = Math.min(window.innerWidth - panelWidth - 12, Math.max(12, selectionPopover.x - panelWidth / 2));
            const posY = Math.min(window.innerHeight - panelHeight - 12, Math.max(60, selectionPopover.y + 12));

            setInlineCommentInput({
              ticketId: selectionPopover.ticketId,
              selectedText: selectionPopover.text,
              comment: '',
              x: posX,
              y: posY,
            });
            setSelectionPopover(null);
          }}
        >
          <Highlighter size={13} />
          <span>Comment on selection</span>
        </div>
      )}

      {/* Inline Comment Floating Entry Panel */}
      {inlineCommentInput && (
        <div
          className="fixed z-[70] w-80 sm:w-96 bg-[var(--bg-surface)] border border-[var(--border-accent)] p-3.5 rounded-2xl shadow-2xl backdrop-blur-md space-y-2.5 animate-fade-in"
          style={{
            left: inlineCommentInput.x ?? Math.min(window.innerWidth - 390, Math.max(16, window.innerWidth / 2 - 190)),
            top: inlineCommentInput.y ?? Math.min(window.innerHeight - 280, Math.max(60, window.innerHeight / 2 + 12)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            onMouseDown={handleCommentHeaderMouseDown}
            className="flex items-center justify-between cursor-grab active:cursor-grabbing select-none border-b border-[var(--border-subtle)] pb-2 mb-1"
            title="Drag to reposition"
          >
            <h3 className="font-bold text-xs text-indigo-300 flex items-center gap-1.5 pointer-events-none">
              <GripHorizontal size={14} className="text-[var(--text-muted)]" />
              <Highlighter size={14} /> Add Comment on Highlighted Text
            </h3>
            <button
              type="button"
              onClick={() => handleUpdateInlineDraft(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-secondary)] italic font-mono max-h-24 overflow-y-auto">
            "{inlineCommentInput.selectedText}"
          </div>

          <textarea
            value={inlineCommentInput.comment}
            onChange={(e) => handleUpdateInlineDraft({ ...inlineCommentInput, comment: e.target.value })}
            placeholder="Type your comment on this highlighted text..."
            rows={3}
            className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-y"
            autoFocus
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleUpdateInlineDraft(null)}
              className="px-3 py-1 bg-[var(--bg-surface-elevated)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] rounded-lg text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSaveInlineComment(inlineCommentInput.ticketId, inlineCommentInput.selectedText, inlineCommentInput.comment)}
              disabled={!inlineCommentInput.comment.trim()}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              <Save size={12} /> Save Annotation
            </button>
          </div>
        </div>
      )}

      {/* Floating Header Field Popover Editor */}
      {headerPopover && (
        <div
          ref={headerPopoverRef}
          className="fixed z-[80] -translate-x-1/2 mt-1 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-xl shadow-2xl p-2 font-sans animate-fade-in space-y-1"
          style={{
            left: typeof window !== 'undefined' ? Math.min(window.innerWidth - 110, Math.max(110, headerPopover.x)) : headerPopover.x,
            top: typeof window !== 'undefined' ? Math.min(window.innerHeight - 200, Math.max(60, headerPopover.y)) : headerPopover.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popover 1: Flag Options when Flagged */}
          {headerPopover.type === 'flag' && (
            <div className="space-y-1 w-44">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Feature Flag
              </div>
              <button
                type="button"
                onClick={() => {
                  setHeaderPopover(null);
                  setActiveTab('flags');
                }}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[var(--accent-primary)] hover:bg-[var(--accent-bg-subtle)] flex items-center gap-2 font-mono transition-colors cursor-pointer"
              >
                <Flag size={12} className="text-purple-600 dark:text-purple-400" /> View Feature Flag
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ticketId = headerPopover.ticketId;
                  setHeaderPopover(null);
                  try {
                    await activePlanningProvider.updateMeta(ticketId, { featureFlag: '' });
                    setMetasMap((prev) => ({
                      ...prev,
                      [ticketId]: { ...prev[ticketId], featureFlag: undefined },
                    }));
                  } catch (err) {
                    console.error('Failed to unlink feature flag:', err);
                  }
                }}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20 flex items-center gap-2 font-mono transition-colors cursor-pointer border-t border-[var(--border-subtle)]"
              >
                <X size={12} className="text-rose-600 dark:text-rose-400" /> Unlink Flag
              </button>
            </div>
          )}

          {/* Popover 2: Flag Picker when Unlinked or Changing */}
          {headerPopover.type === 'flagPicker' && (
            <div className="space-y-1.5 w-52">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Link Feature Flag
              </div>
              <div className="px-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={customFlagText}
                  onChange={(e) => setCustomFlagText(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && customFlagText.trim()) {
                      e.preventDefault();
                      await handleLinkFlagToTicket(headerPopover.ticketId, customFlagText.trim());
                    }
                  }}
                  placeholder="Type flag name..."
                  autoFocus
                  className="w-full px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-accent)] rounded-lg text-xs font-mono text-purple-900 dark:text-purple-200 placeholder-purple-400/50 focus:outline-none focus:border-purple-500"
                />
              </div>

              {customFlagText.trim() && !allFeatureFlags.some((ff) => ff.name === customFlagText.trim()) && (
                <button
                  type="button"
                  onClick={async () => {
                    await handleLinkFlagToTicket(headerPopover.ticketId, customFlagText.trim());
                  }}
                  className="w-full text-left px-2 py-1 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 flex items-center gap-1.5 font-mono transition-colors cursor-pointer border border-emerald-200 dark:border-emerald-500/30"
                >
                  <Plus size={11} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">Link "{customFlagText.trim()}"</span>
                </button>
              )}

              <div className="max-h-36 overflow-y-auto space-y-0.5 pt-0.5">
                {allFeatureFlags
                  .filter((ff) => {
                    const ticketMeta = metasMap[headerPopover.ticketId];
                    if (!ticketMeta) return true;
                    const ticketProj = getProjectDescriptor(ticketMeta.projectId ?? ticketMeta.project);
                    return ticketProj ? ff.projectId === ticketProj.id : true;
                  })
                  .map((ff) => (
                    <button
                      key={ff.name}
                      type="button"
                      onClick={async () => {
                        await handleLinkFlagToTicket(headerPopover.ticketId, ff.name);
                      }}
                      className="w-full text-left px-2 py-1 rounded-lg text-xs text-purple-900 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/20 flex items-center gap-1.5 font-mono transition-colors cursor-pointer"
                    >
                      <Flag size={11} className="text-purple-600 dark:text-purple-400 shrink-0" />
                      <span className="truncate">{ff.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Popover: Project Picker */}
          {headerPopover.type === 'project' && (
            <div className="space-y-1 w-48">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Set Project
              </div>
              {availableProjects.map((proj) => {
                const currentMeta = metasMap[headerPopover.ticketId];
                const currentDesc = getProjectDescriptor(currentMeta?.projectId ?? currentMeta?.project);
                const isSelected = currentDesc ? currentDesc.id === proj.id : false;
                return (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={async () => {
                      const ticketId = headerPopover.ticketId;
                      setHeaderPopover(null);
                      try {
                        await activePlanningProvider.updateMeta(ticketId, { projectId: proj.id, project: proj.name });
                        setMetasMap((prev) => ({
                          ...prev,
                          [ticketId]: { ...prev[ticketId], projectId: proj.id, project: proj.name },
                        }));
                      } catch (err) {
                        console.error('Failed to update project:', err);
                      }
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-[var(--accent-bg-subtle)] flex items-center justify-between font-mono transition-colors cursor-pointer ${
                      isSelected ? 'bg-[var(--accent-bg-subtle)] text-[var(--accent-primary)] font-bold' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${proj.colors.dot}`} />
                      <span>{proj.name}</span>
                    </div>
                    {isSelected && <Check size={12} className="text-sky-600 dark:text-indigo-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Popover 3: Category Picker */}
          {headerPopover.type === 'category' && (
            <div className="space-y-1 w-44">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Set Type
              </div>
              {(['Feature', 'Platform', 'Tools', 'Idea', 'Bug'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={async () => {
                    const ticketId = headerPopover.ticketId;
                    setHeaderPopover(null);
                    try {
                      await activePlanningProvider.updateMeta(ticketId, { type: cat as any, category: cat as any });
                      setMetasMap((prev) => ({
                        ...prev,
                        [ticketId]: { ...prev[ticketId], type: cat as any, category: cat as any },
                        [ticketId]: { ...prev[ticketId], type: cat as any, category: cat as any },
                      }));
                    } catch (err) {
                      console.error('Failed to update category:', err);
                    }
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)] flex items-center gap-2 font-mono transition-colors cursor-pointer"
                >
                  <Tag
                    size={12}
                    className={
                      cat === 'Bug'
                        ? 'text-rose-600 dark:text-rose-400'
                        : cat === 'Idea'
                        ? 'text-amber-600 dark:text-amber-400'
                        : cat === 'Tools'
                        ? 'text-purple-600 dark:text-purple-400'
                        : cat === 'Platform'
                        ? 'text-cyan-600 dark:text-cyan-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }
                  />
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Popover 4: Complexity Picker */}
          {headerPopover.type === 'complexity' && (
            <div className="space-y-1 w-44">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Set Complexity
              </div>
              {['Low', 'Low-Medium', 'Medium', 'High', 'Medium-High'].map((comp) => (
                <button
                  key={comp}
                  type="button"
                  onClick={async () => {
                    const ticketId = headerPopover.ticketId;
                    setHeaderPopover(null);
                    try {
                      await activePlanningProvider.updateMeta(ticketId, { complexity: comp });
                      setMetasMap((prev) => ({
                        ...prev,
                        [ticketId]: { ...prev[ticketId], complexity: comp },
                      }));
                    } catch (err) {
                      console.error('Failed to update complexity:', err);
                    }
                  }}
                  className={`w-full text-left px-2.5 py-1 rounded-lg text-xs font-mono font-semibold flex items-center justify-between transition-colors cursor-pointer border ${getComplexityBadgeColor(
                    comp
                  )} hover:brightness-105`}
                >
                  <div className="flex items-center gap-1.5">
                    <Zap size={11} className="shrink-0" />
                    <span>{comp}</span>
                  </div>
                  {(metasMap[headerPopover.ticketId]?.complexity || 'Medium') === comp && (
                    <Check size={12} className="shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Popover: Priority Picker */}
          {headerPopover.type === 'priority' && (
            <div className="space-y-1 w-44">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Set Priority
              </div>
              {PRIORITIES.map((prio) => {
                const conf = PRIORITY_CONFIG[prio];
                const currentPrio = metasMap[headerPopover.ticketId]?.priority;
                const isSelected = currentPrio === prio;
                return (
                  <button
                    key={prio}
                    type="button"
                    onClick={async () => {
                      const ticketId = headerPopover.ticketId;
                      setHeaderPopover(null);
                      try {
                        await activePlanningProvider.updateMeta(ticketId, { priority: prio });
                        setMetasMap((prev) => ({
                          ...prev,
                          [ticketId]: { ...prev[ticketId], priority: prio },
                        }));
                      } catch (err) {
                        console.error('Failed to update priority:', err);
                      }
                    }}
                    className={`w-full text-left px-2.5 py-1 rounded-lg text-xs font-mono font-semibold flex items-center justify-between transition-colors cursor-pointer border ${conf.border} ${conf.bg} ${conf.text} hover:brightness-105`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${conf.dot}`} />
                      <span>{prio}</span>
                    </div>
                    {isSelected && <Check size={12} className="shrink-0" />}
                  </button>
                );
              })}
              <div className="pt-1 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={async () => {
                    const ticketId = headerPopover.ticketId;
                    setHeaderPopover(null);
                    try {
                      await activePlanningProvider.updateMeta(ticketId, { priority: null as any });
                      setMetasMap((prev) => {
                        const copy = { ...prev[ticketId] };
                        delete copy.priority;
                        return { ...prev, [ticketId]: copy };
                      });
                    } catch (err) {
                      console.error('Failed to clear priority:', err);
                    }
                  }}
                  className="w-full text-left px-2.5 py-1 rounded-lg text-xs font-mono text-[var(--text-muted)] hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <XCircle size={11} className="shrink-0" />
                  <span>Clear Priority</span>
                </button>
              </div>
            </div>
          )}

          {/* Popover 5: Status Picker */}
          {headerPopover.type === 'status' && (
            <div className="space-y-1 w-44">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Set Status
              </div>
              {[
                { status: 'Planned', label: 'Planned', icon: Clock, color: 'text-[var(--text-muted)]' },
                { status: 'In Development', label: 'In Development', icon: ArrowRight, color: 'text-emerald-700 dark:text-emerald-400' },
                { status: 'Completed', label: 'Completed', icon: Check, color: 'text-emerald-700 dark:text-emerald-400' },
                { status: 'Rejected', label: 'Rejected', icon: XCircle, color: 'text-rose-700 dark:text-rose-400' },
              ].map((item) => (
                <button
                  key={item.status}
                  type="button"
                  onClick={async () => {
                    const ticketId = headerPopover.ticketId;
                    setHeaderPopover(null);
                    try {
                      const updatedMeta = await activePlanningProvider.updateMeta(ticketId, {
                        status: item.status as 'Planned' | 'In Development' | 'Completed' | 'Rejected',
                      });
                      setMetasMap((prev) => ({
                        ...prev,
                        [ticketId]: updatedMeta,
                      }));
                    } catch (err) {
                      console.error('Failed to update status:', err);
                    }
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)] flex items-center justify-between font-mono transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <item.icon size={12} className={item.color} />
                    <span>{item.label}</span>
                  </div>
                  {(metasMap[headerPopover.ticketId]?.status || 'Planned') === item.status && (
                    <Check size={12} className="shrink-0 text-sky-600 dark:text-indigo-400" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Popover 6: Project Picker */}
          {headerPopover.type === 'project' && (
            <div className="space-y-1 w-48">
              <div className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                Set Project
              </div>
              {availableProjects.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={async () => {
                    const ticketId = headerPopover.ticketId;
                    setHeaderPopover(null);
                    try {
                      const updatedMeta = await activePlanningProvider.updateMeta(ticketId, {
                        projectId: proj.id,
                        project: proj.code,
                      });
                      setMetasMap((prev) => ({
                        ...prev,
                        [ticketId]: updatedMeta,
                      }));
                    } catch (err) {
                      console.error('Failed to update project:', err);
                    }
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center justify-between transition-colors cursor-pointer border ${proj.colors.badge} hover:brightness-125`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${proj.colors.dot} shrink-0`} />
                    <span>{proj.name}</span>
                  </div>
                  {getProjectDescriptor(metasMap[headerPopover.ticketId]?.projectId ?? metasMap[headerPopover.ticketId]?.project)?.id === proj.id && (
                    <Check size={12} className="shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Ticket Modal */}
      <CreateTicketModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        defaultAuthor={researcherUsername || 'Developer'}
        defaultProject={projectFilter !== 'all' ? projectFilter : undefined}
        availableProjects={availableProjects}
        isEmbedded={isEmbedded}
        onCreated={(newTicketId, newMeta) => {
          setMetasMap((prev) => ({
            ...prev,
            [newTicketId]: newMeta,
          }));
          setExpandedFeatureId(`feature-${newTicketId}`);
        }}
      />

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
        onCreated={(proj) => setProjectFilter(String(proj.id))}
      />

      {/* Project Settings Modal */}
      <ProjectSettingsModal
        isOpen={isProjectSettingsOpen}
        onClose={() => {
          setIsProjectSettingsOpen(false);
          setSelectedSettingsProjectCode(null);
        }}
        project={activeSettingsProject}
        availableProjects={availableProjects}
        onSelectProject={(proj) => setSelectedSettingsProjectCode(proj.code)}
        onUpdated={(updatedProj, renamedCode) => {
          setAvailableProjects((prev) => {
            const oldCode = renamedCode?.oldCode?.toLowerCase() || updatedProj.code.toLowerCase();
            const exists = prev.some((p) => p.code.toLowerCase() === oldCode);
            if (exists) {
              return prev.map((p) => (p.code.toLowerCase() === oldCode ? updatedProj : p));
            }
            return [...prev, updatedProj];
          });

          const currentDynamic = getRuntimeProjects();
          const oldCode = renamedCode?.oldCode?.toLowerCase() || updatedProj.code.toLowerCase();
          const nextDynamic = currentDynamic.map((p) => (p.code.toLowerCase() === oldCode ? updatedProj : p));
          setRuntimeProjects(nextDynamic);

          if (renamedCode) {
            setProjectFilter(renamedCode.newCode);
            try {
              sessionStorage.setItem('dev_plan_project_filter', renamedCode.newCode);
              localStorage.setItem('dev_plan_project_filter', renamedCode.newCode);
              updateProjectUrlSearchParam(renamedCode.newCode, isEmbedded);
            } catch (e) {}

            setMetasMap((prev) => {
              const next = { ...prev };
              for (const [k, meta] of Object.entries(next)) {
                if (meta.project?.toLowerCase() === renamedCode.oldCode.toLowerCase()) {
                  next[k] = { ...meta, project: renamedCode.newCode };
                }
              }
              return next;
            });
          }
        }}
      />

      {/* Milestone Modal */}
      <MilestoneModal
        isOpen={isMilestoneModalOpen}
        onClose={() => {
          setIsMilestoneModalOpen(false);
          setEditingMilestone(null);
        }}
        onSaved={loadMilestones}
        editingMilestone={editingMilestone}
        defaultProjectCode={projectFilter === 'all' ? (availableProjects[0]?.code || '') : projectFilter}
        availableProjects={availableProjects}
      />

      {/* Ticket Types & Planning Reference Modal */}
      <TicketHelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />

      {/* Ticket Linking Modal */}
      {linkingTicket && (
        <LinkTicketModal
          isOpen={Boolean(linkingTicket)}
          onClose={() => setLinkingTicket(null)}
          sourceTicket={linkingTicket}
          availableTickets={parsedData.plannedFeatures}
          onLinked={() => {
            handleRefresh();
          }}
        />
      )}
    </div>
    </div>
  );
}
