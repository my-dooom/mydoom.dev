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
  hue: [120, 300],
  hueSpread: [25, 140],
  fontSize: 16,
  // frame cap, for weak hosts (a Raspberry Pi panel). 0 = uncapped
  maxFps: 0,
  // background digital rain
  matrix: {
    enabled: true,
    fontSize: 18,
    hue: 150,
    // rows advanced per second
    speed: [8, 22],
    trail: 14,
  },
  // random glyph flicker on the finished art while it is held
  glitch: { rate: 0.5, count: 3, durationMs: 90 },
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
  },
  // drives the colour gradient from whatever the machine is playing.
  // The room microphone is never used: only loopback capture devices and the
  // browser's own system/tab audio share are accepted.
  audio: {
    enabled: true,
    // auto  : loopback device if one exists, else system capture on first click
    // system: always ask for system/tab audio via the share picker
    // loopback: only accept a loopback capture device
    // off   : no audio at all
    source: "auto",
    // input devices that are really the machine's own output
    loopbackPattern:
      "stereo mix|loopback|monitor of|what u ?hear|wave out|cable output|vb-audio|voicemeeter|blackhole|soundflower|virtual audio",
    fftSize: 2048,
    smoothing: 0.62,
    gain: 2.1,
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
      // transients. halfway keeps both
      relative: 0.55,
      // how fast that per-band average follows the music
      adapt: 0.02,
      // the frame is stretched across the palette; this is the smallest
      // spread that gets stretched, so silence stays flat
      span: 0.05,
      // every column keeps at least this much colour
      floor: 0.08,
      // hue degrees added by a fully lit band
      hue: 175,
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
    // degrees the hue slides between a dull and a bright spectrum
    hueRange: 190,
    // extra hue kick on a detected beat
    beatHue: 65,
    // how much loudness widens the gradient and lifts the lightness
    spreadDrive: 1.4,
    lift: 42,
    // beat = bass energy this much above its running average
    beatThreshold: 1.32,
    beatCooldownMs: 180,
    // below this level for this long, the input counts as silent
    silenceLevel: 0.02,
    silenceGraceMs: 1500,
    // when there is no signal, fake a slow drift so the gradient still moves
    idleDrift: true,
    // corner note telling the user a click hands over system audio
    hint: true,
    // wait this long before offering the share picker again
    systemRetryMs: 30000,
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
  const cells = [];
  lines.forEach((line, row) => {
    for (let col = 0; col < width; col++) {
      cells.push({ ch: line[col] ?? " ", row, col, seed: Math.random() });
    }
  });
  return { cells, width, height: lines.length };
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
  return (audio.centroid - 0.5) * a.hueRange + audio.pulse * a.beatHue;
}

// The art doubles as a spectrum analyser: each column carries its own band,
// and the part of the column below that band's magnitude burns brighter.
function colorFor(cell, grid, brightness = 1) {
  const a = CONFIG.audio;
  const sp = a.spectrum;
  const u = grid.width > 1 ? cell.col / (grid.width - 1) : 0;
  const v = grid.height > 1 ? cell.row / (grid.height - 1) : 0;
  const t = u * (1 - palette.axis) + v * palette.axis;

  const mag = bandAt(cell.col);
  // the border sits on the baseline at half level and swings around it
  const border = baselineV - (mag - 0.5) * sp.swing;
  const bar = clamp01((v - border) / sp.edge);
  const crest = clamp01(1 - Math.abs(v - border) / sp.crest);
  const heat = mag * 0.3 + bar * 0.7;

  const spread = palette.spread * (1 + audio.mid * a.spreadDrive);
  const hue = palette.hue + spread * t + audioHueShift() + sp.hue * heat;
  const sat = 64 + 34 * clamp01(mag + 0.3) - 30 * crest;
  const light = Math.min(
    96,
    26 + 20 * brightness + a.lift * heat + crest * 34 + audio.pulse * 12
  );
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
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
      if (t < d) return [" ", null];
      if (t < d + s.scramble) {
        const flicker = ((t / 40) | 0) + i;
        return [
          SCRAMBLE_CHARS[flicker % SCRAMBLE_CHARS.length],
          "var(--scramble)",
        ];
      }
      const since = t - (d + s.scramble);
      if (since < 120) return [cell.ch, "var(--flash)"];
      return [cell.ch, colorFor(cell, grid)];
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
      if (hitX < 0 && hitY < 0) return [" ", null];
      const nearest = Math.min(
        hitX >= 0 ? hitX : Infinity,
        hitY >= 0 ? hitY : Infinity
      );
      if (nearest < 1.5) return [cell.ch, "var(--flash)"];
      return [cell.ch, colorFor(cell, grid, clamp01(1 - nearest / s.falloff))];
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
      if (head < row) return [" ", null];
      if (head < row + 1) return [randKana(), "var(--flash)"];
      if (head < row + s.tail) return [randKana(), "var(--scramble)"];
      return [cell.ch, colorFor(cell, grid)];
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
      if (behind < 0) return [" ", null];
      if (behind < 1) return [randKana(), "var(--flash)"];
      if (behind < s.tail) {
        // frozen per cell so the tail reads as text, not noise
        const frozen = KATAKANA[(cell.seed * KATAKANA.length) | 0];
        const fade = 1 - behind / s.tail;
        return [frozen, `hsl(${CONFIG.matrix.hue} 100% ${20 + 45 * fade}%)`];
      }
      if (cell.ch === " ") return [" ", null];
      const settled = clamp01((behind - s.tail) / (s.tail * 1.5));
      if (settled < 0.35) return [randChar(), "var(--scramble)"];
      return [cell.ch, colorFor(cell, grid, settled)];
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
      if (local < 0) return [" ", null];
      const shift = Math.max(0, Math.ceil(s.offset - local * s.speed));
      const left = (cell.row % 2 === 0) === (s.flip > 0);
      const src = left ? cell.col + shift : cell.col - shift;
      if (src < 0 || src >= grid.width) return [" ", null];
      const ch = grid.cells[cell.row * grid.width + src].ch;
      return [ch, colorFor(cell, grid, shift > 0 ? 0.35 : 1)];
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
      if (gap < 0) return [" ", null];
      if (gap < 1.5) return [randChar(), "var(--flash)"];
      return [cell.ch, colorFor(cell, grid, clamp01(gap / s.falloff))];
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
  });
  window.addEventListener("pointerleave", () => (pointer.inside = false));
  window.addEventListener("pointerdown", (e) => {
    const { ripple } = CONFIG.pointer;
    pointer.ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() });
    if (pointer.ripples.length > ripple.max) pointer.ripples.shift();
    reactor?.onGesture(); // browsers gate system capture behind a gesture
  });
}

