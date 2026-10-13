// SDF character definition + mesh builder.
// Each body part is an implicit surface (signed distance field) built from
// ellipsoids, tapered round cones and revolved shells, smooth-blended together.
// Surface nets turn each field into a mesh with gradient-based (smooth) normals.
//
// Run:  node tools/character.mjs            -> writes assets/mesh/*
// Units: metres, +Y up, character faces +Z. Head centre is at (0, 1.36, 0).

import fs from 'node:fs';
import path from 'node:path';
import isosurface from 'isosurface';

const { surfaceNets } = isosurface;
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'assets', 'mesh');

const H = [0, 1.36, 0]; // head centre
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- primitives ----------
// ellipsoid (Inigo Quilez bound), centre (cx,cy,cz), radii r
function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = px - cx, y = py - cy, z = pz - cz;
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

// round cone between a and b with radii r1 (at a) and r2 (at b) — exact (Inigo Quilez)
function sdRoundCone(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return ((Math.sqrt((x2 * a2) * il2) + y * rr) * il2) - r1;
}

// polynomial smooth minimum
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

// A tapered chain of round cones through control points (world or head-relative,
// the caller decides). Radius interpolates r0 -> r1 along the chain.
function chain(points, r0, r1) {
  const n = points.length;
  const rad = points.map((_, i) => r0 + (r1 - r0) * (i / (n - 1)));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], points[i][k] - rad[i] - 0.03);
      hi[k] = Math.max(hi[k], points[i][k] + rad[i] + 0.03);
    }
  }
  return { points, rad, lo, hi };
}

function sdChain(px, py, pz, c) {
  if (px < c.lo[0] || px > c.hi[0] || py < c.lo[1] || py > c.hi[1] || pz < c.lo[2] || pz > c.hi[2]) return 1;
  let d = 1e9;
  for (let i = 0; i < c.points.length - 1; i++) {
    const s = sdRoundCone(px, py, pz, c.points[i], c.points[i + 1], c.rad[i], c.rad[i + 1]);
    d = i === 0 ? s : smin(d, s, 0.012);
  }
  return d;
}

// 2D distance from (r,y) to a polyline of [r,y] points (unsigned)
function distPolyline(px, py, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const abx = bx - ax, aby = by - ay;
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1);
    best = Math.min(best, Math.hypot(px - (ax + abx * t), py - (ay + aby * t)));
  }
  return best;
}

// ---------- SIDE-INDEPENDENT HELPERS ----------
const head = { c: H, r: [0.205, 0.215, 0.195] };
// analytic front surface of the skull, used to place eye/blush decals on the head
export function headSurfaceZ(x, y) {
  const dx = x / head.r[0], dy = (y - H[1]) / head.r[1];
  return H[2] + head.r[2] * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
}

// ---------- PART: skin (head, neck, forearms, hands) ----------
function skinSDF(x, y, z) {
  let d = sdEllipsoid(x, y, z, H[0], H[1], H[2], head.r[0], head.r[1], head.r[2]);
  d = smin(d, sdEllipsoid(x, y, z, 0, 1.255, 0.012, 0.165, 0.105, 0.16), 0.05); // cheeks/jaw
  d = smin(d, sdEllipsoid(x, y, z, 0, 1.19, 0.05, 0.065, 0.05, 0.06), 0.035);    // chin
  d = smin(d, sdRoundCone(x, y, z, [0, 1.27, -0.01], [0, 1.12, 0.0], 0.072, 0.066), 0.03); // neck
  for (const s of [-1, 1]) {
    d = smin(d, sdEllipsoid(x, y, z, s * 0.2, 1.35, 0.0, 0.03, 0.05, 0.03), 0.02); // ears
    d = smin(d, sdRoundCone(x, y, z, [s * 0.2, 0.93, 0.03], [s * 0.222, 0.76, 0.07], 0.05, 0.032), 0.02); // forearm
    d = smin(d, sdEllipsoid(x, y, z, s * 0.23, 0.7, 0.085, 0.038, 0.052, 0.03), 0.02); // hand
  }
  return d;
}

// ---------- PART: hair ----------
// relative (head-space) control points, converted to world below
const rel = (pts) => pts.map(([x, y, z]) => [x, H[1] + y, z]);

const bangs = [
  [[-0.03, 0.2, 0.12], [-0.07, 0.17, 0.19], [-0.11, 0.12, 0.22], [-0.12, 0.07, 0.23]],
  [[-0.11, 0.2, 0.1], [-0.16, 0.17, 0.17], [-0.21, 0.13, 0.17], [-0.23, 0.08, 0.14]],
  [[0.03, 0.2, 0.13], [0.07, 0.17, 0.21], [0.1, 0.12, 0.23], [0.11, 0.075, 0.23]],
  [[0.12, 0.2, 0.1], [0.17, 0.17, 0.17], [0.22, 0.13, 0.15], [0.24, 0.08, 0.1]],
  [[-0.2, 0.2, 0.02], [-0.24, 0.14, 0.04], [-0.25, 0.08, 0.03], [-0.25, 0.03, 0.0]],
  [[0.2, 0.2, 0.02], [0.24, 0.14, 0.04], [0.25, 0.08, 0.03], [0.25, 0.03, 0.0]],
  [[-0.065, 0.22, 0.15], [-0.075, 0.15, 0.2], [-0.09, 0.1, 0.22], [-0.1, 0.06, 0.22]],
  [[0.065, 0.22, 0.15], [0.075, 0.15, 0.2], [0.09, 0.1, 0.22], [0.1, 0.06, 0.22]],
].map((p) => chain(rel(p), 0.04, 0.011)); // thinner roots, shorter side locks; the crown streaks remain (chains merge into the cap)

