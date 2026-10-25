import * as THREE from 'three';
import { TRACK, getPointAtProgress } from '/shared/track.js';

// Detecção de tela sensível ao toque (Celular / Tablet)
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice) document.body.classList.add('is-touch');

// Estado Local do Cliente
let ws = null;
let myPlayerId = null;
let myToken = localStorage.getItem('apex_session_token') || '';
let myName = localStorage.getItem('apex_player_name') || '';
let currentRoom = null;
let lowGraphics = localStorage.getItem('apex_low_gfx') === '1';

const inputs = { up: false, down: false, left: false, right: false };
let lastInputSent = '';

// Map de carros instanciados na cena 3D (playerId -> CarObject)
const carEntities = new Map();

// Elementos de UI
const elMenu = document.getElementById('menu-screen');
const elLobby = document.getElementById('lobby-screen');
const elHud = document.getElementById('race-hud');
const elResults = document.getElementById('results-screen');
const elCountdown = document.getElementById('countdown-banner');
const elTouchControls = document.getElementById('touch-controls');
const elNameInput = document.getElementById('player-name');
const elBtnGfx = document.getElementById('btn-gfx');

if (myName) elNameInput.value = myName;

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ============================================================================
// CONFIGURAÇÃO DO MOTOR 3D (THREE.JS)
// ============================================================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGraphics, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b132b);
scene.fog = new THREE.FogExp2(0x0b132b, 0.0035);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 450);
camera.position.set(0, 28, -45);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.3);
dirLight.position.set(60, 110, 40);
dirLight.castShadow = !lowGraphics;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near = 10;
dirLight.shadow.camera.far = 260;
const d = 120;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

function applyGraphicsMode() {
  renderer.setPixelRatio(lowGraphics ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !lowGraphics;
  dirLight.castShadow = !lowGraphics;
  elBtnGfx.textContent = `Gráficos: ${lowGraphics ? 'Baixo (Celular)' : 'Alto'}`;
}
applyGraphicsMode();

elBtnGfx.addEventListener('click', () => {
  lowGraphics = !lowGraphics;
  localStorage.setItem('apex_low_gfx', lowGraphics ? '1' : '0');
  applyGraphicsMode();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================================
// CONSTRUÇÃO PROCEDURAL DA PISTA 3D
// ============================================================================
function buildTrackScene() {
  // Gramado / Terreno
  const groundGeo = new THREE.PlaneGeometry(900, 900);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x143326 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  const segments = 220;
  const halfW = TRACK.width / 2;

  const roadPositions = [];
  const roadIndices = [];
  const wallPositions = [];
  const wallColors = [];
  const wallIndices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const leftPt = getPointAtProgress(t, -halfW);
    const rightPt = getPointAtProgress(t, halfW);

    roadPositions.push(leftPt.x, 0.02, leftPt.z);
    roadPositions.push(rightPt.x, 0.02, rightPt.z);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      roadIndices.push(a, b, c, b, d, c);
    }

    // Barreiras de proteção (Vermelho e Branco alternados)
    const leftWallIn = getPointAtProgress(t, -halfW - 0.3);
    const rightWallOut = getPointAtProgress(t, halfW + 0.3);

    const baseIdx = i * 4;
    wallPositions.push(
      leftWallIn.x, 0, leftWallIn.z,
      leftWallIn.x, 1.1, leftWallIn.z,
      rightWallOut.x, 0, rightWallOut.z,
      rightWallOut.x, 1.1, rightWallOut.z
    );

    const isRed = i % 2 === 0;
    const cR = isRed ? 0.9 : 0.95;
    const cG = isRed ? 0.15 : 0.95;
    const cB = isRed ? 0.15 : 0.95;
    for (let k = 0; k < 4; k++) wallColors.push(cR, cG, cB);

    if (i < segments) {
      const n = (i + 1) * 4;
      // Parede interna
      wallIndices.push(baseIdx, baseIdx + 1, n, baseIdx + 1, n + 1, n);
      // Parede externa
      wallIndices.push(baseIdx + 2, n + 2, baseIdx + 3, baseIdx + 3, n + 2, n + 3);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x262936, roughness: 0.85 });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallColors, 3));
  wallGeo.setIndex(wallIndices);
  wallGeo.computeVertexNormals();
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(wallGeo, wallMat));

  // Linha de Chegada Quadriculada + Pórtico
  const startCenter = getPointAtProgress(0, 0);
  const canvasCheck = document.createElement('canvas');
  canvasCheck.width = 128;
  canvasCheck.height = 32;
  const ctx = canvasCheck.getContext('2d');
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const checkTex = new THREE.CanvasTexture(canvasCheck);
  const startLineGeo = new THREE.PlaneGeometry(TRACK.width, 3.2);
  const startLineMat = new THREE.MeshBasicMaterial({ map: checkTex });
  const startLine = new THREE.Mesh(startLineGeo, startLineMat);
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(startCenter.x, 0.05, startCenter.z);
  scene.add(startLine);

  // Pórtico da largada
  const pillarGeo = new THREE.BoxGeometry(1, 7, 1);
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(startCenter.x - halfW - 0.6, 3.5, startCenter.z);
  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(startCenter.x + halfW + 0.6, 3.5, startCenter.z);
  const bannerGeo = new THREE.BoxGeometry(TRACK.width + 2, 1.5, 1.2);
  const bannerMat = new THREE.MeshLambertMaterial({ color: 0x3b82f6 });
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(startCenter.x, 6.5, startCenter.z);
  scene.add(leftPillar, rightPillar, banner);
}
buildTrackScene();

