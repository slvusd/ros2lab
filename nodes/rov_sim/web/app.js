// 3D pool + PVC-cube ROV. Receives state from rov_sim.py over Server-Sent Events.
// Coordinates: sim x = forward, y = left, depth = down  ->  three.js (x, -depth, -y).
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const $ = (id) => document.getElementById(id);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);
// picture of the scene WITHOUT the water surface; the refraction shader samples it
// (with its depth, so the water shader knows how deep each thing seen through the surface really is)
const rtDepth = new THREE.DepthTexture(256, 256);
const rt = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, depthTexture: rtDepth });
const scene = new THREE.Scene();
const SKY = new THREE.Color(0xbfe3f5), WATER = new THREE.Color(0x0b5f8a);
scene.background = SKY;
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
camera.position.set(-2.6, 1.6, 3.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.8, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.98;
controls.minDistance = 0.8;
controls.maxDistance = 16;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x4a88aa, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 2);
scene.add(sun);

// ---------- pool ----------
let L = 6, W = 3, D = 2;          // updated from the sim's first message (same defaults)

function tileTexture(repeatX, repeatY) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#4ab3dc"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#58c0e6"; g.fillRect(4, 4, 120, 120);
  g.strokeStyle = "#e9f6fb"; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function tiled(w, h) {          // plane w x h metres, one tile = 0.5 m
  return new THREE.MeshLambertMaterial({ map: tileTexture(w / 0.5, h / 0.5), side: THREE.DoubleSide });
}

// Surfaces that can block the view fade to "x-ray" when the camera is on the far side of them.
const solids = [];
function solid(mesh, hidesWhen) {
  mesh.material.transparent = true;
  mesh.userData.hidesWhen = hidesWhen;     // (cameraPosition) => true when it is in the way
  solids.push(mesh);
}

