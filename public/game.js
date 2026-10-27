// public/game.js - Cliente da corrida online. O servidor manda na física; aqui só desenhamos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { TRACKS, getPointAtProgress } from '/shared/track.js';
import { CARS_DATABASE, getCarById } from '/shared/carData.js';
import { buildWorld, THEMES } from './maps.js';
import { VFX } from './vfx.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mobile = matchMedia('(pointer:coarse)').matches;
if (mobile) document.body.classList.add('touch');

// ===== RENDERER =====
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: !mobile, powerPreference: 'high-performance', physicallyCorrectLights: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
camera.position.set(8, 5, 12);

// Pós-processamento (bloom) para qualidade extrema, com fallback seguro
let composer = null;
try {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 0.85);
  bloom.threshold = 0.12;
  bloom.strength = 1.15;
  bloom.radius = 0.7;
  composer.addPass(bloom);
} catch (e) {
  console.warn('Post-processamento indisponível, render direto:', e);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.autoRotate = true; controls.maxPolarAngle = Math.PI / 2.05;
const vfx = new VFX(scene);

// ===== MODELOS =====
const gltfLoader = new GLTFLoader();
const modelCache = new Map();
export function loadModel(url) {
  if (!modelCache.has(url)) {
    modelCache.set(url, new Promise((res, rej) => gltfLoader.load(url, (g) => res(g.scene), undefined, rej))
      .catch((e) => { modelCache.delete(url); throw e; }));
  }
  return modelCache.get(url).then((s) => s.clone(true));
}

function normalizeModel(obj, targetLen = 4.4, extraScale = 1) {
  obj.rotation.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  let size = box.getSize(new THREE.Vector3());
  const sx = size.x, sy = size.y, sz = size.z;

  // Coloca o maior eixo do modelo em Z (frente do carro), para todos ficarem proporcionais.
  if (sy > sx * 1.25 && sy > sz * 1.25) {
    obj.rotation.x = -Math.PI / 2;          // Y (altura) vira Z (frente)
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    size = box.getSize(new THREE.Vector3());
  } else if (sx > sz) {
    obj.rotation.y = Math.PI / 2;           // X (largura) vira Z (frente)
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    size = box.getSize(new THREE.Vector3());
  }

  const len = Math.max(size.x, size.z) || 1;
  obj.scale.setScalar((targetLen / len) * extraScale);

  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(obj.position.x - c.x, obj.position.y - box.min.y, obj.position.z - c.z);

  const g = new THREE.Group(); g.add(obj); return g;
}

/** Pinta a carroceria: material com nome típico; senão, o do maior mesh opaco do carro. */
function tintModel(model, color) {
  const meshes = [];
  model.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = c.receiveShadow = true;
    c.material = Array.isArray(c.material) ? c.material.map((m) => m.clone()) : c.material.clone();
    meshes.push(c);
  });
  let matched = false;
  const paint = (m) => {
    m.color.set(color);
    if (m.map) m.color.lerp(new THREE.Color(0xffffff), 0.45);
    if (m.clearcoat !== undefined) { m.metalness = 0.92; m.roughness = 0.22; m.clearcoat = 1.0; m.clearcoatRoughness = 0.12; }
    else { m.metalness = 0.7; m.roughness = 0.3; }
  };
  meshes.forEach((c) => [].concat(c.material).forEach((m) => { if (/body|paint|carpaint|main/i.test(m.name)) { paint(m); matched = true; } }));
  if (matched) return;
  let best = null, bv = 0;
  meshes.forEach((c) => {
    const m = [].concat(c.material)[0];
    const s = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3());
    const v = s.x * s.y * s.z;
    if (!m.transparent && v > bv) { bv = v; best = m; }
  });
  if (best) paint(best);
}

function fallbackCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.5, roughness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.2), paint); body.position.y = 0.65;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2), dark); cabin.position.set(0, 1.2, -0.2);
  g.add(body, cabin);
  const wg = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) { const w = new THREE.Mesh(wg, dark); w.position.set(x, 0.4, z); g.add(w); }
  g.traverse((c) => { if (c.isMesh) c.castShadow = c.receiveShadow = true; });
  return g;
}

