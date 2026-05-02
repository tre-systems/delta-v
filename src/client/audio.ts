// Procedural sound effects using Web Audio API.
// No audio assets needed; everything is synthesized at runtime.

import type { OrdnanceType } from '../shared/constants';
import { warnOnce } from './log-once';

type AudioContextConstructor = new () => AudioContext;
type DamageCue = 'none' | 'disabled' | 'eliminated' | 'captured';
type OrdnanceImpactCue = 'mineDetonation' | 'torpedoHit' | 'nukeDetonation';

interface ToneOptions {
  type?: OscillatorType;
  startFrequency: number;
  endFrequency?: number;
  startOffset?: number;
  duration: number;
  gain: number;
  attack?: number;
}

interface NoiseOptions {
  startOffset?: number;
  duration: number;
  gain: number;
  startFrequency: number;
  endFrequency?: number;
  filterType?: BiquadFilterType;
  decay?: number;
  resonance?: number;
}

const MIN_GAIN = 0.0001;

let ctx: AudioContext | null = null;
let muted = false;

export const isMuted = (): boolean => {
  return muted;
};

const getAudioContextCtor = (): AudioContextConstructor | null => {
  if (typeof AudioContext !== 'undefined') {
    return AudioContext;
  }

  const maybeGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

  return maybeGlobal.webkitAudioContext ?? null;
};

const getCtx = (): AudioContext | null => {
  if (muted) return null;

  if (!ctx) {
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return null;
    ctx = new AudioContextCtor();
  }

  return ctx;
};

export const setMuted = (m: boolean) => {
  muted = m;
  if (!m) {
    const ac = getCtx();
    if (ac?.state === 'suspended') {
      void ac.resume();
    }
  }

  // Persist preference.
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

// Resume audio context after user gesture (required by browsers).
export const initAudio = () => {
  // Load saved mute preference.
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
    const ac = muted ? ctx : getCtx();
    if (ac?.state === 'suspended') {
      void ac.resume();
    }

    document.removeEventListener('click', resume);
    document.removeEventListener('touchstart', resume);
  };

  document.addEventListener('click', resume);
  document.addEventListener('touchstart', resume);
};

const positiveFrequency = (frequency: number): number => Math.max(1, frequency);

const scheduleTone = (ac: AudioContext, options: ToneOptions): void => {
  const start = ac.currentTime + (options.startOffset ?? 0);
  const duration = Math.max(0.01, options.duration);
  const stop = start + duration;
  const attack = Math.min(options.attack ?? 0.008, duration * 0.45);
  const attackEnd = start + attack;
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.connect(gain);
  gain.connect(ac.destination);

  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(
    positiveFrequency(options.startFrequency),
    start,
  );
  if (
    options.endFrequency !== undefined &&
    options.endFrequency !== options.startFrequency
  ) {
    osc.frequency.exponentialRampToValueAtTime(
      positiveFrequency(options.endFrequency),
      stop,
    );
  }

  gain.gain.setValueAtTime(MIN_GAIN, start);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(MIN_GAIN, options.gain),
    attackEnd,
  );
  gain.gain.exponentialRampToValueAtTime(MIN_GAIN, stop);

  osc.start(start);
  osc.stop(stop + 0.02);
};

const scheduleNoise = (ac: AudioContext, options: NoiseOptions): void => {
  const start = ac.currentTime + (options.startOffset ?? 0);
  const duration = Math.max(0.01, options.duration);
  const stop = start + duration;
  const sampleCount = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, sampleCount, ac.sampleRate);
  const data = buffer.getChannelData(0);
  const decay = Math.max(0.05, options.decay ?? 0.24);

  for (let i = 0; i < sampleCount; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleCount * decay));
  }

  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  src.buffer = buffer;
  filter.type = options.filterType ?? 'lowpass';
  filter.Q.setValueAtTime(options.resonance ?? 0.7, start);
  filter.frequency.setValueAtTime(
    positiveFrequency(options.startFrequency),
    start,
  );
  if (
    options.endFrequency !== undefined &&
    options.endFrequency !== options.startFrequency
  ) {
    filter.frequency.exponentialRampToValueAtTime(
      positiveFrequency(options.endFrequency),
      stop,
    );
  }

  gain.gain.setValueAtTime(Math.max(MIN_GAIN, options.gain), start);
  gain.gain.exponentialRampToValueAtTime(MIN_GAIN, stop);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start(start);
};

const playArpeggio = (
  ac: AudioContext,
  notes: readonly number[],
  gain: number,
  spacing: number,
  duration: number,
  type: OscillatorType = 'sine',
): void => {
  notes.forEach((frequency, i) => {
    scheduleTone(ac, {
      type,
      startFrequency: frequency,
      startOffset: i * spacing,
      duration,
      gain,
    });
  });
};

// Short, quiet blip for low-importance UI selections.
export const playSelect = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleTone(ac, {
    startFrequency: 820,
    endFrequency: 1180,
    duration: 0.075,
    gain: 0.024,
  });
};

