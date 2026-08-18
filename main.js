// Omarchy-style screensaver, in a browser.
// Renders the ASCII art from #art-source with a random terminal-text-effects
// style animation, then replays with a different effect. Nothing is clickable.

const CONFIG = {
  // "random" or one of the keys in EFFECTS
  effect: "random",
  // the finished art is held for a random time in this range (ms)
  holdMs: [3500, 9000],
  // the exit animation is the entry animation played backwards, this fast
  outroSpeed: [1.2, 2.4],
  // a fresh hue is rolled for every cycle from this range, with this spread
  hue: [180, 255],
  hueSpread: [20, 80],
  // hard walls on the finished hue. the sweep, the spectral drift and the beat
  // kick all stack, and without this they add up past 360 and wrap into red
  hueWindow: [155, 290],
  fontSize: 16,
  // frame cap, for weak hosts (a Raspberry Pi panel). 0 = uncapped
  maxFps: 0,
  // background digital rain
  matrix: {
    enabled: true,
    fontSize: 18,
    hue: 178,
    // rows advanced per second
    speed: [8, 22],
    trail: 14,
  },
  // random glyph flicker on the finished art while it is held
  glitch: { rate: 0.5, count: 3, durationMs: 90 },
  // halo burnt around the lettering. a base radius that swells with the music
  // and a failing-tube flicker riding on top of it
  bloom: {
    enabled: true,
    // px radius of the tight core and of the wide haze, when nothing is playing
    radius: [7, 26],
    // px added to the haze at full loudness, and on a beat
    drive: 20,
    beat: 16,
    flicker: {
      // how far the halo is allowed to sag, and how fast it wanders there
      depth: 0.34,
      speed: 7,
      // brownouts: chance per second, how far they pull the halo down and how
      // long they take to recover
      dropRate: 1.1,
      dropDepth: 0.6,
      dropDecay: 0.09,
    },
  },
  // local reaction around the cursor and around clicks
  pointer: {
    enabled: true,
    // radius of the hover disturbance, in px
    radius: 150,
    // chance a cell inside the hover disturbance flips per frame, at the centre
    hoverRate: 0.55,
    // expanding click shockwave
    ripple: { speed: 0.9, width: 46, life: 1400, max: 6 },
    // how much faster the rain falls under the cursor
    rainBoost: 2.5,
    // the cursor plays the drone while it is over the art: left to right opens
    // the filter, up and down bends the pitch, a click strikes a note
    drone: {
      enabled: true,
      // multiplier on the drone cutoff, across the width of the art
      cutoff: [0.35, 2.8],
      // cents the drone is pulled at the very top or bottom of the art
      bend: 600,
      // time constant of the glide, and how much slower it settles back
      glide: 0.12,
      release: 6,
      // a click plays a note: column picks the degree, row picks the octave
      strike: true,
    },
  },
  // drives the colour gradient from a generative synth running in the page.
  // Nothing is captured and nothing is downloaded: the analyser listens to
  // the only thing making noise, which is this file.
  audio: {
    enabled: true,
    fftSize: 2048,
    smoothing: 0.62,
    gain: 1.5,
    // the ambient patch the art is listening to
    synth: {
      // master level. the analyser sits after it, so this also sets how hard
      // the art is driven
      volume: 0.3,
      bpm: 76,
      // MIDI note the drone sits on, and the degrees a voice may pick from.
      // It sits above 160 Hz on purpose: the beat detector watches the band
      // below that, and a drone parked in there pins it and kills every beat
      root: 57,
      scale: [0, 3, 5, 7, 10],
      // semitone moves the key is allowed to make, and how often it moves
      keyMoves: [0, -2, 3, 5, -5, 7],
      keyEverySteps: 64,
      // stacked detuned oscillators under everything. the cutoff sweep is the
      // loudest thing the spectrum sees, so it wants real range and a period
      // short enough to watch: sweep is in Hz, 0.09 is one pass every ~11s.
      // the floor stays well above the noise voice below — dropped under it
      // the drone vanishes, the noise becomes the brightest thing left, and
      // the measured centroid climbs while the drone is getting darker
      drone: { voices: 3, detune: 8, cutoff: [300, 2600], sweep: 0.09 },
      // scheduled notes: chance per eighth, and how long each one rings
      pluck: { chance: 0.5, decay: [1.2, 3.4], octaves: [0, 1, 1, 2], level: 0.5 },
      // low thump every N steps, which is what the beat detector keys on
      sub: { everySteps: 4, decay: 0.55, level: 0.9 },
      // filtered noise, sweeping, for the top end
      noise: { level: 0.05, band: [900, 6500], sweep: 0.023, q: 1.4 },
      delay: { time: 0.39, feedback: 0.5, level: 0.45 },
    },
    // the art columns are a log-spaced spectrum over this range
    spectrum: {
      fMin: 30,
      fMax: 12000,
      // the dB window the byte spectrum is mapped over. loud music lives
      // near the top, so the ceiling has to sit well above the -30 default
      dbFloor: -95,
      dbCeil: -8,
      // lifts the quiet top end, added after the dB mapping so it cannot clip
      tilt: 0.22,
      // the byte spectrum is already logarithmic, so no extra compression
      curve: 1,
      // columns of horizontal bleed, so one loud band paints a wide area
      blur: 3,
      // dense music fills every band, so part of each band's own running
      // average is subtracted. 0 keeps the raw shape, 1 leaves only the
      // transients. this is what gives the bars their contrast, so it stays
      // high; what keeps a sustained drone from being subtracted away with it
      // is the slow adapt below, not a low value here
      relative: 0.5,
      // how fast that per-band average follows the music. must stay slower
      // than the drone sweep, or the sweep is tracked out as it happens
      adapt: 0.006,
      // the frame is stretched across the palette; this is the smallest
      // spread that gets stretched, so silence stays flat
      span: 0.05,
      // every column keeps at least this much colour
      floor: 0.08,
      // hue degrees added by a fully lit band
      hue: 110,
      // how fast the spectral centroid forgets its old extremes, the narrowest
      // range of it that still gets stretched over the full hue, and how much
      // headroom is left past the extremes it has actually seen
      centroidAdapt: 0.004,
      centroidSpan: 0.06,
      centroidMargin: 0.12,
      // deliberately sluggish: plucks are loud and short and would otherwise
      // shake the reading around far harder than the drone sweep moves it
      centroidFollow: 0.03,
      // where the lit/dim border rests: "auto" centres it on the biggest
      // block of lettering, or give a 0..1 fraction of the art height
      baseline: "auto",
      // how far above and below that line the border swings
      swing: 1.05,
      // how sharply the analyser bar edge cuts across the art
      edge: 0.22,
      // bright crest riding on the border itself
      crest: 0.1,
      follow: 0.5,
    },
    // degrees the hue slides between a dull and a bright spectrum. large on
    // purpose: hueWindow is a hard wall, so the drift can be pushed as far as
    // it likes without ever escaping into warm colours
    hueRange: 210,
    // degrees the hue moves with the drone's own pitch, bend and key
    toneHue: 85,
    // extra hue kick on a detected beat
    beatHue: 55,
    // how much loudness widens the gradient and lifts the lightness
    spreadDrive: 1.4,
    lift: 20,
    // beat = bass energy this much above its running average
    beatThreshold: 1.32,
    beatCooldownMs: 180,
    // below this level for this long, the input counts as silent
    silenceLevel: 0.02,
    silenceGraceMs: 1500,
    // when there is no signal, fake a slow drift so the gradient still moves
    idleDrift: true,
    // corner note telling the user a click starts the sound, shown only while
    // the autoplay policy is actually holding the context shut
    hint: true,
  },
};

