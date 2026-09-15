import { useState } from 'react';
import { translateText, localize, useLanguage } from '@/lib/i18n';
import { MoreHorizontal, Music2, Volume2, VolumeX, Flag, RotateCcw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
export default function GameActionMenu({ musicOn, sfxOn, onMusic, onSfx, onSurrender, surrenderDisabled, onNew }: {
  musicOn: boolean; sfxOn: boolean; onMusic: () => void; onSfx: () => void;
  onSurrender: () => void; surrenderDisabled: boolean; onNew?: () => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger asChild><button
    type="button"
    // Open on a completed click, not while the mouse is still held down.
    onPointerDown={(event) => { if (event.button === 0 && !event.ctrlKey) event.preventDefault(); }}
    onClick={(event) => { if (!event.ctrlKey) setOpen((current) => !current); }}
    className="retro-btn retro-btn-small" aria-label={translateText("Match options")}><MoreHorizontal size={20}/><span>{translateText("More")}</span></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="sky-dropdown">
    <DropdownMenuItem onSelect={onMusic}><Music2 size={16} className="mr-2"/>{translateText("Music ")}{localize(musicOn ? 'on' : 'off')}</DropdownMenuItem>
    <DropdownMenuItem onSelect={onSfx}>{localize(sfxOn ? <Volume2 size={16} className="mr-2"/> : <VolumeX size={16} className="mr-2"/>)}{translateText("Sound effects ")}{localize(sfxOn ? 'on' : 'off')}</DropdownMenuItem>
    <DropdownMenuSeparator/>
    <DropdownMenuItem disabled={surrenderDisabled} onSelect={onSurrender}><Flag size={16} className="mr-2"/>{translateText("Surrender")}</DropdownMenuItem>
    {localize(onNew && <DropdownMenuItem onSelect={onNew}><RotateCcw size={16} className="mr-2"/>{translateText("New game")}</DropdownMenuItem>)}
  </DropdownMenuContent></DropdownMenu>;
}
