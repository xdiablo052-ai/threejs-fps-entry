// KESTREL YARD — bootstrap and the game loop. The simulation runs on a
// fixed 60 Hz step, kept apart from rendering: input and physics can never
// change the game's speed, and the renderer only draws the latest state.

import * as THREE from 'three';
import { buildMap, SITES } from './map.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { HUD } from './hud.js';
import { Match } from './rounds.js';
import { Loadout, ViewModel, Gunner, Grenades } from './weapons.js';
import { Effects } from './effects.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, PALETTE } from './config.js';
import { lookDir } from './combat.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // staged scenes for the entry's screenshots

// --- Renderer, scene, light -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'webgl';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 34, 95);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(PALETTE.sun, 1.9);
sun.position.set(-28, 34, -14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 110;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x40382a, 0.5));

// --- World, actors, systems ---------------------------------------------------
const { colliders, waypoints } = buildMap(scene);
const hud = new HUD(document);
const sound = new SoundBank();
const effects = new Effects(scene);
const input = new Input(document);
const match = new Match({ hud, sound });
match.waypointsRef = waypoints;
const loadout = new Loadout();
match.player.loadout = loadout;
const view = new ViewModel(camera);
const gunner = new Gunner(loadout, view);
const grenades = new Grenades(scene);
match.smokesRef = grenades;
for (const bot of match.bots) scene.add(bot.mesh);

// The charge, as a physical object once it leaves a carrier's hands.
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.6 }));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  lamp.position.set(0.12, 0.14, 0);
  lamp.name = 'lamp';
  bombMesh.add(box, lamp);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

let simNow = 0;
let shake = 0;
let lastHealth = 100;
let buyOpen = false;
let spectateIdx = 0;

const onKill = (attacker, victim, part) => {
  match.registerKill(attacker, victim, part);
  if (attacker === match.player) hud.hitmark(true);
};

match.fx.onBotShot = (bot, eye, hit) => {
  const from = { x: eye.x, y: eye.y - 0.12, z: eye.z };
  effects.tracer(from, hit.point);
  if (hit.kind === 'wall') effects.puff(hit.point, 0xcbb27a, 1.2, 1);
  if (hit.kind === 'hit') effects.puff(hit.point, 0xa33327, 1.1, 0.8);
  const d = Math.hypot(bot.body.x - match.player.body.x, bot.body.z - match.player.body.z);
  if (d < 26) sound.enemyShot();
};
match.fx.onExplode = (bomb) => {
  effects.puff({ x: bomb.x, y: 1, z: bomb.z }, 0xe08a3c, 7, 5);
  effects.puff({ x: bomb.x, y: 1.4, z: bomb.z }, 0x55483a, 5, 4);
  shake = Math.max(shake, 0.7);
};
match.fx.onMatchEnd = (winner) => {
  const end = document.getElementById('matchend');
  document.getElementById('matchend-title').textContent = winner === 'attackers' ? 'THE YARD IS YOURS' : 'THE YARD HOLDS';
  document.getElementById('matchend-title').style.color = winner === 'attackers' ? '#9fd67a' : '#ff7a5c';
  document.getElementById('matchend-sub').textContent =
    `Final score ${match.score.attackers} — ${match.score.defenders}. You finished with ${match.player.kills} kills and ${match.player.deaths} deaths.`;
  end.style.display = 'flex';
  document.exitPointerLock?.();
};

// --- Buying -------------------------------------------------------------------
const BUY_ITEMS = [
  { key: 'smg', label: WEAPONS.smg.name, price: WEAPONS.smg.price, kind: 'weapon' },
  { key: 'shotgun', label: WEAPONS.shotgun.name, price: WEAPONS.shotgun.price, kind: 'weapon' },
  { key: 'rifle', label: WEAPONS.rifle.name, price: WEAPONS.rifle.price, kind: 'weapon' },
  { key: 'dmr', label: WEAPONS.dmr.name, price: WEAPONS.dmr.price, kind: 'weapon' },
  { key: 'armor', label: 'Kevlar Vest', price: ARMOR_PRICE, kind: 'armor' },
  { key: 'frag', label: GRENADES.frag.name, price: GRENADES.frag.price, kind: 'grenade' },
  { key: 'flash', label: GRENADES.flash.name, price: GRENADES.flash.price, kind: 'grenade' },
  { key: 'smoke', label: GRENADES.smoke.name, price: GRENADES.smoke.price, kind: 'grenade' },
];

