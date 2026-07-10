import { useLayoutEffect, useRef } from 'react';
import { Environment, useTexture } from '@react-three/drei';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { BOARD_HALF_SIZE } from '@/lib/boardCoordinates';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const C = { ivory:'#eee2c6', edge:'#fff0d1', green:'#226850', sage:'#8eaa7d', gold:'#d5aa53', stone:'#728985', dark:'#205348' };
type V3 = [number, number, number];
/** Interactive 3D castle geometry, batched by surface. The playing grid stays unobstructed. */
function sculpt(build: (b: (p:V3,s:V3,c:string,r?:number)=>void, stud:(p:V3,r:number,h:number,c:string)=>void, roof:(p:V3,r:number,h:number,c:string)=>void)=>void) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (input: THREE.BufferGeometry, p: V3, color: string) => {
    const g = input.index ? input.toNonIndexed() : input;
    if (g !== input) input.dispose();
    g.translate(...p);
    const tint = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i=0;i<colors.length;i+=3) tint.toArray(colors,i);
    g.setAttribute('color',new THREE.BufferAttribute(colors,3)); parts.push(g);
  };
  build((p,s,c,r=.035)=>add(new RoundedBoxGeometry(...s,1,Math.min(r,...s.map(v=>v*.25))),p,c),
    (p,r,h,c)=>add(new THREE.CylinderGeometry(r,r,h,20,1),p,c),
    (p,r,h,c)=>add(new THREE.CylinderGeometry(.05,r,h,4,1).rotateY(Math.PI/4),p,c));
  const merged=mergeGeometries(parts); parts.forEach(p=>p.dispose()); return merged;
}
const EDGE = BOARD_HALF_SIZE + .99;
const castleGeometry = sculpt((box,stud,roof)=>{
  box([0,-.28,0],[12.65,.62,12.65],C.ivory,.10);
  box([0,-.67,0],[12.82,.20,12.82],C.sage,.08);
  box([0,-.85,0],[12.08,.20,12.08],C.dark,.08);
  // Individual porcelain border tiles, with fine seams and an inner gold bead.
  for (const side of [-1,1]) {
    box([side*5.19,.07,0],[.045,.065,10.37],C.gold,.008);
    box([0,.07,side*5.19],[10.37,.065,.045],C.gold,.008);
    for (let i=-4;i<=4;i++) {
      box([side*5.55,.035,i*1.28],[.70,.18,1.272],C.edge,.015);
      box([i*1.28,.035,side*5.55],[1.272,.18,.70],C.edge,.015);
    }
    box([side*EDGE,.16,0],[.61,.38,11.8],C.green,.06);
    box([0,.16,side*EDGE],[11.8,.38,.61],C.green,.06);
    for(let i=-6;i<=6;i++) {
      const u=i*.82;
      // Front/back central opening keeps the view into the court open.
      if (Math.abs(i)>1) box([u,.33,side*EDGE],[.58,.24,.61],C.green,.065);
      box([side*EDGE,.49,u],[.61,.48,.58],C.green,.065);
      stud([side*EDGE,.79,u],.23,.14,C.green);
      stud([u,Math.abs(i)>1?.52:.40,side*EDGE],.23,.14,C.green);
    }
  }
  // Four low, stud-built ivory turrets, each with a small champagne pyramid cap.
  for(const x of [-EDGE,EDGE]) for(const z of [-EDGE,EDGE]) {
    box([x,-.24,z],[1.04,.29,1.04],C.sage,.06);
    for(let row=0;row<4;row++) {
      const y=.14+row*.35;
      if(row%2===0) for(const side of [-1,1]) box([x+side*.211,y,z],[.417,.341,.85],C.ivory,.018);
      else for(const side of [-1,1]) box([x,y,z+side*.211],[.85,.341,.417],C.edge,.018);
    }
    box([x,1.52,z],[1.0,.28,1.0],C.edge,.038);
    box([x,1.69,z],[.69,.085,.69],C.gold,.02);
    roof([x,1.98,z],.44,.50,C.gold);
    stud([x,2.235,z],.045,.03,'#ffe5a0');
    box([x,-.83,z],[.72,.34,.72],C.gold,.04);
    stud([x,-1.07,z],.15,.18,C.gold);
  }
  // Visible ivory masonry courses around the edge, rather than a flat slab.
  for (const side of [-1,1]) for(let i=-4;i<=4;i++) {
    box([i*1.24,-.25,side*6.33],[1.225,.44,.12],i%2?C.ivory:C.edge,.018);
    box([side*6.33,-.25,i*1.24],[.12,.44,1.225],i%2?C.ivory:C.edge,.018);
  }
  // Faceted green underside echoes the floating castle in the chosen reference.
  for(let x=-4;x<=4;x++) for(let z=-4;z<=4;z++) {
    const edge=Math.max(Math.abs(x),Math.abs(z));
    const depth=2.40+(4-edge)*.33+((x*x+z*z*3)%3)*.16;
    box([x*1.29,-.94-depth/2,z*1.29],[1.30,depth,1.30],[C.dark,'#2d6555','#3d7460'][Math.abs(x*3+z)%3],.055);
  }
});
const gardenGeometry = sculpt((box,stud,roof)=>{
  box([0,-.22,0],[4.2,.4,3.6],C.sage,.05);
  box([0,-.65,0],[3.9,.5,3.3],C.stone,.035);
  for(let x=-1;x<=1;x++) for(let z=-1;z<=1;z++) {
    const d=1.0+(2-Math.abs(x)-Math.abs(z))*.45;
    box([x*1.14,-.85-d/2,z*.94],[1.18,d,1.02],['#748e91','#8b9d99','#697f83'][Math.abs(x+z)%3]);
  }
  // A gate with an open doorway, masonry courses, crenellations, and taller back tower.
  for(const s of [-1,1]) {
    box([s*.97,.63,.8],[.90,1.50,.64],C.ivory);
    box([s*1.32,1.56,.74],[.32,.44,.68],C.edge);
    box([s*.65,1.56,.74],[.32,.44,.68],C.edge);
    box([s*1.6,.56,-.2],[.30,1.24,2.2],C.ivory);
    for(let i=0;i<4;i++) box([s*1.6,1.3,-1+i*.55],[.36,.38,.31],C.edge);
  }
  box([0,1.23,.8],[1.15,.38,.64],C.ivory);
  box([0,1.54,.8],[.38,.30,.67],C.edge);
  for(let i=0;i<6;i++) box([.65,.2+i*.33,-.7],[.74,.32,.74],i%2?C.edge:C.ivory);
  box([.65,2.17,-.7],[.87,.19,.87],C.green);
  roof([.65,2.5,-.7],.54,.5,C.gold);
  box([.65,2.99,-.7],[.048,.72,.048],C.gold,.01);
  box([.91,3.16,-.7],[.5,.3,.035],C.green,.01);
  for(const [x,z,s] of [[-1,-.65,.75],[1.55,-1.1,.47],[-1.7,1.25,.42]]) {
    box([x,.5*s,z],[.22*s,1.1*s,.22*s],'#997546');
    box([x,1.23*s,z],[.92*s,.85*s,.9*s],'#69955f',.04);
    box([x-.06,1.79*s,z],[.67*s,.35*s,.68*s],'#96b87a',.035);
  }
  for(let i=0;i<8;i++) stud([-1.7+i*.46,.08,1.45],.085,.10,i%2?C.gold:C.edge);
});
const cloudGeometry = sculpt((box)=>{
  box([0,0,0],[2.6,.58,1.30],'#ffffff',.13);
  box([.48,.39,-.1],[1.12,.64,1.19],'#ffffff',.12);
  box([-.69,.19,.17],[1.20,.55,1.4],'#ffffff',.12);
  box([1.5,-.05,.05],[.80,.42,1.02],'#ffffff',.10);
});
const CLOUDS = [[-8,-2,4,1.2],[7,-3.5,7,1.5],[-5,2,-13,1],[9,2,-5,1.1],[0,-5,-11,1.5],[-14,0,-1,.95],[12,-2,-12,1.8]];
const GARDENS = [[-11,-.6,-6,1.05,.18],[11,-.5,-8,1.10,-.25],[-13,-3,5,.76,.22],[13,-4,5,.82,-.3]];
export function BloxWorld({ animated=true }: { animated?:boolean }) {
  const sky = useTexture('/textures/emerald-sky.png');
  useLayoutEffect(() => {
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.colorSpace = THREE.SRGBColorSpace;
    sky.needsUpdate = true;
  }, [sky]);
  const clouds=useRef<THREE.Group>(null), water=useRef<THREE.Group>(null);
  const reducedMotion=useReducedMotion();
  useFrame(({clock})=>{
    const t=animated&&!reducedMotion?clock.elapsedTime:0;
    clouds.current?.children.forEach((cloud,i)=>{
      const [x,y,z]=CLOUDS[i], phase=i*1.7;
      cloud.position.set(x+(Math.sin(t*(.085+i*.005)+phase)-Math.sin(phase))*2.4,y+Math.sin(t*.19+phase)*.14,z+Math.sin(t*.08+phase)*.4);
    });
    water.current?.children.forEach((fall,i)=>{
      fall.children.forEach((stream,j)=>{
        stream.scale.y=1+Math.sin(t*1.8+j+i)*.055;
      });
    });
  });
  return <group>
    <Environment map={sky} environmentIntensity={.18}/>
    <mesh geometry={castleGeometry} castShadow receiveShadow><meshStandardMaterial vertexColors roughness={.40} metalness={.06}/></mesh>
    {GARDENS.map(([x,y,z,s,r],i)=><mesh key={i} geometry={gardenGeometry} position={[x,y,z]} scale={s} rotation={[0,r,0]} castShadow receiveShadow><meshStandardMaterial vertexColors roughness={.68}/></mesh>)}
    <group ref={water}>{GARDENS.slice(0,2).map(([x,y,z,s],i)=><group key={i} position={[x,y,z+1.38*s]}>
      {[0,1,2,3].map(j=><mesh key={j} position={[(j-1.5)*.19,-2.6,0]}><boxGeometry args={[.15,5.4,.12]}/><meshStandardMaterial color={j%2?'#c7f2f0':'#8edada'} transparent opacity={.63} roughness={.22} depthWrite={false}/></mesh>)}
    </group>)}</group>
    <group ref={clouds}>{CLOUDS.map(([x,y,z,s],i)=><mesh key={i} geometry={cloudGeometry} position={[x,y,z]} scale={s}><meshStandardMaterial color="#f9f7ff" roughness={.95}/></mesh>)}</group>
  </group>;
}
