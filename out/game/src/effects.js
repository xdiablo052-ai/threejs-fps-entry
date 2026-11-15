// Transient visuals, all pooled: tracer lines that fade in a blink, impact
// puffs of dust or sparks, and the red puff where a bullet finds a body.
// Nothing here allocates per frame — pools are sized once at start.

import * as THREE from 'three';
import { PALETTE } from './config.js';

const MAX_TRACERS = 48;
const MAX_PUFFS = 40;

export class Effects {
  constructor(scene) {
    this.tracers = [];
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.LineBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0 });
      const line = new THREE.Line(tracerGeo.clone(), mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;

    this.puffs = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
      const mat = new THREE.PointsMaterial({ color: 0xd8c491, size: 0.14, transparent: true, opacity: 0 });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      points.frustumCulled = false;
      scene.add(points);
      this.puffs.push({ points, vel: new Float32Array(8 * 3), life: 0, color: new THREE.Color() });
    }
    this.puffIdx = 0;
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    const pos = t.line.geometry.getAttribute('position');
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.07;
  }

  puff(point, colorHex, spread = 1.6, up = 1.4) {
    const p = this.puffs[this.puffIdx];
    this.puffIdx = (this.puffIdx + 1) % MAX_PUFFS;
    const pos = p.points.getAttribute('position');
    for (let i = 0; i < 8; i++) {
      pos.setXYZ(i, point.x, point.y, point.z);
      p.vel[i * 3] = (Math.random() - 0.5) * spread;
      p.vel[i * 3 + 1] = Math.random() * up;
      p.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    pos.needsUpdate = true;
    p.points.material.color.setHex(colorHex);
    p.points.visible = true;
    p.life = 0.38;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const pos = p.points.getAttribute('position');
      for (let i = 0; i < 8; i++) {
        p.vel[i * 3 + 1] -= 3.4 * dt;
        pos.setXYZ(i, pos.getX(i) + p.vel[i * 3] * dt, pos.getY(i) + p.vel[i * 3 + 1] * dt, pos.getZ(i) + p.vel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      p.points.material.opacity = Math.max(0, p.life / 0.38) * 0.9;
      if (p.life <= 0) p.points.visible = false;
    }
  }
}
