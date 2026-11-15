// NEON BREACH — bots.js
// Bot brains: waypoint navigation, line-of-sight duels, site holds, plant/defuse.
// One bot = one actor; the player is an actor too, so the same combat code
// serves everyone. Bots have reaction time, aim error and burst discipline
// so fights feel like people, not aimbots.
import * as THREE from 'three';
import { WAYPOINTS, EDGES, nearestWaypoint, findPath, moveCircle, rayHitWall } from './world.js';
import { WEAPONS, resolveShot, applyDamage } from './weapons.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  vanguard: ['VEX', 'NOVA'],
  crimson: ['RAZOR', 'GHOST', 'HAVOC'],
};

export function makeBotMesh(team) {
  const color = team === 'vanguard' ? 0x3fa9ff : 0xff4d5e;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.8 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.2, metalness: 0.8, emissive: color, emissiveIntensity: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.0, 10), bodyMat);
  body.position.y = 0.95; body.castShadow = true;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.34), darkMat);
  chest.position.set(0, 1.15, 0); chest.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), darkMat);
  head.position.y = 1.66; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1), visorMat);
  visor.position.set(0, 1.67, 0.19);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.24), darkMat);
  legL.position.set(-0.16, 0.25, 0);
  const legR = legL.clone(); legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.4, metalness: 0.7 }));
  gun.position.set(0.22, 1.25, 0.35);
  // Team ring on the ground + floating name tag colour.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  g.add(body, chest, head, visor, legL, legR, gun, ring);
  g.userData = { gun, legL, legR, head, ring };
  return g;
}

export class Bot {
  constructor(team, index, scene, rng) {
    this.team = team;
    this.index = index;
    this.name = NAMES[team][index % NAMES[team].length];
    this.rng = rng;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.weapon = WEAPONS.p9;
    this.mag = this.weapon.mag;
    this.reserve = this.weapon.reserve;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShotAt = 0;
    this.burstLeft = 0;
    this.state = 'advance';
    this.path = [];
    this.pathIdx = 0;
    this.goalNode = 0;
    this.holdUntil = 0;
    this.target = null;       // actor currently engaged
    this.acquireAt = 0;       // when the current target was acquired
    this.lastShotAt = 0;
    this.lastSeenAt = 0;      // for the minimap "spotted" logic
    this.speed = 3.4;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.carrier = false;
    this.walkPhase = 0;
    this.stuckAt = 0;        // last position sample for stuck detection
    this.stuckCheckAt = 0;
    this.detourUntil = 0;
    this.mesh = makeBotMesh(team);
    scene.add(this.mesh);
  }

