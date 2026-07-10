import { MoreHorizontal, Music2, Volume2, VolumeX, Flag, RotateCcw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
export default function GameActionMenu({ musicOn, sfxOn, onMusic, onSfx, onSurrender, surrenderDisabled, onNew }: {
  musicOn: boolean; sfxOn: boolean; onMusic: () => void; onSfx: () => void;
  onSurrender: () => void; surrenderDisabled: boolean; onNew?: () => void;
}) {
  return <DropdownMenu><DropdownMenuTrigger asChild><button className="retro-btn retro-btn-small" aria-label="Match options"><MoreHorizontal size={20}/><span>More</span></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="sky-dropdown">
    <DropdownMenuItem onSelect={onMusic}><Music2 size={16} className="mr-2"/>Music {musicOn ? 'on' : 'off'}</DropdownMenuItem>
    <DropdownMenuItem onSelect={onSfx}>{sfxOn ? <Volume2 size={16} className="mr-2"/> : <VolumeX size={16} className="mr-2"/>}Sound effects {sfxOn ? 'on' : 'off'}</DropdownMenuItem>
    <DropdownMenuSeparator/>
    <DropdownMenuItem disabled={surrenderDisabled} onSelect={onSurrender}><Flag size={16} className="mr-2"/>Surrender</DropdownMenuItem>
    {onNew && <DropdownMenuItem onSelect={onNew}><RotateCcw size={16} className="mr-2"/>New game</DropdownMenuItem>}
  </DropdownMenuContent></DropdownMenu>;
}