// soft web of light patches, tileable: used for ripples seen from below and floor caustics
function rippleTexture() {
  const N = 128, c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d"), img = g.createImageData(N, N), TAU = Math.PI * 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * TAU, v = y / N * TAU;
    const n = Math.sin(u + 1.6 * Math.sin(2 * v)) + Math.sin(v + 1.6 * Math.sin(2 * u + 1));
    const b = Math.pow(1 - Math.min(1, Math.abs(n) / 1.2), 3);       // bright where n ~ 0
    const i = (y * N + x) * 4;
    img.data[i] = 200 + 55 * b; img.data[i + 1] = 235 + 20 * b; img.data[i + 2] = 255;
    img.data[i + 3] = 255 * (0.25 + 0.75 * b);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const pool = new THREE.Group();
scene.add(pool);
const water = {};
const NX = 72, NZ = 36;            // surface grid cells
const wave = { h: null, v: null, tot: null, acc: 0 };
let fx = true;                     // "Water FX": refraction + wave simulation (toggle button)
try { fx = localStorage.getItem("rovWaterFx") !== "off"; } catch (e) { /* no storage: keep default */ }

const WATER_VERT = `
  varying vec3 vWorld; varying vec3 vN;
  void main() { vWorld = position; vN = normal;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
// Refraction (Snell's law, water n = 1.33): bend the view ray at the surface, then look up where
// that bent ray would land in the picture of the scene underneath. From below, rays steeper than
// ~49 degrees can't leave the water (total internal reflection): outside "Snell's window" you see
// the water itself, not the sky.
const WATER_FRAG = `
  uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tRip;
  uniform float uTime; uniform vec3 uSun; uniform mat4 uVP; uniform mat4 uInvVP; uniform vec2 uScreen;
  varying vec3 vWorld; varying vec3 vN;
  vec3 worldAt(vec2 uv, float d) {                     // world position of what the picture shows at uv
    vec4 w = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return w.xyz / w.w;
  }
  void main() {
    vec3 I = normalize(vWorld - cameraPosition);
    bool under = cameraPosition.y < 0.0;
    vec3 N = normalize(vN); if (under) N = -N;
    vec3 R = refract(I, N, under ? 1.33 : 1.0 / 1.33);
    float cosi = clamp(dot(-I, N), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
    vec3 col;
    if (dot(R, R) < 0.001) {
      float rip = texture2D(tRip, vWorld.xz * 0.9 + vec2(uTime * 0.03, uTime * 0.02)).a;
      col = mix(vec3(0.004, 0.07, 0.15), vec3(0.02, 0.24, 0.38), rip);
    } else {
      // How far something is displaced depends on HOW DEEP it is: nothing at the waterline, more further
      // down. So: look at what is straight behind this pixel, measure its depth below (or, from underwater,
      // height above) the surface, follow the bent ray that far, and look there instead; repeat to refine.
      vec2 uv = gl_FragCoord.xy / uScreen;
      for (int i = 0; i < 4; i++) {
        float d = texture2D(tDepth, uv).x;
        if (d > 0.9999) break;                         // nothing there
        float h = clamp(under ? worldAt(uv, d).y - vWorld.y : vWorld.y - worldAt(uv, d).y, 0.0, 3.0);
        vec4 clip = uVP * vec4(vWorld + R * (h / max(abs(R.y), 0.1)), 1.0);
        uv = clamp(clip.xy / clip.w * 0.5 + 0.5, 0.002, 0.998);
      }
      vec2 px = 0.8 / uScreen;                       // a small blur stands in for the missing anti-aliasing
      col = 0.4 * texture2D(tScene, uv).rgb
          + 0.15 * (texture2D(tScene, uv + vec2(px.x, px.y)).rgb + texture2D(tScene, uv + vec2(-px.x, px.y)).rgb
                  + texture2D(tScene, uv + vec2(px.x, -px.y)).rgb + texture2D(tScene, uv + vec2(-px.x, -px.y)).rgb);
      col = mix(col, vec3(0.02, 0.30, 0.52), under ? 0.12 : 0.22);
      if (!under) col = mix(col, vec3(0.52, 0.77, 0.91), fres * 0.85);
    }
    if (!under) col += pow(max(dot(reflect(I, N), uSun), 0.0), 220.0) * 1.5;   // sun glint
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function buildPool() {
  pool.clear();
  solids.length = 0;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2), tiled(L, W));
  floor.position.y = -D;
  pool.add(floor);
  solid(floor, (c) => c.y < -D);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateY(Math.PI / 2), tiled(W, D));
    w.position.set(sx * L / 2, -D / 2, 0);
    pool.add(w);
    solid(w, (c) => sx * c.x > L / 2);
  }
  for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(L, D), tiled(L, D));
    w.position.set(0, -D / 2, sz * W / 2);
    pool.add(w);
    solid(w, (c) => sz * c.z > W / 2);
  }
  // deck around the pool (a big square with a pool-shaped hole)
  const shape = new THREE.Shape();
  shape.moveTo(-9, -7); shape.lineTo(9, -7); shape.lineTo(9, 7); shape.lineTo(-9, 7); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-L / 2, -W / 2); hole.lineTo(-L / 2, W / 2); hole.lineTo(L / 2, W / 2); hole.lineTo(L / 2, -W / 2); hole.closePath();
  shape.holes.push(hole);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
                              new THREE.MeshLambertMaterial({ color: 0xd9d4c7 }));
  deck.position.y = 0.01;
  pool.add(deck);
  solid(deck, (c) => c.y < 0.01);
  // lane line + 1 m tick marks on the floor: makes motion easy to see
  const dark = new THREE.MeshBasicMaterial({ color: 0x14384d });
  const lane = new THREE.Mesh(new THREE.BoxGeometry(L, 0.005, 0.06), dark);
  lane.position.y = -D + 0.004;
  pool.add(lane);
  for (let x = -Math.floor(L / 2) + 1; x < L / 2; x += 1) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, W * 0.5), dark);
    tick.position.set(x, -D + 0.004, 0);
    pool.add(tick);
  }
  // translucent water volume (tints everything seen through it) + wavy surface
  const tint = new THREE.MeshBasicMaterial({ color: 0x1f8fc4, transparent: true, opacity: 0.16,
                                             side: THREE.DoubleSide, depthWrite: false });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const vol = new THREE.Mesh(new THREE.BoxGeometry(L, D, W),
                             [tint, tint, hidden, tint, tint, tint]);
  vol.position.y = -D / 2;
  pool.add(vol);
  // water surface: one wavy grid, drawn two ways. "simple" = translucent Phong (+ a rippling
  // underside); "fx" = refraction shader that samples a picture of the scene (see renderScene).
  const geo = new THREE.PlaneGeometry(L, W, NX, NZ).rotateX(-Math.PI / 2);
  const surf = new THREE.Mesh(geo,
    new THREE.MeshPhongMaterial({ color: 0x3fb0ea, transparent: true, opacity: 0.32,
                                  specular: 0xffffff, shininess: 90, side: THREE.FrontSide,
                                  depthWrite: false }));
  pool.add(surf);
  const rip = rippleTexture();
  rip.repeat.set(L / 1.2, W / 1.2);
  const under = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: rip, color: 0xb8e6ff, transparent: true, opacity: 0.6, side: THREE.BackSide, depthWrite: false }));
  pool.add(under);
  const fxMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { tScene: { value: null }, tRip: { value: rip },
                uTime: { value: 0 }, uVP: { value: new THREE.Matrix4() }, uInvVP: { value: new THREE.Matrix4() },
                uScreen: { value: new THREE.Vector2(1, 1) }, tDepth: { value: null }, uSun: { value: sun.position.clone().normalize() } },
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG });
  const fxSurf = new THREE.Mesh(geo, fxMat);
  pool.add(fxSurf);
  // drifting light patches on the pool floor
  const cau = rippleTexture();
  cau.repeat.set(L / 1.0, W / 1.0);
  const caustics = new THREE.Mesh(new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: cau, transparent: true, opacity: 0.22,
                                  blending: THREE.AdditiveBlending, depthWrite: false }));
  caustics.position.y = -D + 0.006;
  pool.add(caustics);
  Object.assign(water, { rip, cau, simple: surf, under, fx: fxSurf, geo, mat: fxMat });
  initWave();
}
buildPool();

