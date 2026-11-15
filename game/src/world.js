// NEON BREACH — world.js
// The map: "Sector 7 Foundry", a two-site tactical arena (64 x 44 m).
// Two lanes + mid, Site A (west) and Site B (east), Vanguard spawns south,
// Crimson spawns north. All collision is axis-aligned boxes; the renderer
// builds matching meshes so what you see is what blocks you.
import * as THREE from 'three';

export const ARENA = { minX: -32, maxX: 32, minZ: -22, maxZ: 22, wallH: 4.5 };

export const SITES = {
  A: { x: -24, z: -14, r: 5.5, color: 0x35d0ff, label: 'A' },
  B: { x: 24, z: -14, r: 5.5, color: 0xffb020, label: 'B' },
};

// Interior cover. {x, z} is the centre, w along x, d along z, h height.
export const BLOCKS = [
  { x: -20, z: 0, w: 4, d: 12, h: 3.2, tone: 0x39404d },   // west mid wall
  { x: 20, z: 0, w: 4, d: 12, h: 3.2, tone: 0x39404d },    // east mid wall
  { x: -8, z: -12, w: 10, d: 2, h: 2.6, tone: 0x2e3440 },  // upper-left barricade
  { x: 8, z: -12, w: 10, d: 2, h: 2.6, tone: 0x2e3440 },   // upper-right barricade
  { x: 0, z: 8, w: 8, d: 2, h: 2.2, tone: 0x2e3440 },      // lower-mid barricade
  { x: -26, z: -14, w: 4, d: 4, h: 2.4, tone: 0x3a2f22 },  // A site crate
  { x: 26, z: -14, w: 4, d: 4, h: 2.4, tone: 0x3a2f22 },   // B site crate
  { x: -12, z: 6, w: 3, d: 3, h: 1.6, tone: 0x4a3b28 },    // crate
  { x: 12, z: 6, w: 3, d: 3, h: 1.6, tone: 0x4a3b28 },     // crate
  { x: -24, z: 8, w: 6, d: 2, h: 2.0, tone: 0x2e3440 },    // lower-left barricade
  { x: 24, z: 8, w: 6, d: 2, h: 2.0, tone: 0x2e3440 },     // lower-right barricade
  { x: -11, z: -17, w: 4, d: 3, h: 3.0, tone: 0x39404d },  // top-mid pillar (west of the lane, so the lane stays open)
  { x: -28, z: -11, w: 2, d: 6, h: 2.2, tone: 0x2e3440 },  // west flank wall
  { x: 28, z: -11, w: 2, d: 6, h: 2.2, tone: 0x2e3440 },   // east flank wall
  { x: 0, z: 0, w: 6, d: 2, h: 1.4, tone: 0x4a3b28 },      // mid crate (low, shoot over)
];

export const SPAWNS = {
  vanguard: [[-6, 18], [0, 19.5], [6, 18]],
  crimson: [[-6, -18], [0, -19.5], [6, -18]],
};

// Waypoint graph bots navigate on. Nodes are open floor; edges are walkable.
export const WAYPOINTS = [
  [-6, 18], [0, 19.5], [6, 18],          // 0-2  Vanguard spawn
  [-14, 10], [0, 12], [14, 10],          // 3-5  lower lanes
  [-26, 2], [-8, 2], [8, 2], [26, 2],    // 6-9  mid band
  [-14, -6], [0, -4], [14, -6],          // 10-12 upper lanes
  [-24, -14], [0, -14], [24, -14],       // 13-15 sites + top mid
  [-6, -18], [0, -19.5], [6, -18],       // 16-18 Crimson spawn
  [-30, -9], [30, -9],                   // 19-20 flanks (south of the mid walls, clear of the flank walls)
];
export const EDGES = [
  [0, 3], [1, 4], [2, 5],
  [3, 6], [3, 7], [4, 7], [4, 8], [5, 8], [5, 9],
  [6, 19], [7, 10], [7, 11], [8, 11], [8, 12], [9, 20],
  [10, 13], [10, 19], [11, 14], [12, 15], [12, 20],
  [13, 14], [14, 15],
  [10, 16], [14, 17], [12, 18], [16, 17], [17, 18],
  [0, 1], [1, 2], [3, 4], [4, 5], [7, 8], [10, 11], [11, 12],
];

