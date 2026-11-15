// The match: rounds, phases, the bomb, the economy, and the strategies the
// bots are given each round. One state machine owns all of it — freeze,
// live, planted, round end, match end — and every win condition in the game
// is decided here and nowhere else.

import { MATCH, ECONOMY, WEAPONS, ARMOR_PRICE } from './config.js';
import { SITES, SPAWNS } from './map.js';
import { Bot, BOT_NAMES } from './bots.js';
import { Body } from './player.js';

export class Match {
  constructor(fx) {
    this.fx = fx; // {hud, sound}
    this.phase = 'menu';
    this.round = 0;
    this.score = { attackers: 0, defenders: 0 };
    this.phaseAt = 0;
    this.timeLeft = 0;
    this.bomb = { state: 'carried', x: 0, z: 0, carrier: null, site: null, plantAt: 0, beepAt: 0 };
    this.channel = null; // {ref, kind:'plant'|'defuse', until, site}
    this.noise = [];
    this.lastSite = null;
    this.over = false;

    this.player = {
      isPlayer: true, name: 'You', team: 'attackers',
      body: new Body(SPAWNS.attackers[0][0], SPAWNS.attackers[0][1]),
      money: ECONOMY.startMoney, kills: 0, deaths: 0, blindUntil: 0,
    };
    this.bots = [];
    const skills = [0.55, 0.7, 0.45, 0.65, 0.5, 0.75, 0.6];
    BOT_NAMES.attackers.forEach((name, i) => {
      const bot = new Bot('attackers', name, SPAWNS.attackers[i + 1][0], SPAWNS.attackers[i + 1][1], skills[i]);
      bot.money = ECONOMY.startMoney;
      bot.kills = 0;
      bot.deaths = 0;
      this.bots.push(bot);
    });
    BOT_NAMES.defenders.forEach((name, i) => {
      const bot = new Bot('defenders', name, SPAWNS.defenders[i][0], SPAWNS.defenders[i][1], skills[i + 3]);
      bot.money = ECONOMY.startMoney;
      bot.kills = 0;
      bot.deaths = 0;
      this.bots.push(bot);
    });
    this.bomb.carrier = this.player;
  }

  get attackers() {
    return [this.player, ...this.bots.filter((b) => b.team === 'attackers')];
  }

  get defenders() {
    return this.bots.filter((b) => b.team === 'defenders');
  }

  get all() {
    return [this.player, ...this.bots];
  }

  aliveCount(team) {
    return this.all.filter((r) => r.team === team && r.body.alive).length;
  }

  startMatch() {
    this.score = { attackers: 0, defenders: 0 };
    this.round = 0;
    this.over = false;
    for (const r of this.all) {
      r.money = ECONOMY.startMoney;
      r.kills = 0;
      r.deaths = 0;
    }
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.phase = 'freeze';
    this.phaseAt = 0;
    this.timeLeft = MATCH.freezeSec;
    this.channel = null;
    this.noise.length = 0;
    // Reset bodies to spawns, alive and whole.
    const place = (ref, [x, z], yaw) => {
      ref.body.x = x;
      ref.body.z = z;
      ref.body.y = 0;
      ref.body.vx = 0;
      ref.body.vz = 0;
      ref.body.health = 100;
      ref.body.alive = true;
      ref.body.yaw = yaw;
      ref.body.pitch = 0;
      ref.body.crouching = false;
      if (ref.mesh) {
        ref.mesh.rotation.z = 0;
        ref.mesh.visible = true;
      }
    };
    // Attackers spawn in the south-west and face north-east into the yard;
    // defenders spawn north-east and face south-west. (yaw: forward is
    // (-sin yaw, -cos yaw), so NE is -PI/4 and SW is 3PI/4.)
    place(this.player, SPAWNS.attackers[0], -Math.PI / 4);
    this.attackers.slice(1).forEach((bot, i) => place(bot, SPAWNS.attackers[i + 1], -Math.PI / 4));
    this.defenders.forEach((bot, i) => place(bot, SPAWNS.defenders[i], Math.PI * 0.75));
    // The bomb starts with the player.
    this.bomb = { state: 'carried', x: 0, z: 0, carrier: this.player, site: null, plantAt: 0, beepAt: 0 };
    this.botBuyAndPlan();
    this.fx.hud.setScore(this.score.attackers, this.score.defenders, `ROUND ${this.round} — FIRST TO ${MATCH.roundsToWin}`);
    this.fx.hud.banner(`Round ${this.round}`, this.player.body.alive ? 'Buy with B — plant the charge at A or B' : '', '#f2e7cf', 2400);
  }

