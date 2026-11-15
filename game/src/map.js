// KESTREL YARD — the map: a dusk freight depot with two plant sites.
// Geometry, colliders, the waypoint graph the bots walk, and the spawns all
// come from the one layout table below, so what the player sees, what bullets
// hit and where bots path can never disagree.

import * as THREE from 'three';
import { PALETTE } from './config.js';

// Every solid is an axis-aligned box: [centreX, centreZ, width, depth, height, material]
const SOLIDS = [
  // Perimeter walls
  [0, -32.5, 66, 1, 4.5, 'concreteDark'], [0, 32.5, 66, 1, 4.5, 'concreteDark'],
  [-32.5, 0, 1, 66, 4.5, 'concreteDark'], [32.5, 0, 1, 66, 4.5, 'concreteDark'],
  // Site A — container stacks and the crane frame (NW)
  [-24, -24, 6, 2.6, 2.6, 'rust'], [-24, -24, 6, 2.6, 5.2, 'teal'], [-16.5, -26, 2.6, 6, 2.6, 'teal'],
  [-14, -17, 6, 2.6, 2.6, 'sand'], [-25, -14.5, 2.6, 5, 2.6, 'rust'],
  // Long A corridor cover (west edge)
  [-28, 4, 2.6, 6, 2.6, 'teal'], [-27, -8, 5, 2.4, 1.3, 'crateWood'], [-20, 10, 2.4, 2.4, 1.3, 'crateWood'],
  // Mid — the weighbridge house: two blocks with a passage between and around
  [-4, -6, 7, 8, 4.2, 'concrete'], [5.5, -6, 4, 8, 4.2, 'concrete'], [-4, 3.5, 7, 3, 3.2, 'concrete'],
  [1.5, -13, 2.4, 2.4, 1.3, 'crateWood'], [-11, -2, 2.4, 5, 2.6, 'rust'],
  // Attacker-side mid cover
  [-13, 16, 5, 2.4, 1.3, 'crateWood'], [-6, 22, 2.6, 6, 2.6, 'teal'],
  // East sheds between mid and B
  [14, -2, 6, 4, 3.4, 'concrete'], [22, -10, 2.4, 2.4, 1.3, 'crateWood'], [16, 6, 2.4, 5, 2.6, 'sand'],
  // Site B — the warehouse (SE): walls with a west door and a north door
  [12, 11.5, 19, 1, 5, 'concrete'], // north wall west of the door
  [26.5, 11.5, 6, 1, 5, 'concrete'], // north wall east of the door
  [30.5, 21, 1, 20, 5, 'concrete'], // east wall
  [21, 30.5, 20, 1, 5, 'concrete'], // south wall
  [11.5, 15, 1, 8, 5, 'concrete'], // west wall north of the door
  [11.5, 26.5, 1, 9, 5, 'concrete'], // west wall south of the door
  // Warehouse interior: racking and crates
  [21, 21, 6, 2, 3, 'metal'], [17, 26, 2.4, 2.4, 1.3, 'crateWood'], [26, 16.5, 2.4, 4, 2.6, 'teal'],
  [24.5, 25, 2.4, 2.4, 1.3, 'crateWood'],
  // B lane cover (south-centre approach)
  [4, 24, 2.6, 6, 2.6, 'rust'], [-2, 18, 2.4, 2.4, 1.3, 'crateWood'],
];

// Waypoint graph: bots walk edges; `site` marks plant/hold points.
const WAYPOINTS = [
  ['atk_spawn', -25, 25], ['a_long_1', -27, 8], ['a_long_2', -25, -6], ['a_entry', -20, -13],
  ['site_a', -19.5, -20.5], ['mid_1', -13, 13], ['mid_2', -5, 6], ['mid_house', 0.5, -6],
  ['mid_3', 7, -4], ['mid_cross', 11, -13], ['b_lane_1', 6, 21], ['b_door_w', 9.5, 20.5],
  ['site_b', 21, 21], ['b_door_n', 21, 9.5], ['def_spawn', 25, -25], ['a_hold', -13, -24],
  ['b_hold', 15, 4], ['top_lane', 18, -20], ['a_short', -8, -18],
];
const EDGES = [
  ['atk_spawn', 'a_long_1'], ['atk_spawn', 'mid_1'], ['atk_spawn', 'b_lane_1'],
  ['a_long_1', 'a_long_2'], ['a_long_2', 'a_entry'], ['a_entry', 'site_a'], ['a_entry', 'a_short'],
  ['a_short', 'site_a'], ['a_short', 'mid_house'], ['mid_1', 'mid_2'], ['mid_2', 'mid_house'],
  ['mid_house', 'mid_3'], ['mid_3', 'mid_cross'], ['mid_3', 'b_hold'], ['mid_cross', 'top_lane'],
  ['top_lane', 'def_spawn'], ['top_lane', 'a_hold'], ['a_hold', 'site_a'], ['def_spawn', 'b_hold'],
  ['b_hold', 'b_door_n'], ['b_door_n', 'site_b'], ['b_lane_1', 'b_door_w'], ['b_door_w', 'site_b'],
  ['mid_2', 'b_lane_1'], ['mid_cross', 'a_hold'],
];

