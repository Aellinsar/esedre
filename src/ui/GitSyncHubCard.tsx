import React from 'react';
import { GitBranch, RefreshCw, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, AlertTriangle, XCircle, Clock, FolderGit2, ShieldAlert } from 'lucide-react';
import { GitSyncHubStatus, GitSyncStatusState, ProjectSyncMode } from './types';

interface GitSyncHubCardProps {
  hub: GitSyncHubStatus;
  isSyncing: boolean;
  onSyncHub: (hubDir: string, opts?: { pull?: boolean; push?: boolean; commit?: boolean }) => void;
}

export function getSyncStatusBadgeMeta(status: GitSyncStatusState, enabled: boolean): { label: string; dotClass: string; badgeClass: string } {
  if (!enabled || status === 'disabled') {
    return { label: 'Disabled', dotClass: 'bg-slate-400', badgeClass: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-400' };
  }
  switch (status) {
    case 'syncing':
      return { label: 'Syncing...', dotClass: 'bg-sky-500 animate-pulse', badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300' };
    case 'conflict':
      return { label: 'Conflict', dotClass: 'bg-rose-500 animate-pulse', badgeClass: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300' };
    case 'error':
      return { label: 'Error', dotClass: 'bg-rose-500', badgeClass: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300' };
    case 'offline':
      return { label: 'Offline (Local Commit)', dotClass: 'bg-amber-500', badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' };
    default:
      return { label: 'Active / Idle', dotClass: 'bg-emerald-500', badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' };
  }
}

export const GitSyncHubCard: React.FC<GitSyncHubCardProps> = ({ hub, isSyncing, onSyncHub }) => {
  const badge = getSyncStatusBadgeMeta(hub.status, hub.enabled);

  return (
    <div className="p-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FolderGit2 size={15} className="text-[var(--accent-primary)] shrink-0" />
          <span className="text-xs font-mono font-semibold text-[var(--text-primary)] truncate" title={hub.hubDir}>
            {hub.hubDir}
          </span>
        </div>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-semibold inline-flex items-center gap-1.5 ${badge.badgeClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
        <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <div className="text-[10px] text-[var(--text-muted)]">Remote / Branch</div>
          <div className="text-[var(--text-primary)] font-semibold flex items-center gap-1 truncate mt-0.5">
            <GitBranch size={11} className="text-[var(--accent-primary)] shrink-0" />
            <span className="truncate">{hub.remote}/{hub.branch}</span>
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <div className="text-[10px] text-[var(--text-muted)]">Dirty Files</div>
          <div className="text-[var(--text-primary)] font-semibold mt-0.5">{hub.dirtyFilesCount ?? 0}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <div className="text-[10px] text-[var(--text-muted)]">Pending Push</div>
          <div className="text-[var(--text-primary)] font-semibold mt-0.5">{hub.pendingCommits} commit(s)</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <div className="text-[10px] text-[var(--text-muted)]">Last Synced</div>
          <div className="text-[var(--text-primary)] font-semibold truncate mt-0.5 flex items-center gap-1">
            <Clock size={10} className="text-[var(--text-muted)] shrink-0" />
            <span>{hub.lastSyncedAt ? new Date(hub.lastSyncedAt).toLocaleTimeString() : 'Never'}</span>
          </div>
        </div>
      </div>

      {(hub.lastCommitSha || hub.lastCommitMessage) && (
        <div className="text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--bg-surface)] px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] truncate">
          <span className="text-[var(--accent-primary)] font-semibold">{hub.lastCommitSha || 'HEAD'}</span>
          {hub.lastCommitMessage ? `: ${hub.lastCommitMessage}` : ''}
        </div>
      )}

      {hub.projects && hub.projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">Hub Projects:</span>
          {hub.projects.map((code) => (
            <span
              key={code}
              className="px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px] font-mono font-semibold text-[var(--text-secondary)]"
            >
              {code}
            </span>
          ))}
        </div>
      )}

      {hub.lastError && (
        <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-[11px] flex items-start gap-2">
          <XCircle size={13} className="shrink-0 mt-0.5" />
          <span className="break-words">{hub.lastError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={isSyncing}
          onClick={() => onSyncHub(hub.hubDir, { commit: false, pull: true, push: false })}
          className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
        >
          <ArrowDownToLine size={12} />
          <span>Pull Only</span>
        </button>
        <button
          type="button"
          disabled={isSyncing}
          onClick={() => onSyncHub(hub.hubDir, { commit: false, pull: false, push: true })}
          className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--accent-bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
        >
          <ArrowUpFromLine size={12} />
          <span>Push Only</span>
        </button>
        <button
          type="button"
          disabled={isSyncing}
          onClick={() => onSyncHub(hub.hubDir, { commit: true, pull: true, push: true })}
          className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:brightness-110 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-xs"
        >
          <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
          <span>Sync Hub Now</span>
        </button>
      </div>
    </div>
  );
};

export const ProjectStoragePostureSection: React.FC<{ projectModes?: ProjectSyncMode[]; syncEnabled: boolean }> = ({
  projectModes = [],
  syncEnabled,
}) => {
  if (projectModes.length === 0) return null;
  const inRepo = projectModes.filter((p) => p.storageMode === 'in-repo');

  return (
    <div className="p-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-2.5">
      <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
        <ShieldAlert size={14} className="text-[var(--accent-primary)]" />
        <span>Project Storage & Auto-Sync Boundaries</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        {projectModes.map((pm) => (
          <div
            key={pm.code}
            className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="font-semibold text-[var(--text-primary)] truncate">{pm.name} ({pm.code})</div>
              <div className="text-[10px] text-[var(--text-muted)] font-mono truncate">
                {pm.storageMode === 'hub' ? 'Data Hub Repository' : 'In-Repo (.esedre/tickets/)'}
              </div>
            </div>
            {pm.storageMode === 'hub' ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0 inline-flex items-center gap-1">
                <CheckCircle2 size={10} />
                {syncEnabled ? 'Hub Auto-Sync' : 'Hub (Sync Off)'}
              </span>
            ) : (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 shrink-0 inline-flex items-center gap-1"
                title="Tickets stored inside a code repository cannot be auto-synced by Esedre"
              >
                <AlertTriangle size={10} />
                Hands-Off (Cannot Auto-Sync)
              </span>
            )}
          </div>
        ))}
      </div>
      {inRepo.length > 0 && (
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          Note: In-project tickets (<code className="font-mono text-[var(--text-secondary)]">.esedre/tickets/</code>) live inside source code repositories and are strictly hands-off: they cannot be auto-synced by Esedre and are committed alongside your normal project Git workflow.
        </p>
      )}
    </div>
  );
};
