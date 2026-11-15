// KESTREL YARD — shared tuning: weapons, economy, rounds, palette.
// Everything the simulation balances on lives here, in one place.

// Damage is per bullet to the chest; the head multiplier and the limb
// multiplier are applied by the hit test. `spread` is the base cone in
// radians for a stationary, grounded shooter; moving, airborne and sustained
// fire all widen it (see weapons.js), so stopping to aim pays.
export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, damage: 34, headMult: 3.4, limbMult: 0.75,
    rpm: 320, auto: false, mag: 12, reserve: 48, reloadMs: 1400,
    spread: 0.011, moveSpread: 0.055, kick: 0.0035, pellets: 1, zoom: 1,
  },
  smg: {
    name: 'Raptor-9', price: 1200, damage: 26, headMult: 3.2, limbMult: 0.75,
    rpm: 780, auto: true, mag: 30, reserve: 120, reloadMs: 2100,
    spread: 0.017, moveSpread: 0.06, kick: 0.0028, pellets: 1, zoom: 1,
  },
  shotgun: {
    name: 'Breach-12', price: 1100, damage: 13, headMult: 2.2, limbMult: 0.8,
    rpm: 68, auto: false, mag: 6, reserve: 24, reloadMs: 2900,
    spread: 0.052, moveSpread: 0.075, kick: 0.011, pellets: 8, zoom: 1,
  },
  rifle: {
    name: 'VK-7 Rifle', price: 2700, damage: 40, headMult: 4, limbMult: 0.7,
    rpm: 600, auto: true, mag: 30, reserve: 90, reloadMs: 2400,
    spread: 0.008, moveSpread: 0.075, kick: 0.0042, pellets: 1, zoom: 1,
  },
  dmr: {
    name: 'Longbow DMR', price: 3200, damage: 88, headMult: 3, limbMult: 0.85,
    rpm: 52, auto: false, mag: 5, reserve: 20, reloadMs: 2600,
    spread: 0.0015, moveSpread: 0.09, kick: 0.012, pellets: 1, zoom: 3.2,
  },
};

export const GRENADES = {
  frag: { name: 'Frag Charge', price: 300, damage: 92, radius: 6.5 },
  flash: { name: 'Blind Pepper', price: 200, durationMs: 2200 },
};

export const ARMOR_PRICE = 650;

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 9000,
  killReward: 300,
  plantReward: 300,
  winReward: 2700,
  loseReward: 1900,
};

export const MATCH = {
  teamSize: 4, // per side, the player included on the attacking side
  roundsToWin: 5,
  freezeSec: 8,
  roundSec: 100,
  bombSec: 35,
  plantSec: 3.2,
  defuseSec: 5,
  endSec: 4.5,
};

export const PLAYER = {
  health: 100,
  walkSpeed: 4.7,
  crouchSpeed: 2.2,
  accel: 52,
  friction: 9.5,
  jumpSpeed: 4.4,
  gravity: 11.5,
  radius: 0.42,
  standHeight: 1.66, // eye height
  crouchHeight: 1.12,
};

// A dusk freight yard: warm sand and rust against teal machinery paint.
export const PALETTE = {
  sky: 0x2e3d55,
  fog: 0x8a6f52,
  sun: 0xffb36b,
  hemiSky: 0x93a7c9,
  hemiGround: 0x5c4630,
  ground: 0x77694f,
  groundLine: 0xd8c491,
  concrete: 0x8d8577,
  concreteDark: 0x6d675c,
  rust: 0x9c4a2f,
  teal: 0x2f6f6a,
  sand: 0xc8a06a,
  crateWood: 0xa97c50,
  metal: 0x707880,
  siteA: 0xe08a3c,
  siteB: 0x3f9db8,
  attacker: 0xd8622d, // Ravens: burnt orange
  defender: 0x3f7fbf, // Wardens: steel blue
  tracer: 0xffd9a0,
};
