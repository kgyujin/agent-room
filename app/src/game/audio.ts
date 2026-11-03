// Tiny synthesized sound: soft SFX for state changes and an optional lo-fi pad loop.
// Everything is generated locally with WebAudio; no audio files, no network.
type Sfx = 'start' | 'done' | 'alert' | 'error' | 'blip';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmTimer: number | null = null;
  sfxOn = true;
  bgmOn = false;

  /** must be called from a user gesture at least once (autoplay policy) */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.bgmOn) this.startBgm();
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType = 'triangle', gain = 0.5) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  play(s: Sfx) {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    switch (s) {
      case 'start': this.tone(523, t, 0.15); this.tone(784, t + 0.08, 0.2); break;
      case 'done': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.09, 0.35, 'sine', 0.45)); break;
      case 'alert': this.tone(880, t, 0.18, 'square', 0.18); this.tone(660, t + 0.2, 0.25, 'square', 0.18); break;
      case 'error': this.tone(220, t, 0.3, 'sawtooth', 0.15); this.tone(196, t + 0.15, 0.35, 'sawtooth', 0.12); break;
      case 'blip': this.tone(660, t, 0.08, 'sine', 0.25); break;
    }
  }

  setBgm(on: boolean) {
    this.bgmOn = on;
    if (on && this.ctx) this.startBgm();
    if (!on && this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private startBgm() {
    if (this.bgmTimer !== null || !this.ctx) return;
    // Fmaj7 - Em7 - Dm7 - Cmaj7, soft sine pad + sparse pentatonic notes
    const chords = [[174.6, 220, 261.6, 329.6], [164.8, 196, 246.9, 293.7], [146.8, 174.6, 220, 261.6], [130.8, 164.8, 196, 246.9]];
    const penta = [523.3, 587.3, 659.3, 784, 880];
    let i = 0;
    const bar = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime + 0.05;
      for (const f of chords[i % 4]) this.tone(f, t, 3.6, 'sine', 0.12);
      for (let k = 0; k < 3; k++) if (Math.random() < 0.55) this.tone(penta[Math.floor(Math.random() * 5)], t + 0.6 + k * 1.1, 0.9, 'triangle', 0.08);
      i++;
    };
    bar();
    this.bgmTimer = window.setInterval(bar, 4000);
  }
}
