import React, { useState, useEffect } from 'react';
import { X, Milestone as MilestoneIcon, Flag, Calendar, FileText, FolderKanban, Check } from 'lucide-react';
import { Milestone, MilestoneStatus, CreateMilestoneInput, UpdateMilestoneInput, ProjectDescriptor, ALL_PROJECTS } from './types';
import { activePlanningProvider } from './planningClient';

interface MilestoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (milestone: Milestone) => void;
  editingMilestone?: Milestone | null;
  defaultProjectCode?: string;
  availableProjects?: ProjectDescriptor[];
}

const MILESTONE_STATUSES: MilestoneStatus[] = ['Planned', 'Active', 'Completed', 'Closed'];

export const MilestoneModal: React.FC<MilestoneModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  editingMilestone,
  defaultProjectCode,
  availableProjects = ALL_PROJECTS,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectCode, setProjectCode] = useState(defaultProjectCode || (availableProjects[0]?.code || ''));
  const [status, setStatus] = useState<MilestoneStatus>('Planned');
  const [featureFlag, setFeatureFlag] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingMilestone) {
      setTitle(editingMilestone.title || '');
      setDescription(editingMilestone.description || '');
      setProjectCode(editingMilestone.project || defaultProjectCode || '');
      setStatus(editingMilestone.status || 'Planned');
      setFeatureFlag(editingMilestone.featureFlag || '');
      setTargetDate(editingMilestone.targetDate || '');
    } else {
      setTitle('');
      setDescription('');
      setProjectCode(defaultProjectCode && defaultProjectCode !== 'all' ? defaultProjectCode : (availableProjects[0]?.code || ''));
      setStatus('Planned');
      setFeatureFlag('');
      setTargetDate('');
    }
    setErrorMsg(null);
  }, [editingMilestone, defaultProjectCode, availableProjects, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Milestone title is required.');
      return;
    }
    if (!projectCode) {
      setErrorMsg('Project is required.');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      if (editingMilestone) {
        if (!activePlanningProvider.updateMilestone) {
          throw new Error('Milestone updates not supported by active provider');
        }
        const updated = await activePlanningProvider.updateMilestone(
          editingMilestone.id,
          {
            title: title.trim(),
            description: description.trim() || undefined,
            status,
            featureFlag: featureFlag.trim() || null,
            targetDate: targetDate.trim() || null,
          },
          projectCode
        );
        setIsSubmitting(false);
        onSaved(updated);
        onClose();
      } else {
        if (!activePlanningProvider.createMilestone) {
          throw new Error('Milestone creation not supported by active provider');
        }
        const created = await activePlanningProvider.createMilestone({
          projectCode,
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          featureFlag: featureFlag.trim() || undefined,
          targetDate: targetDate.trim() || undefined,
        });
        setIsSubmitting(false);
        onSaved(created);
        onClose();
      }
    } catch (err: any) {
      console.error('Failed to save milestone:', err);
      setErrorMsg(err.message || 'Failed to save milestone');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-500/20">
              <MilestoneIcon size={18} />
            </div>
            <div>
              <h3 className="font-bold text-[var(--text-primary)] text-sm">
                {editingMilestone ? 'Edit Milestone' : 'Create New Milestone'}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                Organize deliverables with optional umbrella feature flags
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <FileText size={13} className="text-indigo-500" /> Milestone Title *
            </label>
            <input
              type="text"
              value={title}
              maxLength={64}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. v2.0 Release / Public Launch"
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              required
            />
          </div>

          {/* Project & Status Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <FolderKanban size={13} className="text-indigo-500" /> Project
              </label>
              <select
                value={projectCode}
                disabled={!!editingMilestone}
                onChange={(e) => setProjectCode(e.target.value)}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] focus:outline-none disabled:opacity-60"
              >
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.code} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Check size={13} className="text-indigo-500" /> Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] focus:outline-none"
              >
                {MILESTONE_STATUSES.map((st) => (
                  <option key={st} value={st} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Optional Umbrella Feature Flag & Target Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Flag size={13} className="text-purple-400" /> Umbrella Feature Flag (Optional)
              </label>
              <input
                type="text"
                value={featureFlag}
                onChange={(e) => setFeatureFlag(e.target.value)}
                placeholder="e.g. v2_redesign"
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-purple-500/50 rounded-xl text-xs text-purple-700 dark:text-purple-300 placeholder-[var(--text-muted)] focus:outline-none"
              />
              <span className="text-[10px] text-[var(--text-muted)] leading-tight block">
                Inherited by all tickets in this milestone unless individually overridden.
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Calendar size={13} className="text-indigo-500" /> Target Date (Optional)
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] focus:outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-primary)]">Description / Scope</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Outline the scope, goals, and release criteria for this milestone..."
              rows={3}
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-indigo-500/50 rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-y"
            />
          </div>

          {/* Footer Controls */}
          <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-[var(--bg-input)] hover:bg-[var(--accent-bg-subtle)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : editingMilestone ? 'Save Changes' : 'Create Milestone'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