// ----- surface height field: a small wave simulation (rings spread, bounce off the walls, fade) -----
function initWave() {
  const n = (NX + 1) * (NZ + 1);
  wave.h = new Float32Array(n); wave.v = new Float32Array(n); wave.tot = new Float32Array(n);
}
function drop(x, z, amp, radius = 0.25) {          // poke the water at world (x, z)
  const dx = L / NX, dz = W / NZ, gx = (x + L / 2) / dx, gz = (z + W / 2) / dz;
  for (let iz = Math.max(0, Math.floor(gz - radius / dz)); iz <= Math.min(NZ, Math.ceil(gz + radius / dz)); iz++)
    for (let ix = Math.max(0, Math.floor(gx - radius / dx)); ix <= Math.min(NX, Math.ceil(gx + radius / dx)); ix++) {
      const d = Math.hypot((ix - gx) * dx, (iz - gz) * dz);
      if (d < radius) wave.h[iz * (NX + 1) + ix] += amp * 0.5 * (1 + Math.cos(Math.PI * d / radius));
    }
}
function stepWave() {                               // one 1/60 s step
  const { h, v } = wave, S = NX + 1;
  for (let iz = 0; iz <= NZ; iz++) for (let ix = 0; ix <= NX; ix++) {
    const i = iz * S + ix, c = h[i];
    const avg = ((ix > 0 ? h[i - 1] : c) + (ix < NX ? h[i + 1] : c) +
                 (iz > 0 ? h[i - S] : c) + (iz < NZ ? h[i + S] : c)) / 4;
    v[i] = (v[i] + (avg - c) * 0.18) * 0.992;       // spring toward neighbours, then a little damping
  }
  for (let i = 0; i < h.length; i++) h[i] += v[i];
}

function animateWater(t, dt) {
  const S = NX + 1, dx = L / NX, dz = W / NZ, amb = fx ? 0.005 : 0.012;
  if (fx) { wave.acc += dt; while (wave.acc >= 1 / 60) { wave.acc -= 1 / 60; stepWave(); } }
  const p = water.geo.attributes.position, nrm = water.geo.attributes.normal, H = wave.tot;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    H[i] = amb * Math.sin(x * 2.1 + t * 1.3) + amb * 0.8 * Math.sin(z * 2.7 - t * 1.7) + (fx ? wave.h[i] : 0);
    p.setY(i, H[i]);
  }
  const K = fx ? 3 : 1;                             // exaggerate slopes so tiny ripples still refract visibly
  for (let iz = 0; iz <= NZ; iz++) for (let ix = 0; ix <= NX; ix++) {
    const i = iz * S + ix;
    const sx = (H[iz * S + Math.min(NX, ix + 1)] - H[iz * S + Math.max(0, ix - 1)]) / (2 * dx);
    const sz = (H[Math.min(NZ, iz + 1) * S + ix] - H[Math.max(0, iz - 1) * S + ix]) / (2 * dz);
    const nx = -sx * K, nz = -sz * K, inv = 1 / Math.hypot(nx, 1, nz);
    nrm.setXYZ(i, nx * inv, inv, nz * inv);
  }
  p.needsUpdate = true; nrm.needsUpdate = true;
  water.rip.offset.set(t * 0.03, t * 0.02);
  water.cau.offset.set(-t * 0.025, t * 0.035);
  water.mat.uniforms.uTime.value = t;
}

// ---------- ROV model ----------
const PVC = new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.55 });
const JOINT = new THREE.MeshStandardMaterial({ color: 0xcfcfc8, roughness: 0.6 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x262d36, roughness: 0.5 });
const METAL = new THREE.MeshStandardMaterial({ color: 0xa8b2ba, roughness: 0.3, metalness: 0.6 });
const BLADE = new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.4 });
const PORT = new THREE.MeshStandardMaterial({ color: 0xd62d2d, roughness: 0.5 });      // left = red
const STBD = new THREE.MeshStandardMaterial({ color: 0x23a84a, roughness: 0.5 });      // right = green

const rov = new THREE.Group();
scene.add(rov);
const H = 0.25;                          // half the cube side

function bar(a, b, r = 0.014) {          // PVC pipe from point a to point b
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), PVC);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  rov.add(m);
}
for (const sy of [-1, 1]) for (const sz of [-1, 1]) bar([-H, sy * H, sz * H], [H, sy * H, sz * H]);   // along x
for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar([sx * H, -H, sz * H], [sx * H, H, sz * H]);   // vertical
for (const sx of [-1, 1]) for (const sy of [-1, 1]) bar([sx * H, sy * H, -H], [sx * H, sy * H, H]);   // along z
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {                       // corner joints
  const j = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), JOINT);
  j.position.set(sx * H, sy * H, sz * H);
  rov.add(j);
}
// bottom crossbars that carry the vertical thruster (mounted low so its propeller stays under water)
bar([0, -H, -H], [0, -H, H], 0.012);
bar([-H, -H, 0], [H, -H, 0], 0.012);

function makeThruster(shroudMat) {
  const g = new THREE.Group();                         // axis = local +Y
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 20), DARK);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.01, 10, 28).rotateX(Math.PI / 2), shroudMat);
  ring.position.y = -0.065;
  const prop = new THREE.Group();
  prop.position.y = -0.075;
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.004, 0.02), BLADE);
    blade.position.x = 0.04; blade.rotation.x = 0.4;
    const arm = new THREE.Group(); arm.rotation.y = i * Math.PI * 2 / 3; arm.add(blade);
    prop.add(arm);
  }
  g.add(body, ring, prop);
  g.userData.prop = prop;
  return g;
}
// left (port, red) and right (starboard, green): axis along the ROV's forward x
const left = makeThruster(PORT), right = makeThruster(STBD);
const vfront = makeThruster(PVC), vrear = makeThruster(PVC);       // vertical thrusters, near the nose and the tail
left.rotation.z = right.rotation.z = -Math.PI / 2;     // local +Y -> ROV +x
left.position.set(0, 0, -H - 0.07);                     // sim "left" is three -z
right.position.set(0, 0, H + 0.07);
vfront.position.set(0.17, -H + 0.1, 0);     // low on the frame (THRUSTER_UP / VERT_ARM in rov_physics.py)
vrear.position.set(-0.17, -H + 0.1, 0);
vfront.rotation.x = vrear.rotation.x = Math.PI;       // propeller end up, so it clears the bar below
rov.add(left, right, vfront, vrear);

