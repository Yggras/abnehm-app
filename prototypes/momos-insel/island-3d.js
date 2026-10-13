// PROTOTYP — Variante C: Momos Insel als drehbare 3D-Low-Poly-Insel (three.js 0.160 vom CDN).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SEASON = {
  Frühling: { grass: 0x9fd774, leaves: [0x7cc35a, 0x5aa548, 0xa8dd7d], accent: 0xffb3cf },
  Sommer: { grass: 0x86ca5c, leaves: [0x4fa53f, 0x3a8a35, 0x7cc35a], accent: null },
  Herbst: { grass: 0xb9c46a, leaves: [0xe8913a, 0xc9612a, 0xf2b84b], accent: null },
  Winter: { grass: 0xeef4f7, leaves: [0x4f8a5e, 0x3c7050, 0x6aa37a], accent: 0xffffff },
};
const TOP = { grass: 0.4, sand: 0.18 };
const hash = (r, c) => (((r * 73856093) ^ (c * 19349663)) >>> 0) % 1000 / 1000;

let renderer, scene, camera, controls, host, onPlotCb, raf, water, world, clock, sun, hemi, sky;
let mounted = false;
const animated = [];
const matCache = new Map();
const spriteCache = new Map();

function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra }));
  return matCache.get(key);
}
function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function emojiTexture(text, { bg = null, w = 128, font = 92 } = {}) {
  const key = text + bg + w;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = 128;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 8; ctx.beginPath(); ctx.roundRect(6, 6, w - 12, 116, 58); ctx.fill(); ctx.stroke(); }
  ctx.font = `${font}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a4210';
  ctx.fillText(text, w / 2, 70);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  spriteCache.set(key, tex);
  return tex;
}
function sprite(text, scale, opts) {
  const tex = emojiTexture(text, opts);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false }));
  s.scale.set(scale * (tex.image.width / 128), scale, 1);
  return s;
}

// ---------- Objekte ----------
function tree(se, apples, k) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.42, 6), mat(0x7a4a2c), 0, 0.21, 0));
  const [a, b, c] = se.leaves;
  g.add(mesh(new THREE.IcosahedronGeometry(0.3, 0), mat(a), 0, 0.62, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(c), 0.12, 0.82, -0.06));
  g.add(mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(b), -0.16, 0.52, 0.1));
  if (se === SEASON.Winter) g.add(mesh(new THREE.IcosahedronGeometry(0.16, 0), mat(0xffffff), 0.05, 0.92, 0));
  if (se.accent && se !== SEASON.Winter) [[0.2, 0.7, 0.1], [-0.1, 0.8, 0.18], [0.05, 0.55, -0.25]].forEach(([x, y, z]) => g.add(mesh(new THREE.SphereGeometry(0.04, 6, 4), mat(se.accent), x, y, z)));
  if (apples && se !== SEASON.Winter) [[0.22, 0.6, 0.12], [-0.12, 0.7, 0.24], [0.1, 0.5, -0.24], [-0.25, 0.55, -0.05]].slice(0, 2 + Math.floor(k * 3)).forEach(([x, y, z]) => g.add(mesh(new THREE.SphereGeometry(0.045, 6, 4), mat(0xe23b3b), x, y, z)));
  g.rotation.y = k * 6;
  return g;
}
function palm() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) { const s = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), mat(0x9b6b3f), i * 0.03, 0.09 + i * 0.17, 0); s.rotation.z = -0.12; g.add(s); }
  for (let i = 0; i < 6; i++) {
    const leaf = mesh(new THREE.ConeGeometry(0.07, 0.55, 4), mat(0x3f9a49), 0.14, 0.9, 0);
    leaf.scale.set(1, 1, 0.3); leaf.rotation.set(0, (i / 6) * Math.PI * 2, 1.9);
    const pivot = new THREE.Group(); pivot.rotation.y = (i / 6) * Math.PI * 2; pivot.position.set(0.14, 0.9, 0);
    leaf.position.set(0.25, -0.05, 0); leaf.rotation.set(0, 0, -1.9); pivot.add(leaf); g.add(pivot);
  }
  return g;
}
function flowers(k) {
  const g = new THREE.Group();
  const cols = [0xff7aa8, 0xffd447, 0xffffff, 0xb98cff, 0xff9a4d];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + k * 5, r = 0.12 + (i % 3) * 0.1, x = Math.cos(a) * r, z = Math.sin(a) * r;
    g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 4), mat(0x3f8a3a), x, 0.07, z));
    g.add(mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(cols[(i + Math.floor(k * 5)) % 5]), x, 0.16, z));
  }
  return g;
}
function mushrooms() {
  const g = new THREE.Group();
  [[-0.15, 0, 0.1, 1], [0.15, 0, -0.08, 0.8], [0.05, 0, 0.22, 1.2]].forEach(([x, , z, f]) => {
    g.add(mesh(new THREE.CylinderGeometry(0.025 * f, 0.03 * f, 0.1 * f, 6), mat(0xf4ead6), x, 0.05 * f, z));
    g.add(mesh(new THREE.SphereGeometry(0.08 * f, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe0453a), x, 0.09 * f, z));
  });
  return g;
}
function rabbit() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 10), mat(0x3a2616), -0.15, 0.01, 0.05));
  const white = mat(0xfbfaf7);
  const body = mesh(new THREE.SphereGeometry(0.11, 8, 6), white, 0.1, 0.1, 0); body.scale.set(1.2, 0.9, 0.9); g.add(body);
  g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), white, 0.22, 0.2, 0));
  [-0.03, 0.03].forEach((z) => { const e = mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.14, 5), white, 0.22, 0.32, z); e.rotation.x = z * 4; g.add(e); });
  g.rotation.y = 0.6;
  return g;
}
function pond() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.04, 14), mat(0x3a9cc4, { roughness: 0.2 }), 0, 0.01, 0));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.add(mesh(new THREE.DodecahedronGeometry(0.06, 0), mat(0xa9a99c), Math.cos(a) * 0.43, 0.03, Math.sin(a) * 0.43)); }
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 8), mat(0x4caf50), -0.1, 0.04, 0.05));
  g.add(mesh(new THREE.IcosahedronGeometry(0.035, 0), mat(0xff8fb5), -0.1, 0.07, 0.05));
  return g;
}
function path(k) {
  const g = new THREE.Group();
  [[-0.3, -0.1], [-0.1, 0.15], [0.1, -0.12], [0.3, 0.1], [0, 0.35], [-0.25, -0.35], [0.25, -0.32]].forEach(([x, z], i) => g.add(mesh(new THREE.CylinderGeometry(0.12 + k * 0.03, 0.13, 0.03, 7), mat(i % 2 ? 0xc9c2b2 : 0xb5ad9c), x, 0.015, z)));
  return g;
}
function bench() {
  const g = new THREE.Group(), wood = mat(0xb9783f), dark = mat(0x5e3820);
  g.add(mesh(new THREE.BoxGeometry(0.45, 0.04, 0.15), wood, 0, 0.14, 0));
  g.add(mesh(new THREE.BoxGeometry(0.45, 0.12, 0.03), wood, 0, 0.24, -0.07));
  [[-0.18, 0.05], [0.18, 0.05], [-0.18, -0.05], [0.18, -0.05]].forEach(([x, z]) => g.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), dark, x, 0.07, z)));
  g.rotation.y = 0.5;
  return g;
}
function lantern(ev) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.6, 6), mat(0x3a3a44), 0, 0.3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.14, 0.12), mat(0xffe17a, { emissive: 0xffc93a, emissiveIntensity: ev ? 2 : 0.3 }), 0, 0.66, 0));
  g.add(mesh(new THREE.ConeGeometry(0.11, 0.08, 4), mat(0x3a3a44), 0, 0.77, 0));
  if (ev) { const l = new THREE.PointLight(0xffc96a, 2.2, 3, 1.6); l.position.set(0, 0.7, 0); g.add(l); }
  return g;
}
function hut(ev) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.55, 0.38, 0.55), mat(0xe2bd85), 0, 0.19, 0));
  const roof = mesh(new THREE.ConeGeometry(0.52, 0.42, 4), mat(0xe6c35c), 0, 0.59, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.22, 0.02), mat(0x6b4423), 0.1, 0.11, 0.28));
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.1), mat(ev ? 0xffd35c : 0x8fc7d8, ev ? { emissive: 0xffb02e, emissiveIntensity: 1.5 } : {}), 0.28, 0.22, 0));
  return g;
}
function gardenhouse(ev) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.48, 0.6), mat(0xf4efe6), 0, 0.24, 0));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 0.48, 0.36, 3, 1), mat(0xd9544a), 0, 0.66, 0);
  roof.rotation.set(0, 0, 0); roof.scale.set(1.05, 1, 1.5); roof.rotation.y = Math.PI / 2; g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), mat(0xa5523d), 0.2, 0.78, -0.1));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.26, 0.02), mat(0x7a4a2c), 0, 0.13, 0.31));
  const win = mat(ev ? 0xffd35c : 0x9fd3e3, ev ? { emissive: 0xffb02e, emissiveIntensity: 1.5 } : {});
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), win, -0.22, 0.28, 0.31)); g.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), win, 0.22, 0.28, 0.31));
  if (ev) { const l = new THREE.PointLight(0xffc96a, 1.4, 2.5, 1.6); l.position.set(0, 0.3, 0.5); g.add(l); }
  return g;
}
function fountain() {
  const g = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.3, 0.07, 6, 14), mat(0xcfccc2), 0, 0.07, 0); ring.rotation.x = Math.PI / 2; g.add(ring);
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14), mat(0x6cc3e0, { roughness: 0.2 }), 0, 0.06, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.35, 6), mat(0xbdb9ad), 0, 0.2, 0));
  const top = mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(0xbfefff, { transparent: true, opacity: 0.8 }), 0, 0.42, 0); top.userData.bob = 0.02; g.add(top);
  return g;
}
function lighthouse(ev) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.CylinderGeometry(0.17 - (i + 1) * 0.02, 0.17 - i * 0.02, 0.22, 10), mat(i % 2 ? 0xffffff : 0xd9443c), 0, 0.11 + i * 0.22, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), mat(0xffe17a, { emissive: 0xffd35c, emissiveIntensity: ev ? 2.5 : 0.4 }), 0, 0.98, 0));
  g.add(mesh(new THREE.ConeGeometry(0.13, 0.12, 8), mat(0xd9443c), 0, 1.1, 0));
  if (ev) { const l = new THREE.PointLight(0xfff0b0, 3, 6, 1.4); l.position.set(0, 1, 0); g.add(l); }
  return g;
}
function dock() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.4), mat(i % 2 ? 0xb98552 : 0xa77443), -0.3 + i * 0.17, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), mat(0x6b4423), 0.42, 0.05, 0.18));
  const boat = new THREE.Group();
  boat.add(mesh(new THREE.BoxGeometry(0.4, 0.08, 0.16), mat(0x8a5530), 0, 0, 0));
  const sail = mesh(new THREE.ConeGeometry(0.12, 0.35, 3), mat(0xffffff), 0, 0.22, 0); sail.scale.z = 0.2; boat.add(sail);
  boat.position.set(0.25, -0.15, 0.45); boat.userData.bob = 0.03; g.add(boat);
  return g;
}
function bridge() {
  const g = new THREE.Group();
  const arch = mesh(new THREE.TorusGeometry(0.4, 0.06, 5, 12, Math.PI), mat(0xc98a4c), 0, 0, 0); g.add(arch);
  return g;
}
function scaffold(pr) {
  const g = new THREE.Group(), wood = mat(0x9c6b3d);
  [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].forEach(([x, z]) => g.add(mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), wood, x, 0.3, z)));
  g.add(mesh(new THREE.BoxGeometry(0.65, 0.04, 0.05), wood, 0, 0.45, 0.3)); g.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.65), wood, 0.3, 0.45, 0));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.12), mat(0xc98a4c), 0.1, 0.03, 0.1));
  const label = sprite(`${pr.emoji} ${pr.bau.have + pr.natur.have}/${pr.bau.need + pr.natur.need}`, 0.34, { bg: '#ffffff', w: 300, font: 64 });
  label.position.set(0, 0.95, 0); label.userData.bob = 0.04; g.add(label);
  return g;
}

function buildItem(it, se, k, ev, info) {
  if (it.t === 'deco') { const s = sprite(info(it).emoji, 0.42); s.position.y = 0.22; return s; }
  return ({ baum: () => tree(se, true, k), palme: palm, blume: () => flowers(k), pilz: mushrooms, hase: rabbit, teich: pond, weg: () => path(k), bank: bench,
    laterne: () => lantern(ev), huette: () => hut(ev), gartenhaus: () => gardenhouse(ev), brunnen: fountain, leuchtfeuer: () => lighthouse(ev), steg: dock, bruecke: bridge,
  }[it.id] || (() => sprite('❓', 0.4)))();
}

function skyTexture(ev) {
  const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
  const ctx = cv.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 0, 256);
  if (ev) { g.addColorStop(0, '#1d2552'); g.addColorStop(0.6, '#5a4a8a'); g.addColorStop(1, '#f0a07a'); }
  else { g.addColorStop(0, '#7cc8ef'); g.addColorStop(0.65, '#c4ecf7'); g.addColorStop(1, '#fdf3d8'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function isMounted() { return mounted; }

export function mount(el, onPlot) {
  host = el; onPlotCb = onPlot; mounted = true;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  el.innerHTML = ''; el.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(10, 15.5, 17);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.6); controls.enableDamping = true; controls.minDistance = 6; controls.maxDistance = 32;
  controls.maxPolarAngle = 1.2; controls.minPolarAngle = 0.35;
  hemi = new THREE.HemisphereLight(0xdff4ff, 0x8a7a50, 1.1); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff1d6, 2.2); sun.position.set(6, 11, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const wg = new THREE.PlaneGeometry(44, 44, 70, 70); wg.rotateX(-Math.PI / 2);
  water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x3fb0d6, flatShading: true, roughness: 0.25, transparent: true, opacity: 0.86 }));
  water.receiveShadow = true; water.position.y = 0.05; scene.add(water);
  const bed = new THREE.Mesh(new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7fd6d4 })); bed.position.y = -0.5; scene.add(bed);
  const deep = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f6f9a })); deep.position.y = -1.2; scene.add(deep);
  // Wolken
  sky = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 4; j++) cl.add(mesh(new THREE.IcosahedronGeometry(0.5 + (j % 2) * 0.3, 0), mat(0xffffff, { roughness: 1 }), j * 0.55 - 0.8, (j % 2) * 0.2, (j % 3) * 0.2));
    const a = (i / 5) * Math.PI * 2; cl.position.set(Math.cos(a) * 15, 6 + (i % 2), Math.sin(a) * 15); cl.traverse((m) => { m.castShadow = false; }); sky.add(cl);
  }
  scene.add(sky);
  world = new THREE.Group(); scene.add(world);
  clock = new THREE.Clock();
  // Tippen vs. Drehen unterscheiden
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(world.children, true).find((h) => { let o = h.object; while (o && !o.userData.plot) o = o.parent; return o; });
    if (hit) { let o = hit.object; while (!o.userData.plot) o = o.parent; onPlotCb(o.userData.plot); }
  });
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; if (!w) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(host); resize();
  const base = wg.attributes.position.array.slice();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    const p = wg.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) p[i + 1] = Math.sin(base[i] * 0.9 + t * 1.2) * 0.05 + Math.cos(base[i + 2] * 0.7 + t) * 0.04;
    wg.attributes.position.needsUpdate = true; wg.computeVertexNormals();
    sky.rotation.y = t * 0.02;
    animated.forEach((o) => {
      if (o.userData.bob) o.position.y = o.userData.baseY + Math.sin(t * 2.2 + o.userData.phase) * o.userData.bob;
      if (o.userData.popStart) { const k = Math.min(1, (performance.now() - o.userData.popStart) / 600); const s = k < 1 ? 1 - Math.cos(k * Math.PI * 2.5) * (1 - k) : 1; o.scale.setScalar(Math.max(0.01, s)); }
      if (o.userData.pulse) o.material.opacity = 0.25 + Math.sin(t * 5) * 0.2;
      if (o.userData.drift) o.position.x = o.userData.baseX + Math.sin(t * 0.4 + o.userData.phase) * 0.3;
    });
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
}

export function unmount() {
  cancelAnimationFrame(raf); mounted = false;
  renderer?.dispose(); controls?.dispose();
  animated.length = 0;
}

function track(o, data) { Object.assign(o.userData, data, { baseY: o.position.y, baseX: o.position.x, phase: Math.random() * 6 }); animated.push(o); }

export function update(state, o) {
  if (!mounted) return;
  const se = SEASON[state.season], ev = state.evening;
  scene.background = skyTexture(ev);
  scene.fog = new THREE.Fog(ev ? 0x5a4a8a : 0xc4ecf7, 22, 40);
  hemi.intensity = ev ? 0.35 : 1.1; sun.intensity = ev ? 0.5 : 2.2; sun.color.set(ev ? 0xff9a6a : 0xfff1d6);
  water.material.color.set(ev ? 0x2a5f8a : 0x3fb0d6);
  // Welt neu aufbauen
  world.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
  world.clear(); animated.length = 0;
  const zoneTint = { eckeIch: 0x3c9d67, bau: 0x6aa36a, natur: 0xe39b3f, eckePartner: 0xe39b3f, gemein: 0xffffff, nord: 0x78b4dc };
  let markerIdx = 0;
  state.plots.forEach((p) => {
    const x = p.c - 4, z = p.r - 3.5, k = hash(p.r, p.c);
    const sand = p.zone === 'strand';
    const top = sand ? TOP.sand : TOP.grass + (p.zone === 'nord' ? 0.12 : 0);
    const g = new THREE.Group(); g.userData.plot = p.id; g.position.set(x, 0, z);
    const h = top + 1.3;
    const topCol = new THREE.Color(sand ? 0xf1dca2 : se.grass).multiplyScalar(0.95 + k * 0.1);
    const side = mat(sand ? 0xd9bd7a : 0xa8744a);
    const tile = mesh(new THREE.BoxGeometry(1, h, 1), [side, side, mat(topCol.getHex()), side, side, side], 0, top - h / 2, 0);
    g.add(tile);
    if (!sand) g.add(mesh(new THREE.BoxGeometry(1.001, 0.09, 1.001), mat(topCol.getHex()), 0, top - 0.045, 0));
    if (state.labels && zoneTint[p.zone]) { const t = mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: zoneTint[p.zone], transparent: true, opacity: 0.28 }), 0, top + 0.005, 0); t.castShadow = false; g.add(t); }
    if (o.valid.has(p.id)) { const v = mesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }), 0, top + 0.01, 0); v.castShadow = false; g.add(v); track(v, { pulse: true }); }
    let obj = null;
    if (p.item) obj = buildItem(p.item, se, k, ev, o.itemInfo);
    else if (p.zone === 'gemein' && p.r === 3 && p.c === 4) obj = scaffold(state.project);
    else if (p.zone === 'momo' && p.r === 4) {
      obj = new THREE.Group();
      const m = sprite('🐣', 0.75 * o.momoScale); m.position.y = 0.4 * o.momoScale; obj.add(m); track(m, { bob: 0.06 });
      if (o.momoAcc) { const a = sprite(o.momoAcc, 0.3); a.position.set(0.18, 0.75 * o.momoScale, 0); obj.add(a); track(a, { bob: 0.06 }); }
      obj.add(mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 12), mat(0xfff1b0), 0, 0.015, 0));
    } else if (p.zone === 'momo') {
      obj = mesh(new THREE.TorusGeometry(0.18, 0.07, 5, 10), mat(0xc9a24f)); obj.rotation.x = Math.PI / 2; obj.position.y = 0.05;
    }
    if (obj) {
      obj.position.y += top; g.add(obj);
      obj.traverse((m) => { if (m.userData.bob) track(m, { bob: m.userData.bob }); });
      if (p.fresh && Date.now() - p.fresh < 1500) track(obj, { popStart: performance.now() });
    }
    if (sand && markerIdx < o.events.length) {
      const e = o.events[markerIdx++];
      const m = sprite(e.emoji, 0.45, { bg: e.status === 'neu' ? '#fff7d6' : '#ffffff' }); m.position.y = top + 0.55; g.add(m); track(m, { bob: 0.07 });
    }
    world.add(g);
  });
  if (!state.nordOpen) {
    state.plots.filter((p) => p.zone === 'nord').forEach((p, i) => {
      const cl = new THREE.Group(); cl.userData.plot = p.id;
      for (let j = 0; j < 3; j++) { const s = mesh(new THREE.IcosahedronGeometry(0.42 + (j % 2) * 0.12, 1), mat(0xffffff, { transparent: true, opacity: 0.82, roughness: 1, emissive: 0x9aa6b0 }), (j - 1) * 0.35, 0.8 + (j % 2) * 0.15, (j % 2) * 0.2); s.castShadow = false; cl.add(s); }
      cl.position.set(p.c - 4, 0, p.r - 3.5); track(cl, { drift: true }); world.add(cl);
    });
    const lab = sprite('☁️ ab Level 5', 0.4, { bg: '#ffffff', w: 360, font: 52 }); lab.position.set(-1, 2, -3); world.add(lab);
  }
  if (state.labels) {
    const names = { eckeIch: 'Meine Ecke', bau: 'Bauen', natur: 'Natur', eckePartner: 'Ecke Partnerin', gemein: 'Gemeinschaft' };
    Object.entries(names).forEach(([zn, n]) => {
      const g = state.plots.filter((p) => p.zone === zn); if (!g.length) return;
      const r = g.reduce((s, p) => s + p.r, 0) / g.length, c = g.reduce((s, p) => s + p.c, 0) / g.length;
      const lab = sprite(n, 0.3, { bg: '#ffffff', w: 380, font: 50 }); lab.position.set(c - 4, 1.5, r - 3.5); world.add(lab);
    });
  }
}