function disposeTree(obj) {
  obj.traverse((c) => {
    c.geometry?.dispose?.();
    [].concat(c.material || []).forEach((m) => { m.map?.dispose?.(); m.emissiveMap?.dispose?.(); m.dispose?.(); });
  });
}

// ===== CARRO (apenas visual; posição vem do servidor) =====
class CarView {
  constructor(carId, x, z, h, isMe) {
    this.data = getCarById(carId) || CARS_DATABASE[0];
    this.isMe = isMe;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.root.position.set(x, 0, z);
    this.h = h; this.root.rotation.y = h;
    this.t = { x, z, h, s: 0, boost: false, shield: false };
    this.vel = new THREE.Vector3(); this.smokeAcc = 0;
    scene.add(this.root);
    this.load();
  }

  async load() {
    let model;
    try {
      model = normalizeModel(await loadModel(this.data.modelPath), 4.4, this.data.modelScale || 1);
      // Correção de rotação para modelos que vieram virados de costas
      if (this.data.modelRotationY) model.rotation.y += this.data.modelRotationY;
      tintModel(model, this.data.color);
    }
    catch { model = fallbackCar(this.data.color); }
    this.pivot.add(model);

    // Posiciona faróis/lanternas com base no tamanho real do carro (não em valores fixos)
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const halfL = Math.max(size.x, size.z) / 2;   // metade do comprimento (frente/trás)
    const halfW = Math.min(size.x, size.z) / 2.5; // metade da largura (lados)
    const h = 0.55 + size.y / 4;                  // altura dos faróis

    // Faróis (esfera invisível, só a luz fraquinha brilha)
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.01 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0.8 });
    for (const sx of [-halfW, halfW]) {
      // Farol dianteiro (invisível, só brilha)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lampMat);
      lamp.position.set(sx, h, halfL + 0.15);
      this.root.add(lamp);
      // Luz do farol (baixa intensidade, aparece pra todo mundo)
      const spot = new THREE.SpotLight(0xfff2cc, 60, 30, Math.PI / 6, 0.5, 1);
      spot.position.set(sx, h + 0.1, halfL + 0.25);
      spot.target.position.set(sx, h, halfL + 12);
      spot.castShadow = false;
      this.root.add(spot, spot.target);
      // Lanterna traseira
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.06), this.tailMat);
      tail.position.set(sx, h + 0.05, -(halfL + 0.15));
      this.root.add(tail);
    }
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.25, depthWrite: false }));
    this.shieldMesh.position.y = 1; this.shieldMesh.visible = false; this.root.add(this.shieldMesh);
  }

  setTarget(x, z, h, s, boost, shield) { this.t = { x, z, h, s, boost, shield }; }

  update(dt) {
    const k = 1 - Math.exp(-14 * dt), p = this.root.position, ox = p.x, oz = p.z;
    p.x += (this.t.x - p.x) * k; p.z += (this.t.z - p.z) * k;
    this.h += Math.atan2(Math.sin(this.t.h - this.h), Math.cos(this.t.h - this.h)) * k;
    this.root.rotation.y = this.h;

    const inv = dt > 0 ? 1 / dt : 0;
    this.vel.lerp(new THREE.Vector3((p.x - ox) * inv, 0, (p.z - oz) * inv), 1 - Math.exp(-10 * dt));
    const fwd = new THREE.Vector3(Math.sin(this.h), 0, Math.cos(this.h));
    const lat = this.vel.clone().addScaledVector(fwd, -this.vel.dot(fwd));
    const right = new THREE.Vector3(-Math.cos(this.h), 0, Math.sin(this.h));
    this.pivot.rotation.z += (clamp(lat.dot(right) * 0.01, -0.12, 0.12) - this.pivot.rotation.z) * Math.min(1, dt * 8);
    if (this.shieldMesh) this.shieldMesh.visible = this.t.shield;
    this.root.updateMatrixWorld(true);

    if (lat.length() > 4 && this.vel.length() > 8) {          // fumaça de derrapagem
      this.smokeAcc += dt * 70;
      while (this.smokeAcc >= 1) { this.smokeAcc--; for (const sx of [-0.9, 0.9]) vfx.emitSmoke(this.root.localToWorld(new THREE.Vector3(sx, 0.2, -1.4)), this.vel); }
    }
    if (this.t.boost) {                                      // fogo do turbo
      const back = fwd.clone().negate();
      for (const sx of [-0.55, 0.55]) { const pos = this.root.localToWorld(new THREE.Vector3(sx, 0.45, -2.2)); vfx.emitNitro(pos, back, this.vel); vfx.emitNitro(pos, back, this.vel); }
    }
  }

  destroy() { scene.remove(this.root); disposeTree(this.root); }
}