// ---- mounts: every thruster is clamped to a real frame member, with pipes where needed ----
function collar(x, y, z, sx, sy, sz) {              // a dark clamp block
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), DARK);
  m.position.set(x, y, z);
  rov.add(m);
}
for (const sz of [-1, 1]) {
  bar([-H, 0, sz * H], [H, 0, sz * H], 0.013);         // a mid-height rail along each side of the frame
  for (const dx of [-0.045, 0.045]) {                  // two pipes from the rail to two clamps round the thruster
    bar([dx, 0, sz * H], [dx, 0, sz * (H + 0.05)], 0.013);
    collar(dx, 0, sz * (H + 0.07), 0.026, 0.085, 0.085);
  }
}
for (const x of [-0.17, 0.17]) {                       // vertical thrusters sit on the bottom bar, clamped to it
  collar(x, -H + 0.025, 0, 0.085, 0.04, 0.085);        // saddle between the bar and the thruster body
  collar(x, -H, 0, 0.03, 0.03, 0.07);                  // clamp round the bar itself
}

// ---- front tool, two modes (button / T key): a fixed curved-up "nose", or a claw that opens and closes ----
const toolMount = new THREE.Group();
toolMount.position.set(H, -H, 0);              // on the front bottom PVC bar, where tools usually mount
rov.add(toolMount);
toolMount.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.07), DARK));    // clamp around the bar

const nose = new THREE.Group();                 // simple bill, curving gently upward
const noseCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0, 0),
  new THREE.Vector3(0.18, 0.012, 0), new THREE.Vector3(0.235, 0.055, 0)]);
nose.add(new THREE.Mesh(new THREE.TubeGeometry(noseCurve, 24, 0.016, 12), METAL));
const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), METAL);
noseTip.position.copy(noseCurve.getPoint(1));
nose.add(noseTip);
toolMount.add(nose);

const claw = new THREE.Group();                 // two jaws that pinch from the left and right
claw.add(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.12, 12).rotateZ(Math.PI / 2), METAL).translateX(0.06));
claw.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.095), DARK).translateX(0.145));
const jaws = [];
for (const sgn of [-1, 1]) {                    // -1 = left (three -z), +1 = right
  const jaw = new THREE.Group();
  jaw.position.set(0.17, 0, sgn * 0.03);
  jaw.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.024, 0.018), METAL).translateX(0.07));
  const tip = new THREE.Group();                // fingertip bends inward so closed jaws meet
  tip.position.x = 0.14;
  tip.rotation.y = sgn * 0.55;
  tip.add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.024, 0.018), BLADE).translateX(0.0275));
  jaw.add(tip);
  claw.add(jaw);
  jaws.push({ jaw, sgn });
}
toolMount.add(claw);

// ---------- thruster bubbles (world-space particles) ----------
const NB = 90;
const BUBBLE_TEX = (() => {              // round, soft-edged dot instead of a square
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.7, "rgba(255,255,255,.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
function makeBubbles() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NB * 3).fill(0).map((_, i) => (i % 3 === 1 ? -1000 : 0)), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.05, transparent: true, opacity: 0.8, depthWrite: false,
    map: BUBBLE_TEX, alphaTest: 0.05 }));
  pts.frustumCulled = false;
  scene.add(pts);
  return { pts, vel: new Float32Array(NB * 3), life: new Float32Array(NB), next: 0, acc: 0 };
}
const bubbles = { t1: makeBubbles(), t2: makeBubbles(), t3: makeBubbles(), t4: makeBubbles() };   // t1 left, t2 right, t3 front, t4 rear

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function emit(b, thruster, localAxis, cmd, dt) {
  // jet leaves the side the water is pushed toward: opposite to thrust
  b.acc += Math.abs(cmd) * 70 * dt;
  const dir = tmp2.copy(localAxis).multiplyScalar(cmd > 0 ? -1 : 1).applyQuaternion(rov.quaternion);
  while (b.acc >= 1) {
    b.acc -= 1;
    const i = b.next; b.next = (b.next + 1) % NB;
    thruster.getWorldPosition(tmp);
    const pa = b.pts.geometry.attributes.position, s = 0.7 + Math.abs(cmd);
    pa.setXYZ(i, tmp.x + dir.x * 0.09 + (Math.random() - .5) * 0.05,
                 tmp.y + dir.y * 0.09 + (Math.random() - .5) * 0.05,
                 tmp.z + dir.z * 0.09 + (Math.random() - .5) * 0.05);
    b.vel[i * 3] = dir.x * s + (Math.random() - .5) * 0.35;
    b.vel[i * 3 + 1] = dir.y * s + (Math.random() - .5) * 0.35;
    b.vel[i * 3 + 2] = dir.z * s + (Math.random() - .5) * 0.35;
    b.life[i] = 0.9 + Math.random() * 0.5;
  }
}
function stepBubbles(b, dt) {
  const pa = b.pts.geometry.attributes.position;
  for (let i = 0; i < NB; i++) {
    if (b.life[i] <= 0) continue;
    b.life[i] -= dt;
    if (b.life[i] <= 0) { pa.setY(i, -1000); continue; }
    const k = Math.exp(-2.2 * dt);                       // water slows them quickly
    b.vel[i * 3] *= k; b.vel[i * 3 + 1] = b.vel[i * 3 + 1] * k + 0.35 * dt; b.vel[i * 3 + 2] *= k;
    let y = pa.getY(i) + b.vel[i * 3 + 1] * dt;
    if (y > -0.01) {                                                  // pops at the surface
      if (fx) drop(pa.getX(i), pa.getZ(i), 0.0025, 0.1);
      pa.setY(i, -1000); b.life[i] = 0; continue;
    }
    pa.setXYZ(i, pa.getX(i) + b.vel[i * 3] * dt, y, pa.getZ(i) + b.vel[i * 3 + 2] * dt);
  }
  pa.needsUpdate = true;
}

