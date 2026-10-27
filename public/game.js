// public/game.js - Motor 3D: carros, física arcade, câmera, iluminação dinâmica, loja
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CARS_DATABASE, getCarById, getMapById } from './carData.js';
import { buildMap, WORLD_HALF } from './maps.js';
import { VFX } from './vfx.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// ===== RENDERER / CENA =====
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;      // (antes: PCFShadowShadowMap, nome inexistente)
renderer.toneMapping = THREE.ACESFilmicToneMapping;    // (outputEncoding foi removido do Three r152+)

camera.position.set(8, 5, 12);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.maxPolarAngle = Math.PI / 2.05;

const vfx = new VFX(scene);

// ===== CARREGADOR GENÉRICO (.glb / .gltf) =====
const gltfLoader = new GLTFLoader();
const modelCache = new Map();

export function loadModel(url) {
  if (!modelCache.has(url)) {
    modelCache.set(url, new Promise((resolve, reject) =>
      gltfLoader.load(url, (g) => resolve(g.scene), undefined, reject)
    ).catch((e) => { modelCache.delete(url); throw e; }));
  }
  return modelCache.get(url).then((s) => s.clone(true));
}

/** Escala o modelo para ~4.4 m, centraliza e apoia no chão (qualquer .glb funciona). */
function normalizeModel(obj, targetLen = 4.4) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) { obj.rotation.y = Math.PI / 2; box.setFromObject(obj); box.getSize(size); }
  obj.scale.multiplyScalar(targetLen / (Math.max(size.x, size.z) || 1));
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(obj.position.x - c.x, obj.position.y - box.min.y, obj.position.z - c.z);
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

/** Como vários carros reutilizam o mesmo .glb, pintamos o material da carroceria com a cor do carro. */
function tintModel(model, color) {
  model.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = c.receiveShadow = true;
    c.material = Array.isArray(c.material) ? c.material.map((m) => m.clone()) : c.material.clone();
    [].concat(c.material).forEach((m) => { if (/body|paint|carpaint|main/i.test(m.name)) m.color.set(color); });
  });
}

function createFallbackCar(d) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: d.color, metalness: 0.7, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.5, roughness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.2), paint); body.position.y = 0.65;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2), dark); cabin.position.set(0, 1.2, -0.2);
  g.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) {
    const w = new THREE.Mesh(wheelGeo, dark); w.position.set(x, 0.4, z); g.add(w);
  }
  g.traverse((c) => { if (c.isMesh) c.castShadow = c.receiveShadow = true; });
  return g;
}

// ===== CARRO =====
const CAR_FWD = new THREE.Vector3();

class GameCar {
  constructor(data, pos, heading = 0) {
    this.data = data;
    this.root = new THREE.Group();
    this.root.position.copy(pos);
    this.heading = heading;
    this.speed = 0;
    this.vel = new THREE.Vector3();
    this.nitro = 100;
    this.nitroOn = false;
    this.braking = false;
    this.slip = 0;
    this.smokeAcc = 0;
    this.loaded = false;
    this.pivot = new THREE.Group();  // recebe o "roll" visual
    this.root.add(this.pivot);
    scene.add(this.root);
    this.ready = this.load();
  }

  async load() {
    let model;
    try {
      model = normalizeModel(await loadModel(this.data.modelPath));
      tintModel(model, this.data.color);
    } catch {
      console.warn(`Modelo ausente (${this.data.modelPath}) → usando carro genérico.`);
      model = createFallbackCar(this.data);
    }
    this.pivot.add(model);
    this.addLights();
    this.loaded = true;
  }