// half-width katakana, the classic digital-rain alphabet
const KATAKANA =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
const SCRAMBLE_CHARS =
  KATAKANA + "0123456789:.=*+-<>¦｜╌abcdefghijklmnopqrstuvwxyz█▓▒░▄▀";

const rand = (a, b) => a + Math.random() * (b - a);
const randOf = (r) => (Array.isArray(r) ? rand(r[0], r[1]) : r);
const coin = () => (Math.random() < 0.5 ? -1 : 1);
const randChar = () =>
  SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
const randKana = () => KATAKANA[(Math.random() * KATAKANA.length) | 0];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// shifts a delay list so the earliest cell starts at 0, whatever the direction
function normalize(delays) {
  const min = Math.min(...delays);
  return delays.map((d) => d - min);
}

/* ------------------------------------------------------------------ grid */

function readArt() {
  const raw = document.getElementById("art-source").textContent;
  const lines = raw.replace(/\t/g, "    ").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(
    ...lines
      .filter((l) => l.trim())
      .map((l) => l.length - l.trimStart().length)
  );
  return lines.map((l) => l.slice(indent).replace(/\s+$/, ""));
}

function buildGrid(lines) {
  const width = Math.max(...lines.map((l) => l.length));
  const height = lines.length;
  const cells = [];
  // nothing ever paints a blank cell, so the render loops walk this instead
  const ink = [];
  lines.forEach((line, row) => {
    for (let col = 0; col < width; col++) {
      const ch = line[col] ?? " ";
      if (ch !== " ") ink.push(cells.length);
      cells.push({
        ch,
        row,
        col,
        u: width > 1 ? col / (width - 1) : 0,
        v: height > 1 ? row / (height - 1) : 0,
        seed: Math.random(),
      });
    }
  });
  return { cells, width, height, ink: Int32Array.from(ink) };
}

// vertical centre of the tallest unbroken block of lettering, as a 0..1
// fraction: for a logo over a subtitle this lands in the middle of the logo
function inkBaseline(lines) {
  let best = null;
  let run = null;
  lines.forEach((line, row) => {
    if (line.trim()) {
      run = run ?? { from: row, to: row };
      run.to = row;
    } else if (run) {
      if (!best || run.to - run.from > best.to - best.from) best = run;
      run = null;
    }
  });
  if (run && (!best || run.to - run.from > best.to - best.from)) best = run;
  if (!best) return 0.5;
  return (best.from + best.to) / 2 / Math.max(1, lines.length - 1);
}

/* --------------------------------------------------------------- palette */

const palette = { hue: 150, spread: 80, axis: 0 };

// height the analyser border rests at, filled in once the art is measured
let baselineV = 0.5;

// filled by AudioReactor, read by every colour decision
const audio = {
  live: false,
  source: "none",
  level: 0,
  bass: 0,
  mid: 0,
  high: 0,
  centroid: 0.5,
  // -1..1, where the drone is pitched right now: bend plus key moves. read
  // straight off the synth rather than inferred from the FFT
  tone: 0,
  pulse: 0,
  // one magnitude per art column, log-spaced across the spectrum
  spectrum: [],
};

const bandAt = (col) => audio.spectrum[col] || 0;

// magnitude at a horizontal screen fraction, for anything not on the art grid
function bandAtFraction(f) {
  const n = audio.spectrum.length;
  if (!n) return 0;
  return audio.spectrum[Math.min(n - 1, Math.max(0, (f * n) | 0))] || 0;
}

function rollPalette() {
  palette.hue = randOf(CONFIG.hue);
  palette.spread = randOf(CONFIG.hueSpread) * coin();
  palette.axis = Math.random(); // 0 = across, 1 = down
}

// hue slides with the spectral balance, and every beat throws a short kick
function audioHueShift() {
  const a = CONFIG.audio;
  return (
    (audio.centroid - 0.5) * a.hueRange +
    audio.tone * a.toneHue +
    audio.pulse * a.beatHue
  );
}

// the parts of a colour decision that are the same for every cell in a frame,
// refreshed once per frame instead of once per cell
const tint = { hueShift: 0, spread: 0 };

function syncTint() {
  tint.hueShift = audioHueShift();
  tint.spread = palette.spread * (1 + audio.mid * CONFIG.audio.spreadDrive);
}

// folds a hue back inside CONFIG.hueWindow instead of letting it wrap. a fold
// rather than a clamp, so a gradient running off the end reverses and keeps
// its shape instead of flattening against the wall
function foldHue(h) {
  const [lo, hi] = CONFIG.hueWindow;
  const span = hi - lo;
  if (span <= 0) return lo;
  const x = (((h - lo) % (2 * span)) + 2 * span) % (2 * span);
  return lo + (x <= span ? x : 2 * span - x);
}

// The art doubles as a spectrum analyser: each column carries its own band,
// and the part of the column below that band's magnitude burns brighter.
function colorFor(cell, brightness = 1) {
  const a = CONFIG.audio;
  const sp = a.spectrum;
  const v = cell.v;
  const t = cell.u * (1 - palette.axis) + v * palette.axis;

  const mag = bandAt(cell.col);
  // the border sits on the baseline at half level and swings around it
  const border = baselineV - (mag - 0.5) * sp.swing;
  const bar = clamp01((v - border) / sp.edge);
  const crest = clamp01(1 - Math.abs(v - border) / sp.crest);
  const heat = mag * 0.3 + bar * 0.7;

  const hue = foldHue(
    palette.hue + tint.spread * t + tint.hueShift + sp.hue * heat
  );
  const sat = 30 + 18 * clamp01(mag + 0.3) - 18 * crest;
  // capped well below white: only the crest of a loud band gets to glow
  const light = Math.min(
    54,
    10 + 9 * brightness + a.lift * heat + crest * 16 + audio.pulse * 5
  );
  return `hsl(${Math.round(hue)} ${Math.round(sat)}% ${Math.round(light)}%)`;
}