// Confirm/submit sound. Still modest because it is used frequently.
export const playConfirm = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 420,
    endFrequency: 620,
    duration: 0.12,
    gain: 0.032,
  });
  scheduleTone(ac, {
    type: 'sine',
    startFrequency: 840,
    startOffset: 0.075,
    duration: 0.09,
    gain: 0.024,
  });
};

// Soft downward cue for undo, cancel, skip, and closing actions.
export const playCancel = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 520,
    endFrequency: 300,
    duration: 0.13,
    gain: 0.026,
  });
};

// Muted warning buzz for invalid local actions and server rejections.
export const playInvalid = () => {
  const ac = getCtx();

  if (!ac) return;

  for (let i = 0; i < 2; i++) {
    scheduleTone(ac, {
      type: 'square',
      startFrequency: i === 0 ? 150 : 118,
      startOffset: i * 0.105,
      duration: 0.07,
      gain: 0.024,
      attack: 0.003,
    });
  }
};

// Subtle movement-resolution cue for coasting or drift-only turns.
export const playTrajectory = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleTone(ac, {
    type: 'sine',
    startFrequency: 260,
    endFrequency: 350,
    duration: 0.17,
    gain: 0.018,
  });
  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 510,
    startOffset: 0.08,
    duration: 0.08,
    gain: 0.016,
  });
};

// Thruster sound for powered movement. Common, so it stays restrained.
export const playThrust = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleNoise(ac, {
    duration: 0.3,
    gain: 0.034,
    startFrequency: 420,
    endFrequency: 110,
    decay: 0.32,
  });
  scheduleTone(ac, {
    type: 'sawtooth',
    startFrequency: 96,
    endFrequency: 58,
    duration: 0.28,
    gain: 0.014,
  });
};

// Laser/beam sound for combat resolution.
export const playCombat = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleTone(ac, {
    type: 'sawtooth',
    startFrequency: 1900,
    endFrequency: 140,
    duration: 0.28,
    gain: 0.044,
    attack: 0.004,
  });
  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 720,
    endFrequency: 360,
    startOffset: 0.04,
    duration: 0.18,
    gain: 0.018,
  });
};

export const playDamage = (damageType: DamageCue = 'disabled') => {
  const ac = getCtx();

  if (!ac || damageType === 'none') return;

  if (damageType === 'captured') {
    playCapture();
    return;
  }

  if (damageType === 'eliminated') {
    playExplosion();
    return;
  }

  scheduleTone(ac, {
    type: 'square',
    startFrequency: 260,
    endFrequency: 210,
    duration: 0.08,
    gain: 0.035,
    attack: 0.003,
  });
  scheduleTone(ac, {
    type: 'square',
    startFrequency: 210,
    endFrequency: 170,
    startOffset: 0.095,
    duration: 0.08,
    gain: 0.028,
    attack: 0.003,
  });
};

export const playCollision = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleNoise(ac, {
    duration: 0.22,
    gain: 0.066,
    startFrequency: 950,
    endFrequency: 130,
    decay: 0.18,
    resonance: 1.1,
  });
  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 180,
    endFrequency: 82,
    duration: 0.22,
    gain: 0.032,
  });
};

// Explosion sound for ship destruction or detonation.
export const playExplosion = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleNoise(ac, {
    duration: 0.52,
    gain: 0.105,
    startFrequency: 850,
    endFrequency: 62,
    decay: 0.18,
    resonance: 0.5,
  });
  scheduleTone(ac, {
    type: 'sawtooth',
    startFrequency: 95,
    endFrequency: 38,
    duration: 0.42,
    gain: 0.052,
  });
};

export const playCapture = () => {
  const ac = getCtx();

  if (!ac) return;

  playArpeggio(ac, [310, 465, 620], 0.04, 0.09, 0.16, 'triangle');
  scheduleTone(ac, {
    type: 'sine',
    startFrequency: 930,
    startOffset: 0.22,
    duration: 0.15,
    gain: 0.03,
  });
};

export const playLanding = (resupplied = false) => {
  const ac = getCtx();

  if (!ac) return;

  scheduleNoise(ac, {
    duration: 0.24,
    gain: 0.038,
    startFrequency: 180,
    endFrequency: 70,
    decay: 0.4,
  });
  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 330,
    endFrequency: 250,
    startOffset: 0.03,
    duration: 0.18,
    gain: 0.028,
  });
  scheduleTone(ac, {
    type: 'sine',
    startFrequency: resupplied ? 760 : 560,
    startOffset: 0.18,
    duration: 0.12,
    gain: resupplied ? 0.038 : 0.028,
  });

  if (resupplied) {
    playArpeggio(ac, [520, 660, 880], 0.024, 0.08, 0.1, 'sine');
  }
};

