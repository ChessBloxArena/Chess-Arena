import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type CourtRole = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
type Vec3 = [number, number, number];
type Part = 'base' | 'body' | 'leftLeg' | 'rightLeg' | 'head' | 'metal' | 'headMetal';
export const COURT_ROLES: CourtRole[] = ['p', 'r', 'n', 'b', 'q', 'k'];
export const COURT_HEIGHTS: Record<CourtRole, number> = { p: 1.25, r: 1.53, n: 1.68, b: 1.83, q: 1.62, k: 1.84 };
const HEAD_Y = 1.11;
const modelCache = new Map<string, CourtModel>();
interface CourtModel {
  parts: Record<Part, THREE.BufferGeometry>;
  face: THREE.BufferGeometry;
  scale: number;
  headY: number;
}

/** Actual shared 3D meshes: one draw per material/rig part, not one per clothing detail. */
export function getCourtModel(role: CourtRole, clothColor: string, accentColor: string): CourtModel {
  const key = `${role}:${clothColor}:${accentColor}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const cloth = new THREE.Color(clothColor);
  const dark = cloth.getHSL({ h: 0, s: 0, l: 0 }).l < .42;
  const tint = (amount: number) => cloth.clone().lerp(new THREE.Color(amount > 0 ? '#fff8e9' : '#111b2b'), Math.abs(amount)).getHexString();
  const c = {
    cloth: clothColor, panel: `#${tint(.11)}`, seam: `#${tint(-.2)}`,
    sole: dark ? '#53627b' : '#fff8e9', soleLine: dark ? '#202c44' : '#c9bfa9',
    skin: dark ? '#e9c087' : '#ffd57d', skinShade: dark ? '#c89661' : '#e6b65c',
    trim: dark ? '#a88bed' : '#429b9b', gold: '#d6a13f', goldLight: '#f4d585',
    ink: '#17263b', hair: role === 'q' ? '#6b3822' : '#98502a', hairLight: '#c67b3f',
  };
  const parts: Record<Part, THREE.BufferGeometry[]> = { base: [], body: [], leftLeg: [], rightLeg: [], head: [], metal: [], headMetal: [] };
  let part: Part = 'body';
  function add(geo: THREE.BufferGeometry, pos: Vec3, color: string, rotation: Vec3 = [0, 0, 0]) {
    const geometry = geo.index ? geo.toNonIndexed() : geo;
    if (geometry !== geo) geo.dispose();
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1),
    ));
    const rgb = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts[part].push(geometry);
  }
  const box = (pos: Vec3, size: Vec3, color: string, radius = .02, rot: Vec3 = [0, 0, 0]) =>
    add(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n * .4))), pos, color, rot);
  const ball = (pos: Vec3, radius: number, color: string, scale: Vec3 = [1, 1, 1]) =>
    add(new THREE.SphereGeometry(radius, 12, 8).scale(...scale), pos, color);
  const cylinder = (pos: Vec3, top: number, bottom: number, height: number, color: string, rot: Vec3 = [0, 0, 0]) =>
    add(new THREE.CylinderGeometry(top, bottom, height, 24), pos, color, rot);
  function tube(points: Vec3[], radius: number, color: string, segments = 12) {
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, 5, false), [0, 0, 0], color);
  }
  function ring(pos: Vec3, radius: number, thickness: number, color: string, rot: Vec3 = [0, 0, 0], sx = 1) {
    add(new THREE.TorusGeometry(radius, thickness, 6, 24).scale(sx, 1, 1), pos, color, rot);
  }
  function prism(points: [number, number][], depth: number, pos: Vec3, color: string, bevel = .009, rotation: Vec3 = [0, 0, 0]) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSegments: 2, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 6 });
    geo.translate(0, 0, -depth / 2);
    add(geo, pos, color, rotation);
  }
  const crownEmblem = (pos: Vec3, size = 1) => {
    const outline: [number, number][] = [[-.09, -.055], [-.11, .065], [-.045, .015], [0, .095], [.045, .015], [.11, .065], [.09, -.055]];
    prism(outline.map(([x, y]) => [x * size, y * size]), .009, pos, c.gold, .004);
  };

  part = 'base';
  // Low square plinth leaves space around the feet and makes team color unambiguous.
  box([0, .035, 0], [.70, .07, .66], c.ink, .025);
  box([0, .081, 0], [.675, .042, .635], dark ? c.trim : c.gold, .012);
  box([0, .115, 0], [.66, .042, .62], c.cloth, .016);

  // Sneakers: layered outsole, toe bumper, tongue, eyestay and three raised laces.
  for (const s of [-1, 1]) {
    part = s === -1 ? 'leftLeg' : 'rightLeg';
    const firstLegPart = parts[part].length;
    const x = s * .155;
    box([x, .18, .048], [.257, .09, .36], c.sole, .029);
    box([x, .151, .051], [.26, .025, .361], c.soleLine, .009);
    box([x, .231, .024], [.238, .115, .30], c.panel, .038);
    box([x, .20, .19], [.237, .049, .037], c.sole, .015);
    box([x, .293, .067], [.13, .021, .15], c.cloth, .009, [-.22, 0, 0]);
    box([x, .266, .163], [.16, .022, .04], c.trim, .008);
    for (let j = 0; j < 3; j++) tube([[x - .054, .31 - j * .009, .025 + j * .041], [x, .319 - j * .009, .033 + j * .041], [x + .054, .31 - j * .009, .025 + j * .041]], .006, c.sole, 4);
    for (let j = 0; j < 3; j++) box([x + s * .127, .172, -.06 + j * .055], [.008, .015, .029], c.soleLine, .002);
    // Cargo legs, folded hems and side pocket flaps.
    box([x, .402, -.023], [.226, .30, .242], c.cloth, .023);
    box([x, .293, -.023], [.235, .047, .25], c.panel, .012);
    box([x + s * .122, .429, -.014], [.027, .115, .151], c.panel, .012);
    box([x + s * .14, .471, -.008], [.015, .029, .15], c.seam, .005);
    box([x, .41, .103], [.19, .008, .006], c.seam, .002);
    if ((role === 'p' || role === 'n') && s === -1) {
      const pivot = new THREE.Vector3(x, .55, -.023);
      const pose = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationX(role === 'p' ? -.36 : -.23)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      for (let i = firstLegPart; i < parts[part].length; i++) parts[part][i].applyMatrix4(pose);
    }
  }
  part = 'body';
  // Oversized hoodie with shoulder volume and ribbed hem, not a featureless cube.
  box([0, .738, -.028], [.486, .422, .316], c.cloth, .041);
  box([0, .552, -.023], [.494, .051, .326], c.panel, .014);
  for (let i = -5; i <= 5; i++) box([i * .037, .548, .144], [.006, .03, .005], c.seam, .001);
  box([0, .666, .137], [.274, .10, .031], c.panel, .016);
  tube([[-.128, .716, .158], [-.068, .702, .163], [0, .698, .166], [.068, .702, .163], [.128, .716, .158]], .006, c.seam);
  for (const s of [-1, 1]) tube([[s * .154, .916, .062], [s * .185, .865, .096], [s * .171, .807, .139]], .012, c.seam, 7);
  // A real hood rim wraps around the neck and continues onto the back.
  tube([[-.18, .891, .136], [-.23, .949, -.025], [-.19, 1.00, -.19], [0, 1.03, -.239], [.19, 1.00, -.19], [.23, .949, -.025], [.18, .891, .136]], .039, c.panel, 20);
  for (const s of [-1, 1]) {
    tube([[s * .089, .923, .139], [s * .09, .841, .166], [s * .107, .771, .173]], .012, c.trim, 7);
    box([s * .107, .766, .174], [.018, .035, .018], c.gold, .005);
  }
  if (role !== 'r' && role !== 'b') { part = 'metal'; crownEmblem([0, .797, .152], .62); part = 'body'; }

  // Pose silhouettes stay within a single square. Layered cuffs and mitten thumbs.
  function arm(side: number, pose: 'down' | 'hip' | 'cross' | 'wave' | 'prayer') {
    let shoulder: Vec3 = [side * .302, .839, -.012];
    let elbow: Vec3 = [side * .335, .695, .008];
    let hand: Vec3 = [side * .343, .582, .06];
    if (pose === 'hip') { elbow = [side * .367, .727, .014]; hand = [side * .265, .672, .161]; }
    if (pose === 'cross') { elbow = [side * .32, .751, .11]; hand = [-side * .063, .783 + side * .026, .219]; }
    if (pose === 'wave') { shoulder = [side * .275, .86, -.01]; elbow = [side * .34, .961, .032]; hand = [side * .345, 1.079, .062]; }
    if (pose === 'prayer') { elbow = [side * .29, .726, .08]; hand = [side * .05, .887, .228]; }
    const segment = (a: Vec3, b: Vec3, width: number, color: string) => {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mid = start.clone().add(end).multiplyScalar(.5);
      const geo = new RoundedBoxGeometry(width, start.distanceTo(end) + .06, width * 1.05, 2, .025);
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()));
      add(geo, mid.toArray() as Vec3, color);
    };
    segment(shoulder, elbow, role === 'r' ? .225 : .185, c.cloth);
    segment(elbow, hand, .175, c.panel);
    box([hand[0], hand[1] + (pose === 'wave' ? -.055 : .044), hand[2]], [.182, .049, .192], c.seam, .012);
    box(hand, [.163, .147, .174], c.skin, .027, [pose === 'prayer' ? -.28 : 0, 0, pose === 'wave' ? side * -.15 : 0]);
    box([hand[0] - side * .079, hand[1] + .011, hand[2] + .056], [.059, .091, .073], c.skinShade, .02);
  }
  for (const s of [-1, 1]) arm(s, role === 'r' ? 'cross' : role === 'b' ? 'prayer' : role === 'q' ? 'hip' : (role === 'p' || role === 'n' || role === 'k') && s === 1 ? 'wave' : 'down');

  if (role === 'r') {
    // Padded vest panels, center zip and pocket piping.
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box([s * .142, .825 - i * .087, .142], [.213, .082, .084], c.panel, .024);
    box([0, .769, .20], [.018, .30, .012], c.seam, .003);
    box([0, .858, .207], [.025, .037, .012], c.gold, .004);
  }
  if (role === 'b' || role === 'q') {
    for (const s of [-1, 1]) {
      box([s * .222, .728, .091], [.095, .345, .096], c.panel, .018, [0, 0, -s * .08]);
      if (role === 'b') box([s * .196, .50, -.077], [.112, .224, .281], c.panel, .019, [0, 0, s * .075]);
    }
  }
  if (role === 'n') {
    // The reference knight wears a small rucksack with padded straps and buckles.
    box([0, .752, -.27], [.348, .356, .166], '#a98961', .037);
    box([0, .682, -.36], [.255, .158, .037], '#c2a17b', .022);
    tube([[-.145, .913, -.331], [0, .936, -.353], [.145, .913, -.331]], .008, '#e1c399', 8);
    for (const s of [-1, 1]) {
      tube([[s * .155, .632, .174], [s * .16, .855, .171], [s * .19, .949, .07], [s * .175, .944, -.204], [s * .148, .815, -.324]], .027, '#b89870', 14);
      box([s * .157, .788, .199], [.047, .063, .016], c.goldLight, .006);
      box([s * .157, .788, .21], [.021, .034, .008], '#79634a', .003);
    }
  }
  if (role === 'k') {
    part = 'metal';
    for (let i = 0; i <= 10; i++) {
      const a = i / 10 * Math.PI;
      ring([Math.cos(a) * .149, .904 - Math.sin(a) * .104, .172], .021, .008, i % 2 ? c.gold : c.goldLight, [0, i % 2 * .8, 0]);
    }
    part = 'body';
  }

  part = 'head';
  box([0, 1.108, -.008], [.385, .345, .334], c.skin, .06);
  for (const s of [-1, 1]) box([s * .197, 1.087, -.003], [.04, .075, .07], c.skinShade, .016);

  // Layered tapered locks: the pawn's bacon fringe and queen's long waves.
  function hairLock(points: Vec3[], radius: number, color: string) { tube(points, radius, color, 10); }
  if (role === 'p' || role === 'q') {
    const lengths = role === 'q' ? [.36, .42, .29] : [.15, .17, .11];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const z = .043 - i * .087, y = 1.277 - i * .012;
      hairLock([[s * .139, y, z], [s * .206, y - .095, z], [s * .231, y - lengths[i] + .055, z + .025], [s * .204, y - lengths[i], z + .085]], .036, i === 1 ? c.hairLight : c.hair);
    }
    for (let i = -2; i <= 2; i++) {
      const x = i * .059;
      hairLock([[x - .048, 1.283, .012], [x - .037, 1.279, .114], [x + .012, 1.221 + Math.abs(i) * .004, .18], [x + .029, 1.192 + Math.abs(i) * .013, .17]], .031, i % 2 ? c.hairLight : c.hair);
    }
    if (role === 'q') for (let i = -2; i <= 2; i++) hairLock([[i * .072, 1.256, -.138], [i * .083, 1.099, -.192], [i * .073 + .014, .925, -.193], [i * .085, .873, -.16]], .048, i % 2 ? c.hairLight : c.hair);
  }

  if (role === 'p') {
    cylinder([0, 1.298, -.01], .183, .219, .099, c.cloth);
    ring([0, 1.264, -.01], .203, .022, c.panel, [Math.PI / 2, 0, 0]);
    ball([0, 1.39, -.01], .058, c.panel);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      box([Math.cos(a) * .211, 1.289, Math.sin(a) * .211 - .01], [.009, .035, .011], c.seam, .002, [0, -a, 0]);
    }
  }
  if (role === 'r') {
    box([0, 1.334, -.014], [.464, .195, .403], c.cloth, .022);
    box([0, 1.246, -.014], [.485, .049, .423], c.panel, .015);
    for (const s of [-1, 1]) for (const z of [-1, 1]) box([s * .176, 1.482, z * .15 - .014], [.105, .147, .105], c.panel, .012);
    // Physical sunglasses sit ahead of the decal face; gold hinge pins survive zooming in.
    for (const s of [-1, 1]) {
      box([s * .094, 1.147, .175], [.158, .105, .037], c.ink, .026);
      box([s * .096, 1.162, .196], [.114, .012, .003], '#3d566a', .003, [0, 0, -.15]);
      box([s * .185, 1.156, .086], [.017, .018, .19], c.ink, .004);
    }
    box([0, 1.152, .181], [.044, .022, .025], c.ink, .007);
  }
  if (role === 'n') {
    // Horse hood: open face, angular muzzle, ears, nostrils and raised mane.
    for (const s of [-1, 1]) box([s * .204, 1.18, -.037], [.083, .346, .28], c.panel, .029, [0, 0, -s * .08]);
    box([0, 1.386, -.024], [.427, .25, .351], c.cloth, .065, [-.12, 0, 0]);
    box([0, 1.399, .22], [.348, .173, .253], c.panel, .049, [.11, 0, 0]);
    box([0, 1.327, .226], [.336, .029, .236], c.seam, .009, [.11, 0, 0]);
    for (const s of [-1, 1]) {
      ball([s * .106, 1.444, .34], .018, c.skinShade, [1, 1.2, .4]);
      prism([[-.045, 0], [-.041, .17], [.012, .205], [.046, .034]], .075, [s * .138, 1.492, -.04], c.cloth, .016, [0, 0, -s * .14]);
      prism([[-.025, .03], [-.024, .138], [.006, .16], [.024, .04]], .008, [s * .138, 1.493, .007], c.skinShade, .005, [0, 0, -s * .14]);
      ball([s * .202, 1.423, .071], .04, '#fff8e9', [.18, 1, 1]);
      ball([s * .21, 1.424, .080], .024, c.ink, [.25, 1, 1]);
    }
    for (let i = 0; i < 5; i++) box([0, 1.519 - i * .056, -.118 - i * .026], [.092, .096, .092], i % 2 ? c.hairLight : c.hair, .016, [-.3, 0, 0]);
  }
  if (role === 'b') {
    cylinder([0, 1.3, -.018], .236, .23, .085, c.panel);
    // Two independent beveled lobes leave an actual diagonal slit, not a painted stripe.
    prism([[-.227, 0], [-.258, .24], [-.035, .527], [.068, .282], [-.08, .068]], .228, [0, 1.325, -.014], c.cloth, .018);
    prism([[-.018, .035], [.234, .10], [.188, .348], [.104, .432], [.11, .265]], .228, [0, 1.325, -.014], c.panel, .015);
    part = 'headMetal'; box([0, 1.312, -.018], [.442, .036, .31], c.gold, .008); part = 'head';
  }
  function royalCrown(king: boolean) {
    part = 'headMetal';
    cylinder([0, 1.324, -.014], .251, .221, .115, c.gold);
    ring([0, 1.269, -.014], .222, .017, c.goldLight, [Math.PI / 2, 0, 0]);
    ring([0, 1.374, -.014], .253, .014, c.goldLight, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const x = Math.sin(a) * .242, z = Math.cos(a) * .242 - .014;
      if (king) {
        prism([[-.055, 0], [-.077, .095], [-.04, .171], [.04, .171], [.077, .095], [.055, 0]], .022, [x * .89, 1.368, z * .89], i % 2 ? c.gold : c.goldLight, .008, [0, a, 0]);
        tube([[x, 1.374, z], [x * .81, 1.502, z * .81], [x * .35, 1.568, z * .35], [0, 1.582, -.014]], .025, i % 2 ? c.gold : c.goldLight, 10);
      } else {
        prism([[-.075, 0], [0, .175], [.075, 0]], .029, [x, 1.364, z], c.gold, .008, [0, a, 0]);
        ball([x, 1.548, z], .027, c.goldLight);
      }
    }
    if (king) {
      ball([0, 1.588, -.014], .048, c.goldLight);
      box([0, 1.743, -.014], [.059, .239, .057], c.gold, .009);
      box([0, 1.765, -.014], [.185, .055, .057], c.goldLight, .009);
    }
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      ball([Math.sin(a) * .248, 1.324, Math.cos(a) * .248 - .014], .024, dark ? '#b8a0f0' : '#6bbaa9', [1, 1, .5]);
    }
    part = 'head';
  }
  if (role === 'q' || role === 'k') royalCrown(role === 'k');
  if (role === 'q') {
    // Sunglasses pushed onto the crown, leaving her expression visible.
    for (const s of [-1, 1]) {
      box([s * .103, 1.35, .255], [.171, .101, .028], c.goldLight, .026, [-.25, 0, 0]);
      box([s * .103, 1.351, .272], [.132, .068, .009], c.ink, .017, [-.25, 0, 0]);
    }
    box([0, 1.358, .267], [.047, .02, .02], c.gold, .006);
  }

  // Put the head pivot at the neck for small, event-driven reactions.
  for (const p of ['head', 'headMetal'] as Part[]) for (const geo of parts[p]) geo.translate(0, -HEAD_Y, 0);
  const merged = {} as Record<Part, THREE.BufferGeometry>;
  for (const name of Object.keys(parts) as Part[]) {
    merged[name] = parts[name].length ? mergeGeometries(parts[name]) : new THREE.BufferGeometry();
    parts[name].forEach(g => g.dispose());
    merged[name].computeBoundingSphere();
  }
  const face = new THREE.PlaneGeometry(.373, .373);
  face.translate(0, 1.093 - HEAD_Y, .164);
  const index = COURT_ROLES.indexOf(role), uv = face.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (index % 3 + uv.getX(i)) / 3, (1 - Math.floor(index / 3) + uv.getY(i)) / 2);
  const scale = role === 'p' ? .85 : role === 'r' ? .94 : 1;
  const model = { parts: merged, face, scale, headY: HEAD_Y };
  modelCache.set(key, model);
  return model;
}
