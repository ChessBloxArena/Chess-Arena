import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { COURT_ROLES, getCourtModel, type ArmJoints, type CourtRole } from '@/lib/memeCourtGeometry';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { sampleCaptureMotion, type CaptureAnimation } from '@/lib/captureMotion';
import { samplePieceDefeat, type DefeatClock } from '@/lib/pieceDefeat';

function CourtArm({ joints, upper, lower, side, attack, reduced }: {
  joints: ArmJoints; upper: THREE.BufferGeometry; lower: THREE.BufferGeometry;
  side: number; attack?: CaptureAnimation; reduced: boolean;
}) {
  const upperRef = useRef<THREE.Group>(null), lowerRef = useRef<THREE.Group>(null);
  const rig = useMemo(() => {
    const shoulder = new THREE.Vector3(...joints.shoulder), elbow = new THREE.Vector3(...joints.elbow), hand = new THREE.Vector3(...joints.hand);
    return { shoulder, elbow, hand, a: elbow.clone().sub(shoulder), b: hand.clone().sub(elbow), target: new THREE.Vector3(), axis: new THREE.Vector3(), bend: new THREE.Vector3(), nextElbow: new THREE.Vector3(), nextHand: new THREE.Vector3(), scratch: new THREE.Vector3() };
  }, [joints]);
  useFrame(({ clock }) => {
    if (!upperRef.current || !lowerRef.current) return;
    const motion = attack ? sampleCaptureMotion(attack.piece, clock.elapsedTime - attack.startedAt, 1, attack.victimHeight, reduced) : null;
    const amount = (side < 0 ? motion?.leftJab : motion?.rightJab) ?? 0;
    const { shoulder, elbow, hand, a, b, target, axis, bend, nextElbow, nextHand, scratch } = rig;
    upperRef.current.quaternion.identity(); lowerRef.current.quaternion.identity();
    lowerRef.current.position.copy(elbow); lowerRef.current.position.y -= .55;
    if (amount < .001) return;
    target.set(side * .28, attack?.piece === 'n' ? 1.20 : .89, attack?.piece === 'n' ? .18 : .65);
    nextHand.copy(hand).lerp(target, amount);
    axis.copy(nextHand).sub(shoulder);
    const lenA = a.length(), lenB = b.length(), distance = THREE.MathUtils.clamp(axis.length(), Math.abs(lenA - lenB) + .001, lenA + lenB - .001);
    axis.normalize(); nextHand.copy(shoulder).addScaledVector(axis, distance);
    bend.copy(elbow).sub(shoulder); bend.addScaledVector(axis, -bend.dot(axis));
    if (bend.lengthSq() < .00001) { bend.set(side, -.4, 0); bend.addScaledVector(axis, -bend.dot(axis)); }
    bend.normalize();
    const along = (lenA * lenA - lenB * lenB + distance * distance) / (2 * distance);
    nextElbow.copy(shoulder).addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, lenA * lenA - along * along)));
    upperRef.current.quaternion.setFromUnitVectors(scratch.copy(a).normalize(), target.copy(nextElbow).sub(shoulder).normalize());
    lowerRef.current.quaternion.setFromUnitVectors(scratch.copy(b).normalize(), target.copy(nextHand).sub(nextElbow).normalize());
    lowerRef.current.position.copy(nextElbow); lowerRef.current.position.y -= .55;
  });
  return <>
    <group ref={upperRef} position={[joints.shoulder[0], joints.shoulder[1] - .55, joints.shoulder[2]]}><mesh position={joints.shoulder.map(v => -v) as [number, number, number]} castShadow receiveShadow><primitive attach="geometry" object={upper}/><meshStandardMaterial vertexColors roughness={.48}/></mesh></group>
    <group ref={lowerRef} position={[joints.elbow[0], joints.elbow[1] - .55, joints.elbow[2]]}><mesh position={joints.elbow.map(v => -v) as [number, number, number]} castShadow receiveShadow><primitive attach="geometry" object={lower}/><meshStandardMaterial vertexColors roughness={.48}/></mesh></group>
  </>;
}

export const MemeCourtPiece = memo(function MemeCourtPiece({ type, color, accentColor, expressive = false, threatened = false, defeatClock, attack }: {
  type: string; color: string; accentColor: string; expressive?: boolean; threatened?: boolean;
  defeatClock?: RefObject<DefeatClock>; attack?: CaptureAnimation;
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
  useFrame(({ clock }, delta) => {
    if (!head.current) return;
    const defeat = defeatClock?.current?.active ? samplePieceDefeat(role, defeatClock.current.elapsed, reducedMotion) : null;
    if (upperBody.current) {
      upperBody.current.position.y = .55 + (defeat?.bodyDrop ?? 0);
      upperBody.current.rotation.x = defeat?.bodyPitch ?? 0;
      upperBody.current.rotation.y = attack ? sampleCaptureMotion(attack.piece, clock.elapsedTime - attack.startedAt, 1, attack.victimHeight, reducedMotion).twist : 0;
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
    <CourtArm joints={model.arms.left} upper={model.parts.leftArm} lower={model.parts.leftForearm} side={-1} attack={attack} reduced={reducedMotion}/>
    <CourtArm joints={model.arms.right} upper={model.parts.rightArm} lower={model.parts.rightForearm} side={1} attack={attack} reduced={reducedMotion}/>
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