// soft shadow on the pool floor under the ROV (helps judge depth)
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
scene.add(shadow);

// silt puffs kicked up when the ROV bumps the floor
const silt = [];
for (let i = 0; i < 20; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: BUBBLE_TEX, color: 0xcbbd98,
                                                         transparent: true, opacity: 0, depthWrite: false }));
  sp.visible = false; sp.userData = { life: 0, vel: new THREE.Vector3() };
  scene.add(sp); silt.push(sp);
}
function puffSilt(x, z, speed) {
  let n = 8 + Math.round(10 * Math.min(1, speed / 0.6));
  for (const sp of silt) {
    if (n <= 0) break;
    if (sp.userData.life > 0) continue;
    n--;
    const a = Math.random() * Math.PI * 2, r = 0.1 + Math.random() * 0.2;
    sp.position.set(x + Math.cos(a) * r, -D + 0.06, z + Math.sin(a) * r);
    sp.userData.vel.set(Math.cos(a) * (0.12 + Math.random() * 0.15), 0.05 + Math.random() * 0.12, Math.sin(a) * (0.12 + Math.random() * 0.15));
    sp.userData.life = sp.userData.max = 1.2 + Math.random() * 0.8;
    sp.scale.setScalar(0.12); sp.visible = true;
  }
}
function stepSilt(dt) {
  for (const sp of silt) {
    const u = sp.userData;
    if (u.life <= 0) continue;
    u.life -= dt;
    if (u.life <= 0) { sp.visible = false; continue; }
    sp.position.addScaledVector(u.vel, dt);
    u.vel.multiplyScalar(Math.exp(-1.5 * dt));
    const f = u.life / u.max;
    sp.material.opacity = 0.55 * f;
    sp.scale.setScalar(0.12 + (1 - f) * 0.3);
  }
}
let wobble = 0;                       // decaying rocking after a splash or a bump
rov.rotation.order = "YXZ";           // yaw first, then roll about the ROV's own forward axis

// ---------- optional add-on: props.js draws the pick-up ring (delete that file to remove it) ----------
let props = null;
import("./props.js").then((m) => { props = new m.Props(scene, THREE); }).catch(() => { /* no props */ });

// ---------- state from the sim ----------
const state = { x: -1.5, y: 0, depth: 0.8, yaw: 0, t1: 0, t2: 0, t3: 0, t4: 0, claw: 0, speed: 0, pitch: 0, imu: null, buoyancy: 1.5, joys: [[0, 0], [0, 0]], joy_topics: [] };
const seen = { splash: null, floor: null };
const shown = { ...state };
let lastMsg = 0;

const es = new EventSource("/events");
es.onmessage = (e) => {
  const s = JSON.parse(e.data);
  if (!s.pool) return;
  if (s.pool[0] !== L || s.pool[1] !== W || s.pool[2] !== D) { [L, W, D] = s.pool; buildPool(); }
  Object.assign(state, s);
  lastMsg = performance.now();
  if (s.tool && s.tool !== tool && performance.now() - toolAsked > 600) setTool(s.tool, false);   // sim changed it
  if (seen.splash === null) { seen.splash = s.splash_n; seen.floor = s.floor_n; }   // ignore history
  if (s.splash_n !== seen.splash) {                       // top of the ROV crossed the surface
    seen.splash = s.splash_n;
    if (fx) drop(state.x, -state.y, 0.015 + 0.06 * Math.min(1, s.splash_v), 0.35);
    wobble = Math.max(wobble, 0.4 + Math.min(0.6, s.splash_v));
  }
  if (s.floor_n !== seen.floor) {                         // bumped the pool floor
    seen.floor = s.floor_n;
    puffSilt(state.x, -state.y, s.floor_v);
    wobble = Math.max(wobble, 0.3 + Math.min(0.5, s.floor_v));
  }
};

