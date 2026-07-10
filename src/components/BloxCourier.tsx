import { forwardRef, useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface CourierMotion { distance: number; speed: number; opacity: number; recovery: number }

const courierGeometry = new Map<string, THREE.BufferGeometry>();
const courierFace = new THREE.PlaneGeometry(.36, .35);
for (let i = 0; i < courierFace.attributes.uv.count; i++) courierFace.attributes.uv.setXY(i, courierFace.attributes.uv.getX(i) / 3, .5 + courierFace.attributes.uv.getY(i) / 2);
function Block({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  const key = size.join(':');
  let geometry = courierGeometry.get(key);
  if (!geometry) { geometry = new RoundedBoxGeometry(...size, 2, Math.min(.025, ...size.map(n => n * .2))); courierGeometry.set(key, geometry); }
  return <mesh position={position} castShadow receiveShadow raycast={() => null}><primitive attach="geometry" object={geometry}/><meshStandardMaterial color={color} roughness={.48}/></mesh>;
}
/** An original block-built mover. Local +Z faces the piece; arms reach its base. */
export const BloxCourier = forwardRef<THREE.Group, { team?: 'w' | 'b'; pushing?: boolean; motion?: MutableRefObject<CourierMotion>; position?: [number, number, number]; rotation?: [number, number, number] }>(function BloxCourier({ team = 'w', pushing = false, motion, position, rotation }, ref) {
  const leftLeg = useRef<THREE.Group>(null), rightLeg = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const materials = useRef<THREE.MeshStandardMaterial[]>([]);
  const previousOpacity = useRef(-1);
  const reducedMotion = useReducedMotion();
  const faceTexture = useTexture('/textures/meme-court-faces.png');
  useEffect(() => {
    if (!pushing) return;
    const list: THREE.MeshStandardMaterial[] = [];
    body.current?.traverse(object => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        object.material.transparent = true;
        list.push(object.material);
      }
    });
    materials.current = list;
  }, [pushing]);
  const shirt = team === 'w' ? '#26c7b0' : '#9575ef';
  useFrame(({ clock }) => {
    const travel = motion?.current;
    if (pushing && !travel) return;
    if (travel?.opacity === 0 && previousOpacity.current === 0) return;
    const phase = travel ? travel.distance * Math.PI * 3 : clock.elapsedTime * 1.7;
    const stride = reducedMotion ? 0 : pushing ? Math.min(1, (travel?.speed ?? 0) / 2) : .04;
    // The stance foot stays flat; only the recovering foot lifts off the board.
    for (const [leg, offset] of [[leftLeg.current, 0], [rightLeg.current, Math.PI]] as const) {
      if (!leg) continue;
      const cycle = Math.sin(phase + offset);
      leg.rotation.x = cycle * .38 * stride;
      leg.position.y = .38 + Math.max(0, cycle) * .035 * stride;
    }
    if (body.current) {
      body.current.position.y = 0;
      body.current.rotation.x = pushing ? .12 * (1 - (travel?.recovery ?? 0)) : 0;
      if (travel && previousOpacity.current !== travel.opacity) {
        for (const material of materials.current) { material.opacity = travel.opacity; material.depthWrite = travel.opacity > .95; }
        previousOpacity.current = travel.opacity;
      }
    }
  });
  return <group ref={ref} position={position} rotation={rotation} visible={!pushing}>
    <group ref={body}>
      {([[-.13,leftLeg],[.13,rightLeg]] as const).map(([x,leg], i)=><group key={i} ref={leg} position={[x,.38,0]}>
        <Block position={[0,-.16,0]} size={[.21,.35,.23]} color="#304560"/>
        <Block position={[0,-.29,.025]} size={[.24,.12,.29]} color="#e8e1cf"/>
        <Block position={[0,-.355,.043]} size={[.25,.055,.34]} color="#fff8e8"/>
        <Block position={[0,-.27,.152]} size={[.16,.025,.027]} color={shirt}/>
        {[-.02,.025,.07].map(z=><Block key={z} position={[0,-.225,z]} size={[.115,.012,.012]} color="#fff9e8"/>)}
      </group>)}
      <Block position={[0,.61,0]} size={[.52,.49,.29]} color={shirt}/>
      <Block position={[0,.408,.012]} size={[.53,.045,.305]} color={team==='w'?'#169889':'#7054bd'}/>
      <Block position={[0,.526,.153]} size={[.26,.115,.028]} color={team==='w'?'#4dd5c2':'#af94ee'}/>
      <Block position={[0,.85,-.116]} size={[.39,.13,.17]} color={team==='w'?'#5bddca':'#b198f3'}/>
      {[-1,1].map(s=><Block key={s} position={[s*.09,.747,.161]} size={[.019,.16,.018]} color="#fff1d6"/>)}
      <Block position={[0,.96,.015]} size={[.37,.35,.35]} color="#ffd289"/>
      <Block position={[0,1.15,.015]} size={[.44,.11,.4]} color="#263951"/>
      <Block position={[0,1.105,.22]} size={[.44,.055,.18]} color={shirt}/>
      {[-1,1].map(side=><group key={side}>
        <group position={[side*.35,.75,0]} rotation={[pushing ? -1.1 : -.08,0,0]}><Block position={[0,-.12,0]} size={[.19,.3,.23]} color={shirt}/><Block position={[0,-.32,0]} size={[.18,.18,.21]} color="#ffd289"/></group>
      </group>)}
      <mesh position={[0,.954,.193]} raycast={()=>null}><primitive attach="geometry" object={courierFace}/><meshStandardMaterial map={faceTexture} transparent alphaTest={.08} depthWrite={false} roughness={.65}/></mesh>
      <mesh position={[0,.63,.157]} rotation={[0,0,Math.PI/4]} raycast={()=>null}><boxGeometry args={[.15,.15,.022]}/><meshStandardMaterial color="#fff2bb"/></mesh>
    </group>
  </group>;
});