// ---------------------------------------------------------------------------
// Collision + ray helpers (pure math, no three.js objects needed)
// ---------------------------------------------------------------------------

export function colliders() {
  const list = [];
  for (const b of BLOCKS) {
    list.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h,
    });
  }
  // Perimeter walls.
  const t = 1, H = ARENA.wallH;
  list.push({ minX: ARENA.minX - t, maxX: ARENA.minX, minZ: ARENA.minZ - t, maxZ: ARENA.maxZ + t, h: H });
  list.push({ minX: ARENA.maxX, maxX: ARENA.maxX + t, minZ: ARENA.minZ - t, maxZ: ARENA.maxZ + t, h: H });
  list.push({ minX: ARENA.minX - t, maxX: ARENA.maxX + t, minZ: ARENA.minZ - t, maxZ: ARENA.minZ, h: H });
  list.push({ minX: ARENA.minX - t, maxX: ARENA.maxX + t, minZ: ARENA.maxZ, maxZ: ARENA.maxZ + t, h: H });
  return list;
}

// Move a circle (x,z,r) with velocity (dx,dz) for one step, sliding on boxes.
export function moveCircle(pos, dx, dz, r, boxes) {
  let nx = pos.x + dx;
  for (const b of boxes) {
    if (nx + r > b.minX && nx - r < b.maxX && pos.z + r > b.minZ && pos.z - r < b.maxZ) {
      nx = dx > 0 ? b.minX - r : b.maxX + r;
    }
  }
  let nz = pos.z + dz;
  for (const b of boxes) {
    if (nx + r > b.minX && nx - r < b.maxX && nz + r > b.minZ && nz - r < b.maxZ) {
      nz = dz > 0 ? b.minZ - r : b.maxZ + r;
    }
  }
  pos.x = nx; pos.z = nz;
}

