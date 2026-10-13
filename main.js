import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- setup ----------
const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const BG = 0xbfe6fb; // light blue default background

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 9, 16);

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 50);
const TARGET = new THREE.Vector3(0, 0.98, 0);
const DIST = 4.1;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TARGET);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 8;

// ---------- lighting ----------
const hemi = new THREE.HemisphereLight(0xeaf7ff, 0xffd6ea, 1.1);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff4ee, 2.4);
key.position.set(2.2, 4.0, 3.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -1.2; key.shadow.camera.right = 1.2;
key.shadow.camera.top = 2.2; key.shadow.camera.bottom = -0.2;
key.shadow.camera.near = 1; key.shadow.camera.far = 12;
key.shadow.bias = -0.0008;
scene.add(key);

const rim = new THREE.DirectionalLight(0xbfeaff, 1.1);
rim.position.set(-2.5, 2.5, -3.5);
scene.add(rim);

// ---------- toon ramp ----------
const rampData = new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
const ramp = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
}

const C = {
  skin: 0xffe2d4,
  skinShade: 0xf6c9b8,
  hair: 0xff9fd0,
  hairDeep: 0xe77db9,
  hairHi: 0xffd2ea,
  dress: 0xf6f0ff,
  dressTrim: 0xff8fc0,
  ribbon: 0x7fd6ff,
  stocking: 0xfff0f7,
  boot: 0xff8fb8,
  mouth: 0xe0587a,
  brow: 0xc8609a,
};

