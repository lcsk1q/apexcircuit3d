// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { TRACKS, getTrackMetrics, getPointAtProgress } from './shared/track.js';
import { CARS_DATABASE } from './shared/carData.js';

// Catálogo único (shared/carData.js). Os atributos são reescalados para a faixa que a física
// do servidor foi balanceada (topSpeed 46-59, accel 32-50, handling 2.4-3.15) para as pistas
// atuais continuarem jogáveis. Ajuste os fatores se quiser carros mais rápidos.
const lerp = (v, a0, a1, b0, b1) => b0 + ((v - a0) / (a1 - a0)) * (b1 - b0);
const CAR_TYPES = CARS_DATABASE.map(c => ({
  id: c.id, name: c.name, tier: c.tier, price: c.price, color: c.color,
  topSpeed: lerp(c.topSpeed, 45, 75, 46, 59),
  accel: lerp(c.acceleration, 32, 65, 32, 50),
  handling: lerp(c.handling, 2.4, 4.0, 2.4, 3.15)
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

app.get('/health', (req, res) => res.status(200).json({ status: 'ok', rooms: rooms.size }));

const rooms = new Map();
const sessions = new Map();

const POWER_TYPES = ['TURBO', 'SHIELD', 'EMP', 'OIL', 'MISSILE'];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor({ name, maxPlayers = 6, isPrivate = false, password = null, allowMidRaceJoin = false, trackId = 'SPEEDWAY', totalLaps = 3, hostToken }) {
    this.id = generateRoomCode();
    this.name = (name || `Sala #${this.id}`).slice(0, 28);
    this.maxPlayers = Math.min(Math.max(Number(maxPlayers) || 6, 2), 8);
    this.isPrivate = Boolean(isPrivate);
    this.password = password ? String(password).slice(0, 16) : null;
    this.allowMidRaceJoin = Boolean(allowMidRaceJoin);
    this.trackConfig = TRACKS[trackId] || TRACKS.SPEEDWAY;
    this.totalLaps = Math.min(Math.max(Number(totalLaps) || 3, 1), 10);
    this.hostToken = hostToken;
    this.state = 'LOBBY';
    this.players = new Map();
    this.itemBoxes = [];
    this.coins = [];
    this.oilTraps = [];
    this.countdownEnd = 0;
    this.raceStartTime = 0;
    this.raceEndTime = 0;
    this.emptySince = null;
  }

  initPickups() {
    this.itemBoxes = [];
    this.coins = [];
    this.oilTraps = [];

    // 12 Caixas de Poderes espalhadas pela pista
    for (let i = 0; i < 12; i++) {
      const prog = (i / 12) + 0.04;
      const lateral = (i % 2 === 0 ? -3.8 : 3.8);
      const pt = getPointAtProgress(prog, lateral, this.trackConfig);
      this.itemBoxes.push({ id: i, x: Number(pt.x.toFixed(2)), z: Number(pt.z.toFixed(2)), active: true, respawnTimer: 0 });
    }

    // 24 Moedas espalhadas pelas curvas
    for (let i = 0; i < 24; i++) {
      const prog = (i / 24) + 0.02;
      const lateral = Math.sin(i * 1.2) * 5.2;
      const pt = getPointAtProgress(prog, lateral, this.trackConfig);
      this.coins.push({ id: i, x: Number(pt.x.toFixed(2)), z: Number(pt.z.toFixed(2)), active: true, respawnTimer: 0 });
    }
  }

  addPlayer(session, requestedCarType) {
    if (this.players.size >= this.maxPlayers && !this.players.has(session.token)) {
      return { ok: false, reason: 'Esta sala está cheia.' };
    }
    if (this.state !== 'LOBBY' && !this.allowMidRaceJoin && !this.players.has(session.token)) {
      return { ok: false, reason: 'A corrida já começou nesta sala.' };
    }

    this.emptySince = null;
    const validCar = CAR_TYPES.find(c => c.id === requestedCarType) || CAR_TYPES[0];

    if (this.players.has(session.token)) {
      const p = this.players.get(session.token);
      p.connected = true;
      p.disconnectedAt = null;
      p.name = session.name;
      p.carType = validCar.id;
      p.color = validCar.color;
      return { ok: true, player: p, reconnected: true };
    }

    const slotIndex = this.players.size;
    const spawn = this.getGridPosition(slotIndex);

    const player = {
      id: session.id,
      token: session.token,
      name: session.name,
      carType: validCar.id,
      color: validCar.color,
      ready: false,
      connected: true,
      disconnectedAt: null,
      x: spawn.x,
      z: spawn.z,
      vx: 0, vz: 0,
      speed: 0,
      heading: spawn.heading,
      inputs: { up: false, down: false, left: false, right: false },
      lap: 1,
      highestCheckpoint: 0,
      lastProgress: spawn.progress,
      totalProgress: 0,
      finished: false,
      finishTimeMs: null,
      position: slotIndex + 1,
      coinsCollected: 0,
      power: null,
      shieldTimer: 0,
      boostTimer: 0,
      spinTimer: 0
    };

    this.players.set(session.token, player);
    if (!this.hostToken || !this.players.has(this.hostToken)) {
      this.hostToken = session.token;
    }

    return { ok: true, player, reconnected: false };
  }

  getGridPosition(index) {
    const row = Math.floor(index / 2);
    const col = index % 2;
    const lateral = col === 0 ? -3.5 : 3.5;
    const progress = (1 - 0.015 - row * 0.018 + 1) % 1;
    const pt = getPointAtProgress(progress, lateral, this.trackConfig);
    return { x: pt.x, z: pt.z, heading: pt.heading, progress };
  }

  removePlayer(token) {
    this.players.delete(token);
    if (this.hostToken === token) {
      const next = Array.from(this.players.values()).find(p => p.connected) || Array.from(this.players.values())[0];
      this.hostToken = next ? next.token : null;
    }
    if (this.players.size === 0) {
      this.emptySince = Date.now();
    } else if (this.state === 'LOBBY') {
      this.checkAutoStart();
    }
  }

  resetForCountdown() {
    this.state = 'COUNTDOWN';
    this.countdownEnd = Date.now() + 3500;
    this.raceStartTime = 0;
    this.initPickups();

    let idx = 0;
    for (const p of this.players.values()) {
      const spawn = this.getGridPosition(idx++);
      p.x = spawn.x; p.z = spawn.z;
      p.vx = 0; p.vz = 0; p.speed = 0;
      p.heading = spawn.heading;
      p.lap = 1;
      p.highestCheckpoint = 0;
      p.lastProgress = spawn.progress;
      p.totalProgress = 0;
      p.finished = false;
      p.finishTimeMs = null;
      p.position = idx;
      p.inputs = { up: false, down: false, left: false, right: false };
      p.coinsCollected = 0;
      p.power = null;
      p.shieldTimer = 0;
      p.boostTimer = 0;
      p.spinTimer = 0;
    }
    this.broadcastRoomState();
  }

  checkAutoStart() {
    if (this.state !== 'LOBBY') return;
    const connected = Array.from(this.players.values()).filter(p => p.connected);
    if (connected.length >= 2 && connected.every(p => p.ready)) {
      this.resetForCountdown();
    }
  }

  usePower(token) {
    const p = this.players.get(token);
    if (!p || !p.power || p.finished || this.state !== 'RACING') return;

    const currentPower = p.power;
    p.power = null;

    if (currentPower === 'TURBO') {
      p.boostTimer = 2.6;
    } else if (currentPower === 'SHIELD') {
      p.shieldTimer = 6.0;
    } else if (currentPower === 'EMP') {
      for (const other of this.players.values()) {
        if (other.id !== p.id && other.shieldTimer <= 0) {
          other.spinTimer = 1.2;
          other.vx *= 0.25;
          other.vz *= 0.25;
        }
      }
    } else if (currentPower === 'MISSILE') {
      // Atinge o corredor exatamente à frente
      const targetPos = Math.max(1, p.position - 1);
      for (const other of this.players.values()) {
        if (other.id !== p.id && other.position === targetPos && other.shieldTimer <= 0) {
          other.spinTimer = 1.5;
          other.vx *= 0.15;
          other.vz *= 0.15;
        }
      }
    } else if (currentPower === 'OIL') {
      const dropDist = 3.2;
      this.oilTraps.push({
        id: Math.floor(Math.random() * 1000000),
        x: Number((p.x - Math.sin(p.heading) * dropDist).toFixed(2)),
        z: Number((p.z - Math.cos(p.heading) * dropDist).toFixed(2))
      });
    }
  }

  finishRaceAndDistributeRewards(now) {
    this.state = 'FINISHED';
    this.raceEndTime = now;
    this.firstFinishTime = null;

    const basePrize = [120, 90, 75, 60, 50, 40, 35, 30];
    const rewards = [];

    const sorted = Array.from(this.players.values()).sort((a, b) => a.position - b.position);
    for (const p of sorted) {
      p.ready = false;
      const posReward = basePrize[p.position - 1] || 30;
      const coinBonus = (p.coinsCollected || 0) * 5;
      const totalEarned = posReward + coinBonus;
      rewards.push({
        id: p.id,
        name: p.name,
        position: p.position,
        totalEarned
      });
    }

    const rewardPayload = JSON.stringify({ type: 'race_rewards', rewards });
    for (const token of this.players.keys()) {
      const s = sessions.get(token);
      if (s && s.ws && s.ws.readyState === 1) s.ws.send(rewardPayload);
    }

    this.broadcastRoomState();
    broadcastRoomListToLobby();
  }

  update(dt) {
    const now = Date.now();

    for (const [token, p] of this.players.entries()) {
      if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > 20000) {
        const s = sessions.get(token);
        if (s && s.roomId === this.id) s.roomId = null;
        this.removePlayer(token);
        this.broadcastRoomState();
        broadcastRoomListToLobby();
      }
    }

    if (this.players.size === 0) {
      if (!this.emptySince) this.emptySince = now;
      return;
    }

    if (this.state === 'COUNTDOWN') {
      if (now >= this.countdownEnd) {
        this.state = 'RACING';
        this.raceStartTime = now;
        this.broadcastRoomState();
        broadcastRoomListToLobby();
      }
      return;
    }

    if (this.state === 'RACING') {
      this.stepPhysics(dt, now);
      this.updatePickups(dt);

      const active = Array.from(this.players.values()).filter(p => p.connected);
      const anyFinished = Array.from(this.players.values()).some(p => p.finished);
      const allFinished = active.length > 0 && active.every(p => p.finished);
      const timedOut = now - this.raceStartTime > 240000;

      if (!this.firstFinishTime && anyFinished) {
        this.firstFinishTime = now;
      }
      const graceExpired = this.firstFinishTime && (now - this.firstFinishTime > 18000);

      if (allFinished || timedOut || graceExpired) {
        this.finishRaceAndDistributeRewards(now);
      }
      return;
    }

    if (this.state === 'FINISHED') {
      if (now - this.raceEndTime > 8000) {
        this.state = 'LOBBY';
        this.broadcastRoomState();
        broadcastRoomListToLobby();
      }
    }
  }

  updatePickups(dt) {
    for (const box of this.itemBoxes) {
      if (!box.active) {
        box.respawnTimer -= dt;
        if (box.respawnTimer <= 0) box.active = true;
      }
    }
    for (const coin of this.coins) {
      if (!coin.active) {
        coin.respawnTimer -= dt;
        if (coin.respawnTimer <= 0) coin.active = true;
      }
    }
  }

  stepPhysics(dt, now) {
    const BRAKE = 45;
    const MAX_REV = -15;
    const LATERAL_GRIP = 9.0;
    const DRAG = 0.52;

    const list = Array.from(this.players.values());

    for (const p of list) {
      const carSpec = CAR_TYPES.find(c => c.id === p.carType) || CAR_TYPES[0];
      let ACCEL = carSpec.accel;
      let MAX_SPEED = carSpec.topSpeed + Math.min(10, p.coinsCollected * 0.4);
      const TURN_SPEED = carSpec.handling;

      if (p.shieldTimer > 0) p.shieldTimer -= dt;
      if (p.boostTimer > 0) {
        p.boostTimer -= dt;
        ACCEL *= 1.65;
        MAX_SPEED *= 1.35;
      }

      if (p.spinTimer > 0) {
        p.spinTimer -= dt;
        p.heading += 11 * dt;
      }

      const inp = (!p.connected || p.finished || p.spinTimer > 0)
        ? { up: false, down: false, left: false, right: false }
        : p.inputs;

      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const rx = Math.cos(p.heading);
      const rz = -Math.sin(p.heading);

      let forwardSpeed = p.vx * fx + p.vz * fz;
      let lateralSpeed = p.vx * rx + p.vz * rz;

      if (inp.up) forwardSpeed += ACCEL * dt;
      if (inp.down) {
        if (forwardSpeed > 1) forwardSpeed -= BRAKE * dt;
        else forwardSpeed -= (ACCEL * 0.6) * dt;
      }

      forwardSpeed -= forwardSpeed * DRAG * dt;
      if (!inp.up && !inp.down && Math.abs(forwardSpeed) < 0.4) forwardSpeed = 0;
      forwardSpeed = Math.max(MAX_REV, Math.min(MAX_SPEED, forwardSpeed));

      if (Math.abs(forwardSpeed) > 0.3 && p.spinTimer <= 0) {
        const dir = forwardSpeed >= 0 ? 1 : -1;
        const speedFactor = Math.min(1, Math.abs(forwardSpeed) / 9);
        const highSpeedDamp = 1 - 0.22 * (Math.abs(forwardSpeed) / MAX_SPEED);
        let steer = 0;
        if (inp.left) steer += 1;
        if (inp.right) steer -= 1;
        p.heading += steer * TURN_SPEED * speedFactor * highSpeedDamp * dir * dt;
        p.heading = Math.atan2(Math.sin(p.heading), Math.cos(p.heading));
      }

      lateralSpeed *= Math.max(0, 1 - LATERAL_GRIP * dt);

      const nfx = Math.sin(p.heading);
      const nfz = Math.cos(p.heading);
      const nrx = Math.cos(p.heading);
      const nrz = -Math.sin(p.heading);

      p.vx = nfx * forwardSpeed + nrx * lateralSpeed;
      p.vz = nfz * forwardSpeed + nrz * lateralSpeed;

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // Colisão com as bordas da pista
      const metrics = getTrackMetrics(p.x, p.z, this.trackConfig);
      const maxOffset = (this.trackConfig.width / 2) - this.trackConfig.carRadius;

      if (Math.abs(metrics.distFromCenter) > maxOffset) {
        const sign = Math.sign(metrics.distFromCenter);
        p.x = metrics.cx + metrics.nx * sign * maxOffset;
        p.z = metrics.cz + metrics.nz * sign * maxOffset;

        const vn = p.vx * metrics.nx + p.vz * metrics.nz;
        if (vn * sign > 0) {
          p.vx -= 1.25 * vn * metrics.nx;
          p.vz -= 1.25 * vn * metrics.nz;
        }
        p.vx *= 0.9; p.vz *= 0.9;
      }

      p.speed = Math.hypot(p.vx, p.vz) * (forwardSpeed >= 0 ? 1 : -1);

      // Coletar Caixas de Poder
      for (const box of this.itemBoxes) {
        if (box.active && Math.hypot(p.x - box.x, p.z - box.z) < 2.6) {
          box.active = false;
          box.respawnTimer = 7;
          if (!p.power) {
            p.power = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
          }
        }
      }

      // Coletar Moedas
      for (const coin of this.coins) {
        if (coin.active && Math.hypot(p.x - coin.x, p.z - coin.z) < 2.3) {
          coin.active = false;
          coin.respawnTimer = 9;
          p.coinsCollected += 1;
        }
      }

      // Colisão com Poças de Óleo
      for (let i = this.oilTraps.length - 1; i >= 0; i--) {
        const trap = this.oilTraps[i];
        if (Math.hypot(p.x - trap.x, p.z - trap.z) < 2.3) {
          if (p.shieldTimer <= 0) {
            p.spinTimer = 1.35;
            p.vx *= 0.3;
            p.vz *= 0.3;
          }
          this.oilTraps.splice(i, 1);
        }
      }

      // Contagem de Voltas
      if (!p.finished) {
        const prog = metrics.progress;
        const sector = Math.min(3, Math.floor(prog * 4));

        if (sector === p.highestCheckpoint + 1) {
          p.highestCheckpoint = sector;
        }

        if (p.lastProgress > 0.75 && prog < 0.25 && p.highestCheckpoint >= 2) {
          p.lap += 1;
          p.highestCheckpoint = 0;
          if (p.lap > this.totalLaps) {
            p.lap = this.trackConfig.totalLaps;
            p.finished = true;
            p.finishTimeMs = now - this.raceStartTime;
          }
        }
        p.lastProgress = prog;

        const effectiveProg = (p.highestCheckpoint === 0 && prog > 0.75) ? (prog - 1) : prog;
        p.totalProgress = (p.lap - 1) + effectiveProg;
      } else {
        p.totalProgress = this.trackConfig.totalLaps + 10 - (p.finishTimeMs / 1000000);
      }
    }

    // Colisão Carro-Carro
    const minDist = this.trackConfig.carRadius * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]; const b = list[j];
        const dx = b.x - a.x; const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0 && dist < minDist) {
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist; const nz = dz / dist;
          a.x -= nx * overlap; a.z -= nz * overlap;
          b.x += nx * overlap; b.z += nz * overlap;
        }
      }
    }

    const sorted = [...list].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    sorted.forEach((p, idx) => { p.position = idx + 1; });
  }

  serializeRoomState() {
    const hostPlayer = this.players.get(this.hostToken);
    return {
      type: 'room_state',
      room: {
        id: this.id,
        name: this.name,
        isPrivate: this.isPrivate,
        maxPlayers: this.maxPlayers,
        allowMidRaceJoin: this.allowMidRaceJoin,
        trackId: this.trackConfig.id,
        state: this.state,
        hostId: hostPlayer ? hostPlayer.id : null,
        countdownMs: this.state === 'COUNTDOWN' ? Math.max(0, this.countdownEnd - Date.now()) : 0,
        totalLaps: this.totalLaps,
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          carType: p.carType,
          color: p.color,
          ready: p.ready,
          connected: p.connected,
          position: p.position,
          lap: p.lap,
          finished: p.finished,
          finishTimeMs: p.finishTimeMs,
          coinsCollected: p.coinsCollected,
          power: p.power,
          x: Number(p.x.toFixed(2)),
          z: Number(p.z.toFixed(2)),
          heading: Number(p.heading.toFixed(3)),
          speed: Number(p.speed.toFixed(1))
        }))
      }
    };
  }

  serializeTelemetry() {
    return {
      type: 'telemetry',
      t: Date.now(),
      state: this.state,
      countdownMs: this.state === 'COUNTDOWN' ? Math.max(0, this.countdownEnd - Date.now()) : 0,
      itemBoxes: this.itemBoxes,
      coins: this.coins,
      oilTraps: this.oilTraps,
      cars: Array.from(this.players.values()).map(p => ({
        id: p.id,
        x: Number(p.x.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        h: Number(p.heading.toFixed(3)),
        s: Number(p.speed.toFixed(1)),
        lap: p.lap,
        pos: p.position,
        fin: p.finished,
        coins: p.coinsCollected,
        power: p.power,
        shield: p.shieldTimer > 0,
        boost: p.boostTimer > 0
      }))
    };
  }

  broadcastRoomState() {
    const payload = JSON.stringify(this.serializeRoomState());
    for (const token of this.players.keys()) {
      const s = sessions.get(token);
      if (s && s.ws && s.ws.readyState === 1) s.ws.send(payload);
    }
  }

  broadcastTelemetry() {
    const payload = JSON.stringify(this.serializeTelemetry());
    for (const token of this.players.keys()) {
      const s = sessions.get(token);
      if (s && s.ws && s.ws.readyState === 1) s.ws.send(payload);
    }
  }
}

