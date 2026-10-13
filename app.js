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
scene.add(new THREE.HemisphereLight(0xeaf7ff, 0xffd6ea, 1.1));

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
  hairHi: 0xffd2ea,
  dress: 0xf6f0ff,
  dressTrim: 0xff8fc0,
  ribbon: 0x7fd6ff,
  stocking: 0xfff0f7,
  boot: 0xff8fb8,
  mouth: 0xe0587a,
  brow: 0xc8609a,
};

// head geometry (mirrors tools/character.mjs): skull ellipsoid centre and radii
const HEAD_C = { x: 0, y: 1.36, z: 0 };
const HEAD_R = { x: 0.205, y: 0.215, z: 0.195 };

// z of the skull's front surface at world (x, y) — used to lay decals onto the head
function headZ(x, y) {
  const dx = x / HEAD_R.x, dy = (y - HEAD_C.y) / HEAD_R.y;
  return HEAD_C.z + HEAD_R.z * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
}

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

// inverted-hull outline as a child mesh (inherits the parent's transform)
function outlined(mesh, thick = 0.0045) {
  mesh.castShadow = true;
  const ol = new THREE.Mesh(mesh.geometry, outlineMat.clone());
  ol.material.uniforms.uThick.value = thick;
  mesh.add(ol);
  return mesh;
}

function addTo(parent, mesh, outline = true, thick) {
  if (outline) outlined(mesh, thick);
  parent.add(mesh);
  return mesh;
}

const character = new THREE.Group();
scene.add(character);
const body = new THREE.Group(); // breathing pivot
character.add(body);

// Smooth tube along a Catmull-Rom path with tapering radius (used for lashes, brows, mouth)
function strand(points, r0, r1 = 0.003, { seg = 28, radial = 10, pow = 1 } = {}, mat = null) {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
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
  return new THREE.Mesh(g, mat || toon(C.hair));
}

// Flat decal laid onto the skull: each vertex is pushed onto the head surface
function decalOnHead(geo, cx, cy, offset) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const X = cx + p.getX(i), Y = cy + p.getY(i);
    p.setXYZ(i, X, Y, headZ(X, Y) + offset);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---------- SDF body parts (generated by tools/character.mjs) ----------
async function fetchArray(url, Type) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Type(await r.arrayBuffer());
}