// ===== ILUMINAÇÃO / MUNDO =====
const hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 0.75);
const sun = new THREE.DirectionalLight(0xffffff, 2.9);
sun.position.set(60, 85, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(mobile ? 2048 : 4096, mobile ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 0.5, far: 520 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
sun.shadow.focus = true;
const fill = new THREE.DirectionalLight(0xffffff, 0.55);
fill.position.set(-45, 30, -35);
const glowA = new THREE.PointLight(0xffffff, 1300, 170, 2), glowB = new THREE.PointLight(0xffffff, 1300, 170, 2);
scene.add(hemi, sun, sun.target, fill, glowA, glowB);

let world = null, trackId = null, themeCfg = THEMES.FOREST, sunAngle = 0.8;

function setTrack(id) {
  const cfg = TRACKS[id] || TRACKS.SPEEDWAY;
  if (trackId === cfg.id) return;
  trackId = cfg.id;
  if (world) { scene.remove(world.group); disposeTree(world.group); }
  clearPickups();
  world = buildWorld(cfg);
  scene.add(world.group);
  themeCfg = THEMES[cfg.theme] || THEMES.FOREST;
  scene.background = new THREE.Color(cfg.skyColor);
  scene.fog = new THREE.Fog(cfg.skyColor, themeCfg.fogNear, themeCfg.fogFar);
  hemi.color.set(cfg.skyColor).lerp(new THREE.Color(0xffffff), 0.5);
  hemi.groundColor.set(cfg.groundColor);
  hemi.intensity = themeCfg.hemi;
  sun.intensity = themeCfg.sun;
  glowA.visible = glowB.visible = !!themeCfg.glow;
  if (themeCfg.glow) { glowA.color.set(themeCfg.glow[0]); glowB.color.set(themeCfg.glow[1]); }
}

// ===== ESTADO =====
const views = new Map();            // id → CarView
let myId = null, room = null, lastState = null, selectedCar = 'car_01_civic';
let garageView = null, garageOpen = false;
let coins = 5000, unlocked = ['car_01_civic'];
let myTel = null, sawCountdown = false;
try {
  const s = JSON.parse(localStorage.getItem('apex_save') || 'null');
  if (s) { coins = s.coins ?? coins; unlocked = s.unlocked ?? unlocked; selectedCar = s.selectedCar ?? selectedCar; }
} catch {}
const save = () => { try { localStorage.setItem('apex_save', JSON.stringify({ coins, unlocked, selectedCar })); } catch {} };
const updateWallet = () => { $('walletCoins').textContent = Math.floor(coins); };

let toastTimer;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400); }

// ===== REDE =====
const net = new Net({
  getName: () => localStorage.getItem('apex_name') || '',
  getCar: () => selectedCar,
  status(s) {
    const el = $('status');
    el.style.display = s === 'online' ? 'none' : 'block';
    el.textContent = s === 'connecting' ? 'Conectando… se o servidor estava dormindo, pode levar até 1 minuto.' : 'Sem conexão. Tentando reconectar…';
  },
  welcome(m) {
    myId = m.playerId;
    if (!$('name').value) $('name').value = m.name;
    localStorage.setItem('apex_name', m.name);
  },
  room_list(m) {
    if (room) { room = null; resetToMenu(); }                // servidor perdeu minha sala (reinício/expirou)
    renderRoomList(m.rooms);
    const code = new URLSearchParams(location.search).get('sala');   // link de convite
    if (code && !net.invited) { net.invited = true; net.send({ type: 'join_room', roomId: code, carType: selectedCar }); }
  },
  left_room() { room = null; resetToMenu(); },
  error(m) { toast(m.message); },
  room_state(m) { applyRoomState(m.room); },
  telemetry(m) { applyTelemetry(m); },
  race_rewards(m) { showResults(m.rewards); }
});