// ============================================================================
// CRIAÇÃO DE CARROS 3D E ETIQUETAS DE NOME
// ============================================================================
function createNameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.roundRect(16, 10, 224, 42, 10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 14), 128, 32);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.5, 1.15, 1);
  sprite.position.set(0, 2.5, 0);
  return sprite;
}

function createCarMesh(colorHex, playerName) {
  const group = new THREE.Group();

  // Chassi Principal
  const bodyGeo = new THREE.BoxGeometry(2.0, 0.65, 3.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.2 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  // Cabine / Cockpit
  const cabinGeo = new THREE.BoxGeometry(1.55, 0.5, 1.7);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2 });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 1.05, -0.2);
  group.add(cabin);

  // Aerofólio Traseiro
  const wingGeo = new THREE.BoxGeometry(1.9, 0.12, 0.45);
  const wing = new THREE.Mesh(wingGeo, bodyMat);
  wing.position.set(0, 1.1, -1.65);
  group.add(wing);

  // Faróis Dianteiros (+Z é frente)
  const lightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  const hl1 = new THREE.Mesh(lightGeo, lightMat);
  hl1.position.set(-0.65, 0.6, 1.91);
  const hl2 = hl1.clone();
  hl2.position.x = 0.65;
  group.add(hl1, hl2);

  // 4 Rodas
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x09090b });
  const wheelPositions = [
    [-1.05, 0.42, 1.2],
    [1.05, 0.42, 1.2],
    [-1.05, 0.42, -1.2],
    [1.05, 0.42, -1.2]
  ];
  wheelPositions.forEach(([wx, wy, wz]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    group.add(w);
  });

  const label = createNameSprite(playerName, colorHex);
  group.add(label);

  scene.add(group);
  return group;
}

function syncCarsWithRoom(playersList) {
  const activeIds = new Set(playersList.map(p => p.id));

  // Remove carros de jogadores que saíram
  for (const [id, entity] of carEntities.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(entity.mesh);
      carEntities.delete(id);
    }
  }

  // Cria ou atualiza carros presentes
  for (const p of playersList) {
    if (!carEntities.has(p.id)) {
      const mesh = createCarMesh(p.color, p.name);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.heading;
      carEntities.set(p.id, {
        id: p.id,
        name: p.name,
        color: p.color,
        mesh,
        targetX: p.x,
        targetZ: p.z,
        targetH: p.heading,
        speed: p.speed || 0,
        lap: p.lap || 1,
        pos: p.position || 1
      });
    } else {
      const ent = carEntities.get(p.id);
      if (ent.name !== p.name) {
        scene.remove(ent.mesh);
        ent.mesh = createCarMesh(p.color, p.name);
        ent.name = p.name;
      }
      ent.targetX = p.x;
      ent.targetZ = p.z;
      ent.targetH = p.heading;
    }
  }
}

