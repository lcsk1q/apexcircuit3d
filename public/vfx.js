// public/vfx.js - Partículas em pool único (sem vazamento de memória)
import * as THREE from 'three';

const VERT = `
attribute float aSize; attribute vec4 aColor;
varying vec4 vColor; uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor.rgb, smoothstep(0.5, 0.1, d) * vColor.a);
}`;

class ParticlePool {
  constructor(scene, max, additive, gravity) {
    this.max = max; this.cursor = 0; this.gravity = gravity;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.age = new Float32Array(max);
    this.ttl = new Float32Array(max);   // 0 = partícula livre
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, ttl, s0, s1, c0, c1) {
    const i = this.cursor++ % this.max, i3 = i * 3, i4 = i * 4;
    this.pos.set([p.x, p.y, p.z], i3);
    this.vel.set([v.x, v.y, v.z], i3);
    this.age[i] = 0; this.ttl[i] = ttl; this.s0[i] = s0; this.s1[i] = s1;
    this.c0.set(c0, i4); this.c1.set(c1, i4);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const i3 = i * 3, i4 = i * 4;
      if (this.ttl[i] <= 0) { this.size[i] = 0; continue; }
      this.age[i] += dt;
      if (this.age[i] >= this.ttl[i]) { this.ttl[i] = 0; this.size[i] = 0; this.col[i4 + 3] = 0; continue; }
      const t = this.age[i] / this.ttl[i];
      this.vel[i3 + 1] += this.gravity * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 4; k++) this.col[i4 + k] = this.c0[i4 + k] + (this.c1[i4 + k] - this.c0[i4 + k]) * t;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aColor.needsUpdate = true;
  }
}

export class VFX {
  constructor(scene) {
    this.smoke = new ParticlePool(scene, 1200, false, 0.6);   // sobe levemente
    this.fire = new ParticlePool(scene, 600, true, 0);
  }

  /** Fumaça de pneu (drift/freada) */
  emitSmoke(pos, carVel) {
    const r = () => (Math.random() - 0.5);
    this.smoke.spawn(pos,
      { x: carVel.x * 0.15 + r() * 1.5, y: 0.8 + Math.random(), z: carVel.z * 0.15 + r() * 1.5 },
      1.2 + Math.random() * 0.8, 0.8, 4.5, [0.85, 0.85, 0.85, 0.55], [0.6, 0.6, 0.6, 0]);
  }

  /** Chama de nitro (dir = vetor unitário para trás do carro) */
  emitNitro(pos, backDir, carVel) {
    const r = () => (Math.random() - 0.5);
    const sp = 10 + Math.random() * 8;
    this.fire.spawn(pos,
      { x: carVel.x * 0.5 + backDir.x * sp + r() * 2, y: r() * 1.5, z: carVel.z * 0.5 + backDir.z * sp + r() * 2 },
      0.2 + Math.random() * 0.25, 0.9, 0.15, [1, 0.75, 0.2, 1], [1, 0.15, 0, 0]);
  }

  /** pxScale = alturaDoCanvas / (2 * tan(fov/2)) */
  setScale(pxScale) { this.smoke.uniforms.uScale.value = this.fire.uniforms.uScale.value = pxScale; }

  update(dt) { this.smoke.update(dt); this.fire.update(dt); }
}