function pruneRipples(now) {
  const { life } = CONFIG.pointer.ripple;
  while (pointer.ripples.length && now - pointer.ripples[0].born > life) {
    pointer.ripples.shift();
  }
}

/* ----------------------------------------------------------------- audio */

// Capture APIs only exist on a secure origin: https, localhost or 127.0.0.1.
// Served over plain http from another machine, navigator.mediaDevices itself
// is undefined, so every audio path has to be skipped rather than tried.
const canCapture = () =>
  window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

class AudioReactor {
  constructor(bands) {
    this.cfg = CONFIG.audio;
    this.ctx = null;
    this.analyser = null;
    this.node = null;
    this.stream = null;
    this.bins = null;
    this.bassAvg = 0;
    this.lastBeat = 0;
    this.systemTriedAt = -Infinity;
    this.t0 = performance.now();
    this.bands = bands;
    this.raw = new Array(bands).fill(0);
    this.mean = new Array(bands).fill(0);
    this.dev = new Array(bands).fill(0);
    this.smooth = new Array(bands).fill(0);
    this.loEnv = 0;
    this.hiEnv = 0;
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
    if (!this.cfg.enabled || this.cfg.source === "off") return;
    if (!canCapture()) return; // idle drift takes over
    if (this.cfg.source !== "system") await this.openInput();
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
    this.analyser = analyser;
    this.bins = new Uint8Array(analyser.frequencyBinCount);
    this.hz = this.ctx.sampleRate / 2 / analyser.frequencyBinCount;
  }

  useStream(stream, label) {
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.ensureContext();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(stream);
    this.node.connect(this.analyser);
    audio.live = true;
    audio.source = label;
    stream.getAudioTracks()[0].addEventListener("ended", () => {
      if (this.stream === stream) this.detach();
    });
    return true;
  }

