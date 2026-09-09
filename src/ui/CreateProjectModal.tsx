import { ConfirmationModal } from './ConfirmationModal.js';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, FolderKanban, Plus, FileText, Palette } from 'lucide-react';
import { ProjectDescriptor, ALL_PROJECT_CODES, ALL_PROJECTS } from './types';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: ProjectDescriptor) => void;
}

const PALETTES = [
  { name: 'Cyan', badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300', dot: 'bg-cyan-400', border: 'border-cyan-500/40' },
  { name: 'Indigo', badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300', dot: 'bg-indigo-400', border: 'border-indigo-500/40' },
  { name: 'Emerald', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-500/40' },
  { name: 'Fuchsia', badge: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300', dot: 'bg-fuchsia-400', border: 'border-fuchsia-500/40' },
  { name: 'Amber', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300', dot: 'bg-amber-400', border: 'border-amber-500/40' },
  { name: 'Rose', badge: 'border-rose-500/30 bg-rose-500/10 text-rose-300', dot: 'bg-rose-400', border: 'border-rose-500/40' },
];

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPaletteIdx, setSelectedPaletteIdx] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConfirmDiscardOpen, setIsConfirmDiscardOpen] = useState(false);

  const hasUnsavedChanges = useMemo(() => {
    return Boolean(code.trim() || name.trim() || description.trim());
  }, [code, name, description]);

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
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConfirmDiscardOpen, handleRequestClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode) {
      setErrorMsg('Project code is required.');
      return;
    }
    if (!/^[a-zA-Z0-9]{1,5}$/.test(cleanCode)) {
      setErrorMsg('Project code must be 1 to 5 alphanumeric characters (e.g. CORE, WEB, DOCS).');
      return;
    }
    if (ALL_PROJECT_CODES.some((c) => c.toLowerCase() === cleanCode.toLowerCase())) {
      setErrorMsg(`Project code '${cleanCode}' collides with an existing project (case-insensitive).`);
      return;
    }
    if (!name.trim()) {
      setErrorMsg('Project name is required.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    const colors = PALETTES[selectedPaletteIdx];
    try {
      const res = await fetch('/api/planning/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: cleanCode,
          name: name.trim(),
          description: description.trim() || `${name.trim()} Project`,
          colors,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create project');
      }

      const { project } = await res.json();
      ALL_PROJECTS.push(project);
      ALL_PROJECT_CODES.push(project.code);
      setIsSubmitting(false);
      onCreated(project);
      onClose();
    } catch (err: any) {
      // Fallback in-memory if backend endpoint is unavailable (e.g. static/test)
      const nextId = ALL_PROJECTS.length > 0 ? Math.max(...ALL_PROJECTS.map((p) => p.id)) + 1 : 1;
      const fallbackProj: ProjectDescriptor = {
        id: nextId,
        code: cleanCode,
        slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: name.trim(),
        description: description.trim() || `${name.trim()} Project`,
        colors,
      };
      ALL_PROJECTS.push(fallbackProj);
      ALL_PROJECT_CODES.push(fallbackProj.code);
      setIsSubmitting(false);
      onCreated(fallbackProj);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      onClick={handleRequestClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
              <FolderKanban size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">Add New Project</h2>
              <p className="text-[11px] text-[var(--text-muted)]">Register a project with a 1–4 char code</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          {errorMsg && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Project Code */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <FolderKanban size={13} className="text-[var(--accent-primary)]" /> Project Code *
              </label>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{code.length}/4</span>
            </div>
            <input
              type="text"
              value={code}
              maxLength={4}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              placeholder="e.g. CORE, WEB, DOCS"
              className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs font-mono font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              required
              autoFocus
            />
            <p className="text-[10px] text-[var(--text-muted)]">Strictly 1 to 4 alphanumeric characters.</p>
          </div>

          {/* Project Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <FileText size={13} className="text-[var(--accent-primary)]" /> Project Name *
            </label>
            <input
              type="text"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hablaster Video Game"
              className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-primary)]">Description</label>
            <input
              type="text"
              value={description}
              maxLength={120}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of repository or app"
              className="w-full p-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--border-accent)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
            />
          </div>

          {/* Palette Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Palette size={13} className="text-[var(--accent-primary)]" /> Badge Color Palette
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PALETTES.map((pal, idx) => (
                <button
                  key={pal.name}
                  type="button"
                  onClick={() => setSelectedPaletteIdx(idx)}
                  className={`p-2 rounded-xl border text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${pal.badge} ${
                    selectedPaletteIdx === idx ? 'ring-2 ring-[var(--accent-primary)] shadow-md' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${pal.dot} shrink-0`} />
                  <span>{pal.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={handleRequestClose}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !code.trim() || !name.trim()}
              className="px-3.5 py-1.5 bg-[var(--accent-primary)] hover:brightness-110 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              <Plus size={14} />
              <span>{isSubmitting ? 'Creating...' : 'Create Project'}</span>
            </button>
          </div>
        </form>
      </div>
      <ConfirmationModal
        isOpen={isConfirmDiscardOpen}
        title="Discard Unsaved Project?"
        message="You have entered project details. Are you sure you want to discard your changes?"
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
