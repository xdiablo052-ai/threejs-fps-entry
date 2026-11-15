// The player's hands: a loadout of owned weapons with per-gun ammunition,
// a viewmodel built from boxes, and the firing model — spread that blooms
// with movement, airtime and sustained fire, recoil that kicks the view up,
// and damage that falls off past 24 metres. Stopping to aim pays; spraying
// on the run does not.

import * as THREE from 'three';
import { WEAPONS, GRENADES } from './config.js';
import { resolveShot, spreadDir, lookDir } from './combat.js';
import { losBlocked } from './map.js';
import { applyDamage } from './player.js';

export class Loadout {
  constructor() {
    this.owned = ['pistol'];
    this.current = 'pistol';
    this.ammo = {};
    for (const key of Object.keys(WEAPONS)) {
      this.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    }
    this.grenades = { frag: 0, flash: 0 };
    this.armor = false;
    this.previous = 'pistol';
  }

  get spec() {
    return WEAPONS[this.current];
  }

  get magAmmo() {
    return this.ammo[this.current];
  }

  give(key) {
    if (!this.owned.includes(key)) this.owned.push(key);
    this.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
  }

  select(key) {
    if (this.owned.includes(key) && key !== this.current) {
      this.previous = this.current;
      this.current = key;
      return true;
    }
    return false;
  }

  /** New round: magazines refill, reserves top back up, owned guns stay. */
  refill() {
    for (const key of this.owned) {
      this.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    }
  }
}

const VIEW_STYLES = {
  pistol: { len: 0.34, body: 0x3a3f45, accent: 0xd8622d, thick: 0.055 },
  smg: { len: 0.54, body: 0x33383e, accent: 0x3f9db8, thick: 0.07 },
  shotgun: { len: 0.8, body: 0x54432e, accent: 0x9c4a2f, thick: 0.085 },
  rifle: { len: 0.72, body: 0x2f3338, accent: 0xe08a3c, thick: 0.065 },
  dmr: { len: 0.95, body: 0x3d3a33, accent: 0x8a9b6e, thick: 0.06 },
};

/** The gun in the player's view: receiver, barrel, magazine, accent stripe. */
export class ViewModel {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.position.set(0.24, -0.22, -0.45);
    camera.add(this.group);
    this.flash = null;
    this.flashUntil = 0;
    this.recoil = 0;
    this.reloadDip = 0;
    this.build('pistol');
  }

  build(key) {
    while (this.group.children.length > 0) this.group.remove(this.group.children[0]);
    const st = VIEW_STYLES[key];
    const body = new THREE.MeshStandardMaterial({ color: st.body, roughness: 0.55, metalness: 0.45 });
    const accent = new THREE.MeshStandardMaterial({ color: st.accent, roughness: 0.6, metalness: 0.2 });
    const add = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };
    add(st.thick, st.thick * 1.5, st.len, 0, 0, -st.len / 2 + 0.1, body); // receiver + barrel
    add(st.thick * 0.7, 0.16, 0.09, 0, -0.11, -0.05, body); // magazine
    add(st.thick * 0.8, 0.05, st.len * 0.5, 0, st.thick * 1.05, -st.len / 2 + 0.08, accent); // top stripe
    add(0.03, 0.07, 0.03, 0, st.thick * 1.4, -st.len + 0.1, body); // front post
    if (key === 'dmr') add(0.05, 0.06, 0.18, 0, st.thick * 1.8, -0.2, body); // scope
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.95 });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
    this.flash.position.set(0, 0.02, -st.len - 0.05);
    this.flash.visible = false;
    this.group.add(this.flash);
    this.muzzleLocal = new THREE.Vector3(0, 0.02, -st.len - 0.05);
  }

  muzzleWorld(out) {
    return this.group.localToWorld(out.copy(this.muzzleLocal));
  }

  update(dt, now, reloading) {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.reloadDip = reloading ? Math.min(1, this.reloadDip + dt * 5) : Math.max(0, this.reloadDip - dt * 5);
    this.group.position.z = -0.45 + this.recoil * 0.09;
    this.group.position.y = -0.22 - this.reloadDip * 0.16;
    this.group.rotation.x = this.reloadDip * 0.7 - this.recoil * 0.12;
    if (this.flash !== null) this.flash.visible = now < this.flashUntil;
  }
}