const bars = ["t1", "t2", "t3", "t4"];
function updateHud() {
  const live = performance.now() - lastMsg < 1000;
  $("dot").className = live ? "ok" : "";
  $("status").textContent = live ? "sim connected" : "waiting for sim...";
  for (const n of bars) {
    const v = state[n], el = $("b-" + n);
    el.style.width = Math.abs(v) * 50 + "%";
    el.style.transform = v < 0 ? "translateX(-100%)" : "none";
    el.style.background = v < 0 ? "#f95" : "#4d8";
    $("n-" + n).textContent = v.toFixed(2);
  }
  // keyboard help when the sim takes keys; the ROS topic list when ROS is driving it (both can be on at once)
  $("keyhelp").style.display = state.keys ? "block" : "none";
  $("topics").style.display = (!state.keys || state.ros) ? "block" : "none";
  $("topics").classList.toggle("side", !!(state.keys && state.ros));
  $("claw").textContent = tool === "nose" ? "(nose: fixed)" :
    Math.round(state.claw * 100) + "% open" + (state.props?.some((p) => p.held) ? " (holding)" : state.props?.some((p) => p.inJaws) ? " (ring between jaws: close!)" : "");
  if (tool === "nose") $("claw").textContent = state.props?.some((p) => p.hooked) ? "nose: ring hooked" : "nose: fixed";
  const im = state.imu;
  if (im) {
    const f = (v) => { const r = Math.abs(v) < 0.0005 ? 0 : v; return (r >= 0 ? "+" : "-") + Math.abs(r).toFixed(3).padStart(6, " "); };
    const deg = im.pitch * 180 / Math.PI;
    $("pitch").textContent = (deg >= 0 ? "+" : "") + deg.toFixed(1) + "\u00b0" + (deg > 0.5 ? " nose down" : deg < -0.5 ? " nose up" : " level");
    $("tilt").setAttribute("transform", `rotate(${deg.toFixed(1)} 20 10)`);
    $("accel").textContent = `${f(im.ax)} ${f(im.ay)} ${f(im.az)}`;
    const g = 9.81, sp = Math.sin(im.pitch), cp = Math.cos(im.pitch);      // gravity as the tilted accelerometer sees it
    $("accel0").textContent = `${f(im.ax + g * sp)} ${f(im.ay)} ${f(im.az - g * cp)}`;
    $("gyro").textContent = `${f(im.gx)} ${f(im.gy)} ${f(im.gz)}`;
  }
  const bu = state.buoyancy ?? 0;
  $("buoy").textContent = "Buoyancy: " + (bu > 0.05 ? "floats" : bu < -0.05 ? "sinks" : "neutral");
  joys.forEach((j, i) => {
    const jy = (state.joys && state.joys[i]) || [0, 0];
    if (!j.down) j.knob.style.transform = `translate(${-jy[0] * JOY_REACH}px, ${-jy[1] * JOY_REACH}px)`;   // show the shared value
    $("joyval" + j.n).textContent = `${jy[0] >= 0 ? "+" : "-"}${Math.abs(jy[0]).toFixed(2)} ${jy[1] >= 0 ? "+" : "-"}${Math.abs(jy[1]).toFixed(2)}`;
    $("joycap" + j.n).textContent = state.ros ? (state.joy_topics && state.joy_topics[i]) || `joy${j.n} (not published)` : `joy${j.n} (no ROS)`;
  });
  $("depth").textContent = state.depth.toFixed(2) + " m";
  $("heading").textContent = Math.round(((state.yaw * 180 / Math.PI) % 360 + 360) % 360) + "°";
}

// ---------- keyboard (only when the server is keyboard_sim.py: state.keys) ----------
const held = new Set();
let clawCmd = 0, lastSent = "";
const POWER = 0.8;
function sendCommand() {
  const k = (c) => held.has(c) ? 1 : 0;
  const fwd = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown");
  const turn = k("KeyD") + k("ArrowRight") - k("KeyA") - k("ArrowLeft");   // + = turn right
  const up = k("KeyR") + k("Space") - k("KeyF") - k("ShiftLeft") - k("ShiftRight");
  const trim = k("KeyI") - k("KeyK");                                       // + = nose up: front pushes up, rear down
  const c = (v) => Math.max(-1, Math.min(1, v)) * POWER;
  const body = JSON.stringify({
    t1: c(fwd + turn + k("KeyZ")), t2: c(fwd - turn + k("KeyC")),
    t3: c(up + trim), t4: c(up - trim), claw: Math.round(clawCmd * 100) / 100,
  });
  if (body === lastSent) return;
  lastSent = body;
  fetch("/cmd", { method: "POST", body, keepalive: true });
}
const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyF", "KeyZ", "KeyC", "KeyI", "KeyK",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight",
  "BracketLeft", "BracketRight"]);
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "KeyV" && !e.repeat) { resetView(); return; }
  if (e.code === "KeyB" && !e.repeat) { nextBuoyancy(); return; }
  if (e.code === "KeyT" && !e.repeat) { setTool(tool === "claw" ? "nose" : "claw"); return; }
  if (!state.keys) return;
  if (GAME_KEYS.has(e.code)) { held.add(e.code); e.preventDefault(); }
  else if (e.code === "KeyH" && !e.repeat) clawCmd = clawCmd > 0.5 ? 0 : 1;
  else if (e.code === "KeyX") held.clear();
  else return;
  sendCommand();
});
window.addEventListener("keyup", (e) => { if (held.delete(e.code)) sendCommand(); });
window.addEventListener("blur", () => { held.clear(); sendCommand(); });   // never leave a thruster stuck on

// ---------- tool mode (claw / nose): the sim owns it, this just shows it and asks to change it ----------
let tool = "claw", toolAsked = 0;
function setTool(t, send = true) {
  tool = t;
  claw.visible = t === "claw"; nose.visible = t === "nose";
  $("tool").textContent = "Tool: " + (t === "claw" ? "Claw" : "Nose");
  if (send) { toolAsked = performance.now(); fetch("/tool", { method: "POST", body: t }); }
}
$("tool").addEventListener("click", () => setTool(tool === "claw" ? "nose" : "claw"));
setTool(tool, false);

