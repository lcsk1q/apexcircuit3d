// public/game.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TRACKS, getPointAtProgress } from '/shared/track.js';

// Mapeamento dos 4 carros .GLB com preços e escala ajustada
const CAR_TYPES = [
  { 
    id: 'CAR1', 
    name: 'Carro 1 (Inicial)', 
    modelFile: '/models/car1.glb', 
    price: 0, 
    tier: 1, 
    topSpeed: 45, 
    accel: 35, 
    handling: 2.5, 
    desc: 'Carro leve inicial para começar as corridas.', 
    color: '#3b82f6', 
    scale: 0.8 // Ajuste este valor se o car1 ficar grande ou pequeno demais
  },
  { 
    id: 'CAR2', 
    name: 'Carro 2 (Tuner GT)', 
    modelFile: '/models/car2.glb', 
    price: 200, 
    tier: 2, 
    topSpeed: 50, 
    accel: 40, 
    handling: 2.7, 
    desc: 'Modelo esportivo com maior aceleração.', 
    color: '#ef4444', 
    scale: 0.85 
  },
  { 
    id: 'CAR3', 
    name: 'Carro 3 (Muscle V8)', 
    modelFile: '/models/car3.glb', 
    price: 700, 
    tier: 3, 
    topSpeed: 55, 
    accel: 45, 
    handling: 2.9, 
    desc: 'Super potente em retas.', 
    color: '#f59e0b', 
    scale: 0.8 
  },
  { 
    id: 'CAR4', 
    name: 'Carro 4 (Cyber Hyper)', 
    modelFile: '/models/car4.glb', 
    price: 1500, 
    tier: 4, 
    topSpeed: 60, 
    accel: 50, 
    handling: 3.2, 
    desc: 'O carro definitivo do circuito.', 
    color: '#10b981', 
    scale: 8
  }
];

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice) document.body.classList.add('is-touch');

let ws = null;
let myPlayerId = null;
let myToken = localStorage.getItem('apex_session_token') || '';
let myName = localStorage.getItem('apex_player_name') || '';
let currentRoom = null;
let currentTrackConfig = TRACKS.SPEEDWAY;
let lowGraphics = localStorage.getItem('apex_low_gfx') === '1';

// CARTEIRA E GARAGEM
let walletCoins = Number(localStorage.getItem('apex_wallet_coins') || 0);
let unlockedCars = JSON.parse(localStorage.getItem('apex_unlocked_cars') || '["CAR1"]');
let selectedCarId = localStorage.getItem('apex_selected_car') || 'CAR1';

if (selectedCarId === 'STARTER') selectedCarId = 'CAR1';
if (!unlockedCars.includes('CAR1')) unlockedCars.push('CAR1');

let inGarageView = false;
let garageCarIndex = Math.max(0, CAR_TYPES.findIndex(c => c.id === selectedCarId));

const inputs = { up: false, down: false, left: false, right: false };
let lastInputSent = '';

const carEntities = new Map();
const itemBoxMeshes = new Map();
const coinMeshes = new Map();
const oilTrapMeshes = new Map();

// UI Elements
const elMenu = document.getElementById('menu-screen');
const elGarage = document.getElementById('garage-screen');
const elLobby = document.getElementById('lobby-screen');
const elHud = document.getElementById('race-hud');
const elResults = document.getElementById('results-screen');
const elCountdown = document.getElementById('countdown-banner');
const elTouchControls = document.getElementById('touch-controls');
const elNameInput = document.getElementById('player-name');
const elBtnGfx = document.getElementById('btn-gfx');

if (myName && elNameInput) elNameInput.value = myName;

function saveEconomy() {
  localStorage.setItem('apex_wallet_coins', String(walletCoins));
  localStorage.setItem('apex_unlocked_cars', JSON.stringify(unlockedCars));
  localStorage.setItem('apex_selected_car', selectedCarId);
  updateEconomyUI();
}

function updateEconomyUI() {
  const w1 = document.getElementById('wallet-coins');
  const w2 = document.getElementById('garage-wallet');
  const eq = document.getElementById('equipped-car-label');
  if (w1) w1.textContent = walletCoins;
  if (w2) w2.textContent = walletCoins;
  const carObj = CAR_TYPES.find(c => c.id === selectedCarId) || CAR_TYPES[0];
  if (eq) eq.textContent = carObj.name;
}
updateEconomyUI();