/**
 * The firing brain for the player. `env` supplies the world: colliders,
 * enemy target list, effects, sound, and callbacks for hits and kills.
 */
export class Gunner {
  constructor(loadout, viewModel) {
    this.loadout = loadout;
    this.view = viewModel;
    this.nextShotAt = 0;
    this.reloadingUntil = 0;
    this.bloom = 0; // sustained-fire spread, decays between shots
    this.triggerWasDown = false;
  }

  get reloading() {
    return performance.now() / 1000 < this.reloadingUntil;
  }

  startReload(now, sound) {
    const ammo = this.loadout.magAmmo;
    const spec = this.loadout.spec;
    if (this.reloading || ammo.mag >= spec.mag || ammo.reserve <= 0) return;
    this.reloadingUntil = now + spec.reloadMs / 1000;
    sound.reload();
  }

  finishReloadIfDue(now) {
    if (this.reloadingUntil > 0 && now >= this.reloadingUntil) {
      const ammo = this.loadout.magAmmo;
      const spec = this.loadout.spec;
      const take = Math.min(spec.mag - ammo.mag, ammo.reserve);
      ammo.mag += take;
      ammo.reserve -= take;
      this.reloadingUntil = 0;
    }
  }

  /** Returns true when a shot actually left the barrel. */
  tryFire(now, shooter, firing, env) {
    this.finishReloadIfDue(now);
    const spec = this.loadout.spec;
    const ammo = this.loadout.magAmmo;
    const edge = firing && !this.triggerWasDown;
    this.triggerWasDown = firing;
    if (!firing) {
      this.bloom = Math.max(0, this.bloom - 0.004);
      return false;
    }
    if (this.reloading || now < this.nextShotAt) return false;
    if (!spec.auto && !edge) return false;
    if (ammo.mag <= 0) {
      this.nextShotAt = now + 0.3;
      this.startReload(now, env.sound);
      return false;
    }
    ammo.mag -= 1;
    this.nextShotAt = now + 60 / spec.rpm;
    this.bloom = Math.min(0.045, this.bloom + spec.kick * 2.2);

    const eye = shooter.eye();
    const movePenalty = shooter.speedNow * spec.moveSpread * 0.22;
    const airPenalty = shooter.grounded ? 0 : 0.05;
    const crouchBonus = shooter.crouching ? 0.55 : 1;
    const spread = (spec.spread + this.bloom + movePenalty + airPenalty) * crouchBonus;
    const targets = env.enemies.map((e) => ({ body: e.body, ref: e }));
    const muzzle = this.view.muzzleWorld(new THREE.Vector3());
    this.view.flashUntil = now + 0.045;
    this.view.recoil = 1;
    env.sound.shot(this.loadout.current === 'shotgun' ? 'shotgun' : this.loadout.current === 'dmr' ? 'dmr' : this.loadout.current === 'pistol' ? 'pistol' : 'rifle');
    env.noise.push({ x: shooter.x, z: shooter.z, at: now, radius: 34 });

    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      const dir = spreadDir(shooter.yaw, shooter.pitch, spread, Math.random);
      const hit = resolveShot(eye, dir, env.colliders, targets);
      env.effects.tracer(muzzle, hit.point);
      if (hit.kind === 'hit') {
        const mult = hit.part === 'head' ? spec.headMult : hit.part === 'legs' ? spec.limbMult : 1;
        const falloff = hit.dist > 24 ? Math.max(0.55, 1 - (hit.dist - 24) * 0.012) : 1;
        const before = hit.ref.body.health;
        applyDamage(hit.ref.body, spec.damage * mult * falloff);
        env.effects.puff(hit.point, 0xa33327, 1.2, 0.8);
        env.onHit?.(hit.part === 'head');
        if (before > 0 && hit.ref.body.health <= 0) env.onKill?.(hit.ref, hit.part);
      } else if (hit.kind === 'wall') {
        env.effects.puff(hit.point, 0xcbb27a, 1.4, 1.1);
      }
    }
    // Recoil: the view climbs; a good player pulls it back down.
    shooter.pitch = Math.min(1.45, shooter.pitch + spec.kick * (0.7 + Math.random() * 0.6));
    shooter.yaw += (Math.random() - 0.5) * spec.kick * 0.5;
    if (ammo.mag === 0) this.startReload(now, env.sound);
    return true;
  }
}

