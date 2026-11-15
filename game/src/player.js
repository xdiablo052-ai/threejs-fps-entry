// The player body: CS-style ground movement — acceleration and friction, so
// speed is earned and shed, never instant — resolved against the map's boxes
// one axis at a time, which is what makes sliding along walls feel right.

import { PLAYER } from './config.js';

export class Body {
  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.y = 0; // feet height (the yard is flat; jumps only)
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.crouching = false;
    this.grounded = true;
    this.health = PLAYER.health;
    this.armor = false;
    this.alive = true;
  }

  get eyeHeight() {
    return this.crouching ? PLAYER.crouchHeight : PLAYER.standHeight;
  }

  get speedNow() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Wish-direction acceleration with friction, one fixed step. */
  step(dt, wishX, wishZ, colliders) {
    const maxSpeed = this.crouching ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
    if (this.grounded) {
      const speed = this.speedNow;
      if (speed > 0) {
        const drop = speed * PLAYER.friction * dt;
        const keep = Math.max(0, speed - drop) / speed;
        this.vx *= keep;
        this.vz *= keep;
      }
      const wishLen = Math.hypot(wishX, wishZ);
      if (wishLen > 0.001) {
        const wx = (wishX / wishLen) * maxSpeed;
        const wz = (wishZ / wishLen) * maxSpeed;
        const current = this.vx * (wx / maxSpeed) + this.vz * (wz / maxSpeed);
        const add = Math.min(PLAYER.accel * maxSpeed * dt, maxSpeed - current);
        if (add > 0) {
          this.vx += (wx / maxSpeed) * add;
          this.vz += (wz / maxSpeed) * add;
        }
      }
    }
    this.vy -= PLAYER.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.moveAxis(this.vx * dt, 0, colliders);
    this.moveAxis(0, this.vz * dt, colliders);
  }

  jump() {
    if (this.grounded && !this.crouching) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
    }
  }

  moveAxis(dx, dz, colliders) {
    this.x += dx;
    this.z += dz;
    const r = PLAYER.radius;
    for (const c of colliders) {
      if (c.h <= this.y + 0.3) continue; // stepping over low cover feet-first
      if (this.x > c.x0 - r && this.x < c.x1 + r && this.z > c.z0 - r && this.z < c.z1 + r) {
        if (dx !== 0) this.x = dx > 0 ? c.x0 - r : c.x1 + r;
        if (dz !== 0) this.z = dz > 0 ? c.z0 - r : c.z1 + r;
      }
    }
    this.x = Math.max(-31.4, Math.min(31.4, this.x));
    this.z = Math.max(-31.4, Math.min(31.4, this.z));
  }

  eye() {
    return { x: this.x, y: this.y + this.eyeHeight, z: this.z };
  }
}

/** Damage with the vest rule: armour halves chest damage while it lasts. */
export function applyDamage(body, amount) {
  let dmg = amount;
  if (body.armor) dmg *= 0.55;
  body.health -= dmg;
  if (body.health <= 0) {
    body.health = 0;
    body.alive = false;
  }
  return dmg;
}
