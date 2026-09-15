import { translateText, useLanguage } from '@/lib/i18n';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { Square as ChessSquare } from 'chess.js';
import { Lock, RotateCcw, Unlock } from 'lucide-react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CpuCharacter } from '@/lib/characterTaunts';
import { BOARD_SQUARE_SIZE, pointToBoardSquare, squareToBoardPosition as squareToPos } from '@/lib/boardCoordinates';
import type { MoveFeedback, MoveFeedbackTone } from '@/lib/moveFeedback';
import { useArenaTheme } from '@/hooks/useArenaTheme';
import type { ArenaSceneTheme } from '@/lib/arenaThemes';
import { BloxWorld } from './BloxWorld';
import { MemeCourtPiece } from './MemeCourtPiece';
import { PUSH_IMPACT_TIME } from '@/lib/pushMotion';
import { samplePieceMotion, PIECE_MOVE_DURATION } from '@/lib/pieceMotion';
import { samplePieceDefeat, type DefeatClock } from '@/lib/pieceDefeat';
import type { RefObject } from 'react';
import { CourtSquareHighlight, CourtPieceAccent, CourtKingWarning } from './CourtHighlights';
import { courtTileColor, getCaptureTargets, type CourtTileState } from '@/lib/courtHighlights';
import { CAPTURE_CLEAR, CAPTURE_DURATION, CAPTURE_IMPACT, CAPTURE_HOLD_END, sampleCaptureMotion, sampleCaptureVictim, type CaptureAnimation } from '@/lib/captureMotion';
import { COURT_HEIGHTS, type CourtRole } from '@/lib/memeCourtGeometry';
const BOARD_RAISE = 0.16;
const BOARD_COORDINATE_OFFSET = 4.22 * BOARD_SQUARE_SIZE;
const BOARD_COORDINATE_Y = 0.04;
const CAMERA_TARGET: [number, number, number] = [0, -1.0, 0];
const CAMERA_POSITION_WHITE: [number, number, number] = [0, 12.8, 14.8];
const CAMERA_POSITION_BLACK: [number, number, number] = [0, 12.8, -14.8];
const CAMERA_MIN_POLAR_ANGLE = 0.12;
const CAMERA_MAX_POLAR_ANGLE = 1.4;
const BOARD_SURFACE_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_RAISE);
const SQUARE_MARKER_Y = 0.038;
const DRAG_LIFT = 0.44;
const DRAG_BOARD_LIMIT = 4.35 * BOARD_SQUARE_SIZE;

interface BoardPiece {
  type: string;
  color: 'w' | 'b';
  square: string;
}

interface CaptureGhost {
  attack: CaptureAnimation;
  id: string;
  color: 'w' | 'b';
  type: string;
  position: [number, number, number];
  direction: [number, number];
}

interface DragState {
  square: ChessSquare;
  position: [number, number, number];
  targetSquare: ChessSquare | null;
}

interface ChessSceneProps {
  board: (BoardPiece | null)[][];
  selectedSquare: string | null;
  legalMoves: string[];
  onSquareClick: (square: ChessSquare) => void;
  onPieceDrop?: (from: ChessSquare, to: ChessSquare) => void | Promise<void>;
  cpuMode?: boolean;
  cpuThinking?: boolean;
  cpuCharacter?: CpuCharacter;
  highlightedSquares?: string[];
  invalidSquare?: string | null;
  impactSignal?: { id: string; tone: MoveFeedbackTone } | null;
  moveFeedback?: MoveFeedback | null;
  showcase?: boolean;
  flipped?: boolean;
}

interface SceneProps extends ChessSceneProps {
  viewLocked: boolean;
  viewResetSignal: number;
  sceneTheme: ArenaSceneTheme;
}

interface ChessSceneErrorBoundaryProps {
  children: ReactNode;
}

interface ChessSceneErrorBoundaryState {
  hasError: boolean;
}

class ChessSceneErrorBoundary extends Component<ChessSceneErrorBoundaryProps, ChessSceneErrorBoundaryState> {
  state: ChessSceneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChessSceneErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <ChessSceneUnavailable />;
    }

    return this.props.children;
  }
}

function ChessSceneUnavailable() {
  useLanguage();
  return (
    <div className="chess-scene-fallback">
      <div className="chess-scene-fallback-panel retro-panel">
        <p className="chess-scene-fallback-title">{translateText("3D ARENA UNAVAILABLE")}</p>
        <p className="chess-scene-fallback-copy">
          {translateText("ENABLE WEBGL OR TRY ANOTHER BROWSER.")}
        </p>
      </div>
    </div>
  );
}

function getCameraPosition(flipped?: boolean): [number, number, number] {
  return flipped ? CAMERA_POSITION_BLACK : CAMERA_POSITION_WHITE;
}

function getPieceFacingRotation(color: 'w' | 'b'): number {
  // Models face +Z; each team faces the opposing ranks, independently of the camera.
  return color === 'w' ? Math.PI : 0;
}

function eventToBoardSquare(event: ThreeEvent<MouseEvent | PointerEvent>): ChessSquare | null {
  const boardPoint = new THREE.Vector3();

  if (!event.ray.intersectPlane(BOARD_SURFACE_PLANE, boardPoint)) {
    return null;
  }

  return pointToBoardSquare(boardPoint);
}