function showToast(msg, color = '#ef4444') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.style.background = color;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ==========================================
// THREE.JS ENGINE & ILUMINAÇÃO
// ==========================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGraphics, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b172a);
scene.fog = new THREE.FogExp2(0x0b172a, 0.0028);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 550);
camera.position.set(0, 25, -40);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.8);
dirLight.position.set(80, 140, 60);
scene.add(dirLight);

// Geração de Mapa de Reflexos (Environment Map) para brilho metálico na lataria
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

function generateEnvMap() {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1e293b);
  const light1 = new THREE.DirectionalLight(0x38bdf8, 3);
  light1.position.set(1, 2, 1);
  const light2 = new THREE.DirectionalLight(0xf59e0b, 2);
  light2.position.set(-1, -1, -1);
  envScene.add(light1, light2);

  const renderTarget = pmremGenerator.fromScene(envScene);
  scene.environment = renderTarget.texture;
}
generateEnvMap();

function applyGraphicsMode() {
  renderer.setPixelRatio(lowGraphics ? 1 : Math.min(window.devicePixelRatio, 2));
  if (elBtnGfx) elBtnGfx.textContent = `Gráficos: ${lowGraphics ? 'Baixo' : 'Alto'}`;
}
applyGraphicsMode();

if (elBtnGfx) {
  elBtnGfx.addEventListener('click', () => {
    lowGraphics = !lowGraphics;
    localStorage.setItem('apex_low_gfx', lowGraphics ? '1' : '0');
    applyGraphicsMode();
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// CARREGAMENTO DE MODELOS E EFETOS DE NITRO
// ==========================================
const gltfLoader = new GLTFLoader();

// Função para criar o efeito de chamas duplas do Nitro
function createNitroFlameEffect() {
  const nitroGroup = new THREE.Group();

  const flameMatCore = new THREE.MeshBasicMaterial({ color: 0x38bdf8 }); // Azul neon interno
  const flameMatOuter = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85 }); // Laranja externo

  const positions = [-0.45, 0.45]; // Escapamento esquerdo e direito

  positions.forEach(x => {
    const singleExhaust = new THREE.Group();

    const core = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.2, 8), flameMatCore);
    core.rotation.x = -Math.PI / 2;
    core.position.z = -0.6;

    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.8, 8), flameMatOuter);
    outer.rotation.x = -Math.PI / 2;
    outer.position.z = -0.9;

    singleExhaust.add(core, outer);
    singleExhaust.position.set(x, 0.4, -2.1);
    nitroGroup.add(singleExhaust);
  });

  // Luz do Nitro
  const nitroLight = new THREE.PointLight(0x38bdf8, 4, 8);
  nitroLight.position.set(0, 0.5, -2.2);
  nitroGroup.add(nitroLight);

  return nitroGroup;
}

export function createDetailedCarMesh(carTypeId = 'CAR1', customColor = null) {
  const spec = CAR_TYPES.find(c => c.id === carTypeId) || CAR_TYPES[0];
  const root = new THREE.Group();

  // Escudo
  const shieldGeo = new THREE.SphereGeometry(2.6, 18, 18);
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.55 });
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
  shieldMesh.position.y = 0.8;
  shieldMesh.visible = false;
  root.add(shieldMesh);

  // Efeito de Nitro Bonito
  const flameMesh = createNitroFlameEffect();
  flameMesh.visible = false;
  root.add(flameMesh);

  root.userData = { shieldMesh, flameMesh, carTypeId: spec.id };

  // Carregador GLB com escala ajustada por veículo
  gltfLoader.load(
    spec.modelFile,
    (gltf) => {
      const model = gltf.scene;

      // Aplica a escala definida individualmente no objeto CAR_TYPES
      const carScale = spec.scale || 0.8;
      model.scale.set(carScale, carScale, carScale);

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material.envMapIntensity = 1.2;
          }
        }
      });

      root.add(model);
    },
    undefined,
    () => {
      // Fallback
      const fallback = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.8, 4),
        new THREE.MeshStandardMaterial({ color: spec.color || 0x3b82f6 })
      );
      fallback.position.y = 0.5;
      root.add(fallback);
    }
  );

  return root;
}

// ==========================================
// SHOWROOM DA GARAGEM 3D
// ==========================================
const garageGroup = new THREE.Group();
garageGroup.position.set(0, 500, 0);
scene.add(garageGroup);

const pedestalGeo = new THREE.CylinderGeometry(3.8, 4.2, 0.4, 32);
const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.2 });
const pedestalMesh = new THREE.Mesh(pedestalGeo, pedestalMat);
garageGroup.add(pedestalMesh);

