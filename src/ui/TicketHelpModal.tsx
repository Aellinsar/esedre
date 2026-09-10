import React, { useEffect } from 'react';
import { X, HelpCircle, Layers, CheckCircle2, Clock, Sparkles, AlertCircle, Wrench, Bug, Lightbulb, Cpu, ShieldCheck, Info } from 'lucide-react';

interface TicketHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TypeHelpItem {
  name: string;
  badgeClass: string;
  icon: React.ReactNode;
  summary: string;
  scope: string;
}

const TYPES: TypeHelpItem[] = [
  {
    name: 'Feature',
    badgeClass: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    icon: <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400" />,
    summary: 'User-facing gameplay features, UI screens, calculators, and research tools.',
    scope: 'Enhancements that players interact with directly during day-to-day gameplay.',
  },
  {
    name: 'Platform',
    badgeClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    icon: <Cpu size={14} className="text-cyan-600 dark:text-cyan-400" />,
    summary: 'Core architecture, database/storage layers, schema migrations, CI/CD, and security.',
    scope: 'Foundational infrastructure that powers reliability, speed, and cross-project modularity.',
  },
  {
    name: 'Tools',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: <Wrench size={14} className="text-amber-600 dark:text-amber-400" />,
    summary: 'Build tools, developer options, inspection utilities, benchmarks, test suites, and LLM agent skills.',
    scope: 'Internal tooling that accelerates developer workflows and pairs with LLM coding partners.',
  },
  {
    name: 'Idea',
    badgeClass: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
    icon: <Lightbulb size={14} className="text-purple-600 dark:text-purple-400" />,
    summary: 'Exploratory concepts, RFCs, and brainstorming proposals.',
    scope: 'Early-stage proposals requiring architectural definition or review before scheduling.',
  },
  {
    name: 'Bug',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: <Bug size={14} className="text-rose-600 dark:text-rose-400" />,
    summary: 'Defect fixes, visual regression repairs, and calculation corrections.',
    scope: 'Resolving broken functionality, layout clipping, or unexpected application crashes.',
  },
];

const STATUSES = [
  {
    name: 'Planned',
    color: 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
    description: 'Backlog ticket queued for future active planning and development.',
  },
  {
    name: 'In Development',
    color: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold',
    description: 'Actively being designed, developed, or verified by a developer or LLM agent.',
  },
  {
    name: 'Completed',
    color: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold',
    description: 'Shipped to production and verified against all automated test suites.',
  },
  {
    name: 'Rejected',
    color: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold',
    description: 'Dismissed or superseded proposal (preserved for historical traceability).',
  },
];

const COMPLEXITIES = [
  { level: 'Low / Small', hours: '0.5 – 2.0 hrs', desc: 'Single-component tweaks, localized CSS fixes, configuration updates.' },
  { level: 'Medium', hours: '2.0 – 5.0 hrs', desc: 'New modal dialogs, service integrations, multi-file refactoring.' },
  { level: 'High / Large', hours: '5.0 – 12.0+ hrs', desc: 'Architectural decoupling, dual-storage engines, major data migrations.' },
];

export const TicketHelpModal: React.FC<TicketHelpModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="ticket-help-modal-overlay"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        id="ticket-help-modal-container"
        className="w-full max-w-2xl max-h-[90vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col text-[var(--text-primary)] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[var(--bg-surface-elevated)] p-4 sm:p-5 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] flex items-center justify-center text-[var(--accent-primary)] shadow-inner shrink-0">
              <HelpCircle size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                Help & About
              </h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                Standard taxonomy, lifecycle workflows, sizing guidelines, and license disclosures
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--accent-bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl transition-colors cursor-pointer"
            aria-label="Close Help Modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6 text-xs leading-relaxed">
          {/* Section 1: Categories / Types */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers size={15} className="text-[var(--accent-primary)]" />
              <h4 className="font-bold text-sm text-[var(--text-primary)]">
                Ticket Types (Types)
              </h4>
            </div>
            <div className="space-y-2.5">
              {TYPES.map((cat) => (
                <div
                  key={cat.name}
                  className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border ${cat.badgeClass}`}>
                        {cat.icon}
                        {cat.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                      {cat.scope}
                    </span>
                  </div>
                  <p className="text-[var(--text-secondary)] text-[11px]">
                    {cat.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Lifecycle Statuses */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={15} className="text-[var(--accent-primary)]" />
              <h4 className="font-bold text-sm text-[var(--text-primary)]">
                Lifecycle Statuses
              </h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {STATUSES.map((st) => (
                <div
                  key={st.name}
                  className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] space-y-1"
                >
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${st.color}`}>
                    {st.name}
                  </span>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    {st.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Sizing & Effort */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={15} className="text-[var(--accent-primary)]" />
              <h4 className="font-bold text-sm text-[var(--text-primary)]">
                Complexity & Effort Guidelines
              </h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {COMPLEXITIES.map((c) => (
                <div
                  key={c.level}
                  className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--text-primary)] text-xs">{c.level}</span>
                    <span className="text-[10px] font-mono font-bold text-[var(--accent-primary)]">{c.hours}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {c.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Best Practices */}
          <div className="p-3 bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] rounded-xl space-y-1 text-[11px] text-[var(--text-secondary)]">
            <div className="flex items-center gap-1.5 text-[var(--accent-primary)] font-bold">
              <ShieldCheck size={14} />
              <span>Invariants & Agent Pairing Best Practices</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[var(--text-secondary)] text-[10px] sm:text-[11px]">
              <li><strong>Title Limit</strong>: Keep ticket titles strictly $\le 48$ characters (`MAX_TICKET_TITLE_LENGTH = 48`).</li>
              <li><strong>Summary</strong>: Write a clean 1–2 sentence elevator pitch explaining user benefit and motivation.</li>
              <li><strong>Breakdown</strong>: Use clear numbered bullet points for feature requirements to guide implementation plans.</li>
            </ul>
          </div>

          {/* Section 5: About & Open Source Licenses */}
          <div className="pt-2 border-t border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center gap-2">
              <Info size={15} className="text-[var(--accent-primary)]" />
              <h4 className="font-bold text-sm text-[var(--text-primary)]">
                About & License Declarations
              </h4>
            </div>

            <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] space-y-3 text-[11px] text-[var(--text-secondary)]">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-[var(--text-primary)] text-xs">Developer Planning & Ticketing Platform</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono ml-2">v0.1.0</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  MIT License
                </span>
              </div>
              <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed">
                Autonomous developer roadmap, ticketing engine, and Model Context Protocol (MCP) server for developers and LLM coding partners.
              </p>

              <div className="pt-2.5 border-t border-[var(--border-subtle)] space-y-2">
                <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
                  Third-Party Component & Library Disclosures
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] shadow-xs">
                    <span className="text-[var(--text-primary)] font-medium">React & ReactDOM</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">MIT</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] shadow-xs">
                    <span className="text-[var(--text-primary)] font-medium">Lucide React</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">ISC</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] shadow-xs">
                    <span className="text-[var(--text-primary)] font-medium">Node.js Standard Lib</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">MIT / BSD</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] shadow-xs">
                    <span className="text-[var(--text-primary)] font-medium">TypeScript & Vite</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Apache-2.0 / MIT</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[var(--bg-surface-elevated)] px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--accent-primary)] hover:brightness-110 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-sm"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