function refreshBuy() {
  hud.showBuy(
    BUY_ITEMS.map((it) => ({
      ...it,
      owned: it.kind === 'weapon' ? loadout.owned.includes(it.key)
        : it.kind === 'armor' ? loadout.armor
        : loadout.grenades[it.key] >= 1,
    })),
    match.player.money,
    buy,
  );
}

function buy(key) {
  const item = BUY_ITEMS.find((i) => i.key === key);
  if (item === undefined || match.player.money < item.price || match.phase !== 'freeze') return;
  if (item.kind === 'weapon') {
    if (loadout.owned.includes(key)) return;
    loadout.give(key);
    loadout.select(key);
    view.build(key);
  } else if (item.kind === 'armor') {
    if (loadout.armor) return;
    loadout.armor = true;
    match.player.body.armor = true;
  } else {
    if (loadout.grenades[key] >= 1) return;
    loadout.grenades[key] += 1;
  }
  match.player.money -= item.price;
  sound.tone?.(980, 60, 0.07, 'sine');
  refreshBuy();
}

// --- The fixed-step simulation --------------------------------------------------
const STEP = 1 / 60;

function step(dt) {
  simNow += dt;
  const phase = match.phase;
  const playing = phase === 'freeze' || phase === 'live' || phase === 'planted' || phase === 'end';
  const player = match.player;
  const body = player.body;

  match.step(dt, simNow, { colliders });

  // Player movement (frozen still during buy time, as tactical rules demand).
  if (playing && body.alive) {
    const m = input.takeMouse();
    if (input.locked || SHOT !== null) {
      body.yaw -= m.dx * 0.0021;
      body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - m.dy * 0.0021));
    }
    body.crouching = input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC');
    if (phase !== 'freeze') {
      const wish = input.wish(body.yaw);
      body.step(dt, wish.x, wish.z, colliders);
      if (input.wasPressed('Space')) body.jump();
    }
    // Weapon handling.
    for (const [code, key] of [['Digit1', 'pistol'], ['Digit2', 'smg'], ['Digit3', 'shotgun'], ['Digit4', 'rifle'], ['Digit5', 'dmr']]) {
      if (input.wasPressed(code) && loadout.select(key)) view.build(key);
    }
    if (input.wasPressed('KeyR')) gunner.startReload(simNow, sound);
    const env = {
      colliders, enemies: match.defenders, effects, sound, noise: match.noise,
      onHit: (head) => { hud.hitmark(false); sound.hit(head); },
      onKill: (victim, part) => onKill(player, victim, part),
    };
    if (phase === 'live' || phase === 'planted') {
      gunner.tryFire(simNow, body, input.firing, env);
      // Grenades on key edges.
      const eye = body.eye();
      const dir = lookDir(body.yaw, body.pitch);
      if (input.wasPressed('KeyG') && loadout.grenades.frag > 0) {
        loadout.grenades.frag -= 1;
        grenades.throw('frag', eye, dir);
      }
      if (input.wasPressed('KeyF') && loadout.grenades.flash > 0) {
        loadout.grenades.flash -= 1;
        grenades.throw('flash', eye, dir);
      }
      if (input.wasPressed('KeyV') && loadout.grenades.smoke > 0) {
        loadout.grenades.smoke -= 1;
        grenades.throw('smoke', eye, dir);
      }
      // Planting: hold E on a site while carrying the charge.
      if (input.down('KeyE') && match.bomb.state === 'carried' && match.bomb.carrier === player) {
        if (match.channel === null) {
          const site = match.tryStartPlant(player, simNow);
          if (site !== null) hud.prompt(`Planting at site ${site} — hold still…`);
        } else if (match.channel.ref === player) {
          const left = Math.max(0, match.channel.until - simNow);
          hud.prompt(`Planting… ${left.toFixed(1)}s`);
        }
      } else if (match.channel !== null && match.channel.ref === player) {
        match.cancelChannel(player);
        hud.prompt(null);
      } else if (match.bomb.state === 'carried' && match.bomb.carrier === player && match.siteOf(body.x, body.z) !== null) {
        hud.prompt('Hold E to plant the charge');
      } else if (match.channel === null) {
        hud.prompt(null);
      }
    }
    if (phase === 'freeze' && input.wasPressed('KeyB')) {
      buyOpen = !buyOpen;
      if (buyOpen) refreshBuy();
      else hud.hideBuy();
    }
    if (buyOpen && phase === 'freeze') {
      for (let i = 0; i < BUY_ITEMS.length; i++) {
        if (input.wasPressed(`Digit${i + 1}`)) buy(BUY_ITEMS[i].key);
      }
    }
    if (phase !== 'freeze' && buyOpen) {
      buyOpen = false;
      hud.hideBuy();
    }
  }

  // Bots play only while the round is live (or the charge is down). In a
  // staged screenshot scene they hold their poses instead.
  if ((phase === 'live' || phase === 'planted') && SHOT === null) {
    for (const bot of match.bots) {
      if (!bot.body.alive) continue;
      bot.step(dt, match.botWorld(bot, simNow, colliders, onKill));
    }
  }

  grenades.update(dt, {
    colliders, effects, sound,
    allBodies: match.all,
    playerPos: body,
    now: simNow,
    shake: (a) => { shake = Math.max(shake, a * 0.5); },
    onGrenadeKill: (victim) => onKill(player, victim, 'frag'),
  });
  effects.update(dt);

  // Damage feedback for the player.
  if (body.health < lastHealth && body.alive) {
    hud.damageFlash();
    sound.hurt();
  }
  lastHealth = body.health;
  input.endFrame();
}