const ringGeo = new THREE.RingGeometry(3.5, 3.75, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide });
const ringMesh = new THREE.Mesh(ringGeo, ringMat);
ringMesh.rotation.x = Math.PI / 2;
ringMesh.position.y = 0.22;
garageGroup.add(ringMesh);

const garageLight = new THREE.PointLight(0xffffff, 3.0, 25);
garageLight.position.set(0, 6, 4);
garageGroup.add(garageLight);

let garagePreviewCar = null;

function refreshGarageShowroom() {
  if (garagePreviewCar) {
    garageGroup.remove(garagePreviewCar);
  }
  const spec = CAR_TYPES[garageCarIndex];
  garagePreviewCar = createDetailedCarMesh(spec.id, spec.color);
  garagePreviewCar.position.y = 0.22;
  garageGroup.add(garagePreviewCar);

  document.getElementById('garage-car-tier').textContent = `TIER ${spec.tier}`;
  document.getElementById('garage-car-name').textContent = spec.name;
  document.getElementById('garage-car-desc').textContent = spec.desc;

  const spdPct = Math.round((spec.topSpeed / 60) * 100);
  const accPct = Math.round((spec.accel / 50) * 100);
  const hndPct = Math.round((spec.handling / 3.2) * 100);

  document.getElementById('stat-speed-txt').textContent = `${spdPct}%`;
  document.getElementById('stat-speed-bar').style.width = `${spdPct}%`;
  document.getElementById('stat-accel-txt').textContent = `${accPct}%`;
  document.getElementById('stat-accel-bar').style.width = `${accPct}%`;
  document.getElementById('stat-hand-txt').textContent = `${hndPct}%`;
  document.getElementById('stat-hand-bar').style.width = `${hndPct}%`;

  const btnAction = document.getElementById('btn-buy-equip-car');
  const isUnlocked = unlockedCars.includes(spec.id);
  const isEquipped = selectedCarId === spec.id;

  if (isEquipped) {
    btnAction.textContent = '✅ EQUIPADO';
    btnAction.className = 'btn-secondary flex-1 font-orbitron';
  } else if (isUnlocked) {
    btnAction.textContent = 'EQUIPAR CARRO';
    btnAction.className = 'btn-success flex-1 font-orbitron';
  } else {
    btnAction.textContent = `COMPRAR (🪙 ${spec.price})`;
    btnAction.className = 'btn-gold flex-1 font-orbitron';
  }
}

// ==========================================
// CONSTRUÇÃO DE PISTAS 3D
// ==========================================
const trackMeshGroup = new THREE.Group();
scene.add(trackMeshGroup);

function clearMapObjects() {
  for (const m of itemBoxMeshes.values()) scene.remove(m);
  itemBoxMeshes.clear();
  for (const m of coinMeshes.values()) scene.remove(m);
  coinMeshes.clear();
  for (const m of oilTrapMeshes.values()) scene.remove(m);
  oilTrapMeshes.clear();
}

