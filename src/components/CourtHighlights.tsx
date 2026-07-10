import { memo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { COURT_HIGHLIGHT_GEOMETRY as GEO, type CourtTileState } from '@/lib/courtHighlights';
import type { ArenaSceneTheme } from '@/lib/arenaThemes';
import { PIECE_MOVE_DURATION } from '@/lib/pieceMotion';

const IVORY = '#fff0ce';
const CORNERS = [[-.385,-.385],[.385,-.385],[-.385,.385],[.385,.385]];

function Inlay({color,opacity=1,trim=false}: {color:string;opacity?:number;trim?:boolean}) {
  return <mesh receiveShadow>
    <primitive attach="geometry" object={trim?GEO.tileTrim:GEO.tileFrame}/>
    <meshStandardMaterial color={color} roughness={.38} metalness={.15} transparent={opacity<1} opacity={opacity} depthWrite={opacity>=1}/>
  </mesh>;
}

function CornerStuds({color}: {color:string}) {
  return <>{CORNERS.map(([x,z],i)=><mesh key={i} position={[x,.025,z]} receiveShadow>
    <primitive attach="geometry" object={GEO.cornerStud}/><meshStandardMaterial color={color} roughness={.34} metalness={.24}/>
  </mesh>)}</>;
}

/** Board-sized markers stay attached to their tile; no floating labels or rotating reticles. */
export const CourtSquareHighlight = memo(function CourtSquareHighlight({state,theme}: {state:CourtTileState;theme:ArenaSceneTheme}) {
  const stud = useRef<THREE.Group>(null), age=useRef(0);
  const reducedMotion=useReducedMotion();
  useEffect(()=>{age.current=0;},[state.legal,state.capture]);
  useFrame((_,delta)=>{
    if(!stud.current) return;
    age.current+=delta;
    const enter = reducedMotion ? 1 : 1-Math.exp(-age.current*16)*Math.cos(age.current*20);
    const target=state.hovered?1.18:1;
    const scale=reducedMotion?target:THREE.MathUtils.damp(stud.current.scale.x,target,14,delta);
    stud.current.scale.set(scale,Math.max(.05,enter),scale);
    stud.current.position.y=.032+(state.hovered?.018:0);
  });
  const frameColor=state.invalid?theme.invalid:state.selected?theme.legal:theme.selected;
  const showFrame=state.selected||state.invalid||state.capture||(state.hovered&&state.legal);
  return <group position={[0,.018,0]}>
    {state.lastMove&&!state.selected&&!state.legal&&!state.invalid&&!state.hovered&&<Inlay color={theme.selected} opacity={state.lastMove==='to'?.67:.34}/>}
    {state.hovered&&!state.legal&&!state.selected&&!state.invalid&&<Inlay color={IVORY} opacity={.38}/>}
    {state.legal&&!state.capture&&!state.selected&&!state.hovered&&!state.invalid&&<Inlay color={theme.legal} opacity={.55} trim/>}
    {showFrame&&<>
      <Inlay color={frameColor}/>
      <Inlay color={state.invalid?IVORY:state.capture?IVORY:theme.selected} trim/>
      {(state.selected||state.capture||state.invalid)&&<CornerStuds color={state.invalid?IVORY:state.capture?theme.selected:IVORY}/>}
    </>}
    {state.legal&&!state.capture&&!state.selected&&<group ref={stud} position={[0,.032,0]}>
      <mesh position={[0,.012,0]} receiveShadow><primitive attach="geometry" object={GEO.studBase}/><meshStandardMaterial color={IVORY} roughness={.4}/></mesh>
      <mesh position={[0,.052,0]} castShadow receiveShadow><primitive attach="geometry" object={GEO.studCap}/><meshStandardMaterial color={theme.legal} roughness={.32} metalness={.08}/></mesh>
    </group>}
  </group>;
});

/** Small gold trim follows the figurine's base through its authored move, then fades. */
export function CourtPieceAccent({selected,hovered,moveId,theme}: {selected:boolean;hovered:boolean;moveId?:string;theme:ArenaSceneTheme}) {
  const group=useRef<THREE.Group>(null), material=useRef<THREE.MeshStandardMaterial>(null), age=useRef(0);
  const reducedMotion=useReducedMotion();
  useEffect(()=>{age.current=0;},[moveId]);
  useFrame((_,delta)=>{
    age.current+=delta;
    const moveAlpha=moveId&&!reducedMotion?1-THREE.MathUtils.smoothstep(age.current,PIECE_MOVE_DURATION-.12,PIECE_MOVE_DURATION+.24):0;
    const opacity=selected?1:hovered?.6:moveAlpha;
    if(group.current) group.current.visible=opacity>.01;
    if(material.current) material.current.opacity=opacity;
  });
  return <group ref={group} position={[0,.043,0]}>
    <mesh><primitive attach="geometry" object={GEO.plinth}/><meshStandardMaterial ref={material} color={theme.selected} roughness={.28} metalness={.35} transparent depthWrite={false}/></mesh>
  </group>;
}

export function CourtKingWarning({theme}: {theme:ArenaSceneTheme}) {
  return <group position={[0,.048,0]}><Inlay color={theme.invalid}/><Inlay color={IVORY} trim/><CornerStuds color={theme.invalid}/></group>;
}