// effects hand back a [char, colour] pair; a shared tuple keeps a full-grid
// frame from allocating one array per cell
const PAIR = [" ", null];
function out(ch, color) {
  PAIR[0] = ch;
  PAIR[1] = color;
  return PAIR;
}

/* --------------------------------------------------------------- effects */
// Each effect: init(grid) -> state, frame(t, cell, grid, state) -> [char, color]
// and a duration(grid, state) in ms.

const EFFECTS = {
  // characters resolve out of random noise, sweeping in a random direction
  decrypt: {
    init(grid) {
      const wCol = rand(-16, 16);
      const wRow = rand(-45, 45);
      const jitter = rand(150, 900);
      return {
        delays: normalize(
          grid.cells.map((c) => c.col * wCol + c.row * wRow + c.seed * jitter)
        ),
        scramble: rand(400, 1100),
      };
    },
    duration: (grid, s) => Math.max(...s.delays) + s.scramble + 400,
    frame(t, cell, grid, s, i) {
      const d = s.delays[i];
      if (t < d) return out(" ", null);
      if (t < d + s.scramble) {
        const flicker = ((t / 40) | 0) + i;
        return out(
          SCRAMBLE_CHARS[flicker % SCRAMBLE_CHARS.length],
          "var(--scramble)"
        );
      }
      const since = t - (d + s.scramble);
      if (since < 120) return out(cell.ch, "var(--flash)");
      return out(cell.ch, colorFor(cell));
    },
  },

  // light beams sweep across and down, lighting up what they cross
  beams: {
    init: (grid) => ({
      speedX: grid.width / rand(900, 2200),
      speedY: grid.height / rand(1000, 2400),
      dirX: coin(),
      dirY: coin(),
      falloff: rand(6, 22),
    }),
    duration: (grid, s) =>
      Math.max(grid.width / s.speedX, grid.height / s.speedY) + 600,
    frame(t, cell, grid, s) {
      const col = s.dirX > 0 ? cell.col : grid.width - 1 - cell.col;
      const row = s.dirY > 0 ? cell.row : grid.height - 1 - cell.row;
      const hitX = t * s.speedX - col;
      const hitY = t * s.speedY - row;
      if (hitX < 0 && hitY < 0) return out(" ", null);
      const nearest = Math.min(
        hitX >= 0 ? hitX : Infinity,
        hitY >= 0 ? hitY : Infinity
      );
      if (nearest < 1.5) return out(cell.ch, "var(--flash)");
      return out(cell.ch, colorFor(cell, clamp01(1 - nearest / s.falloff)));
    },
  },

  // characters rain down column by column behind a bright drop head
  rain: {
    init: (grid) => ({
      colDelay: Array.from({ length: grid.width }, () => rand(0, rand(200, 1600))),
      speed: rand(0.02, 0.07),
      dir: coin(),
      tail: rand(2, 7),
    }),
    duration(grid, s) {
      return Math.max(...s.colDelay) + grid.height / s.speed + 500;
    },
    frame(t, cell, grid, s) {
      const row = s.dir > 0 ? cell.row : grid.height - 1 - cell.row;
      const head = (t - s.colDelay[cell.col]) * s.speed;
      if (head < row) return out(" ", null);
      if (head < row + 1) return out(randKana(), "var(--flash)");
      if (head < row + s.tail) return out(randKana(), "var(--scramble)");
      return out(cell.ch, colorFor(cell));
    },
  },

  // columns of katakana pour down, burn out, and leave the art behind
  matrix: {
    init(grid) {
      const stagger = rand(40, 160);
      const group = 3 + ((Math.random() * 6) | 0);
      return {
        colDelay: Array.from(
          { length: grid.width },
          (_, c) => rand(0, 600) + (c % group) * stagger
        ),
        speed: rand(0.018, 0.045),
        tail: 4 + ((Math.random() * 8) | 0),
        settle: rand(500, 1300),
        dir: coin(),
      };
    },
    duration: (grid, s) =>
      Math.max(...s.colDelay) + (grid.height + s.tail) / s.speed + s.settle,
    frame(t, cell, grid, s) {
      const row = s.dir > 0 ? cell.row : grid.height - 1 - cell.row;
      const head = (t - s.colDelay[cell.col]) * s.speed;
      const behind = head - row;
      if (behind < 0) return out(" ", null);
      if (behind < 1) return out(randKana(), "var(--flash)");
      if (behind < s.tail) {
        // frozen per cell so the tail reads as text, not noise
        const frozen = KATAKANA[(cell.seed * KATAKANA.length) | 0];
        const fade = 1 - behind / s.tail;
        return out(
          frozen,
          `hsl(${CONFIG.matrix.hue} 45% ${Math.round(10 + 26 * fade)}%)`
        );
      }
      if (cell.ch === " ") return out(" ", null);
      const settled = clamp01((behind - s.tail) / (s.tail * 1.5));
      if (settled < 0.35) return out(randChar(), "var(--scramble)");
      return out(cell.ch, colorFor(cell, settled));
    },
  },

  // rows slide into place from alternating sides
  slide: {
    init: (grid) => ({
      offset: grid.width,
      speed: rand(0.03, 0.11),
      rowDelay: rand(10, 90),
      flip: coin(),
      fromBottom: Math.random() < 0.5,
    }),
    duration: (grid, s) =>
      grid.height * s.rowDelay + s.offset / s.speed + 300,
    frame(t, cell, grid, s) {
      const order = s.fromBottom ? grid.height - 1 - cell.row : cell.row;
      const local = t - order * s.rowDelay;
      if (local < 0) return out(" ", null);
      const shift = Math.max(0, Math.ceil(s.offset - local * s.speed));
      const left = (cell.row % 2 === 0) === (s.flip > 0);
      const src = left ? cell.col + shift : cell.col - shift;
      if (src < 0 || src >= grid.width) return out(" ", null);
      const ch = grid.cells[cell.row * grid.width + src].ch;
      return out(ch, colorFor(cell, shift > 0 ? 0.35 : 1));
    },
  },

  // art blooms outward from a random point
  expand: {
    init(grid) {
      const cx = rand(0.15, 0.85) * (grid.width - 1);
      const cy = rand(0.1, 0.9) * (grid.height - 1);
      const aspect = 0.5; // monospace cells are ~2x taller than wide
      return {
        dist: grid.cells.map((c) =>
          Math.hypot((c.col - cx) * aspect, c.row - cy)
        ),
        speed: rand(0.015, 0.05),
        falloff: rand(3, 12),
      };
    },
    duration: (grid, s) => Math.max(...s.dist) / s.speed + 700,
    frame(t, cell, grid, s, i) {
      const gap = t * s.speed - s.dist[i];
      if (gap < 0) return out(" ", null);
      if (gap < 1.5) return out(randChar(), "var(--flash)");
      return out(cell.ch, colorFor(cell, clamp01(gap / s.falloff)));
    },
  },
};