function buildTrackScene(trackConfig) {
  currentTrackConfig = trackConfig;
  scene.background.setHex(trackConfig.skyColor);
  if (scene.fog) scene.fog.color.setHex(trackConfig.skyColor);

  while (trackMeshGroup.children.length > 0) {
    trackMeshGroup.remove(trackMeshGroup.children[0]);
  }
  clearMapObjects();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ color: trackConfig.groundColor })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  trackMeshGroup.add(ground);

  const segments = 320;
  const halfW = trackConfig.width / 2;
  const roadPositions = [];
  const roadIndices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const leftPt = getPointAtProgress(t, -halfW, trackConfig);
    const rightPt = getPointAtProgress(t, halfW, trackConfig);

    roadPositions.push(leftPt.x, 0.02, leftPt.z);
    roadPositions.push(rightPt.x, 0.02, rightPt.z);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      roadIndices.push(a, b, c, b, d, c);
    }

    if (i < segments) {
      const curbColor = i % 2 === 0 ? trackConfig.curbColorA : trackConfig.curbColorB;
      const curbMat = new THREE.MeshBasicMaterial({ color: curbColor });
      const curbGeo = new THREE.BoxGeometry(1.2, 0.14, 2.2);

      const curbL = new THREE.Mesh(curbGeo, curbMat);
      curbL.position.set(leftPt.x, 0.07, leftPt.z);
      curbL.rotation.y = leftPt.heading;

      const curbR = new THREE.Mesh(curbGeo, curbMat);
      curbR.position.set(rightPt.x, 0.07, rightPt.z);
      curbR.rotation.y = rightPt.heading;

      trackMeshGroup.add(curbL, curbR);

      if (i % 3 === 0) {
        const centerPt = getPointAtProgress(t, 0, trackConfig);
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.04, 2.1),
          new THREE.MeshBasicMaterial({ color: 0x94a3b8 })
        );
        dash.position.set(centerPt.x, 0.04, centerPt.z);
        dash.rotation.y = centerPt.heading;
        trackMeshGroup.add(dash);
      }
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({ color: trackConfig.roadColor, roughness: 0.85 });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  trackMeshGroup.add(roadMesh);

  // Linha de Partida
  const startPt = getPointAtProgress(0, 0, trackConfig);
  const startGroup = new THREE.Group();
  startGroup.position.set(startPt.x, 0, startPt.z);
  startGroup.rotation.y = startPt.heading;

  const startLine = new THREE.Mesh(
    new THREE.BoxGeometry(trackConfig.width, 0.05, 2.6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  startLine.position.y = 0.04;
  startGroup.add(startLine);

  const pillarGeo = new THREE.CylinderGeometry(0.45, 0.45, 9, 12);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
  const pillarL = new THREE.Mesh(pillarGeo, pillarMat);
  pillarL.position.set(-halfW - 1, 4.5, 0);
  const pillarR = pillarL.clone();
  pillarR.position.x = halfW + 1;

  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(trackConfig.width + 3, 1.6, 0.8),
    new THREE.MeshBasicMaterial({ color: trackConfig.curbColorA })
  );
  banner.position.set(0, 8.2, 0);
  startGroup.add(pillarL, pillarR, banner);
  trackMeshGroup.add(startGroup);

  for (let i = 0; i < 45; i++) {
    const prog = i / 45;
    const side = (i % 2 === 0 ? 1 : -1) * (halfW + 14 + (i % 3) * 8);
    const pt = getPointAtProgress(prog, side, trackConfig);

    if (trackConfig.theme === 'FOREST') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 8), new THREE.MeshLambertMaterial({ color: 0x5c4033 }));
      trunk.position.set(pt.x, 1.5, pt.z);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7, 8), new THREE.MeshLambertMaterial({ color: 0x15803d }));
      leaves.position.set(pt.x, 5.5, pt.z);
      trackMeshGroup.add(trunk, leaves);
    } else if (trackConfig.theme === 'DESERT') {
      const cactus = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 5.5, 8), new THREE.MeshLambertMaterial({ color: 0x16a34a }));
      cactus.position.set(pt.x, 2.75, pt.z);
      trackMeshGroup.add(cactus);
    } else if (trackConfig.theme === 'CYBER') {
      const h = 14 + (i % 5) * 8;
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(6, h, 6),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: i % 2 === 0 ? 0x06b6d4 : 0xd946ef, emissiveIntensity: 0.35 })
      );
      tower.position.set(pt.x, h / 2, pt.z);
      trackMeshGroup.add(tower);
    } else if (trackConfig.theme === 'ICE') {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(3.5, 0), new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.1 }));
      crystal.position.set(pt.x, 3, pt.z);
      trackMeshGroup.add(crystal);
    } else {
      const rock = new THREE.Mesh(new THREE.ConeGeometry(4, 9, 6), new THREE.MeshStandardMaterial({ color: 0x27272a, emissive: 0xea580c, emissiveIntensity: 0.25 }));
      rock.position.set(pt.x, 4.5, pt.z);
      trackMeshGroup.add(rock);
    }
  }
}

buildTrackScene(TRACKS.SPEEDWAY);

// ==========================================
// SINCRONIZAÇÃO DE CARROS E ITENS
// ==========================================
function syncCarsWithRoom(playersList) {
  const activeIds = new Set(playersList.map(p => p.id));

  for (const [id, entity] of carEntities.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(entity.mesh);
      carEntities.delete(id);
    }
  }

  for (const p of playersList) {
    const existing = carEntities.get(p.id);
    if (!existing || existing.carType !== p.carType) {
      if (existing) scene.remove(existing.mesh);
      const mesh = createDetailedCarMesh(p.carType, p.color);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.heading;
      scene.add(mesh);

      carEntities.set(p.id, {
        id: p.id,
        name: p.name,
        carType: p.carType,
        mesh,
        targetX: p.x,
        targetZ: p.z,
        targetH: p.heading,
        speed: p.speed || 0
      });
    } else {
      existing.targetX = p.x;
      existing.targetZ = p.z;
      existing.targetH = p.heading;
    }
  }
}