  addLights() {
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0.6 });
    for (const sx of [-0.75, 0.75]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), lampMat);
      lamp.position.set(sx, 0.7, 2.15);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.08), this.tailMat);
      tail.position.set(sx, 0.75, -2.18);
      // Farol de verdade: SpotLight com alvo apontando para frente (sem cast shadow = barato)
      const spot = new THREE.SpotLight(0xfff2cc, 400, 60, Math.PI / 7, 0.5, 2);
      spot.position.set(sx, 0.7, 2.1);
      const target = new THREE.Object3D();
      target.position.set(sx, 0.2, 22);
      spot.target = target;
      this.root.add(lamp, tail, spot, target);
    }
  }

  forward(out = CAR_FWD) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  update(dt, input) {
    const d = this.data;
    const useNitro = input.nitro && this.nitro > 0 && this.speed > 5;
    this.nitroOn = useNitro;
    this.nitro = clamp(this.nitro + (useNitro ? -35 : 8) * dt, 0, 100);

    const top = d.topSpeed * (useNitro ? 1.35 : 1);
    this.braking = false;

    if (input.up) {
      const k = clamp(this.speed / top, 0, 1);
      this.speed += d.acceleration * 0.4 * (useNitro ? 2 : 1) * (1 - k * k) * dt;
    } else if (input.down) {
      if (this.speed > 0.5) { this.speed -= d.braking * 18 * dt; this.braking = true; }
      else this.speed = Math.max(this.speed - d.acceleration * 0.2 * dt, -top * 0.3);
    } else {
      this.speed *= Math.exp(-0.35 * dt);
    }
    if (this.speed > top) this.speed -= 20 * dt;             // perde o excesso após o nitro
    if (input.handbrake) { this.speed *= Math.exp(-0.8 * dt); this.braking = true; }

    // Direção (esquerda = +heading)
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const authority = clamp(Math.abs(this.speed) / 12, 0, 1) * Math.sign(this.speed) * (1 - clamp(this.speed / top, 0, 1) * 0.35);
    this.heading += steer * d.handling * 0.55 * authority * dt;

    // Aderência: velocidade real "persegue" a direção do carro → derrapagem natural
    const fwd = this.forward();
    const grip = input.handbrake ? 1.8 : 6 + d.handling;
    this.vel.lerp(fwd.clone().multiplyScalar(this.speed), 1 - Math.exp(-grip * dt));
    const lateral = this.vel.clone().addScaledVector(fwd, -this.vel.dot(fwd));
    this.slip = lateral.length();

    const p = this.root.position;
    p.addScaledVector(this.vel, dt);
    p.x = clamp(p.x, -WORLD_HALF, WORLD_HALF);
    p.z = clamp(p.z, -WORLD_HALF, WORLD_HALF);
    this.root.rotation.y = this.heading;

    const right = new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
    this.pivot.rotation.z += (clamp(lateral.dot(right) * 0.01, -0.12, 0.12) - this.pivot.rotation.z) * Math.min(1, dt * 8);

    if (this.tailMat) this.tailMat.emissiveIntensity = this.braking ? 3 : 0.6;
    this.root.updateMatrixWorld(true);
    this.emitEffects(dt);
  }

  emitEffects(dt) {
    // Fumaça de pneu: derrapando ou freio de mão
    if (this.slip > 4 && Math.abs(this.speed) > 8) {
      this.smokeAcc += dt * 70;
      while (this.smokeAcc >= 1) {
        this.smokeAcc--;
        for (const sx of [-0.9, 0.9]) vfx.emitSmoke(this.root.localToWorld(new THREE.Vector3(sx, 0.2, -1.4)), this.vel);
      }
    }
    // Fogo do nitro nos escapamentos
    if (this.nitroOn) {
      const back = this.forward(new THREE.Vector3()).negate();
      for (const sx of [-0.55, 0.55]) {
        const pos = this.root.localToWorld(new THREE.Vector3(sx, 0.45, -2.2));
        vfx.emitNitro(pos, back, this.vel);
        vfx.emitNitro(pos, back, this.vel);
      }
    }
  }

  destroy() { scene.remove(this.root); disposeTree(this.root); }
}

