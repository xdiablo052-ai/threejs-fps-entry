// All sound is synthesized with WebAudio — the game ships no audio files.
// A shot is a noise burst through a low-pass with a fast decay, a reload is
// two filtered clicks, the plant beep is a square blip; the mix stays quiet
// enough to play over.

export class SoundBank {
  constructor() {
    this.ctx = null;
  }

  ensure() {
    if (this.ctx === null) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  burst(durMs, freq, gain, type = 'lowpass') {
    if (this.ctx === null) return;
    const ctx = this.ctx;
    const dur = durMs / 1000;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  tone(freq, durMs, gain, type = 'square', slideTo = null) {
    if (this.ctx === null) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + durMs / 1000);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMs / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durMs / 1000);
  }

  shot(kind) {
    if (kind === 'shotgun') this.burst(240, 700, 0.5);
    else if (kind === 'dmr') this.burst(200, 900, 0.42);
    else if (kind === 'pistol') this.burst(110, 1500, 0.3);
    else this.burst(140, 1200, 0.34);
  }

  enemyShot() {
    this.burst(120, 800, 0.12);
  }

  reload() {
    this.burst(40, 2500, 0.12, 'highpass');
    setTimeout(() => this.burst(40, 1800, 0.14, 'highpass'), 220);
  }

  hit(head) {
    this.tone(head ? 1560 : 1180, 60, 0.1, 'sine');
  }

  hurt() {
    this.tone(140, 120, 0.16, 'sawtooth', 70);
  }

  plantBeep(final = false) {
    this.tone(final ? 1320 : 880, final ? 300 : 90, 0.12, 'square');
  }

  explosion() {
    this.burst(900, 220, 0.7);
    this.tone(90, 800, 0.4, 'sine', 34);
  }

  roundWin() {
    this.tone(660, 140, 0.1, 'triangle');
    setTimeout(() => this.tone(880, 200, 0.1, 'triangle'), 130);
  }

  roundLose() {
    this.tone(392, 160, 0.1, 'triangle');
    setTimeout(() => this.tone(311, 240, 0.1, 'triangle'), 140);
  }
}
