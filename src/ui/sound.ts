import type { Sfx } from '../app/controller';

let ctx: AudioContext | null = null;
let out: GainNode;
let idle = 0;
/** Suspend the audio thread 2 s after the last sound (battery on phones). */
const rest = () => {
  clearTimeout(idle);
  idle = window.setTimeout(() => ctx?.suspend().catch(() => {}), 2000);
};
let muted = false;
try {
  muted = localStorage.getItem('bs:mute') === '1';
} catch {
  /* storage blocked */
}

export const isMuted = (): boolean => muted;
export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem('bs:mute', m ? '1' : '0');
  } catch {
    /* storage blocked or full */
  }
}

// iOS only lets audio start from touchend, pointerup, click or keydown (not touchstart
// or a touch pointerdown), so listen to all of them until the context is running.
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];
const listen = (on: boolean) => GESTURES.forEach((e) => document[on ? 'addEventListener' : 'removeEventListener'](e, unlockAudio, { capture: true, passive: true }));

/** Create or resume the AudioContext; call from a user gesture. */
export function unlockAudio(): void {
  if (!ctx) {
    if (typeof AudioContext === 'undefined') return;
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.25;
    out.connect(ctx.destination);
    // Running (or suspended by rest()): done. iOS 'interrupted' (a call, an app switch): wait for the next gesture.
    // A context the browser refused to start fires no event, so the listeners stay.
    ctx.onstatechange = () => listen((ctx!.state as string) === 'interrupted');
    rest();
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}
/** Start listening for the first gesture. */
export const armAudio = (): void => listen(true);

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
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  rest();
  if (s === 'miss') noise(0.12, 'bandpass', 900);
  else if (s === 'hit') tone('sine', 110, 55, 0.18, 0, 0.9), noise(0.06, 'lowpass', 2000, 0.6);
  else if (s === 'sunk') [440, 330, 220].forEach((f, i) => tone('triangle', f, f * 0.98, 0.12, i * 0.12, 0.5));
  else tone('sine', 660, 660, 0.04, 0, 0.32);
}
