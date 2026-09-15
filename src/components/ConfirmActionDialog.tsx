import { translateText, localize, useLanguage } from '@/lib/i18n';
interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function ConfirmActionDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'CANCEL',
  pending = false,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  useLanguage();
  if (!open) return null;

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={localize(title)}>
      <div className="confirm-panel retro-panel">
        <p className="confirm-eyebrow">{translateText("CONFIRM")}</p>
        <h2 className="confirm-title">{localize(title)}</h2>
        <p className="confirm-message">{localize(message)}</p>
        <div className="confirm-actions">
          <button type="button" className="retro-btn retro-btn-gold" onClick={onConfirm} disabled={pending}>
            {localize(pending ? 'WORKING...' : confirmLabel)}
          </button>
          <button type="button" className="retro-btn" onClick={onCancel} disabled={pending}>
            {localize(cancelLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
