// NEON BREACH — main.js
// Game orchestration: rounds, economy, bomb, input, autopilot (demo mode),
// spectating, and the render loop. 3v3, first to 5 rounds.
import * as THREE from 'three';
import { createWorld, SITES, SPAWNS, siteAt, WAYPOINTS, findPath } from './world.js';
import { WEAPONS, ARMOR_PRICE } from './weapons.js';
import { Bot } from './bots.js';
import { Player } from './player.js';
import { HUD } from './hud.js';
import { Effects } from './effects.js';
import { SoundBank } from './audio.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = parseInt(params.get('seed') || '0', 10) || Math.floor(Math.random() * 1e9);
const rng = mulberry32(SEED);

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 40;
const WIN_ROUNDS = 5;

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 300);
    this.world = createWorld(this.scene);
    this.boxes = this.world.boxes;
    window.__NB_BLOCKS__ = this.boxes.filter((b) => b.h < 4);
    window.__NB_SITES__ = SITES;

    this.effects = new Effects(this.scene);
    this.sound = new SoundBank();
    this.hud = new HUD();
    this.player = new Player(this.camera, this.scene);

    this.bots = [];
    for (let i = 0; i < 2; i++) this.bots.push(new Bot('vanguard', i, this.scene, mulberry32(SEED + 11 + i)));
    for (let i = 0; i < 3; i++) this.bots.push(new Bot('crimson', i, this.scene, mulberry32(SEED + 31 + i)));

    this.phase = 'menu'; // menu | buy | live | roundEnd | matchEnd
    this.round = 1;
    this.wins = { vanguard: 0, crimson: 0 };
    this.phaseT = 0;      // seconds left in phase
    this.now = 0;
    this.attackSite = 'A';
    this.bombPlanted = false;
    this.plantSite = null;
    this.fuseT = 0;
    this.bombMesh = null;
    this.beepAt = 0;
    this.holdingE = false;
    this.buyOpen = false;
    this.spectateTarget = null;
    this.matchStats = [];
    this.autopilot = false;
    this.autoGoal = null;
    this.autoThinkAt = 0;
    this.mmAt = 0;
    this.started = false;

    this.ctx = {
      boxes: this.boxes,
      actors: [this.player, ...this.bots],
      rng,
      now: 0,
      phase: 'menu',
      bombPlanted: false,
      plantSite: null,
      attackSite: 'A',
      siteAt,
      moveX: 0, moveZ: 0,
      onShot: (shooter, muzzle, point, w) => this.onShot(shooter, muzzle, point, w),
      onHit: (shooter, victim, part, dmg, dealt, point) => this.onHit(shooter, victim, part, dmg, dealt, point),
      onKill: (shooter, victim, part) => this.onKill(shooter, victim, part),
      onPlantTick: (bot, p) => this.hud.setHint(`${bot.name} is planting the spike…`),
      onPlanted: (bot, site) => this.onPlanted(bot, site),
      onDefuseTick: (bot, p) => this.hud.setHint(`${bot.name} is defusing the spike…`),
      onDefused: (bot) => this.endRound('crimson', `${bot.name} defused the spike`),
      onStep: () => { if (Math.random() < 0.5) this.sound.step(); },
      onDryFire: () => this.sound.dryFire(),
    };

    this.bindInput();
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // Shot staging for screenshots (deterministic demo states).
    if (SHOT === 'start') this.stageStart();
    else if (SHOT === 'play') this.stagePlay();
    else if (SHOT === 'buy') this.stageBuy();
    else if (SHOT === 'end') this.stageEnd();
    else this.hud.showMenu('NEON BREACH', 'A round-based 3v3 tactical FPS. Plant the spike at A or B — or wipe the Crimson squad. First to 5 rounds takes the match.', 'CLICK TO PLAY');

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
    // Diagnostics handle (read-only state snapshot for testing).
    window.__NB__ = this;
  }

  // ------------------------------------------------------------- staging
  stageStart() {
    // Menu over a live arena: bots wander the map.
    this.hud.showMenu('NEON BREACH', 'A round-based 3v3 tactical FPS. Plant the spike at A or B — or wipe the Crimson squad. First to 5 rounds takes the match.', 'CLICK TO PLAY');
    this.resetPositions();
    this.phase = 'menu';
  }

  stagePlay() {
    this.startMatch();
    this.phase = 'live';
    this.ctx.phase = 'live';
    this.phaseT = ROUND_SECONDS - 6; // a few seconds into the round
    this.autopilot = true;
    this.hud.hideMenu();
    this.hud.hideBuy(); this.buyOpen = false;
    // Pre-run the simulation a little so bots are spread out and fighting.
    for (let i = 0; i < 240; i++) this.simulate(1 / 60);
  }

  stageBuy() {
    this.startMatch();
    this.round = 2;
    this.wins.vanguard = 1;
    this.player.money = 3200;
    this.phase = 'buy';
    this.phaseT = BUY_SECONDS;
    this.autopilot = true;
    this.hud.hideMenu();
    this.hud.renderBuy(this.player.money, this.player.weapons);
    this.buyOpen = true;
    this.player.pos.set(0, 0, 18);
    this.player.yaw = 0;
    for (let i = 0; i < 120; i++) this.simulate(1 / 60);
  }

  stageEnd() {
    this.startMatch();
    this.round = 5;
    this.wins.vanguard = 4; this.wins.crimson = 2;
    this.phase = 'roundEnd';
    this.phaseT = 5;
    this.autopilot = true;
    this.hud.hideMenu();
    this.hud.hideBuy(); this.buyOpen = false;
    for (let i = 0; i < 200; i++) this.simulate(1 / 60);
    // Freeze in the round-end state so the screenshot holds the banner.
    this.phase = 'roundEnd';
    this.ctx.phase = 'roundEnd';
    this.phaseT = 3600;
    this.hud.hideBuy(); this.buyOpen = false;
    this.hud.banner('ROUND WON — VANGUARD', 'Site A cleared · 4 — 2', 60000);
  }

  // ------------------------------------------------------------- input
  bindInput() {
    const canvas = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.showScoreboard(); }
      if (e.code === 'KeyM') { this.sound.enabled = !this.sound.enabled; }
      this.player.keys[e.code] = true;
      if (e.code === 'ControlLeft') this.player.crouching = true;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyB' && this.phase === 'buy') this.toggleBuy();
      if (e.code === 'KeyE') this.holdingE = true;
      if (e.code === 'Digit1') this.switchWeapon('p9');
      if (e.code === 'Digit2') this.switchWeapon('vk9');
      if (e.code === 'Digit3') this.switchWeapon('ar77');
      if (e.code === 'Digit4') this.switchWeapon('lr50');
      if (this.buyOpen) {
        if (e.code === 'Digit1') this.buyItem('vk9');
        if (e.code === 'Digit2') this.buyItem('ar77');
        if (e.code === 'Digit3') this.buyItem('lr50');
        if (e.code === 'Digit4') this.buyItem('armor');
      }
    });
    addEventListener('keyup', (e) => {
      this.player.keys[e.code] = false;
      if (e.code === 'ControlLeft') this.player.crouching = false;
      if (e.code === 'KeyE') this.holdingE = false;
      if (e.code === 'Tab') this.hud.hideScoreboard();
    });
    addEventListener('mousemove', (e) => {
      if (!this.player.locked || !this.player.alive) return;
      this.player.yaw -= e.movementX * 0.0021;
      this.player.pitch = Math.max(-1.5, Math.min(1.5, this.player.pitch - e.movementY * 0.0021));
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.player.locked || this.phase !== 'live' || !this.player.alive) return;
      if (e.button === 0) {
        this.player.firing = true;
        if (!this.player.weapon.auto) this.player.tryFire(this.now, this.ctx);
      } else if (e.button === 2) {
        this.zoom(true);
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.player.firing = false;
      if (e.button === 2) this.zoom(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.player.locked = document.pointerLockElement === canvas;
    });
    this.hud.el['play'].addEventListener('click', () => {
      this.sound.ensure();
      if (!this.started) { this.startMatch(); }
      else if (this.phase === 'matchEnd') { this.startMatch(); }
      else { this.hud.hideMenu(); }
      canvas.requestPointerLock();
    });
    this.hud.el['buy-items'].addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn) this.buyItem(btn.dataset.id);
    });
  }

  zoom(on) {
    const w = this.player.weapon;
    const target = on && w.zoom > 1 ? 78 / w.zoom : 78;
    this.camera.fov = target;
    this.camera.updateProjectionMatrix();
  }

  reload() {
    if (this.player.startReload(this.now)) this.sound.reload();
  }

  switchWeapon(id) {
    if (this.player.switchWeapon(id)) this.sound.click();
  }

  buyItem(id) {
    if (this.phase !== 'buy') return;
    let ok = false;
    if (id === 'armor') ok = this.player.buyArmor();
    else ok = this.player.buy(id);
    if (ok) {
      this.sound.buy();
      this.hud.setMoney(this.player.money);
      this.hud.renderBuy(this.player.money, this.player.weapons);
      this.hud.setAmmo(this.player.ammo.mag, this.player.ammo.reserve, this.player.weapon.name, false);
    } else this.sound.denied();
  }

  toggleBuy() {
    if (this.buyOpen) { this.hud.hideBuy(); this.buyOpen = false; }
    else { this.hud.renderBuy(this.player.money, this.player.weapons); this.buyOpen = true; }
  }

  showScoreboard() {
    const rows = [this.player, ...this.bots].map((a) => ({
      name: a.name, kills: a.kills || 0, deaths: a.deaths || 0, team: a.team,
    }));
    this.hud.showScoreboard(rows);
  }

  // ------------------------------------------------------------- match flow
  startMatch() {
    this.started = true;
    this.round = 1;
    this.wins = { vanguard: 0, crimson: 0 };
    this.player.money = 800;
    this.matchStats = [];
    this.startRound();
  }

  resetPositions() {
    const vs = SPAWNS.vanguard, cs = SPAWNS.crimson;
    this.player.reset(vs[0][0], vs[0][1], 0);
    this.bots[0].reset(vs[1][0], vs[1][1], 0, 'p9');
    this.bots[1].reset(vs[2][0], vs[2][1], 0, 'p9');
    for (let i = 0; i < 3; i++) this.bots[2 + i].reset(cs[i][0], cs[i][1], Math.PI, 'p9');
    this.player.carrier = true;
    this.bots.forEach((b) => { b.carrier = false; });
    this.camera.position.set(this.player.pos.x, 1.55, this.player.pos.z);
    this.camera.rotation.set(0, 0, 0);
  }

  startRound() {
    this.attackSite = rng() < 0.5 ? 'A' : 'B';
    this.bombPlanted = false;
    this.plantSite = null;
    this.fuseT = 0;
    if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
    this.resetPositions();
    // Bots buy up with the rounds.
    const pool = this.round === 1 ? ['p9', 'p9', 'vk9'] : ['ar77', 'vk9', 'ar77'];
    for (let i = 0; i < 3; i++) {
      const b = this.bots[2 + i];
      b.weapon = WEAPONS[pool[i]];
      b.mag = b.weapon.mag; b.reserve = b.weapon.reserve;
    }
    for (let i = 0; i < 2; i++) {
      const b = this.bots[i];
      if (this.round > 1 && rng() < 0.7) { b.weapon = WEAPONS.vk9; b.mag = 30; b.reserve = 120; }
    }
    // Refill the player's ammo each round.
    for (const id of Object.keys(this.player.weapons)) {
      this.player.weapons[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    this.phase = 'buy';
    this.phaseT = BUY_SECONDS;
    this.ctx.phase = 'buy';
    this.hud.setObjective(`Plant the spike at Site ${this.attackSite} — or eliminate Crimson`);
    this.hud.setHint('Buy phase — press B for the shop, then the round starts');
    this.hud.banner(`ROUND ${this.round}`, `Attack Site ${this.attackSite} · First to ${WIN_ROUNDS}`);
    this.hud.renderBuy(this.player.money, this.player.weapons);
    this.buyOpen = true;
    this.hud.hideScoreboard();
  }

  endRound(winner, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.wins[winner]++;
    this.phase = 'roundEnd';
    this.ctx.phase = 'roundEnd';
    this.phaseT = 5;
    this.hud.hideBuy(); this.buyOpen = false;
    this.hud.hidePlant();
    if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
    this.bombPlanted = false; this.plantSite = null;
    const vWon = winner === 'vanguard';
    // Economy.
    if (vWon) this.player.money += 3250; else this.player.money += 1900;
    this.hud.banner(vWon ? 'ROUND WON — VANGUARD' : 'ROUND LOST — CRIMSON TAKES IT', reason);
    if (vWon) this.sound.roundWin(); else this.sound.roundLose();
    this.hud.setMoney(this.player.money);
    this.hud.setObjective(vWon ? 'Round secured. Next round loads…' : 'Round lost. Next round loads…');
    this.matchStats.push({ round: this.round, winner, reason });
    if (this.wins[winner] >= WIN_ROUNDS) {
      this.endMatch(winner);
    }
  }

  endMatch(winner) {
    this.phase = 'matchEnd';
    this.ctx.phase = 'matchEnd';
    const vWon = winner === 'vanguard';
    this.hud.banner(vWon ? 'MATCH WON — VANGUARD' : 'MATCH LOST', `Final ${this.wins.vanguard} — ${this.wins.crimson}`, 60000);
    const rows = [this.player, ...this.bots].map((a) => ({
      name: a.name, kills: a.kills || 0, deaths: a.deaths || 0, team: a.team,
    }));
    rows.sort((a, b) => b.kills - a.kills);
    this.hud.showScoreboard(rows);
    this.hud.showMenu(
      vWon ? 'MATCH WON — VANGUARD' : 'MATCH LOST — CRIMSON WINS',
      `Final score ${this.wins.vanguard} — ${this.wins.crimson}. The spike, the sites and the squad are yours to run back.`,
      'PLAY AGAIN',
    );
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onPlanted(actor, site) {
    this.bombPlanted = true;
    this.plantSite = site;
    this.ctx.bombPlanted = true;
    this.ctx.plantSite = site;
    this.fuseT = FUSE_SECONDS;
    this.beepAt = 0;
    const s = SITES[site];
    const geo = new THREE.BoxGeometry(0.55, 0.35, 0.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4, metalness: 0.6, emissive: 0xff4d5e, emissiveIntensity: 0.4 });
    this.bombMesh = new THREE.Mesh(geo, mat);
    this.bombMesh.position.set(s.x, 0.2, s.z);
    this.bombMesh.castShadow = true;
    this.scene.add(this.bombMesh);
    this.hud.banner('SPIKE PLANTED', `Site ${site} · ${FUSE_SECONDS}s to detonation`, 3000);
    this.hud.setObjective(`DEFEND THE SPIKE — Site ${site} · ${FUSE_SECONDS}s`);
    this.hud.hidePlant();
    this.sound.plantBeep(true);
    // Carrier loses the bomb.
    actor.carrier = false;
    if (actor === this.player) this.player.carrier = false;
  }

  // ------------------------------------------------------------- combat events
  onShot(shooter, muzzle, point, w) {
    this.effects.tracer(muzzle, point, w.tracer);
    this.effects.muzzle(muzzle);
    const dist = Math.hypot(muzzle.x - this.player.pos.x, muzzle.z - this.player.pos.z);
    if (shooter === this.player) this.sound.shot(w.kind);
    else if (dist < 30) this.sound.distantShot();
  }

  onHit(shooter, victim, part, dmg, dealt, point) {
    this.effects.impact(point, victim.team === 'vanguard' ? 0x3fa9ff : 0xff4d5e);
    if (shooter === this.player) {
      this.hud.hitmarker(false);
      this.sound.hit();
    }
    if (victim === this.player) {
      this.hud.damageFlash();
      this.sound.hurt();
      this.player.takeHit(shooter.pos, dmg);
      // Armor is handled inside applyDamage via victim.armor; mirror it here.
    }
  }

  onKill(shooter, victim, part) {
    victim.deaths = (victim.deaths || 0) + 1;
    shooter.kills = (shooter.kills || 0) + 1;
    this.hud.killfeed(shooter, victim, part === 'head');
    if (shooter === this.player) {
      this.player.money += 300;
      this.hud.setMoney(this.player.money);
      this.hud.hitmarker(true);
      this.sound.kill();
    }
    if (victim === this.player) {
      this.player.deaths++;
      this.hud.setHint('You are down — spectating your squad');
      this.spectateTarget = this.bots.find((b) => b.team === 'vanguard' && b.alive) || null;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (victim.carrier) {
      // Bomb drops to the nearest alive attacker.
      victim.carrier = false;
      const next = this.bots.find((b) => b.team === 'vanguard' && b.alive);
      if (next) next.carrier = true;
      else if (this.player.alive) this.player.carrier = true;
    }
    // Round end by elimination.
    const vAlive = this.player.alive || this.bots.some((b) => b.team === 'vanguard' && b.alive);
    const cAlive = this.bots.some((b) => b.team === 'crimson' && b.alive);
    if (this.phase === 'live') {
      if (!cAlive) this.endRound('vanguard', 'Crimson squad eliminated');
      else if (!vAlive && !this.bombPlanted) this.endRound('crimson', 'Vanguard squad eliminated');
      else if (!vAlive && this.bombPlanted) this.hud.setObjective('All attackers down — the spike still ticks…');
    }
  }

  // ------------------------------------------------------------- per-frame
  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.simulate(dt);
    this.renderer.render(this.scene, this.camera);
  }

  simulate(dt) {
    this.now += dt;
    this.ctx.now = this.now;
    const t = this.now;
    this.world.update(t);

    // Phase timers.
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.ctx.phase = 'live';
        this.hud.hideBuy(); this.buyOpen = false;
        this.hud.setHint('Round live — plant the spike or eliminate Crimson');
        this.sound.click();
      }
    } else if (this.phase === 'live') {
      this.phaseT -= dt;
      if (this.bombPlanted) {
        this.fuseT -= dt;
        this.beepAt -= dt;
        if (this.beepAt <= 0) {
          this.sound.plantBeep(this.fuseT < 10);
          this.beepAt = this.fuseT < 10 ? 0.5 : 1.0;
        }
        this.hud.setObjective(`SPIKE LIVE — Site ${this.plantSite} · ${Math.ceil(this.fuseT)}s`);
        if (this.fuseT <= 0) {
          this.effects.explosion(SITES[this.plantSite]);
          this.sound.explode();
          this.endRound('vanguard', `Spike detonated at Site ${this.plantSite}`);
        }
      } else if (this.phaseT <= 0) {
        this.endRound('crimson', 'Time expired — spike never planted');
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0 && this.phase === 'roundEnd') {
        this.round++;
        this.startRound();
      }
    }

    // Autopilot drives the player in demo / screenshot mode.
    if (this.autopilot && this.player.alive && (this.phase === 'live' || this.phase === 'buy')) {
      this.driveAutopilot(dt);
    }

    // Player.
    if (this.phase === 'live' || this.phase === 'buy') {
      if (this.player.alive) {
        this.player.update(dt, this.now, this.ctx);
        this.handleInteract(dt);
      } else {
        this.spectate(dt);
      }
    } else if (this.phase === 'menu') {
      // Slow orbit around the arena behind the menu.
      const a = t * 0.07;
      this.camera.position.set(Math.cos(a) * 26, 13, Math.sin(a) * 26);
      this.camera.lookAt(0, 1, -4);
      // Ambient bots wander.
      for (const b of this.bots) b.update(dt, this.now, { ...this.ctx, phase: 'menu' });
    } else if (this.phase === 'roundEnd' || this.phase === 'matchEnd') {
      // Keep the world alive behind the banner.
      for (const b of this.bots) if (b.alive) b.update(dt, this.now, { ...this.ctx, phase: this.phase });
      if (!this.player.alive) this.spectate(dt);
      else this.player.update(dt, this.now, this.ctx);
    }

    // Bots.
    if (this.phase === 'live' || this.phase === 'buy') {
      for (const b of this.bots) b.update(dt, this.now, this.ctx);
    }

    // Spotted flags for the minimap.
    for (const e of this.bots) {
      if (e.team !== 'crimson') continue;
      e.spotted = (this.now - (e.lastShotAt || -99) < 3) || this.playerSees(e);
    }

    this.effects.update(dt);
    this.updateHUD(dt);
  }

  playerSees(enemy) {
    if (!this.player.alive || !enemy.alive) return false;
    const o = { x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z };
    const t = { x: enemy.pos.x, y: 1.2, z: enemy.pos.z };
    const dx = t.x - o.x, dy = t.y - o.y, dz = t.z - o.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 40) return false;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const wallT = this.rayWall(o, dir, dist);
    return wallT >= dist;
  }

  rayWall(o, d, maxDist) {
    // Slab test against every collider box.
    let best = Infinity;
    for (const b of this.boxes) {
      let tmin = 0, tmax = Infinity;
      const axes = [
        [o.x, d.x, b.minX, b.maxX],
        [o.y, d.y, 0, b.h],
        [o.z, d.z, b.minZ, b.maxZ],
      ];
      let ok = true;
      for (const [oo, dd, mn, mx] of axes) {
        if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) { ok = false; break; } }
        else {
          let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin < best && tmin <= maxDist) best = tmin;
    }
    return best;
  }

  handleInteract(dt) {
    const p = this.player;
    if (!this.holdingE || this.phase !== 'live') {
      p.plantProgress = 0; p.defuseProgress = 0;
      if (this.phase === 'live') this.hud.hidePlant();
      return;
    }
    // Planting (attackers, spike not planted, standing on a site).
    if (!this.bombPlanted && p.carrier) {
      const site = siteAt(p.pos.x, p.pos.z);
      if (site) {
        p.plantProgress += dt;
        this.hud.showPlant(p.plantProgress / 3, `PLANTING SPIKE — SITE ${site}`);
        if (p.plantProgress >= 3) { this.onPlanted(p, site); p.plantProgress = 0; }
        if (Math.floor(p.plantProgress * 2) !== Math.floor((p.plantProgress - dt) * 2)) this.sound.plantBeep();
        return;
      }
    }
    // Defusing (bomb planted, standing on the spike).
    if (this.bombPlanted && this.plantSite) {
      const s = SITES[this.plantSite];
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < 2.2) {
        p.defuseProgress += dt;
        this.hud.showPlant(p.defuseProgress / 5, 'DEFUSING SPIKE');
        if (Math.floor(p.defuseProgress * 2) !== Math.floor((p.defuseProgress - dt) * 2)) this.sound.defuseBeep();
        if (p.defuseProgress >= 5) {
          p.defuseProgress = 0;
          this.endRound('vanguard', 'You defused the spike');
        }
        return;
      }
    }
    p.plantProgress = 0; p.defuseProgress = 0;
    this.hud.hidePlant();
  }

  spectate(dt) {
    const target = this.spectateTarget && this.spectateTarget.alive
      ? this.spectateTarget
      : this.bots.find((b) => b.team === 'vanguard' && b.alive);
    this.spectateTarget = target || null;
    if (!target) {
      const a = this.now * 0.1;
      this.camera.position.set(Math.cos(a) * 20, 10, Math.sin(a) * 20);
      this.camera.lookAt(0, 1, 0);
      return;
    }
    const back = 3.2, up = 1.8;
    const bx = target.pos.x - Math.sin(target.yaw) * back;
    const bz = target.pos.z + Math.cos(target.yaw) * back;
    this.camera.position.set(bx, up, bz);
    this.camera.lookAt(target.pos.x, 1.4, target.pos.z);
  }

  driveAutopilot(dt) {
    const p = this.player;
    // Find the nearest visible enemy.
    let target = null, bestScore = Infinity;
    for (const b of this.bots) {
      if (b.team !== 'crimson' || !b.alive) continue;
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 40 && this.playerSees(b)) {
        const score = dist;
        if (score < bestScore) { bestScore = score; target = b; }
      }
    }
    if (target) {
      const dx = target.pos.x - p.pos.x, dz = target.pos.z - p.pos.z;
      const dy = 1.3 - p.eyeY;
      const wantYaw = Math.atan2(dx, -dz);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dyaw = wantYaw - p.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      p.yaw += dyaw * Math.min(1, dt * 6);
      p.pitch += (wantPitch - p.pitch) * Math.min(1, dt * 6);
      if (Math.abs(dyaw) < 0.06) {
        p.tryFire(this.now, this.ctx);
        p.firing = this.player.weapon.auto;
      } else p.firing = false;
      // Strafe while duelling — and keep pushing toward the target (and the
      // site beyond it) instead of camping one corner all round.
      const tDist = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
      p.keys['KeyA'] = Math.sin(this.now * 1.3) > 0.4;
      p.keys['KeyD'] = Math.sin(this.now * 1.3) < -0.4;
      p.keys['KeyW'] = tDist > 18 && Math.abs(dyaw) < 0.5;
      if (p.ammo.mag === 0) this.reload();
      return;
    }
    p.firing = false;
    // No target: push toward the attack site via the nearest waypoint.
    if (this.now > this.autoThinkAt) {
      this.autoThinkAt = this.now + 1.5;
      const site = SITES[this.attackSite];
      const from = this.nearestWp(p.pos.x, p.pos.z);
      const to = this.attackSite === 'A' ? 13 : 15;
      this.autoPath = findPath(from, to);
      this.autoPathIdx = 0;
    }
    // Autopilot stuck detection: back off to a random nearby waypoint.
    if (this.autoStuckAt === undefined) { this.autoStuckAt = this.now; this.autoStuckX = p.pos.x; this.autoStuckZ = p.pos.z; }
    if (this.now - this.autoStuckAt > 2) {
      const moved = Math.hypot(p.pos.x - this.autoStuckX, p.pos.z - this.autoStuckZ);
      if (moved < 0.3) {
        const near = [];
        for (let i = 0; i < WAYPOINTS.length; i++) {
          const d = Math.hypot(WAYPOINTS[i][0] - p.pos.x, WAYPOINTS[i][1] - p.pos.z);
          if (d > 2 && d < 16) near.push(i);
        }
        if (near.length) {
          this.autoPath = findPath(this.nearestWp(p.pos.x, p.pos.z), near[Math.floor(rng() * near.length)]);
          this.autoPathIdx = 0;
        }
      }
      this.autoStuckAt = this.now; this.autoStuckX = p.pos.x; this.autoStuckZ = p.pos.z;
    }
    let gx = SITES[this.attackSite].x, gz = SITES[this.attackSite].z;
    if (this.autoPath && this.autoPathIdx < this.autoPath.length) {
      const node = WAYPOINTS[this.autoPath[this.autoPathIdx]];
      gx = node[0]; gz = node[1];
      if (Math.hypot(gx - p.pos.x, gz - p.pos.z) < 1) this.autoPathIdx++;
    }
    const dx = gx - p.pos.x, dz = gz - p.pos.z;
    const wantYaw = Math.atan2(dx, -dz);
    let dyaw = wantYaw - p.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    p.yaw += dyaw * Math.min(1, dt * 4);
    p.pitch += (0 - p.pitch) * Math.min(1, dt * 4);
    p.keys['KeyW'] = Math.abs(dyaw) < 0.8;
    p.keys['KeyA'] = false; p.keys['KeyD'] = false;
    // Plant when standing on the site.
    if (siteAt(p.pos.x, p.pos.z) && p.carrier && !this.bombPlanted) {
      this.holdingE = true;
    } else {
      this.holdingE = false;
    }
  }

  nearestWp(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i++) {
      const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  updateHUD(dt) {
    const p = this.player;
    this.hud.setAmmo(p.ammo.mag, p.ammo.reserve, p.weapon.name, p.reloading);
    this.hud.setHealth(p.hp, p.armor);
    this.hud.setMoney(p.money);
    this.hud.setTimer(this.phase === 'live' ? this.phaseT : this.phase === 'buy' ? this.phaseT : this.phase === 'roundEnd' ? 0 : this.phaseT, this.phase);
    this.hud.setScore(this.wins.vanguard, this.wins.crimson, this.wins.vanguard, this.wins.crimson);
    const vAlive = (p.alive ? 1 : 0) + this.bots.filter((b) => b.team === 'vanguard' && b.alive).length;
    const cAlive = this.bots.filter((b) => b.team === 'crimson' && b.alive).length;
    this.hud.setAlive(vAlive, cAlive);
    // Crosshair spread.
    const spread = 6 + p.spreadBloom * 260 + (p.weapon.spread * 400);
    this.hud.el['crosshair'].style.setProperty('--gap', spread + 'px');
    // Minimap at ~10 Hz.
    this.mmAt -= dt;
    if (this.mmAt <= 0) {
      this.mmAt = 0.1;
      this.hud.drawMinimap(p, this.bots.filter((b) => b.team === 'vanguard'), this.bots.filter((b) => b.team === 'crimson'),
        this.bombPlanted ? { planted: true, x: SITES[this.plantSite].x, z: SITES[this.plantSite].z } : null);
    }
    // Objective line during live play.
    if (this.phase === 'live' && !this.bombPlanted) {
      const site = siteAt(p.pos.x, p.pos.z);
      if (p.carrier && site) this.hud.setHint(`Hold E to plant the spike at Site ${site}`);
      else if (p.carrier) this.hud.setHint(`Carrying the spike — push Site ${this.attackSite}`);
    }
  }
}

new Game();