function resetToMenu() {
  for (const id of [...views.keys()]) removeView(id);
  setView('menu');
  ensurePreview();
}

function setView(v) { document.body.dataset.view = v; }

function applyRoomState(r) {
  const first = !room;
  room = r;
  removeView('preview');
  setTrack(r.trackId);

  const ids = new Set(r.players.map((p) => p.id));
  for (const id of [...views.keys()]) if (!ids.has(id)) removeView(id);
  for (const p of r.players) {
    let v = views.get(p.id);
    if (!v) { v = new CarView(p.carType, p.x, p.z, p.heading, p.id === myId); views.set(p.id, v); }
    else if (v.data.id !== p.carType) { v.destroy(); v = new CarView(p.carType, p.x, p.z, p.heading, p.id === myId); views.set(p.id, v); }
    if (r.state !== 'RACING') v.setTarget(p.x, p.z, p.heading, p.speed, false, false);
  }

  if (r.state === 'LOBBY') {
    setView('room');
    if (lastState && lastState !== 'LOBBY') $('results').classList.remove('open');
    controls.autoRotate = true;
  } else setView('race');
  lastState = r.state;
  if (first) setCamMode(r.state === 'LOBBY' ? 'orbit' : 'chase');
  else if (r.state !== 'LOBBY') setCamMode('chase');
  else setCamMode('orbit');

  const cfg = TRACKS[r.trackId];
  $('roomTitle').textContent = r.name;
  $('roomCode').textContent = r.id + (r.isPrivate ? '  🔒' : '');
  $('roomTrack').textContent = `${cfg.name} · ${r.totalLaps} voltas · ${r.players.length}/${r.maxPlayers} pilotos`;
  const me = r.players.find((p) => p.id === myId), host = r.hostId === myId;
  $('players').innerHTML = r.players.map((p) => `<div class="player"><span>${p.id === r.hostId ? '👑 ' : ''}${esc(p.name)}${p.connected ? '' : ' (offline)'}</span><span>${p.ready ? '✅' : '⏳'}</span></div>`).join('');
  $('btnReady').textContent = me?.ready ? 'Cancelar pronto' : 'Pronto';
  $('btnStart').style.display = host ? '' : 'none';
}

function removeView(id) { const v = views.get(id); if (v) { v.destroy(); views.delete(id); } }

function ensurePreview() {
  if (room || views.has('preview')) return;
  if (garageOpen) { showGarageCar(selectedCar); return; }
  setTrack('SPEEDWAY');
  const p = getPointAtProgress(0.985, 0, TRACKS.SPEEDWAY);
  views.set('preview', new CarView(selectedCar, p.x, p.z, p.heading, true));
  setCamMode('orbit');
}

// ===== GARAGEM 3D =====
function showGarageCar(carId) {
  if (room) return;
  hideGarageCar();
  const data = getCarById(carId) || CARS_DATABASE[0];
  const p = getPointAtProgress(0.5, 0, TRACKS.SPEEDWAY);
  garageView = new CarView(carId, p.x, p.z, p.heading, false);
  views.set('garage', garageView);
  setTrack('SPEEDWAY');
  setCamMode('orbit');
  controls.autoRotate = true;
  garageOpen = true;
  updateGarageInfo(data);
}

function hideGarageCar() {
  if (garageView) { garageView.destroy(); views.delete('garage'); garageView = null; }
  garageOpen = false;
}

