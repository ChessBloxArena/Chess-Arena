import { localize, useLanguage } from '@/lib/i18n';
import type { ActionBannerEvent } from '@/lib/actionBannerEvents';

interface ActionBannerProps {
  event: ActionBannerEvent | null;
}

export default function ActionBanner({ event }: ActionBannerProps) {
  useLanguage();
  if (!event) return null;

  return (
    <div
      key={event.id}
      className={`action-banner action-banner-${event.tone ?? 'move'}`}
      aria-live="polite"
    >
      <div className="action-banner-burst" aria-hidden="true" />
      <div className="action-banner-rail action-banner-rail-top" aria-hidden="true" />
      <div className="action-banner-rail action-banner-rail-bottom" aria-hidden="true" />
      <div className="action-banner-scanline" />
      <p className="action-banner-title">{localize(event.title)}</p>
      {localize(event.subtitle && <p className="action-banner-subtitle">{localize(event.subtitle)}</p>)}
    </div>
  );
}
