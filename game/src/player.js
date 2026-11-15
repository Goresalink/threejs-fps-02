// NEON BREACH — player.js
// The human player: pointer-lock mouse look, WASD, jump/crouch, weapons,
// reload, plant/defuse, and the autopilot used for demo screenshots.
import * as THREE from 'three';
import { moveCircle } from './world.js';
import { WEAPONS, resolveShot, applyDamage } from './weapons.js';

export class Player {
  constructor(camera, scene) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 18);
    this.yaw = Math.PI; // facing north (-z) at spawn... yaw 0 faces -z; spawn faces north
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.team = 'vanguard';
    this.name = 'YOU';
    this.money = 800;
    this.weapons = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
    this.current = 'p9';
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShotAt = 0;
    this.firing = false;
    this.keys = {};
    this.locked = false;
    this.crouching = false;
    this.onGround = true;
    this.vy = 0;
    this.spreadBloom = 0;
    this.recoil = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.carrier = true;
    this.kills = 0;
    this.deaths = 0;
    this.lastDamageAt = 0;
    this.lastDamageDir = 0;
    this.stepPhase = 0;
    this.autopilot = null; // Bot-like driver for demo mode

    // View-model gun: slim, angled, with a lit edge so it reads at night.
    this.gun = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.45, metalness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.4, metalness: 0.4, emissive: 0xf0a830, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.4), dark);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), dark);
    handguard.position.set(0, -0.005, -0.26);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, -0.44);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), dark);
    grip.position.set(0, -0.09, 0.13); grip.rotation.x = 0.3;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.012, 0.3), accent);
    stripe.position.set(0, 0.042, -0.05);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.035, 0.02), accent);
    sight.position.set(0, 0.055, -0.14);
    this.gun.add(body, handguard, barrel, grip, stripe, sight);
    this.gun.scale.setScalar(0.5);
    this.gun.position.set(0.3, -0.27, -0.55);
    this.gun.rotation.y = 0.05;
    this.camera.add(this.gun);
    scene.add(this.camera);
  }

  get weapon() { return WEAPONS[this.current]; }
  get ammo() { return this.weapons[this.current]; }
  get eyeY() { return this.crouching ? 1.15 : 1.55; }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw; this.pitch = 0;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.weapons = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
    this.current = 'p9';
    this.reloading = false;
    this.nextShotAt = 0;
    this.carrier = true;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.kills = 0; this.deaths = 0;
    this.vy = 0;
  }

  buy(weaponId) {
    const w = WEAPONS[weaponId];
    if (!w || w.price === 0) return false;
    if (this.weapons[weaponId] || this.money < w.price) return false;
    this.money -= w.price;
    this.weapons[weaponId] = { mag: w.mag, reserve: w.reserve };
    this.current = weaponId;
    this.reloading = false;
    return true;
  }

  buyArmor() {
    if (this.armor >= 50 || this.money < 650) return false;
    this.money -= 650;
    this.armor = 50;
    return true;
  }

  switchWeapon(id) {
    if (this.weapons[id] && id !== this.current) {
      this.current = id;
      this.reloading = false;
      return true;
    }
    return false;
  }

  startReload(now) {
    const w = this.weapon, a = this.ammo;
    if (this.reloading || a.mag >= w.mag || a.reserve <= 0) return false;
    this.reloading = true;
    this.reloadEnd = now + w.reloadMs / 1000;
    return true;
  }

  tryFire(now, ctx) {
    const w = this.weapon, a = this.ammo;
    if (!this.alive || this.reloading || now < this.nextShotAt) return;
    if (a.mag <= 0) { ctx.onDryFire?.(); this.nextShotAt = now + 0.3; return; }
    a.mag--;
    this.nextShotAt = now + 60 / w.rpm;
    this.spreadBloom = Math.min(0.05, this.spreadBloom + (w.auto ? 0.004 : 0.012));
    this.recoil = Math.min(0.06, this.recoil + w.kick * 0.012);
    // Direction from camera with spread.
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const moving = Math.hypot(ctx.moveX || 0, ctx.moveZ || 0) > 0.1;
    const spread = (w.spread + (moving ? w.moveSpread : 0) + this.spreadBloom) * (this.crouching ? 0.7 : 1);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const origin = { x: this.pos.x, y: this.eyeY, z: this.pos.z };
    const res = resolveShot(origin, { x: dir.x, y: dir.y, z: dir.z }, w, ctx.actors, this, ctx.boxes);
    const muzzle = {
      x: this.pos.x + dir.x * 0.7, y: this.eyeY - 0.1, z: this.pos.z + dir.z * 0.7,
    };
    ctx.onShot?.(this, muzzle, res.point, w);
    if (res.hit) {
      const dealt = applyDamage(res.victim, res.damage);
      ctx.onHit?.(this, res.victim, res.part, res.damage, dealt, res.point);
      if (!res.victim.alive) { this.kills++; ctx.onKill?.(this, res.victim, res.part); }
    }
  }

  takeHit(fromPos, dmg) {
    this.lastDamageAt = performance.now() / 1000;
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const ang = Math.atan2(dx, -dz);
    this.lastDamageDir = ang - this.yaw;
  }

  update(dt, now, ctx) {
    if (!this.alive) return;
    // Reload finish.
    if (this.reloading && now >= this.reloadEnd) {
      const w = this.weapon, a = this.ammo;
      const take = Math.min(w.mag - a.mag, a.reserve);
      a.mag += take; a.reserve -= take;
      this.reloading = false;
    }
    this.spreadBloom = Math.max(0, this.spreadBloom - dt * 0.05);
    this.recoil = Math.max(0, this.recoil - dt * 0.25);

    // Movement input.
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k['KeyW']) iz -= 1;
    if (k['KeyS']) iz += 1;
    if (k['KeyA']) ix -= 1;
    if (k['KeyD']) ix += 1;
    const walking = k['ShiftLeft'] || k['ShiftRight'];
    const speed = this.crouching ? 1.9 : walking ? 2.6 : 4.6;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len; iz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const mx = (ix * cos - iz * sin) * speed;
    const mz = (ix * sin + iz * cos) * speed;
    moveCircle(this.pos, mx * dt, mz * dt, 0.45, ctx.boxes);
    ctx.moveX = mx; ctx.moveZ = mz;

    // Jump / gravity.
    if (k['Space'] && this.onGround) { this.vy = 5.2; this.onGround = false; }
    if (!this.onGround) {
      this.vy -= 14 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.onGround = true; }
    }
    if (Math.hypot(mx, mz) > 0.5 && this.onGround) {
      this.stepPhase += dt * 9;
      if (Math.sin(this.stepPhase) > 0.96) ctx.onStep?.();
    }

    // Firing.
    if (this.firing && this.weapon.auto) this.tryFire(now, ctx);

    // Camera.
    const bob = Math.hypot(mx, mz) > 0.5 && this.onGround ? Math.sin(this.stepPhase) * 0.03 : 0;
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeY + bob, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoil;
    this.camera.rotation.z = 0;
    // View-model sway + recoil kick.
    this.gun.position.z = -0.55 + this.recoil * 1.2;
    this.gun.position.x = 0.3 + Math.sin(this.stepPhase) * 0.003;
    this.gun.rotation.x = this.recoil * 2.5;
  }
}