/* --------------------------------------------------------------- pointer */

// The page stays non-interactive (pointer-events: none), so input is read from
// window-level listeners and only ever drives decoration.
const pointer = {
  x: -1e5,
  y: -1e5,
  inside: false,
  ripples: [],
};

if (CONFIG.pointer.enabled) {
  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    const p = artPoint(e);
    if (p) reactor?.hover(p.x, p.y);
    else reactor?.release();
  });
  window.addEventListener("pointerleave", () => {
    pointer.inside = false;
    reactor?.release();
  });
  window.addEventListener("pointerdown", (e) => {
    const { ripple } = CONFIG.pointer;
    pointer.ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() });
    if (pointer.ripples.length > ripple.max) pointer.ripples.shift();
    reactor?.onGesture(); // the autoplay policy holds the sound until this
    const p = artPoint(e);
    if (p) reactor?.strike(p.x, p.y);
  });
}

// where a pointer event landed inside the art, 0..1 on each axis, or null if
// it landed on the margin around it
function artPoint(e) {
  const x = (e.clientX - geo.left) / (geo.cw * grid.width);
  const y = (e.clientY - geo.top) / (geo.ch * grid.height);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function pruneRipples(now) {
  const { life } = CONFIG.pointer.ripple;
  while (pointer.ripples.length && now - pointer.ripples[0].born > life) {
    pointer.ripples.shift();
  }
}

/* ----------------------------------------------------------------- audio */

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

// A generative ambient patch: a detuned drone, a sub thump on the beat grid,
// plucked notes off a pentatonic scale and a band of sweeping noise. It is the
// only sound source in the page, and the analyser is wired across its output,
// so the art is reacting to music the art is also playing.
class Synth {
  constructor(ctx, cfg) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.step = 0;
    this.root = cfg.root;
    this.timer = null;
    // scheduling horizon: notes are queued this far ahead of the clock, which
    // is what keeps them off the main thread's timing
    this.lookahead = 0.2;

    // voices -> bus -> compressor -> out, with a feedback delay tapped off the
    // bus. the compressor stops a dense moment from pinning every FFT band
    this.bus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.out = ctx.createGain();
    this.out.gain.value = cfg.volume;
    this.bus.connect(comp).connect(this.out);

    // summed into every drone oscillator's detune, so the cursor can bend the
    // whole stack without disturbing the per-voice spread
    this.bend = ctx.createConstantSource();
    this.bend.offset.value = 0;
    this.bend.start();

    const delay = ctx.createDelay(2);
    delay.delayTime.value = cfg.delay.time;
    const fb = ctx.createGain();
    fb.gain.value = cfg.delay.feedback;
    const wet = ctx.createGain();
    wet.gain.value = cfg.delay.level;
    this.bus.connect(delay).connect(fb).connect(delay);
    delay.connect(wet).connect(comp);
  }

  start() {
    this.buildDrone();
    this.buildNoise();
    this.nextStep = this.ctx.currentTime + 0.1;
    // an interval rather than the render loop, so the music does not stutter
    // on a frame the browser decides to skip
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  get stepDur() {
    return 30 / this.cfg.bpm; // eighth notes
  }

  buildDrone() {
    const { ctx, cfg } = this;
    const d = cfg.drone;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6;
    const mid = (d.cutoff[0] + d.cutoff[1]) / 2;
    filter.frequency.value = mid;
    this.droneFilter = filter;
    this.droneBase = mid;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = d.sweep;
    const depth = ctx.createGain();
    depth.gain.value = (d.cutoff[1] - d.cutoff[0]) / 2;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();

    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    filter.connect(gain).connect(this.bus);

    this.droneOscs = [];
    for (let i = 0; i < d.voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "sawtooth" : "triangle";
      // one voice a fifth up, the rest detuned around the root
      osc.frequency.value = midiHz(this.root + (i === 2 ? 7 : 0));
      osc.detune.value = (i - (d.voices - 1) / 2) * d.detune;
      this.bend.connect(osc.detune);
      osc.connect(filter);
      osc.start();
      this.droneOscs.push(osc);
    }
  }

  // cursor position over the art, both 0..1, left/top first
  hover(x, y) {
    const h = CONFIG.pointer.drone;
    if (!this.droneFilter || !h.enabled) return;
    const t = this.ctx.currentTime;
    const mult = h.cutoff[0] + x * (h.cutoff[1] - h.cutoff[0]);
    const hz = clamp(this.droneBase * mult, 40, 12000);
    this.droneFilter.frequency.setTargetAtTime(hz, t, h.glide);
    this.bend.offset.setTargetAtTime((0.5 - y) * 2 * h.bend, t, h.glide);
  }

  release() {
    const h = CONFIG.pointer.drone;
    if (!this.droneFilter || !h.enabled) return;
    const t = this.ctx.currentTime;
    const slow = h.glide * h.release;
    this.droneFilter.frequency.setTargetAtTime(this.droneBase, t, slow);
    this.bend.offset.setTargetAtTime(0, t, slow);
  }

  strike(x, y) {
    const h = CONFIG.pointer.drone;
    if (!h.enabled || !h.strike) return;
    const scale = this.cfg.scale;
    const degree = scale[Math.min(scale.length - 1, (x * scale.length) | 0)];
    const octave = Math.min(2, ((1 - y) * 3) | 0);
    this.playPluck(this.ctx.currentTime + 0.02, this.root + degree + octave * 12);
  }

  buildNoise() {
    const { ctx, cfg } = this;
    const n = cfg.noise;
    const frames = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = n.q;
    filter.frequency.value = (n.band[0] + n.band[1]) / 2;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = n.sweep;
    const depth = ctx.createGain();
    depth.gain.value = (n.band[1] - n.band[0]) / 2;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();

    const gain = ctx.createGain();
    gain.gain.value = n.level;
    src.connect(filter).connect(gain).connect(this.bus);
    src.start();
  }

  tick() {
    const horizon = this.ctx.currentTime + this.lookahead;
    while (this.nextStep < horizon) {
      this.scheduleStep(this.step, this.nextStep);
      this.nextStep += this.stepDur;
      this.step++;
    }
  }

  scheduleStep(step, t) {
    const cfg = this.cfg;
    if (step % cfg.keyEverySteps === 0) this.moveKey(t);
    if (step % cfg.sub.everySteps === 0) this.playSub(t);
    if (Math.random() < cfg.pluck.chance) {
      const degree = cfg.scale[(Math.random() * cfg.scale.length) | 0];
      const octave = cfg.pluck.octaves[(Math.random() * cfg.pluck.octaves.length) | 0];
      this.playPluck(t, this.root + degree + octave * 12);
    }
  }

  moveKey(t) {
    const moves = this.cfg.keyMoves;
    this.root = this.cfg.root + moves[(Math.random() * moves.length) | 0];
    // slide rather than jump, so the drone never clicks
    this.droneOscs?.forEach((osc, i) => {
      osc.frequency.setTargetAtTime(midiHz(this.root + (i === 2 ? 7 : 0)), t, 1.5);
    });
  }

  playSub(t) {
    const { ctx, cfg } = this;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(cfg.sub.level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + cfg.sub.decay);
    // the sub is what the beat detector sees, so it skips the delay
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + cfg.sub.decay + 0.05);
  }

  playPluck(t, note) {
    const { ctx, cfg } = this;
    const decay = randOf(cfg.pluck.decay);
    const osc = ctx.createOscillator();
    osc.type = Math.random() < 0.5 ? "triangle" : "sine";
    osc.frequency.value = midiHz(note);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(6000, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + decay);

    const gain = ctx.createGain();
    const level = cfg.pluck.level * (0.4 + Math.random() * 0.6);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(filter).connect(gain).connect(this.bus);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}

class AudioReactor {
  constructor(bands) {
    this.cfg = CONFIG.audio;
    this.ctx = null;
    this.analyser = null;
    this.master = null;
    this.muted = false;
    this.node = null;
    this.synth = null;
    this.bins = null;
    this.bassAvg = 0;
    this.lastBeat = 0;
    this.t0 = performance.now();
    this.bands = bands;
    this.raw = new Array(bands).fill(0);
    this.mean = new Array(bands).fill(0);
    this.dev = new Array(bands).fill(0);
    this.smooth = new Array(bands).fill(0);
    this.loEnv = 0;
    this.hiEnv = 0;
    this.cLo = 0.5;
    this.cHi = 0.5;
    audio.spectrum = new Array(bands).fill(0);
    this.edges = this.bandEdges(bands);
  }

  // log-spaced band edges, one band per art column
  bandEdges(n) {
    const { fMin, fMax } = this.cfg.spectrum;
    const ratio = Math.log(fMax / fMin);
    return Array.from({ length: n + 1 }, (_, i) =>
      fMin * Math.exp((i / n) * ratio)
    );
  }

  async start() {
    if (!this.cfg.enabled) return;
    this.ensureContext();
    this.synth = new Synth(this.ctx, this.cfg.synth);
    this.synth.start();
    this.synth.out.connect(this.analyser);
    this.node = this.synth.out;
    audio.source = "synth";
    await this.unlock();
  }

  // Every browser starts an AudioContext suspended until the page has been
  // interacted with. Ask anyway: a kiosk started with a relaxed autoplay
  // policy will simply run, and everything else waits for the first click.
  async unlock() {
    if (!this.ctx) return false;
    try {
      await this.ctx.resume();
    } catch {
      /* still suspended */
    }
    audio.live = this.ctx.state === "running";
    return audio.live;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = this.cfg.fftSize;
    analyser.smoothingTimeConstant = this.cfg.smoothing;
    // the default window tops out at -30 dB, which any real track exceeds in
    // every band at once, leaving a flat wall of 255s
    analyser.minDecibels = this.cfg.spectrum.dbFloor;
    analyser.maxDecibels = this.cfg.spectrum.dbCeil;
    // the mute gain sits after the analyser, so a muted page still reads a
    // full spectrum and the art keeps dancing to music nobody can hear
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    analyser.connect(this.master).connect(this.ctx.destination);
    this.analyser = analyser;
    this.bins = new Uint8Array(analyser.frequencyBinCount);
    this.hz = this.ctx.sampleRate / 2 / analyser.frequencyBinCount;
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05);
  }

  // called from the click handler, which is what lifts the autoplay policy
  onGesture() {
    if (!this.cfg.enabled) return;
    return this.unlock();
  }

  hover(x, y) {
    this.synth?.hover(x, y);
  }

  release() {
    this.synth?.release();
  }

  strike(x, y) {
    this.synth?.strike(x, y);
  }

  band(from, to) {
    const a = Math.max(0, (from / this.hz) | 0);
    const b = Math.min(this.bins.length - 1, (to / this.hz) | 0);
    let sum = 0;
    for (let i = a; i <= b; i++) sum += this.bins[i];
    return sum / ((b - a + 1) * 255);
  }

  readSpectrum() {
    const sp = this.cfg.spectrum;
    const raw = this.raw;

    for (let i = 0; i < this.bands; i++) {
      const lo = this.edges[i];
      const hi = this.edges[i + 1];
      // narrow low bands can fall between FFT bins, so take the peak there
      const a = Math.min(this.bins.length - 1, Math.max(0, (lo / this.hz) | 0));
      const b = Math.min(this.bins.length - 1, Math.max(a, (hi / this.hz) | 0));
      let peak = 0;
      for (let k = a; k <= b; k++) if (this.bins[k] > peak) peak = this.bins[k];
      // pink-ish tilt so the quiet top octaves still light up
      const tilt = (i / this.bands) * sp.tilt;
      raw[i] = Math.pow(peak / 255 + tilt, sp.curve);
      // a dense mix pins every band near the top, so what is drawn is how
      // far each band sits from its own recent average
      this.mean[i] += (raw[i] - this.mean[i]) * sp.adapt;
      this.dev[i] = raw[i] - this.mean[i] * sp.relative;
    }

    this.blur(this.dev, this.smooth, sp.blur);
    this.trackSpan();
    const span = Math.max(sp.span, this.hiEnv - this.loEnv);

    for (let i = 0; i < this.bands; i++) {
      const stretched = clamp01((this.smooth[i] - this.loEnv) / span);
      const v = sp.floor + stretched * (1 - sp.floor);
      audio.spectrum[i] += (v - audio.spectrum[i]) * sp.follow;
    }
  }

  // box blur, so a single loud band lights a whole neighbourhood of columns
  blur(src, dst, radius) {
    const n = this.bands;
    const r = Math.max(0, radius | 0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let k = i - r; k <= i + r; k++) {
        if (k < 0 || k >= n) continue;
        // triangular weighting keeps the peak where it belongs
        const w = 1 - Math.abs(k - i) / (r + 1);
        sum += src[k] * w;
        count += w;
      }
      dst[i] = count ? sum / count : src[i];
    }
  }

  // envelopes of the quietest and loudest column, quick to open and slow to
  // close, so whatever spread the music has fills the whole art
  trackSpan() {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < this.bands; i++) {
      const v = this.smooth[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.loEnv += (lo - this.loEnv) * (lo < this.loEnv ? 0.45 : 0.06);
    this.hiEnv += (hi - this.hiEnv) * (hi > this.hiEnv ? 0.45 : 0.06);
  }

  fadeSpectrum(k) {
    for (let i = 0; i < this.bands; i++) audio.spectrum[i] *= k;
  }

  // A lowpass sweeping under a mix is hard to read back out of an FFT, and
  // filter.frequency.value never shows it anyway: an AudioParam reports its
  // own value, not the LFO summed into it. So take the pitch from the synth
  // directly. Bend and key moves are exact, and the ear hears them long
  // before a smoothed centroid catches up.
  publishTone() {
    const s = this.synth;
    if (!s) return;
    const bend = clamp(s.bend.offset.value / (CONFIG.pointer.drone.bend || 1), -1, 1);
    const key = (s.root - this.cfg.synth.root) / 12;
    const tone = clamp(bend * 0.7 + key, -1, 1);
    audio.tone += (tone - audio.tone) * 0.09;
  }

  // Where the energy sits across the log bands, 0..1. Taken from the raw
  // magnitudes rather than the drawn ones: the drawn ones have their running
  // mean subtracted, which is exactly what erases a sustained drone. A moving
  // filter cutoff drags this straight up and down, which is the point.
  spectralCentroid() {
    const sp = this.cfg.spectrum;
    let num = 0;
    let den = 0;
    for (let i = 0; i < this.bands; i++) {
      // squared, so the loud part of the spectrum decides and the noise floor
      // does not drag every reading back to the middle
      const w = this.raw[i] * this.raw[i];
      num += w * i;
      den += w;
    }
    if (!den) return 0.5;
    const c = num / (den * Math.max(1, this.bands - 1));
    // a real centroid only wanders over a narrow slice of the range, so track
    // its own recent extremes and stretch that slice across the full 0..1
    this.cLo += (c - this.cLo) * (c < this.cLo ? 0.3 : sp.centroidAdapt);
    this.cHi += (c - this.cHi) * (c > this.cHi ? 0.3 : sp.centroidAdapt);
    // padding the envelope keeps the ends off the hard stops, so the hue is
    // still moving at the extremes of the sweep instead of sitting pinned
    const pad = (this.cHi - this.cLo) * sp.centroidMargin;
    const span = Math.max(sp.centroidSpan, this.cHi - this.cLo + 2 * pad);
    return clamp01((c - (this.cLo - pad)) / span);
  }

  update(now) {
    if (!this.analyser || !this.node) return this.drift(now);

    this.analyser.getByteFrequencyData(this.bins);
    const g = this.cfg.gain;
    const bass = clamp01(this.band(20, 160) * g);
    const mid = clamp01(this.band(160, 2000) * g);
    const high = clamp01(this.band(2000, 9000) * g);
    // peak rather than average, so narrow-band material still drives the colour
    const level = clamp01(Math.max(bass, mid * 0.9, high * 0.8) * 1.2);

    // an open but silent input should not freeze the gradient
    if (level > this.cfg.silenceLevel) this.lastSound = now;
    if (now - (this.lastSound ?? 0) > this.cfg.silenceGraceMs) {
      return this.drift(now);
    }

    this.readSpectrum();
    const centroid = this.spectralCentroid();
    this.publishTone();

    // gentle follow so colour does not strobe on every frame
    audio.bass += (bass - audio.bass) * 0.35;
    audio.mid += (mid - audio.mid) * 0.25;
    audio.high += (high - audio.high) * 0.3;
    audio.level += (level - audio.level) * 0.25;
    audio.centroid += (centroid - audio.centroid) * this.cfg.spectrum.centroidFollow;

    this.bassAvg += (bass - this.bassAvg) * 0.06;
    const hot = bass > this.bassAvg * this.cfg.beatThreshold && bass > 0.12;
    if (hot && now - this.lastBeat > this.cfg.beatCooldownMs) {
      this.lastBeat = now;
      audio.pulse = 1;
    }
    audio.pulse *= 0.88;
  }

  // no signal: slow LFOs keep the gradient breathing
  drift(now) {
    if (!this.cfg.idleDrift) return this.fadeSpectrum(0.92);
    const t = (now - this.t0) / 1000;
    audio.centroid = 0.5 + 0.35 * Math.sin(t * 0.11) * Math.cos(t * 0.037);
    audio.level = 0.25 + 0.2 * Math.sin(t * 0.19 + 1.3);
    audio.mid = 0.3 + 0.25 * Math.sin(t * 0.07);
    audio.bass = 0.2 + 0.2 * Math.sin(t * 0.23);
    audio.tone = 0.6 * Math.sin(t * 0.043);
    audio.pulse *= 0.9;

    // a slow travelling hump keeps the analyser bar alive without a signal
    for (let i = 0; i < this.bands; i++) {
      const x = i / Math.max(1, this.bands - 1);
      const v =
        0.22 +
        0.3 * Math.sin(x * 5.2 + t * 0.5) * Math.sin(t * 0.13) +
        0.18 * Math.sin(x * 13 - t * 0.9);
      audio.spectrum[i] += (clamp01(v) - audio.spectrum[i]) * 0.08;
    }
  }
}

