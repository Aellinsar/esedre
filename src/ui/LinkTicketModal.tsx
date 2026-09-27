import React, { useState, useEffect, useMemo } from 'react';
import { X, Link2, AlertCircle, Check } from 'lucide-react';
import { PlannedFeature, TicketLinkRelation, LINK_RELATION_LABELS } from './types';
import { activePlanningProvider } from './planningClient';

interface LinkTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTicket: PlannedFeature;
  availableTickets: PlannedFeature[];
  onLinked: () => void;
}

const RELATIONS: TicketLinkRelation[] = [
  'relates-to',
  'blocks',
  'blocked-by',
  'parent-of',
  'child-of',
  'duplicates',
  'duplicated-by',
];

export const LinkTicketModal: React.FC<LinkTicketModalProps> = ({
  isOpen,
  onClose,
  sourceTicket,
  availableTickets,
  onLinked,
}) => {
  const [relation, setRelation] = useState<TicketLinkRelation>('relates-to');
  const [targetQuery, setTargetQuery] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRelation('relates-to');
      setTargetQuery('');
      setSelectedTargetId('');
      setErrorMsg(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const candidateTickets = useMemo(() => {
    const currentKey = `${sourceTicket.project || ''}-${sourceTicket.number}`.toLowerCase();
    const currentId = String(sourceTicket.ticketId || sourceTicket.id).toLowerCase();

    return availableTickets.filter((t) => {
      const tKey = `${t.project || ''}-${t.number}`.toLowerCase();
      const tId = String(t.ticketId || t.id).toLowerCase();
      if (tKey === currentKey || tId === currentId) return false;

      if (!targetQuery.trim()) return true;
      const q = targetQuery.toLowerCase();
      return (
        tKey.includes(q) ||
        String(t.number).includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.project && t.project.toLowerCase().includes(q))
      );
    });
  }, [availableTickets, sourceTicket, targetQuery]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetKey = selectedTargetId || targetQuery.trim();
    if (!targetKey) {
      setErrorMsg('Please select or specify a target ticket.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      if (!activePlanningProvider.linkTicket) {
        throw new Error('Ticket linking not supported by active provider');
      }

      const sourceId = sourceTicket.ticketId || sourceTicket.id || sourceTicket.number;
      const res = await activePlanningProvider.linkTicket(sourceId, relation, targetKey);
      if (res.error) {
        throw new Error(res.error);
      }

      setIsSubmitting(false);
      onLinked();
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Failed to establish ticket link.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Link Issue
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Connect #{sourceTicket.number} to another roadmap ticket
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Relation
            </label>
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value as TicketLinkRelation)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 dark:text-slate-100"
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {LINK_RELATION_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Target Ticket
            </label>
            <input
              type="text"
              value={targetQuery}
              onChange={(e) => {
                setTargetQuery(e.target.value);
                setSelectedTargetId('');
              }}
              placeholder="Search by ticket title, #id, or code (e.g. Profe-105)..."
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/60 bg-slate-50/50 dark:bg-slate-950/40">
            {candidateTickets.slice(0, 10).map((t) => {
              const key = t.project ? `${t.project}-${t.number}` : String(t.number);
              const isSelected = selectedTargetId === key || selectedTargetId === String(t.number);
              return (
                <button
                  type="button"
                  key={t.id || t.ticketId || t.number}
                  onClick={() => {
                    setSelectedTargetId(key);
                    setTargetQuery(key);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-cyan-500/15 text-cyan-900 dark:text-cyan-200 font-medium'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="truncate mr-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 mr-1.5">
                      {key}
                    </span>
                    <span className="truncate">{t.title}</span>
                  </div>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {t.status || 'Planned'}
                  </span>
                </button>
              );
            })}
            {candidateTickets.length === 0 && (
              <div className="p-3 text-center text-xs text-slate-600 dark:text-slate-400">
                No tickets found matching query.
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (!selectedTargetId && !targetQuery.trim())}
              className="px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-4 h-4" />
              {isSubmitting ? 'Linking...' : 'Add Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
