// public/maps.js - Gera cenários 3D procedurais (sem precisar de modelos externos)
import * as THREE from 'three';

export const WORLD_HALF = 780; // limite jogável (mapa de ~1.5 km)

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d'), r = rng(7);
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10)
    for (let x = 4; x < 60; x += 10)
      if (r() > 0.45) { g.fillStyle = r() > 0.5 ? '#ffe9a8' : '#7ff'; g.fillRect(x, y, 5, 6); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addGround(group, color) {
  const geo = new THREE.PlaneGeometry(WORLD_HALF * 2 + 1200, WORLD_HALF * 2 + 1200).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.receiveShadow = true;
  group.add(m);
}

function addRoads(group, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const geo = new THREE.PlaneGeometry(24, WORLD_HALF * 2).rotateX(-Math.PI / 2);
  const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat);
  a.position.y = b.position.y = 0.03; b.rotation.y = Math.PI / 2;
  a.receiveShadow = b.receiveShadow = true;
  group.add(a, b);

  // Faixa central tracejada
  const dashGeo = new THREE.PlaneGeometry(0.6, 6).rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
  const n = Math.floor(WORLD_HALF * 2 / 16);
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, n * 2);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const t = -WORLD_HALF + i * 16;
    d.rotation.set(0, 0, 0); d.position.set(0, 0.06, t); d.updateMatrix(); dashes.setMatrixAt(i, d.matrix);
    d.rotation.set(0, Math.PI / 2, 0); d.position.set(t, 0.06, 0); d.updateMatrix(); dashes.setMatrixAt(n + i, d.matrix);
  }
  group.add(dashes);
}

function addBuildings(group, rnd, mat, palette, hMax) {
  const list = [];
  for (let x = -700; x <= 700; x += 46)
    for (let z = -700; z <= 700; z += 46) {
      if (Math.abs(x) < 30 || Math.abs(z) < 30 || rnd() < 0.15) continue;
      list.push([x + (rnd() - 0.5) * 6, z + (rnd() - 0.5) * 6, 16 + rnd() * 14, 16 + rnd() * 14, 12 + Math.pow(rnd(), 2) * hMax]);
    }
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  list.forEach(([x, z, w, dp, h], i) => {
    o.position.set(x, 0, z); o.scale.set(w, h, dp); o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, c.set(palette[Math.floor(rnd() * palette.length)]));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
}

function addScatter(group, rnd, geo, mat, count, minRoadDist, sizeFn, palette) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let x, z;
    do { x = (rnd() * 2 - 1) * 740; z = (rnd() * 2 - 1) * 740; }
    while (Math.min(Math.abs(x), Math.abs(z)) < minRoadDist);
    const [sx, sy, sz] = sizeFn(rnd);
    o.position.set(x, 0, z); o.rotation.y = rnd() * Math.PI; o.scale.set(sx, sy, sz); o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, c.set(palette[Math.floor(rnd() * palette.length)]));
  }
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
}

export function buildMap(id, cfg) {
  const group = new THREE.Group();
  const rnd = rng(id.length * 1013 + 42);
  let onUpdate = () => {};

  addGround(group, cfg.groundColor);

  if (cfg.theme === 'URBAN') {
    addRoads(group, 0x2b2b30);
    addBuildings(group, rnd, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 }),
      [0x9aa5b1, 0x7b8794, 0xb8c2cc, 0x6b7a8f, 0xa39e93], 110);
  }

  if (cfg.theme === 'DESERT') {
    addRoads(group, 0x3b2a1a);
    const sand = new THREE.MeshStandardMaterial({ roughness: 1 });
    addScatter(group, rnd, new THREE.SphereGeometry(1, 20, 12), sand, 160, 70,
      r => [40 + r() * 70, 6 + r() * 12, 40 + r() * 70], [0xdaa520, 0xcd9b3a, 0xe0b04f, 0xc88f2f]);
    addScatter(group, rnd, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), 140, 20,
      r => [2 + r() * 6, 2 + r() * 8, 2 + r() * 6], [0x8b5a2b, 0x7a4e2a, 0x9c6b3c]);
  }

  if (cfg.theme === 'CYBER') {
    addRoads(group, 0x0d1020);
    const winTex = windowTexture();
    const bMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.6
    });
    addBuildings(group, rnd, bMat, [0x14162e, 0x1b1f3d, 0x10122a, 0x23183f], 160);

    // Faixas de neon nas laterais das ruas
    const cy = new THREE.MeshBasicMaterial({ color: 0x00ffff }), mg = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const long = WORLD_HALF * 2;
    [[-13, cy], [13, mg]].forEach(([off, m]) => {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, long), m); a.position.set(off, 0.15, 0);
      const b = new THREE.Mesh(new THREE.BoxGeometry(long, 0.3, 0.5), m); b.position.set(0, 0.15, off);
      group.add(a, b);
    });
    // Postes neon
    const poleGeo = new THREE.CylinderGeometry(0.25, 0.25, 10).translate(0, 5, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x00ffff, emissiveIntensity: 1.5 });
    const n = Math.floor(long / 60);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, n * 2);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const t = -WORLD_HALF + i * 60;
      o.position.set(16, 0, t); o.updateMatrix(); poles.setMatrixAt(i, o.matrix);
      o.position.set(t, 0, -16); o.updateMatrix(); poles.setMatrixAt(n + i, o.matrix);
    }
    group.add(poles);
    onUpdate = (t) => { bMat.emissiveIntensity = 0.8 + Math.sin(t * 1.5) * 0.2; };
  }

  return { group, update: onUpdate };
}