  reset(x, z, yaw, weaponId) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.weapon = WEAPONS[weaponId] || WEAPONS.p9;
    this.mag = this.weapon.mag;
    this.reserve = this.weapon.reserve;
    this.reloading = false;
    this.nextShotAt = 0; this.burstLeft = 0;
    this.state = 'advance';
    this.path = []; this.pathIdx = 0;
    this.target = null;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.carrier = false;
    this.mesh.visible = true;
    this.mesh.position.copy(this.pos);
  }

  eyePos() {
    return { x: this.pos.x, y: 1.55, z: this.pos.z };
  }

  hasLOS(target, boxes) {
    const o = this.eyePos();
    const t = { x: target.pos.x, y: 1.3, z: target.pos.z };
    const dx = t.x - o.x, dy = t.y - o.y, dz = t.z - o.z;
    const dist = Math.hypot(dx, dy, dz);
    const d = { x: dx / dist, y: dy / dist, z: dz / dist };
    const wallT = rayHitWall(o, d, dist, boxes);
    return wallT >= dist;
  }

  nearestEnemy(actors) {
    let best = null, bd = Infinity;
    for (const a of actors) {
      if (a.team === this.team || !a.alive) continue;
      const d = (a.pos.x - this.pos.x) ** 2 + (a.pos.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // Pick a destination node by role.
  chooseGoal(ctx) {
    const r = this.rng;
    if (this.team === 'crimson') {
      if (ctx.bombPlanted && ctx.plantSite) {
        // Rotate to the planted site.
        this.goalNode = ctx.plantSite === 'A' ? 13 : 15;
        return;
      }
      // Defenders: hold a site or roam mid.
      if (this.index === 0) this.goalNode = 13;                    // A anchor
      else if (this.index === 1) this.goalNode = 15;               // B anchor
      else this.goalNode = [11, 7, 8][Math.floor(r() * 3)];        // mid roamer
    } else {
      // Attackers: push a site together; carrier goes to the plant spot.
      const site = ctx.attackSite || (r() < 0.5 ? 'A' : 'B');
      if (this.carrier) this.goalNode = site === 'A' ? 13 : 15;
      else this.goalNode = site === 'A'
        ? [10, 13, 6][Math.floor(r() * 3)]
        : [12, 15, 9][Math.floor(r() * 3)];
    }
  }

  setPathTo(node) {
    const from = nearestWaypoint(this.pos.x, this.pos.z);
    this.path = findPath(from, node);
    this.pathIdx = 0;
  }

  update(dt, now, ctx) {
    if (!this.alive) { this.mesh.visible = false; return; }
    const { boxes, actors, rng } = ctx;

    // Reloading.
    if (this.reloading && now >= this.reloadEnd) {
      const need = this.weapon.mag - this.mag;
      const take = Math.min(need, this.reserve);
      this.mag += take; this.reserve -= take;
      this.reloading = false;
    }

    // --- Target acquisition (live rounds only) ---
    const enemy = ctx.phase === 'live' ? this.nearestEnemy(actors) : null;
    let visible = null;
    if (enemy) {
      const dist = Math.hypot(enemy.pos.x - this.pos.x, enemy.pos.z - this.pos.z);
      if (dist < 42 && this.hasLOS(enemy, boxes)) visible = enemy;
    }
    if (visible) {
      if (this.target !== visible) { this.target = visible; this.acquireAt = now + 0.35 + rng() * 0.4; }
      this.lastSeenAt = now;
    } else if (this.target && now - this.lastSeenAt > 1.2) {
      this.target = null;
    }

    // --- Bomb duties ---
    if (this.carrier && ctx.phase === 'live' && !ctx.bombPlanted) {
      const site = ctx.siteAt(this.pos.x, this.pos.z);
      if (site) {
        this.plantProgress += dt;
        ctx.onPlantTick?.(this, this.plantProgress);
        if (this.plantProgress >= 3) { ctx.onPlanted?.(this, site); this.plantProgress = 0; }
        this.state = 'planting';
        this.faceToward(this.pos.x, this.pos.z - 1);
        this.syncMesh(dt);
        return;
      }
    }
    if (this.team === 'crimson' && ctx.bombPlanted && ctx.plantSite) {
      const s = ctx.plantSite === 'A' ? { x: -24, z: -14 } : { x: 24, z: -14 };
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < 1.6 && !this.target) {
        this.defuseProgress += dt;
        ctx.onDefuseTick?.(this, this.defuseProgress);
        if (this.defuseProgress >= 5) { ctx.onDefused?.(this); this.defuseProgress = 0; }
        this.state = 'defusing';
        this.syncMesh(dt);
        return;
      }
      this.defuseProgress = 0;
    }
    this.plantProgress = 0;

    // --- Combat ---
    if (this.target && now >= this.acquireAt) {
      this.state = 'engage';
      const t = this.target;
      this.faceToward(t.pos.x, t.pos.z);
      const dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      // Strafe while duelling.
      if (now > this.strafeUntil) { this.strafeDir = rng() < 0.5 ? -1 : 1; this.strafeUntil = now + 0.5 + rng() * 0.8; }
      const strafe = Math.sin(this.yaw) * this.strafeDir;
      const fwd = dist > 14 ? 1 : dist < 6 ? -0.6 : 0;
      const mx = Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * this.strafeDir * 0.55;
      const mz = -Math.cos(this.yaw) * fwd + Math.sin(this.yaw) * this.strafeDir * 0.55;
      moveCircle(this.pos, mx * this.speed * 0.7 * dt, mz * this.speed * 0.7 * dt, 0.45, boxes);
      this.walkPhase += dt * 7;
      // Burst fire.
      if (now >= this.nextShotAt) {
        if (this.mag <= 0) {
          if (!this.reloading && this.reserve > 0) { this.reloading = true; this.reloadEnd = now + this.weapon.reloadMs / 1000; }
        } else if (this.burstLeft <= 0) {
          this.burstLeft = this.weapon.auto ? 3 + Math.floor(rng() * 3) : 1;
          this.nextShotAt = now + (this.weapon.auto ? 0.55 + rng() * 0.5 : 0.9 + rng() * 0.6);
        } else {
          this.fireAt(t, ctx);
          this.burstLeft--;
          this.nextShotAt = now + 60 / this.weapon.rpm;
        }
      }
      this.syncMesh(dt);
      return;
    }

    // --- Navigation ---
    this.state = 'advance';
    // Stuck detection: if we barely moved in 1.5 s while advancing, detour
    // to a random nearby waypoint instead of pushing into a wall forever.
    if (now >= this.stuckCheckAt) {
      const moved = Math.hypot(this.pos.x - (this.stuckAtX ?? this.pos.x), this.pos.z - (this.stuckAtZ ?? this.pos.z));
      if (this.stuckAtX !== undefined && moved < 0.25 && this.path.length && now > this.detourUntil) {
        const near = [];
        for (let i = 0; i < WAYPOINTS.length; i++) {
          const d = Math.hypot(WAYPOINTS[i][0] - this.pos.x, WAYPOINTS[i][1] - this.pos.z);
          if (d > 2 && d < 16) near.push(i);
        }
        if (near.length) {
          const detour = near[Math.floor(this.rng() * near.length)];
          this.setPathTo(detour);
          this.detourUntil = now + 3;
        }
      }
      this.stuckAtX = this.pos.x; this.stuckAtZ = this.pos.z;
      this.stuckCheckAt = now + 1.5;
    }
    if (!this.path.length || this.pathIdx >= this.path.length) {
      if (now >= this.holdUntil) {
        this.chooseGoal(ctx);
        this.setPathTo(this.goalNode);
        // Defenders linger on site.
        if (this.team === 'crimson' && !ctx.bombPlanted) this.holdUntil = now + 2 + rng() * 4;
      }
      this.syncMesh(dt);
      return;
    }
    const node = WAYPOINTS[this.path[this.pathIdx]];
    const dx = node[0] - this.pos.x, dz = node[1] - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) { this.pathIdx++; this.syncMesh(dt); return; }
    const sp = this.speed * (this.state === 'advance' ? 1 : 0.8);
    moveCircle(this.pos, (dx / dist) * sp * dt, (dz / dist) * sp * dt, 0.45, boxes);
    this.faceToward(node[0], node[1]);
    this.walkPhase += dt * 9;
    this.syncMesh(dt);
  }

  faceToward(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const target = Math.atan2(dx, -dz);
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * 0.25;
  }

  fireAt(target, ctx) {
    const w = this.weapon;
    this.mag--;
    this.lastShotAt = ctx.now;
    this.lastSeenAt = ctx.now;
    const o = this.eyePos();
    // Aim at the target's chest with error scaled by distance and movement.
    const dist = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    const err = (0.03 + dist * 0.0016 + (this.weapon.kind === 'sniper' ? 0.008 : 0.02)) * (0.7 + this.rng() * 0.6);
    const aimY = 1.15 + (this.rng() < 0.14 ? 0.45 : 0); // occasional head-level shot
    const tx = target.pos.x + (this.rng() - 0.5) * err * dist * 2;
    const ty = aimY + (this.rng() - 0.5) * err * dist;
    const tz = target.pos.z + (this.rng() - 0.5) * err * dist * 2;
    let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
    const len = Math.hypot(dx, dy, dz);
    dx /= len; dy /= len; dz /= len;
    const res = resolveShot(o, { x: dx, y: dy, z: dz }, w, ctx.actors, this, ctx.boxes);
    const muzzle = { x: o.x + dx * 0.6, y: o.y - 0.12, z: o.z + dz * 0.6 };
    ctx.onShot?.(this, muzzle, res.point, w);
    if (res.hit) {
      const dealt = applyDamage(res.victim, res.damage);
      ctx.onHit?.(this, res.victim, res.part, res.damage, dealt, res.point);
      if (!res.victim.alive) ctx.onKill?.(this, res.victim, res.part);
    }
  }

  syncMesh(dt) {
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.yaw;
    const s = Math.sin(this.walkPhase);
    this.mesh.userData.legL.position.z = s * 0.14;
    this.mesh.userData.legR.position.z = -s * 0.14;
    this.mesh.userData.gun.position.y = 1.25 + Math.abs(s) * 0.02;
  }
}