  /** Bots spend and take their positions for the round. */
  botBuyAndPlan() {
    for (const bot of this.bots) {
      // A simple purse: rifles when rich, SMGs when not, pistols when broke.
      const want = bot.money >= 3350 ? 'dmr' : bot.money >= 2700 ? 'rifle' : bot.money >= 1200 ? (Math.random() > 0.5 ? 'smg' : 'shotgun') : 'pistol';
      if (want !== 'pistol' && bot.weaponKey !== want) {
        bot.money -= WEAPONS[want].price;
        bot.weaponKey = want;
      }
      if (!bot.body.armor && bot.money >= ARMOR_PRICE + 400) {
        bot.money -= ARMOR_PRICE;
        bot.body.armor = true;
      }
      bot.ammo = WEAPONS[bot.weaponKey].mag;
    }
    // Attack plan: pick a site (the other one after a loss), go as a pack
    // with one lurker through mid.
    const lostLast = this.lastRoundWinner === 'defenders';
    let siteKey = Math.random() < 0.55 ? 'A' : 'B';
    if (lostLast && this.lastSite !== null) siteKey = this.lastSite === 'A' ? 'B' : 'A';
    this.lastSite = siteKey;
    this.planSite = siteKey;
    const atkBots = this.bots.filter((b) => b.team === 'attackers');
    atkBots.forEach((bot, i) => {
      if (i === 2) bot.setRoute(this.waypointsRef, siteKey === 'A' ? 'mid_house' : 'mid_3'); // lurker
      else bot.setRoute(this.waypointsRef, siteKey === 'A' ? 'site_a' : 'site_b');
      bot.holdYaw = siteKey === 'A' ? 2.4 : -2.2;
    });
    // Defence: two on the likelier site, one mid, one on the other site.
    const defs = this.defenders;
    const aHolds = ['a_hold', 'site_a'];
    const bHolds = ['b_hold', 'site_b'];
    const first = siteKey === 'A' ? aHolds : bHolds;
    const second = siteKey === 'A' ? bHolds : aHolds;
    defs[0]?.setRoute(this.waypointsRef, first[0]);
    defs[1]?.setRoute(this.waypointsRef, first[1]);
    defs[2]?.setRoute(this.waypointsRef, 'mid_cross');
    defs[3]?.setRoute(this.waypointsRef, second[0]);
    for (const d of defs) d.holdYaw = Math.PI * 0.8;
  }

  /** The world steps bots against: enemies, noise, callbacks. */
  botWorld(ref, now, colliders, onKill) {
    const enemies = this.all.filter((r) => r.team !== ref.team);
    return {
      time: now,
      colliders,
      waypoints: this.waypointsRef,
      enemies,
      noise: this.noise,
      onBotShot: (bot, eye, hit) => this.fx.onBotShot?.(bot, eye, hit),
      onKill: (attacker, victim, part) => onKill(attacker, victim, part),
    };
  }

  registerKill(attacker, victim, how) {
    victim.deaths += 1;
    if (attacker !== null && attacker !== victim) {
      attacker.kills += 1;
      attacker.money = Math.min(ECONOMY.maxMoney, attacker.money + ECONOMY.killReward);
    }
    const ours = victim.team === 'defenders';
    this.fx.hud.killfeed(
      `${attacker ? attacker.name : 'The charge'} ▸ ${victim.name}${how === 'head' ? ' — headshot' : ''}`,
      ours,
    );
    if (victim === this.bomb.carrier && this.bomb.state === 'carried') {
      this.bomb.state = 'dropped';
      this.bomb.x = victim.body.x;
      this.bomb.z = victim.body.z;
      this.bomb.carrier = null;
      this.fx.hud.banner('Charge dropped', '', '#ffb36b', 1400);
    }
    if (this.channel !== null && this.channel.ref === victim) this.channel = null;
    this.checkElimination();
  }

  checkElimination() {
    if (this.phase !== 'live' && this.phase !== 'planted' && this.phase !== 'freeze') return;
    if (this.aliveCount('attackers') === 0 && this.bomb.state !== 'planted') {
      this.endRound('defenders', 'Ravens eliminated');
    } else if (this.aliveCount('defenders') === 0) {
      this.endRound('attackers', 'Wardens eliminated');
    }
  }

  endRound(winner, reason) {
    if (this.phase === 'end' || this.phase === 'matchover') return;
    this.lastRoundWinner = winner;
    this.score[winner] += 1;
    for (const r of this.all) {
      const won = r.team === winner;
      const plantBonus = this.bomb.state === 'planted' || this.bomb.state === 'exploded' ? (r.team === 'attackers' ? ECONOMY.plantReward : 0) : 0;
      r.money = Math.min(ECONOMY.maxMoney, r.money + (won ? ECONOMY.winReward : ECONOMY.loseReward) + plantBonus);
    }
    const usWon = winner === 'attackers';
    this.fx.hud.banner(usWon ? 'ROUND WON' : 'ROUND LOST', reason, usWon ? '#9fd67a' : '#ff7a5c', 3200);
    if (usWon) this.fx.sound.roundWin();
    else this.fx.sound.roundLose();
    this.fx.hud.setScore(this.score.attackers, this.score.defenders, `ROUND ${this.round} — FIRST TO ${MATCH.roundsToWin}`);
    if (this.score[winner] >= MATCH.roundsToWin) {
      this.phase = 'matchover';
      this.over = true;
      this.fx.onMatchEnd?.(winner);
    } else {
      this.phase = 'end';
      this.timeLeft = MATCH.endSec;
    }
  }