function syncPickups3D(msg) {
  if (msg.itemBoxes) {
    for (const b of msg.itemBoxes) {
      let mesh = itemBoxMeshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 1.6, 1.6),
          new THREE.MeshNormalMaterial({ wireframe: false })
        );
        scene.add(mesh);
        itemBoxMeshes.set(b.id, mesh);
      }
      mesh.position.set(b.x, 1.3, b.z);
      mesh.visible = b.active;
    }
  }

  if (msg.coins) {
    for (const c of msg.coins) {
      let mesh = coinMeshes.get(c.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.85, 0.85, 0.22, 16),
          new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2, emissive: 0xd97706, emissiveIntensity: 0.3 })
        );
        mesh.rotation.z = Math.PI / 2;
        scene.add(mesh);
        coinMeshes.set(c.id, mesh);
      }
      mesh.position.set(c.x, 1.0, c.z);
      mesh.visible = c.active;
    }
  }

  if (msg.oilTraps) {
    const activeIds = new Set(msg.oilTraps.map(o => o.id));
    for (const [id, m] of oilTrapMeshes.entries()) {
      if (!activeIds.has(id)) {
        scene.remove(m);
        oilTrapMeshes.delete(id);
      }
    }
    for (const o of msg.oilTraps) {
      if (!oilTrapMeshes.has(o.id)) {
        const oil = new THREE.Mesh(
          new THREE.CylinderGeometry(1.7, 1.7, 0.08, 16),
          new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.1 })
        );
        oil.position.set(o.x, 0.06, o.z);
        scene.add(oil);
        oilTrapMeshes.set(o.id, oil);
      }
    }
  }
}

