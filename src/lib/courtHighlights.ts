import * as THREE from 'three';
import type { ArenaSceneTheme } from './arenaThemes';

interface PieceOnBoard { square: string; type: string; color: 'w' | 'b' }

/** Include en passant: its legal destination is empty but the pawn moves diagonally. */
export function getCaptureTargets(pieces: PieceOnBoard[], selected: string | null, legalMoves: string[]): string[] {
  const mover = pieces.find(piece => piece.square === selected);
  if (!mover) return [];
  const occupants = new Map(pieces.map(piece => [piece.square, piece]));
  return legalMoves.filter(square => {
    const occupant = occupants.get(square);
    return occupant ? occupant.color !== mover.color : mover.type === 'p' && square[0] !== mover.square[0];
  });
}

function roundedPath(size: number, radius: number) {
  const p = new THREE.Shape(), h = size / 2, r = Math.min(radius, h);
  p.moveTo(-h+r,-h); p.lineTo(h-r,-h); p.quadraticCurveTo(h,-h,h,-h+r);
  p.lineTo(h,h-r); p.quadraticCurveTo(h,h,h-r,h);
  p.lineTo(-h+r,h); p.quadraticCurveTo(-h,h,-h,h-r);
  p.lineTo(-h,-h+r); p.quadraticCurveTo(-h,-h,-h+r,-h);
  return p;
}

function frame(size: number, thickness: number, radius: number) {
  const shape = roundedPath(size, radius);
  shape.holes.push(roundedPath(size-thickness*2, Math.max(.015,radius-thickness)));
  const geometry = new THREE.ExtrudeGeometry(shape, {depth:.022,bevelEnabled:true,bevelSize:.006,bevelThickness:.006,bevelSegments:2,steps:1,curveSegments:5});
  geometry.rotateX(-Math.PI/2);
  return geometry;
}

// Shared immutable geometry; materials belong to each visible marker instance.
export const COURT_HIGHLIGHT_GEOMETRY = {
  tileFrame: frame(.94,.042,.11),
  tileTrim: frame(.976,.012,.125),
  plinth: frame(.80,.024,.075),
  studBase: new THREE.CylinderGeometry(.182,.192,.035,24),
  studCap: new THREE.CylinderGeometry(.135,.15,.058,24),
  cornerStud: new THREE.CylinderGeometry(.043,.048,.027,16),
};

export interface CourtTileState {
  selected: boolean; legal: boolean; capture: boolean; hovered: boolean; invalid: boolean;
  lastMove: 'from' | 'to' | null;
}

/** Tint the existing tile, preserving the ivory/sage checker pattern. */
export function courtTileColor(base: string, state: CourtTileState, theme: ArenaSceneTheme): string {
  const color = new THREE.Color(base);
  if (state.lastMove) color.lerp(new THREE.Color(theme.selected), state.lastMove === 'to' ? .16 : .08);
  if (state.legal) color.lerp(new THREE.Color(state.capture ? theme.selected : theme.legal), state.capture ? .13 : .055);
  if (state.hovered) color.lerp(new THREE.Color('#fff2cd'), .17);
  if (state.selected) color.lerp(new THREE.Color(theme.selected), .23);
  if (state.invalid) color.lerp(new THREE.Color(theme.invalid), .28);
  return `#${color.getHexString()}`;
}