// back hair: strands falling behind the shoulders, fuller in the middle
const backStrands = [];
for (let i = 0; i < 20; i++) {
  const u = (i / 19) * 2 - 1;
  const x0 = u * 0.16, edge = 1 - u * u;
  const wave = Math.sin(i * 1.9) * 0.012;
  const flare = u * (0.05 + 0.04 * (1 - edge));
  backStrands.push(chain(rel([
    [x0 * 0.9, 0.24, -0.06],
    [x0 * 1.05, 0.06, -0.2 - 0.03 * edge],
    [x0 * 1.12 + wave, -0.14, -0.22 - 0.02 * edge],
    [x0 * 1.25 + flare + wave, -0.34, -0.2],
    [x0 * 1.35 + flare * 1.4, -0.5 - 0.02 * edge - 0.05 * (0.5 + 0.5 * Math.sin(i * 2.7)), -0.14], // ragged, uneven hem
  ]), 0.024, 0.014));
}

// twin tails: three bundles per side, long tapered chains
const tails = [];
for (const side of [-1, 1]) {
  const a = [side * 0.2, 0.2, -0.05];
  for (let k = 0; k < 3; k++) {
    const ox = k * 0.012 * side, oz = k * 0.01;
    tails.push(chain(rel([
      [a[0] + ox, a[1] + 0.005, a[2] + oz],
      [a[0] + side * 0.09 + ox, a[1] - 0.06, a[2] - 0.05 + oz],
      [a[0] + side * 0.13, a[1] - 0.2, a[2] - 0.08],
      [a[0] + side * 0.12, a[1] - 0.38, a[2] - 0.08],
      [a[0] + side * 0.1, a[1] - 0.58, a[2] - 0.06 + oz * 0.5],
      [a[0] + side * 0.08, a[1] - 0.66, a[2] - 0.04],
    ]), 0.04 - k * 0.006, 0.012));
  }
}

// small framing wisps and the ahoge curl
const wisps = [];
for (const side of [-1, 1]) {
  for (const k of [0, 1]) {
    const dy = k * 0.02;
    wisps.push(chain(rel([
      [side * 0.17, 0.2 - dy, 0.13],
      [side * 0.215, 0.12 - dy, 0.11],
      [side * 0.225, 0.04 - dy, 0.09],
      [side * 0.2, -0.04 - dy, 0.07],
    ]), 0.012, 0.002));
  }
}
const ahoge = chain(rel([[0.0, 0.3, -0.02], [0.02, 0.37, -0.03], [0.07, 0.4, -0.02], [0.085, 0.37, 0.01], [0.065, 0.35, 0.02]]), 0.014, 0.004);

const hairChains = [...bangs, ...backStrands, ...tails, ...wisps, ahoge];

function hairSDF(x, y, z) {
  const cap = sdEllipsoid(x, y, z, 0, 1.47, -0.04, 0.238, 0.2, 0.235);
  const back = sdEllipsoid(x, y, z, 0, 1.22, -0.15, 0.2, 0.22, 0.15);
  const nape = sdEllipsoid(x, y, z, 0, 1.13, -0.1, 0.19, 0.24, 0.14);
  let d = smin(smin(cap, back, 0.06), nape, 0.08);
  for (const c of hairChains) d = smin(d, sdChain(x, y, z, c), 0.01);
  return d;
}

// ---------- PART: sleeves (dress-coloured upper arms + puffs) ----------
function sleeveSDF(x, y, z) {
  let d = 1e9;
  for (const s of [-1, 1]) {
    d = Math.min(d, sdRoundCone(x, y, z, [s * 0.15, 1.08, 0], [s * 0.2, 0.94, 0.03], 0.068, 0.05));
    d = smin(d, sdEllipsoid(x, y, z, s * 0.15, 1.09, 0, 0.072, 0.072, 0.072), 0.03);
  }
  return d;
}

// ---------- PARTS: revolved skirts (thin shells) ----------
// profile of the outer surface as (radius, height); the shell thickness is t
const DRESS_PROFILE = [
  [0.075, 1.14], [0.14, 1.07], [0.13, 1.0], [0.112, 0.93], [0.12, 0.88],
  [0.15, 0.82], [0.2, 0.76], [0.26, 0.68], [0.31, 0.6], [0.355, 0.5], [0.375, 0.44], [0.38, 0.42],
];
const PETTI_PROFILE = [
  [0.09, 0.92], [0.16, 0.8], [0.23, 0.66], [0.28, 0.52], [0.34, 0.42], [0.42, 0.385], // pulled in so it stays inside the pleated dress hem
];

