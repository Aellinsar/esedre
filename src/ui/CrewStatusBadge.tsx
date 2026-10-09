import React from 'react';
import { Users, Bot } from 'lucide-react';
import { TicketLeaseSummary } from './types';

interface CrewStatusBadgeProps {
  leases: TicketLeaseSummary[];
  onClick: () => void;
  isLoading?: boolean;
}

export const CrewStatusBadge: React.FC<CrewStatusBadgeProps> = ({
  leases,
  onClick,
  isLoading = false,
}) => {
  const activeCount = leases.length;
  const isOnline = activeCount > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        isOnline
          ? `Autonomous Crew Fleet: ${activeCount} active lease${activeCount === 1 ? '' : 's'}. Click to view status.`
          : 'Autonomous Crew Fleet: Idle. Click to view fleet status.'
      }
      aria-label="Autonomous Crew Fleet status"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 ${
        isOnline
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 focus:ring-emerald-500'
          : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700/70 focus:ring-slate-400'
      }`}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        {isOnline && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
            isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
          }`}
        />
      </span>
      <Users className="w-3.5 h-3.5 opacity-80" />
      <span>{isOnline ? `Crew: ${activeCount} Active` : 'Crew: Idle'}</span>
    </button>
  );
};
