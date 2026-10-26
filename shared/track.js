// shared/track.js
export const TRACKS = {
  SPEEDWAY: {
    id: 'SPEEDWAY',
    name: 'Circuito Grand Prix',
    baseRadius: 95,
    amp2: 22,
    amp3: 12,
    width: 20,
    totalLaps: 3,
    carRadius: 1.4,
    skyColor: 0x0b172a,
    groundColor: 0x143326,
    roadColor: 0x1e293b,
    curbColorA: 0xef4444,
    curbColorB: 0xf8fafc,
    theme: 'FOREST'
  },
  DESERT: {
    id: 'DESERT',
    name: 'Cânion das Dunas',
    baseRadius: 105,
    amp2: 32,
    amp3: 18,
    width: 22,
    totalLaps: 3,
    carRadius: 1.4,
    skyColor: 0x7c2d12,
    groundColor: 0x9a3412,
    roadColor: 0x431407,
    curbColorA: 0xf59e0b,
    curbColorB: 0xfffbeb,
    theme: 'DESERT'
  },
  CYBER: {
    id: 'CYBER',
    name: 'Neo Tokyo 2099',
    baseRadius: 100,
    amp2: 15,
    amp3: 28,
    width: 19,
    totalLaps: 3,
    carRadius: 1.4,
    skyColor: 0x020617,
    groundColor: 0x090d16,
    roadColor: 0x0f172a,
    curbColorA: 0x06b6d4,
    curbColorB: 0xd946ef,
    theme: 'CYBER'
  },
  GLACIER: {
    id: 'GLACIER',
    name: 'Pico Glacial Ártico',
    baseRadius: 92,
    amp2: 28,
    amp3: 10,
    width: 21,
    totalLaps: 3,
    carRadius: 1.4,
    skyColor: 0x1e3a8a,
    groundColor: 0xe2e8f0,
    roadColor: 0x334155,
    curbColorA: 0x38bdf8,
    curbColorB: 0xffffff,
    theme: 'ICE'
  },
  VOLCANO: {
    id: 'VOLCANO',
    name: 'Caldeira de Magma',
    baseRadius: 110,
    amp2: 25,
    amp3: 25,
    width: 18,
    totalLaps: 3,
    carRadius: 1.4,
    skyColor: 0x2a0808,
    groundColor: 0x18181b,
    roadColor: 0x27272a,
    curbColorA: 0xf97316,
    curbColorB: 0x18181b,
    theme: 'LAVA'
  }
};

export const CAR_TYPES = [
  {
    id: 'STARTER',
    name: 'Street Pulse',
    tier: 1,
    price: 0,
    color: '#3b82f6',
    accent: '#93c5fd',
    topSpeed: 46,
    accel: 32,
    handling: 2.4,
    desc: 'Compacto urbano equilibrado para iniciantes.'
  },
  {
    id: 'TUNER',
    name: 'Nitro GT-R',
    tier: 2,
    price: 200,
    color: '#10b981',
    accent: '#111827',
    topSpeed: 49,
    accel: 36,
    handling: 2.65,
    desc: 'Cupê esportivo com aerofólio de fibra e ótima curva.'
  },
  {
    id: 'MUSCLE',
    name: 'V8 Hellfire',
    tier: 3,
    price: 500,
    color: '#f59e0b',
    accent: '#fef3c7',
    topSpeed: 52,
    accel: 41,
    handling: 2.55,
    desc: 'Motor Supercharger exposto no capô e força bruta.'
  },
  {
    id: 'CYBERCAR',
    name: 'Blade V12 Neon',
    tier: 4,
    price: 950,
    color: '#ec4899',
    accent: '#06b6d4',
    topSpeed: 55,
    accel: 45,
    handling: 2.85,
    desc: 'Supercarro futurista com chassi baixo e reator de plasma.'
  },
  {
    id: 'HYPER_F1',
    name: 'Apex Formula X',
    tier: 5,
    price: 1500,
    color: '#8b5cf6',
    accent: '#fbbf24',
    topSpeed: 59,
    accel: 50,
    handling: 3.15,
    desc: 'O ápice da engenharia. Aerodinâmica de Fórmula 1.'
  }
];

const SAMPLES = 360;
const trackCache = new Map();

function buildTrackSamples(trackConfig) {
  const id = trackConfig.id || 'SPEEDWAY';
  if (trackCache.has(id)) return trackCache.get(id);

  const pts = [];
  const R = trackConfig.baseRadius || 95;
  const A2 = trackConfig.amp2 || 20;
  const A3 = trackConfig.amp3 || 12;

  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    const theta = t * Math.PI * 2;
    const r = R + A2 * Math.cos(2 * theta) + A3 * Math.sin(3 * theta);
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    pts.push({ x, z, t });
  }

  let totalLen = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % SAMPLES];
    const prev = pts[(i - 1 + SAMPLES) % SAMPLES];

    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    curr.tx = dx / len;
    curr.tz = dz / len;
    // Normal apontando para fora da pista
    curr.nx = curr.tx * 0 + curr.tz;
    curr.nz = -curr.tx;
    curr.heading = Math.atan2(curr.tx, curr.tz);

    totalLen += Math.hypot(next.x - curr.x, next.z - curr.z);
  }

  const data = { pts, totalLen };
  trackCache.set(id, data);
  return data;
}

export function getPointAtProgress(progress, lateralOffset = 0, trackConfig = TRACKS.SPEEDWAY) {
  const { pts } = buildTrackSamples(trackConfig);
  let p = progress % 1;
  if (p < 0) p += 1;

  const exactIdx = p * SAMPLES;
  const i0 = Math.floor(exactIdx) % SAMPLES;
  const i1 = (i0 + 1) % SAMPLES;
  const frac = exactIdx - Math.floor(exactIdx);

  const a = pts[i0];
  const b = pts[i1];

  const cx = a.x + (b.x - a.x) * frac;
  const cz = a.z + (b.z - a.z) * frac;
  const tx = a.tx + (b.tx - a.tx) * frac;
  const tz = a.tz + (b.tz - a.tz) * frac;
  const tLen = Math.hypot(tx, tz) || 1;
  const ntx = tx / tLen;
  const ntz = tz / tLen;

  const nx = ntz;
  const nz = -ntx;

  return {
    x: cx + nx * lateralOffset,
    z: cz + nz * lateralOffset,
    cx,
    cz,
    tx: ntx,
    tz: ntz,
    nx,
    nz,
    heading: Math.atan2(ntx, ntz)
  };
}

export function getTrackMetrics(x, z, trackConfig = TRACKS.SPEEDWAY) {
  const { pts, totalLen } = buildTrackSamples(trackConfig);

  let bestIdx = 0;
  let bestDistSq = Infinity;

  for (let i = 0; i < SAMPLES; i++) {
    const dx = x - pts[i].x;
    const dz = z - pts[i].z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  const pt = pts[bestIdx];
  const dx = x - pt.x;
  const dz = z - pt.z;

  const distFromCenter = dx * pt.nx + dz * pt.nz;
  const progress = bestIdx / SAMPLES;

  return {
    cx: pt.x,
    cz: pt.z,
    nx: pt.nx,
    nz: pt.nz,
    tx: pt.tx,
    tz: pt.tz,
    distFromCenter,
    progress,
    totalLen
  };
}