// ---------- buoyancy: floats -> neutral -> sinks (a pool setting, not a ROS topic) ----------
function nextBuoyancy() {
  const b = state.buoyancy ?? 0;
  const next = b > 0.05 ? "neutral" : b < -0.05 ? "positive" : "negative";   // + -> 0 -> - -> +
  fetch("/buoyancy", { method: "POST", body: next });
}
$("buoy").addEventListener("click", nextBuoyancy);

// ---------- two on-screen joysticks (joy1, joy2): drag with the mouse; the sim publishes each as sensor_msgs/Joy ----------
// Same convention as a real joy_node: axes[0] is LEFT/right with LEFT positive, axes[1] is up/down with UP positive.
const JOY_REACH = 46 - 15;                       // how far a knob centre can travel (pad radius - knob radius), px
const joys = [1, 2].map((n) => {
  const pad = document.querySelector(`.joypad[data-n="${n}"]`), knob = pad.querySelector(".joyknob");
  const j = { n, pad, knob, axes: [0, 0], dirty: false, down: false };
  const move = (x, y) => {                       // x right, y down on screen, each -1..1
    knob.style.transform = `translate(${x * JOY_REACH}px, ${y * JOY_REACH}px)`;
    const r2 = (v) => Math.round(v * 100) / 100 + 0;   // + 0 turns -0 into 0
    j.axes = [r2(-x), r2(-y)];                   // screen right = axis 0 negative; screen up = axis 1 positive
    j.dirty = true;
  };
  const fromPointer = (e) => {
    const r = pad.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / JOY_REACH, y = (e.clientY - (r.top + r.height / 2)) / JOY_REACH;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }               // stay inside the circle
    move(x, y);
  };
  const release = () => { if (!j.down) return; j.down = false; pad.classList.remove("drag"); move(0, 0); };   // springs back
  pad.addEventListener("pointerdown", (e) => { j.down = true; pad.setPointerCapture(e.pointerId); pad.classList.add("drag"); fromPointer(e); });
  pad.addEventListener("pointermove", (e) => { if (j.down) fromPointer(e); });
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
  return j;
});
setInterval(() => {                              // send each stick at most ~30 times a second, and always the final value
  for (const j of joys) {
    if (!j.dirty) continue;
    j.dirty = false;
    fetch("/joy", { method: "POST", body: JSON.stringify({ n: j.n, axes: j.axes }), keepalive: true });
  }
}, 33);

// ---------- views ----------
// A narrow window (e.g. VS Code's side panel) sees less of the pool, so back the camera off to fit it.
const fitFactor = () => Math.max(1, 1.5 / Math.max(window.innerWidth / window.innerHeight, 0.3));
let userMoved = false;                     // once you orbit yourself, we stop auto-fitting the camera
function resetView() {
  setView("orbit");
  userMoved = false;
  controls.target.set(0, -0.8, 0);
  camera.position.set(-2.6, 1.6, 3.0).sub(controls.target).multiplyScalar(fitFactor()).add(controls.target);
  controls.update();
}
renderer.domElement.addEventListener("dblclick", resetView);
let view = "orbit";
function setView(v) {
  view = v;
  controls.enabled = v === "orbit";
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  if (v === "top") { camera.position.set(0, 7.5 * fitFactor(), 0.01); camera.lookAt(0, 0, 0); }
  if (v === "orbit") { controls.target.set(0, -0.8, 0); }
}
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
function setFx(on) {
  fx = on;
  $("fx").classList.toggle("on", on);
  try { localStorage.setItem("rovWaterFx", on ? "on" : "off"); } catch (e) { /* ignore */ }
}
$("fx").addEventListener("click", () => setFx(!fx));
setFx(fx);
$("reset").addEventListener("click", () => {
  fetch("/reset", { method: "POST" });
  held.clear(); clawCmd = 0; sendCommand();
});
setView(new URLSearchParams(location.search).get("view") || "orbit");   // e.g. /?view=follow
{ const c = new URLSearchParams(location.search).get("cam");               // e.g. /?cam=6,-1,0
  const tg = new URLSearchParams(location.search).get("target");            // e.g. /?cam=..&target=-1,-1,0
  if (tg) controls.target.set(...tg.split(",").map(Number));
  const tl = new URLSearchParams(location.search).get("tool");              // /?tool=nose
  if (tl) setTool(tl === "nose" ? "nose" : "claw");   // asks the sim to switch
  if (c) { camera.position.set(...c.split(",").map(Number)); userMoved = true; }   // an explicit camera sticks
  else if (fitFactor() > 1) resetView(); }

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const bw = renderer.domElement.width, bh = renderer.domElement.height;
  const rw = Math.max(2, bw), rh = Math.max(2, bh);     // full resolution: this picture has no multisampling
  rt.setSize(rw, rh);
  rtDepth.image.width = rw; rtDepth.image.height = rh; rtDepth.dispose();   // setSize doesn't resize the depth texture
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
controls.addEventListener("start", () => { userMoved = true; });
let refit = 0;
function onResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // zoom changes devicePixelRatio
  resize();
  clearTimeout(refit);                     // wait for the panel to stop changing size, then re-fit
  refit = setTimeout(() => { if (!userMoved && view === "orbit") resetView(); }, 150);
}
window.addEventListener("resize", onResize);
new ResizeObserver(onResize).observe(document.documentElement);
document.addEventListener("visibilitychange", () => { if (!document.hidden) onResize(); });
resize();
setTimeout(onResize, 400);                 // VS Code's Simple Browser can lay out late

