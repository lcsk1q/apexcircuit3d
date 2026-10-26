//shared/track.js
export const TRACKS = {
  OVAL: {
    id: 'OVAL',
    name: 'Classic Speedway',
    straightLength: 130,
    radius: 52,
    width: 20,
    totalLaps: 3,
    carRadius: 1.35,
    skyColor: 0x0b132b,
    groundColor: 0x143326,
    roadColor: 0x262936
  },
  DESERT: {
    id: 'DESERT',
    name: 'Canyon Desert',
    straightLength: 160,
    radius: 40,
    width: 22,
    totalLaps: 3,
    carRadius: 1.35,
    skyColor: 0xf59e0b,
    groundColor: 0x78350f,
    roadColor: 0x451a03
  },
  CYBER: {
    id: 'CYBER',
    name: 'Neon Cyber City',
    straightLength: 110,
    radius: 60,
    width: 18,
    totalLaps: 4,
    carRadius: 1.35,
    skyColor: 0x020617,
    groundColor: 0x090d16,
    roadColor: 0x0f172a
  }
};

export const CAR_TYPES = [
  { id: 'APEX', name: 'Cyber Apex', color: '#3b82f6' },
  { id: 'DEMON', name: 'Speed Demon', color: '#ef4444' },
  { id: 'MUSCLE', name: 'Retro Muscle', color: '#f59e0b' },
  { id: 'BEAST', name: 'Offroad Beast', color: '#10b981' },
  { id: 'FORMULA', name: 'Hyper Formula', color: '#8b5cf6' }
];

export function getTrackMetrics(x, z, trackConfig = TRACKS.OVAL) {
  const L = trackConfig.straightLength / 2;
  const R = trackConfig.radius;
  
  let cx = 0, cz = 0;
  let nx = 0, nz = 0;
  let distFromCenter = 0;

  if (z >= -L && z <= L) {
    if (x >= 0) {
      cx = R; cz = z;
      distFromCenter = x - R;
      nx = 1; nz = 0;
    } else {
      cx = -R; cz = z;
      distFromCenter = -R - x;
      nx = -1; nz = 0;
    }
  } else if (z > L) {
    const dx = x;
    const dz = z - L;
    const d = Math.hypot(dx, dz) || 0.0001;
    nx = dx / d; nz = dz / d;
    cx = nx * R; cz = L + nz * R;
    distFromCenter = d - R;
  } else {
    const dx = x;
    const dz = z + L;
    const d = Math.hypot(dx, dz) || 0.0001;
    nx = dx / d; nz = dz / d;
    cx = nx * R; cz = -L + nz * R;
    distFromCenter = d - R;
  }

  const straightLen = trackConfig.straightLength;
  const curveLen = Math.PI * R;
  const totalLen = 2 * straightLen + 2 * curveLen;
  let s = 0;

  if (x >= 0 && z >= -L && z <= L) {
    s = z - (-L);
  } else if (z > L) {
    const angle = Math.atan2(z - L, x);
    s = straightLen + angle * R;
  } else if (x < 0 && z >= -L && z <= L) {
    s = straightLen + curveLen + (L - z);
  } else {
    const angle = Math.atan2(-(z + L), -x);
    s = 2 * straightLen + curveLen + angle * R;
  }

  const startOffset = L;
  let progress = (s - startOffset) / totalLen;
  if (progress < 0) progress += 1;

  return { cx, cz, nx, nz, distFromCenter, progress, totalLen };
}

export function getPointAtProgress(progress, lateralOffset = 0, trackConfig = TRACKS.OVAL) {
  const L = trackConfig.straightLength / 2;
  const R = trackConfig.radius;
  const straightLen = trackConfig.straightLength;
  const curveLen = Math.PI * R;
  const totalLen = 2 * straightLen + 2 * curveLen;

  let s = (progress * totalLen + L) % totalLen;
  if (s < 0) s += totalLen;

  let cx = 0, cz = 0, nx = 0, nz = 0, tx = 0, tz = 0;

  if (s <= straightLen) {
    cx = R; cz = -L + s;
    nx = 1; nz = 0; tx = 0; tz = 1;
  } else if (s <= straightLen + curveLen) {
    const angle = (s - straightLen) / R;
    nx = Math.cos(angle); nz = Math.sin(angle);
    cx = nx * R; cz = L + nz * R;
    tx = -Math.sin(angle); tz = Math.cos(angle);
  } else if (s <= 2 * straightLen + curveLen) {
    const d = s - (straightLen + curveLen);
    cx = -R; cz = L - d;
    nx = -1; nz = 0; tx = 0; tz = -1;
  } else {
    const angle = (s - (2 * straightLen + curveLen)) / R;
    nx = -Math.cos(angle); nz = -Math.sin(angle);
    cx = nx * R; cz = -L + nz * R;
    tx = Math.sin(angle); tz = -Math.cos(angle);
  }

  return {
    x: cx + nx * lateralOffset,
    z: cz + nz * lateralOffset,
    heading: Math.atan2(tx, tz),
    nx, nz
  };
}