import React, { useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, X } from 'lucide-react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  subtitle?: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success' | 'primary';
  icon?: React.ReactNode;
  hideCancel?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  subtitle,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'warning',
  icon,
  hideCancel = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          iconBg: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
          defaultIcon: <AlertCircle size={20} />,
          confirmBtn: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20',
        };
      case 'success':
        return {
          iconBg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
          defaultIcon: <CheckCircle2 size={20} />,
          confirmBtn: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20',
        };
      case 'info':
        return {
          iconBg: 'bg-[var(--accent-bg-subtle)] border-[var(--accent-border-subtle)] text-[var(--accent-primary)]',
          defaultIcon: <Info size={20} />,
          confirmBtn: 'bg-[var(--accent-primary)] hover:brightness-110 text-white shadow-lg shadow-[var(--accent-primary)]/20',
        };
      case 'warning':
      case 'primary':
      default:
        return {
          iconBg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          defaultIcon: <AlertTriangle size={20} />,
          confirmBtn: 'bg-[var(--accent-primary)] hover:brightness-110 text-white shadow-lg shadow-[var(--accent-primary)]/20',
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-[120] flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-strong)] w-full max-w-md rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-[var(--text-primary)] space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${styles.iconBg}`}>
              {icon || styles.defaultIcon}
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
              {subtitle && <p className="text-[10px] text-[var(--accent-primary)] font-mono">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded-lg hover:bg-[var(--bg-surface-elevated)] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message */}
        <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[var(--bg-input)] hover:bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer min-h-[44px] flex items-center justify-center"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (onConfirm) onConfirm();
              onClose();
            }}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg min-h-[44px] ${styles.confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