function updateGarageInfo(c) {
  const el = $('garageInfo');
  if (!el) return;
  const owned = unlocked.includes(c.id);
  el.innerHTML = `
    <div style="margin:8px 0"><strong style="font-size:16px">${esc(c.name)}</strong></div>
    <div style="color:#94a3b8;font-size:12px">${c.brand} · ${c.year}</div>
    <div style="margin:4px 0;color:#00ff88">${esc(c.description)}</div>
    <div style="margin-top:6px;font-size:12px;color:#94a3b8">
      Vel ${c.topSpeed} · Acel ${c.acceleration} · Peso ${c.weight.toFixed(1)}
    </div>
    <div style="margin-top:8px">
      ${owned ? '<span style="color:#00ff88">✓ Já comprado</span>' : `<span style="color:#f59e0b">🔒 ${c.price} 💰</span>`}
    </div>
  `;
}

// ===== TELEMETRIA =====
const pickups = new THREE.Group(); scene.add(pickups);
const boxMeshes = new Map(), coinMeshes = new Map(), oilMeshes = new Map();
const boxGeo = new THREE.BoxGeometry(2, 2, 2), boxMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x7c4a00, emissiveIntensity: 1 });
const coinGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.2, 16).rotateX(Math.PI / 2), coinMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x854d0e, metalness: 0.8, roughness: 0.3 });
const oilGeo = new THREE.CircleGeometry(2.2, 20).rotateX(-Math.PI / 2), oilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

function clearPickups() { pickups.clear(); boxMeshes.clear(); coinMeshes.clear(); oilMeshes.clear(); }

function syncPool(map, list, make) {
  for (const it of list) {
    let m = map.get(it.id);
    if (!m) { m = make(it); map.set(it.id, m); pickups.add(m); }
    m.visible = it.active !== false;
  }
}

function applyTelemetry(m) {
  syncPool(boxMeshes, m.itemBoxes, (b) => { const o = new THREE.Mesh(boxGeo, boxMat); o.position.set(b.x, 1.6, b.z); return o; });
  syncPool(coinMeshes, m.coins, (c) => { const o = new THREE.Mesh(coinGeo, coinMat); o.position.set(c.x, 1.2, c.z); return o; });
  const oilIds = new Set(m.oilTraps.map((o) => o.id));
  for (const [id, mesh] of oilMeshes) if (!oilIds.has(id)) { pickups.remove(mesh); oilMeshes.delete(id); }
  for (const o of m.oilTraps) if (!oilMeshes.has(o.id)) { const mesh = new THREE.Mesh(oilGeo, oilMat); mesh.position.set(o.x, 0.1, o.z); oilMeshes.set(o.id, mesh); pickups.add(mesh); }

  for (const c of m.cars) {
    views.get(c.id)?.setTarget(c.x, c.z, c.h, c.s, c.boost, c.shield);
    if (c.id === myId) myTel = c;
  }

  // Contagem regressiva / "GO!"
  const cd = $('countdown');
  if (m.state === 'COUNTDOWN') { sawCountdown = true; cd.textContent = Math.max(1, Math.ceil(m.countdownMs / 1000)); }
  else if (m.state === 'RACING' && sawCountdown) { sawCountdown = false; cd.textContent = 'GO!'; setTimeout(() => { if (cd.textContent === 'GO!') cd.textContent = ''; }, 900); }
  else if (cd.textContent !== 'GO!') cd.textContent = '';

  if (myTel && room) {
    $('hPos').textContent = `${myTel.pos}º`;
    $('hLap').textContent = `Volta ${myTel.lap}/${room.totalLaps}${myTel.fin ? ' 🏁' : ''}`;
    $('hCoins').textContent = `🪙 ${myTel.coins}`;
    $('hSpeed').textContent = `${Math.round(Math.abs(myTel.s) * 2.2)} km/h`;
    $('hPower').textContent = myTel.power ? `⚡ ${myTel.power} (Espaço/botão)` : '';
  }
}

