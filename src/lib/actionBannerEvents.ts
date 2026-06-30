import type { MoveFeedback } from '@/lib/moveFeedback';
import type { InvalidMoveFeedback } from '@/lib/invalidMoveFeedback';

export interface ActionBannerEvent {
  id: string;
  title: string;
  subtitle?: string;
  tone?: 'move' | 'capture' | 'check' | 'checkmate' | 'draw' | 'promotion' | 'saving' | 'alert';
}

function titleForMove(feedback: MoveFeedback): string {
  if (feedback.tone === 'checkmate') return 'CHECKMATE!';
  if (feedback.tone === 'draw') return 'DRAW!';
  if (feedback.tone === 'check') return 'CHECK!';
  if (feedback.tone === 'promotion') return 'PROMOTION!';
  if (feedback.tone === 'capture') return 'CAPTURE!';
  return 'MOVE!';
}

export function getMoveBannerEvent(feedback: MoveFeedback | null): ActionBannerEvent | null {
  if (!feedback) return null;

  return {
    id: feedback.id,
    title: titleForMove(feedback),
    subtitle: feedback.san,
    tone: feedback.tone,
  };
}

export function getInvalidMoveBannerEvent(feedback: InvalidMoveFeedback | null): ActionBannerEvent | null {
  if (!feedback) return null;

  return {
    id: feedback.id,
    title: 'ILLEGAL MOVE',
    subtitle: feedback.message,
    tone: 'alert',
  };
}
