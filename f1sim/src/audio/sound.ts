/**
 * The car, out loud.
 *
 * A racing simulator with no sound is missing more than an effect. Speed
 * on a screen is a slow picture — the road ahead barely moves and the
 * only thing changing quickly is a number in a corner. `ui/speedlines.ts`
 * borrows the comic's answer to that problem for the eye; this is the
 * answer for the ear, and it is the bigger half. Every cue a driver uses
 * that a screen cannot give — how close the engine is to the limiter,
 * whether that was the tyre letting go or the kerb, how fast you are
 * actually going — arrives through it.
 *
 * Nothing here is a recording. Six sound files would be six downloads
 * and a lot of megabytes, and a sample pitched up and down does not
 * answer to a throttle. It is synthesised from the same state the
 * renderer draws, so it is *always* right: the note is the firing rate
 * of a V6 at whatever the drivetrain says the revs are, and it changes
 * timbre when the driver lifts because the model says the load changed.
 *
 * Two rules the whole file obeys:
 *
 *   - **Nothing is set directly.** Every parameter moves through
 *     `setTargetAtTime`, which is a one-pole filter towards the value
 *     rather than a jump to it. Writing a `gain` sixty times a second
 *     puts a step in the waveform sixty times a second, and a step in a
 *     waveform is a click. This is the difference between an engine and
 *     a buzzing.
 *   - **It starts on a gesture.** Every browser refuses to make noise
 *     until the user has touched the page, and refuses silently. The
 *     context is created and resumed from the START button, which is a
 *     real click, and never before.
 */
import {
  HARMONICS,
  engineGain,
  firingHz,
  harmonicAmplitudes,
  rumbleGain,
  scrubGain,
  windGain
} from './engine';
import type { VehicleState } from '../sim/types';

/** Seconds a parameter takes to get most of the way to a new value. */
const SMOOTH = 0.05;
/** Faster, for things that should feel like an impact rather than a fade. */
const SHARP = 0.012;

/** How much of the timbre range is worth resynthesising for. */
const WAVE_STEPS = 12;

const KEY = 'f1go-muted';

/**
 * White noise, once, on a loop.
 *
 * Two seconds of it: short enough to be cheap, long enough that the ear
 * cannot hear the loop point. Every noise source in the graph plays this
 * same buffer through a different filter, which is what makes wind,
 * tyre scrub and kerb rumble cost one buffer between them.
 */
const noiseBuffer = (ctx: BaseAudioContext): AudioBuffer => {
  const frames = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  /* A fixed sequence rather than Math.random, so two runs of the offline
     render used to test this produce identical samples. */
  let seed = 22222;
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff) - 1;
  }
  return buffer;
};

const loopingNoise = (
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  into: AudioNode,
  collected: AudioBufferSourceNode[]
): void => {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(into);
  /* Handed back rather than started here: an `OfflineAudioContext` wants
     every source started before the render begins, and a live one wants
     them started after the whole graph exists. Both callers decide. */
  collected.push(src);
};

/**
 * The engine's tone, precomputed.
 *
 * `createPeriodicWave` is not free and the timbre moves continuously
 * with load, so the range is sliced into a dozen waves once and the
 * oscillator is switched between them. Twelve steps is under the ear's
 * resolution for this kind of change — the alternative was rebuilding a
 * wave every frame, which is an allocation and a table build sixty
 * times a second for a difference nobody can hear.
 */
const engineWaves = (ctx: BaseAudioContext): PeriodicWave[] => {
  const waves: PeriodicWave[] = [];
  for (let i = 0; i < WAVE_STEPS; i++) {
    const amps = harmonicAmplitudes(i / (WAVE_STEPS - 1), HARMONICS);
    const real = new Float32Array(HARMONICS + 1);
    waves.push(ctx.createPeriodicWave(real, amps, { disableNormalization: false }));
  }
  return waves;
};

