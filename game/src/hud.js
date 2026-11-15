// NEON BREACH — hud.js
// All DOM overlay work: health/ammo/money, round timer, scores, kill feed,
// minimap, buy menu, banners, damage flash and the start / end screens.
import { WEAPONS, ARMOR_PRICE } from './weapons.js';

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['crosshair', 'hitmarker', 'ammo-mag', 'ammo-reserve', 'weapon-name',
      'hp-fill', 'hp-num', 'armor-fill', 'armor-num', 'money', 'timer', 'score-v', 'score-c',
      'rounds-v', 'rounds-c', 'killfeed', 'banner', 'banner-sub', 'minimap', 'buy-menu',
      'buy-items', 'overlay', 'overlay-title', 'overlay-copy', 'play', 'damage-flash',
      'plant-bar', 'plant-fill', 'plant-label', 'scoreboard', 'alive-v', 'alive-c',
      'objective', 'hint']) {
      this.el[id] = document.getElementById(id);
    }
    this.mm = this.el['minimap'].getContext('2d');
    this.killTimer = null;
    this.hitTimer = null;
  }

  setAmmo(mag, reserve, name, reloading) {
    this.el['ammo-mag'].textContent = reloading ? '--' : mag;
    this.el['ammo-reserve'].textContent = '/ ' + reserve;
    this.el['weapon-name'].textContent = name + (reloading ? ' — RELOADING' : '');
  }

  setHealth(hp, armor) {
    this.el['hp-fill'].style.width = Math.max(0, hp) + '%';
    this.el['hp-num'].textContent = Math.ceil(Math.max(0, hp));
    this.el['armor-fill'].style.width = Math.min(100, armor * 2) + '%';
    this.el['armor-num'].textContent = Math.ceil(armor);
    this.el['hp-fill'].style.background = hp <= 30 ? '#ff4d5e' : '#3fa9ff';
  }

  setMoney(m) { this.el['money'].textContent = '$' + m.toLocaleString('en-US'); }

  setTimer(sec, phase) {
    const s = Math.max(0, Math.ceil(sec));
    this.el['timer'].textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el['timer'].style.color = phase === 'live' && s <= 10 ? '#ff4d5e' : '';
  }

  setScore(v, c, rv, rc) {
    this.el['score-v'].textContent = v;
    this.el['score-c'].textContent = c;
    this.el['rounds-v'].textContent = '●'.repeat(rv) + '○'.repeat(Math.max(0, 5 - rv));
    this.el['rounds-c'].textContent = '●'.repeat(rc) + '○'.repeat(Math.max(0, 5 - rc));
  }

  setAlive(v, c) {
    this.el['alive-v'].textContent = 'VANGUARD ' + '▮'.repeat(v) + '▯'.repeat(3 - v);
    this.el['alive-c'].textContent = 'CRIMSON ' + '▮'.repeat(c) + '▯'.repeat(3 - c);
  }

  setObjective(text) { this.el['objective'].textContent = text; }

  setHint(text) { this.el['hint'].textContent = text; }

  hitmarker(kill) {
    const h = this.el['hitmarker'];
    h.classList.add('on');
    h.style.setProperty('--hm', kill ? '#ff4d5e' : '#f0a830');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => h.classList.remove('on'), 120);
  }

  damageFlash() {
    const d = this.el['damage-flash'];
    d.style.opacity = '0.55';
    setTimeout(() => { d.style.opacity = '0'; }, 120);
  }

  killfeed(killer, victim, headshot) {
    const div = document.createElement('div');
    div.className = 'kf-row';
    const kc = killer.team === 'vanguard' ? 'kf-v' : 'kf-c';
    const vc = victim.team === 'vanguard' ? 'kf-v' : 'kf-c';
    div.innerHTML = `<span class="${kc}">${killer.name}</span> <span class="kf-x">${headshot ? '◉' : '✕'}</span> <span class="${vc}">${victim.name}</span>`;
    this.el['killfeed'].prepend(div);
    while (this.el['killfeed'].children.length > 5) this.el['killfeed'].lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  banner(main, sub = '', ms = 2600) {
    this.el['banner'].textContent = main;
    this.el['banner-sub'].textContent = sub;
    this.el['banner'].parentElement.classList.add('show');
    clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => this.el['banner'].parentElement.classList.remove('show'), ms);
  }

  showPlant(progress, label) {
    this.el['plant-bar'].style.display = 'block';
    this.el['plant-fill'].style.width = Math.min(100, progress * 100) + '%';
    this.el['plant-label'].textContent = label;
  }

  hidePlant() { this.el['plant-bar'].style.display = 'none'; }

  // --- Buy menu ---
  renderBuy(money, owned) {
    const items = [
      ...Object.values(WEAPONS).filter((w) => w.price > 0).map((w) => ({
        key: w.id === 'vk9' ? '1' : w.id === 'ar77' ? '2' : '3',
        id: w.id, name: w.name, desc: `${w.damage} dmg · ${w.rpm} rpm · ${w.mag} rnd`,
        price: w.price, owned: !!owned[w.id],
      })),
      { key: '4', id: 'armor', name: 'Kevlar Vest', desc: '+50 armor', price: ARMOR_PRICE, owned: false },
    ];
    this.el['buy-items'].innerHTML = items.map((it) => `
      <button class="buy-item ${it.owned ? 'owned' : ''} ${money < it.price ? 'poor' : ''}" data-id="${it.id}">
        <span class="buy-key">${it.key}</span>
        <span class="buy-name">${it.name}<small>${it.desc}</small></span>
        <span class="buy-price">${it.owned ? 'OWNED' : '$' + it.price}</span>
      </button>`).join('');
    this.el['buy-menu'].style.display = 'block';
  }

  hideBuy() { this.el['buy-menu'].style.display = 'none'; }

  // --- Minimap: top-down, walls grey, sites outlined, allies blue,
  // enemies red only while "spotted" (fired or seen recently). ---
  drawMinimap(player, allies, enemies, bomb) {
    const g = this.mm;
    const W = 190, H = 132;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,13,18,0.72)';
    g.fillRect(0, 0, W, H);
    const sx = (x) => (x + 32) / 64 * W;
    const sz = (z) => (z + 22) / 44 * H;
    // Blocks.
    g.fillStyle = 'rgba(180,190,205,0.55)';
    for (const b of window.__NB_BLOCKS__ || []) {
      g.fillRect(sx(b.minX), sz(b.minZ), sx(b.maxX) - sx(b.minX), sz(b.maxZ) - sz(b.minZ));
    }
    // Sites.
    for (const [key, s] of Object.entries(window.__NB_SITES__ || {})) {
      g.strokeStyle = s.color === 0x35d0ff ? '#35d0ff' : '#ffb020';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(sx(s.x), sz(s.z), s.r / 64 * W, 0, Math.PI * 2); g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(key, sx(s.x), sz(s.z));
    }
    // Bomb.
    if (bomb && bomb.planted) {
      g.fillStyle = '#ff4d5e';
      g.beginPath(); g.arc(sx(bomb.x), sz(bomb.z), 4, 0, Math.PI * 2); g.fill();
    }
    const dot = (x, z, color, arrowYaw) => {
      g.fillStyle = color;
      g.beginPath(); g.arc(sx(x), sz(z), 4, 0, Math.PI * 2); g.fill();
      if (arrowYaw !== undefined) {
        g.strokeStyle = '#fff'; g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(sx(x), sz(z));
        g.lineTo(sx(x) + Math.sin(arrowYaw) * 8, sz(z) - Math.cos(arrowYaw) * 8);
        g.stroke();
      }
    };
    for (const e of enemies) if (e.alive && e.spotted) dot(e.pos.x, e.pos.z, '#ff4d5e');
    for (const a of allies) if (a.alive) dot(a.pos.x, a.pos.z, '#3fa9ff');
    if (player.alive) dot(player.pos.x, player.pos.z, '#ffffff', player.yaw);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  // --- Overlays ---
  showMenu(title, copy, button) {
    this.el['overlay-title'].textContent = title;
    this.el['overlay-copy'].textContent = copy;
    this.el['play'].textContent = button;
    this.el['overlay'].hidden = false;
  }

  hideMenu() { this.el['overlay'].hidden = true; }

  showScoreboard(rows) {
    this.el['scoreboard'].style.display = 'block';
    this.el['scoreboard'].innerHTML = '<h2>MATCH RESULT</h2>' + rows.map((r) =>
      `<div class="sb-row ${r.team}"><span>${r.name}</span><span>${r.kills} K / ${r.deaths} D</span><span>${r.team === 'vanguard' ? 'VANGUARD' : 'CRIMSON'}</span></div>`).join('');
  }

  hideScoreboard() { this.el['scoreboard'].style.display = 'none'; }
}