/* -------------------------------------------------------------- renderer */

class Renderer {
  constructor(el, grid) {
    this.el = el;
    this.grid = grid;
    this.spans = new Array(grid.cells.length).fill(null);
    this.prevCh = new Array(grid.cells.length).fill(" ");
    this.prevColor = new Array(grid.cells.length).fill(null);
    const frag = document.createDocumentFragment();
    // a blank cell is never painted, so it costs a character of text instead
    // of an element carrying a three-layer text-shadow
    let blanks = "";
    const flush = () => {
      if (blanks) frag.appendChild(document.createTextNode(blanks));
      blanks = "";
    };
    grid.cells.forEach((cell, i) => {
      if (cell.ch === " ") {
        blanks += " ";
      } else {
        flush();
        const span = document.createElement("span");
        span.textContent = " ";
        frag.appendChild(span);
        this.spans[i] = span;
      }
      if (cell.col === grid.width - 1) {
        blanks += "\n";
        flush();
      }
    });
    flush();
    el.replaceChildren(frag);
  }

  draw(i, ch, color) {
    const span = this.spans[i];
    if (!span) return;
    if (this.prevCh[i] !== ch) {
      span.textContent = ch;
      this.prevCh[i] = ch;
    }
    if (this.prevColor[i] !== color) {
      span.style.color = color ?? "transparent";
      this.prevColor[i] = color;
    }
  }
}

