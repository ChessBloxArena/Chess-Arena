// Development-only model inspection. Uses the exact production meshes and materials.
import { Suspense, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { MemeCourtPiece } from '../../src/components/MemeCourtPiece';
import { COURT_ROLES, getCourtModel } from '../../src/lib/memeCourtGeometry';
import '../../src/index.css';
import '../../src/blox.css';
const names = ['Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King'];
function Metrics() {
  const [text, setText] = useState('Measuring…'), timing = useRef({ elapsed: 0, frames: 0 });
  useFrame(({ gl }, delta) => {
    timing.current.elapsed += delta; timing.current.frames++;
    if (timing.current.elapsed > 2) {
      setText(`${Math.round(timing.current.frames / timing.current.elapsed)} fps · ${gl.info.render.calls} draws · ${gl.info.render.triangles.toLocaleString()} triangles`);
      timing.current = { elapsed: 0, frames: 0 };
    }
  });
  return <Html position={[0, -.9, 0]} center style={{ whiteSpace: 'nowrap', font: '12px Nunito', color: '#51667c' }}>{text}</Html>;
}
function Fixture() {
  const [dark, setDark] = useState(false), [reaction, setReaction] = useState(false);
  return <div style={{ height: '100vh', background: '#d9e4ee' }}>
    <header style={{ position: 'absolute', top: 40, left: 50, zIndex: 5, color: '#243a54' }}>
      <p style={{ font: '16px Nunito', letterSpacing: 3 }}>CHESSBLOX</p>
      <h1 style={{ font: '58px Lilita One', margin: '8px 0' }}>THE MEME COURT</h1>
      <p style={{ font: '18px Nunito' }}>Real game models · drag to orbit · scroll to inspect</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button onClick={() => setDark(v => !v)} style={{ padding: '10px 16px', border: '1px solid #728396', borderRadius: 10 }}>{dark ? 'Cream team' : 'Navy team'}</button>
        <button onClick={() => setReaction(v => !v)} style={{ padding: '10px 16px', border: '1px solid #728396', borderRadius: 10 }}>{reaction ? 'Resting pose' : 'Selection reaction'}</button>
      </div>
    </header>
    <Canvas shadows dpr={1} orthographic camera={{ position: [0, 7, 18], zoom: 94, near: .1, far: 80 }} gl={{ antialias: true }}>
      <color attach="background" args={['#d9e4ee']}/>
      <ambientLight intensity={.65}/><hemisphereLight args={['#f5f8ff', '#a39b89', .8]}/>
      <directionalLight position={[-7, 12, 9]} color="#fff4db" intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-normalBias={.012}/>
      <directionalLight position={[7, 5, -5]} intensity={1.7} color="#d5dcff"/>
      <Suspense fallback={null}>
        {COURT_ROLES.map((role, i) => <group key={role} position={[(i - 2.5) * 2.4, 0, 0]}>
          <group scale={2.55} rotation={[0,.28,0]}><MemeCourtPiece type={role} color={dark ? '#283342' : '#fff1d7'} accentColor={dark ? '#78909b' : '#b89b60'} expressive={reaction}/></group>
          <Html center position={[0, -.18, .5]} style={{ font: '20px Lilita One', color: '#253b50' }}>{names[i]}</Html>
        </group>)}
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.035, 0]} receiveShadow><planeGeometry args={[200, 200]}/><meshStandardMaterial color="#e9e8e0" roughness={.7}/></mesh>
      <OrbitControls target={[0, 3.15, 0]} enablePan minZoom={65} maxZoom={250} maxPolarAngle={Math.PI / 2.05}/>
      <Metrics/>
    </Canvas>
    <output style={{ position: 'absolute', bottom: 14, left: 20, font: '11px Nunito', color: '#526577' }}>
      {COURT_ROLES.map(role => { const m = getCourtModel(role, '#fff1d7', '#b89b60'); return `${role.toUpperCase()}: ${Object.values(m.parts).reduce((n, g) => n + (g.attributes.position?.count ?? 0) / 3, 0).toLocaleString()} tris`; }).join(' · ')}
    </output>
  </div>;
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Fixture/>);
