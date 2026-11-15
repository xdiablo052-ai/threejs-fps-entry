// Bot soldiers: waypoint routing to an objective, position holding, and a
// perception model — a vision cone with line-of-sight, plus hearing — that
// feeds an engage behaviour: face the target, fire bursts, strafe between
// them. A bot never knows anything it has not seen or heard.

import * as THREE from 'three';
import { Body, applyDamage } from './player.js';
import { WEAPONS, PLAYER } from './config.js';
import { findPath, nearestWaypoint, losBlocked } from './map.js';
import { resolveShot, spreadDir, lookDir } from './combat.js';

export const BOT_NAMES = {
  attackers: ['Vex', 'Onyx', 'Rook'],
  defenders: ['Hale', 'Bram', 'Sable', 'Ivo'],
};

export class Bot {
  constructor(team, name, x, z, skill) {
    this.team = team;
    this.name = name;
    this.body = new Body(x, z);
    this.skill = skill; // 0..1 — reaction time, spread and burst discipline
    this.weaponKey = 'pistol';
    this.ammo = WEAPONS.pistol.mag;
    this.state = 'route'; // route | hold | engage | plant | defuse | dead
    this.path = [];
    this.pathIdx = 0;
    this.goal = null; // waypoint id to end the route at
    this.holdYaw = 0;
    this.target = null; // enemy ref last seen
    this.lastSeenAt = -99;
    this.lastSeenPos = null;
    this.lastHeardAt = -99;
    this.lastHeardPos = null;
    this.perceiveAt = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.nextBurstAt = 0;
    this.reloadUntil = 0;
    this.strafeDir = 1;
    this.strafeFlipAt = 0;
    this.blindUntil = 0; // a flash burst sets this; perception stops until it passes
    this.mesh = buildBotMesh(team);
    this.mesh.position.set(x, 0, z);
  }

  get alive() {
    return this.body.alive;
  }

  setRoute(waypoints, toId) {
    const from = nearestWaypoint(waypoints, this.body.x, this.body.z);
    this.path = findPath(waypoints, from.id, toId);
    this.pathIdx = this.path.length > 1 ? 1 : 0;
    this.goal = toId;
    if (this.state !== 'engage') this.state = 'route';
  }

