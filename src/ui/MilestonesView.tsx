import React, { useState, useMemo } from 'react';
import { Milestone as MilestoneIcon, Plus, Flag, Calendar, Check, Trash2, Edit3, ArrowRight, CheckCircle2, Clock, Filter, Lock } from 'lucide-react';
import { Milestone, MilestoneStatus, PlannedFeature, TicketMeta, ProjectDescriptor, ALL_PROJECTS } from './types';
import { activePlanningProvider } from './planningClient';

interface MilestonesViewProps {
  milestones: Milestone[];
  plannedFeatures: PlannedFeature[];
  metasMap: Record<string, TicketMeta>;
  projectFilter: string;
  isOwner: boolean;
  onOpenCreateMilestone: () => void;
  onEditMilestone: (milestone: Milestone) => void;
  onMilestonesChanged: () => void;
  onSelectTicket: (ticketId: string) => void;
  onSelectMilestone?: (milestoneTitle: string, milestoneProject?: string) => void;
  availableProjects?: ProjectDescriptor[];
  isEmbedded?: boolean;
  allowedProjects?: string[];
}

const matchMilestone = (ticketMs: string | undefined, ticketProj: string | undefined, m: Milestone): boolean => {
  if (!ticketMs) return false;
  const clean = ticketMs.trim();
  const lower = clean.toLowerCase();
  const mTitleLower = m.title.toLowerCase();
  const mIdStr = String(m.id);
  const mProjLower = m.project.toLowerCase();

  // 1. Compound syntax: "Project:Title" or "Project:Id"
  const colonIdx = clean.indexOf(':');
  if (colonIdx > 0) {
    const projPrefix = clean.substring(0, colonIdx).trim().toLowerCase();
    const key = clean.substring(colonIdx + 1).trim().toLowerCase();
    if (projPrefix === mProjLower) {
      return key === mTitleLower || key === mIdStr.toLowerCase();
    }
    return false;
  }

  // 2. Same project: can match title or numeric ID
  if (ticketProj && ticketProj.toLowerCase() === mProjLower) {
    return lower === mTitleLower || lower === mIdStr.toLowerCase();
  }

  // 3. Cross-project without prefix: match title if identical
  if (lower === mTitleLower) {
    return true;
  }

  return false;
};

const isTicketAuthorized = (
  ticketProj?: string,
  availableProjects?: ProjectDescriptor[],
  allowedProjects?: string[],
  isEmbedded?: boolean
): boolean => {
  if (!isEmbedded && (!allowedProjects || allowedProjects.length === 0 || allowedProjects.includes('*'))) {
    return true;
  }
  if (!ticketProj) return true;
  const pCode = ticketProj.trim().toUpperCase();

  if (availableProjects && availableProjects.length > 0) {
    if (availableProjects.some((p) => p.code.toUpperCase() === pCode)) {
      return true;
    }
  }

  if (allowedProjects && allowedProjects.length > 0 && !allowedProjects.includes('*')) {
    return allowedProjects.some((a) => a.trim().toUpperCase() === pCode);
  }

  return !isEmbedded;
};

const STATUS_BADGES: Record<MilestoneStatus, { bg: string; text: string; border: string }> = {
  Planned: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-500/30',
  },
  Active: {
    bg: 'bg-indigo-500/15',
    text: 'text-indigo-700 dark:text-indigo-300 font-semibold',
    border: 'border-indigo-500/40',
  },
  Completed: {
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300 font-semibold',
    border: 'border-emerald-500/40',
  },
  Closed: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-500/30',
  },
};