// ---------- main loop ----------
let prev = performance.now(), lastClawSend = 0;
const off = new THREE.Vector3(), want = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min((now - prev) / 1000, 0.1));   // first frame can be negative
  prev = now;
  const t = now / 1000;
  const a = 1 - Math.exp(-dt * 20);                 // smooth the 30 Hz updates
  for (const k of Object.keys(state)) {
    if (k === "yaw") {
      let d = state.yaw - shown.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      shown.yaw += d * a;
    } else if (typeof state[k] === "number") shown[k] += (state[k] - shown[k]) * a;
  }

  rov.position.set(shown.x, -shown.depth, -shown.y);
  rov.rotation.y = shown.yaw;
  wobble *= Math.exp(-dt * 1.6);
  rov.rotation.x = 0.10 * wobble * Math.sin(t * 7);            // rocks after a splash or a bump
  rov.rotation.z = -shown.pitch + 0.06 * wobble * Math.sin(t * 5.3 + 1);   // pitch > 0 = nose down (a hanging ring)
  rov.updateMatrixWorld(true);
  // spin props (visual speed ~ command)
  left.userData.prop.rotation.y += -state.t1 * 40 * dt;
  right.userData.prop.rotation.y += -state.t2 * 40 * dt;
  vfront.userData.prop.rotation.y += -state.t3 * 40 * dt;
  vrear.userData.prop.rotation.y += -state.t4 * 40 * dt;
  // claw jaws swing outward to open (0 closed .. 0.7 rad open)
  for (const { jaw, sgn } of jaws) jaw.rotation.y = -sgn * shown.claw * 0.7;

  const ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3(0, 1, 0);
  const dClaw = (held.has("BracketRight") ? 1 : 0) - (held.has("BracketLeft") ? 1 : 0);   // [ ] nudge the servo
  if (dClaw && state.keys) {
    clawCmd = clamp01(clawCmd + dClaw * 0.8 * dt);
    if (now - lastClawSend > 50) { lastClawSend = now; sendCommand(); }
  }
  emit(bubbles.t1, left, ex, state.t1, dt);
  emit(bubbles.t2, right, ex, state.t2, dt);
  emit(bubbles.t3, vfront, ey, state.t3, dt);
  emit(bubbles.t4, vrear, ey, state.t4, dt);
  for (const k of bars) stepBubbles(bubbles[k], dt);

  shadow.position.set(rov.position.x, -D + 0.01, rov.position.z);
  const hgt = Math.max(0, D - shown.depth) ;
  shadow.scale.setScalar(1 + hgt * 0.2);
  shadow.material.opacity = clamp01(0.4 - hgt * 0.12);

  if (fx) {
    if (shown.depth < 0.25 + 0.12)                   // top of the ROV at/near the surface: it stirs the water
      drop(shown.x, -shown.y, 0.1 * state.speed * dt, 0.3);
  }
  animateWater(t, dt);
  stepSilt(dt);
  if (props) props.update(state.props, dt);
  for (const m of solids) {                          // x-ray: fade what is between us and the pool
    const mat = m.material, target = m.userData.hidesWhen(camera.position) ? 0.14 : 1;
    mat.opacity += (target - mat.opacity) * (1 - Math.exp(-dt * 8));
    mat.depthWrite = mat.opacity > 0.98;
  }

  if (view === "follow") {
    off.set(-1.25, 0.55, 0).applyAxisAngle(ey, shown.yaw);
    want.copy(rov.position).add(off);
    camera.position.lerp(want, 1 - Math.exp(-dt * 4));
    camera.lookAt(rov.position);
  } else if (view === "orbit") {
    controls.update();
  }
  // under the surface: blue fog; above: clear sky
  const under = camera.position.y < 0 && Math.abs(camera.position.x) < L / 2 && Math.abs(camera.position.z) < W / 2;
  scene.background = under ? WATER : SKY;
  scene.fog = under ? UNDER_FOG : null;

  updateHud();
  renderScene();
}

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.004);
function renderScene() {
  const showFx = fx && water.fx;
  water.fx.visible = showFx; water.simple.visible = !showFx; water.under.visible = !showFx;
  if (showFx) {
    // pass 1: the scene without the water surface, on a clear sky background (no underwater fog)
    water.fx.visible = false;
    const bg = scene.background, fog = scene.fog;
    scene.background = SKY; scene.fog = null;
    // Keep only what is on the far side of the water surface (below it if we look down into the pool,
    // above it if we look up from underwater). Otherwise a part of the ROV that sticks out of the water is
    // drawn once for real and once more, displaced, inside the refracted picture: a double image.
    const lookingDown = camera.position.y >= 0;
    clipPlane.normal.set(0, lookingDown ? -1 : 1, 0); clipPlane.constant = 0.004;
    renderer.clippingPlanes = [clipPlane];
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = [];
    scene.background = bg; scene.fog = fog;
    water.fx.visible = true;
    water.mat.uniforms.tScene.value = rt.texture;
    camera.updateMatrixWorld();
    water.mat.uniforms.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    water.mat.uniforms.uInvVP.value.copy(water.mat.uniforms.uVP.value).invert();
    water.mat.uniforms.tDepth.value = rt.depthTexture;
    renderer.getDrawingBufferSize(water.mat.uniforms.uScreen.value);
  }
  renderer.render(scene, camera);          // pass 2: everything, the surface bending what pass 1 saw
}
const UNDER_FOG = new THREE.FogExp2(0x0b5f8a, 0.22);
const clamp01 =(v) => Math.max(0, Math.min(1, v));
requestAnimationFrame(frame);