  /** world: {time, colliders, waypoints, enemies:[refs with .body], noise:[], onShoot, onKill} */
  step(dt, world) {
    const b = this.body;
    if (!b.alive) return;
    const now = world.time;
    if (now >= this.perceiveAt) {
      this.perceiveAt = now + 0.12;
      this.perceive(world);
    }
    let wishX = 0;
    let wishZ = 0;
    const seenRecently = now - this.lastSeenAt < 2.6 && this.target !== null && this.target.body.alive;

    if (this.state === 'plant' || this.state === 'defuse') {
      b.crouching = true; // hands busy; rounds.js owns the timer
    } else if (seenRecently) {
      this.state = 'engage';
      const t = this.target.body;
      const dx = t.x - b.x;
      const dz = t.z - b.z;
      b.yaw = Math.atan2(-dx, -dz);
      const dist = Math.hypot(dx, dz);
      // Strafe between bursts, close or hold range by weapon.
      if (now >= this.strafeFlipAt) {
        this.strafeFlipAt = now + 0.7 + Math.random() * 0.9;
        this.strafeDir = Math.random() > 0.5 ? 1 : -1;
      }
      const wantDist = this.weaponKey === 'shotgun' ? 7 : this.weaponKey === 'dmr' ? 22 : 13;
      const radial = dist > wantDist + 3 ? 1 : dist < wantDist - 3 ? -0.7 : 0;
      const rx = dx / (dist || 1);
      const rz = dz / (dist || 1);
      wishX = rx * radial + -rz * this.strafeDir * 0.8;
      wishZ = rz * radial + rx * this.strafeDir * 0.8;
      b.crouching = false;
      this.tryFire(now, world);
    } else {
      if (this.state === 'engage') this.state = this.path.length > 0 ? 'route' : 'hold';
      b.crouching = false;
      if (this.state === 'route' && this.pathIdx < this.path.length) {
        const node = this.path[this.pathIdx];
        const dx = node.x - b.x;
        const dz = node.z - b.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.9) {
          this.pathIdx += 1;
          if (this.pathIdx >= this.path.length) this.state = 'hold';
        } else {
          wishX = dx / dist;
          wishZ = dz / dist;
          b.yaw = Math.atan2(-dx, -dz);
        }
      } else {
        this.state = 'hold';
        // Hold the angle: slow scan around the hold facing.
        b.yaw = this.holdYaw + Math.sin(now * 0.45 + b.x) * 0.5;
        // Heard something recent? Turn to face it.
        if (now - this.lastHeardAt < 3 && this.lastHeardPos !== null) {
          b.yaw = Math.atan2(-(this.lastHeardPos.x - b.x), -(this.lastHeardPos.z - b.z));
        }
      }
    }
    const len = Math.hypot(wishX, wishZ);
    if (len > 1) { wishX /= len; wishZ /= len; }
    b.step(dt, wishX * 0.94, wishZ * 0.94, world.colliders);
    this.syncMesh(now);
  }

  perceive(world) {
    if (this.blindUntil > world.time) return; // flashed: holding still, seeing nothing
    const b = this.body;
    const eye = b.eye();
    let best = null;
    let bestDist = Infinity;
    for (const e of world.enemies) {
      if (!e.body.alive) continue;
      const dx = e.body.x - b.x;
      const dz = e.body.z - b.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 46) continue;
      const angle = Math.abs(angleDiff(Math.atan2(-dx, -dz), b.yaw));
      if (angle > 1.35 && dist > 5) continue; // vision cone, unless point blank
      const targetEyeY = e.body.y + (e.body.crouching ? 0.85 : 1.35);
      if (losBlocked(world.colliders, eye.x, eye.y, eye.z, e.body.x, targetEyeY, e.body.z)) continue;
      if (dist < bestDist) { bestDist = dist; best = e; }
    }
    if (best !== null) {
      this.target = best;
      this.lastSeenAt = world.time;
      this.lastSeenPos = { x: best.body.x, z: best.body.z };
    }
    for (const n of world.noise) {
      if (world.time - n.at < 0.2 && Math.hypot(n.x - b.x, n.z - b.z) < n.radius) {
        this.lastHeardAt = world.time;
        this.lastHeardPos = { x: n.x, z: n.z };
      }
    }
  }

  tryFire(now, world) {
    if (now < this.reloadUntil) return;
    const spec = WEAPONS[this.weaponKey];
    if (this.ammo <= 0) {
      this.ammo = spec.mag;
      this.reloadUntil = now + spec.reloadMs / 1000;
      return;
    }
    if (this.burstLeft <= 0) {
      if (now < this.nextBurstAt) return;
      this.burstLeft = spec.auto ? 3 + Math.floor(Math.random() * 3) : 1;
    }
    if (now < this.nextShotAt) return;
    this.nextShotAt = now + 60 / spec.rpm;
    this.burstLeft -= 1;
    this.ammo -= 1;
    if (this.burstLeft <= 0) this.nextBurstAt = now + 0.45 + (1 - this.skill) * 0.7 + Math.random() * 0.4;

    const b = this.body;
    const t = this.target.body;
    const reaction = 1 - this.skill * 0.55;
    const aimErr = (0.028 + (1 - this.skill) * 0.05) * reaction;
    const eye = b.eye();
    const targetPos = { x: t.x, y: t.y + 1.05, z: t.z };
    const dir0 = norm(targetPos.x - eye.x, targetPos.y - eye.y, targetPos.z - eye.z);
    const yaw = Math.atan2(-dir0.x, -dir0.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir0.y)));
    const targets = world.enemies.map((e) => ({ body: e.body, ref: e }));
    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      const dir = spreadDir(yaw, pitch, spec.spread + aimErr + (t.speedNow > 1 ? 0.02 : 0), Math.random);
      const hit = resolveShot(eye, dir, world.colliders, targets);
      world.onBotShot?.(this, eye, hit);
      if (hit.kind === 'hit') {
        const mult = hit.part === 'head' ? spec.headMult : hit.part === 'legs' ? spec.limbMult : 1;
        const falloff = hit.dist > 24 ? Math.max(0.55, 1 - (hit.dist - 24) * 0.012) : 1;
        const dmg = spec.damage * mult * falloff;
        const before = hit.ref.body.health;
        applyDamage(hit.ref.body, dmg);
        if (before > 0 && hit.ref.body.health <= 0) world.onKill?.(this, hit.ref, hit.part);
        break; // one pellet's kill ends the burst's bookkeeping
      }
    }
    world.noise.push({ x: b.x, z: b.z, at: now, radius: 30 });
  }

  syncMesh(now) {
    const b = this.body;
    this.mesh.position.set(b.x, b.y, b.z);
    this.mesh.rotation.y = b.yaw + Math.PI; // the mesh's gun sits on +Z; face it along the look direction
    const moving = b.speedNow > 0.4;
    const bob = moving ? Math.sin(now * 9 + b.x) * 0.05 : 0;
    this.mesh.children[0].position.y = bob;
    if (!b.alive) {
      this.mesh.rotation.z = Math.PI / 2.2;
      this.mesh.position.y = 0.25;
    }
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

/** A low-poly soldier from boxes: legs, torso in team colours, head, gun. */
export function buildBotMesh(team) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const suit = new THREE.MeshStandardMaterial({ color: team === 'attackers' ? 0xd8622d : 0x3f7fbf, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 });
  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    inner.add(m);
    return m;
  };
  add(0.17, 0.78, 0.2, -0.13, 0.39, 0, dark); // legs
  add(0.17, 0.78, 0.2, 0.13, 0.39, 0, dark);
  add(0.52, 0.62, 0.28, 0, 1.09, 0, suit); // torso
  add(0.14, 0.5, 0.16, -0.34, 1.12, 0.05, suit); // arms
  add(0.14, 0.5, 0.16, 0.34, 1.12, 0.05, suit);
  add(0.24, 0.26, 0.24, 0, 1.56, 0, skin); // head
  add(0.26, 0.1, 0.26, 0, 1.72, 0, dark); // cap
  add(0.09, 0.09, 0.72, 0.2, 1.18, 0.42, dark); // gun, pointing +Z of the mesh
  return group;
}