export const MilestonesView: React.FC<MilestonesViewProps> = ({
  milestones,
  plannedFeatures,
  metasMap,
  projectFilter,
  isOwner,
  onOpenCreateMilestone,
  onEditMilestone,
  onMilestonesChanged,
  onSelectTicket,
  onSelectMilestone,
  availableProjects = ALL_PROJECTS,
  isEmbedded = false,
  allowedProjects,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredMilestones = useMemo(() => {
    return milestones.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = m.title.toLowerCase().includes(q);
        const matchDesc = m.description?.toLowerCase().includes(q);
        const matchFlag = m.featureFlag?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchFlag) return false;
      }
      return true;
    });
  }, [milestones, statusFilter, searchQuery]);

  const handleDelete = async (milestone: Milestone) => {
    if (!activePlanningProvider.deleteMilestone) return;
    const confirmDelete = window.confirm(`Are you sure you want to delete milestone "${milestone.title}"?`);
    if (!confirmDelete) return;

    try {
      await activePlanningProvider.deleteMilestone(milestone.id, milestone.project);
      onMilestonesChanged();
    } catch (err: any) {
      console.error('Failed to delete milestone:', err);
      alert(err.message || 'Failed to delete milestone');
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
      {/* Strategy Banner */}
      <div className="p-4 bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] rounded-2xl text-xs text-slate-800 dark:text-indigo-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-bold text-sky-950 dark:text-indigo-300 text-sm flex items-center gap-2">
            <MilestoneIcon size={16} />
            Milestone Deliverables & Umbrella Flags
          </h3>
          <p>
            Milestones group related tickets toward target deliverables. Milestones can optionally link to an umbrella feature flag, which automatically propagates to all tickets in the milestone unless individually overridden.
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={onOpenCreateMilestone}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all cursor-pointer shrink-0"
          >
            <Plus size={14} />
            <span>New Milestone</span>
          </button>
        )}
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono text-[var(--text-muted)] font-semibold">Filter:</span>
          <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5 text-[11px]">
            {['all', 'Active', 'Planned', 'Completed', 'Closed'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {st === 'all' ? 'All' : st}
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search milestones..."
          className="px-2.5 py-1 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none w-48"
        />
      </div>

      {/* Milestones Grid / List */}
      {filteredMilestones.length === 0 ? (
        <div className="p-8 text-center bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl">
          <MilestoneIcon size={28} className="mx-auto text-[var(--text-muted)] dark:text-slate-600 mb-2" />
          <div className="text-sm font-semibold text-[var(--text-secondary)]">No Milestones Found</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {projectFilter === 'all'
              ? 'No milestones have been defined yet.'
              : `No milestones defined for ${projectFilter}.`}
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={onOpenCreateMilestone}
              className="mt-4 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>Create First Milestone</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
          {filteredMilestones.map((m) => {
            const milestoneTickets = plannedFeatures.filter((f) => {
              const ticketProject = metasMap[f.ticketId]?.project || f.project;
              const ticketMs = metasMap[f.ticketId]?.milestone || f.milestone;
              return matchMilestone(ticketMs, ticketProject, m);
            });
            const completedCount = milestoneTickets.filter(
              (f) => (metasMap[f.ticketId]?.status || f.status) === 'Completed' || f.isCompleted
            ).length;
            const totalCount = milestoneTickets.length;
            const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
            const statusConfig = STATUS_BADGES[m.status] || STATUS_BADGES.Planned;
            const projectDesc = availableProjects.find((p) => p.code.toUpperCase() === m.project.toUpperCase());

            return (
              <div
                key={`${m.project}-${m.id}`}
                className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl space-y-3 flex flex-col justify-between shadow-xs hover:border-[var(--border-accent)] transition-colors"
              >
                <div className="space-y-2">
                  {/* Top Bar: Title + Badges + Actions */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onSelectMilestone?.(m.title, m.project)}
                          className="font-bold text-[var(--text-primary)] text-sm truncate flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer group text-left"
                          title={`Filter roadmap tickets by milestone "${m.title}"`}
                        >
                          <MilestoneIcon size={14} className="text-indigo-500 shrink-0 group-hover:scale-110 transition-transform" />
                          <span className="group-hover:underline underline-offset-2">{m.title}</span>
                        </button>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                          {m.status}
                        </span>
                        {projectFilter === 'all' && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] font-bold">
                            {projectDesc?.code || m.project}
                          </span>
                        )}
                      </div>

                      {/* Umbrella Feature Flag Badge & Target Date */}
                      <div className="flex items-center gap-2 flex-wrap text-[11px]">
                        {m.featureFlag && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30 font-semibold" title="Umbrella feature flag inherited by all tickets in this milestone">
                            <Flag size={10} className="text-purple-500" />
                            <span>Flag: {m.featureFlag}</span>
                          </span>
                        )}
                        {m.targetDate && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)]">
                            <Calendar size={10} />
                            <span>Target: {m.targetDate}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectMilestone?.(m.title, m.project)}
                        className="p-1.5 text-[var(--text-muted)] hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors cursor-pointer"
                        title={`Filter roadmap tickets by milestone "${m.title}"`}
                      >
                        <Filter size={13} />
                      </button>
                      {isOwner && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEditMilestone(m)}
                            className="p-1.5 text-[var(--text-muted)] hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Edit Milestone"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(m)}
                            className="p-1.5 text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Delete Milestone"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  {m.description && (
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {m.description}
                    </p>
                  )}

                  {/* Progress Bar */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <button
                        type="button"
                        onClick={() => onSelectMilestone?.(m.title, m.project)}
                        className="text-[var(--text-muted)] hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer hover:underline text-left"
                        title={`Filter roadmap tickets by milestone "${m.title}"`}
                      >
                        {completedCount} of {totalCount} tickets done
                      </button>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        {progressPct}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Linked Tickets List */}
                {milestoneTickets.length > 0 && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                    <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider block">
                      Assigned Tickets ({milestoneTickets.length}):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {milestoneTickets.map((t) => {
                        const ticketProj = metasMap[t.ticketId]?.project || t.project;
                        const authorized = isTicketAuthorized(ticketProj, availableProjects, allowedProjects, isEmbedded);
                        const isDone = (metasMap[t.ticketId]?.status || t.status) === 'Completed' || t.isCompleted;

                        if (!authorized) {
                          return (
                            <div
                              key={t.ticketId}
                              className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono flex items-center gap-1 select-none max-w-full cursor-not-allowed ${
                                isDone
                                  ? 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20 line-through opacity-70'
                                  : 'bg-[var(--bg-input)] text-[var(--text-muted)] border-[var(--border-subtle)] opacity-75'
                              }`}
                              title="External ticket from a project outside this workspace's allowed scope."
                            >
                              <Lock size={10} className="text-amber-500/80 shrink-0" />
                              {isDone && <Check size={10} className="text-emerald-500/70 shrink-0" />}
                              <span className="truncate italic">[Restricted Project]</span>
                            </div>
                          );
                        }

                        const displayKey =
                          ticketProj && m.project && ticketProj.toUpperCase() !== m.project.toUpperCase()
                            ? `${ticketProj}-${t.number}`
                            : `#${t.number}`;

                        return (
                          <button
                            key={t.ticketId}
                            type="button"
                            onClick={() => onSelectTicket(t.ticketId)}
                            className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer max-w-full ${
                              isDone
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 line-through opacity-80'
                                : 'bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-indigo-500/40'
                            }`}
                            title={`Jump to Ticket ${displayKey}: ${t.title}`}
                          >
                            {isDone ? (
                              <Check size={10} className="text-emerald-500 shrink-0" />
                            ) : (
                              <ArrowRight size={10} className="text-indigo-500 shrink-0" />
                            )}
                            <span className="truncate max-w-full">{displayKey} {t.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
