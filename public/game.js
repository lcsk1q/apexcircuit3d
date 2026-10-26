// game.js
import * as THREE from 'three';
import { TRACKS, CAR_TYPES, getPointAtProgress } from '/shared/track.js';

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice) document.body.classList.add('is-touch');

let ws = null;
let myPlayerId = null;
let myToken = localStorage.getItem('apex_session_token') || '';
let myName = localStorage.getItem('apex_player_name') || '';
let currentRoom = null;
let currentTrackConfig = TRACKS.OVAL;
let lowGraphics = localStorage.getItem('apex_low_gfx') === '1';

const inputs = { up: false, down: false, left: false, right: false };
let lastInputSent = '';

const carEntities = new Map();
const itemBoxMeshes = new Map();
const coinMeshes = new Map();
const oilTrapMeshes = new Map();

// Elementos de UI
const elMenu = document.getElementById('menu-screen');
const elLobby = document.getElementById('lobby-screen');
const elHud = document.getElementById('race-hud');
const elResults = document.getElementById('results-screen');
const elCountdown = document.getElementById('countdown-banner');
const elTouchControls = document.getElementById('touch-controls');
const elNameInput = document.getElementById('player-name');
const elBtnGfx = document.getElementById('btn-gfx');

if (myName && elNameInput) elNameInput.value = myName;

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// MOTOR 3D
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGraphics, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b132b);
scene.fog = new THREE.FogExp2(0x0b132b, 0.0035);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 450);
camera.position.set(0, 28, -45);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.3);
dirLight.position.set(60, 110, 40);
dirLight.castShadow = !lowGraphics;
scene.add(dirLight);

