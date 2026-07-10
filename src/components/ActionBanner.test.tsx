import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ActionBanner from './ActionBanner';
import { getMoveBannerEvent } from '@/lib/actionBannerEvents';
import type { MoveFeedback } from '@/lib/moveFeedback';

describe('ActionBanner', () => {
  it('renders a capture event', () => {
    render(
      <ActionBanner
        event={{
          id: 'capture-1',
          title: 'CAPTURE!',
          subtitle: 'Nxe5',
          tone: 'capture',
        }}
      />,
    );

    expect(screen.getByText('CAPTURE!')).toBeInTheDocument();
    expect(screen.getByText('Nxe5')).toBeInTheDocument();
  });

  it('maps move feedback to banner copy', () => {
    const event = getMoveBannerEvent({
      id: 'check-1',
      from: 'd1',
      to: 'h5',
      san: 'Qh5+',
      color: 'w',
      piece: 'q',
      tone: 'check',
      isCapture: false,
      isPromotion: false,
      isCheck: true,
      isCheckmate: false,
      isDraw: false,
    } satisfies MoveFeedback);

    expect(event).toEqual({
      id: 'check-1',
      title: 'CHECK!',
      subtitle: 'Qh5+',
      tone: 'check',
    });
  });
});
