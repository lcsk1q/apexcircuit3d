import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { TRACK, getTrackMetrics, getPointAtProgress } from './shared/track.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Servir arquivos estáticos e geometria compartilhada
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Healthcheck endpoint para Cloud Run / AI Studio
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', rooms: rooms.size }));

const CAR_COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#eab308'
];

// Estado em memória do servidor
const rooms = new Map();    // roomId -> Room
const sessions = new Map(); // token -> Session

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
  constructor({ name, maxPlayers = 6, isPrivate = false, allowMidRaceJoin = false, hostToken }) {
    this.id = generateRoomCode();
    this.name = (name || `Sala #${this.id}`).slice(0, 28);
    this.maxPlayers = Math.min(Math.max(Number(maxPlayers) || 6, 2), 8);
    this.isPrivate = Boolean(isPrivate);
    this.allowMidRaceJoin = Boolean(allowMidRaceJoin);
    this.hostToken = hostToken;
    this.state = 'LOBBY'; // 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'FINISHED'
    this.players = new Map(); // token -> PlayerState
    this.countdownEnd = 0;
    this.raceStartTime = 0;
    this.raceEndTime = 0;
    this.emptySince = null;
  }

  addPlayer(session) {
    if (this.players.size >= this.maxPlayers && !this.players.has(session.token)) {
      return { ok: false, reason: 'Esta sala está cheia.' };
    }
    if (this.state !== 'LOBBY' && !this.allowMidRaceJoin && !this.players.has(session.token)) {
      return { ok: false, reason: 'A corrida já começou nesta sala.' };
    }

    this.emptySince = null;

    if (this.players.has(session.token)) {
      const p = this.players.get(session.token);
      p.connected = true;
      p.disconnectedAt = null;
      p.name = session.name;
      return { ok: true, player: p, reconnected: true };
    }

    const usedColors = new Set(Array.from(this.players.values()).map(p => p.color));
    const color = CAR_COLORS.find(c => !usedColors.has(c)) || CAR_COLORS[this.players.size % CAR_COLORS.length];

    const slotIndex = this.players.size;
    const spawn = this.getGridPosition(slotIndex);

    const player = {
      id: session.id,
      token: session.token,
      name: session.name,
      color,
      ready: false,
      connected: true,
      disconnectedAt: null,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      speed: 0,
      heading: spawn.heading,
      inputs: { up: false, down: false, left: false, right: false },
      lap: 1,
      highestCheckpoint: 0,
      lastProgress: spawn.progress,
      totalProgress: 0,
      finished: false,
      finishTimeMs: null,
      position: slotIndex + 1
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
    const lateral = col === 0 ? -3.6 : 3.6;
    const progress = (1 - 0.018 - row * 0.022 + 1) % 1;
    const pt = getPointAtProgress(progress, lateral);
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

    let idx = 0;
    for (const p of this.players.values()) {
      const spawn = this.getGridPosition(idx++);
      p.x = spawn.x;
      p.z = spawn.z;
      p.vx = 0;
      p.vz = 0;
      p.speed = 0;
      p.heading = spawn.heading;
      p.lap = 1;
      p.highestCheckpoint = 0;
      p.lastProgress = spawn.progress;
      p.totalProgress = 0;
      p.finished = false;
      p.finishTimeMs = null;
      p.position = idx;
      p.inputs = { up: false, down: false, left: false, right: false };
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

  update(dt) {
    const now = Date.now();

    // Limpeza de jogadores que caíram há mais de 20 segundos
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

      const active = Array.from(this.players.values()).filter(p => p.connected);
      const anyFinished = Array.from(this.players.values()).some(p => p.finished);
      const allFinished = active.length > 0 && active.every(p => p.finished);
      const timedOut = now - this.raceStartTime > 180000; // Tempo máximo de 3 minutos

      if (!this.firstFinishTime && anyFinished) {
        this.firstFinishTime = now;
      }
      const graceExpired = this.firstFinishTime && (now - this.firstFinishTime > 20000);

      if (allFinished || timedOut || graceExpired) {
        this.state = 'FINISHED';
        this.raceEndTime = now;
        this.firstFinishTime = null;
        for (const p of this.players.values()) p.ready = false;
        this.broadcastRoomState();
        broadcastRoomListToLobby();
      }
      return;
    }

    if (this.state === 'FINISHED') {
      // Volta automaticamente ao Lobby após 10 segundos na tela de pódio
      if (now - this.raceEndTime > 10000) {
        this.state = 'LOBBY';
        this.broadcastRoomState();
        broadcastRoomListToLobby();
      }
    }
  }

  stepPhysics(dt, now) {
    const ACCEL = 32;
    const BRAKE = 40;
    const MAX_SPEED = 45;
    const MAX_REV = -14;
    const TURN_SPEED = 2.45;
    const LATERAL_GRIP = 8.5;
    const DRAG = 0.55;

    const list = Array.from(this.players.values());

    for (const p of list) {
      const inp = (!p.connected || p.finished)
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

      // Direção proporcional ao movimento
      if (Math.abs(forwardSpeed) > 0.3) {
        const dir = forwardSpeed >= 0 ? 1 : -1;
        const speedFactor = Math.min(1, Math.abs(forwardSpeed) / 9);
        const highSpeedDamp = 1 - 0.25 * (Math.abs(forwardSpeed) / MAX_SPEED);
        let steer = 0;
        if (inp.left) steer += 1;
        if (inp.right) steer -= 1;
        p.heading += steer * TURN_SPEED * speedFactor * highSpeedDamp * dir * dt;
        // Normalizar ângulo entre -PI e +PI
        p.heading = Math.atan2(Math.sin(p.heading), Math.cos(p.heading));
      }

      // Reduzir derrapagem lateral (Grip arcade)
      lateralSpeed *= Math.max(0, 1 - LATERAL_GRIP * dt);

      const nfx = Math.sin(p.heading);
      const nfz = Math.cos(p.heading);
      const nrx = Math.cos(p.heading);
      const nrz = -Math.sin(p.heading);

      p.vx = nfx * forwardSpeed + nrx * lateralSpeed;
      p.vz = nfz * forwardSpeed + nrz * lateralSpeed;

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // Colisão com as paredes da pista
      const metrics = getTrackMetrics(p.x, p.z);
      const maxOffset = (TRACK.width / 2) - TRACK.carRadius;

      if (Math.abs(metrics.distFromCenter) > maxOffset) {
        const sign = Math.sign(metrics.distFromCenter);
        p.x = metrics.cx + metrics.nx * sign * maxOffset;
        p.z = metrics.cz + metrics.nz * sign * maxOffset;

        const vn = p.vx * metrics.nx + p.vz * metrics.nz;
        if ( vn * sign > 0 ) {
          p.vx -= 1.3 * vn * metrics.nx;
          p.vz -= 1.3 * vn * metrics.nz;
        }
        p.vx *= 0.88;
        p.vz *= 0.88;
      }

      p.speed = Math.hypot(p.vx, p.vz) * (forwardSpeed >= 0 ? 1 : -1);

      // Verificação de Checkpoints e Voltas
      if (!p.finished) {
        const prog = metrics.progress;
        const sector = Math.min(3, Math.floor(prog * 4)); // 4 setores: 0, 1, 2, 3

        if (sector === p.highestCheckpoint + 1) {
          p.highestCheckpoint = sector;
        }

        // Cruzou a linha de chegada (de >0.75 para <0.25) tendo passado pelos checkpoints
        if (p.lastProgress > 0.75 && prog < 0.25 && p.highestCheckpoint >= 2) {
          p.lap += 1;
          p.highestCheckpoint = 0;
          if (p.lap > TRACK.totalLaps) {
            p.lap = TRACK.totalLaps;
            p.finished = true;
            p.finishTimeMs = now - this.raceStartTime;
          }
        }
        p.lastProgress = prog;

        const effectiveProg = (p.highestCheckpoint === 0 && prog > 0.75) ? (prog - 1) : prog;
        p.totalProgress = (p.lap - 1) + effectiveProg;
      } else {
        p.totalProgress = TRACK.totalLaps + 10 - (p.finishTimeMs / 1000000);
      }
    }

    // Colisão Carro-com-Carro
    const minDist = TRACK.carRadius * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0 && dist < minDist) {
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * overlap;
          a.z -= nz * overlap;
          b.x += nx * overlap;
          b.z += nz * overlap;

          const rvx = b.vx - a.vx;
          const rvz = b.vz - a.vz;
          const sepVel = rvx * nx + rvz * nz;
          if (sepVel < 0) {
            const impulse = -0.85 * sepVel;
            a.vx -= impulse * nx * 0.5;
            a.vz -= impulse * nz * 0.5;
            b.vx += impulse * nx * 0.5;
            b.vz += impulse * nz * 0.5;
          }
        }
      }
    }

    // Ordenação de posições da corrida
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
        state: this.state,
        hostId: hostPlayer ? hostPlayer.id : null,
        countdownMs: this.state === 'COUNTDOWN' ? Math.max(0, this.countdownEnd - Date.now()) : 0,
        totalLaps: TRACK.totalLaps,
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          color: p.color,
          ready: p.ready,
          connected: p.connected,
          position: p.position,
          lap: p.lap,
          finished: p.finished,
          finishTimeMs: p.finishTimeMs,
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
      raceElapsedMs: this.state === 'RACING' ? (Date.now() - this.raceStartTime) : 0,
      cars: Array.from(this.players.values()).map(p => ({
        id: p.id,
        x: Number(p.x.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        h: Number(p.heading.toFixed(3)),
        s: Number(p.speed.toFixed(1)),
        lap: p.lap,
        pos: p.position,
        fin: p.finished,
        ft: p.finishTimeMs
      }))
    };
  }

  broadcastRoomState() {
    const payload = JSON.stringify(this.serializeRoomState());
    for (const token of this.players.keys()) {
      const s = sessions.get(token);
      if (s && s.ws && s.ws.readyState === 1) {
        s.ws.send(payload);
      }
    }
  }

  broadcastTelemetry() {
    const payload = JSON.stringify(this.serializeTelemetry());
    for (const token of this.players.keys()) {
      const s = sessions.get(token);
      if (s && s.ws && s.ws.readyState === 1) {
        s.ws.send(payload);
      }
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
    if (!s.roomId && s.ws && s.ws.readyState === 1) {
      s.ws.send(payload);
    }
  }
}