function applyGraphicsMode() {
  renderer.setPixelRatio(lowGraphics ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !lowGraphics;
  dirLight.castShadow = !lowGraphics;
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

// CONSTRUÇÃO DE PISTAS
let trackMeshGroup = new THREE.Group();
scene.add(trackMeshGroup);

function buildTrackScene(trackConfig) {
  currentTrackConfig = trackConfig;
  scene.background.setHex(trackConfig.skyColor || 0x0b132b);
  if (scene.fog) scene.fog.color.setHex(trackConfig.skyColor || 0x0b132b);

  while (trackMeshGroup.children.length > 0) {
    const obj = trackMeshGroup.children[0];
    trackMeshGroup.remove(obj);
  }

  const groundGeo = new THREE.PlaneGeometry(1000, 1000);
  const groundMat = new THREE.MeshLambertMaterial({ color: trackConfig.groundColor || 0x143326 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  trackMeshGroup.add(ground);

  const segments = 220;
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
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({ color: trackConfig.roadColor || 0x262936, roughness: 0.8 });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  trackMeshGroup.add(roadMesh);
}

buildTrackScene(TRACKS.OVAL);

// CRIAÇÃO DE MODELOS DE CARRO
function createCarMesh(colorHex) {
  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(2.0, 0.65, 3.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.55;
  group.add(body);

  const cabinGeo = new THREE.BoxGeometry(1.5, 0.5, 1.6);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 1.0, -0.2);
  group.add(cabin);

  scene.add(group);
  return group;
}

function syncCarsWithRoom(playersList) {
  const activeIds = new Set(playersList.map(p => p.id));

  for (const [id, entity] of carEntities.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(entity.mesh);
      carEntities.delete(id);
    }
  }

  for (const p of playersList) {
    if (!carEntities.has(p.id)) {
      const mesh = createCarMesh(p.color);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.heading;
      carEntities.set(p.id, {
        id: p.id,
        name: p.name,
        mesh,
        targetX: p.x,
        targetZ: p.z,
        targetH: p.heading,
        speed: p.speed || 0
      });
    } else {
      const ent = carEntities.get(p.id);
      ent.targetX = p.x;
      ent.targetZ = p.z;
      ent.targetH = p.heading;
    }
  }
}

// CONEXÃO WEBSOCKET
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}`);

  ws.addEventListener('open', () => {
    myName = elNameInput ? elNameInput.value.trim() || `Piloto_${Math.floor(100 + Math.random() * 900)}` : 'Piloto';
    if (elNameInput) localStorage.setItem('apex_player_name', myName);

    ws.send(JSON.stringify({
      type: 'hello',
      token: myToken,
      name: myName
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

        for (const c of msg.cars) {
          const ent = carEntities.get(c.id);
          if (ent) {
            ent.targetX = c.x;
            ent.targetZ = c.z;
            ent.targetH = c.h;
            ent.speed = c.s;
          }
          if (c.id === myPlayerId) {
            const elPos = document.getElementById('hud-pos');
            const elLap = document.getElementById('hud-lap');
            const elSpeed = document.getElementById('hud-speed');
            const elCoins = document.getElementById('hud-coins');
            const elPower = document.getElementById('hud-power');

            if (elPos) elPos.textContent = `${c.pos} / ${msg.cars.length}`;
            if (elLap) elLap.textContent = `${Math.min(c.lap, currentTrackConfig.totalLaps)} / ${currentTrackConfig.totalLaps}`;
            if (elSpeed) elSpeed.textContent = `${Math.round(Math.abs(c.s) * 4.2)} km/h`;
            if (elCoins) elCoins.textContent = `🪙 ${c.coins || 0}`;
            if (elPower) elPower.textContent = c.power ? `ITEM: [${c.power}]` : 'ITEM: [VAZIO]';
          }
        }
        break;
      }

      case 'left_room': {
        currentRoom = null;
        syncCarsWithRoom([]);
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

// GERENCIAMENTO DE INTERFACE
function renderPublicRooms(rooms) {
  const container = document.getElementById('public-rooms-list');
  if (!container) return;

  if (!rooms || rooms.length === 0) {
    container.innerHTML = `<div style="color: var(--muted); padding: 12px;">Nenhuma sala pública aberta. Clique em <strong>Jogar Agora</strong> para criar uma!</div>`;
    return;
  }

  container.innerHTML = '';
  for (const r of rooms) {
    const div = document.createElement('div');
    div.className = 'room-card';
    const isLobby = r.state === 'LOBBY';
    const canJoin = (r.playersCount < r.maxPlayers) && (isLobby || r.allowMidRaceJoin);

    div.innerHTML = `
      <div>
        <strong>${r.name}</strong> <span style="color:var(--muted); font-size:0.8rem;">(${r.trackId})</span>
        <div style="font-size:0.8rem; color:var(--muted);">Jogadores: ${r.playersCount} / ${r.maxPlayers}</div>
      </div>
      <button class="btn-join-item" data-id="${r.id}" ${!canJoin ? 'disabled style="opacity:0.4;"' : ''}>Entrar</button>
    `;
    container.appendChild(div);
  }

  container.querySelectorAll('.btn-join-item').forEach(btn => {
    btn.addEventListener('click', () => {
      savePlayerName();
      sendMsg({ type: 'join_room', roomId: btn.dataset.id });
    });
  });
}

function updateUIForRoomState() {
  if (!currentRoom) {
    if (elMenu) elMenu.classList.remove('hidden');
    if (elLobby) elLobby.classList.add('hidden');
    if (elHud) elHud.classList.add('hidden');
    if (elResults) elResults.classList.add('hidden');
    if (elTouchControls) elTouchControls.classList.remove('active');
    return;
  }

  if (elMenu) elMenu.classList.add('hidden');

  if (currentRoom.state === 'LOBBY') {
    if (elLobby) elLobby.classList.remove('hidden');
    if (elHud) elHud.classList.add('hidden');
    if (elResults) elResults.classList.add('hidden');
    if (elTouchControls) elTouchControls.classList.remove('active');

    const title = document.getElementById('lobby-room-title');
    const code = document.getElementById('lobby-room-code');
    if (title) title.textContent = currentRoom.name;
    if (code) code.textContent = currentRoom.id;

    const pGrid = document.getElementById('lobby-players');
    if (pGrid) {
      pGrid.innerHTML = '';
      let myPlayer = null;
      for (const p of currentRoom.players) {
        if (p.id === myPlayerId) myPlayer = p;
        const item = document.createElement('div');
        item.className = 'player-item';
        item.style.borderLeft = `5px solid ${p.color}`;
        item.innerHTML = `<div><strong>${p.name}</strong></div><div>${p.ready ? '✅ Pronto' : '⏳ Aguardando'}</div>`;
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
    }
  } else if (currentRoom.state === 'COUNTDOWN' || currentRoom.state === 'RACING') {
    if (elLobby) elLobby.classList.add('hidden');
    if (elResults) elResults.classList.add('hidden');
    if (elHud) elHud.classList.remove('hidden');
    if (elTouchControls) elTouchControls.classList.add('active');
  } else if (currentRoom.state === 'FINISHED') {
    if (elHud) elHud.classList.add('hidden');
    if (elTouchControls) elTouchControls.classList.remove('active');
    if (elResults) elResults.classList.remove('hidden');
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

// BINDING DE EVENTOS DA INTERFACE
const btnQuickPlay = document.getElementById('btn-quick-play');
if (btnQuickPlay) {
  btnQuickPlay.addEventListener('click', () => {
    savePlayerName();
    sendMsg({ type: 'quick_play' });
  });
}

const btnRefresh = document.getElementById('btn-refresh-rooms');
if (btnRefresh) {
  btnRefresh.addEventListener('click', () => sendMsg({ type: 'get_rooms' }));
}

const btnOpenCreate = document.getElementById('btn-open-create');
if (btnOpenCreate) {
  btnOpenCreate.addEventListener('click', () => {
    const box = document.getElementById('create-room-box');
    if (box) box.classList.remove('hidden');
  });
}

const btnCancelCreate = document.getElementById('btn-cancel-create');
if (btnCancelCreate) {
  btnCancelCreate.addEventListener('click', () => {
    const box = document.getElementById('create-room-box');
    if (box) box.classList.add('hidden');
  });
}

const btnConfirmCreate = document.getElementById('btn-confirm-create');
if (btnConfirmCreate) {
  btnConfirmCreate.addEventListener('click', () => {
    savePlayerName();
    const nameEl = document.getElementById('new-room-name');
    const maxEl = document.getElementById('new-room-max');
    const trackEl = document.getElementById('new-room-track');

    sendMsg({
      type: 'create_room',
      roomName: nameEl ? nameEl.value.trim() : 'Sala',
      maxPlayers: maxEl ? Number(maxEl.value) : 6,
      trackId: trackEl ? trackEl.value : 'OVAL',
      isPrivate: false,
      allowMidRaceJoin: false
    });

    const box = document.getElementById('create-room-box');
    if (box) box.classList.add('hidden');
  });
}

const btnJoinCode = document.getElementById('btn-join-code');
if (btnJoinCode) {
  btnJoinCode.addEventListener('click', () => {
    savePlayerName();
    const codeEl = document.getElementById('join-code-input');
    if (codeEl && codeEl.value) {
      sendMsg({ type: 'join_room', roomId: codeEl.value.trim().toUpperCase() });
    }
  });
}

const btnLeaveLobby = document.getElementById('btn-leave-lobby');
if (btnLeaveLobby) btnLeaveLobby.addEventListener('click', () => sendMsg({ type: 'leave_room' }));

const btnLeaveRace = document.getElementById('btn-leave-race');
if (btnLeaveRace) btnLeaveRace.addEventListener('click', () => sendMsg({ type: 'leave_room' }));

const btnReady = document.getElementById('btn-ready');
if (btnReady) btnReady.addEventListener('click', () => sendMsg({ type: 'toggle_ready' }));

const btnHostStart = document.getElementById('btn-host-start');
if (btnHostStart) btnHostStart.addEventListener('click', () => sendMsg({ type: 'start_race' }));

// CONTROLES DE ENTRADA (TECLADO / TOUCH)
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

// LOOP DE RENDERIZAÇÃO
let lastFrameTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  const interpFactor = Math.min(1, dt * 14);
  for (const ent of carEntities.values()) {
    ent.mesh.position.x += (ent.targetX - ent.mesh.position.x) * interpFactor;
    ent.mesh.position.z += (ent.targetZ - ent.mesh.position.z) * interpFactor;
    ent.mesh.rotation.y = ent.targetH;
  }

  const myCar = carEntities.get(myPlayerId);
  if (myCar && currentRoom && (currentRoom.state === 'COUNTDOWN' || currentRoom.state === 'RACING')) {
    const h = myCar.mesh.rotation.y;
    const distBack = 10.5;
    const height = 5.2;

    camera.position.x = myCar.mesh.position.x - Math.sin(h) * distBack;
    camera.position.y = height;
    camera.position.z = myCar.mesh.position.z - Math.cos(h) * distBack;
    camera.lookAt(myCar.mesh.position.x, 1.2, myCar.mesh.position.z);
  }

  renderer.render(scene, camera);
}

connectWebSocket();
requestAnimationFrame(animate);