// --- Rendering the latest state -------------------------------------------------
function render() {
  const player = match.player;
  const body = player.body;
  if (body.alive) {
    const eye = body.eye();
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.y = body.yaw;
    camera.rotation.x = body.pitch;
    camera.rotation.z = 0;
    view.group.visible = true;
  } else {
    // Spectate the next living Raven from just behind their eyes.
    const mates = match.attackers.filter((r) => !r.isPlayer && r.body.alive);
    if (mates.length > 0) {
      const mate = mates[spectateIdx % mates.length];
      const eye = mate.body.eye();
      camera.position.set(eye.x, eye.y + 0.06, eye.z);
      camera.rotation.y = mate.body.yaw;
      camera.rotation.x = 0;
    }
    view.group.visible = false;
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.14;
    camera.position.y += (Math.random() - 0.5) * shake * 0.14;
    shake = Math.max(0, shake - 0.03);
  }
  // Aiming down the DMR's scope narrows the view.
  const wantFov = loadout.current === 'dmr' && input.aiming && body.alive ? 26 : 75;
  if (Math.abs(camera.fov - wantFov) > 0.4) {
    camera.fov += (wantFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  view.group.visible = view.group.visible && !(loadout.current === 'dmr' && input.aiming);
  view.update(STEP, simNow, gunner.reloading);

  // The charge on the ground.
  if (match.bomb.state === 'dropped' || match.bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(match.bomb.x, 0.12, match.bomb.z);
    const lamp = bombMesh.getObjectByName('lamp');
    if (lamp) {
      const rate = match.bomb.state === 'planted' ? 3 + (simNow % 1) * 6 : 2;
      lamp.material.color.setHex(Math.sin(simNow * rate * Math.PI) > 0 ? 0xff3020 : 0x551008);
    }
  } else {
    bombMesh.visible = false;
  }

  // HUD state.
  hud.setHealth(body.health, loadout.armor);
  hud.setAmmo(loadout.magAmmo.mag, loadout.magAmmo.reserve, loadout.spec.name.toUpperCase());
  hud.setGrenades(loadout.grenades.frag, loadout.grenades.flash, loadout.grenades.smoke);
  hud.setMoney(player.money);
  const phase = match.phase;
  if (phase === 'planted') {
    hud.setTimer(match.bomb.plantAt + 35 - simNow, true);
  } else {
    hud.setTimer(match.timeLeft, phase === 'live' && match.timeLeft < 15);
  }
  hud.setAlive(match.aliveCount('attackers'), match.aliveCount('defenders'));
  const spreadPx = 6 + (gunner.bloom + body.speedNow * 2.4) * 130;
  hud.setCrosshairGap(body.alive ? spreadPx : 6);
  const blindLeft = player.blindUntil - simNow;
  hud.setFlash(blindLeft > 0 ? Math.min(1, blindLeft / 1.1) : 0);
  document.getElementById('blind-note').style.opacity = blindLeft > 0.4 ? '1' : '0';
  hud.drawMap(colliders, SITES, {
    player: { x: body.x, z: body.z, yaw: body.yaw },
    teammates: match.attackers.filter((r) => !r.isPlayer).map((r) => ({ x: r.body.x, z: r.body.z, alive: r.body.alive })),
    bomb: match.bomb.state === 'planted' || match.bomb.state === 'dropped' ? { x: match.bomb.x, z: match.bomb.z } : null,
  });
  hud.update();
  renderer.render(scene, camera);
}

// --- Loop: fixed steps, then one render ------------------------------------------
let last = performance.now();
let acc = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  let dt = (nowMs - last) / 1000;
  last = nowMs;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) {
    step(STEP);
    acc -= STEP;
  }
  render();
}