/** Everything the graph needs to be driven, gathered in one place. */
interface Voices {
  master: GainNode;
  engine: OscillatorNode;
  engineSub: OscillatorNode;
  engineGainNode: GainNode;
  subGain: GainNode;
  whine: OscillatorNode;
  whineGain: GainNode;
  windGainNode: GainNode;
  scrubGainNode: GainNode;
  scrubFilter: BiquadFilterNode;
  rumbleGainNode: GainNode;
  waves: PeriodicWave[];
  /** The noise sources, for the caller to start. */
  sources: AudioBufferSourceNode[];
}

/**
 * Assemble the graph.
 *
 * Exported because the test renders it through an `OfflineAudioContext`
 * and measures what comes out — see `tests`, and the browser check that
 * confirms the spectral peak really does follow the revs.
 */
export const buildVoices = (ctx: BaseAudioContext, destination: AudioNode): Voices => {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(destination);

  /* A limiter in all but name. The six voices are mixed by addition and
     a loud moment — full throttle, four tyres sliding, two wheels on a
     kerb — can sum past 1.0, which clips into a buzz exactly when the
     most is happening. A gentle knee holds the peaks without the ear
     hearing it work. */
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
  }
  shaper.curve = curve;
  shaper.connect(master);

  const noise = noiseBuffer(ctx);
  const waves = engineWaves(ctx);
  const sources: AudioBufferSourceNode[] = [];

  // --- engine ------------------------------------------------------
  const engineGainNode = ctx.createGain();
  engineGainNode.gain.value = 0;
  engineGainNode.connect(shaper);

  const engine = ctx.createOscillator();
  engine.setPeriodicWave(waves[0]!);
  engine.connect(engineGainNode);

  /* An octave below the firing rate, quiet, slightly detuned. A V6 has
     a half-order component from the two banks not being identical, and
     without it the note is thin and synthetic — this is most of what
     makes it read as an engine rather than as a tone. */
  const subGain = ctx.createGain();
  subGain.gain.value = 0;
  subGain.connect(shaper);
  const engineSub = ctx.createOscillator();
  engineSub.type = 'sawtooth';
  engineSub.detune.value = -8;
  engineSub.connect(subGain);

  // --- turbo and the electrics -------------------------------------
  /* High, thin, and tied to the same crank. Nothing about a hybrid is
     quiet, and this is the part that says the deployment is live. */
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0;
  whineGain.connect(shaper);
  const whine = ctx.createOscillator();
  whine.type = 'sine';
  whine.connect(whineGain);

  // --- wind --------------------------------------------------------
  const windGainNode = ctx.createGain();
  windGainNode.gain.value = 0;
  windGainNode.connect(shaper);
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'highpass';
  windFilter.frequency.value = 900;
  windFilter.connect(windGainNode);
  loopingNoise(ctx, noise, windFilter, sources);

  // --- tyres -------------------------------------------------------
  /* Bandpassed rather than raw: a sliding tyre is a squeal with a
     pitch, and the pitch rises as the slip does. Q is high enough to
     hear a note in it and low enough not to whistle. */
  const scrubGainNode = ctx.createGain();
  scrubGainNode.gain.value = 0;
  scrubGainNode.connect(shaper);
  const scrubFilter = ctx.createBiquadFilter();
  scrubFilter.type = 'bandpass';
  scrubFilter.frequency.value = 1400;
  scrubFilter.Q.value = 5;
  scrubFilter.connect(scrubGainNode);
  loopingNoise(ctx, noise, scrubFilter, sources);

  // --- kerbs and grass ---------------------------------------------
  const rumbleGainNode = ctx.createGain();
  rumbleGainNode.gain.value = 0;
  rumbleGainNode.connect(shaper);
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 220;
  rumbleFilter.Q.value = 1.2;
  rumbleFilter.connect(rumbleGainNode);
  loopingNoise(ctx, noise, rumbleFilter, sources);

  return {
    master,
    engine,
    engineSub,
    engineGainNode,
    subGain,
    whine,
    whineGain,
    windGainNode,
    scrubGainNode,
    scrubFilter,
    rumbleGainNode,
    waves,
    sources
  };
};