// radial pleats on the skirt: ripple the radius with angle, only in the skirt zone
function shellSDF(profile, t, amp, pleats = 14) {
  return (x, y, z) => {
    const rho = Math.hypot(x, z);
    const th = Math.atan2(z, x);
    const w = smoothstep(0.7, 0.5, y);
    const r = rho + amp * Math.cos(pleats * th) * w; // integer pleat count keeps the seam at ±π continuous
    return distPolyline(r, y, profile) - t;
  };
}
const dressSDF = shellSDF(DRESS_PROFILE, 0.007, 0.012, 18);
const pettiSDF = shellSDF(PETTI_PROFILE, 0.008, 0.005);

// ---------- PARTS: legs ----------
function stockingSDF(x, y, z) {
  let d = 1e9;
  for (const s of [-1, 1]) {
    d = Math.min(d, sdRoundCone(x, y, z, [s * 0.09, 0.46, 0], [s * 0.085, 0.17, 0], 0.072, 0.05));
  }
  return d;
}
function bootSDF(x, y, z) {
  let d = 1e9;
  for (const s of [-1, 1]) {
    let b = sdRoundCone(x, y, z, [s * 0.09, 0.2, 0], [s * 0.09, 0.09, 0.01], 0.058, 0.066);
    b = smin(b, sdEllipsoid(x, y, z, s * 0.09, 0.075, 0.04, 0.066, 0.06, 0.105), 0.03);
    d = Math.min(d, b);
  }
  return d;
}

// ---------- build ----------
export const PARTS = {
  skin: { sdf: skinSDF, bounds: [[-0.3, 0.6, -0.25], [0.3, 1.62, 0.25]], cell: 0.006 },
  hair: { sdf: hairSDF, bounds: [[-0.46, 0.6, -0.4], [0.46, 1.84, 0.32]], cell: 0.0055 },
  sleeve: { sdf: sleeveSDF, bounds: [[-0.3, 0.85, -0.16], [0.3, 1.2, 0.16]], cell: 0.0045 },
  dress: { sdf: dressSDF, bounds: [[-0.46, 0.36, -0.46], [0.46, 1.16, 0.46]], cell: 0.008 },
  petticoat: { sdf: pettiSDF, bounds: [[-0.46, 0.36, -0.46], [0.46, 0.95, 0.46]], cell: 0.008 },
  stocking: { sdf: stockingSDF, bounds: [[-0.2, 0.12, -0.12], [0.2, 0.56, 0.12]], cell: 0.0045 },
  boot: { sdf: bootSDF, bounds: [[-0.2, 0.0, -0.1], [0.2, 0.27, 0.16]], cell: 0.0045 },
};

// gradient-based normal of a field at p
function gradient(f, x, y, z) {
  const h = 0.0008;
  const gx = f(x + h, y, z) - f(x - h, y, z);
  const gy = f(x, y + h, z) - f(x, y - h, z);
  const gz = f(x, y, z + h) - f(x, y, z - h);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

export function buildPart(name, def) {
  const [lo, hi] = def.bounds;
  const dims = lo.map((v, i) => Math.ceil((hi[i] - v) / def.cell));
  const mesh = surfaceNets(dims, def.sdf, [lo, hi]);
  const nV = mesh.positions.length;
  const pos = new Float32Array(nV * 3);
  const nrm = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const [x, y, z] = mesh.positions[i];
    pos.set([x, y, z], i * 3);
    nrm.set(gradient(def.sdf, x, y, z), i * 3);
  }
  // split quads into triangles; flip each triangle to agree with the field normal
  const idx = [];
  const pick = (i) => mesh.positions[i];
  for (const c of mesh.cells) {
    const tris = c.length === 4 ? [[c[0], c[1], c[2]], [c[0], c[2], c[3]]] : [c];
    for (const [a, b, d] of tris) {
      const A = pick(a), B = pick(b), C = pick(d);
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const vn = [nrm[a * 3] + nrm[b * 3] + nrm[d * 3], nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[d * 3 + 1], nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[d * 3 + 2]];
      const dot = fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2];
      idx.push(...(dot >= 0 ? [a, b, d] : [a, d, b]));
    }
  }
  return { name, pos, nrm, idx: new Uint32Array(idx) };
}

export function writeAll(only = []) {
  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  for (const [name, def] of Object.entries(PARTS)) {
    if (only.length && !only.includes(name)) continue;
    const t0 = Date.now();
    const m = buildPart(name, def);
    fs.writeFileSync(path.join(OUT, `${name}.pos`), Buffer.from(m.pos.buffer));
    fs.writeFileSync(path.join(OUT, `${name}.nrm`), Buffer.from(m.nrm.buffer));
    fs.writeFileSync(path.join(OUT, `${name}.idx`), Buffer.from(m.idx.buffer));
    manifest[name] = { vertices: m.pos.length / 3, triangles: m.idx.length / 3 };
    console.log(`${name}: ${manifest[name].vertices} verts, ${manifest[name].triangles} tris (${Date.now() - t0} ms)`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) writeAll(process.argv.slice(2));
