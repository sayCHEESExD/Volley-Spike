// Small WebAudio layer: one-shot sfx (the supplied files + a few synthesized ones: booms,
// whooshes, zaps, thuds) with distance falloff, plus looping music.
const FILES = { bump: 'audio/ball-bump.mp3', spike: 'audio/ball-bump.mp3', cheer: 'audio/crowd_cheer.mp3', boom: 'audio/explosion.mp3', jump: 'audio/jump.mp3', walk: 'audio/walk.mp3', levelup: 'audio/awesome-level-up.mp3', ding: 'audio/star-ding.mp3', cash: 'audio/cashier-money-sound.mp3', coin: 'audio/star-ding.mp3' };

export class Audio {
  constructor() {
    this.ctx = null; this.buffers = {}; this.sfxVol = 0.8; this.musicVol = 0.25; this.music = null; this.listener = { x: 0, y: 0, z: 0 };
    this.last = {};
  }
  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.sfxVol; this.sfxGain.connect(this.ctx.destination);
      await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
        try { const r = await fetch(url); this.buffers[k] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* missing sound is fine */ }
      }));
    } catch (e) { console.warn('[audio]', e); }
    this.startMusic();
  }
  startMusic() {
    if (this.music) return;
    const a = new window.Audio('audio/music.mp3');
    a.loop = true; a.volume = this.muted ? 0 : Math.min(1, this.musicVol); a.preload = 'auto';
    this.music = a;
    a.play().catch(() => { this.music = null; });
  }
  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music;
    this.applyGain();
  }
  // Muted during Boxity ad breaks; volumes come back unchanged afterwards.
  setMuted(m) {
    this.muted = !!m;
    this.applyGain();
    if (this.music) { if (m) this.music.pause(); else this.music.play().catch(() => {}); }
  }
  applyGain() {
    if (this.sfxGain) this.sfxGain.gain.value = this.muted ? 0 : this.sfxVol;
    if (this.music) this.music.volume = this.muted ? 0 : Math.min(1, this.musicVol);
  }
  falloff(pos, vol, range = 70) {
    if (!pos) return vol;
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    return vol * Math.max(0, 1 - d / range);
  }
  noise(secs) {
    const n = Math.floor(this.ctx.sampleRate * secs), b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Synthesized effects: 'boom' | 'crumble' | 'whoosh' | 'zap' | 'thud'
  synth(kind, { pos = null, vol = 1, size = 1 } = {}) {
    if (!this.ctx || this.muted) return;
    const v = this.falloff(pos, vol, kind === 'boom' ? 160 : 80);
    if (v < 0.02) return;
    const now = this.ctx.currentTime, ctx = this.ctx;
    const out = ctx.createGain(); out.connect(this.sfxGain);
    const env = (g, a, peak, decay) => { g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(peak, now + a); g.gain.exponentialRampToValueAtTime(0.0001, now + a + decay); };
    if (kind === 'boom') {
      const src = ctx.createBufferSource(); src.buffer = this.noise(1.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, now); lp.frequency.exponentialRampToValueAtTime(120, now + 1.2);
      env(out, 0.01, v * 1.4, 1.4);
      src.connect(lp); lp.connect(out); src.start(now); src.stop(now + 1.6);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(30, now + 0.6);
      const og = ctx.createGain(); env(og, 0.005, v * 1.2, 0.7); o.connect(og); og.connect(this.sfxGain); o.start(now); o.stop(now + 0.8);
    } else if (kind === 'crumble') {
      const n = Math.min(9, 3 + Math.round(size));
      for (let i = 0; i < n; i++) {
        const t = now + i * (0.03 + Math.random() * 0.06);
        const src = ctx.createBufferSource(); src.buffer = this.noise(0.25);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260 + Math.random() * 500; bp.Q.value = 1.4;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * (0.5 + Math.random() * 0.5), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.12);
        src.connect(bp); bp.connect(g); g.connect(this.sfxGain); src.start(t); src.stop(t + 0.3);
      }
    } else if (kind === 'whoosh') {
      const src = ctx.createBufferSource(); src.buffer = this.noise(0.5);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(400, now); bp.frequency.exponentialRampToValueAtTime(2200, now + 0.25); bp.frequency.exponentialRampToValueAtTime(600, now + 0.45);
      env(out, 0.06, v * 0.7, 0.4);
      src.connect(bp); bp.connect(out); src.start(now); src.stop(now + 0.5);
    } else if (kind === 'zap') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(size > 0 ? 220 : 880, now); o.frequency.exponentialRampToValueAtTime(size > 0 ? 880 : 180, now + 0.14);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      env(out, 0.01, v * 0.18, 0.16);
      o.connect(lp); lp.connect(out); o.start(now); o.stop(now + 0.2);
    } else if (kind === 'thud') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, now); o.frequency.exponentialRampToValueAtTime(45, now + 0.18);
      env(out, 0.004, v * 0.9, 0.22);
      o.connect(out); o.start(now); o.stop(now + 0.3);
    }
  }
  // pos optional: falls off with distance from the listener
  play(name, { pos = null, vol = 1, rate = 1, minGap = 0.05 } = {}) {
    if (!this.ctx || !this.buffers[name] || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    let v = vol;
    if (pos) { const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z); v *= Math.max(0, 1 - d / 60); if (v < 0.02) return; }
    const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name]; src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain(); g.gain.value = v;
    src.connect(g); g.connect(this.sfxGain); src.start();
  }
}