/**
 * Drive a built graph from one frame of simulation state.
 *
 * Exported alongside `buildVoices` so the whole chain — state in, sound
 * out — can be rendered offline and measured. `now` is passed in rather
 * than read from the context because an `OfflineAudioContext` does not
 * advance `currentTime` while you are scheduling into it.
 */
export const applyState = (
  v: Voices,
  state: VehicleState,
  throttle: number,
  now: number
): void => {
  const set = (p: AudioParam, value: number, time = SMOOTH): void => {
    p.setTargetAtTime(value, now, time);
  };

  const rpm = state.engineRpm;
  const hz = firingHz(rpm);

  set(v.engine.frequency, hz);
  set(v.engineSub.frequency, hz / 2);
  set(v.engineGainNode.gain, engineGain(rpm, throttle) * 0.16);
  set(v.subGain.gain, engineGain(rpm, throttle) * 0.05);

  /* Timbre follows the throttle, which is what makes lifting audible.
     Switched rather than swept — see `engineWaves`. */
  const step = Math.min(
    WAVE_STEPS - 1,
    Math.max(0, Math.round(throttle * (WAVE_STEPS - 1)))
  );
  const wave = v.waves[step];
  if (wave) v.engine.setPeriodicWave(wave);

  // Turbo an order and a half up, and only really there on power.
  set(v.whine.frequency, hz * 4.5);
  set(v.whineGain.gain, (state.overtakeDeploying ? 0.05 : 0.018) * throttle);

  set(v.windGainNode.gain, windGain(state.speed) * 0.09);

  /* The worst-behaved tyre sets the sound. Four separate voices would
     cost four filters to say the same thing, because what a driver
     needs from this is "something has let go", not which corner. */
  let scrub = 0;
  let rumble = 0;
  let pitch = 0;
  for (const w of state.wheels) {
    if (!w.grounded) continue;
    const s = scrubGain(w.slipAngle, w.slipRatio);
    if (s > scrub) {
      scrub = s;
      pitch = Math.abs(w.slipAngle);
    }
    rumble = Math.max(rumble, rumbleGain(w.surfaceGrip, w.load));
  }
  set(v.scrubGainNode.gain, scrub * 0.13, SHARP);
  set(v.scrubFilter.frequency, 1100 + pitch * 2200);
  set(v.rumbleGainNode.gain, rumble * 0.5, SHARP);
};

/**
 * The sound of the car, wired to the page.
 *
 * Silent until `start()` is called from a user gesture, and silent again
 * the moment the tab goes away — a game that keeps making engine noise
 * from a background tab is one people mute at the operating system and
 * never unmute.
 */
export class CarAudio {
  private ctx: AudioContext | null = null;
  private voices: Voices | null = null;
  private muted: boolean;

  constructor() {
    this.muted = readMuted();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a click or a touch, or the browser refuses. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;
    const voices = buildVoices(ctx, ctx.destination);
    this.voices = voices;

    voices.engine.start();
    voices.engineSub.start();
    voices.whine.start();
    for (const src of voices.sources) src.start();

    this.applyMute();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else if (!this.muted) void ctx.resume();
    });
  }

  /** One frame of state. Cheap enough to call every frame. */
  update(state: VehicleState, throttle: number): void {
    if (!this.ctx || !this.voices || this.muted) return;
    applyState(this.voices, state, throttle, this.ctx.currentTime);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(KEY, muted ? '1' : '0');
    } catch {
      /* Private mode. The setting is a convenience, not state. */
    }
    this.applyMute();
  }

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyMute(): void {
    if (!this.ctx || !this.voices) return;
    const target = this.muted ? 0 : 1;
    /* Ramped, not switched: muting with a step is itself a click. */
    this.voices.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    if (this.muted) void this.ctx.suspend();
    else void this.ctx.resume();
  }
}

const readMuted = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