/* ------------------------------------------------------- background rain */

class MatrixRain {
  constructor(canvas) {
    this.canvas = canvas;
    // the first fill covers the whole canvas, so there is nothing to blend
    // with underneath and an opaque backing store composites far cheaper
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.cfg = CONFIG.matrix;
    this.last = performance.now();
    this.fill = "";
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.font = `${this.cfg.fontSize}px "Iosevka", "Cascadia Mono", monospace`;
    this.ctx.textBaseline = "top";

    this.cell = this.cfg.fontSize;
    this.cols = Math.ceil(this.w / this.cell);
    this.rows = Math.ceil(this.h / this.cell) + 1;
    this.drops = Array.from({ length: this.cols }, () => this.newDrop(true));
    this.ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  newDrop(scattered) {
    return {
      y: scattered ? rand(-this.rows, 0) : rand(-30, -2),
      speed: rand(this.cfg.speed[0], this.cfg.speed[1]),
      trail: (rand(0.6, 1.6) * this.cfg.trail) | 0,
      glyphs: [],
    };
  }

  step(now) {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const ctx = this.ctx;

    ctx.fillStyle = "rgba(11, 11, 15, 0.12)";
    ctx.fillRect(0, 0, this.w, this.h);
    this.fill = "";

    for (let c = 0; c < this.cols; c++) {
      const drop = this.drops[c];
      const x = c * this.cell;
      const near = this.disturbance(x, now);
      const band = bandAtFraction(x / this.w);
      const prevRow = drop.y | 0;
      drop.y += drop.speed * (1 + near * CONFIG.pointer.rainBoost + band * 3.5) * dt;
      const row = drop.y | 0;

      for (let r = prevRow + 1; r <= row; r++) drop.glyphs.push(randKana());
      if (drop.glyphs.length > drop.trail) {
        drop.glyphs.splice(0, drop.glyphs.length - drop.trail);
      }

      // only the band and the cursor vary across the screen, so the hue is a
      // per-column value, not a per-glyph one
      const hue = Math.round(
        foldHue(this.cfg.hue + tint.hueShift + CONFIG.audio.spectrum.hue * band)
      );
      const base = 4 + 18 * near + 20 * band;
      for (let i = 0; i < drop.glyphs.length; i++) {
        const y = (row - (drop.glyphs.length - 1 - i)) * this.cell;
        if (y < -this.cell || y > this.h) continue;
        const head = i === drop.glyphs.length - 1;
        const style = head
          ? "#9fc9bb"
          : `hsl(${hue} 55% ${Math.round(base + (22 * i) / drop.glyphs.length)}%)`;
        // re-parsing an identical colour string is the single most repeated
        // cost in this loop
        if (style !== this.fill) {
          ctx.fillStyle = style;
          this.fill = style;
        }
        ctx.fillText(drop.glyphs[i], x, y);
      }

      // occasionally mutate a glyph in the tail, like the film titles do
      if (drop.glyphs.length && Math.random() < 0.25 + near * 0.6) {
        drop.glyphs[(Math.random() * drop.glyphs.length) | 0] = randKana();
      }
      if (row - drop.trail > this.rows) this.drops[c] = this.newDrop(false);
    }
  }

  // 0..1 excitement for a column, from cursor proximity and click shockwaves
  disturbance(x, now) {
    if (!CONFIG.pointer.enabled) return 0;
    const { radius, ripple } = CONFIG.pointer;
    let energy = 0;
    if (pointer.inside) {
      energy = clamp01(1 - Math.abs(x - pointer.x) / radius);
    }
    for (const r of pointer.ripples) {
      const front = (now - r.born) * ripple.speed;
      const d = Math.abs(Math.abs(x - r.x) - front);
      if (d < ripple.width) {
        const decay = 1 - (now - r.born) / ripple.life;
        energy = Math.max(energy, clamp01(decay) * (1 - d / ripple.width));
      }
    }
    return energy;
  }
}

/* ------------------------------------------------------------------- app */

const artEl = document.getElementById("art");
const lines = readArt();
const grid = buildGrid(lines);
baselineV =
  CONFIG.audio.spectrum.baseline === "auto"
    ? inkBaseline(lines)
    : CONFIG.audio.spectrum.baseline;
const renderer = new Renderer(artEl, grid);
const effectNames = Object.keys(EFFECTS);
let lastEffect = null;

function pickEffect() {
  if (CONFIG.effect !== "random" && EFFECTS[CONFIG.effect]) {
    return CONFIG.effect;
  }
  const pool = effectNames.filter((n) => n !== lastEffect);
  lastEffect = pool[(Math.random() * pool.length) | 0];
  return lastEffect;
}

// screen-space box of the rendered art, used to map cursor position to cells
const geo = { left: 0, top: 0, cw: 1, ch: 1 };

function fit() {
  artEl.style.transform = "scale(1)";
  artEl.style.fontSize = `${CONFIG.fontSize}px`;
  const rect = artEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = Math.min(
    (window.innerWidth * 0.9) / rect.width,
    (window.innerHeight * 0.9) / rect.height
  );
  artEl.style.transform = `scale(${scale})`;

  const box = artEl.getBoundingClientRect();
  geo.left = box.left;
  geo.top = box.top;
  geo.cw = box.width / grid.width;
  geo.ch = box.height / grid.height;
}

// visits every cell whose centre is within r px of (x, y)
function forCellsNear(x, y, r, cb) {
  const c0 = Math.max(0, Math.floor((x - r - geo.left) / geo.cw));
  const c1 = Math.min(grid.width - 1, Math.ceil((x + r - geo.left) / geo.cw));
  const r0 = Math.max(0, Math.floor((y - r - geo.top) / geo.ch));
  const r1 = Math.min(grid.height - 1, Math.ceil((y + r - geo.top) / geo.ch));
  const rr = r * r;
  for (let row = r0; row <= r1; row++) {
    const dy = geo.top + (row + 0.5) * geo.ch - y;
    const base = row * grid.width;
    for (let col = c0; col <= c1; col++) {
      const dx = geo.left + (col + 0.5) * geo.cw - x;
      const d2 = dx * dx + dy * dy;
      if (d2 <= rr) cb(base + col, Math.sqrt(d2));
    }
  }
}

// a drag fires resize dozens of times a second, and every one of them
// remeasures the art and throws away every rain column
let resizeQueued = false;
function onResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    fit();
    rain?.resize();
  });
}