// ============================================================================
// REDE WEBSOCKET E SINCRONIZAÇÃO DE SALAS
// ============================================================================
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}`);

  ws.addEventListener('open', () => {
    myName = elNameInput.value.trim() || `Piloto_${Math.floor(100 + Math.random() * 900)}`;
    elNameInput.value = myName;
    localStorage.setItem('apex_player_name', myName);

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

        // Se a URL contém ?room=CODIGO, entra diretamente na sala convidada
        const urlRoom = new URLSearchParams(window.location.search).get('room');
        if (urlRoom && !currentRoom) {
          ws.send(JSON.stringify({ type: 'join_room', roomId: urlRoom, playerName: myName }));
          window.history.replaceState({}, '', window.location.pathname);
        }
        break;
      }

      case 'room_list': {
        renderPublicRooms(msg.rooms);
        break;
      }

      case 'room_state': {
        currentRoom = msg.room;
        syncCarsWithRoom(currentRoom.players);
        updateUIForRoomState();
        break;
      }

      case 'telemetry': {
        if (!currentRoom) return;
        currentRoom.state = msg.state;

        if (msg.state === 'COUNTDOWN') {
          elCountdown.classList.remove('hidden');
          const sec = Math.ceil(msg.countdownMs / 1000);
          elCountdown.textContent = sec > 0 ? String(sec) : 'VAI!';
        } else {
          elCountdown.classList.add('hidden');
        }

        for (const c of msg.cars) {
          const ent = carEntities.get(c.id);
          if (ent) {
            ent.targetX = c.x;
            ent.targetZ = c.z;
            ent.targetH = c.h;
            ent.speed = c.s;
            ent.lap = c.lap;
            ent.pos = c.pos;
          }
          if (c.id === myPlayerId) {
            document.getElementById('hud-pos').textContent = `${c.pos} / ${msg.cars.length}`;
            document.getElementById('hud-lap').textContent = `${Math.min(c.lap, TRACK.totalLaps)} / ${TRACK.totalLaps}`;
            document.getElementById('hud-speed').textContent = `${Math.round(Math.abs(c.s) * 4.2)} km/h`;
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

// ============================================================================
// GERENCIAMENTO DE INTERFACE (MENU, LOBBY, CORRIDA E RESULTADOS)
// ============================================================================
function renderPublicRooms(rooms) {
  const container = document.getElementById('public-rooms-list');
  if (!rooms || rooms.length === 0) {
    container.innerHTML = `<div style="color: var(--muted); padding: 12px;">Nenhuma sala pública aberta no momento. Clique em <strong>Jogar Agora</strong> ou crie uma!</div>`;
    return;
  }

  container.innerHTML = '';
  for (const r of rooms) {
    const div = document.createElement('div');
    div.className = 'room-card';
    const isLobby = r.state === 'LOBBY';
    const stateLabel = isLobby ? 'Aguardando' : 'Em Corrida';
    const canJoin = (r.playersCount < r.maxPlayers) && (isLobby || r.allowMidRaceJoin);

    div.innerHTML = `
      <div>
        <strong>${r.name}</strong> <span style="color:var(--muted); font-size:0.85rem;">(${r.id})</span>
        <div style="font-size:0.8rem; color:var(--muted); margin-top:2px;">
          Jogadores: ${r.playersCount} / ${r.maxPlayers}
        </div>
      </div>
      <div class="row">
        <span class="badge ${isLobby ? 'lobby' : 'racing'}">${stateLabel}</span>
        <button class="btn-join-item" data-id="${r.id}" ${!canJoin ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
          Entrar
        </button>
      </div>
    `;
    container.appendChild(div);
  }

  container.querySelectorAll('.btn-join-item').forEach(btn => {
    btn.addEventListener('click', () => {
      savePlayerName();
      sendMsg({ type: 'join_room', roomId: btn.dataset.id, playerName: myName });
    });
  });
}

function updateUIForRoomState() {
  if (!currentRoom) {
    elMenu.classList.remove('hidden');
    elLobby.classList.add('hidden');
    elHud.classList.add('hidden');
    elResults.classList.add('hidden');
    elCountdown.classList.add('hidden');
    elTouchControls.classList.remove('active');
    return;
  }

  elMenu.classList.add('hidden');

  if (currentRoom.state === 'LOBBY') {
    elLobby.classList.remove('hidden');
    elHud.classList.add('hidden');
    elResults.classList.add('hidden');
    elCountdown.classList.add('hidden');
    elTouchControls.classList.remove('active');

    document.getElementById('lobby-room-title').textContent = currentRoom.name;
    document.getElementById('lobby-room-code').textContent = currentRoom.id;

    const pGrid = document.getElementById('lobby-players');
    pGrid.innerHTML = '';

    let myPlayer = null;
    for (const p of currentRoom.players) {
      if (p.id === myPlayerId) myPlayer = p;
      const item = document.createElement('div');
      item.className = 'player-item';
      item.style.borderLeftColor = p.color;
      const hostTag = p.id === currentRoom.hostId ? '👑 ' : '';
      const statusText = !p.connected ? '⚠️ Reconectando' : (p.ready ? '✅ Pronto' : '⏳ Aguardando');
      item.innerHTML = `
        <div><strong>${hostTag}${p.name}</strong></div>
        <div style="font-size:0.85rem;">${statusText}</div>
      `;
      pGrid.appendChild(item);
    }

    const btnReady = document.getElementById('btn-ready');
    if (myPlayer) {
      btnReady.textContent = myPlayer.ready ? 'Cancelar Pronto' : 'Marcar Pronto';
      btnReady.className = myPlayer.ready ? 'btn-secondary' : 'btn-success';
    }

    const btnHostStart = document.getElementById('btn-host-start');
    if (currentRoom.hostId === myPlayerId) {
      btnHostStart.classList.remove('hidden');
    } else {
      btnHostStart.classList.add('hidden');
    }
  } else if (currentRoom.state === 'COUNTDOWN' || currentRoom.state === 'RACING') {
    elLobby.classList.add('hidden');
    elResults.classList.add('hidden');
    elHud.classList.remove('hidden');
    elTouchControls.classList.add('active');
  } else if (currentRoom.state === 'FINISHED') {
    elLobby.classList.add('hidden');
    elHud.classList.add('hidden');
    elCountdown.classList.add('hidden');
    elTouchControls.classList.remove('active');
    elResults.classList.remove('hidden');

    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = '';
    const sorted = [...currentRoom.players].sort((a, b) => a.position - b.position);
    for (const p of sorted) {
      const tr = document.createElement('tr');
      const timeStr = p.finishTimeMs ? `${(p.finishTimeMs / 1000).toFixed(2)}s` : 'Não completou';
      tr.innerHTML = `
        <td><strong>#${p.position}</strong></td>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};margin-right:6px;"></span>${p.name}</td>
        <td>${timeStr}</td>
      `;
      tbody.appendChild(tr);
    }
  }
}

function savePlayerName() {
  const val = elNameInput.value.trim();
  if (val) {
    myName = val.slice(0, 16);
    localStorage.setItem('apex_player_name', myName);
    sendMsg({ type: 'set_name', name: myName });
  }
}

// Eventos de Botões da Interface
document.getElementById('btn-quick-play').addEventListener('click', () => {
  savePlayerName();
  sendMsg({ type: 'quick_play', name: myName });
});

document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
  sendMsg({ type: 'get_rooms' });
});

document.getElementById('btn-join-code').addEventListener('click', () => {
  savePlayerName();
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) return showToast('Digite o código da sala.');
  sendMsg({ type: 'join_room', roomId: code, playerName: myName });
});

document.getElementById('btn-open-create').addEventListener('click', () => {
  document.getElementById('create-room-box').classList.remove('hidden');
});

document.getElementById('btn-cancel-create').addEventListener('click', () => {
  document.getElementById('create-room-box').classList.add('hidden');
});

document.getElementById('btn-confirm-create').addEventListener('click', () => {
  savePlayerName();
  const roomName = document.getElementById('new-room-name').value.trim() || `Sala de ${myName}`;
  const maxPlayers = Number(document.getElementById('new-room-max').value);
  const isPrivate = document.getElementById('new-room-private').checked;
  const allowMidRaceJoin = document.getElementById('new-room-midjoin').checked;

  sendMsg({
    type: 'create_room',
    playerName: myName,
    roomName,
    maxPlayers,
    isPrivate,
    allowMidRaceJoin
  });
  document.getElementById('create-room-box').classList.add('hidden');
});

document.getElementById('btn-copy-link').addEventListener('click', () => {
  if (!currentRoom) return;
  const url = `${window.location.origin}/?room=${currentRoom.id}`;
  navigator.clipboard.writeText(url).then(() => showToast('Link de convite copiado!'));
});

document.getElementById('btn-leave-lobby').addEventListener('click', () => sendMsg({ type: 'leave_room' }));
document.getElementById('btn-leave-race').addEventListener('click', () => sendMsg({ type: 'leave_room' }));
document.getElementById('btn-ready').addEventListener('click', () => sendMsg({ type: 'toggle_ready' }));
document.getElementById('btn-host-start').addEventListener('click', () => sendMsg({ type: 'start_race' }));
document.getElementById('btn-play-again').addEventListener('click', () => {
  if (currentRoom && currentRoom.hostId === myPlayerId) {
    sendMsg({ type: 'start_race' });
  } else {
    elResults.classList.add('hidden');
    elLobby.classList.remove('hidden');
  }
});

// ============================================================================
// CONTROLES DE TECLADO (PC) E MULTI-TOUCH (CELULAR)
// ============================================================================
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

// Controles Touch com PointerEvents (suporta múltiplos dedos simultâneos)
document.querySelectorAll('.touch-btn').forEach(btn => {
  const key = btn.dataset.key;
  const press = (e) => {
    e.preventDefault();
    btn.classList.add('pressed');
    inputs[key] = true;
    transmitInputs();
  };
  const release = (e) => {
    e.preventDefault();
    btn.classList.remove('pressed');
    inputs[key] = false;
    transmitInputs();
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
});

// ============================================================================
// LOOP DE RENDERIZAÇÃO E INTERPOLAÇÃO SUAVE (60+ FPS)
// ============================================================================
function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

let lastFrameTime = performance.now();
let orbitAngle = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  const interpFactor = Math.min(1, dt * 14);

  for (const ent of carEntities.values()) {
    ent.mesh.position.x += (ent.targetX - ent.mesh.position.x) * interpFactor;
    ent.mesh.position.z += (ent.targetZ - ent.mesh.position.z) * interpFactor;
    ent.mesh.rotation.y = lerpAngle(ent.mesh.rotation.y, ent.targetH, interpFactor);
  }

  // Câmera em Terceira Pessoa seguindo o carro do jogador
  const myCar = carEntities.get(myPlayerId);
  if (myCar && currentRoom && (currentRoom.state === 'COUNTDOWN' || currentRoom.state === 'RACING')) {
    const h = myCar.mesh.rotation.y;
    const distBack = 10.5;
    const height = 5.2;

    const desiredCamX = myCar.mesh.position.x - Math.sin(h) * distBack;
    const desiredCamZ = myCar.mesh.position.z - Math.cos(h) * distBack;

    camera.position.x += (desiredCamX - camera.position.x) * Math.min(1, dt * 8);
    camera.position.y += (height - camera.position.y) * Math.min(1, dt * 8);
    camera.position.z += (desiredCamZ - camera.position.z) * Math.min(1, dt * 8);

    const lookX = myCar.mesh.position.x + Math.sin(h) * 6;
    const lookZ = myCar.mesh.position.z + Math.cos(h) * 6;
    camera.lookAt(lookX, 1.2, lookZ);
  } else {
    // Câmera panorâmica no Menu / Lobby
    orbitAngle += dt * 0.18;
    camera.position.set(Math.cos(orbitAngle) * 95, 42, Math.sin(orbitAngle) * 95);
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);
}

connectWebSocket();
requestAnimationFrame(animate);