function showResults(rewards) {
  const sorted = [...rewards].sort((a, b) => a.position - b.position);
  $('resList').innerHTML = sorted.map((r) => `<div class="player"><span>${r.position}º ${esc(r.name)}${r.id === myId ? ' (você)' : ''}</span><span>+${r.totalEarned} 💰</span></div>`).join('');
  const mine = rewards.find((r) => r.id === myId);
  if (mine) { coins += mine.totalEarned; updateWallet(); save(); }
  $('results').classList.add('open');
}

// ===== GARAGEM =====
function renderCarList() {
  const list = $('carList'); list.innerHTML = '';
  CARS_DATABASE.forEach((c) => {
    const owned = unlocked.includes(c.id);
    const b = document.createElement('button');
    b.className = 'car-button' + (c.id === selectedCar ? ' selected' : '') + (owned ? '' : ' locked');
    b.innerHTML = `<strong>${esc(c.name)}</strong><br><small>Vel ${c.topSpeed} | Acel ${c.acceleration} | ${owned ? '✓' : `🔒 ${c.price} 💰`}</small>`;
    b.onclick = () => {
      if (!owned) {
        if (coins < c.price) return toast(`Faltam ${Math.ceil(c.price - coins)} moedas`);
        coins -= c.price; unlocked.push(c.id); updateWallet(); toast(`${c.name} comprado!`);
      }
      selectedCar = c.id; save(); renderCarList();
      if (garageOpen) { showGarageCar(selectedCar); }
      else if (room) net.send({ type: 'set_car', carType: c.id });       // só vale no lobby da sala
      else { removeView('preview'); ensurePreview(); }
    };
    list.appendChild(b);
  });
}
$('garageBtn').onclick = () => {
  const isOpen = $('garage').classList.toggle('open');
  garageOpen = isOpen;
  if (isOpen) { showGarageCar(selectedCar); }
  else { hideGarageCar(); ensurePreview(); }
};

// ===== MENU / SALA =====
function renderRoomList(rooms) {
  const el = $('roomList');
  if (!rooms.length) { el.innerHTML = '<small>Nenhuma sala. Crie uma ou use o jogo rápido.</small>'; return; }
  el.innerHTML = rooms.map((r) => {
    const full = r.playersCount >= r.maxPlayers, closed = r.state !== 'LOBBY' && !r.allowMidRaceJoin;
    return `<div class="room"><span><strong>${esc(r.name)}</strong><br><small>${esc(TRACKS[r.trackId]?.name || r.trackId)} · ${r.playersCount}/${r.maxPlayers} · ${r.state === 'LOBBY' ? 'aguardando' : 'em corrida'}</small></span><button data-join="${esc(r.id)}" ${full || closed ? 'disabled' : ''}>Entrar</button></div>`;
  }).join('');
}
$('roomList').onclick = (e) => { const id = e.target.dataset?.join; if (id) net.send({ type: 'join_room', roomId: id, carType: selectedCar }); };

$('trackSel').innerHTML = Object.values(TRACKS).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
$('name').addEventListener('change', () => { localStorage.setItem('apex_name', $('name').value.trim()); net.hello(); });
$('btnQuick').onclick = () => net.send({ type: 'quick_play', carType: selectedCar });
$('btnCreate').onclick = () => net.send({
  type: 'create_room',
  roomName: $('roomName').value.trim(),
  maxPlayers: +$('maxSel').value,
  trackId: $('trackSel').value,
  totalLaps: +$('lapsSel').value,
  isPrivate: $('privateToggle').checked,
  password: $('roomPass').value.trim(),
  allowMidRaceJoin: false,
  carType: selectedCar
});
$('btnJoin').onclick = () => {
  const c = $('codeIn').value.trim().toUpperCase();
  if (c) net.send({ type: 'join_room', roomId: c, carType: selectedCar, password: $('roomPass').value.trim() });
};
$('btnReady').onclick = () => net.send({ type: 'toggle_ready' });
$('btnStart').onclick = () => net.send({ type: 'start_race' });
$('btnLeave').onclick = () => net.send({ type: 'leave_room' });
$('btnResClose').onclick = () => $('results').classList.remove('open');
$('btnShare').onclick = async () => {
  if (!room) return;
  const url = `${location.origin}${location.pathname}?sala=${room.id}`;
  const text = `Corre comigo no Apex Circuit! Sala ${room.id}`;
  try { if (navigator.share) await navigator.share({ title: 'Apex Circuit', text, url }); else { await navigator.clipboard.writeText(url); toast('Link copiado!'); } } catch {}
};

