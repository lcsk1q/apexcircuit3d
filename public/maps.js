// public/maps.js - Constrói a pista (mesma geometria do servidor) e o cenário de cada tema
import * as THREE from 'three';
import { getPointAtProgress, getTrackMetrics } from '/shared/track.js';

export const THEMES = {
  FOREST: { fogNear: 60, fogFar: 420, hemi: 0.9, sun: 2.4, glow: null, sunMoves: true },
  DESERT: { fogNear: 80, fogFar: 600, hemi: 1.1, sun: 3.0, glow: null, sunMoves: true },
  CYBER:  { fogNear: 40, fogFar: 380, hemi: 0.5, sun: 0.8, glow: [0x00ffff, 0xff00ff], sunMoves: false },
  ICE:    { fogNear: 60, fogFar: 500, hemi: 1.2, sun: 2.6, glow: null, sunMoves: true },
  LAVA:   { fogNear: 40, fogFar: 350, hemi: 0.5, sun: 0.9, glow: [0xf97316, 0xef4444], sunMoves: false }
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d'), r = rng(7);
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10) for (let x = 4; x < 60; x += 10)
    if (r() > 0.45) { g.fillStyle = r() > 0.5 ? '#ffe9a8' : '#7ff'; g.fillRect(x, y, 5, 6); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Faixa contínua entre dois deslocamentos laterais da linha central (pista fechada). */
function ribbon(cfg, from, to, y, colorAt, N = 360) {
  const pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const a = getPointAtProgress(i / N, from, cfg), b = getPointAtProgress(i / N, to, cfg);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    c.set(colorAt(i)); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

/** Espalha instâncias fora da pista. */
function scatter(group, cfg, rnd, geo, mat, count, clearance, sizeFn, palette) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const o = new THREE.Object3D(), c = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < count && tries++ < count * 20) {
    const x = (rnd() * 2 - 1) * 420, z = (rnd() * 2 - 1) * 420;
    const m = getTrackMetrics(x, z, cfg);
    if (Math.hypot(x - m.cx, z - m.cz) < cfg.width / 2 + clearance) continue;
    const [sx, sy, sz] = sizeFn(rnd);
    o.position.set(x, 0, z); o.rotation.y = rnd() * Math.PI; o.scale.set(sx, sy, sz); o.updateMatrix();
    mesh.setMatrixAt(placed, o.matrix);
    mesh.setColorAt(placed, c.set(palette[Math.floor(rnd() * palette.length)]));
    placed++;
  }
  mesh.count = placed;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
}

export function buildWorld(cfg) {
  const group = new THREE.Group();
  const rnd = rng(cfg.id.length * 7919 + 13);
  let onUpdate = () => {};

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: cfg.groundColor, roughness: 1 }));
  ground.position.y = -0.02; ground.receiveShadow = true;
  group.add(ground);

  const w = cfg.width / 2;
  group.add(ribbon(cfg, -w, w, 0.05, () => cfg.roadColor));
  group.add(ribbon(cfg, w, w + 1.6, 0.06, (i) => (Math.floor(i / 3) % 2 ? cfg.curbColorA : cfg.curbColorB)));
  group.add(ribbon(cfg, -w - 1.6, -w, 0.06, (i) => (Math.floor(i / 3) % 2 ? cfg.curbColorA : cfg.curbColorB)));
  group.add(ribbon(cfg, -0.25, 0.25, 0.07, (i) => (Math.floor(i / 4) % 2 ? cfg.roadColor : 0xe2e8f0)));

  // Linha de largada/chegada (progresso 0)
  const sp = getPointAtProgress(0, 0, cfg);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(cfg.width, 2.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  line.position.set(sp.x, 0.09, sp.z); line.rotation.y = sp.heading;
  group.add(line);

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });

  switch (cfg.theme) {
    case 'FOREST':
      scatter(group, cfg, rnd, new THREE.ConeGeometry(1, 3, 7).translate(0, 1.5, 0), std(), 520, 8,
        (r) => { const s = 2 + r() * 3; return [s, s * (1.5 + r()), s]; }, [0x166534, 0x15803d, 0x14532d, 0x1a6b3a]);
      break;
    case 'DESERT':
      scatter(group, cfg, rnd, new THREE.SphereGeometry(1, 16, 10), std(), 70, 25,
        (r) => [25 + r() * 40, 4 + r() * 8, 25 + r() * 40], [0xc2410c, 0xb45309, 0x9a3412]);
      scatter(group, cfg, rnd, new THREE.DodecahedronGeometry(1, 0), std(), 160, 10,
        (r) => [2 + r() * 5, 2 + r() * 6, 2 + r() * 5], [0x7c2d12, 0x92400e, 0xa16207]);
      break;
    case 'CYBER': {
      const tex = windowTexture();
      const bm = std({ color: 0xffffff, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.4 });
      scatter(group, cfg, rnd, box, bm, 230, 22, (r) => [14 + r() * 16, 25 + Math.pow(r(), 2) * 150, 14 + r() * 16],
        [0x14162e, 0x1b1f3d, 0x10122a, 0x23183f]);
      // Postes de neon ao longo da pista
      const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 7).translate(0, 3.5, 0);
      const pm = std({ color: 0x111111, emissive: 0x00ffff, emissiveIntensity: 1.6 });
      const poles = new THREE.InstancedMesh(poleGeo, pm, 120), o = new THREE.Object3D(); let n = 0;
      for (let i = 0; i < 60; i++) for (const side of [-1, 1]) {
        const p = getPointAtProgress(i / 60, side * (w + 3), cfg); o.position.set(p.x, 0, p.z); o.updateMatrix(); poles.setMatrixAt(n++, o.matrix);
      }
      group.add(poles);
      onUpdate = (t) => { bm.emissiveIntensity = 0.8 + Math.sin(t * 1.5) * 0.2; };
      break;
    }
    case 'ICE':
      scatter(group, cfg, rnd, new THREE.ConeGeometry(1, 4, 4).translate(0, 2, 0), std({ roughness: 0.2, metalness: 0.2 }), 260, 10,
        (r) => { const s = 2 + r() * 4; return [s, s * (1.2 + r() * 1.5), s]; }, [0x93c5fd, 0xbfdbfe, 0xe0f2fe, 0x7dd3fc]);
      break;
    case 'LAVA':
      scatter(group, cfg, rnd, new THREE.DodecahedronGeometry(1, 0), std({ roughness: 1 }), 260, 10,
        (r) => { const s = 2 + r() * 6; return [s, s * (0.8 + r() * 2), s]; }, [0x27272a, 0x18181b, 0x3f3f46]);
      scatter(group, cfg, rnd, new THREE.ConeGeometry(1, 2, 5).translate(0, 1, 0), std({ color: 0x111111, emissive: 0xf97316, emissiveIntensity: 1.4 }), 90, 12,
        (r) => { const s = 1 + r() * 2.5; return [s, s, s]; }, [0xffffff]);
      break;
  }

  return { group, update: onUpdate };
}
