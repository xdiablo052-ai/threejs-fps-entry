// The HUD: health and armour, ammunition and money, the round clock and
// score, a killfeed, a top-down minimap, and the overlays — buy menu, round
// banners, prompts. Plain DOM over the canvas; updates are text writes, so
// the simulation never waits on layout.

export class HUD {
  constructor(doc) {
    this.el = {};
    for (const id of [
      'health-num', 'health-bar', 'armor-tag', 'ammo-mag', 'ammo-reserve', 'money',
      'timer', 'score-us', 'score-them', 'alive-us', 'alive-them', 'killfeed',
      'hitmarker', 'banner', 'banner-sub', 'crosshair', 'buymenu', 'buy-money',
      'vignette', 'flash-overlay', 'weapon-name', 'grenade-counts', 'plant-prompt',
      'round-label', 'blind-note',
    ]) {
      this.el[id] = doc.getElementById(id);
    }
    this.minimap = doc.getElementById('minimap')?.getContext('2d');
    this.bannerUntil = 0;
    this.hitUntil = 0;
  }

  setHealth(health, armor) {
    this.el['health-num'].textContent = String(Math.ceil(health));
    this.el['health-bar'].style.width = `${Math.max(0, health)}%`;
    this.el['health-bar'].style.background = health > 35 ? '#7fc46a' : '#d84f35';
    this.el['armor-tag'].textContent = armor ? 'VEST' : '';
  }

  setAmmo(mag, reserve, weaponName) {
    this.el['ammo-mag'].textContent = String(mag);
    this.el['ammo-reserve'].textContent = `/ ${reserve}`;
    this.el['weapon-name'].textContent = weaponName;
  }

  setGrenades(frag, flash, smoke) {
    this.el['grenade-counts'].textContent = `Frag ${frag} · Flash ${flash} · Smoke ${smoke} — [G] [F] [V]`;
  }

  setMoney(money) {
    this.el['money'].textContent = `$${money}`;
  }

  setTimer(sec, danger) {
    const s = Math.max(0, Math.ceil(sec));
    this.el['timer'].textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el['timer'].style.color = danger ? '#ff6a4d' : '#f2e7cf';
  }

  setScore(us, them, roundLabel) {
    this.el['score-us'].textContent = String(us);
    this.el['score-them'].textContent = String(them);
    this.el['round-label'].textContent = roundLabel;
  }

  setAlive(us, them) {
    this.el['alive-us'].textContent = '●'.repeat(us);
    this.el['alive-them'].textContent = '●'.repeat(them);
  }

  killfeed(text, ours) {
    const item = document.createElement('div');
    item.className = `feed-item ${ours ? 'ours' : 'theirs'}`;
    item.textContent = text;
    const feed = this.el['killfeed'];
    feed.appendChild(item);
    while (feed.children.length > 5) feed.removeChild(feed.children[0]);
    setTimeout(() => item.remove(), 5200);
  }

  hitmark(kill) {
    const h = this.el['hitmarker'];
    h.style.opacity = '1';
    h.style.color = kill ? '#ff5030' : '#ffffff';
    this.hitUntil = performance.now() + (kill ? 260 : 130);
  }

  banner(title, sub, color = '#f2e7cf', holdMs = 2600) {
    this.el['banner'].textContent = title;
    this.el['banner'].style.color = color;
    this.el['banner-sub'].textContent = sub;
    this.el['banner'].style.opacity = '1';
    this.el['banner-sub'].style.opacity = '1';
    this.bannerUntil = performance.now() + holdMs;
  }

  prompt(text) {
    this.el['plant-prompt'].textContent = text ?? '';
    this.el['plant-prompt'].style.opacity = text ? '1' : '0';
  }

  damageFlash() {
    this.el['vignette'].style.opacity = '0.85';
    setTimeout(() => { this.el['vignette'].style.opacity = '0'; }, 130);
  }

  setFlash(amount) {
    this.el['flash-overlay'].style.opacity = String(Math.max(0, Math.min(1, amount)));
  }

  setCrosshairGap(px) {
    this.el['crosshair'].style.setProperty('--gap', `${Math.round(px)}px`);
  }

  /** The buy menu: items are {key, label, price, owned}; onPick(key) fires. */
  showBuy(items, money, onPick) {
    const menu = this.el['buymenu'];
    menu.innerHTML = '';
    const head = document.createElement('h2');
    head.innerHTML = `BUY — FREEZE TIME <span>$${money}</span>`;
    menu.appendChild(head);
    items.forEach((item, i) => {
      const b = document.createElement('button');
      b.className = 'buy-item';
      b.disabled = item.owned || money < item.price;
      b.innerHTML = `<span class="buy-key">${i + 1}</span> ${item.label}<span class="buy-price">${item.owned ? 'OWNED' : `$${item.price}`}</span>`;
      b.addEventListener('click', () => onPick(item.key));
      menu.appendChild(b);
    });
    menu.style.display = 'grid';
  }

  hideBuy() {
    this.el['buymenu'].style.display = 'none';
  }

  /** Top-down minimap: walls, sites, the player, teammates, the bomb. */
  drawMap(colliders, sites, view) {
    const g = this.minimap;
    if (g === null) return;
    const S = 150;
    const px = (v) => ((v + 33) / 66) * S;
    g.fillStyle = '#241f18';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#57503f';
    for (const c of colliders) {
      g.fillRect(px(c.x0), px(c.z0), Math.max(1.5, px(c.x1) - px(c.x0)), Math.max(1.5, px(c.z1) - px(c.z0)));
    }
    for (const [key, site] of Object.entries(sites)) {
      g.fillStyle = key === 'A' ? '#e08a3c' : '#3f9db8';
      g.beginPath();
      g.arc(px(site.x), px(site.z), 7, 0, Math.PI * 2);
      g.globalAlpha = 0.5;
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.font = 'bold 8px system-ui';
      g.textAlign = 'center';
      g.fillText(key, px(site.x), px(site.z) + 3);
    }
    g.fillStyle = '#ffb36b';
    for (const t of view.teammates) {
      if (!t.alive) continue;
      g.beginPath();
      g.arc(px(t.x), px(t.z), 2.4, 0, Math.PI * 2);
      g.fill();
    }
    if (view.bomb !== null) {
      g.fillStyle = '#ff4030';
      g.fillRect(px(view.bomb.x) - 2.5, px(view.bomb.z) - 2.5, 5, 5);
    }
    // The player as a facing arrow.
    const p = view.player;
    g.save();
    g.translate(px(p.x), px(p.z));
    // Forward on the map is (-sin yaw, -cos yaw); the arrow glyph points up.
    g.rotate(Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw)) + Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -5);
    g.lineTo(3.4, 4);
    g.lineTo(-3.4, 4);
    g.closePath();
    g.fill();
    g.restore();
  }

  update() {
    const now = performance.now();
    if (this.bannerUntil > 0 && now > this.bannerUntil) {
      this.el['banner'].style.opacity = '0';
      this.el['banner-sub'].style.opacity = '0';
      this.bannerUntil = 0;
    }
    if (this.hitUntil > 0 && now > this.hitUntil) {
      this.el['hitmarker'].style.opacity = '0';
      this.hitUntil = 0;
    }
  }
}
