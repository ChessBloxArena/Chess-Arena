import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { COURT_ROLES, getCourtModel, type CourtRole } from '@/lib/memeCourtGeometry';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { samplePieceDefeat, type DefeatClock } from '@/lib/pieceDefeat';

export const MemeCourtPiece = memo(function MemeCourtPiece({ type, color, accentColor, expressive = false, threatened = false, defeatClock }: {
  type: string; color: string; accentColor: string; expressive?: boolean; threatened?: boolean;
  defeatClock?: RefObject<DefeatClock>;
}) {
  const role = COURT_ROLES.includes(type as CourtRole) ? type as CourtRole : 'p';
  const model = useMemo(() => getCourtModel(role, color, accentColor), [role, color, accentColor]);
  const atlas = useTexture('/textures/meme-court-faces.png');
  useEffect(() => {
    if (atlas.colorSpace !== THREE.SRGBColorSpace) {
      atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; atlas.needsUpdate = true;
    }
  }, [atlas]);
  const head = useRef<THREE.Group>(null);
  const upperBody = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const reducedMotion = useReducedMotion();
  useFrame((_, delta) => {
    if (!head.current) return;
    const defeat = defeatClock?.current?.active ? samplePieceDefeat(role, defeatClock.current.elapsed, reducedMotion) : null;
    if (upperBody.current) {
      upperBody.current.position.y = .55 + (defeat?.bodyDrop ?? 0);
      upperBody.current.rotation.x = defeat?.bodyPitch ?? 0;
    }
    if (leftLeg.current) leftLeg.current.rotation.x = defeat?.leftLeg ?? 0;
    if (rightLeg.current) rightLeg.current.rotation.x = defeat?.rightLeg ?? 0;
    head.current.rotation.x = defeat?.headPitch ?? 0;
    const tilt = reducedMotion ? 0 : threatened ? -.14 : expressive ? .11 : 0;
    head.current.rotation.z = defeat ? defeat.headRoll : THREE.MathUtils.damp(head.current.rotation.z, tilt, 10, delta);
    head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, reducedMotion ? 0 : expressive ? -.16 : 0, 10, delta);
  });
  return <group key={`${role}-${color}-${accentColor}`} scale={model.scale}>
    <mesh castShadow receiveShadow><primitive attach="geometry" object={model.parts.base}/><meshStandardMaterial vertexColors roughness={.48}/></mesh>
    <group ref={leftLeg} position={[-.155,.55,-.023]}><mesh position={[.155,-.55,.023]} castShadow receiveShadow><primitive attach="geometry" object={model.parts.leftLeg}/><meshStandardMaterial vertexColors roughness={.48}/></mesh></group>
    <group ref={rightLeg} position={[.155,.55,-.023]}><mesh position={[-.155,-.55,.023]} castShadow receiveShadow><primitive attach="geometry" object={model.parts.rightLeg}/><meshStandardMaterial vertexColors roughness={.48}/></mesh></group>
    <group ref={upperBody} position={[0,.55,0]}>
    <mesh position={[0,-.55,0]} castShadow receiveShadow><primitive attach="geometry" object={model.parts.body}/><meshStandardMaterial vertexColors roughness={.48} /></mesh>
    {model.parts.metal.attributes.position && <mesh position={[0,-.55,0]} castShadow><primitive attach="geometry" object={model.parts.metal}/><meshStandardMaterial vertexColors roughness={.3} metalness={.58}/></mesh>}
    <group ref={head} position={[0, model.headY - .55, 0]}>
      <mesh castShadow receiveShadow><primitive attach="geometry" object={model.parts.head}/><meshStandardMaterial vertexColors roughness={.43}/></mesh>
      {model.parts.headMetal.attributes.position && <mesh castShadow><primitive attach="geometry" object={model.parts.headMetal}/><meshStandardMaterial vertexColors roughness={.27} metalness={.6}/></mesh>}
      <mesh userData={{ preserveMaterial: true }}>
        <primitive attach="geometry" object={model.face}/>
        <meshStandardMaterial map={atlas} transparent alphaTest={.08} depthWrite={false} roughness={.65} polygonOffset polygonOffsetFactor={-2}/>
      </mesh>
    </group>
    </group>
  </group>;
});
