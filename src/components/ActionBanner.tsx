import type { ActionBannerEvent } from '@/lib/actionBannerEvents';

interface ActionBannerProps {
  event: ActionBannerEvent | null;
}

export default function ActionBanner({ event }: ActionBannerProps) {
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
      <p className="action-banner-title">{event.title}</p>
      {event.subtitle && <p className="action-banner-subtitle">{event.subtitle}</p>}
    </div>
  );
}
