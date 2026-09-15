import '@/pass-and-play.css';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
import { translateText as t, useLanguage } from '@/lib/i18n';
import { saveLocalGameConfig, type LocalGameConfig } from '@/lib/localGameConfig';

export default function PassAndPlaySetup({ disabled = false }: { disabled?: boolean }) {
  useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [white, setWhite] = useState('');
  const [black, setBlack] = useState('');
  const [autoRotate, setAutoRotate] = useState(true);
  function start(event: FormEvent) {
    event.preventDefault();
    const config: LocalGameConfig = {
      mode: 'pvp', difficulty: 'medium', passAndPlay: true, autoRotate,
      playerName: white.trim().slice(0, 24) || t('Player 1'),
      secondPlayerName: black.trim().slice(0, 24) || t('Player 2'),
    };
    saveLocalGameConfig(config);
    setOpen(false);
    navigate('/game', { state: config });
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button className="pass-play-entry" disabled={disabled}>
      <Users size={22}/><span><strong>{t('Play on this device')}</strong><small>{t('Pass & Play · 2 players · Free')}</small></span><ArrowRight size={19}/>
    </button></DialogTrigger>
    <DialogContent className="pass-play-setup">
      <DialogTitle>{t('Pass & Play')}</DialogTitle>
      <DialogDescription>{t('Two players. One screen. No wallet needed.')}</DialogDescription>
      <form onSubmit={start} className="pass-play-form">
        <label>{t('White player')}<input maxLength={24} value={white} onChange={e => setWhite(e.target.value)} placeholder={t('Player 1')} autoComplete="off" /></label>
        <label>{t('Black player')}<input maxLength={24} value={black} onChange={e => setBlack(e.target.value)} placeholder={t('Player 2')} autoComplete="off" /></label>
        <label className="pass-play-option"><input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} /><span>{t('Rotate the board for each player')}</span></label>
        <p>{t('After each move, pass the screen and tap Ready. Untimed, standard chess. Rematches swap colors.')}</p>
        <button type="submit" className="sky-play">{t('Start Pass & Play')}<ArrowRight size={19}/></button>
      </form>
    </DialogContent>
  </Dialog>;
}
