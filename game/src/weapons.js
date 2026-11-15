// NEON BREACH — weapons.js
// Weapon definitions and the hitscan resolver shared by player and bots.
// A shot is a ray: nearest wall hit vs nearest actor hit-sphere wins.
import { rayHitWall, raySphere } from './world.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 34, headMult: 2.0, rpm: 320, auto: false,
    mag: 12, reserve: 48, reloadMs: 1100, spread: 0.011, moveSpread: 0.02,
    range: 60, falloff: 0.55, tracer: 0xffe9a8, kick: 0.35, zoom: 1,
  },
  vk9: {
    id: 'vk9', name: 'VK-9 SMG', kind: 'smg', price: 1500,
    damage: 26, headMult: 1.8, rpm: 780, auto: true,
    mag: 30, reserve: 120, reloadMs: 1600, spread: 0.02, moveSpread: 0.032,
    range: 45, falloff: 0.5, tracer: 0xffd166, kick: 0.5, zoom: 1,
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Rifle', kind: 'rifle', price: 2700,
    damage: 33, headMult: 2.0, rpm: 600, auto: true,
    mag: 30, reserve: 90, reloadMs: 1900, spread: 0.013, moveSpread: 0.026,
    range: 80, falloff: 0.65, tracer: 0xffe9a8, kick: 0.7, zoom: 1.25,
  },
  lr50: {
    id: 'lr50', name: 'LR-50 Marksman', kind: 'sniper', price: 4750,
    damage: 88, headMult: 2.2, rpm: 55, auto: false,
    mag: 5, reserve: 15, reloadMs: 2400, spread: 0.002, moveSpread: 0.05,
    range: 120, falloff: 0.9, tracer: 0x9fd8ff, kick: 1.6, zoom: 2.2,
  },
};

export const ARMOR_PRICE = 650;
export const ARMOR_POINTS = 50;

// Hit spheres for an actor standing at (x, z), feet y=0.
export function hitSpheres(actor) {
  return [
    { part: 'head', c: { x: actor.pos.x, y: 1.62, z: actor.pos.z }, r: 0.24 },
    { part: 'body', c: { x: actor.pos.x, y: 0.95, z: actor.pos.z }, r: 0.48 },
  ];
}

// Resolve one hitscan shot.
// origin, dir: THREE-like {x,y,z} (dir normalized). actors: alive actors to test.
// shooter: the actor firing (excluded). Returns {hit, victim, part, damage, point, wallDist}.
export function resolveShot(origin, dir, weapon, actors, shooter, boxes) {
  const wallT = rayHitWall(origin, dir, weapon.range, boxes);
  let best = { t: wallT, victim: null, part: null };
  for (const a of actors) {
    if (a === shooter || !a.alive) continue;
    for (const s of hitSpheres(a)) {
      const t = raySphere(origin, dir, s.c, s.r);
      if (t < best.t) best = { t, victim: a, part: s.part };
    }
  }
  // If nothing was hit, the shot flies to the weapon's max range (never
  // Infinity — that would poison the tracer with NaN).
  const t = Number.isFinite(best.t) ? best.t : weapon.range;
  const point = {
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
    z: origin.z + dir.z * t,
  };
  if (!best.victim) return { hit: false, point, wallDist: wallT };
  let dmg = weapon.damage * (best.part === 'head' ? weapon.headMult : 1);
  const dist = best.t;
  if (dist > weapon.range * 0.5) dmg *= weapon.falloff + (1 - weapon.falloff) * (1 - dist / weapon.range);
  return { hit: true, victim: best.victim, part: best.part, damage: Math.round(dmg), point, wallDist: wallT };
}

// Armor absorbs 60% of damage until depleted.
export function applyDamage(victim, dmg) {
  let remaining = dmg;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.round(dmg * 0.6));
    victim.armor -= absorbed;
    remaining = dmg - absorbed;
  }
  victim.hp = Math.max(0, victim.hp - remaining);
  if (victim.hp <= 0) victim.alive = false;
  return remaining;
}
