// Procedural sound effects using Web Audio API.
// No audio assets needed — everything is synthesized.

import { warnOnce } from './log-once';

let ctx: AudioContext | null = null;
let muted = false;
let audioUnlocked = false;
let ambientRequested = false;
let ambientNodes: {
  master: GainNode;
  sources: Array<OscillatorNode | AudioBufferSourceNode>;
  swellTimer: ReturnType<typeof setInterval> | null;
} | null = null;

export const isMuted = (): boolean => {
  return muted;
};

export const setMuted = (m: boolean) => {
  muted = m;
  if (m) {
    stopAmbientNodes();
  } else if (ambientRequested) {
    audioUnlocked = true;
    startAmbientNodes();
  }

  // Persist preference
  try {
    localStorage.setItem('delta-v-mute', m ? '1' : '0');
  } catch (err) {
    warnOnce(
      'audio.mute.persist',
      'mute preference could not be persisted (localStorage unavailable)',
      err,
    );
  }
};

const getCtx = (): AudioContext | null => {
  if (muted) return null;

  if (!ctx) {
    ctx = new AudioContext();
  }

  return ctx;
};

const scheduleAmbientSwell = (ac: AudioContext, master: GainNode): void => {
  if (muted || !ambientNodes) return;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const now = ac.currentTime;

  osc.type = 'sine';
  osc.frequency.setValueAtTime(176, now);
  osc.frequency.exponentialRampToValueAtTime(247, now + 4.4);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.012, now + 1.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.4);

  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 5.6);
};

const stopAmbientNodes = (): void => {
  if (!ambientNodes) return;

  if (ambientNodes.swellTimer !== null) {
    clearInterval(ambientNodes.swellTimer);
  }
  for (const source of ambientNodes.sources) {
    try {
      source.stop();
    } catch {
      // Already stopped by the browser's audio graph.
    }
    source.disconnect();
  }
  ambientNodes.master.disconnect();
  ambientNodes = null;
};

const startAmbientNodes = (): void => {
  if (ambientNodes || muted || !audioUnlocked) return;

  const ac = getCtx();
  if (!ac) return;

  const master = ac.createGain();
  master.gain.setValueAtTime(0.0001, ac.currentTime);
  master.gain.exponentialRampToValueAtTime(0.028, ac.currentTime + 2.4);
  master.connect(ac.destination);

  const tones = [
    { frequency: 55, gain: 0.42, type: 'sine' as OscillatorType },
    { frequency: 82.41, gain: 0.22, type: 'triangle' as OscillatorType },
    { frequency: 110, gain: 0.12, type: 'sine' as OscillatorType },
  ];
  const sources: Array<OscillatorNode | AudioBufferSourceNode> = [];

  for (const tone of tones) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.frequency, ac.currentTime);
    gain.gain.setValueAtTime(tone.gain, ac.currentTime);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    sources.push(osc);
  }

  const bufSize = ac.sampleRate * 2;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.035;
  }

  const rumble = ac.createBufferSource();
  rumble.buffer = buf;
  rumble.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(90, ac.currentTime);
  const rumbleGain = ac.createGain();
  rumbleGain.gain.setValueAtTime(0.18, ac.currentTime);
  rumble.connect(filter);
  filter.connect(rumbleGain);
  rumbleGain.connect(master);
  rumble.start();
  sources.push(rumble);

  ambientNodes = {
    master,
    sources,
    swellTimer: setInterval(() => scheduleAmbientSwell(ac, master), 17_000),
  };
  scheduleAmbientSwell(ac, master);
};

// Resume audio context after user gesture (required by browsers).
export const initAudio = () => {
  // Load saved mute preference
  try {
    const saved = localStorage.getItem('delta-v-mute');

    if (saved === '1') muted = true;
  } catch (err) {
    warnOnce(
      'audio.mute.load',
      'mute preference could not be restored (localStorage unavailable)',
      err,
    );
  }

  const resume = () => {
    audioUnlocked = true;
    if (ctx?.state === 'suspended') {
      ctx.resume();
    }
    if (ambientRequested) {
      startAmbientNodes();
    }

    document.removeEventListener('click', resume);
    document.removeEventListener('touchstart', resume);
  };

  document.addEventListener('click', resume);
  document.addEventListener('touchstart', resume);
};

// Low menu ambience, explicitly armed by UI visibility and still gated on
// a user gesture by initAudio's unlock listeners.
export const playAmbientDrone = () => {
  ambientRequested = true;
  startAmbientNodes();
};

export const stopAmbientDrone = () => {
  ambientRequested = false;
  stopAmbientNodes();
};

// Short blip for UI interactions (button clicks, selections).
export const playSelect = () => {
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
};

// Confirm/submit sound — ascending tone.
export const playConfirm = () => {
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
};

// Thruster sound for movement.
export const playThrust = () => {
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
};

// Laser/beam sound for combat.
export const playCombat = () => {
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
};

// Explosion sound for ship destruction or detonation.
export const playExplosion = () => {
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
};

// Alert tone for phase changes.
export const playPhaseChange = () => {
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
};

// Warning beep for low timer.
export const playWarning = () => {
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
};

// Victory fanfare.
export const playVictory = () => {
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
};

// Defeat sound.
export const playDefeat = () => {
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
};