function eventToBoardPoint(event: ThreeEvent<MouseEvent | PointerEvent>): THREE.Vector3 | null {
  const boardPoint = new THREE.Vector3();

  if (!event.ray.intersectPlane(BOARD_SURFACE_PLANE, boardPoint)) {
    return null;
  }

  return boardPoint;
}

function clampDragPosition(point: THREE.Vector3): [number, number, number] {
  const x = THREE.MathUtils.clamp(point.x, -DRAG_BOARD_LIMIT, DRAG_BOARD_LIMIT);
  const z = THREE.MathUtils.clamp(point.z, -DRAG_BOARD_LIMIT, DRAG_BOARD_LIMIT);
  return [x, 0, z];
}

function applyGroupOpacity(group: THREE.Group | null, opacity: number) {
  if (!group) return;

  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material.transparent) { material.transparent = true; material.needsUpdate = true; }
      material.opacity = opacity;
      material.depthWrite = !mesh.userData.preserveMaterial && opacity > .97;
    });
  });
}

function PieceBody({ type, pieceColor, accentColor, expressive = false, threatened = false, defeatClock, attack }: { type: string; pieceColor: string; accentColor: string; expressive?: boolean; threatened?: boolean; defeatClock?: RefObject<DefeatClock>; attack?: CaptureAnimation }) {
  return <MemeCourtPiece type={type} color={pieceColor} accentColor={accentColor} expressive={expressive} threatened={threatened} defeatClock={defeatClock} attack={attack} />;
}