// ==========================================
// CONEXÃO MULTIPLAYER
// ==========================================
const POWER_NAMES = {
  TURBO: '🔥 TURBO NITRO',
  SHIELD: '🛡️ ESCUDO',
  EMP: '⚡ CHOQUE EMP',
  OIL: '🛢️ POÇA DE ÓLEO',
  MISSILE: '🚀 MÍSSIL CASCO'
};

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}`);

  ws.addEventListener('open', () => {
    myName = elNameInput ? elNameInput.value.trim() || `Piloto_${Math.floor(100 + Math.random() * 900)}` : 'Piloto';
    if (elNameInput) localStorage.setItem('apex_player_name', myName);

    ws.send(JSON.stringify({
      type: 'hello',
      token: myToken,
      name: myName,
      carType: selectedCarId
    }));
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);

    switch (msg.type) {
      case 'welcome': {
        myPlayerId = msg.playerId;
        myToken = msg.token;
        localStorage.setItem('apex_session_token', myToken);
        break;
      }

      case 'room_list': {
        renderPublicRooms(msg.rooms);
        break;
      }

      case 'room_state': {
        currentRoom = msg.room;
        if (TRACKS[currentRoom.trackId] && currentTrackConfig.id !== currentRoom.trackId) {
          buildTrackScene(TRACKS[currentRoom.trackId]);
        }
        syncCarsWithRoom(currentRoom.players);
        updateUIForRoomState();
        break;
      }

      case 'race_rewards': {
        const reward = msg.rewards.find(r => r.id === myPlayerId);
        if (reward) {
          walletCoins += reward.totalEarned;
          saveEconomy();
          const banner = document.getElementById('results-reward-banner');
          if (banner) {
            banner.textContent = `🏆 ${reward.position}º Lugar! Você ganhou +${reward.totalEarned} 🪙 Moedas!`;
          }
        }
        const standingsEl = document.getElementById('results-standings');
        if (standingsEl) {
          standingsEl.innerHTML = msg.rewards.map(r => `
            <div class="flex justify-between items-center bg-slate-800/80 px-4 py-2 rounded-lg">
              <span><strong>${r.position}º</strong> ${r.name}</span>
              <span class="text-amber-400 font-orbitron font-bold">+${r.totalEarned} 🪙</span>
            </div>
          `).join('');
        }
        break;
      }

      case 'telemetry': {
        if (!currentRoom) return;
        currentRoom.state = msg.state;

        if (msg.state === 'COUNTDOWN') {
          if (elCountdown) {
            elCountdown.classList.remove('hidden');
            const sec = Math.ceil(msg.countdownMs / 1000);
            elCountdown.textContent = sec > 0 ? String(sec) : 'VAI!';
          }
        } else if (elCountdown) {
          elCountdown.classList.add('hidden');
        }

        syncPickups3D(msg);

        for (const c of msg.cars) {
          const ent = carEntities.get(c.id);
          if (ent) {
            ent.targetX = c.x;
            ent.targetZ = c.z;
            ent.targetH = c.h;
            ent.speed = c.s;
            if (ent.mesh.userData.shieldMesh) {
              ent.mesh.userData.shieldMesh.visible = Boolean(c.shield);
            }
            if (ent.mesh.userData.flameMesh) {
              ent.mesh.userData.flameMesh.visible = Boolean(c.boost);
            }
          }
          if (c.id === myPlayerId) {
            const elPos = document.getElementById('hud-pos');
            const elLap = document.getElementById('hud-lap');
            const elSpeed = document.getElementById('hud-speed');
            const elCoins = document.getElementById('hud-coins');
            const elPower = document.getElementById('hud-power');

            if (elPos) elPos.textContent = `${c.pos} / ${msg.cars.length}`;
            if (elLap) elLap.textContent = `${Math.min(c.lap, currentTrackConfig.totalLaps)} / ${currentTrackConfig.totalLaps}`;
            if (elSpeed) elSpeed.textContent = `${Math.round(Math.abs(c.s) * 4.0)} km/h`;
            if (elCoins) elCoins.textContent = `🪙 ${c.coins || 0}`;
            if (elPower) elPower.textContent = c.power ? POWER_NAMES[c.power] || c.power : '🎲 VAZIO';
          }
        }
        break;
      }

      case 'left_room': {
        currentRoom = null;
        syncCarsWithRoom([]);
        clearMapObjects();
        updateUIForRoomState();
        break;
      }

      case 'error': {
        showToast(msg.message);
        break;
      }
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWebSocket, 1500);
  });
}

function sendMsg(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ==========================================
// EVENTOS E GARAGEM
// ==========================================
function renderPublicRooms(rooms) {
  const container = document.getElementById('public-rooms-list');
  if (!container) return;

  if (!rooms || rooms.length === 0) {
    container.innerHTML = `<div class="text-slate-400 p-3">Nenhuma sala aberta. Clique em <strong>Jogar Agora</strong> ou crie uma sala!</div>`;
    return;
  }

  container.innerHTML = '';
  for (const r of rooms) {
    const div = document.createElement('div');
    div.className = 'room-card';
    const isLobby = r.state === 'LOBBY';
    const canJoin = (r.playersCount < r.maxPlayers) && (isLobby || r.allowMidRaceJoin);
    const trackName = TRACKS[r.trackId]?.name || r.trackId;

    div.innerHTML = `
      <div>
        <strong>${r.name}</strong> <span class="text-xs text-amber-400 ml-1">(${trackName})</span>
        <div class="text-xs text-slate-400">Pilotos: ${r.playersCount} / ${r.maxPlayers} • ${isLobby ? 'No Lobby' : 'Correndo'}</div>
      </div>
      <button class="btn-join-item" data-id="${r.id}" ${!canJoin ? 'disabled style="opacity:0.4;"' : ''}>Entrar</button>
    `;
    container.appendChild(div);
  }

  container.querySelectorAll('.btn-join-item').forEach(btn => {
    btn.addEventListener('click', () => {
      savePlayerName();
      sendMsg({ type: 'join_room', roomId: btn.dataset.id, carType: selectedCarId });
    });
  });
}

function updateUIForRoomState() {
  if (inGarageView) return;

  if (!currentRoom) {
    elMenu.classList.remove('hidden');
    elGarage.classList.add('hidden');
    elLobby.classList.add('hidden');
    elHud.classList.add('hidden');
    elResults.classList.add('hidden');
    elTouchControls.classList.remove('active');
    return;
  }

  elMenu.classList.add('hidden');
  elGarage.classList.add('hidden');

  if (currentRoom.state === 'LOBBY') {
    elLobby.classList.remove('hidden');
    elHud.classList.add('hidden');
    elResults.classList.add('hidden');
    elTouchControls.classList.remove('active');

    document.getElementById('lobby-room-title').textContent = currentRoom.name;
    document.getElementById('lobby-room-code').textContent = currentRoom.id;
    document.getElementById('lobby-track-name').textContent = TRACKS[currentRoom.trackId]?.name || currentRoom.trackId;

    const pGrid = document.getElementById('lobby-players');
    pGrid.innerHTML = '';
    let myPlayer = null;
    for (const p of currentRoom.players) {
      if (p.id === myPlayerId) myPlayer = p;
      const carSpec = CAR_TYPES.find(c => c.id === p.carType) || CAR_TYPES[0];
      const item = document.createElement('div');
      item.className = 'player-item';
      item.style.borderLeft = `5px solid ${p.color}`;
      item.innerHTML = `
        <div>
          <strong>${p.name}</strong>
          <div class="text-xs text-cyan-300">${carSpec.name}</div>
        </div>
        <div>${p.ready ? '✅ Pronto' : '⏳ Aguardando'}</div>
      `;
      pGrid.appendChild(item);
    }

    const btnReady = document.getElementById('btn-ready');
    if (btnReady && myPlayer) {
      btnReady.textContent = myPlayer.ready ? 'Cancelar Pronto' : 'Marcar Pronto';
    }

    const btnHostStart = document.getElementById('btn-host-start');
    if (btnHostStart) {
      if (currentRoom.hostId === myPlayerId) btnHostStart.classList.remove('hidden');
      else btnHostStart.classList.add('hidden');
    }
  } else if (currentRoom.state === 'COUNTDOWN' || currentRoom.state === 'RACING') {
    elLobby.classList.add('hidden');
    elResults.classList.add('hidden');
    elHud.classList.remove('hidden');
    elTouchControls.classList.add('active');
  } else if (currentRoom.state === 'FINISHED') {
    elHud.classList.add('hidden');
    elTouchControls.classList.remove('active');
    elResults.classList.remove('hidden');
  }
}

function savePlayerName() {
  if (!elNameInput) return;
  const val = elNameInput.value.trim();
  if (val) {
    myName = val.slice(0, 16);
    localStorage.setItem('apex_player_name', myName);
  }
}

// Botões da Garagem
document.getElementById('btn-open-garage')?.addEventListener('click', () => {
  inGarageView = true;
  elMenu.classList.add('hidden');
  elGarage.classList.remove('hidden');
  garageCarIndex = Math.max(0, CAR_TYPES.findIndex(c => c.id === selectedCarId));
  refreshGarageShowroom();
});

document.getElementById('btn-close-garage')?.addEventListener('click', () => {
  inGarageView = false;
  elGarage.classList.add('hidden');
  elMenu.classList.remove('hidden');
});

document.getElementById('btn-prev-car')?.addEventListener('click', () => {
  garageCarIndex = (garageCarIndex - 1 + CAR_TYPES.length) % CAR_TYPES.length;
  refreshGarageShowroom();
});

document.getElementById('btn-next-car')?.addEventListener('click', () => {
  garageCarIndex = (garageCarIndex + 1) % CAR_TYPES.length;
  refreshGarageShowroom();
});

document.getElementById('btn-buy-equip-car')?.addEventListener('click', () => {
  const spec = CAR_TYPES[garageCarIndex];
  if (unlockedCars.includes(spec.id)) {
    selectedCarId = spec.id;
    saveEconomy();
    refreshGarageShowroom();
    sendMsg({ type: 'set_car', carType: selectedCarId });
    showToast(`${spec.name} equipado!`, '#10b981');
  } else {
    if (walletCoins >= spec.price) {
      walletCoins -= spec.price;
      unlockedCars.push(spec.id);
      selectedCarId = spec.id;
      saveEconomy();
      refreshGarageShowroom();
      sendMsg({ type: 'set_car', carType: selectedCarId });
      showToast(`🎉 Você desbloqueou o ${spec.name}!`, '#10b981');
    } else {
      showToast(`Moedas insuficientes! Faltam 🪙 ${spec.price - walletCoins} moedas.`);
    }
  }
});

// Botões do Menu e Lobby
document.getElementById('btn-quick-play')?.addEventListener('click', () => {
  savePlayerName();
  sendMsg({ type: 'quick_play', carType: selectedCarId });
});

document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => sendMsg({ type: 'get_rooms' }));

document.getElementById('btn-open-create')?.addEventListener('click', () => {
  document.getElementById('create-room-box')?.classList.remove('hidden');
});

document.getElementById('btn-cancel-create')?.addEventListener('click', () => {
  document.getElementById('create-room-box')?.classList.add('hidden');
});

document.getElementById('btn-confirm-create')?.addEventListener('click', () => {
  savePlayerName();
  const nameEl = document.getElementById('new-room-name');
  const maxEl = document.getElementById('new-room-max');
  const trackEl = document.getElementById('new-room-track');

  sendMsg({
    type: 'create_room',
    roomName: nameEl ? nameEl.value.trim() : 'Sala GP',
    maxPlayers: maxEl ? Number(maxEl.value) : 6,
    trackId: trackEl ? trackEl.value : 'SPEEDWAY',
    carType: selectedCarId
  });
  document.getElementById('create-room-box')?.classList.add('hidden');
});

document.getElementById('btn-join-code')?.addEventListener('click', () => {
  savePlayerName();
  const codeEl = document.getElementById('join-code-input');
  if (codeEl && codeEl.value) {
    sendMsg({ type: 'join_room', roomId: codeEl.value.trim().toUpperCase(), carType: selectedCarId });
  }
});

document.getElementById('btn-leave-lobby')?.addEventListener('click', () => sendMsg({ type: 'leave_room' }));
document.getElementById('btn-leave-race')?.addEventListener('click', () => sendMsg({ type: 'leave_room' }));
document.getElementById('btn-ready')?.addEventListener('click', () => sendMsg({ type: 'toggle_ready' }));
document.getElementById('btn-host-start')?.addEventListener('click', () => sendMsg({ type: 'start_race' }));

// ==========================================
// CONTROLES DE TECLADO E TOUCH
// ==========================================
function transmitInputs() {
  const serialized = JSON.stringify(inputs);
  if (serialized !== lastInputSent) {
    lastInputSent = serialized;
    sendMsg({ type: 'input', ...inputs });
  }
}

const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right'
};

window.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    sendMsg({ type: 'use_power' });
    return;
  }
  const k = KEY_MAP[e.code];
  if (k) {
    inputs[k] = true;
    transmitInputs();
  }
});

window.addEventListener('keyup', (e) => {
  const k = KEY_MAP[e.code];
  if (k) {
    inputs[k] = false;
    transmitInputs();
  }
});

document.querySelectorAll('.touch-btn').forEach(btn => {
  const key = btn.dataset.key;
  if (!key) return;
  const press = (e) => {
    e.preventDefault();
    if (key === 'power') {
      sendMsg({ type: 'use_power' });
      return;
    }
    inputs[key] = true;
    transmitInputs();
  };
  const release = (e) => {
    e.preventDefault();
    if (key !== 'power') {
      inputs[key] = false;
      transmitInputs();
    }
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
});

// ==========================================
// LOOP DE ANIMAÇÃO
// ==========================================
let lastFrameTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  for (const box of itemBoxMeshes.values()) {
    box.rotation.y += dt * 2.2;
    box.rotation.x += dt * 1.3;
  }
  for (const coin of coinMeshes.values()) {
    coin.rotation.y += dt * 3.5;
  }

  if (inGarageView) {
    if (garagePreviewCar) {
      garagePreviewCar.rotation.y += dt * 0.85;
    }
    camera.position.set(0, 503.2, 7.2);
    camera.lookAt(0, 500.7, 0);
    renderer.render(scene, camera);
    return;
  }

  const interpFactor = Math.min(1, dt * 15);
  for (const ent of carEntities.values()) {
    ent.mesh.position.x += (ent.targetX - ent.mesh.position.x) * interpFactor;
    ent.mesh.position.z += (ent.targetZ - ent.mesh.position.z) * interpFactor;

    let diffH = ent.targetH - ent.mesh.rotation.y;
    while (diffH > Math.PI) diffH -= Math.PI * 2;
    while (diffH < -Math.PI) diffH += Math.PI * 2;
    ent.mesh.rotation.y += diffH * interpFactor;
  }

  const myCar = carEntities.get(myPlayerId);
  if (myCar && currentRoom && (currentRoom.state === 'COUNTDOWN' || currentRoom.state === 'RACING')) {
    const h = myCar.mesh.rotation.y;
    const distBack = 10.2;
    const height = 4.8;

    const targetCamX = myCar.mesh.position.x - Math.sin(h) * distBack;
    const targetCamZ = myCar.mesh.position.z - Math.cos(h) * distBack;

    camera.position.x += (targetCamX - camera.position.x) * Math.min(1, dt * 10);
    camera.position.y += (height - camera.position.y) * Math.min(1, dt * 10);
    camera.position.z += (targetCamZ - camera.position.z) * Math.min(1, dt * 10);
    camera.lookAt(myCar.mesh.position.x, 1.1, myCar.mesh.position.z);
  } else {
    const angle = now * 0.00025;
    camera.position.set(Math.cos(angle) * 125, 48, Math.sin(angle) * 125);
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);
}

connectWebSocket();
requestAnimationFrame(animate);