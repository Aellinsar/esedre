import React, { useEffect, useState } from 'react';
import { X, Users, RotateCcw, Clock, Bot, Cpu, GitBranch, ArrowUpRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { TicketLeaseSummary, CrewRole } from './types';

interface CrewStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  leases: TicketLeaseSummary[];
  onRefresh: () => void;
  onSelectTicket?: (ticketKey: string) => void;
  isLoading?: boolean;
}

function formatRemainingSeconds(seconds: number): string {
  if (seconds <= 0) return 'Expired (Reclaimable)';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s remaining`;
  return `${m}m ${s}s remaining`;
}

function getRoleBadge(role: CrewRole): { bg: string; text: string; label: string } {
  switch (role) {
    case 'lead':
      return {
        bg: 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700/60',
        text: 'text-purple-800 dark:text-purple-300',
        label: 'Lead',
      };
    case 'anchor':
      return {
        bg: 'bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-700/60',
        text: 'text-sky-800 dark:text-sky-300',
        label: 'Anchor',
      };
    case 'thug':
    default:
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700/60',
        text: 'text-amber-800 dark:text-amber-300',
        label: 'Thug',
      };
  }
}

export const CrewStatusModal: React.FC<CrewStatusModalProps> = ({
  isOpen,
  onClose,
  leases,
  onRefresh,
  onSelectTicket,
  isLoading = false,
}) => {
  // Live tick state to decrement remaining seconds every second
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh] text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Autonomous Crew Fleet
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60">
                  {leases.length} Active
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Live ticket locks, heartbeats, and worker processes across fleet systems.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh active leases"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none"
            >
              <RotateCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close modal"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {leases.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
                <Bot className="w-6 h-6 opacity-60" />
              </div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                No Active Worker Leases
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
                All crew workers are currently idle. Active tickets and leases will appear here automatically when a worker claims a ticket.
              </p>
              <div className="inline-block text-left text-xs bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60 font-mono text-slate-600 dark:text-slate-300">
                <div className="text-slate-400 dark:text-slate-500 mb-1"># Launch a headless worker:</div>
                <div className="text-emerald-600 dark:text-emerald-400">ese worker --id thug-1</div>
                <div className="text-slate-400 dark:text-slate-500 mt-2 mb-1"># Or claim a specific ticket:</div>
                <div className="text-emerald-600 dark:text-emerald-400">ese claim &lt;id&gt; --role thug</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {leases.map((lease) => {
                const now = Date.now();
                const expiresAtMs = new Date(lease.expiresAt).getTime();
                const secondsLeft = Math.max(0, Math.floor((expiresAtMs - now) / 1000));
                const isExpired = secondsLeft <= 0;
                const roleBadge = getRoleBadge(lease.role);

                return (
                  <div
                    key={`${lease.system}:${lease.workerId}:${lease.ticketId}`}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-sm"
                  >
                    {/* Top Row: System, Worker, Role & Countdown */}
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* System Tag */}
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                          {lease.system}
                        </span>
                        {/* Worker ID */}
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {lease.workerId}
                        </span>
                        {/* Role Badge */}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${roleBadge.bg} ${roleBadge.text}`}
                        >
                          {roleBadge.label}
                        </span>
                        {/* Engine Badge */}
                        <span className="px-1.5 py-0.5 rounded text-[10px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                          {lease.engine}
                        </span>
                      </div>

                      {/* Remaining TTL */}
                      <div
                        className={`flex items-center gap-1.5 text-xs font-medium font-mono ${
                          isExpired
                            ? 'text-rose-600 dark:text-rose-400'
                            : secondsLeft < 120
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatRemainingSeconds(secondsLeft)}</span>
                      </div>
                    </div>

                    {/* Middle: Linked Ticket */}
                    <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-750">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                            #{lease.ticketKey || `${lease.project}-${lease.ticketId}`}
                          </span>
                          <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {lease.title || `Ticket #${lease.ticketId}`}
                          </span>
                        </div>
                      </div>

                      {onSelectTicket && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectTicket(lease.ticketKey || `${lease.project}-${lease.ticketId}`);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors focus:outline-none"
                          title="Jump to ticket in planner"
                        >
                          <span>Open</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Bottom Row: Worktree & Acquired Info */}
                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 truncate">
                        {lease.worktree ? (
                          <>
                            <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate" title={lease.worktree}>
                              {lease.worktree}
                            </span>
                          </>
                        ) : (
                          <>
                            <Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>Shared repository root</span>
                          </>
                        )}
                      </div>
                      <div className="shrink-0 text-slate-400 dark:text-slate-500">
                        TTL: {lease.ttlMinutes}m (acquired {new Date(lease.acquiredAt).toLocaleTimeString()})
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Rolling heartbeats with automatic dead-worker reclaiming</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors focus:outline-none"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
