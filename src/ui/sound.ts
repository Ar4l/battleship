import type { Sfx } from '../app/controller';

let ctx: AudioContext | null = null;
let out: GainNode;
const get = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
let muted = get()?.getItem('bs:mute') === '1';

export const isMuted = (): boolean => muted;
export function setMuted(m: boolean): void {
  muted = m;
  get()?.setItem('bs:mute', m ? '1' : '0');
}

/** Create the AudioContext lazily on the first user gesture. */
export function unlockAudio(): void {
  if (ctx || typeof AudioContext === 'undefined') return;
  ctx = new AudioContext();
  out = ctx.createGain();
  out.gain.value = 0.25;
  out.connect(ctx.destination);
}

const gain = (v: number) => {
  const g = ctx!.createGain();
  g.gain.value = v;
  g.connect(out);
  return g;
};

function noise(dur: number, type: BiquadFilterType, freq: number, g = 1): void {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  src.connect(f).connect(gain(g));
  src.start();
}

function tone(type: OscillatorType, from: number, to: number, dur: number, at = 0, g = 0.6): void {
  const t = ctx!.currentTime + at;
  const o = ctx!.createOscillator();
  const v = gain(g);
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  v.gain.setValueAtTime(g, t);
  v.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(v);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function play(s: Sfx): void {
  if (muted || !ctx) return;
  void ctx.resume();
  if (s === 'miss') noise(0.12, 'bandpass', 900);
  else if (s === 'hit') tone('sine', 110, 55, 0.18, 0, 0.9), noise(0.06, 'lowpass', 2000, 0.6);
  else if (s === 'sunk') [440, 330, 220].forEach((f, i) => tone('triangle', f, f * 0.98, 0.12, i * 0.12, 0.5));
  else tone('sine', 660, 660, 0.04, 0, 0.32);
}
