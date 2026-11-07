import React, { useState, useEffect, useCallback } from 'react';
import { X, Settings, RefreshCw, Check, AlertCircle, GitBranch } from 'lucide-react';
import { GitSyncStatusReport } from './types';
import { GitSyncHubCard, ProjectStoragePostureSection } from './GitSyncHubCard';

interface GlobalGitSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncReport: GitSyncStatusReport | null;
  onUpdated: (report: GitSyncStatusReport) => void;
}

export const GlobalGitSyncModal: React.FC<GlobalGitSyncModalProps> = ({ isOpen, onClose, syncReport, onUpdated }) => {
  const [enabled, setEnabled] = useState(false);
  const [push, setPush] = useState(true);
  const [pullOnStart, setPullOnStart] = useState(true);
  const [remote, setRemote] = useState('origin');
  const [branch, setBranch] = useState('main');
  const [debounceSeconds, setDebounceSeconds] = useState(5);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hydrateFromReport = useCallback((report: GitSyncStatusReport) => {
    setEnabled(Boolean(report.config?.enabled));
    setPush(report.config?.push !== undefined ? Boolean(report.config.push) : true);
    setPullOnStart(report.config?.pullOnStart !== undefined ? Boolean(report.config.pullOnStart) : true);
    setRemote(report.config?.remote || 'origin');
    setBranch(report.config?.branch || 'main');
    setDebounceSeconds(report.config?.debounceSeconds ?? 5);
    setIntervalMinutes(report.config?.intervalMinutes ?? 15);
  }, []);

  const fetchLatestStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/planning/sync/status');
      if (res.ok) {
        const data: GitSyncStatusReport = await res.json();
        onUpdated(data);
        hydrateFromReport(data);
      }
    } catch {}
  }, [onUpdated, hydrateFromReport]);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    if (syncReport) hydrateFromReport(syncReport);
    fetchLatestStatus();
  }, [isOpen, fetchLatestStatus]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null); setSuccessMsg(null); setIsSaving(true);
    try {
      const res = await fetch('/api/planning/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled, push, pullOnStart,
          remote: remote.trim() || 'origin',
          branch: branch.trim() || 'main',
          debounceSeconds: Number(debounceSeconds) || 0,
          intervalMinutes: Number(intervalMinutes) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to save Git sync configuration (HTTP ${res.status})`);
      if (data.status) onUpdated(data.status);
      setSuccessMsg('Global Git sync configuration saved.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update Git sync settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncAction = async (hubDir?: string, opts?: { pull?: boolean; push?: boolean; commit?: boolean }) => {
    setErrorMsg(null); setSuccessMsg(null); setIsSyncing(true);
    try {
      const res = await fetch('/api/planning/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(hubDir ? { hubDir } : {}), ...(opts || {}), force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Git sync failed (HTTP ${res.status})`);
      if (data.status) onUpdated(data.status);
      else await fetchLatestStatus();
      setSuccessMsg('Data hub Git sync completed.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to execute Git sync.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--accent-bg-subtle)] text-[var(--accent-primary)] border border-[var(--accent-border-subtle)]">
              <Settings size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Global Esedre Settings</h3>
              <p className="text-[11px] text-[var(--text-muted)]">Data Hub Git Auto-Sync (~/.esedre/config.json)</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-input)] transition-colors cursor-pointer" aria-label="Close Global Settings">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" /><span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 flex items-center gap-2">
              <Check size={14} className="shrink-0" /><span>{successMsg}</span>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <GitBranch size={13} className="text-[var(--accent-primary)]" /><span>Enable Data Hub Git Auto-Sync</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Automatically stage, commit, pull with rebase, and push ticket mutations in configured data hubs. Defaults to off.
                </p>
              </div>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-[var(--accent-primary)] rounded cursor-pointer shrink-0" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-[var(--border-subtle)]">
              <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Auto-push commits to remote</span>
                <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="accent-[var(--accent-primary)] cursor-pointer" />
              </label>
              <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Pull with rebase on daemon start</span>
                <input type="checkbox" checked={pullOnStart} onChange={(e) => setPullOnStart(e.target.checked)} className="accent-[var(--accent-primary)] cursor-pointer" />
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div><label className="block text-[10px] font-mono text-[var(--text-muted)] mb-1">Remote</label><input type="text" value={remote} onChange={(e) => setRemote(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono text-xs" /></div>
              <div><label className="block text-[10px] font-mono text-[var(--text-muted)] mb-1">Branch</label><input type="text" value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono text-xs" /></div>
              <div><label className="block text-[10px] font-mono text-[var(--text-muted)] mb-1">Debounce (sec)</label><input type="number" min={0} max={300} value={debounceSeconds} onChange={(e) => setDebounceSeconds(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono text-xs" /></div>
              <div><label className="block text-[10px] font-mono text-[var(--text-muted)] mb-1">Interval (min)</label><input type="number" min={0} max={1440} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono text-xs" /></div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-primary)]">Configured Data Hubs ({syncReport?.hubs?.length ?? 0})</span>
              <button type="button" onClick={() => handleSyncAction()} disabled={isSyncing} className="text-[11px] font-semibold text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50">
                <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} /><span>Sync All Hubs</span>
              </button>
            </div>
            {syncReport?.hubs && syncReport.hubs.length > 0 ? (
              syncReport.hubs.map((hub) => <GitSyncHubCard key={hub.hubDir} hub={hub} isSyncing={isSyncing} onSyncHub={handleSyncAction} />)
            ) : (
              <div className="p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">No dedicated data hubs configured in ~/.esedre/config.json.</div>
            )}
          </div>

          <ProjectStoragePostureSection projectModes={syncReport?.projectModes} syncEnabled={enabled} />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-xl bg-[var(--bg-input)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] font-semibold cursor-pointer">Close</button>
            <button type="submit" disabled={isSaving} className="px-4 py-2 rounded-xl bg-[var(--accent-primary)] hover:brightness-110 text-white font-semibold shadow-sm cursor-pointer disabled:opacity-50">{isSaving ? 'Saving...' : 'Save Sync Settings'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