async function loadPart(name) {
  const base = `assets/mesh/${name}`;
  const [pos, nrm, idx] = await Promise.all([
    fetchArray(`${base}.pos`, Float32Array),
    fetchArray(`${base}.nrm`, Float32Array),
    fetchArray(`${base}.idx`, Uint32Array),
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const PART_STYLE = {
  skin: { mat: toon(C.skin), outline: 0.0035 },
  hair: { mat: toon(C.hair), outline: 0.0022 },
  sleeve: { mat: toon(C.dress), outline: 0.0035 },
  dress: { mat: toon(C.dress), outline: 0.0035 },
  petticoat: { mat: toon(0xffc6e6), outline: 0.0035 },
  stocking: { mat: toon(C.stocking), outline: 0.0035 },
  boot: { mat: toon(C.boot), outline: 0.0035 },
};

// ---------- ACCESSORIES & DECALS (world coordinates) ----------
const HY = HEAD_C.y;

// eyes: iris texture laid on the skull surface
function eyeTexture(flip) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const cx = 128, cy = 128, rx = 116, ry = 122;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.clip();
  const iris = g.createLinearGradient(0, 6, 0, 250);
  iris.addColorStop(0, '#1e3f9a');
  iris.addColorStop(0.45, '#4b8fe0');
  iris.addColorStop(1, '#9fe6ff');
  g.fillStyle = iris;
  g.fillRect(0, 0, 256, 256);
  const glow = g.createRadialGradient(cx, 190, 10, cx, 190, 120);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#0a0f2c';
  g.beginPath();
  g.ellipse(cx + 2, 138, 40, 52, 0, 0, Math.PI * 2);
  g.fill();
  const shade = g.createLinearGradient(0, 0, 0, 90);
  shade.addColorStop(0, 'rgba(20,10,40,0.85)');
  shade.addColorStop(1, 'rgba(20,10,40,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 256, 120);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(flip ? 92 : 160, 98, 24, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(flip ? 166 : 96, 168, 11, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(flip ? 118 : 138, 118, 6, 0, Math.PI * 2); g.fill();
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
  const mat = new THREE.MeshBasicMaterial({ map: eyeTexture(flip), transparent: true, alphaTest: 0.05, depthWrite: false });
  const geo = decalOnHead(new THREE.PlaneGeometry(0.115, 0.14, 12, 12), x, HY - 0.012, 0.004);
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  scene.add(m);
}
eyeMesh(false, -0.085);
eyeMesh(true, 0.085);

// eyelashes: short tapered strands fanning from the top lid, outer side longer
const lashMat = toon(0x2a1c3e);
for (const s of [-1, 1]) {
  const cx = s * 0.085, cy = HY - 0.012, rx = 0.058, ry = 0.072;
  for (let k = 0; k < 5; k++) {
    const a = Math.PI * (0.55 + k * 0.1);
    const aa = s < 0 ? Math.PI - a : a;
    const rootX = cx + rx * Math.cos(aa), rootY = cy + ry * Math.sin(aa);
    const reach = 0.03 - k * 0.003;
    const tipX = rootX + Math.cos(aa) * reach * 0.8, tipY = rootY + reach * 0.9;
    const rootZ = headZ(rootX, rootY) + 0.004, tipZ = headZ(tipX, tipY) + 0.006;
    body.add(strand([
      [rootX, rootY, rootZ],
      [(rootX + tipX) / 2, (rootY + tipY) / 2 + 0.004, (rootZ + tipZ) / 2],
      [tipX, tipY, tipZ],
    ], 0.0046, 0.0008, { seg: 8, radial: 6 }, lashMat));
  }
}

// blush
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fb4, transparent: true, opacity: 0.45, depthWrite: false });
for (const s of [-1, 1]) {
  const b = new THREE.Mesh(decalOnHead(new THREE.CircleGeometry(0.026, 24), s * 0.14, HY - 0.07, 0.003), blushMat);
  scene.add(b);
}

// eyebrows
const browMat = toon(C.brow);
for (const s of [-1, 1]) {
  const pts = [[s * 0.135, HY + 0.085], [s * 0.095, HY + 0.1], [s * 0.05, HY + 0.097]]
    .map(([x, y]) => [x, y, headZ(x, y) + 0.006]);
  body.add(strand(pts, 0.0055, 0.0045, { seg: 12, radial: 6 }, browMat));
}

// nose: tiny soft shape
const nX = 0, nY = HY - 0.05;
const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), toon(C.skinShade));
nose.scale.set(0.012, 0.007, 0.01);
nose.position.set(nX, nY, headZ(nX, nY) + 0.003);
body.add(nose);

// mouth: small smile + tiny lower lip
const mouthMat = toon(C.mouth);
const mouthPts = [[-0.028, HY - 0.085], [0, HY - 0.1], [0.028, HY - 0.085]].map(([x, y]) => [x, y, headZ(x, y) + 0.004]);
body.add(strand(mouthPts, 0.0045, 0.0035, { seg: 12, radial: 6 }, mouthMat));
const lip = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), toon(0xff9bb9));
lip.scale.set(0.02, 0.009, 0.01);
lip.position.set(0, HY - 0.097, headZ(0, HY - 0.097) + 0.002);
body.add(lip);

// hair ribbon bows at the tails' anchors
const ribbonMat = toon(C.ribbon);
for (const s of [-1, 1]) {
  for (const k of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.013, 12, 24), ribbonMat);
    loop.position.set(s * 0.2 + k * 0.04 * s, HY + 0.205, -0.04);
    loop.rotation.set(0.2, k * 0.6, k * 0.5);
    loop.scale.set(1, 0.7, 1);
    addTo(body, loop, true, 0.003);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), ribbonMat);
  knot.position.set(s * 0.2, HY + 0.205, -0.03);
  addTo(body, knot, true, 0.003);
}

