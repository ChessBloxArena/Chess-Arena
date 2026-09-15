import '@/pass-and-play.css';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogAction } from './ui/alert-dialog';
import { translateText as t, useLanguage } from '@/lib/i18n';

export default function PassAndPlayHandoff({ open, name, color, onReady }: {
  open: boolean; name: string; color: 'w' | 'b'; onReady: () => void;
}) {
  useLanguage();
  return <AlertDialog open={open}>
    <AlertDialogContent className="pass-play-handoff" onEscapeKeyDown={e => e.preventDefault()}>
      <p className="pass-play-eyebrow">{t('Pass & Play')} · {t(color === 'w' ? 'White' : 'Black')}</p>
      <AlertDialogTitle>{t('Your turn')}, <span>{name}</span></AlertDialogTitle>
      <AlertDialogDescription>{t('Pass the screen to the next player. Tap Ready when you have it.')}</AlertDialogDescription>
      <AlertDialogAction onClick={onReady} className="sky-play">{t('Ready to play')}</AlertDialogAction>
    </AlertDialogContent>
  </AlertDialog>;
}