function ChessPiece3D({
  type,
  color,
  position,
  square,
  sceneTheme,
  facingRotation = .35,
  moveAnimation,
  isHovered = false,
  isSelected = false,
  isDragging = false,
  dragPosition = null,
  isKingInDanger = false,
  isCheckmatedKing = false,
  onSelect,
  onHover,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  type: string;
  color: 'w' | 'b';
  position: [number, number, number];
  square: ChessSquare;
  sceneTheme: ArenaSceneTheme;
  facingRotation?: number;
  moveAnimation?: {
    id: string;
    from: [number, number, number];
    tone: MoveFeedbackTone;
    piece: string;
    attack?: CaptureAnimation;
    captureTarget?: [number, number, number];
  } | null;
  isHovered?: boolean;
  isSelected?: boolean;
  isDragging?: boolean;
  dragPosition?: [number, number, number] | null;
  isKingInDanger?: boolean;
  isCheckmatedKing?: boolean;
  onSelect: (sq: ChessSquare) => void;
  onHover: (sq: string | null) => void;
  onPress: () => void;
  onDragStart: (sq: ChessSquare, point: THREE.Vector3) => void;
  onDragMove: (sq: ChessSquare, point: THREE.Vector3) => void;
  onDragEnd: (sq: ChessSquare, point: THREE.Vector3) => void;
  onDragCancel: () => void;
}) {
  const pieceColor = color === 'w' ? sceneTheme.whitePiece : sceneTheme.blackPiece;
  const accentColor = color === 'w' ? sceneTheme.whiteAccent : sceneTheme.blackAccent;
  const rotationY = facingRotation;
  const groupRef = useRef<THREE.Group>(null);
  const moveStateRef = useRef<{ id: string | null; elapsed: number }>({ id: null, elapsed: 1 });
  const dangerRef = useRef<{ elapsed: number }>({ elapsed: 0 });
  const defeatClock = useRef<DefeatClock>({ elapsed: 0, active: false });
  useEffect(() => { defeatClock.current = { elapsed: 0, active: isCheckmatedKing }; }, [isCheckmatedKing]);
  const dragMovedRef = useRef(false);
  const pointerGesture = useRef<{ x: number; y: number; origin: THREE.Vector3; dragging: boolean } | null>(null);
  const animationRef = useRef(moveAnimation);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!moveAnimation || moveAnimation.id === moveStateRef.current.id) return;
    animationRef.current = moveAnimation;
    moveStateRef.current = { id: moveAnimation.id, elapsed: 0 };
  }, [moveAnimation]);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (!group) return;

    moveStateRef.current.elapsed += delta;
    dangerRef.current.elapsed += delta;
    if (defeatClock.current.active) defeatClock.current.elapsed += delta;

    const to = new THREE.Vector3(...position);
    let nextPosition = to;
    const animation = animationRef.current;
    const elapsed = animation?.attack ? clock.elapsedTime - animation.attack.startedAt : moveStateRef.current.elapsed;
    const captureTarget = new THREE.Vector3(...(animation?.captureTarget ?? position));
    const distance = animation ? captureTarget.distanceTo(new THREE.Vector3(...animation.from)) : 1;
    const capture = animation?.attack ? sampleCaptureMotion(animation.piece, elapsed, distance, animation.attack.victimHeight, reducedMotion) : null;
    const motion = capture ? { ...capture, sway: 0 } : samplePieceMotion(animation?.piece ?? type, elapsed, reducedMotion);
    const moving = Boolean(animation && elapsed < (capture ? CAPTURE_DURATION : PIECE_MOVE_DURATION) && !isDragging && !reducedMotion);
    if (isDragging && dragPosition) {
      nextPosition = new THREE.Vector3(dragPosition[0], dragPosition[1] + DRAG_LIFT, dragPosition[2]);
    } else if (moving && animation) {
      const from = new THREE.Vector3(...animation.from);
      direction.copy(capture ? captureTarget : to).sub(from).normalize();
      nextPosition = from.lerp(capture ? captureTarget : to, motion.progress);
      if (capture && animation.captureTarget) {
        // En passant hits the pawn on its actual square, then takes the legal destination.
        const t = THREE.MathUtils.smoothstep(elapsed, CAPTURE_CLEAR, CAPTURE_DURATION);
        nextPosition.addScaledVector(to.clone().sub(captureTarget), t);
      }
      nextPosition.y += motion.lift;
      nextPosition.x += direction.z * motion.sway;
      nextPosition.z -= direction.x * motion.sway;
    }

    group.position.copy(nextPosition);

    const dangerShake = isKingInDanger && !isCheckmatedKing && !reducedMotion ? Math.sin(dangerRef.current.elapsed * 48) * 0.026 : 0;
    group.rotation.set(
      (moving ? direction.z * motion.lean : 0),
      rotationY + dangerShake + (moving ? motion.yaw + (capture ? Math.atan2(Math.sin(Math.atan2(direction.x, direction.z) - rotationY), Math.cos(Math.atan2(direction.x, direction.z) - rotationY)) * capture.face : 0) : 0),
      (moving ? -direction.x * motion.lean + motion.roll : 0) + dangerShake * 0.75,
    );

    const focusScale = isDragging ? 1.12 : isSelected ? 1.056 : isHovered ? 1.03 : 1;
    const scalePulse = (isKingInDanger && !isCheckmatedKing && !reducedMotion ? 1 + Math.sin(dangerRef.current.elapsed * 18) * 0.018 : 1) * focusScale;
    const compression = moving ? motion.compression : 0;
    group.scale.set(scalePulse * (1 + compression * .5), scalePulse * (1 - compression), scalePulse * (1 + compression * .5));
  });

  return (
    <group
      ref={groupRef}
      position={!reducedMotion && moveAnimation ? moveAnimation.from : position}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        if (dragMovedRef.current) {
          dragMovedRef.current = false;
          return;
        }
        onSelect(square);
      }}
      onPointerDown={(e) => {
        if ('button' in e && e.button !== 0) return;
        const boardPoint = eventToBoardPoint(e);
        if (!boardPoint) return;

        e.stopPropagation();
        onPress();
        dragMovedRef.current = false;
        pointerGesture.current = { x: e.clientX, y: e.clientY, origin: boardPoint.clone(), dragging: false };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = isDragging ? 'grabbing' : 'pointer';
        onHover(square);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const boardPoint = eventToBoardPoint(e);
        const gesture = pointerGesture.current;
        if (gesture && boardPoint && (gesture.dragging || Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) >= 5)) {
          dragMovedRef.current = true;
          // Preserve the grab offset: a tall hat projects behind the piece's square.
          const dragPoint = new THREE.Vector3(position[0] + boardPoint.x - gesture.origin.x, position[1], position[2] + boardPoint.z - gesture.origin.z);
          if (!gesture.dragging) { gesture.dragging = true; onDragStart(square, new THREE.Vector3(...position)); }
          document.body.style.cursor = 'grabbing';
          onDragMove(square, dragPoint);
          return;
        }
        onHover(square);
      }}
      onPointerUp={(e) => {
        const gesture = pointerGesture.current;
        if (!gesture) return;
        pointerGesture.current = null;
        const boardPoint = eventToBoardPoint(e);
        e.stopPropagation();
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        document.body.style.cursor = 'pointer';

        if (gesture.dragging && boardPoint) {
          onDragEnd(square, new THREE.Vector3(position[0] + boardPoint.x - gesture.origin.x, position[1], position[2] + boardPoint.z - gesture.origin.z));
          return;
        }
        onDragCancel();
      }}
      onPointerCancel={(e) => {
        pointerGesture.current = null;
        dragMovedRef.current = false;
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        document.body.style.cursor = 'default';
        onDragCancel();
      }}
      onPointerOut={() => {
        if (!isDragging) {
          document.body.style.cursor = 'default';
          onHover(null);
        }
      }}
    >
      {(isHovered || isSelected || isDragging || moveAnimation) && <CourtPieceAccent selected={isSelected || isDragging} hovered={isHovered} moveId={moveAnimation?.id} theme={sceneTheme} />}
      <PieceBody type={type} pieceColor={pieceColor} accentColor={accentColor} expressive={isHovered || isSelected || isDragging} threatened={isKingInDanger} defeatClock={defeatClock} attack={animationRef.current?.attack} />
    </group>
  );
}

