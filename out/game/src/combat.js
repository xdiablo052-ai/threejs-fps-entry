// Hitscan resolution shared by the player's weapons and the bots' guns:
// a ray is tested against the map's boxes and against each target body,
// modelled as three spheres (head, chest, legs), and the nearest hit wins.
// Head hits are what make aim matter: the head sphere is small and high.

import { rayHitDistance } from './map.js';

const PARTS = [
  { part: 'head', dy: 1.52, r: 0.23 },
  { part: 'chest', dy: 0.98, r: 0.44 },
  { part: 'legs', dy: 0.42, r: 0.4 },
];

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return null;
  return tca - Math.sqrt(r2 - d2);
}

/**
 * Resolve one shot. `targets` are {body, ref} pairs; returns
 * {kind:'hit', ref, part, dist, point} or {kind:'wall', dist, point} or
 * {kind:'none', dist}.
 */
export function resolveShot(origin, dir, colliders, targets, maxDist = 120) {
  const wallDist = rayHitDistance(colliders, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);
  let best = null;
  for (const t of targets) {
    if (!t.body.alive) continue;
    for (const p of PARTS) {
      const d = raySphere(
        origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        t.body.x, t.body.y + p.dy * (t.body.crouching ? 0.72 : 1), t.body.z, p.r,
      );
      if (d !== null && d < wallDist && (best === null || d < best.dist)) {
        best = { kind: 'hit', ref: t.ref, part: p.part, dist: d };
      }
    }
  }
  const dist = best !== null ? best.dist : wallDist;
  const point = {
    x: origin.x + dir.x * dist,
    y: origin.y + dir.y * dist,
    z: origin.z + dir.z * dist,
  };
  if (best !== null) return { ...best, point };
  if (wallDist < maxDist) return { kind: 'wall', dist: wallDist, point };
  return { kind: 'none', dist: maxDist, point };
}

/** A direction vector with a random cone spread applied (radians). */
export function spreadDir(yaw, pitch, spread, rng) {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  const p = pitch + Math.cos(a) * r;
  const y = yaw + Math.sin(a) * r;
  return {
    x: -Math.sin(y) * Math.cos(p),
    y: Math.sin(p),
    z: -Math.cos(y) * Math.cos(p),
  };
}

/** Facing direction from yaw/pitch alone. */
export function lookDir(yaw, pitch) {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}