function rayBox(o, d, b) {
  // Slab test against a vertical prism (y from 0 to b.h). Returns t or Infinity.
  let tmin = 0, tmax = Infinity;
  const axes = [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, 0, b.h],
    [o.z, d.z, b.minZ, b.maxZ],
  ];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < mn || oo > mx) return Infinity;
    } else {
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function rayHitWall(o, d, maxDist, boxes) {
  let best = Infinity;
  for (const b of boxes) {
    const t = rayBox(o, d, b);
    if (t < best && t <= maxDist) best = t;
  }
  return best;
}

export function raySphere(o, d, c, r) {
  const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z;
  const tca = ox * d.x + oy * d.y + oz * d.z;
  if (tca < 0) return Infinity;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

export function siteAt(x, z) {
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return key;
  }
  return null;
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// BFS shortest path on the waypoint graph.
export function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of EDGES) {
      const nb = a === cur ? b : b === cur ? a : -1;
      if (nb >= 0 && prev[nb] === -1) {
        prev[nb] = cur;
        if (nb === to) {
          const path = [to];
          let n = to;
          while (n !== from) { n = prev[n]; path.unshift(n); }
          return path;
        }
        queue.push(nb);
      }
    }
  }
  return [to];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 704;
  const g = c.getContext('2d');
  g.fillStyle = '#23272f'; g.fillRect(0, 0, 1024, 704);
  // Asphalt noise.
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
    g.fillRect(Math.random() * 1024, Math.random() * 704, 2, 2);
  }
  // Grid lines every 4 m (64 px).
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let x = 0; x <= 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 704); g.stroke(); }
  for (let y = 0; y <= 704; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  // Centre line + hazard stripes at sites.
  const px = (x) => (x + 32) / 64 * 1024;
  const pz = (z) => (z + 22) / 44 * 704;
  g.strokeStyle = 'rgba(240,168,48,0.55)'; g.lineWidth = 3; g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(px(0), pz(-22)); g.lineTo(px(0), pz(22)); g.stroke();
  g.setLineDash([]);
  for (const s of Object.values(SITES)) {
    g.strokeStyle = s.color === 0x35d0ff ? 'rgba(53,208,255,0.8)' : 'rgba(255,176,32,0.8)';
    g.lineWidth = 4;
    g.beginPath(); g.arc(px(s.x), pz(s.z), s.r / 64 * 1024, 0, Math.PI * 2); g.stroke();
    g.font = 'bold 90px system-ui, sans-serif';
    g.fillStyle = g.strokeStyle;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.label, px(s.x), pz(s.z));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const boxes = colliders();
  const group = new THREE.Group();
  scene.add(group);

  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 55, 130);

  const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x1a1410, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.0);
  sun.position.set(30, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4d7cff, 0.5);
  fill.position.set(-25, 30, -20);
  scene.add(fill);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 44),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Perimeter walls.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.9 });
  const mkWall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  mkWall(66, ARENA.wallH, 1, 0, ARENA.wallH / 2, -22.5);
  mkWall(66, ARENA.wallH, 1, 0, ARENA.wallH / 2, 22.5);
  mkWall(1, ARENA.wallH, 46, -32.5, ARENA.wallH / 2, 0);
  mkWall(1, ARENA.wallH, 46, 32.5, ARENA.wallH / 2, 0);
  // Orange trim strips along the top of the perimeter.
  const trimGeo = new THREE.BoxGeometry(66, 0.12, 0.12);
  for (const z of [-22.5, 22.5]) {
    const t = new THREE.Mesh(trimGeo, new THREE.MeshStandardMaterial({ color: 0xf0a830, emissive: 0xf0a830, emissiveIntensity: 0.7 }));
    t.position.set(0, ARENA.wallH + 0.06, z);
    group.add(t);
  }

  // Interior blocks with edge highlights.
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x11141a, transparent: true, opacity: 0.6 });
  for (const b of BLOCKS) {
    const mat = new THREE.MeshStandardMaterial({ color: b.tone, roughness: 0.85, metalness: 0.15 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
    edges.position.copy(mesh.position);
    group.add(edges);
    // Hazard stripe on tall blocks.
    if (b.h >= 2.6) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.04, 0.18, b.d + 0.04),
        new THREE.MeshStandardMaterial({ color: 0xf0a830, emissive: 0xf0a830, emissiveIntensity: 0.35 }),
      );
      stripe.position.set(b.x, b.h - 0.25, b.z);
      group.add(stripe);
    }
  }

  // Site beacons: glowing pillars + floating rings.
  const beacons = {};
  for (const [key, s] of Object.entries(SITES)) {
    const mat = new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 7, 32, 1, true), mat);
    pillar.position.set(s.x, 3.5, s.z);
    group.add(pillar);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(s.r * 0.55, 0.07, 8, 48),
      new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 1.4 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(s.x, 2.6, s.z);
    group.add(ring);
    const light = new THREE.PointLight(s.color, 12, 18);
    light.position.set(s.x, 3, s.z);
    group.add(light);
    beacons[key] = { ring, light, pillar };
  }

  // Floating dust.
  const dustGeo = new THREE.BufferGeometry();
  const N = 260;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 64;
    pos[i * 3 + 1] = 0.3 + Math.random() * 7;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 44;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.06, transparent: true, opacity: 0.5 }));
  group.add(dust);

  // Distant skyline silhouettes outside the walls.
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x11151d });
  for (let i = 0; i < 26; i++) {
    const w = 4 + Math.random() * 8, h = 8 + Math.random() * 22, d = 4 + Math.random() * 6;
    const ang = (i / 26) * Math.PI * 2;
    const r = 52 + Math.random() * 22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skyMat);
    b.position.set(Math.cos(ang) * r, h / 2 - 0.5, Math.sin(ang) * r);
    group.add(b);
    if (Math.random() < 0.6) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.7, h * 0.5),
        new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.25 }),
      );
      win.position.set(b.position.x, h * 0.45, b.position.z);
      win.lookAt(0, h * 0.45, 0);
      group.add(win);
    }
  }

  function update(t) {
    for (const b of Object.values(beacons)) {
      b.ring.position.y = 2.6 + Math.sin(t * 1.4) * 0.35;
      b.ring.rotation.z = t * 0.5;
      b.light.intensity = 10 + Math.sin(t * 2.2) * 3;
      b.pillar.material.opacity = 0.13 + Math.sin(t * 1.8) * 0.04;
    }
    dust.rotation.y = t * 0.004;
  }

  return { group, boxes, beacons, update };
}