function CapturedPieceGhost({ id, type, color, position, direction, attack, facingRotation, sceneTheme, onComplete }: CaptureGhost & {
  facingRotation: number; sceneTheme: ArenaSceneTheme; onComplete: (id: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null), burstRef = useRef<THREE.Group>(null);
  const completedRef = useRef(false);
  const defeatClock = useRef<DefeatClock>({ elapsed: 0, active: false });
  const pieceColor = color === 'w' ? sceneTheme.whitePiece : sceneTheme.blackPiece;
  const accentColor = color === 'w' ? sceneTheme.whiteAccent : sceneTheme.blackAccent;
  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime - attack.startedAt;
    const motion = sampleCaptureVictim(attack.piece, elapsed);
    defeatClock.current.elapsed = motion.defeatTime;
    defeatClock.current.active = elapsed > CAPTURE_HOLD_END;
    const pose = samplePieceDefeat(type, motion.defeatTime);
    const group = groupRef.current;
    if (group) {
      group.position.set(position[0] + direction[0] * motion.forward - direction[1] * motion.sideways, position[1] + motion.lift, position[2] + direction[1] * motion.forward + direction[0] * motion.sideways);
      group.rotation.set(attack.piece === 'n' ? 0 : pose.pitch, facingRotation + pose.yaw, attack.piece === 'n' ? 0 : pose.roll);
      group.scale.set(motion.scaleXZ, motion.scaleY, motion.scaleXZ);
      applyGroupOpacity(group, motion.opacity);
    }
    if (burstRef.current) {
      const age = elapsed - CAPTURE_IMPACT;
      burstRef.current.visible = age >= 0 && age < .32;
      const growth = 1 + Math.max(0, age - .14) * 4;
      burstRef.current.scale.setScalar(growth);
      applyGroupOpacity(burstRef.current, 1 - THREE.MathUtils.smoothstep(age, .14, .32));
    }
    if (elapsed >= CAPTURE_CLEAR && !completedRef.current) { completedRef.current = true; onComplete(id); }
  });
  return <>
    <group ref={groupRef} position={position} rotation={[0, facingRotation, 0]}>
      <PieceBody type={type} pieceColor={pieceColor} accentColor={accentColor} defeatClock={defeatClock}/>
    </group>
    <group ref={burstRef} visible={false} position={[position[0], position[1] + (attack.piece === 'n' ? attack.victimHeight : .95), position[2]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[.42, .024, 6, 32]}/><meshBasicMaterial color="#fff3ae" transparent depthWrite={false}/></mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = i * Math.PI / 4;
        return <mesh key={i} position={[Math.cos(a) * .48, Math.sin(a) * .36, .12]} rotation={[0, 0, a]}><boxGeometry args={[.19, .045, .045]}/><meshBasicMaterial color={i % 2 ? '#ffffff' : '#ffcd48'} transparent depthWrite={false}/></mesh>;
      })}
    </group>
  </>;
}

function KingDangerMarker({ square, sceneTheme }: { square: string; sceneTheme: ArenaSceneTheme }) {
  return <group position={squareToPos(square)} scale={[BOARD_SQUARE_SIZE, 1, BOARD_SQUARE_SIZE]}>
    <CourtKingWarning theme={sceneTheme}/>
  </group>;
}

