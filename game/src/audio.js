// NEON BREACH — audio.js
// All sounds are synthesized with WebAudio: no audio assets, no network.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  _noise(dur) {
    const buf = this.ctx.createBuffer(1, Math.max(1, this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ensure() || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  _tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!this.ensure() || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  shot(kind) {
    if (kind === 'sniper') { this._burst(0.28, 900, 0.9); this._tone(120, 0.18, 0.5, 'square', 40); }
    else if (kind === 'rifle') { this._burst(0.12, 1400, 0.7); this._tone(160, 0.07, 0.35, 'square', 70); }
    else if (kind === 'smg') { this._burst(0.08, 1800, 0.5); this._tone(200, 0.05, 0.25, 'square', 90); }
    else { this._burst(0.1, 1200, 0.6); this._tone(140, 0.06, 0.3, 'square', 60); }
  }

  distantShot() { this._burst(0.14, 700, 0.18); }
  dryFire() { this._tone(900, 0.04, 0.2, 'square'); }
  reload() {
    this._tone(500, 0.05, 0.25, 'square');
    setTimeout(() => this._tone(700, 0.05, 0.25, 'square'), 350);
    setTimeout(() => this._tone(420, 0.06, 0.3, 'square'), 700);
  }
  hit() { this._tone(1900, 0.05, 0.3, 'sine'); }
  kill() { this._tone(660, 0.09, 0.35, 'sine'); setTimeout(() => this._tone(990, 0.14, 0.35, 'sine'), 80); }
  hurt() { this._tone(220, 0.12, 0.3, 'sawtooth', 110); }
  plantBeep(final = false) { this._tone(final ? 1320 : 880, 0.09, 0.3, 'square'); }
  defuseBeep() { this._tone(1100, 0.07, 0.25, 'square'); }
  explode() {
    this._burst(1.1, 300, 1.0);
    this._tone(70, 0.9, 0.8, 'sine', 28);
  }
  roundWin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 0.3, 'triangle'), i * 110));
  }
  roundLose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.25, 0.28, 'triangle'), i * 130));
  }
  buy() { this._tone(740, 0.07, 0.3, 'triangle'); setTimeout(() => this._tone(988, 0.1, 0.3, 'triangle'), 70); }
  click() { this._tone(1200, 0.03, 0.2, 'square'); }
  denied() { this._tone(180, 0.15, 0.3, 'sawtooth', 120); }
  step() { this._burst(0.05, 500, 0.06); }
}