export const playTransfer = () => {
  const ac = getCtx();

  if (!ac) return;

  playArpeggio(ac, [470, 560, 670], 0.018, 0.065, 0.075, 'triangle');
};

export const playBaseEmplaced = () => {
  const ac = getCtx();

  if (!ac) return;

  scheduleNoise(ac, {
    duration: 0.24,
    gain: 0.054,
    startFrequency: 420,
    endFrequency: 90,
    decay: 0.24,
  });
  scheduleTone(ac, {
    type: 'triangle',
    startFrequency: 190,
    endFrequency: 140,
    duration: 0.22,
    gain: 0.04,
  });
  playArpeggio(ac, [440, 660], 0.028, 0.12, 0.14, 'sine');
};

export const playOrdnanceLaunch = (ordType: OrdnanceType) => {
  const ac = getCtx();

  if (!ac) return;

  switch (ordType) {
    case 'mine':
      scheduleNoise(ac, {
        duration: 0.1,
        gain: 0.035,
        startFrequency: 700,
        endFrequency: 260,
        decay: 0.12,
      });
      scheduleTone(ac, {
        type: 'triangle',
        startFrequency: 320,
        duration: 0.08,
        gain: 0.018,
      });
      return;
    case 'torpedo':
      scheduleTone(ac, {
        type: 'sawtooth',
        startFrequency: 420,
        endFrequency: 980,
        duration: 0.2,
        gain: 0.045,
      });
      scheduleNoise(ac, {
        startOffset: 0.02,
        duration: 0.18,
        gain: 0.025,
        startFrequency: 1600,
        endFrequency: 680,
        filterType: 'bandpass',
        decay: 0.3,
      });
      return;
    case 'nuke':
      scheduleTone(ac, {
        type: 'square',
        startFrequency: 170,
        endFrequency: 105,
        duration: 0.18,
        gain: 0.046,
      });
      scheduleTone(ac, {
        type: 'sawtooth',
        startFrequency: 300,
        endFrequency: 740,
        startOffset: 0.08,
        duration: 0.22,
        gain: 0.052,
      });
      return;
  }
};

export const playOrdnanceImpact = (
  impactType: OrdnanceImpactCue,
  damageType: DamageCue = 'none',
) => {
  const ac = getCtx();

  if (!ac) return;

  switch (impactType) {
    case 'mineDetonation':
      scheduleNoise(ac, {
        duration: 0.26,
        gain: 0.074,
        startFrequency: 850,
        endFrequency: 105,
        decay: 0.16,
      });
      scheduleTone(ac, {
        type: 'triangle',
        startFrequency: 170,
        endFrequency: 80,
        duration: 0.22,
        gain: 0.034,
      });
      break;
    case 'torpedoHit':
      scheduleTone(ac, {
        type: 'sawtooth',
        startFrequency: 1160,
        endFrequency: 92,
        duration: 0.26,
        gain: 0.066,
        attack: 0.003,
      });
      scheduleNoise(ac, {
        startOffset: 0.04,
        duration: 0.2,
        gain: 0.048,
        startFrequency: 1300,
        endFrequency: 150,
        decay: 0.16,
      });
      break;
    case 'nukeDetonation':
      scheduleNoise(ac, {
        duration: 0.84,
        gain: 0.135,
        startFrequency: 1100,
        endFrequency: 42,
        decay: 0.2,
        resonance: 0.45,
      });
      scheduleTone(ac, {
        type: 'square',
        startFrequency: 80,
        endFrequency: 32,
        duration: 0.74,
        gain: 0.07,
      });
      scheduleTone(ac, {
        type: 'sawtooth',
        startFrequency: 540,
        endFrequency: 180,
        startOffset: 0.04,
        duration: 0.34,
        gain: 0.055,
      });
      return;
  }

  if (damageType === 'eliminated') {
    setTimeout(() => playExplosion(), 180);
  } else if (damageType === 'disabled' || damageType === 'captured') {
    setTimeout(() => playDamage(damageType), 180);
  }
};

// Alert tone for phase changes.
export const playPhaseChange = () => {
  const ac = getCtx();

  if (!ac) return;

  playArpeggio(ac, [600, 900], 0.048, 0.12, 0.13, 'triangle');
};

// Warning beep for low timer.
export const playWarning = () => {
  const ac = getCtx();

  if (!ac) return;

  for (let i = 0; i < 2; i++) {
    scheduleTone(ac, {
      type: 'square',
      startFrequency: 1000,
      startOffset: i * 0.2,
      duration: 0.1,
      gain: 0.045,
      attack: 0.003,
    });
  }
};

// Victory fanfare.
export const playVictory = () => {
  const ac = getCtx();

  if (!ac) return;

  playArpeggio(ac, [523, 659, 784, 1047], 0.07, 0.15, 0.3);
};

// Defeat sound.
export const playDefeat = () => {
  const ac = getCtx();

  if (!ac) return;

  playArpeggio(ac, [400, 350, 300, 200], 0.064, 0.2, 0.35);
};