function BoardSquares({
  onSquareClick,
  selectedSquare,
  legalMoves,
  draggableSquares = [],
  captureSquares = [],
  highlightedSquares = [],
  invalidSquare = null,
  hoveredSquare,
  onSquareHover,
  onPieceDragStart,
  onPieceDragMove,
  onPieceDragEnd,
  onPieceDragCancel,
  sceneTheme,
}: {
  onSquareClick: (sq: ChessSquare) => void;
  selectedSquare: string | null;
  legalMoves: string[];
  draggableSquares?: string[];
  captureSquares?: string[];
  highlightedSquares?: string[];
  invalidSquare?: string | null;
  hoveredSquare: string | null;
  onSquareHover: (sq: string | null) => void;
  onPieceDragStart: (sq: ChessSquare, point: THREE.Vector3) => void;
  onPieceDragMove: (sq: ChessSquare, point: THREE.Vector3) => void;
  onPieceDragEnd: (sq: ChessSquare, point: THREE.Vector3) => void;
  onPieceDragCancel: () => void;
  sceneTheme: ArenaSceneTheme;
}) {
  const squares: ReactNode[] = [];
  const draggingSquareRef = useRef<{ square: ChessSquare; moved: boolean } | null>(null);
  const suppressSquareClickRef = useRef<ChessSquare | null>(null);

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const isLight = (rank + file) % 2 !== 0;
      const sqName = `${String.fromCharCode(97 + file)}${rank + 1}` as ChessSquare;
      const isSelected = selectedSquare === sqName;
      const isLegal = legalMoves.includes(sqName);
      const isHighlighted = highlightedSquares.includes(sqName);
      const isHovered = hoveredSquare === sqName;
      const isInvalid = invalidSquare === sqName;
      const canDragFromSquare = draggableSquares.includes(sqName);

      const markerState: CourtTileState = {
        selected: isSelected, legal: isLegal, capture: isLegal && captureSquares.includes(sqName),
        hovered: isHovered, invalid: isInvalid,
        lastMove: isHighlighted ? highlightedSquares[highlightedSquares.length - 1] === sqName ? 'to' : 'from' : null,
      };
      const color = courtTileColor(isLight ? sceneTheme.lightSquare : sceneTheme.darkSquare, markerState, sceneTheme);

      squares.push(
        <group
          key={sqName}
          position={squareToPos(sqName)}
          onClick={(e) => {
            e.stopPropagation();
            if (suppressSquareClickRef.current === sqName) {
              suppressSquareClickRef.current = null;
              return;
            }
            onSquareClick(eventToBoardSquare(e) ?? sqName);
          }}
          onPointerDown={(e) => {
            if (!canDragFromSquare || ('button' in e && e.button !== 0)) return;
            const boardPoint = eventToBoardPoint(e);
            if (!boardPoint) return;

            e.stopPropagation();
            draggingSquareRef.current = { square: sqName, moved: false };
            document.body.style.cursor = 'grabbing';
            (e.target as Element).setPointerCapture?.(e.pointerId);
            onPieceDragStart(sqName, boardPoint);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
            onSquareHover(eventToBoardSquare(e) ?? sqName);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            const boardPoint = eventToBoardPoint(e);
            if (draggingSquareRef.current?.square === sqName && boardPoint) {
              draggingSquareRef.current.moved = true;
              document.body.style.cursor = 'grabbing';
              onPieceDragMove(sqName, boardPoint);
              return;
            }
            onSquareHover(boardPoint ? pointToBoardSquare(boardPoint) ?? sqName : sqName);
          }}
          onPointerUp={(e) => {
            if (draggingSquareRef.current?.square !== sqName) return;
            const boardPoint = eventToBoardPoint(e);
            const wasMoved = draggingSquareRef.current.moved;
            draggingSquareRef.current = null;
            e.stopPropagation();
            (e.target as Element).releasePointerCapture?.(e.pointerId);
            document.body.style.cursor = 'pointer';

            if (wasMoved && boardPoint) {
              suppressSquareClickRef.current = sqName;
              onPieceDragEnd(sqName, boardPoint);
              return;
            }

            onPieceDragCancel();
          }}
          onPointerOut={() => {
            if (!draggingSquareRef.current) {
              document.body.style.cursor = 'default';
              onSquareHover(null);
            }
          }}
          onPointerCancel={(e) => {
            if (draggingSquareRef.current?.square !== sqName) return;
            draggingSquareRef.current = null;
            (e.target as Element).releasePointerCapture?.(e.pointerId);
            onPieceDragCancel();
          }}
        >
          <mesh position={[0, -0.04, 0]} receiveShadow>
            <boxGeometry args={[BOARD_SQUARE_SIZE - .008, 0.08, BOARD_SQUARE_SIZE - .008]} />
            <meshStandardMaterial color={color} roughness={.8} />
          </mesh>
          {(isSelected || isLegal || isHighlighted || isHovered || isInvalid) && <group scale={[BOARD_SQUARE_SIZE, 1, BOARD_SQUARE_SIZE]}>
            <CourtSquareHighlight state={markerState} theme={sceneTheme}/>
          </group>}
        </group>
      );
    }
  }

  return <>{squares}</>;
}

function BoardCoordinateLabel({
  children,
  position,
  color,
  rotationZ = 0,
  opacity = 1,
}: {
  children: string;
  position: [number, number, number];
  color: string;
  rotationZ?: number;
  opacity?: number;
}) {
  return (
    <Text
      position={position}
      rotation={[-Math.PI / 2, 0, rotationZ]}
      fontSize={0.24}
      anchorX="center"
      anchorY="middle"
      renderOrder={8}
    >
      {children}
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={opacity} depthWrite={false} />
    </Text>
  );
}

function BoardCoordinates({
  flipped = false,
  sceneTheme,
}: {
  flipped?: boolean;
  sceneTheme: ArenaSceneTheme;
}) {
  const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const nearFileZ = flipped ? -BOARD_COORDINATE_OFFSET : BOARD_COORDINATE_OFFSET;
  const farFileZ = flipped ? BOARD_COORDINATE_OFFSET : -BOARD_COORDINATE_OFFSET;
  const nearFileRotation = flipped ? Math.PI : 0;
  const farFileRotation = flipped ? 0 : Math.PI;
  const nearRankX = flipped ? BOARD_COORDINATE_OFFSET : -BOARD_COORDINATE_OFFSET;
  const farRankX = flipped ? -BOARD_COORDINATE_OFFSET : BOARD_COORDINATE_OFFSET;
  const nearRankRotation = flipped ? Math.PI / 2 : -Math.PI / 2;
  const farRankRotation = flipped ? -Math.PI / 2 : Math.PI / 2;

  return (
    <>
      {files.map((file, index) => {
        const x = (index - 3.5) * BOARD_SQUARE_SIZE;
        return (
          <group key={`file-${file}`}>
            <BoardCoordinateLabel position={[x, BOARD_COORDINATE_Y, nearFileZ]} color={sceneTheme.line} rotationZ={nearFileRotation}>
              {file}
            </BoardCoordinateLabel>
            <BoardCoordinateLabel position={[x, BOARD_COORDINATE_Y, farFileZ]} color={sceneTheme.line} rotationZ={farFileRotation} opacity={0.36}>
              {file}
            </BoardCoordinateLabel>
          </group>
        );
      })}

      {ranks.map((rank, index) => {
        const z = (3.5 - index) * BOARD_SQUARE_SIZE;
        return (
          <group key={`rank-${rank}`}>
            <BoardCoordinateLabel position={[nearRankX, BOARD_COORDINATE_Y, z]} color={sceneTheme.line} rotationZ={nearRankRotation}>
              {rank}
            </BoardCoordinateLabel>
            <BoardCoordinateLabel position={[farRankX, BOARD_COORDINATE_Y, z]} color={sceneTheme.line} rotationZ={farRankRotation} opacity={0.36}>
              {rank}
            </BoardCoordinateLabel>
          </group>
        );
      })}
    </>
  );
}