function disposeTree(obj) {
  obj.traverse((c) => {
    c.geometry?.dispose?.();
    [].concat(c.material || []).forEach((m) => { m.map?.dispose?.(); m.emissiveMap?.dispose?.(); m.dispose?.(); });
  });
}

// ===== ILUMINAÇÃO DINÂMICA =====
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
const neonA = new THREE.PointLight(0x00ffff, 900, 140, 2);
const neonB = new THREE.PointLight(0xff00ff, 900, 140, 2);
scene.add(hemi, sun, sun.target, neonA, neonB);

let sunAngle = 0.8;
let mapInst = null;
let currentMapId = 'city';

function setMap(id) {
  const cfg = getMapById(id);
  if (!cfg) return;
  currentMapId = id;
  if (mapInst) { scene.remove(mapInst.group); disposeTree(mapInst.group); }
  mapInst = buildMap(id, cfg);
  scene.add(mapInst.group);

  scene.background = new THREE.Color(cfg.skyColor);
  scene.fog = new THREE.Fog(cfg.fogColor, cfg.fogNear, cfg.fogFar);   // (antes: near/far invertidos → sem névoa)
  hemi.color.set(cfg.skyColor).lerp(new THREE.Color(0xffffff), 0.5);
  hemi.groundColor.set(cfg.groundColor);
  hemi.intensity = cfg.ambientLightIntensity * 0.9;
  sun.intensity = cfg.directionalLightIntensity * 2.5;
  neonA.visible = neonB.visible = cfg.theme === 'CYBER';

  $('currentMap').textContent = cfg.name;
  document.querySelectorAll('.map-button').forEach((b) => b.classList.toggle('active', b.dataset.map === id));
}

function updateEnvironment(dt, t) {
  const focus = car ? car.root.position : new THREE.Vector3();
  const cfg = getMapById(currentMapId);
  if (cfg.theme !== 'CYBER') sunAngle += dt * 0.02;            // sol se movendo devagar → ambiente vivo
  const elev = cfg.theme === 'CYBER' ? 0.7 : 0.9 + 0.35 * Math.sin(sunAngle);
  const dir = new THREE.Vector3(Math.cos(sunAngle), elev, Math.sin(sunAngle)).normalize();
  sun.position.copy(focus).addScaledVector(dir, 150);
  sun.target.position.copy(focus);                            // frustum de sombra segue o carro
  neonA.position.set(focus.x + 10, 8, focus.z);
  neonB.position.set(focus.x - 10, 8, focus.z);
  mapInst?.update(t, dt);
}

// ===== ESTADO / SAVE =====
let car = null;
let selectToken = 0;
let coins = 5000;
let unlocked = ['car_01_civic'];
let selectedId = 'car_01_civic';
let earnAcc = 0;

try {
  const s = JSON.parse(localStorage.getItem('apex_save') || 'null');
  if (s) { coins = s.coins ?? coins; unlocked = s.unlocked ?? unlocked; selectedId = s.selectedId ?? selectedId; }
} catch {}
const save = () => { try { localStorage.setItem('apex_save', JSON.stringify({ coins, unlocked, selectedId })); } catch {} };
addEventListener('beforeunload', save);

// ===== UI =====
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
const updateWallet = () => { $('walletCoins').textContent = Math.floor(coins); };

function renderCarList() {
  const list = $('carList');
  list.innerHTML = '';
  CARS_DATABASE.forEach((c) => {
    const owned = unlocked.includes(c.id);
    const b = document.createElement('button');
    b.className = 'car-button' + (c.id === selectedId ? ' selected' : '') + (owned ? '' : ' locked');
    b.innerHTML = `<strong>${c.name}</strong><br><small>Vel: ${c.topSpeed} | Acel: ${c.acceleration} | ${owned ? '✓' : `🔒 ${c.price} 💰`}</small>`;
    b.onclick = () => {
      if (owned) return selectCar(c.id);
      if (coins < c.price) return toast(`Faltam ${Math.ceil(c.price - coins)} moedas para ${c.name}`);
      coins -= c.price; unlocked.push(c.id); updateWallet(); save();
      toast(`${c.name} comprado!`);
      selectCar(c.id);
    };
    list.appendChild(b);
  });
}

