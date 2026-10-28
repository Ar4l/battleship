import type { Sfx } from '../app/controller';

const KEY = 'bs:mute';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const store = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
let muted = store()?.getItem(KEY) === '1';

export const isMuted = (): boolean => muted;
export function setMuted(m: boolean): void {
  muted = m;
  store()?.setItem(KEY, m ? '1' : '0');
}

/** Create the AudioContext lazily on the first user gesture. */
export function unlockAudio(): void {
  if (ctx || typeof AudioContext === 'undefined') return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.25;
  master.connect(ctx.destination);
}

function noise(dur: number, filter: BiquadFilterType, freq: number, at = 0, gain = 1): void {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master!);
  src.start(c.currentTime + at);
}

function tone(type: OscillatorType, from: number, to: number, dur: number, at = 0, gain = 0.6): void {
  const c = ctx!;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function play(s: Sfx): void {
  if (muted || !ctx || !master) return;
  if (ctx.state === 'suspended') void ctx.resume();
  switch (s) {
    case 'miss':
      return noise(0.12, 'bandpass', 900);
    case 'hit':
      tone('sine', 110, 55, 0.18, 0, 0.9);
      return noise(0.06, 'lowpass', 2000, 0, 0.6);
    case 'sunk':
      [440, 330, 220].forEach((f, i) => tone('triangle', f, f * 0.98, 0.12, i * 0.12, 0.5));
      return;
    case 'turn':
      return tone('sine', 660, 660, 0.04, 0, 0.08 / 0.25);
  }
}