// ===== CONTROLES (teclado + toque) =====
const keys = {}, touchKeys = {};
const DRIVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (['Space', ...DRIVE].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE' || (e.code === 'Space' && !e.repeat)) net.send({ type: 'use_power' });
  if (e.code === 'KeyC' && room && room.state !== 'LOBBY') setCamMode(camMode === 'chase' ? 'orbit' : 'chase');
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in touchKeys) touchKeys[k] = false; });

document.querySelectorAll('#touch .btn').forEach((b) => {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); b.classList.add('on'); if (k === 'power') net.send({ type: 'use_power' }); else touchKeys[k] = true; };
  const off = (e) => { e.preventDefault(); b.classList.remove('on'); touchKeys[k] = false; };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
});

let lastInput = '', inputTimer = 0;
function sendInput(dt) {
  if (!room || room.state === 'LOBBY') return;
  const i = {
    up: !!(keys.KeyW || keys.ArrowUp || touchKeys.up), down: !!(keys.KeyS || keys.ArrowDown || touchKeys.down),
    left: !!(keys.KeyA || keys.ArrowLeft || touchKeys.left), right: !!(keys.KeyD || keys.ArrowRight || touchKeys.right)
  };
  const s = JSON.stringify(i);
  inputTimer += dt;
  if (s !== lastInput || inputTimer > 0.25) { net.send({ type: 'input', ...i }); lastInput = s; inputTimer = 0; }
}

// ===== CÂMERA =====
let camMode = 'orbit';
function setCamMode(m) { camMode = m; controls.enabled = m === 'orbit'; controls.autoRotate = m === 'orbit' && (!room || room.state === 'LOBBY'); }
function myView() { return views.get(myId) || (garageOpen ? views.get('garage') : null) || views.get('preview'); }

function updateCamera(dt) {
  const v = myView();
  if (!v) return;
  const p = v.root.position;
  if (camMode === 'chase') {
    const fwd = new THREE.Vector3(Math.sin(v.h), 0, Math.cos(v.h));
    camera.position.lerp(p.clone().addScaledVector(fwd, -11).add(new THREE.Vector3(0, 5, 0)), 1 - Math.exp(-6 * dt));
    camera.lookAt(p.clone().addScaledVector(fwd, 8).add(new THREE.Vector3(0, 1.2, 0)));
    const fov = 62 + clamp(Math.abs(v.t.s) / 55, 0, 1.4) * 16;
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
  } else {
    controls.target.lerp(p.clone().setY(1), 1 - Math.exp(-8 * dt));
    controls.update();
  }
}

// ===== LOOP =====
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  sendInput(dt);
  for (const v of views.values()) v.update(dt);
  for (const m of boxMeshes.values()) m.rotation.y = t * 1.5;
  for (const m of coinMeshes.values()) m.rotation.y = t * 3;

  const focus = myView()?.root.position || new THREE.Vector3();
  if (themeCfg.sunMoves) sunAngle += dt * 0.02;
  const dir = new THREE.Vector3(Math.cos(sunAngle), 0.9 + 0.35 * Math.sin(sunAngle), Math.sin(sunAngle)).normalize();
  sun.position.copy(focus).addScaledVector(dir, 150); sun.target.position.copy(focus);
  glowA.position.set(focus.x + 10, 8, focus.z); glowB.position.set(focus.x - 10, 8, focus.z);
  world?.update(t, dt);

  vfx.setScale(renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  vfx.update(dt);
  updateCamera(dt);
  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});

// ===== INIT =====
$('name').value = localStorage.getItem('apex_name') || '';
if (!unlocked.includes(selectedCar)) selectedCar = 'car_01_civic';
updateWallet(); renderCarList(); ensurePreview();
net.connect();
frame();
