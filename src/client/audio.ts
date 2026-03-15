/**
 * Procedural sound effects using Web Audio API.
 * No audio assets needed — everything is synthesized.
 */

let ctx: AudioContext | null = null;
let muted = false;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  // Persist preference
  try { localStorage.setItem('delta-v-mute', m ? '1' : '0'); } catch {}
}

function getCtx(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}

/** Resume audio context after user gesture (required by browsers). */
export function initAudio() {
  // Load saved mute preference
  try {
    const saved = localStorage.getItem('delta-v-mute');
    if (saved === '1') muted = true;
  } catch {}

  const resume = () => {
    if (ctx?.state === 'suspended') {
      ctx.resume();
    }
    document.removeEventListener('click', resume);
    document.removeEventListener('touchstart', resume);
  };
  document.addEventListener('click', resume);
  document.addEventListener('touchstart', resume);
}

/** Short blip for UI interactions (button clicks, selections). */
export function playSelect() {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, ac.currentTime + 0.05);
  gain.gain.setValueAtTime(0.08, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.1);
}

/** Confirm/submit sound — ascending tone. */
export function playConfirm() {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ac.currentTime + 0.15);
  gain.gain.setValueAtTime(0.1, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.2);
}

/** Thruster sound for movement. */
export function playThrust() {
  const ac = getCtx();
  if (!ac) return;
  const bufSize = ac.sampleRate * 0.3;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.3));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(300, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(100, ac.currentTime + 0.3);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.06, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start(ac.currentTime);
}

/** Laser/beam sound for combat. */
export function playCombat() {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(2000, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(100, ac.currentTime + 0.3);
  gain.gain.setValueAtTime(0.06, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.35);
}

/** Explosion sound for ship destruction or detonation. */
export function playExplosion() {
  const ac = getCtx();
  if (!ac) return;
  const bufSize = ac.sampleRate * 0.5;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.15));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.5);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.12, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start(ac.currentTime);
}

/** Alert tone for phase changes. */
export function playPhaseChange() {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, ac.currentTime);
  gain.gain.setValueAtTime(0.06, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.12);
  // Second tone slightly delayed
  const osc2 = ac.createOscillator();
  const gain2 = ac.createGain();
  osc2.connect(gain2);
  gain2.connect(ac.destination);
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(900, ac.currentTime + 0.12);
  gain2.gain.setValueAtTime(0.06, ac.currentTime + 0.12);
  gain2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
  osc2.start(ac.currentTime + 0.12);
  osc2.stop(ac.currentTime + 0.25);
}

/** Warning beep for low timer. */
export function playWarning() {
  const ac = getCtx();
  if (!ac) return;
  // Two short beeps
  for (let i = 0; i < 2; i++) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'square';
    const t = ac.currentTime + i * 0.2;
    osc.frequency.setValueAtTime(1000, t);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

/** Victory fanfare. */
export function playVictory() {
  const ac = getCtx();
  if (!ac) return;
  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'sine';
    const t = ac.currentTime + i * 0.15;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

/** Defeat sound. */
export function playDefeat() {
  const ac = getCtx();
  if (!ac) return;
  const notes = [400, 350, 300, 200]; // Descending
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'sine';
    const t = ac.currentTime + i * 0.2;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}
