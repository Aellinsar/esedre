import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, Settings, FileText, Palette, ShieldAlert, Cpu, Check, AlertCircle } from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal.js';
import {
  ProjectDescriptor,
  PALETTES,
  MAX_PROJECT_CODE_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from './types';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectDescriptor | null;
  availableProjects?: ProjectDescriptor[];
  onSelectProject?: (proj: ProjectDescriptor) => void;
  onUpdated: (updatedProject: ProjectDescriptor, renamedCode?: { oldCode: string; newCode: string }) => void;
}

type SettingsTab = 'general' | 'code' | 'grounding';

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  isOpen,
  onClose,
  project,
  availableProjects,
  onSelectProject,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [guidelinesRef, setGuidelinesRef] = useState('');
  const [techStackStr, setTechStackStr] = useState('');
  const [groundingRulesStr, setGroundingRulesStr] = useState('');
  const [selectedPaletteIdx, setSelectedPaletteIdx] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isConfirmDiscardOpen, setIsConfirmDiscardOpen] = useState(false);
  const [isConfirmRenameCodeOpen, setIsConfirmRenameCodeOpen] = useState(false);
  const [pendingProjectSwitch, setPendingProjectSwitch] = useState<ProjectDescriptor | null>(null);

  const prevOpenRef = React.useRef(false);
  const activeProjectKeyRef = React.useRef<string | null>(null);

  // Initialize form state only when modal opens or active project genuinely changes
  useEffect(() => {
    if (!isOpen || !project) {
      prevOpenRef.current = false;
      return;
    }

    const currentKey = `${project.id ?? ''}:${project.code}`;
    const isNewOpen = !prevOpenRef.current;
    const isDifferentProject = activeProjectKeyRef.current !== currentKey;

    if (isNewOpen || isDifferentProject) {
      prevOpenRef.current = true;
      activeProjectKeyRef.current = currentKey;

      setName(project.name || '');
      setCode(project.code || '');
      setDescription(project.description || '');
      setGuidelinesRef(project.guidelinesRef || 'AGENTS.md');
      
      const techArr = Array.isArray(project.techStack)
        ? project.techStack
        : project.techStack
        ? Object.entries(project.techStack).map(([k, v]) => `${k}: ${v}`)
        : [];
      setTechStackStr(techArr.join(', '));
      
      const rulesArr = project.groundingRules || [];
      setGroundingRulesStr(rulesArr.join('\n'));

      const paletteIdx = PALETTES.findIndex(
        (p) => p.badge === project.colors?.badge || p.dot === project.colors?.dot
      );
      setSelectedPaletteIdx(paletteIdx >= 0 ? paletteIdx : 0);
      setActiveTab('general');
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [project, isOpen]);

  const hasCodeChanged = useMemo(() => {
    if (!project) return false;
    return code.trim() !== project.code;
  }, [code, project]);

  const hasUnsavedChanges = useMemo(() => {
    if (!project) return false;
    const techArr = Array.isArray(project.techStack)
      ? project.techStack
      : project.techStack
      ? Object.entries(project.techStack).map(([k, v]) => `${k}: ${v}`)
      : [];
    const origTech = techArr.join(', ');
    const origRules = (project.groundingRules || []).join('\n');
    const origPaletteIdx = Math.max(0, PALETTES.findIndex(
      (p) => p.badge === project.colors?.badge || p.dot === project.colors?.dot
    ));

    return (
      name.trim() !== (project.name || '') ||
      code.trim() !== project.code ||
      description.trim() !== (project.description || '') ||
      guidelinesRef.trim() !== (project.guidelinesRef || 'AGENTS.md') ||
      techStackStr.trim() !== origTech.trim() ||
      groundingRulesStr.trim() !== origRules.trim() ||
      selectedPaletteIdx !== origPaletteIdx ||
      hasCodeChanged
    );
  }, [name, code, description, guidelinesRef, techStackStr, groundingRulesStr, selectedPaletteIdx, hasCodeChanged, project]);

  const handleRequestClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setPendingProjectSwitch(null);
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
        } else if (isConfirmRenameCodeOpen) {
          setIsConfirmRenameCodeOpen(false);
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConfirmDiscardOpen, isConfirmRenameCodeOpen, handleRequestClose]);

  if (!isOpen || !project) return null;

  const executeSave = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMsg('Project name cannot be empty.');
      return;
    }
    if (cleanName.length > MAX_PROJECT_NAME_LENGTH) {
      setErrorMsg(`Project name cannot exceed ${MAX_PROJECT_NAME_LENGTH} characters.`);
      return;
    }

    const cleanCode = code.trim();
    if (!cleanCode) {
      setErrorMsg('Project code cannot be empty.');
      return;
    }
    if (!new RegExp(`^[a-zA-Z0-9]{1,${MAX_PROJECT_CODE_LENGTH}}$`).test(cleanCode)) {
      setErrorMsg(`Project code must be 1 to ${MAX_PROJECT_CODE_LENGTH} alphanumeric characters.`);
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      let activeCode = project.code;
      let renameInfo: { oldCode: string; newCode: string } | undefined = undefined;

      // 1. If project code changed, execute rename endpoint first
      if (cleanCode.toLowerCase() !== project.code.toLowerCase() || cleanCode !== project.code) {
        const renameRes = await fetch('/api/planning/rename-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldCode: project.code,
            newCode: cleanCode,
            newName: cleanName,
          }),
        });

        if (!renameRes.ok) {
          const errData = await renameRes.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to rename project code: HTTP ${renameRes.status}`);
        }

        const renameData = await renameRes.json();
        activeCode = renameData.newCode;
        renameInfo = { oldCode: project.code, newCode: renameData.newCode };
      }

      // 2. Parse grounding and tech stack
      const parsedTech = techStackStr
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const parsedRules = groundingRulesStr
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      // 3. Update project metadata
      const updateRes = await fetch('/api/planning/update-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: activeCode,
          name: cleanName,
          description: description.trim(),
          colors: PALETTES[selectedPaletteIdx],
          guidelinesRef: guidelinesRef.trim() || undefined,
          techStack: parsedTech.length > 0 ? parsedTech : undefined,
          groundingRules: parsedRules.length > 0 ? parsedRules : undefined,
        }),
      });

      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to update project settings: HTTP ${updateRes.status}`);
      }

      const updatedProject: ProjectDescriptor = await updateRes.json();
      activeProjectKeyRef.current = `${updatedProject.id ?? ''}:${updatedProject.code}`;
      setSuccessMsg('Project settings saved successfully.');
      onUpdated(updatedProject, renameInfo);
      setTimeout(() => {
        onClose();
      }, 350);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while saving project settings.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasCodeChanged) {
      setIsConfirmRenameCodeOpen(true);
    } else {
      executeSave();
    }
  };

  if (!isOpen || !project) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[var(--accent-bg-subtle)] border border-[var(--accent-border-subtle)] flex items-center justify-center text-[var(--accent-primary)] shadow-xs shrink-0">
              <Settings size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="project-settings-title" className="text-sm font-bold text-[var(--text-primary)] truncate">
                  Project Settings
                </h2>
                {availableProjects && availableProjects.length > 1 && onSelectProject && (
                  <select
                    value={project.code}
                    onChange={(e) => {
                      const selected = availableProjects.find((p) => p.code === e.target.value);
                      if (selected && selected.code !== project.code) {
                        if (hasUnsavedChanges) {
                          setPendingProjectSwitch(selected);
                          setIsConfirmDiscardOpen(true);
                        } else {
                          onSelectProject(selected);
                        }
                      }
                    }}
                    className="px-2 py-0.5 text-xs font-semibold rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-primary)] focus:outline-none cursor-pointer"
                    aria-label="Switch project to configure"
                  >
                    {availableProjects.map((p) => (
                      <option key={p.id} value={p.code} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] font-mono mt-0.5">
                <span className={`inline-block w-2 h-2 rounded-full ${project.colors?.dot || 'bg-cyan-400'}`} />
                <span>{project.name} · Code: {project.code}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="w-8 h-8 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
            aria-label="Close project settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-4 pt-1.5 gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'general'
                ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--accent-primary)] shadow-xs'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Palette size={13} />
            <span>General & Theme</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'code'
                ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--accent-primary)] shadow-xs'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <FileText size={13} />
            <span>Project Code</span>
            {hasCodeChanged && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Code modified" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('grounding')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-colors border-t border-x cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'grounding'
                ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--accent-primary)] shadow-xs'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Cpu size={13} />
            <span>LLM Grounding</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
              <Check size={15} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Project Display Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_PROJECT_NAME_LENGTH}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                  placeholder="e.g. Lab 151 Sleep Research"
                  required
                />
                <div className="flex justify-between items-center text-[10px] text-[var(--text-muted)] mt-1 font-mono">
                  <span>Human-readable title used throughout the Esedre dashboard</span>
                  <span>{name.length}/{MAX_PROJECT_NAME_LENGTH}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors resize-none"
                  placeholder="Brief summary of the project scope and purpose..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                  <Palette size={13} />
                  <span>Accent Color Palette</span>
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {PALETTES.map((pal, idx) => (
                    <button
                      key={pal.name}
                      type="button"
                      onClick={() => setSelectedPaletteIdx(idx)}
                      className={`p-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                        selectedPaletteIdx === idx
                          ? `${pal.badge} ring-2 ring-[var(--accent-primary)] ring-offset-1`
                          : 'bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full ${pal.dot}`} />
                      <span className="text-[10px]">{pal.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PROJECT CODE */}
          {activeTab === 'code' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Project Code (Identifier) *
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  maxLength={MAX_PROJECT_CODE_LENGTH}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors uppercase tracking-wider"
                  placeholder="e.g. LAB151"
                  required
                />
                <div className="flex justify-between items-center text-[10px] text-[var(--text-muted)] mt-1 font-mono">
                  <span>1 to {MAX_PROJECT_CODE_LENGTH} alphanumeric characters</span>
                  <span>{code.length}/{MAX_PROJECT_CODE_LENGTH}</span>
                </div>
              </div>

              {hasCodeChanged ? (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-700 dark:text-amber-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold">
                    <ShieldAlert size={16} className="text-amber-500 shrink-0" />
                    <span>Project Code Migration: {project.code} &rarr; {code.trim()}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Changing the project code initiates an automated filesystem migration:
                  </p>
                  <ul className="text-[11px] list-disc list-inside space-y-0.5 font-mono">
                    <li>Renames data hub storage directory from <code>projects/{project.code}/</code> to <code>projects/{code.trim()}/</code></li>
                    <li>Updates ticket metadata so ticket IDs become <code>{code.trim()}-#</code></li>
                    <li>Synchronizes local <code>.esedre/esedre.json</code> and central allow-lists</li>
                  </ul>
                </div>
              ) : (
                <div className="p-3.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] text-xs space-y-1">
                  <div className="font-semibold text-[var(--text-primary)]">Current Canonical Code</div>
                  <p className="text-[11px] leading-relaxed">
                    This code serves as the prefix for all tickets in this project (e.g. <code>{project.code}-1</code>, <code>{project.code}-2</code>). You can safely rename it above if your repository has migrated or changed scope.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: LLM GROUNDING & INSTRUCTIONS */}
          {activeTab === 'grounding' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Guidelines & Grounding File Reference
                </label>
                <input
                  type="text"
                  value={guidelinesRef}
                  onChange={(e) => setGuidelinesRef(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                  placeholder="AGENTS.md"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Specifies the primary repository instructions file referenced by autonomous LLM agents (e.g. AGENTS.md, CLAUDE.md).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Tech Stack Constraints
                </label>
                <input
                  type="text"
                  value={techStackStr}
                  onChange={(e) => setTechStackStr(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                  placeholder="e.g. React 19, TypeScript, Vite, Tailwind CSS"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Comma-separated list of architectural libraries and tech stack constraints.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Project Grounding Rules
                </label>
                <textarea
                  value={groundingRulesStr}
                  onChange={(e) => setGroundingRulesStr(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors resize-none"
                  placeholder="One rule per line (e.g. Zero em dashes, Strict TypeScript types)..."
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  High-priority invariants projected into project snapshots to anchor LLM agent reasoning.
                </p>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={isSubmitting}
              className="px-3 py-2 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !hasUnsavedChanges}
              className="px-4 py-2 bg-[var(--accent-primary)] hover:brightness-110 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Project Settings</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Discard Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmDiscardOpen}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in Project Settings. Are you sure you want to discard them?"
        confirmLabel="Discard Changes"
        cancelLabel="Continue Editing"
        variant="warning"
        onConfirm={() => {
          setIsConfirmDiscardOpen(false);
          if (pendingProjectSwitch) {
            const nextProj = pendingProjectSwitch;
            setPendingProjectSwitch(null);
            onSelectProject?.(nextProj);
          } else {
            onClose();
          }
        }}
        onClose={() => {
          setIsConfirmDiscardOpen(false);
          setPendingProjectSwitch(null);
        }}
      />

      {/* Rename Project Code Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmRenameCodeOpen}
        title={`Rename Project Code to "${code.trim()}"?`}
        message={`This will migrate project directories, update ticket IDs to ${code.trim()}-#, and synchronize configuration files on disk. Do you want to proceed?`}
        confirmLabel="Confirm & Migrate Code"
        cancelLabel="Review Changes"
        variant="warning"
        onConfirm={() => {
          setIsConfirmRenameCodeOpen(false);
          executeSave();
        }}
        onClose={() => setIsConfirmRenameCodeOpen(false)}
      />
    </div>
  );
};