// dress trims
const trimMat = toon(C.dressTrim);
const hem = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.014, 10, 72), trimMat);
hem.rotation.x = Math.PI / 2;
hem.position.set(0, 0.43, 0);
addTo(body, hem, true, 0.003);

const collar = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.012, 10, 40), trimMat);
collar.rotation.x = Math.PI / 2;
collar.position.set(0, 1.13, 0);
addTo(body, collar, true, 0.003);

const waist = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.011, 10, 48), trimMat);
waist.rotation.x = Math.PI / 2;
waist.position.set(0, 0.935, 0);
addTo(body, waist, true, 0.003);

// chest bow
const chestBow = new THREE.Group();
chestBow.position.set(0, 1.04, 0.15);
body.add(chestBow);
for (const s of [-1, 1]) {
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.011, 10, 20), ribbonMat);
  loop.position.set(s * 0.03, 0, 0);
  loop.rotation.set(0, 0, s * 0.7);
  loop.scale.set(1, 0.85, 1);
  addTo(chestBow, loop, true, 0.003);
}
addTo(chestBow, new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), ribbonMat), true, 0.003);

// cuffs on the boots
for (const s of [-1, 1]) {
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 10, 24), toon(0xffffff));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(s * 0.09, 0.2, 0.005);
  addTo(body, cuff, true, 0.003);
}

// star hairpin on the left side of the bangs
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
const pin = new THREE.Mesh(starGeo, starMat);
pin.scale.setScalar(0.55);
pin.position.set(-0.12, HY + 0.2, 0.2);
pin.rotation.z = 0.2;
addTo(body, pin, true, 0.002);

// floating sparkles
const sparkles = [];
for (let i = 0; i < 9; i++) {
  const m = new THREE.Mesh(starGeo, starMat);
  const a = (i / 9) * Math.PI * 2;
  m.position.set(Math.cos(a) * 0.8, 1.1 + (i % 3) * 0.28, Math.sin(a) * 0.7 - 0.05);
  m.userData = { base: m.position.clone(), phase: i * 0.9, scale: 0.7 + (i % 3) * 0.25 };
  m.scale.setScalar(m.userData.scale);
  character.add(m);
  sparkles.push(m);
}

// ground disc and soft shadow catcher
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(0.9, 64),
  new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.55, depthWrite: false })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.0015;
scene.add(ground);

const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.002;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// ---------- load the generated body ----------
const loading = Object.entries(PART_STYLE).map(async ([name, style]) => {
  const geo = await loadPart(name);
  const mesh = new THREE.Mesh(geo, style.mat);
  addTo(body, mesh, true, style.outline);
});
const ready = Promise.all(loading);

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
  body.scale.set(1, 1 + Math.sin(t * 1.8) * 0.006, 1);
  sparkles.forEach((m) => {
    const d = m.userData;
    m.position.y = d.base.y + Math.sin(t * 1.4 + d.phase) * 0.06;
    m.rotation.z = t * 0.9 + d.phase;
    m.rotation.y = Math.sin(t * 0.7 + d.phase) * 0.4;
  });
  if (mode === 'spin') {
    spinAngle += 0.004;
    camera.position.set(Math.sin(spinAngle) * DIST, TARGET.y + 0.15, Math.cos(spinAngle) * DIST);
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

// headless capture hook: renders one frame of a view once the body meshes are loaded
window.__renderView = (name) => {
  setView(name);
  controls.update();
  renderer.render(scene, camera);
  return true;
};

ready.then(() => {
  window.__ready = true;
  if (SHOT) window.__renderView(currentView);
  else frame();
}).catch((e) => {
  window.__error = String(e);
  console.error(e);
});