const outlineMat = new THREE.ShaderMaterial({
  uniforms: { uThick: { value: 0.0045 }, uColor: { value: new THREE.Color(0x3b2748) } },
  vertexShader: /* glsl */`
    uniform float uThick;
    void main() {
      vec3 p = position + normal * uThick;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  side: THREE.BackSide,
});

// add an inverted-hull outline as a child (inherits transform)
function outlined(mesh, thick = 0.0045) {
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  const ol = new THREE.Mesh(mesh.geometry, outlineMat.clone());
  ol.material.uniforms.uThick.value = thick;
  ol.castShadow = false;
  mesh.add(ol);
  return mesh;
}

const character = new THREE.Group();
scene.add(character);
const body = new THREE.Group(); // breathing pivot
character.add(body);

function addTo(parent, mesh, outline = true, thick) {
  if (outline) outlined(mesh, thick);
  parent.add(mesh);
  return mesh;
}

// Smooth hair/limb strand: tube along a Catmull-Rom path with tapering radius.
function strand(points, r0, r1 = 0.003, { seg = 28, radial = 10, origin = null, pow = 1 } = {}, mat = null) {
  const o = origin || new THREE.Vector3();
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]).sub(o));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const P = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = r0 + (r1 - r0) * Math.pow(t, pow);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      nrm.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat || toon(C.hair));
  m.position.copy(o);
  return m;
}

function ellipsoid(rx, ry, rz, mat, pos, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
  m.scale.set(rx, ry, rz);
  m.position.set(...pos);
  m.rotation.set(...rot);
  return m;
}

// ---------- HEAD ----------
const head = new THREE.Group();
head.position.set(0, 1.38, 0);
body.add(head);

const skinMat = toon(C.skin);
const skull = ellipsoid(0.22, 0.225, 0.2, skinMat, [0, 0, 0]);
addTo(head, skull);

// neck
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.078, 0.14, 24), skinMat);
neck.position.set(0, 1.15, 0);
addTo(body, neck, true, 0.003);

// ---------- FACE ----------
function eyeTexture(flip) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const cx = 128, cy = 128, rx = 116, ry = 122;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.clip();
  // iris: deep blue at top, light cyan at bottom
  const iris = g.createLinearGradient(0, 6, 0, 250);
  iris.addColorStop(0, '#1e3f9a');
  iris.addColorStop(0.45, '#4b8fe0');
  iris.addColorStop(1, '#9fe6ff');
  g.fillStyle = iris;
  g.fillRect(0, 0, 256, 256);
  // lower glow
  const glow = g.createRadialGradient(cx, 190, 10, cx, 190, 120);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  // pupil
  g.fillStyle = '#0a0f2c';
  g.beginPath();
  g.ellipse(cx + 2, 138, 40, 52, 0, 0, Math.PI * 2);
  g.fill();
  // upper lash shadow
  const shade = g.createLinearGradient(0, 0, 0, 90);
  shade.addColorStop(0, 'rgba(20,10,40,0.85)');
  shade.addColorStop(1, 'rgba(20,10,40,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 256, 120);
  // highlights
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(flip ? 92 : 160, 98, 24, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(flip ? 166 : 96, 168, 11, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(flip ? 118 : 138, 118, 6, 0, Math.PI * 2); g.fill();
  // thick lash line on top
  g.strokeStyle = '#1d1430';
  g.lineWidth = 26;
  g.beginPath();
  g.ellipse(cx, cy, rx - 8, ry - 8, 0, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function eyeMesh(flip, x) {
  const mat = new THREE.MeshBasicMaterial({ map: eyeTexture(flip), transparent: true, alphaTest: 0.05 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.125), mat);
  m.position.set(x, -0.012, 0.198);
  m.rotation.z = flip ? 0.05 : -0.05;
  head.add(m);
  // eye outline sits behind the iris plane in a thin dark rim
  return m;
}
eyeMesh(false, -0.085);
eyeMesh(true, 0.085);

// blush
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fb4, transparent: true, opacity: 0.45, depthWrite: false });
for (const s of [-1, 1]) {
  const b = new THREE.Mesh(new THREE.CircleGeometry(0.026, 24), blushMat);
  b.position.set(s * 0.14, -0.07, 0.158);
  b.rotation.y = s * -0.35;
  head.add(b);
}

// eyebrows (thin tubes)
const browMat = toon(C.brow);
for (const s of [-1, 1]) {
  const pts = [[s * 0.135, 0.085, 0.178], [s * 0.095, 0.1, 0.19], [s * 0.05, 0.097, 0.19]];
  head.add(strand(pts, 0.0055, 0.0045, { seg: 12, radial: 6, origin: new THREE.Vector3(0, 0, 0) }, browMat));
}

// nose: tiny soft line
const noseMat = toon(C.skinShade);
head.add(ellipsoid(0.012, 0.007, 0.01, noseMat, [0, -0.05, 0.205]));

// mouth: small smile + tiny lower lip
const mouthMat = toon(C.mouth);
head.add(strand([[-0.028, -0.085, 0.185], [0, -0.1, 0.195], [0.028, -0.085, 0.185]], 0.0045, 0.0035, { seg: 12, radial: 6 }, mouthMat));
head.add(ellipsoid(0.02, 0.009, 0.01, toon(0xff9bb9), [0, -0.097, 0.192]));

// ---------- HAIR ----------
const hairMat = toon(C.hair);
const hairDeepMat = toon(C.hairDeep);
const hairHiMat = toon(C.hairHi);

// hair volume: cap covering top and back of skull
const cap = new THREE.Mesh(new THREE.SphereGeometry(0.245, 56, 36, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
cap.position.set(0, 0.075, -0.035);
cap.scale.set(1.0, 1.03, 1.04);
cap.rotation.x = -0.12;
addTo(head, cap, true, 0.005);

// under-layer (deeper tone) for depth behind head
const under = new THREE.Mesh(new THREE.SphereGeometry(0.235, 48, 28, 0, Math.PI * 2, 0.5, Math.PI * 0.6), hairDeepMat);
under.position.set(0, 0.05, -0.07);
addTo(head, under, true, 0.005);

// bangs (front strands, head-relative coords)
const bangPaths = [
  [[-0.03, 0.27, 0.12], [-0.07, 0.2, 0.19], [-0.11, 0.13, 0.22], [-0.12, 0.07, 0.23]],
  [[-0.11, 0.27, 0.1], [-0.16, 0.2, 0.17], [-0.21, 0.14, 0.17], [-0.23, 0.08, 0.14]],
  [[0.03, 0.27, 0.13], [0.07, 0.2, 0.21], [0.1, 0.13, 0.23], [0.11, 0.075, 0.23]],
  [[0.12, 0.26, 0.1], [0.17, 0.2, 0.17], [0.22, 0.14, 0.15], [0.24, 0.08, 0.1]],
  [[-0.2, 0.2, 0.02], [-0.24, 0.14, 0.04], [-0.25, 0.06, 0.03], [-0.25, -0.01, 0.0]],
  [[0.2, 0.2, 0.02], [0.24, 0.14, 0.04], [0.25, 0.06, 0.03], [0.25, -0.01, 0.0]],
];
bangPaths.forEach((p, i) => {
  const r0 = i < 4 ? 0.033 : 0.03;
  addTo(head, strand(p, r0, 0.004, { seg: 24, radial: 10, pow: 0.9 }, i % 2 ? hairMat : hairHiMat), true, 0.003);
});

// back hair: overlapping strands from the crown falling behind the shoulders,
// fuller in the middle, flaring and waving toward the tips
for (let i = 0; i < 20; i++) {
  const u = (i / 19) * 2 - 1;          // -1 (left) .. 1 (right)
  const x0 = u * 0.16;
  const edge = 1 - u * u;              // 1 at centre, 0 at the sides
  const wave = Math.sin(i * 1.9) * 0.012;
  const flare = u * (0.05 + 0.04 * (1 - edge));
  const path = [
    [x0 * 0.9, 0.24, -0.06],
    [x0 * 1.05, 0.06, -0.2 - 0.03 * edge],
    [x0 * 1.12 + wave, -0.14, -0.22 - 0.02 * edge],
    [x0 * 1.25 + flare + wave, -0.34, -0.2],
    [x0 * 1.35 + flare * 1.4, -0.5 - 0.02 * edge, -0.14],
  ];
  const mat = Math.abs(u) < 0.45 ? hairDeepMat : hairMat;
  addTo(head, strand(path, 0.026, 0.006, { seg: 30, radial: 10, pow: 0.85 }, mat), true, 0.003);
}

// ahoge (cute curl on top)
addTo(head, strand([[0.0, 0.3, -0.02], [0.02, 0.37, -0.03], [0.07, 0.4, -0.02], [0.085, 0.37, 0.01], [0.065, 0.35, 0.02]], 0.014, 0.004, { seg: 24, radial: 8 }, hairHiMat), true, 0.003);

// twin tails (pivot at anchor so they can sway)
const tailSpecs = [
  { side: -1, anchor: [-0.2, 0.2, -0.05] },
  { side: 1, anchor: [0.2, 0.2, -0.05] },
];
const tails = [];
for (const t of tailSpecs) {
  const a = t.anchor;
  // pivot sits at the head origin; strands are built in head space, so no extra offset
  const pivot = new THREE.Group();
  head.add(pivot);
  for (let k = 0; k < 3; k++) {
    const ox = k * 0.012 * t.side, oz = k * 0.01;
    const path = [
      [a[0] + ox, a[1] + 0.005, a[2] + oz],
      [a[0] + t.side * 0.09 + ox, a[1] - 0.06, a[2] - 0.05 + oz],
      [a[0] + t.side * 0.13, a[1] - 0.2, a[2] - 0.08],
      [a[0] + t.side * 0.12, a[1] - 0.38, a[2] - 0.08],
      [a[0] + t.side * 0.1, a[1] - 0.58, a[2] - 0.06 + oz * 0.5],
      [a[0] + t.side * 0.08, a[1] - 0.66, a[2] - 0.04],
    ];
    addTo(pivot, strand(path, 0.04 - k * 0.006, 0.005, { seg: 40, radial: 10, origin: new THREE.Vector3(a[0], a[1], a[2]), pow: 0.9 }, k === 1 ? hairHiMat : hairMat), true, 0.003);
  }
  // hair ribbon bow
  const bowMat = toon(C.ribbon);
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.013, 12, 24), bowMat);
    loop.position.set(a[0] + s * 0.04, a[1] + 0.005, a[2] + 0.01);
    loop.rotation.set(0.2, s * 0.6, s * 0.5);
    loop.scale.set(1, 0.7, 1);
    addTo(pivot, loop, true, 0.003);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), toon(0xbfeeff));
  knot.position.set(a[0], a[1] + 0.005, a[2] + 0.02);
  addTo(pivot, knot, true, 0.003);
  tails.push(pivot);
}

// ---------- BODY ----------
// dress bodice + skirt as a lathe of radius/height points
const dressProfile = [
  [0.0, 1.13], [0.07, 1.14], [0.11, 1.1], [0.135, 1.04], [0.128, 0.99],
  [0.112, 0.94], [0.12, 0.88], [0.15, 0.82], [0.2, 0.76], [0.26, 0.68],
  [0.31, 0.6], [0.355, 0.5], [0.375, 0.44], [0.37, 0.43],
].map(([x, y]) => new THREE.Vector2(x, y));
const dressGeo = new THREE.LatheGeometry(dressProfile, 48);
const dressMesh = new THREE.Mesh(dressGeo, toon(C.dress, { side: THREE.DoubleSide }));
addTo(body, dressMesh, true, 0.004);

// trims: hem ring, collar ring, chest ribbon
const trimMat = toon(C.dressTrim);
const hem = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.014, 10, 64), trimMat);
hem.rotation.x = Math.PI / 2;
hem.position.set(0, 0.435, 0);
addTo(body, hem, true, 0.003);

const collar = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.012, 10, 40), trimMat);
collar.rotation.x = Math.PI / 2;
collar.position.set(0, 1.13, 0);
addTo(body, collar, true, 0.003);

// waist ribbon: defines the bodice-to-skirt join
const waist = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.011, 10, 48), trimMat);
waist.rotation.x = Math.PI / 2;
waist.position.set(0, 0.935, 0);
addTo(body, waist, true, 0.003);

const chestBow = new THREE.Group();
chestBow.position.set(0, 1.04, 0.13);
body.add(chestBow);
for (const s of [-1, 1]) {
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.011, 10, 20), bowMatFor());
  loop.position.set(s * 0.03, 0, 0);
  loop.rotation.set(0, 0, s * 0.7);
  loop.scale.set(1, 0.85, 1);
  addTo(chestBow, loop, true, 0.003);
}
const bowKnot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), bowMatFor());
addTo(chestBow, bowKnot, true, 0.003);

function bowMatFor() { return toon(C.ribbon); }

// skirt pleats: thin darker lines fanning down the skirt
const pleatMat = toon(0xe8dcff);
for (let i = 0; i < 12; i++) {
  const ang = (i / 12) * Math.PI * 2;
  const r0 = 0.12, r1 = 0.37;
  const path = [];
  for (let s = 0; s <= 4; s++) {
    const f = s / 4;
    const r = r0 + (r1 - r0) * (0.75 + 0.25 * f) * 0.7 + (r1 - r0) * 0.3 * f;
    const y = 0.86 - f * 0.42;
    path.push([Math.cos(ang) * r * 0.97, y, Math.sin(ang) * r * 0.97]);
  }
  const pl = strand(path, 0.006, 0.006, { seg: 6, radial: 5 }, pleatMat);
  body.add(pl);
}

// legs: stockings and boots
for (const s of [-1, 1]) {
  const shin = strand([[s * 0.09, 0.45, 0.01], [s * 0.09, 0.3, 0.0], [s * 0.09, 0.14, 0.0]], 0.055, 0.04, { seg: 12, radial: 10 }, toon(C.stocking));
  addTo(body, shin, true, 0.003);
  const boot = ellipsoid(0.07, 0.072, 0.11, toon(C.boot), [s * 0.09, 0.08, 0.03]);
  addTo(body, boot, true, 0.003);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 10, 24), toon(0xffffff));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(s * 0.09, 0.16, 0.0);
  addTo(body, cuff, true, 0.003);
}

// arms: puff sleeves + forearm skin + hand
const sleeveMat = toon(C.dress);
const handMat = toon(C.skin);
for (const s of [-1, 1]) {
  const shoulder = [s * 0.15, 1.09, 0.0];
  const elbow = [s * 0.2, 0.95, 0.03];
  const wrist = [s * 0.225, 0.78, 0.07];
  const sleeve = strand([shoulder, [s * 0.18, 1.0, 0.02], elbow], 0.07, 0.055, { seg: 14, radial: 10 }, sleeveMat);
  addTo(body, sleeve, true, 0.003);
  const forearm = strand([elbow, [s * 0.215, 0.86, 0.05], wrist], 0.034, 0.029, { seg: 14, radial: 10 }, handMat);
  addTo(body, forearm, true, 0.003);
  const hand = ellipsoid(0.034, 0.045, 0.03, handMat, [wrist[0] + s * 0.005, wrist[1] - 0.05, wrist[2] + 0.02], [0.2, 0, s * -0.3]);
  addTo(body, hand, true, 0.003);
  const shoulderBall = ellipsoid(0.07, 0.07, 0.07, sleeveMat, shoulder);
  addTo(body, shoulderBall, true, 0.003);
}

// ---------- SPARKLES (floating stars) ----------
function starShape(outer = 0.06, inner = 0.022) {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
const starGeo = new THREE.ExtrudeGeometry(starShape(), { depth: 0.01, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
const starMat = new THREE.MeshToonMaterial({ color: 0xfff3a8, emissive: 0x806a20, gradientMap: ramp });
const sparkles = [];
for (let i = 0; i < 9; i++) {
  const m = new THREE.Mesh(starGeo, starMat);
  const a = (i / 9) * Math.PI * 2;
  m.position.set(Math.cos(a) * 0.62, 1.1 + (i % 3) * 0.28, Math.sin(a) * 0.5 - 0.05);
  m.userData = { base: m.position.clone(), phase: i * 0.9, scale: 0.7 + (i % 3) * 0.25 };
  m.scale.setScalar(m.userData.scale);
  character.add(m);
  sparkles.push(m);
}

// ground disc
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(0.9, 64),
  new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.55, depthWrite: false })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.0015;
scene.add(ground);

const shadowCatcher = new THREE.Mesh(
  new THREE.CircleGeometry(1.1, 64),
  new THREE.ShadowMaterial({ opacity: 0.12 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.002;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// ---------- views ----------
const VIEWS = {
  front: { az: 0, el: 0.08 },
  back: { az: Math.PI, el: 0.08 },
  left: { az: -Math.PI / 2, el: 0.08 },
  right: { az: Math.PI / 2, el: 0.08 },
  three: { az: Math.PI / 4, el: 0.12 },
};
let mode = 'view';
let currentView = params.get('view') || 'front';
let spinAngle = 0;

function setView(name) {
  currentView = name;
  mode = name === 'spin' ? 'spin' : 'view';
  if (name === 'spin') return;
  const v = VIEWS[name] || VIEWS.front;
  camera.position.set(
    TARGET.x + Math.sin(v.az) * DIST * Math.cos(v.el),
    TARGET.y + Math.sin(v.el) * DIST,
    TARGET.z + Math.cos(v.az) * DIST * Math.cos(v.el)
  );
  controls.target.copy(TARGET);
  controls.update();
}

document.querySelectorAll('#ui button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#ui button').forEach((x) => x.classList.toggle('on', x === b));
    setView(b.dataset.view);
  });
});

if (SHOT) document.body.classList.add('shot');
setView(currentView);
document.querySelectorAll('#ui button').forEach((x) => x.classList.toggle('on', x.dataset.view === currentView));

// ---------- animation ----------
const clock = new THREE.Clock();
function frame() {
  const t = clock.getElapsedTime();
  const breath = 1 + Math.sin(t * 1.8) * 0.006;
  body.scale.set(1, breath, 1);
  tails.forEach((p, i) => {
    p.rotation.z = Math.sin(t * 1.6 + i * Math.PI) * 0.03;
    p.rotation.x = Math.sin(t * 1.2 + i) * 0.02;
  });
  sparkles.forEach((m) => {
    const d = m.userData;
    m.position.y = d.base.y + Math.sin(t * 1.4 + d.phase) * 0.06;
    m.rotation.z = t * 0.9 + d.phase;
    m.rotation.y = Math.sin(t * 0.7 + d.phase) * 0.4;
  });
  if (mode === 'spin') {
    spinAngle += 0.004;
    const r = DIST;
    camera.position.set(Math.sin(spinAngle) * r, TARGET.y + 0.15, Math.cos(spinAngle) * r);
    camera.lookAt(TARGET);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Expose a hook for headless capture: renders one frame of a given view
window.__renderView = (name) => {
  setView(name);
  controls.update();
  renderer.render(scene, camera);
  return true;
};
window.__ready = true;

if (SHOT) {
  // single-frame capture mode: render once, don't run the loop
  window.__renderView(currentView);
} else {
  frame();
}