const rain = CONFIG.matrix.enabled
  ? new MatrixRain(document.getElementById("matrix"))
  : null;
const reactor = CONFIG.audio.enabled ? new AudioReactor(grid.width) : null;

const hintEl = document.getElementById("hint");
hintEl.hidden = !(CONFIG.audio.enabled && CONFIG.audio.hint);
function updateHint() {
  if (hintEl.hidden) return;
  if (audio.live) hintEl.hidden = true;
}

// the only thing on the page that accepts a click. muting stops the speakers,
// not the synth, so the visuals carry on unchanged
const muteEl = document.getElementById("mute");
muteEl.hidden = !CONFIG.audio.enabled;
muteEl.addEventListener("click", () => {
  // while the context is still suspended the button is the "start" button, so
  // the first click must not spend itself muting a synth nobody has heard yet
  const muted = audio.live && muteEl.getAttribute("aria-pressed") !== "true";
  muteEl.setAttribute("aria-pressed", String(muted));
  muteEl.textContent = muted ? "sound off" : "sound on";
  reactor?.setMuted(muted);
  if (!muted) reactor?.onGesture();
});

let phase = null;
const glitches = new Map();

// every effect is a pure function of time, so playing it backwards is a
// free exit animation and both ends of the cycle land on a blank canvas
function startPhase(kind, now) {
  const effect = EFFECTS[pickEffect()];
  const state = effect.init(grid);
  const total = effect.duration(grid, state);
  const speed = kind === "out" ? randOf(CONFIG.outroSpeed) : 1;
  if (kind === "in") rollPalette();
  phase = { kind, effect, state, start: now, total, speed };
}