function Scene({
  board,
  selectedSquare,
  legalMoves,
  onSquareClick,
  onPieceDrop,
  cpuMode,
  cpuThinking,
  highlightedSquares,
  invalidSquare,
  showcase,
  flipped,
  viewLocked,
  viewResetSignal,
  impactSignal,
  moveFeedback,
  sceneTheme,
}: SceneProps) {
  const pieces: { type: string; color: 'w' | 'b'; square: ChessSquare }[] = [];
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const boardGroupRef = useRef<THREE.Group>(null);
  const impactRef = useRef<{ id: string | null; elapsed: number; tone: MoveFeedbackTone }>({
    id: null,
    elapsed: 1,
    tone: 'move',
  });
  const [captureGhosts, setCaptureGhosts] = useState<CaptureGhost[]>([]);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const { camera, size, clock } = useThree();
  const captureEpoch = useMemo(() => ({ id: moveFeedback?.id, startedAt: clock.elapsedTime }), [clock, moveFeedback?.id]);
  const attack = useMemo<CaptureAnimation | undefined>(() => moveFeedback?.captured ? { startedAt: captureEpoch.startedAt, piece: moveFeedback.piece, victimHeight: COURT_HEIGHTS[moveFeedback.captured as CourtRole] } : undefined, [captureEpoch, moveFeedback]);
  const reducedMotion = useReducedMotion();
  useEffect(() => { if (reducedMotion) { setCaptureGhosts([]); } }, [reducedMotion]);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece) {
        pieces.push({ type: piece.type, color: piece.color as 'w' | 'b', square: piece.square as ChessSquare });
      }
    }
  }

  useEffect(() => {
    const aspect = size.width / size.height;
    const fit = showcase ? Math.max(.90, 1.16 / aspect) : Math.max(.84, (aspect < .85 ? 1.04 : 1.12) / aspect);
    const basePosition = aspect < .85 ? new THREE.Vector3(0, 17.1, flipped ? -10.5 : 10.5) : new THREE.Vector3(...getCameraPosition(flipped));
    const position = basePosition.sub(new THREE.Vector3(...CAMERA_TARGET)).multiplyScalar(fit).add(new THREE.Vector3(...CAMERA_TARGET));
    camera.position.copy(position);
    camera.lookAt(...CAMERA_TARGET);
    controlsRef.current?.target.set(...CAMERA_TARGET);
    controlsRef.current?.saveState();
    controlsRef.current?.update();
  }, [camera, flipped, size.width, size.height, showcase]);

  useEffect(() => {
    if (viewResetSignal === 0) return;
    controlsRef.current?.reset();
  }, [viewResetSignal]);

  useEffect(() => {
    if (!impactSignal || impactSignal.id === impactRef.current.id) return;
    impactRef.current = {
      id: impactSignal.id,
      elapsed: 0,
      tone: impactSignal.tone,
    };
  }, [impactSignal]);

  useEffect(() => {
    if (!moveFeedback) { setCaptureGhosts([]); return; }
    if (reducedMotion || !moveFeedback.captured || !attack) return;

    const capturedType = moveFeedback.captured;
    const capturedColor = moveFeedback.color === 'w' ? 'b' : 'w';
    const capturePosition = squareToPos(moveFeedback.capturedSquare ?? moveFeedback.to);
    const fromPosition = squareToPos(moveFeedback.from);
    const directionX = capturePosition[0] - fromPosition[0];
    const directionZ = capturePosition[2] - fromPosition[2];
    const directionLength = Math.hypot(directionX, directionZ) || 1;
    setCaptureGhosts((currentGhosts) => [
      ...currentGhosts.filter((ghost) => ghost.id !== moveFeedback.id),
      {
        id: moveFeedback.id,
        attack,
        color: capturedColor,
        type: capturedType,
        position: capturePosition,
        direction: [directionX / directionLength, directionZ / directionLength],
      },
    ]);
  }, [moveFeedback, reducedMotion, attack]);

  useEffect(() => {
    if (dragState) return;
    document.body.style.cursor = 'default';
  }, [dragState]);

  const pauseCameraGesture = useCallback(() => {
    // Stop orbit on the initial press, before the piece's drag threshold is crossed.
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, []);

  const resumeCameraGesture = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = !showcase && !viewLocked;
  }, [showcase, viewLocked]);

  const captureBusy = useCallback(() => !reducedMotion && Boolean(attack && clock.elapsedTime - attack.startedAt < CAPTURE_DURATION), [attack, clock, reducedMotion]);
  const handleSquareClick = useCallback((square: ChessSquare) => { if (!captureBusy()) onSquareClick(square); }, [captureBusy, onSquareClick]);

  const handlePieceDragStart = useCallback((square: ChessSquare, point: THREE.Vector3) => {
    pauseCameraGesture();
    if (!onPieceDrop || captureBusy()) return;
    const targetSquare = pointToBoardSquare(point);
    setHoveredSquare(targetSquare);
    setDragState({
      square,
      position: clampDragPosition(point),
      targetSquare,
    });
  }, [onPieceDrop, pauseCameraGesture, captureBusy]);

  const handlePieceDragMove = useCallback((square: ChessSquare, point: THREE.Vector3) => {
    if (!onPieceDrop || captureBusy()) return;
    const targetSquare = pointToBoardSquare(point);
    setHoveredSquare(targetSquare);
    setDragState((currentDrag) => {
      if (!currentDrag || currentDrag.square !== square) return currentDrag;
      return {
        square,
        position: clampDragPosition(point),
        targetSquare,
      };
    });
  }, [onPieceDrop, captureBusy]);

  const handlePieceDragEnd = useCallback((square: ChessSquare, point: THREE.Vector3) => {
    resumeCameraGesture();
    const targetSquare = pointToBoardSquare(point) ?? dragState?.targetSquare ?? square;
    setDragState(null);
    setHoveredSquare(null);
    document.body.style.cursor = 'default';

    if (!onPieceDrop || captureBusy()) return;
    void onPieceDrop(square, targetSquare);
  }, [dragState?.targetSquare, onPieceDrop, resumeCameraGesture, captureBusy]);

  const handlePieceDragCancel = useCallback(() => {
    resumeCameraGesture();
    setDragState(null);
    setHoveredSquare(null);
    document.body.style.cursor = 'default';
  }, [resumeCameraGesture]);

  useFrame((_, delta) => {
    const boardGroup = boardGroupRef.current;
    if (!boardGroup) return;

    impactRef.current.elapsed += delta;
    const elapsed = impactRef.current.elapsed - PUSH_IMPACT_TIME;
    if (elapsed < 0) return;
    const duration = 0.42;

    if (reducedMotion || impactRef.current.tone === 'move' || elapsed >= duration) {
      boardGroup.position.set(0, BOARD_RAISE, 0);
      boardGroup.rotation.set(0, 0, 0);
      return;
    }

    const decay = 1 - elapsed / duration;
    const strength = impactRef.current.tone === 'capture'
      ? 0.024
      : impactRef.current.tone === 'check' || impactRef.current.tone === 'checkmate'
        ? 0.02
        : impactRef.current.tone === 'promotion'
          ? 0.026
          : 0.014;
    const shake = Math.sin(elapsed * 74) * strength * decay;
    const lift = Math.sin(elapsed * Math.PI / duration) * strength * 0.42;

    boardGroup.position.set(shake, BOARD_RAISE + lift, -shake * 0.45);
    boardGroup.rotation.set(0, 0, shake * 0.016);
  });

  return (
    <>
      <fog attach="fog" args={['#a9c4e5', 30 * Math.max(1, size.height / size.width), 75 * Math.max(1, size.height / size.width)]} />
      <BloxWorld animated={!reducedMotion} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#eef4ff', '#778b9f', 0.85]} />
      <directionalLight position={[-8, 16, 6]} intensity={1.85} color="#fff1df" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14}
        shadow-camera-top={14} shadow-camera-bottom={-14} shadow-camera-near={1} shadow-camera-far={48}
        shadow-bias={-.0005} shadow-normalBias={.018} shadow-radius={3} />
      <directionalLight position={[8, 5, -10]} intensity={1} color="#c5d0ff" />
      <group ref={boardGroupRef} position={[0, BOARD_RAISE, 0]}>
        <BoardCoordinates flipped={flipped} sceneTheme={sceneTheme} />
        <BoardSquares
          onSquareClick={handleSquareClick}
          selectedSquare={selectedSquare}
          legalMoves={legalMoves}
          draggableSquares={pieces.map((piece) => piece.square)}
          captureSquares={getCaptureTargets(pieces, selectedSquare, legalMoves)}
          highlightedSquares={highlightedSquares}
          invalidSquare={invalidSquare}
          hoveredSquare={hoveredSquare}
          onSquareHover={setHoveredSquare}
          onPieceDragStart={handlePieceDragStart}
          onPieceDragMove={handlePieceDragMove}
          onPieceDragEnd={handlePieceDragEnd}
          onPieceDragCancel={handlePieceDragCancel}
          sceneTheme={sceneTheme}
        />

        {moveFeedback?.targetKingSquare && (
          <KingDangerMarker square={moveFeedback.targetKingSquare} sceneTheme={sceneTheme} />
        )}


        {pieces.map((p) => (
          <ChessPiece3D
            key={`${p.square}-${p.color}-${p.type}`}
            type={p.type}
            color={p.color}
            position={squareToPos(p.square)}
            square={p.square}
            sceneTheme={sceneTheme}
            facingRotation={getPieceFacingRotation(p.color)}
            moveAnimation={
              moveFeedback && moveFeedback.to === p.square && moveFeedback.color === p.color
                ? {
                    id: moveFeedback.id,
                    from: squareToPos(moveFeedback.from),
                    tone: moveFeedback.tone,
                    piece: moveFeedback.piece,
                    attack,
                    captureTarget: moveFeedback.captured ? squareToPos(moveFeedback.capturedSquare ?? moveFeedback.to) : undefined,
                  }
                : moveFeedback?.san.startsWith('O-O') && p.type === 'r' && p.color === moveFeedback.color && p.square === `${moveFeedback.san.startsWith('O-O-O') ? 'd' : 'f'}${moveFeedback.to[1]}`
                  ? { id: `${moveFeedback.id}-rook`, from: squareToPos(`${moveFeedback.san.startsWith('O-O-O') ? 'a' : 'h'}${moveFeedback.to[1]}`), tone: 'move', piece: 'r' }
                  : null
            }
            isHovered={hoveredSquare === p.square}
            isSelected={selectedSquare === p.square}
            isDragging={dragState?.square === p.square}
            dragPosition={dragState?.square === p.square ? dragState.position : null}
            isKingInDanger={p.type === 'k' && moveFeedback?.targetKingSquare === p.square}
            isCheckmatedKing={p.type === 'k' && moveFeedback?.targetKingSquare === p.square && moveFeedback.isCheckmate}
            onSelect={handleSquareClick}
            onHover={setHoveredSquare}
            onPress={pauseCameraGesture}
            onDragStart={handlePieceDragStart}
            onDragMove={handlePieceDragMove}
            onDragEnd={handlePieceDragEnd}
            onDragCancel={handlePieceDragCancel}
          />
        ))}

        {!reducedMotion && captureGhosts.map((ghost) => (
          <CapturedPieceGhost
            key={ghost.id}
            id={ghost.id}
            type={ghost.type}
            color={ghost.color}
            position={ghost.position}
            direction={ghost.direction}
            attack={ghost.attack}
            facingRotation={getPieceFacingRotation(ghost.color)}
            sceneTheme={sceneTheme}
            onComplete={(id) => {
              setCaptureGhosts((currentGhosts) => currentGhosts.filter((currentGhost) => currentGhost.id !== id));
            }}
          />
        ))}

      </group>

      <OrbitControls
        ref={controlsRef}
        enabled={!showcase && !viewLocked && !dragState}
        enablePan={false}
        enableZoom={!showcase && !viewLocked && !dragState}
        enableRotate={!showcase && !viewLocked && !dragState}
        minDistance={8}
        maxDistance={Math.max(26, 24 * Math.max(1, .98 / (size.width / size.height)))}
        minPolarAngle={CAMERA_MIN_POLAR_ANGLE}
        maxPolarAngle={CAMERA_MAX_POLAR_ANGLE}
        target={CAMERA_TARGET}
      />
    </>
  );
}