  /** Called by main each fixed step with the input context it owns. */
  step(dt, now, ctx) {
    // ctx: {colliders, input, onKill, playerAct}
    if (this.phase === 'freeze' || this.phase === 'live' || this.phase === 'planted' || this.phase === 'end') {
      this.timeLeft -= dt;
    }
    // Phase transitions on the clock.
    if (this.phase === 'freeze' && this.timeLeft <= 0) {
      this.phase = 'live';
      this.timeLeft = MATCH.roundSec;
      this.fx.hud.banner('ROUND LIVE', `Plant at ${this.planSite} or eliminate the Wardens`, '#f2e7cf', 1600);
    } else if (this.phase === 'live' && this.timeLeft <= 0) {
      this.endRound('defenders', 'Time — the charge never landed');
    } else if (this.phase === 'end' && this.timeLeft <= 0) {
      this.startRound();
    }
    if (this.phase === 'planted') {
      const untilBoom = this.bomb.plantAt + MATCH.bombSec - now;
      if (now >= this.bomb.beepAt) {
        this.bomb.beepAt = now + Math.max(0.18, untilBoom / MATCH.bombSec) * 0.9;
        this.fx.sound.plantBeep(untilBoom < 1.2);
      }
      if (untilBoom <= 0) {
        this.bomb.state = 'exploded';
        this.fx.sound.explosion();
        this.fx.onExplode?.(this.bomb);
        this.endRound('attackers', 'The charge detonated');
      }
    }
    // Bot bomb logic: an attacker bot with the charge plants on site; a
    // defender reaching a planted charge defuses.
    this.botBombLogic(now);
    // Channel progress (player or bot).
    if (this.channel !== null) {
      const c = this.channel;
      if (!c.ref.body.alive) {
        this.channel = null;
      } else if (now >= c.until) {
        this.channel = null;
        if (c.kind === 'plant') this.completePlant(c.ref, c.site, now);
        else this.endRound('defenders', 'The charge was defused');
      }
    }
    // Stepping on a dropped charge picks it up (attackers only).
    if (this.bomb.state === 'dropped') {
      for (const r of this.attackers) {
        if (r.body.alive && Math.hypot(r.body.x - this.bomb.x, r.body.z - this.bomb.z) < 1.1) {
          this.bomb.state = 'carried';
          this.bomb.carrier = r;
          break;
        }
      }
    }
  }

  botBombLogic(now) {
    if (this.phase === 'live' && this.bomb.state === 'carried' && this.bomb.carrier !== null && !this.bomb.carrier.isPlayer) {
      const carrier = this.bomb.carrier;
      const site = SITES[this.planSite];
      if (Math.hypot(carrier.body.x - site.x, carrier.body.z - site.z) < site.r - 1.5 && carrier.state !== 'plant') {
        carrier.state = 'plant';
        this.channel = { ref: carrier, kind: 'plant', until: now + MATCH.plantSec, site: this.planSite };
      }
    }
    if (this.phase === 'planted' && this.channel === null) {
      // Retake: defenders route to the bomb; the nearest starts defusing.
      for (const d of this.defenders) {
        if (!d.body.alive) continue;
        const dist = Math.hypot(d.body.x - this.bomb.x, d.body.z - this.bomb.z);
        if (dist < 1.3) {
          d.state = 'defuse';
          this.channel = { ref: d, kind: 'defuse', until: now + MATCH.defuseSec, site: this.bomb.site };
          break;
        }
        if (d.state !== 'defuse') d.setRoute(this.waypointsRef, this.bomb.site === 'A' ? 'site_a' : 'site_b');
      }
      // Attackers hold around the planted charge.
      for (const a of this.attackers) {
        if (!a.isPlayer && a.body.alive && a.state !== 'plant') a.state = 'hold';
      }
    }
  }

  /** The player (or a bot) begins planting: main calls this on interact. */
  tryStartPlant(ref, now) {
    if (this.phase !== 'live' || this.bomb.state !== 'carried' || this.bomb.carrier !== ref) return null;
    for (const [key, site] of Object.entries(SITES)) {
      if (Math.hypot(ref.body.x - site.x, ref.body.z - site.z) < site.r) {
        this.channel = { ref, kind: 'plant', until: now + MATCH.plantSec, site: key };
        return key;
      }
    }
    return null;
  }

  cancelChannel(ref) {
    if (this.channel !== null && this.channel.ref === ref) this.channel = null;
  }

  completePlant(ref, siteKey, now) {
    this.bomb.state = 'planted';
    this.bomb.site = siteKey;
    this.bomb.x = ref.body.x;
    this.bomb.z = ref.body.z;
    this.bomb.plantAt = now;
    this.bomb.carrier = null;
    this.phase = 'planted';
    this.fx.hud.banner('CHARGE PLANTED', `Site ${siteKey} — ${MATCH.bombSec} seconds`, '#ffb36b', 2400);
    this.fx.sound.plantBeep(true);
    if (!ref.isPlayer) ref.state = 'hold';
  }

  siteOf(x, z) {
    for (const [key, site] of Object.entries(SITES)) {
      if (Math.hypot(x - site.x, z - site.z) < site.r) return key;
    }
    return null;
  }
}