function showLoading(show, text = 'Carregando...') {
  $('loading').classList.toggle('active', show);
  if (show) $('loadingText').textContent = text;
}

async function selectCar(id) {
  const data = getCarById(id);
  if (!data) return;
  const token = ++selectToken;
  showLoading(true, `Carregando ${data.name}...`);
  const prev = car;
  const next = new GameCar(data, prev ? prev.root.position : new THREE.Vector3(0, 0, 0), prev ? prev.heading : 0);
  await next.ready;
  if (token !== selectToken) { next.destroy(); return; }       // clique mais recente venceu
  prev?.destroy();
  car = next;
  selectedId = id; save();
  $('currentCar').textContent = data.name;
  renderCarList();
  showLoading(false);
}

// ===== CONTROLES =====
const keys = {};
const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
let camMode = 'orbit';

function setCamMode(mode) {
  camMode = mode;
  controls.enabled = mode === 'orbit';
  controls.autoRotate = mode === 'orbit' && !car?.speed;
}

addEventListener('keydown', (e) => {
  if (['Space', ...DRIVE_KEYS].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyC') setCamMode(camMode === 'chase' ? 'orbit' : 'chase');
  if (camMode === 'orbit' && DRIVE_KEYS.includes(e.code)) setCamMode('chase');
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const down = (...codes) => codes.some((c) => keys[c]);

function updateCamera(dt) {
  if (!car) return;
  const p = car.root.position;
  if (camMode === 'chase') {
    const fwd = car.forward(new THREE.Vector3());
    const goal = p.clone().addScaledVector(fwd, -11).add(new THREE.Vector3(0, 5, 0));
    camera.position.lerp(goal, 1 - Math.exp(-6 * dt));
    camera.lookAt(p.clone().addScaledVector(fwd, 8).add(new THREE.Vector3(0, 1.2, 0)));
    const fov = 62 + clamp(Math.abs(car.speed) / car.data.topSpeed, 0, 1.35) * 16;   // sensação de velocidade
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  } else {
    controls.target.lerp(p.clone().setY(1), 1 - Math.exp(-8 * dt));
    controls.update();
  }
}

// ===== LOOP =====
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  frames++; fpsT += dt;
  if (fpsT >= 1) { $('fps').textContent = frames; frames = 0; fpsT = 0; }

  if (car?.loaded) {
    car.update(dt, {
      up: down('KeyW', 'ArrowUp'), down: down('KeyS', 'ArrowDown'),
      left: down('KeyA', 'ArrowLeft'), right: down('KeyD', 'ArrowRight'),
      nitro: down('ShiftLeft', 'ShiftRight'), handbrake: down('Space')
    });
    $('speedValue').textContent = Math.round(car.vel.length() * 2.2);
    $('nitroFill').style.width = car.nitro + '%';
    earnAcc += Math.abs(car.speed) * dt * 0.02;                 // dirigir rende moedas
    if (earnAcc >= 1) { coins += Math.floor(earnAcc); earnAcc %= 1; updateWallet(); }
  }

  updateEnvironment(dt, clock.elapsedTime);
  vfx.setScale(renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  vfx.update(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.querySelectorAll('.map-button').forEach((b) => b.addEventListener('click', () => setMap(b.dataset.map)));

// ===== INIT =====
(async function init() {
  showLoading(true, 'Inicializando jogo...');
  setMap('city');
  updateWallet();
  if (!unlocked.includes(selectedId)) selectedId = 'car_01_civic';
  renderCarList();
  await selectCar(selectedId);
  setCamMode('orbit');
  frame();
})();