export default function ChessScene(props: ChessSceneProps) {
  useLanguage();
  // Orbit is available immediately; players can lock the view when they prefer.
  const [viewLocked, setViewLocked] = useState(false);
  const [viewResetSignal, setViewResetSignal] = useState(0);
  const { theme } = useArenaTheme();
  const showViewControls = !props.showcase;

  return (
    <div className="chess-canvas-container">
      {showViewControls && (
        <div className="chess-scene-controls" aria-label={translateText("Camera controls")}>
          <button
            type="button"
            className="chess-scene-control"
            onClick={() => setViewResetSignal((signal) => signal + 1)}
            aria-label={translateText("Reset camera view")}
            title={translateText("Reset camera view")}
          >
            <RotateCcw aria-hidden="true" size={16} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="chess-scene-control"
            onClick={() => setViewLocked((locked) => !locked)}
            aria-label={translateText(viewLocked ? 'Unlock camera view' : 'Lock camera view')}
            aria-pressed={viewLocked}
            title={translateText(viewLocked ? 'Unlock camera view' : 'Lock camera view')}
          >
            {viewLocked ? (
              <Lock aria-hidden="true" size={16} strokeWidth={2.4} />
            ) : (
              <Unlock aria-hidden="true" size={16} strokeWidth={2.4} />
            )}
          </button>

        </div>
      )}
      <div className="chess-scene-atmosphere" aria-hidden="true" />
      <div className="chess-scene-vignette" aria-hidden="true" />
      <div className="chess-scene-scanlines" aria-hidden="true" />
      <ChessSceneErrorBoundary>
        <Canvas
          shadows
          camera={{ position: getCameraPosition(props.flipped), fov: props.showcase ? 47 : 44 }}
          gl={{
            antialias: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
          }}
          dpr={[1, 1.5]}
        >
          <Scene {...props} viewLocked={viewLocked} viewResetSignal={viewResetSignal} sceneTheme={theme.scene} />
        </Canvas>
      </ChessSceneErrorBoundary>
    </div>
  );
}
