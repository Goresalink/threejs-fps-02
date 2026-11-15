// NEON BREACH — effects.js
// Tracers, impact sparks, muzzle flashes and the bomb explosion.
// Everything is pooled so a long match never allocates per shot.
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.sparks = [];
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(90), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.14, transparent: true, opacity: 0 });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      scene.add(pts);
      this.sparks.push({ pts, life: 0, vel: new Float32Array(90) });
    }
    this.flashLight = new THREE.PointLight(0xffc46b, 0, 14);
    scene.add(this.flashLight);
    this.flashLife = 0;
    this.flashPos = new THREE.Vector3();
    this.boomLight = new THREE.PointLight(0xff7a2a, 0, 60);
    scene.add(this.boomLight);
    this.boomLife = 0;
  }

  tracer(from, to, color = 0xffe9a8) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.life = 0.09;
  }

  impact(point, color = 0xffc46b) {
    const s = this.sparks.find((x) => x.life <= 0) || this.sparks[0];
    const p = s.pts.geometry.attributes.position.array;
    for (let i = 0; i < 30; i++) {
      p[i * 3] = point.x; p[i * 3 + 1] = point.y; p[i * 3 + 2] = point.z;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const sp = 2 + Math.random() * 4;
      s.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      s.vel[i * 3 + 1] = Math.cos(ph) * sp;
      s.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.color.setHex(color);
    s.life = 0.35;
  }

  muzzle(pos) {
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 26;
    this.flashLife = 0.05;
  }

  explosion(pos) {
    this.boomLight.position.set(pos.x, 1.5, pos.z);
    this.boomLight.intensity = 400;
    this.boomLife = 0.9;
    this.impact({ x: pos.x, y: 1, z: pos.z }, 0xff7a2a);
    this.impact({ x: pos.x, y: 2, z: pos.z }, 0xffd166);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      } else t.line.material.opacity = 0;
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        const p = s.pts.geometry.attributes.position.array;
        for (let i = 0; i < 30; i++) {
          p[i * 3] += s.vel[i * 3] * dt;
          p[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
          p[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
          s.vel[i * 3 + 1] -= 9 * dt;
        }
        s.pts.geometry.attributes.position.needsUpdate = true;
        s.pts.material.opacity = Math.max(0, s.life / 0.35);
      } else s.pts.material.opacity = 0;
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flashLight.intensity = 0;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      this.boomLight.intensity = Math.max(0, this.boomLife / 0.9) * 400;
    }
  }
}