// --- Entry points -------------------------------------------------------------------
const menu = document.getElementById('menu');
document.getElementById('play').addEventListener('click', () => {
  sound.ensure();
  menu.style.display = 'none';
  if (match.phase === 'menu' || match.phase === 'matchover') match.startMatch();
  renderer.domElement.requestPointerLock?.();
});
document.getElementById('again').addEventListener('click', () => {
  document.getElementById('matchend').style.display = 'none';
  loadout.armor = false;
  match.player.body.armor = false;
  match.startMatch();
  renderer.domElement.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  input.locked = document.pointerLockElement === renderer.domElement;
  if (!input.locked && match.phase !== 'menu' && match.phase !== 'matchover' && SHOT === null) {
    menu.style.display = 'flex';
    menu.querySelector('h1').innerHTML = 'PAUSED';
    menu.querySelector('p').textContent = 'The round goes on without you — click DEPLOY to jump back in.';
  } else if (input.locked) {
    menu.style.display = 'none';
  }
});
renderer.domElement.addEventListener('click', () => {
  if (!input.locked && match.phase !== 'menu' && SHOT === null) renderer.domElement.requestPointerLock?.();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Staged scenes for screenshots: ?shot=start|play|buy|plant
if (SHOT !== null) {
  menu.style.display = 'none';
  match.startMatch();
  match.phase = 'live';
  match.timeLeft = 74;
  const body = match.player.body;
  if (SHOT === 'play') {
    body.x = -12;
    body.z = 14;
    body.yaw = -0.66; // down the south side of the mid house, at the staged Warden
    body.health = 72;
    loadout.give('rifle');
    loadout.select('rifle');
    view.build('rifle');
    loadout.magAmmo.mag = 17;
    match.player.money = 2350;
    loadout.grenades.frag = 1;
    loadout.grenades.smoke = 1;
    // A smoke veil already blooming across the mid lane for the shot: the
    // fuse is cut to near-zero so the cloud is up even at capture frame
    // rates, bursting in the lane south of the weighbridge house.
    grenades.throw('smoke', { x: -5, y: 1.5, z: 6 }, { x: 0.2, y: 0.02, z: -0.3 });
    grenades.live[grenades.live.length - 1].fuse = 0.05;
    const foe = match.defenders[0];
    foe.body.x = 2;
    foe.body.z = -4;
    foe.body.alive = true;
    foe.syncMesh(0);
    const mate = match.attackers[1];
    mate.body.x = -8;
    mate.body.z = 6;
    mate.syncMesh(0);
    document.getElementById('banner').style.opacity = '0';
    document.getElementById('banner-sub').style.opacity = '0';
  } else if (SHOT === 'buy') {
    match.phase = 'freeze';
    match.timeLeft = 8;
    match.player.money = 4200;
    buyOpen = true;
    refreshBuy();
  } else if (SHOT === 'plant') {
    body.x = SITES.A.x + 3;
    body.z = SITES.A.z + 3;
    body.yaw = 0.785; // looking into the site, crane and ring in frame
    loadout.give('rifle');
    loadout.select('rifle');
    view.build('rifle');
    const mate = match.attackers[1];
    mate.body.x = SITES.A.x - 2;
    mate.body.z = SITES.A.z + 2;
    mate.syncMesh(0);
    document.getElementById('banner').style.opacity = '0';
    document.getElementById('banner-sub').style.opacity = '0';
  } else {
    body.yaw = -0.78; // from the Raven spawn, looking across the yard
  }
  for (const bot of match.bots) bot.syncMesh(0);
}

requestAnimationFrame(frame);