function getPublicRoomsPayload() {
  const list = [];
  for (const r of rooms.values()) {
    if (!r.isPrivate) {
      list.push({
        id: r.id,
        name: r.name,
        trackId: r.trackConfig.id,
        playersCount: r.players.size,
        maxPlayers: r.maxPlayers,
        state: r.state,
        allowMidRaceJoin: r.allowMidRaceJoin
      });
    }
  }
  return { type: 'room_list', rooms: list };
}

function broadcastRoomListToLobby() {
  const payload = JSON.stringify(getPublicRoomsPayload());
  for (const s of sessions.values()) {
    if (!s.roomId && s.ws && s.ws.readyState === 1) s.ws.send(payload);
  }
}

function handleLeaveCurrentRoom(session) {
  if (!session.roomId) return;
  const room = rooms.get(session.roomId);
  session.roomId = null;
  if (room) {
    room.removePlayer(session.token);
    if (room.players.size === 0) rooms.delete(room.id);
    else room.broadcastRoomState();
    broadcastRoomListToLobby();
  }
}

wss.on('connection', (ws) => {
  let currentSession = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'hello') {
      const token = (typeof msg.token === 'string' && msg.token.length >= 8)
        ? msg.token.slice(0, 64)
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

      const cleanName = (typeof msg.name === 'string' && msg.name.trim())
        ? msg.name.trim().slice(0, 16)
        : `Piloto_${Math.floor(100 + Math.random() * 900)}`;

      if (sessions.has(token)) {
        currentSession = sessions.get(token);
        if (currentSession.ws && currentSession.ws !== ws) {
          try { currentSession.ws.close(); } catch {}
        }
        currentSession.ws = ws;
        currentSession.name = cleanName;
      } else {
        currentSession = {
          token,
          id: 'p_' + Math.random().toString(36).slice(2, 9),
          name: cleanName,
          ws,
          roomId: null
        };
        sessions.set(token, currentSession);
      }

      ws.send(JSON.stringify({
        type: 'welcome',
        playerId: currentSession.id,
        token: currentSession.token,
        name: currentSession.name
      }));

      if (currentSession.roomId && rooms.has(currentSession.roomId)) {
        const room = rooms.get(currentSession.roomId);
        const res = room.addPlayer(currentSession, msg.carType);
        if (res.ok) {
          room.broadcastRoomState();
          return;
        } else {
          currentSession.roomId = null;
        }
      }

      ws.send(JSON.stringify(getPublicRoomsPayload()));
      return;
    }

    if (!currentSession) return;

    switch (msg.type) {
      case 'get_rooms': {
        ws.send(JSON.stringify(getPublicRoomsPayload()));
        break;
      }

      case 'set_car': {
        const room = rooms.get(currentSession.roomId);
        if (room && room.state === 'LOBBY') {
          const p = room.players.get(currentSession.token);
          const spec = CAR_TYPES.find(c => c.id === msg.carType);
          if (p && spec) {
            p.carType = spec.id;
            p.color = spec.color;
            room.broadcastRoomState();
          }
        }
        break;
      }

      case 'create_room': {
        handleLeaveCurrentRoom(currentSession);
        const room = new Room({
          name: msg.roomName,
          maxPlayers: msg.maxPlayers,
          trackId: msg.trackId || 'SPEEDWAY',
          hostToken: currentSession.token,
          isPrivate: Boolean(msg.isPrivate),
          password: msg.password || null,
          allowMidRaceJoin: Boolean(msg.allowMidRaceJoin),
          totalLaps: Number(msg.totalLaps) || 3
        });
        rooms.set(room.id, room);
        const res = room.addPlayer(currentSession, msg.carType);
        if (res.ok) {
          currentSession.roomId = room.id;
          room.broadcastRoomState();
          broadcastRoomListToLobby();
        }
        break;
      }

      case 'use_power': {
        const room = rooms.get(currentSession.roomId);
        if (room) room.usePower(currentSession.token);
        break;
      }

      case 'quick_play': {
        handleLeaveCurrentRoom(currentSession);
        let targetRoom = null;
        for (const r of rooms.values()) {
          if (!r.isPrivate && r.players.size < r.maxPlayers && r.state === 'LOBBY') {
            targetRoom = r;
            break;
          }
        }
        if (!targetRoom) {
          const trackKeys = Object.keys(TRACKS);
          const randomTrack = trackKeys[Math.floor(Math.random() * trackKeys.length)];
          targetRoom = new Room({
            name: `GP Público #${Math.floor(100 + Math.random() * 900)}`,
            maxPlayers: 6,
            trackId: randomTrack,
            hostToken: currentSession.token
          });
          rooms.set(targetRoom.id, targetRoom);
        }
        const res = targetRoom.addPlayer(currentSession, msg.carType);
        if (res.ok) {
          currentSession.roomId = targetRoom.id;
          targetRoom.broadcastRoomState();
          broadcastRoomListToLobby();
        }
        break;
      }

      case 'join_room': {
        const code = String(msg.roomId || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Sala não encontrada.' }));
        if (room.isPrivate && String(msg.password || '') !== room.password) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Senha incorreta para esta sala privada.' }));
        }
        handleLeaveCurrentRoom(currentSession);
        const res = room.addPlayer(currentSession, msg.carType);
        if (!res.ok) return ws.send(JSON.stringify({ type: 'error', message: res.reason }));
        currentSession.roomId = room.id;
        room.broadcastRoomState();
        broadcastRoomListToLobby();
        break;
      }

      case 'leave_room': {
        handleLeaveCurrentRoom(currentSession);
        ws.send(JSON.stringify({ type: 'left_room' }));
        ws.send(JSON.stringify(getPublicRoomsPayload()));
        break;
      }

      case 'toggle_ready': {
        const room = rooms.get(currentSession.roomId);
        if (!room || room.state !== 'LOBBY') return;
        const p = room.players.get(currentSession.token);
        if (!p) return;
        p.ready = !p.ready;
        room.broadcastRoomState();
        room.checkAutoStart();
        break;
      }

      case 'start_race': {
        const room = rooms.get(currentSession.roomId);
        if (!room || room.hostToken !== currentSession.token) return;
        if (room.state === 'LOBBY' || room.state === 'FINISHED') {
          room.resetForCountdown();
        }
        break;
      }

      case 'input': {
        const room = rooms.get(currentSession.roomId);
        if (!room) return;
        const p = room.players.get(currentSession.token);
        if (!p) return;
        p.inputs = {
          up: Boolean(msg.up),
          down: Boolean(msg.down),
          left: Boolean(msg.left),
          right: Boolean(msg.right)
        };
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentSession) return;
    if (currentSession.roomId && rooms.has(currentSession.roomId)) {
      const room = rooms.get(currentSession.roomId);
      const p = room.players.get(currentSession.token);
      if (p) {
        p.connected = false;
        p.disconnectedAt = Date.now();
        room.broadcastRoomState();
      }
    }
  });
});

const TICK_RATE = 30;
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  for (const [id, room] of rooms.entries()) {
    room.update(dt);
    if (room.state === 'COUNTDOWN' || room.state === 'RACING') {
      room.broadcastTelemetry();
    }
    if (room.players.size === 0 && room.emptySince && now - room.emptySince > 15000) {
      rooms.delete(id);
      broadcastRoomListToLobby();
    }
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Apex Circuit 3D rodando na porta ${PORT}`);
});
