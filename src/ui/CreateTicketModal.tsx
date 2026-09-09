import { ConfirmationModal } from './ConfirmationModal';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, Plus, HelpCircle, User, Tag, Zap, FileText, CheckCircle2, Flag, FolderKanban } from 'lucide-react';
import { activePlanningProvider } from './planningClient';
import { TicketMeta, TicketType, TicketCategory, ProjectName, ALL_PROJECTS, getProjectDescriptor, getProjectById, ProjectDescriptor } from './types';
import { CreateProjectModal } from './CreateProjectModal';
import { TicketHelpModal } from './TicketHelpModal';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (ticketId: string, meta: TicketMeta) => void;
  defaultAuthor?: string;
  defaultProject?: ProjectName | number;
  availableProjects?: ProjectDescriptor[];
  isEmbedded?: boolean;
}

const PROJECT_FEATURE_FLAGS: Record<number, string[]> = {
  1: ['chat_enhanced', 'evolutions', 'multiple_teams'], // PASRC
  2: ['frontend', 'components', 'styles'], // WEB
  3: ['guides', 'api_reference', 'tutorials'], // DOCS
};

export const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  defaultAuthor = 'Developer',
  defaultProject,
  availableProjects,
  isEmbedded = false,
}) => {
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<number | undefined>(() =>
    defaultProject !== undefined ? getProjectDescriptor(defaultProject)?.id : undefined
  );
  const [type, setType] = useState<TicketType>('Feature');
  const [complexity, setComplexity] = useState('Medium');
  const [featureFlag, setFeatureFlag] = useState('');
  const [rationale, setRationale] = useState('');
  const [breakdown, setBreakdown] = useState('');
  const [openQuestionsText, setOpenQuestionsText] = useState('');
  const [submittedBy, setSubmittedBy] = useState(defaultAuthor);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isConfirmDiscardOpen, setIsConfirmDiscardOpen] = useState(false);

  const hasUnsavedChanges = useMemo(() => {
    return Boolean(
      title.trim() ||
      rationale.trim() ||
      breakdown.trim() ||
      openQuestionsText.trim()
    );
  }, [title, rationale, breakdown, openQuestionsText]);

  const handleRequestClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setIsConfirmDiscardOpen(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isConfirmDiscardOpen) {
          setIsConfirmDiscardOpen(false);
        } else if (isHelpOpen) {
          setIsHelpOpen(false);
        } else if (isCreateProjectOpen) {
          setIsCreateProjectOpen(false);
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConfirmDiscardOpen, isHelpOpen, isCreateProjectOpen, handleRequestClose]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync default project when opening modal
  React.useEffect(() => {
    if (isOpen) {
      setProjectId(defaultProject !== undefined ? getProjectDescriptor(defaultProject)?.id : undefined);
    }
  }, [isOpen, defaultProject]);

  // Reset feature flag if project changes and current flag does not belong to project
  React.useEffect(() => {
    const available = projectId !== undefined ? PROJECT_FEATURE_FLAGS[projectId] || [] : [];
    if (featureFlag && !available.includes(featureFlag)) {
      setFeatureFlag('');
    }
  }, [projectId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Ticket title is required.');
      return;
    }
    if (projectId === undefined) {
      setErrorMsg('Project is required. Please select a project for this ticket.');
      return;
    }
    const targetProject = getProjectById(projectId);
    if (!targetProject) {
      setErrorMsg('Selected project is invalid or not registered.');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const openQuestions = openQuestionsText
        .split('\n')
        .map((q) => q.trim())
        .filter(Boolean);

      const result = await activePlanningProvider.createTicket({
        title: title.trim(),
        projectId: targetProject.id,
        project: targetProject.name,
        type,
        category: type,
        complexity,
        featureFlag: featureFlag || undefined,
        rationale: rationale.trim(),
        breakdown: breakdown.trim(),
        openQuestions,
        submittedBy: submittedBy.trim() || defaultAuthor || 'Developer',
      });

      setIsSubmitting(false);
      onCreated(result.ticketId, result.meta);
      onClose();
    } catch (err: any) {
      console.error('Failed to create ticket:', err);
      setErrorMsg(err.message || 'Failed to create ticket');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      onClick={handleRequestClose}
    >
      <div
        className="relative w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[var(--accent-bg-subtle)] text-[var(--accent-primary)] rounded-xl border border-[var(--accent-border-subtle)]">
              <Plus size={18} />
            </div>
            <div>
              <h3 className="font-bold text-[var(--text-primary)] text-sm">Create New Developer Ticket</h3>
              <p className="text-[11px] text-[var(--text-muted)]">Initialize a new ticket folder with metadata and specification</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg-subtle)] rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-4 flex-1 font-sans bg-[var(--bg-app)]">
          {errorMsg && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-800 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <FileText size={13} className="text-[var(--accent-primary)]" /> Ticket Title *
              </label>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{title.length}/48</span>
            </div>
            <input
              type="text"
              value={title}
              maxLength={48}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Export User Settings & Cloud Backup Sync"
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              required
            />
          </div>

          {/* Project & Category & Complexity & Feature Flag & SubmittedBy Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <FolderKanban size={13} className="text-[var(--accent-primary)]" /> Project
              </label>
              <select
                value={projectId !== undefined ? projectId : ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setIsCreateProjectOpen(true);
                    return;
                  }
                  if (!e.target.value) {
                    setProjectId(undefined);
                    return;
                  }
                  setProjectId(Number(e.target.value));
                }}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] focus:outline-none"
              >
                {projectId === undefined && (
                  <option value="" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Select a Project...</option>
                )}
                {(availableProjects || ALL_PROJECTS).map((p) => (
                  <option key={p.id} value={p.id} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                    {p.code} - {p.name}
                  </option>
                ))}
                {!isEmbedded && (
                  <option value="__new__" className="bg-[var(--bg-surface)] text-cyan-600 dark:text-cyan-400 font-semibold">
                    + New Project...
                  </option>
                )}
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Tag size={13} className="text-[var(--accent-primary)]" /> Type
                </label>
                <button
                  type="button"
                  onClick={() => setIsHelpOpen(true)}
                  className="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors p-0.5 cursor-pointer"
                  title="View Ticket Types Reference"
                  aria-label="View Ticket Types Reference"
                >
                  <HelpCircle size={12} />
                </button>
              </div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TicketType)}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] focus:outline-none"
              >
                <option value="Feature" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Feature</option>
                <option value="Platform" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Platform</option>
                <option value="Tools" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Tools</option>
                <option value="Idea" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Idea</option>
                <option value="Bug" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Bug</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Zap size={13} className="text-[var(--accent-primary)]" /> Complexity
              </label>
              <select
                value={complexity}
                onChange={(e) => setComplexity(e.target.value)}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] focus:outline-none"
              >
                <option value="Low" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Low</option>
                <option value="Low-Medium" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Low-Medium</option>
                <option value="Medium" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">Medium</option>
                <option value="High" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">High</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Flag size={13} className="text-purple-400" /> Feature Flag
              </label>
              <select
                value={featureFlag}
                onChange={(e) => setFeatureFlag(e.target.value)}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-purple-500/50 rounded-xl text-xs text-purple-700 dark:text-purple-300 focus:outline-none"
              >
                <option value="" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">None (Unflagged)</option>
                {(projectId !== undefined ? PROJECT_FEATURE_FLAGS[projectId] || [] : []).map((flag: string) => (
                  <option key={flag} value={flag} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                    {flag}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <User size={13} className="text-[var(--accent-primary)]" /> Submitted By
              </label>
              <input
                type="text"
                value={submittedBy}
                onChange={(e) => setSubmittedBy(e.target.value)}
                placeholder="Developer name"
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] focus:outline-none"
              />
            </div>
          </div>

          {/* Rationale */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-primary)]">Summary / Rationale</label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Explain why this feature is valuable and what problem it solves..."
              rows={3}
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-y"
            />
          </div>

          {/* Feature Breakdown */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-primary)]">Feature Breakdown (One item per line or bullet)</label>
            <textarea
              value={breakdown}
              onChange={(e) => setBreakdown(e.target.value)}
              placeholder="1. Design database storage schema&#10;2. Implement REST API endpoints&#10;3. Add UI components and state management"
              rows={3}
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-y font-mono"
            />
          </div>

          {/* Open Questions */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <HelpCircle size={13} className="text-amber-500 dark:text-amber-400" /> Initial Open Questions (One question per line)
            </label>
            <textarea
              value={openQuestionsText}
              onChange={(e) => setOpenQuestionsText(e.target.value)}
              placeholder="Should credentials be stored locally or synced remotely?&#10;What fallback strategy should be used when offline?"
              rows={2}
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-amber-500/50 rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-y"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={handleRequestClose}
              className="px-3 py-1.5 bg-[var(--bg-surface-elevated)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl text-xs cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-4 py-1.5 bg-[var(--accent-primary)] hover:brightness-110 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-md transition-all"
            >
              <CheckCircle2 size={14} /> {isSubmitting ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>

      <CreateProjectModal
        isOpen={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
        onCreated={(proj) => setProjectId(proj.id)}
      />

      <TicketHelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      <ConfirmationModal
        isOpen={isConfirmDiscardOpen}
        title="Discard Unsaved Ticket?"
        message="You have entered text for this ticket. Are you sure you want to discard your changes? All entered details will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="danger"
        onClose={() => setIsConfirmDiscardOpen(false)}
        onConfirm={() => {
          setIsConfirmDiscardOpen(false);
          onClose();
        }}
      />
    </div>
  );
};