function drawEffect(t) {
  const { effect, state } = phase;
  const ink = grid.ink;
  for (let n = 0; n < ink.length; n++) {
    const i = ink[n];
    const pair = effect.frame(t, grid.cells[i], grid, state, i);
    renderer.draw(i, pair[0], pair[1]);
  }
}

// drawn on top of whatever phase is running: cells near the cursor and along
// click shockwaves dissolve into katakana
function drawPointer(now) {
  if (!CONFIG.pointer.enabled) return;
  const { radius, hoverRate, ripple } = CONFIG.pointer;

  if (pointer.inside) {
    forCellsNear(pointer.x, pointer.y, radius, (i, d) => {
      if (grid.cells[i].ch === " ") return;
      const heat = 1 - d / radius;
      if (Math.random() > heat * hoverRate) return;
      renderer.draw(i, randKana(), heat > 0.75 ? "var(--flash)" : "var(--scramble)");
    });
  }

  for (const r of pointer.ripples) {
    const age = now - r.born;
    const front = age * ripple.speed;
    const decay = clamp01(1 - age / ripple.life);
    forCellsNear(r.x, r.y, front + ripple.width, (i, d) => {
      if (grid.cells[i].ch === " ") return;
      const edge = Math.abs(d - front);
      if (edge > ripple.width) return;
      const heat = (1 - edge / ripple.width) * decay;
      if (Math.random() > heat) return;
      renderer.draw(i, randChar(), heat > 0.6 ? "var(--flash)" : "var(--scramble)");
    });
  }
}

// held art keeps twitching: cells briefly flip to katakana and snap back
function drawIdle(now) {
  const { rate, count, durationMs } = CONFIG.glitch;
  const ink = grid.ink;
  if (Math.random() < rate * (1 + audio.pulse * 2)) {
    for (let n = 0; n < count; n++) {
      glitches.set(ink[(Math.random() * ink.length) | 0], now + durationMs);
    }
  }
  for (let n = 0; n < ink.length; n++) {
    const i = ink[n];
    const until = glitches.get(i);
    if (until !== undefined) {
      if (until > now) {
        renderer.draw(i, randChar(), "var(--scramble)");
        continue;
      }
      glitches.delete(i);
    }
    renderer.draw(i, grid.cells[i].ch, colorFor(grid.cells[i]));
  }
}

const bloom = { level: 1, target: 1, drop: 0, last: 0, css: "" };
const stillMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

// the halo is a text-shadow rather than a filter on purpose: a real blur pass
// over a full-screen grid of spans is what kills the Pi
function updateBloom(now) {
  const b = CONFIG.bloom;
  if (!b.enabled) return;
  const f = b.flicker;
  const dt = bloom.last ? Math.min(0.1, (now - bloom.last) / 1000) : 0;
  bloom.last = now;

  if (stillMotion?.matches) {
    bloom.level = 1;
    bloom.drop = 0;
  } else {
    bloom.target = 1 - f.depth * Math.random();
    bloom.level += (bloom.target - bloom.level) * (1 - Math.exp(-f.speed * dt));
    if (Math.random() < f.dropRate * dt) bloom.drop = 1;
    bloom.drop *= Math.exp(-dt / f.dropDecay);
  }

  const lit = clamp01(bloom.level * (1 - f.dropDepth * bloom.drop));
  const drive = audio.level * b.drive + audio.pulse * b.beat;
  const core = Math.round((b.radius[0] + drive * 0.35) * lit);
  const haze = Math.round((b.radius[1] + drive) * lit);
  // writing --glow repaints the shadow on every glyph, so a sub-pixel wobble
  // is not worth the repaint
  const css =
    `0 0 ${core}px currentColor,` +
    ` 0 0 ${haze}px currentColor,` +
    ` 0 0 ${Math.round(haze * 1.7)}px rgba(0, 0, 0, 0.6)`;
  if (css === bloom.css) return;
  bloom.css = css;
  artEl.style.setProperty("--glow", css);
}

let lastFrame = -Infinity;

function loop(now) {
  requestAnimationFrame(loop);
  if (CONFIG.maxFps > 0) {
    // a slack of half a frame keeps a 30 cap from landing on every other
    // 60 Hz tick and running at 20
    if (now - lastFrame < 1000 / CONFIG.maxFps - 8) return;
    lastFrame = now;
  }

  reactor?.update(now);
  syncTint();
  rain?.step(now);
  updateBloom(now);
  pruneRipples(now);
  const elapsed = (now - phase.start) * phase.speed;

  switch (phase.kind) {
    case "in":
      if (elapsed < phase.total) {
        drawEffect(elapsed);
      } else {
        drawEffect(phase.total);
        glitches.clear();
        phase = {
          kind: "hold",
          start: now,
          speed: 1,
          until: now + randOf(CONFIG.holdMs),
        };
      }
      break;
    case "hold":
      if (now >= phase.until) startPhase("out", now);
      else drawIdle(now);
      break;
    case "out":
      if (elapsed < phase.total) drawEffect(phase.total - elapsed);
      else startPhase("in", now);
      break;
  }

  drawPointer(now);
  updateHint();
}

window.addEventListener("resize", onResize);
document.fonts?.ready.then(fit);
fit();
reactor?.start();
startPhase("in", performance.now());
requestAnimationFrame(loop);