/** Thrown grenades: a frag with area damage, a flash that blinds. */
export class Grenades {
  constructor(scene) {
    this.live = [];
    this.meshGeo = new THREE.SphereGeometry(0.09, 10, 8);
    this.fragMat = new THREE.MeshStandardMaterial({ color: 0x44502e, roughness: 0.6 });
    this.flashMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.4, metalness: 0.5 });
    this.scene = scene;
  }

  throw(kind, from, dir) {
    const mesh = new THREE.Mesh(this.meshGeo, kind === 'frag' ? this.fragMat : this.flashMat);
    mesh.position.set(from.x, from.y, from.z);
    this.scene.add(mesh);
    this.live.push({
      kind, mesh,
      vx: dir.x * 15, vy: dir.y * 15 + 2.5, vz: dir.z * 15,
      fuse: 1.5,
    });
  }

  update(dt, env) {
    const still = [];
    for (const g of this.live) {
      g.fuse -= dt;
      g.vy -= 11.5 * dt;
      g.mesh.position.x += g.vx * dt;
      g.mesh.position.y += g.vy * dt;
      g.mesh.position.z += g.vz * dt;
      const p = g.mesh.position;
      if (p.y < 0.09) {
        p.y = 0.09;
        g.vy = Math.abs(g.vy) > 1.5 ? -g.vy * 0.42 : 0;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      for (const c of env.colliders) {
        if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1 && p.y < c.h) {
          p.x -= g.vx * dt;
          p.z -= g.vz * dt;
          g.vx *= -0.4;
          g.vz *= -0.4;
        }
      }
      if (g.fuse <= 0) {
        this.detonate(g, env);
        this.scene.remove(g.mesh);
      } else {
        still.push(g);
      }
    }
    this.live = still;
  }

  detonate(g, env) {
    const p = g.mesh.position;
    const spec = GRENADES[g.kind];
    if (g.kind === 'frag') {
      env.sound.explosion();
      env.effects.puff({ x: p.x, y: p.y + 0.3, z: p.z }, 0xe08a3c, 5, 4);
      env.effects.puff({ x: p.x, y: p.y + 0.3, z: p.z }, 0x55483a, 3.4, 3);
      env.shake?.(Math.max(0, 1 - Math.hypot(env.playerPos.x - p.x, env.playerPos.z - p.z) / 16));
      for (const t of env.allBodies) {
        const d = Math.hypot(t.body.x - p.x, t.body.z - p.z);
        if (d > spec.radius || !t.body.alive) continue;
        if (losBlocked(env.colliders, p.x, 1, p.z, t.body.x, 1, t.body.z)) continue;
        const before = t.body.health;
        applyDamage(t.body, spec.damage * (1 - d / (spec.radius + 1.5)));
        if (before > 0 && t.body.health <= 0) env.onGrenadeKill?.(t);
      }
    } else {
      env.sound.tone?.(2400, 200, 0.1, 'sine');
      env.effects.puff({ x: p.x, y: p.y + 0.4, z: p.z }, 0xffffff, 2, 2);
      for (const t of env.allBodies) {
        if (!t.body.alive) continue;
        const d = Math.hypot(t.body.x - p.x, t.body.z - p.z);
        if (d > 20) continue;
        if (losBlocked(env.colliders, p.x, 1.2, p.z, t.body.x, 1.4, t.body.z)) continue;
        // Blinded if the burst is in front of them (the thrower included).
        const facing = lookDir(t.body.yaw, 0);
        const toBurst = { x: (p.x - t.body.x) / (d || 1), z: (p.z - t.body.z) / (d || 1) };
        if (facing.x * toBurst.x + facing.z * toBurst.z > -0.2 || d < 2.5) {
          t.blindUntil = Math.max(t.blindUntil ?? 0, env.now + spec.durationMs / 1000 * (d < 7 ? 1 : 0.55));
        }
      }
    }
  }
}