  detach() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = this.stream = null;
    audio.live = false;
    audio.source = "none";
  }

  // Prefers a loopback capture device (Stereo Mix, VB-Cable, a PulseAudio
  // monitor, BlackHole...). A device that does not look like a loopback is
  // rejected, so the room microphone is never listened to.
  async openInput() {
    const constraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    try {
      // labels are hidden until permission is granted, so probe first
      const probe = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
      });
      const loopback = await this.findLoopbackDevice();
      probe.getTracks().forEach((t) => t.stop());
      if (!loopback) return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...constraints, deviceId: { exact: loopback.deviceId } },
      });
      return this.useStream(stream, "loopback");
    } catch {
      return false; // denied or no device: idle drift takes over
    }
  }

  async findLoopbackDevice() {
    if (!navigator.mediaDevices.enumerateDevices) return null;
    const re = new RegExp(this.cfg.loopbackPattern, "i");
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find((d) => d.kind === "audioinput" && re.test(d.label));
  }

  // True system audio, but the browser demands a gesture and a picker where
  // the user has to tick "share audio".
  async captureSystem() {
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    const now = performance.now();
    // a dismissed picker should not re-prompt on every stray click
    if (now - this.systemTriedAt < this.cfg.systemRetryMs) return false;
    this.systemTriedAt = now;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        // Chromium: keep the shared audio audible on the user's speakers
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        preferCurrentTab: false,
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        return false; // user shared a surface but not its audio
      }
      // the video track only exists because the API requires it
      stream.getVideoTracks().forEach((t) => t.applyConstraints({ frameRate: 1 }));
      return this.useStream(stream, "system");
    } catch {
      return false;
    }
  }

  // called from the click handler, which is what unlocks both APIs
  async onGesture() {
    if (!this.cfg.enabled || this.cfg.source === "off") return;
    if (!canCapture()) return;
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    if (audio.source === "loopback" || audio.source === "system") return;
    if (this.cfg.source !== "loopback" && (await this.captureSystem())) return;
    await this.openInput();
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

    const total = bass + mid + high || 1;
    const centroid = (mid * 0.5 + high) / total;
    this.readSpectrum();

    // gentle follow so colour does not strobe on every frame
    audio.bass += (bass - audio.bass) * 0.35;
    audio.mid += (mid - audio.mid) * 0.25;
    audio.high += (high - audio.high) * 0.3;
    audio.level += (level - audio.level) * 0.25;
    audio.centroid += (centroid - audio.centroid) * 0.12;

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
    this.spans = [];
    this.prev = [];
    const frag = document.createDocumentFragment();
    grid.cells.forEach((cell, i) => {
      const span = document.createElement("span");
      span.textContent = " ";
      frag.appendChild(span);
      this.spans[i] = span;
      this.prev[i] = [" ", null];
      if (cell.col === grid.width - 1) frag.appendChild(document.createTextNode("\n"));
    });
    el.replaceChildren(frag);
  }

  draw(i, ch, color) {
    const prev = this.prev[i];
    if (prev[0] === ch && prev[1] === color) return;
    const span = this.spans[i];
    if (prev[0] !== ch) span.textContent = ch;
    if (prev[1] !== color) span.style.color = color ?? "transparent";
    this.prev[i] = [ch, color];
  }
}

/* ------------------------------------------------------- background rain */

class MatrixRain {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cfg = CONFIG.matrix;
    this.last = performance.now();
    this.resize();
    window.addEventListener("resize", () => this.resize());
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

      for (let i = 0; i < drop.glyphs.length; i++) {
        const y = (row - (drop.glyphs.length - 1 - i)) * this.cell;
        if (y < -this.cell || y > this.h) continue;
        const fade = i / drop.glyphs.length;
        const head = i === drop.glyphs.length - 1;
        const hue = this.cfg.hue + audioHueShift() + CONFIG.audio.spectrum.hue * band;
        ctx.fillStyle = head
          ? "#d8ffe8"
          : `hsl(${hue.toFixed(0)} 100% ${8 + 42 * fade + 30 * near + 34 * band}%)`;
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
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const dx = geo.left + (col + 0.5) * geo.cw - x;
      const dy = geo.top + (row + 0.5) * geo.ch - y;
      const d = Math.hypot(dx, dy);
      if (d <= r) cb(row * grid.width + col, d);
    }
  }
}

const rain = CONFIG.matrix.enabled
  ? new MatrixRain(document.getElementById("matrix"))
  : null;
const reactor = CONFIG.audio.enabled ? new AudioReactor(grid.width) : null;

const hintEl = document.getElementById("hint");
hintEl.hidden = !(CONFIG.audio.enabled && CONFIG.audio.hint);
if (!hintEl.hidden && !canCapture()) {
  hintEl.textContent =
    "audio needs a secure origin — open this over https, or on localhost";
}
function updateHint() {
  if (hintEl.hidden) return;
  if (audio.source === "system" || audio.source === "loopback") {
    hintEl.hidden = true;
  }
}

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
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i];
    // whitespace is never painted: the animations only touch the lettering
    if (cell.ch === " ") continue;
    const [ch, color] = effect.frame(t, cell, grid, state, i);
    renderer.draw(i, ch, color);
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
  if (Math.random() < rate * (1 + audio.pulse * 2)) {
    for (let n = 0; n < count; n++) {
      const i = (Math.random() * grid.cells.length) | 0;
      if (grid.cells[i].ch !== " ") glitches.set(i, now + durationMs);
    }
  }
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i];
    if (cell.ch === " ") continue;
    const until = glitches.get(i);
    if (until !== undefined) {
      if (until > now) {
        renderer.draw(i, randChar(), "var(--scramble)");
        continue;
      }
      glitches.delete(i);
    }
    renderer.draw(i, cell.ch, colorFor(cell, grid));
  }
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
  rain?.step(now);
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

window.addEventListener("resize", fit);
document.fonts?.ready.then(fit);
fit();
reactor?.start();
startPhase("in", performance.now());
requestAnimationFrame(loop);
