// Geometria compartilhada entre Servidor (Física) e Cliente (Renderização 3D)
export const TRACK = {
  straightLength: 130, // Comprimento das retas
  radius: 52,          // Raio das curvas
  width: 20,           // Largura da pista
  totalLaps: 3,        // Voltas por corrida
  carRadius: 1.35      // Raio de colisão esférica dos carros
};

/**
 * Calcula a distância de um ponto (x, z) até o centro da pista oval,
 * a normal da pista e o progresso normalizado (0.0 a 1.0) ao longo da volta.
 */
export function getTrackMetrics(x, z) {
  const L = TRACK.straightLength / 2;
  const R = TRACK.radius;
  
  let cx = 0, cz = 0;
  let nx = 0, nz = 0;
  let distFromCenter = 0;

  if (z >= -L && z <= L) {
    // Nas retas (Direita: x > 0, Esquerda: x < 0)
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
    // Curva Norte (Superior)
    const dx = x;
    const dz = z - L;
    const d = Math.hypot(dx, dz) || 0.0001;
    nx = dx / d;
    nz = dz / d;
    cx = nx * R;
    cz = L + nz * R;
    distFromCenter = d - R;
  } else {
    // Curva Sul (Inferior)
    const dx = x;
    const dz = z + L;
    const d = Math.hypot(dx, dz) || 0.0001;
    nx = dx / d;
    nz = dz / d;
    cx = nx * R;
    cz = -L + nz * R;
    distFromCenter = d - R;
  }

  // Cálculo do progresso da volta (0.0 a 1.0) no sentido anti-horário
  const straightLen = TRACK.straightLength;
  const curveLen = Math.PI * R;
  const totalLen = 2 * straightLen + 2 * curveLen;
  let s = 0;

  if (x >= 0 && z >= -L && z <= L) {
    // Reta Direita (Principal - Sentido Norte: z vai de -L para +L)
    s = z - (-L);
  } else if (z > L) {
    // Curva Norte (Ângulo vai de 0 até PI)
    const angle = Math.atan2(z - L, x);
    s = straightLen + angle * R;
  } else if (x < 0 && z >= -L && z <= L) {
    // Reta Esquerda (Oposta - Sentido Sul: z vai de +L para -L)
    s = straightLen + curveLen + (L - z);
  } else {
    // Curva Sul (Ângulo vai de PI até 2*PI)
    const angle = Math.atan2(-(z + L), -x);
    s = 2 * straightLen + curveLen + angle * R;
  }

  // Compensa para que a linha de chegada fique no meio da reta direita (z = 0)
  const startOffset = L;
  let progress = (s - startOffset) / totalLen;
  if (progress < 0) progress += 1;

  return { cx, cz, nx, nz, distFromCenter, progress, totalLen };
}

/**
 * Retorna a coordenada (x, z) e a orientação (heading) a partir de um progresso (0..1)
 * e um deslocamento lateral (lateralOffset). Usado para posicionar o Grid de Largada e a Malha 3D.
 */
export function getPointAtProgress(progress, lateralOffset = 0) {
  const L = TRACK.straightLength / 2;
  const R = TRACK.radius;
  const straightLen = TRACK.straightLength;
  const curveLen = Math.PI * R;
  const totalLen = 2 * straightLen + 2 * curveLen;

  let s = (progress * totalLen + L) % totalLen;
  if (s < 0) s += totalLen;

  let cx = 0, cz = 0, nx = 0, nz = 0, tx = 0, tz = 0;

  if (s <= straightLen) {
    cx = R;
    cz = -L + s;
    nx = 1; nz = 0;
    tx = 0; tz = 1;
  } else if (s <= straightLen + curveLen) {
    const angle = (s - straightLen) / R;
    nx = Math.cos(angle);
    nz = Math.sin(angle);
    cx = nx * R;
    cz = L + nz * R;
    tx = -Math.sin(angle);
    tz = Math.cos(angle);
  } else if (s <= 2 * straightLen + curveLen) {
    const d = s - (straightLen + curveLen);
    cx = -R;
    cz = L - d;
    nx = -1; nz = 0;
    tx = 0; tz = -1;
  } else {
    const angle = (s - (2 * straightLen + curveLen)) / R;
    nx = -Math.cos(angle);
    nz = -Math.sin(angle);
    cx = nx * R;
    cz = -L + nz * R;
    tx = Math.sin(angle);
    tz = -Math.cos(angle);
  }

  const heading = Math.atan2(tx, tz);
  return {
    x: cx + nx * lateralOffset,
    z: cz + nz * lateralOffset,
    heading,
    nx,
    nz
  };
}