function handleLeaveCurrentRoom(session) {
  if (!session.roomId) return;
  const room = rooms.get(session.roomId);
  session.roomId = null;
  if (room) {
    room.removePlayer(session.token);
    if (room.players.size === 0) {
      rooms.delete(room.id);
    } else {
      room.broadcastRoomState();
    }
    broadcastRoomListToLobby();
  }
}

wss.on('connection', (ws) => {
  let currentSession = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') return;

    // 1. Autenticação de Sessão e Reconexão Automática
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

      // Verifica se o jogador estava em uma sala antes de cair a conexão
      if (currentSession.roomId && rooms.has(currentSession.roomId)) {
        const room = rooms.get(currentSession.roomId);
        const res = room.addPlayer(currentSession);
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
      case 'set_name': {
        if (typeof msg.name === 'string' && msg.name.trim()) {
          currentSession.name = msg.name.trim().slice(0, 16);
          if (currentSession.roomId && rooms.has(currentSession.roomId)) {
            const room = rooms.get(currentSession.roomId);
            const p = room.players.get(currentSession.token);
            if (p) {
              p.name = currentSession.name;
              room.broadcastRoomState();
            }
          }
        }
        break;
      }

      case 'get_rooms': {
        ws.send(JSON.stringify(getPublicRoomsPayload()));
        break;
      }

      case 'quick_play': {
        if (typeof msg.name === 'string' && msg.name.trim()) {
          currentSession.name = msg.name.trim().slice(0, 16);
        }
        handleLeaveCurrentRoom(currentSession);

        // Procura uma sala pública no LOBBY com vaga ou que aceite entrada em andamento
        let targetRoom = null;
        for (const r of rooms.values()) {
          if (!r.isPrivate && r.players.size < r.maxPlayers) {
            if (r.state === 'LOBBY' || r.allowMidRaceJoin) {
              targetRoom = r;
              break;
            }
          }
        }

        // Se todas estiverem cheias ou em corrida fechada, cria uma nova sala automaticamente
        if (!targetRoom) {
          targetRoom = new Room({
            name: `GP Público #${Math.floor(100 + Math.random() * 900)}`,
            maxPlayers: 6,
            isPrivate: false,
            allowMidRaceJoin: false,
            hostToken: currentSession.token
          });
          rooms.set(targetRoom.id, targetRoom);
        }

        const res = targetRoom.addPlayer(currentSession);
        if (res.ok) {
          currentSession.roomId = targetRoom.id;
          targetRoom.broadcastRoomState();
          broadcastRoomListToLobby();
        } else {
          ws.send(JSON.stringify({ type: 'error', message: res.reason }));
        }
        break;
      }

      case 'create_room': {
        if (typeof msg.playerName === 'string' && msg.playerName.trim()) {
          currentSession.name = msg.playerName.trim().slice(0, 16);
        }
        handleLeaveCurrentRoom(currentSession);

        const room = new Room({
          name: msg.roomName,
          maxPlayers: msg.maxPlayers,
          isPrivate: msg.isPrivate,
          allowMidRaceJoin: msg.allowMidRaceJoin,
          hostToken: currentSession.token
        });
        rooms.set(room.id, room);
        const res = room.addPlayer(currentSession);
        if (res.ok) {
          currentSession.roomId = room.id;
          room.broadcastRoomState();
          broadcastRoomListToLobby();
        }
        break;
      }

      case 'join_room': {
        if (typeof msg.playerName === 'string' && msg.playerName.trim()) {
          currentSession.name = msg.playerName.trim().slice(0, 16);
        }
        const code = String(msg.roomId || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Sala não encontrada ou encerrada.' }));
          return;
        }
        if (currentSession.roomId && currentSession.roomId !== room.id) {
          handleLeaveCurrentRoom(currentSession);
        }
        const res = room.addPlayer(currentSession);
        if (!res.ok) {
          ws.send(JSON.stringify({ type: 'error', message: res.reason }));
          return;
        }
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
        broadcastRoomListToLobby();
        break;
      }

      case 'start_race': {
        const room = rooms.get(currentSession.roomId);
        if (!room) return;
        if (room.hostToken !== currentSession.token) {
          ws.send(JSON.stringify({ type: 'error', message: 'Apenas o anfitrião pode iniciar a corrida.' }));
          return;
        }
        if (room.state === 'LOBBY' || room.state === 'FINISHED') {
          room.resetForCountdown();
          broadcastRoomListToLobby();
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
        p.inputs = { up: false, down: false, left: false, right: false };
        room.broadcastRoomState();
      }
    }
  });
});

// Loop Autoritativo de Física e Limpeza de Salas (30 Hz)
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

    // Limpa salas vazias após 15 segundos
    if (room.players.size === 0 && room.emptySince && now - room.emptySince > 15000) {
      rooms.delete(id);
      broadcastRoomListToLobby();
    }
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Multiplayer rodando na porta ${PORT}`);
});