export const SITES = {
  A: { x: -19.5, z: -20.5, r: 5.5, color: PALETTE.siteA },
  B: { x: 21, z: 21, r: 6, color: PALETTE.siteB },
};

export const SPAWNS = {
  attackers: [[-25, 25], [-27, 22], [-22, 27], [-27, 27.5]],
  defenders: [[25, -25], [22, -27], [27, -22], [20, -24]],
};

/** A shipping container's skin: corrugation ribs, a stencilled fleet label
 *  and grime along the bottom edge, drawn once onto a canvas. */
function containerTexture(baseHex, label) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  const base = `#${baseHex.toString(16).padStart(6, '0')}`;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 32) {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x, 0, 7, 256);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(x + 16, 0, 9, 256);
  }
  g.fillStyle = 'rgba(0,0,0,0.20)';
  g.fillRect(0, 226, 512, 30);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,235,200,0.05)';
    g.fillRect(Math.random() * 512, Math.random() * 256, 3, 3);
  }
  g.fillStyle = 'rgba(255,246,224,0.82)';
  g.font = 'bold 44px system-ui, sans-serif';
  g.fillText(label, 28, 66);
  g.font = 'bold 25px system-ui, sans-serif';
  g.fillText('MAX 30480 KG', 28, 108);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Stacked timber planks for the crates. */
function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a97c50';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 52) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, y, 256, 4);
    g.fillStyle = 'rgba(255,230,190,0.07)';
    g.fillRect(0, y + 4, 256, 8);
  }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = 'rgba(60,35,10,0.10)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 6, 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildMap(scene) {
  const colliders = SOLIDS.map(([x, z, w, d, h]) => ({
    x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h,
  }));

  const materials = {};
  for (const key of ['concrete', 'concreteDark', 'metal']) {
    materials[key] = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness: 0.92, metalness: 0.04 });
  }
  materials.rust = new THREE.MeshStandardMaterial({ map: containerTexture(PALETTE.rust, 'KESTREL LINE 42'), roughness: 0.85, metalness: 0.08 });
  materials.teal = new THREE.MeshStandardMaterial({ map: containerTexture(PALETTE.teal, 'KESTREL LINE 17'), roughness: 0.85, metalness: 0.08 });
  materials.sand = new THREE.MeshStandardMaterial({ map: containerTexture(PALETTE.sand, 'YARD FREIGHT 08'), roughness: 0.88, metalness: 0.05 });
  materials.crateWood = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.95 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x2b2118 });
  for (const [x, z, w, d, h, mat] of SOLIDS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), edgeMat);
    edges.position.copy(mesh.position);
    scene.add(edges);
  }

  // The crane over site A: four legs and a beam (visual only, high above play).
  const craneMat = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.7, metalness: 0.35 });
  for (const [lx, lz] of [[-26, -27], [-13, -27], [-26, -14], [-13, -14]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11, 0.5), craneMat);
    leg.position.set(lx, 5.5, lz);
    scene.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(15, 0.8, 1.2), craneMat);
  beam.position.set(-19.5, 11, -27);
  scene.add(beam);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(15, 0.8, 1.2), craneMat);
  beam2.position.set(-19.5, 11, -14);
  scene.add(beam2);

  // A container hanging from the crane over site A, cables taut.
  const hang = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.6), materials.rust);
  hang.position.set(-19.5, 7.6, -20.5);
  hang.rotation.y = 0.06;
  hang.castShadow = true;
  scene.add(hang);
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x1c1a16 });
  for (const cx of [-21.8, -17.2]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5), cableMat);
    cable.position.set(cx, 10, -20.5);
    scene.add(cable);
  }

  // Yard dressing: drum clusters tucked against the solids, floodlight
  // poles over both sites and mid, and the port skyline beyond the walls.
  const drumGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.92, 12);
  const drumMats = [materials.rust, materials.teal, new THREE.MeshStandardMaterial({ color: 0x596066, roughness: 0.8, metalness: 0.3 })];
  const drumSpots = [
    [-10.2, -5.4], [-9.5, -4.6], [-10.6, -4.4], [17.5, 9.3], [18.2, 9.6],
    [13.2, 28.6], [13.9, 28.2], [-25.5, 11.8], [8.6, -11.5], [9.3, -11.1],
  ];
  drumSpots.forEach(([x, z], i) => {
    const drum = new THREE.Mesh(drumGeo, drumMats[i % drumMats.length]);
    drum.position.set(x, 0.46, z);
    drum.castShadow = true;
    scene.add(drum);
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const [x, z] of [[-26.5, -13], [12.2, 12.2], [-1, 8.5]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 8), poleMat);
    pole.position.set(x, 3.2, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), lampMat);
    head.position.set(x, 6.45, z);
    scene.add(head);
  }
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x27334a });
  const skyline = [[-48, -30, 14, 22], [-44, 8, 10, 15], [-40, 38, 16, 26], [0, -50, 22, 17], [38, -44, 12, 24], [50, -6, 15, 19], [46, 30, 11, 28], [8, 50, 24, 14], [-20, 48, 13, 21]];
  for (const [x, z, w, h] of skyline) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skylineMat);
    tower.position.set(x, h / 2, z);
    scene.add(tower);
  }

  // Ground: asphalt canvas with painted lane lines and the two site rings.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 66), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Site rings in 3D, so the plant zones read from across the yard.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
  }

  const waypoints = new Map();
  for (const [id, x, z] of WAYPOINTS) waypoints.set(id, { id, x, z, edges: [] });
  for (const [a, b] of EDGES) {
    waypoints.get(a).edges.push(b);
    waypoints.get(b).edges.push(a);
  }
  return { colliders, waypoints };
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#77694f';
  g.fillRect(0, 0, 1024, 1024);
  // Asphalt noise
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,240,210,0.05)';
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2.5, 2.5);
  }
  const toPx = (v) => ((v + 33) / 66) * 1024;
  // Painted lane lines
  g.strokeStyle = 'rgba(216,196,145,0.5)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath();
  g.moveTo(toPx(-27), toPx(28)); g.lineTo(toPx(-27), toPx(-14));
  g.moveTo(toPx(-25), toPx(25)); g.lineTo(toPx(8), toPx(20));
  g.moveTo(toPx(0), toPx(10)); g.lineTo(toPx(0), toPx(-16));
  g.stroke();
  g.setLineDash([]);
  // Site letters
  for (const [site, letter] of [[SITES.A, 'A'], [SITES.B, 'B']]) {
    g.fillStyle = site === SITES.A ? 'rgba(224,138,60,0.85)' : 'rgba(63,157,184,0.85)';
    g.font = 'bold 90px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(letter, toPx(site.x), toPx(site.z) + 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Shortest waypoint path (BFS) from `from` to `to`, as a list of nodes. */
export function findPath(waypoints, from, to) {
  if (from === to) return [waypoints.get(to)];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const next of waypoints.get(cur).edges) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!prev.has(to)) return [];
  const path = [];
  for (let cur = to; cur !== null; cur = prev.get(cur)) path.unshift(waypoints.get(cur));
  return path;
}

/** The waypoint nearest a world position. */
export function nearestWaypoint(waypoints, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const node of waypoints.values()) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestD) { bestD = d; best = node; }
  }
  return best;
}

/** Does the segment (x1,z1)-(x2,z2) stay below the top of every box it crosses? */
export function losBlocked(colliders, x1, y1, z1, x2, y2, z2) {
  for (const c of colliders) {
    if (segmentHitsBox(x1, z1, x2, z2, c)) {
      // The shot passes over the box if both ends are above it; a shot that
      // starts and ends below the top and crosses the footprint is blocked.
      const t = boxEntryT(x1, z1, x2, z2, c);
      if (t !== null) {
        const y = y1 + (y2 - y1) * t;
        if (y < c.h) return true;
      }
    }
  }
  return false;
}

function segmentHitsBox(x1, z1, x2, z2, c) {
  return boxEntryT(x1, z1, x2, z2, c) !== null;
}

function boxEntryT(x1, z1, x2, z2, c) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < c.x0 || x1 > c.x1) return null;
  } else {
    let ta = (c.x0 - x1) / dx;
    let tb = (c.x1 - x1) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z1 < c.z0 || z1 > c.z1) return null;
  } else {
    let ta = (c.z0 - z1) / dz;
    let tb = (c.z1 - z1) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Ray vs the map boxes: returns the distance to the first hit, or Infinity. */
export function rayHitDistance(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const c of colliders) {
    const t = rayBoxT(ox, oy, oz, dx, dy, dz, c);
    if (t !== null && t < best) best = t;
  }
  if (oy > 0 && dy < 0) {
    const t = -oy / dy;
    if (t < best) best = t;
  }
  return best;
}

function rayBoxT(ox, oy, oz, dx, dy, dz, c) {
  let t0 = 0;
  let t1 = Infinity;
  const axes = [
    [ox, dx, c.x0, c.x1],
    [oy, dy, 0, c.h],
    [oz, dz, c.z0, c.z1],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  return t0;
}
