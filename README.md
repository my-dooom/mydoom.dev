# omarchy-screensaver-web

Browser version of the Omarchy terminal screensaver: fullscreen ASCII art with
random `tte`-style text animations. Display only — nothing is clickable.

## Run

Open `index.html` directly, or serve it:

```sh
python -m http.server 8000
```

## Host it

`deploy.sh` puts the three files behind nginx on a Debian-ish box (Raspberry Pi
OS, Ubuntu). Everything the page does runs locally, so plain http over the LAN
is enough; TLS is on by default for hygiene rather than necessity.

```sh
sudo ./deploy.sh              # nginx + self-signed cert, http redirects to https
sudo ./deploy.sh --kiosk      # also autostart Chromium fullscreen on this machine
sudo ./deploy.sh --no-tls     # plain http
```

| flag         | meaning                                          |
| ------------ | ------------------------------------------------ |
| `--root DIR` | where the files are served from                  |
| `--host NAME`| name written into the certificate                |
| `--no-tls`   | skip TLS entirely                                |
| `--kiosk`    | Chromium autostart + screen blanking turned off  |
| `--public FQDN` | bind nginx to loopback and serve through a Cloudflare tunnel |

The certificate is self-signed, so a browser on another machine shows a warning
once. The kiosk browser is pointed at `localhost` and told to ignore it.

The kiosk entry passes `--autoplay-policy=no-user-gesture-required`, which is
what lets the sound start on a machine nobody is going to click.

## Putting it on the internet

There is no server code here, so the only thing worth protecting is the machine
underneath. Two ways, in order of preference:

**GitHub Pages.** Three static files need no Pi at all. `.github/workflows/pages.yml`
publishes them on every push: no open ports, no patching, a real certificate.
The Pi keeps serving itself over loopback.

**Cloudflare tunnel**, if it really has to come off the Pi:

```sh
sudo ./deploy.sh --public saver.example.com
```

nginx is then bound to `127.0.0.1` and the tunnel dials out, so no port is
forwarded and the router stays shut. The script prints the `cloudflared login /
create / route` steps it cannot do for you, since they need a browser.

Either way: never forward SSH, keep `unattended-upgrades` on, and put a box that
faces the internet on its own VLAN.

On a slow host the canvas rain and the FFT are the expensive parts. Set
`CONFIG.maxFps` to `30`, raise `CONFIG.matrix.fontSize` (bigger glyphs mean
fewer rain columns) and raise `CONFIG.fontSize`, or turn `CONFIG.matrix.enabled`
off altogether.

## Change the text

Edit the block inside `<script type="text/plain" id="art-source">` in
`index.html`. Any plain text or ASCII art works; leading indentation common to
all lines is trimmed and the art is auto-scaled to fit the viewport.

## Tweak

`CONFIG` at the top of `main.js`:

| key          | meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `effect`     | `"random"` or `decrypt` / `beams` / `rain` / `slide` / `expand` / `matrix`  |
| `holdMs`     | `[min, max]` time the finished art is held before it animates back out      |
| `outroSpeed` | `[min, max]` playback rate of the exit animation                            |
| `hue`        | range a fresh base hue is rolled from each cycle                            |
| `hueSpread`  | range of the hue sweep across the art (direction and axis are random too)   |
| `hueWindow`  | hard `[min, max]` walls the finished hue is folded back into                |
| `fontSize`   | base font size before auto-scaling                                         |
| `maxFps`     | frame cap for weak hosts; `0` is uncapped                                  |
| `matrix`     | background katakana rain: `enabled`, `fontSize`, `hue`, `speed`, `trail`    |
| `glitch`     | katakana twitching on the held art: `rate`, `count`, `durationMs`           |
| `pointer`    | local reaction: `enabled`, `radius`, `hoverRate`, `ripple`, `rainBoost`, `drone` |
| `audio`      | the synth and the analyser: `synth`, `gain`, `spectrum`, `beatHue`, `idleDrift` |

Every effect re-rolls its speeds, delays, sweep direction and origin on each
run, so no two cycles look the same.

The cycle is `in -> hold -> out -> in ...`. Every effect is a pure function of
time, so the exit is just the effect played in reverse, and both ends of the
loop meet on an empty canvas — no visible seam.

## The sound

The page makes its own music. Nothing is captured, nothing is downloaded: a
generative Web Audio patch runs in `CONFIG.audio.synth`, and the analyser is
wired across its output, so the art is reacting to music the art is also
playing.

Four voices, all built from oscillators:

- a **drone** of `drone.voices` detuned oscillators through a lowpass whose
  cutoff is swept between `drone.cutoff` by an LFO at `drone.sweep` Hz
- a **sub** thump every `sub.everySteps` eighths, pitched down from 95 Hz to
  38 Hz. It is deliberately the only thing living below 160 Hz, because that is
  the band the beat detector watches: park the drone down there and it pins the
  running average, and no beat ever fires again
- **plucks** picked off `scale` at a random octave from `pluck.octaves`, with a
  fast attack and a filter that closes over `pluck.decay`
- a band of **noise** sweeping between `noise.band`, for the top end

Notes are queued onto the audio clock `0.2 s` ahead by a `setInterval`, not by
the render loop, so a dropped frame does not become a dropped note. Every
`keyEverySteps` the root slides to a new degree from `keyMoves` — a slide, not a
jump, so the drone never clicks.

Browsers start every `AudioContext` suspended until the page has been
interacted with, so the first click is what starts the sound and the corner note
says so. Until then the analyser reads silence and the idle drift keeps the
colours moving. A kiosk started with `--autoplay-policy=no-user-gesture-required`
skips the wait.

## Music reaction

The art doubles as a spectrum analyser. The columns are log-spaced bands
between `spectrum.fMin` and `spectrum.fMax`, so column *n* carries its own slice
of the signal:

- **band magnitude → hue and brightness of that column** (`spectrum.hue`)
- **magnitude → bar height**: each column is split by a lit/dim border. The
  border rests on `spectrum.baseline` — `"auto"` puts it through the vertical
  middle of the tallest block of lettering (the logo, not the subtitle) — and
  swings up and down around it by `spectrum.swing` as the band gets louder or
  quieter. `spectrum.edge` sets how hard that border is.

Real music is dense: every band is loud at once, so a naive analyser paints the
whole art one flat colour. Three things keep the shape visible:

- `spectrum.dbFloor` / `spectrum.dbCeil` set the dB window the FFT bytes are
  mapped over. The browser default tops out at `-30 dB`, which a full patch
  blows past in every band, so the ceiling is pushed up to `-8`.
- `spectrum.relative` subtracts part of each band's own running average
  (`spectrum.adapt` sets how fast that average follows). `0` draws the raw
  spectrum, `1` draws only what changed; halfway keeps both the standing shape
  and the transients.
- the frame is then stretched between the quietest and loudest column, so the
  art always uses the full palette. `spectrum.span` is the smallest spread that
  gets stretched, which stops silence from being amplified into noise.

Those two pull against each other where the drone is concerned. A drone is
sustained by definition, so a fast `adapt` learns it as background and
`relative` then subtracts it away, and the filter sweep that is the loudest
thing in the patch becomes invisible. The split is to keep `relative` high for
bar contrast and make `adapt` slow — slower than the sweep, so the sweep reads
as a change rather than as the new normal. Sweeping the drone cutoff end to end
now moves the low columns across about 80% of their range.

`spectrum.tilt` lifts the quiet top octaves, `spectrum.blur` bleeds each band
into its neighbours, and `spectrum.floor` keeps every column carrying some
colour. Raise `blur` and `relative` for a broader, more reactive wash; drop
them for a spiky, literal analyser.

- **spectral balance → global hue slide** (`hueRange`). This is a real spectral
  centroid over the log bands, taken from the raw magnitudes rather than the
  drawn ones, and normalised against its own recent extremes so the narrow
  slice it actually wanders over is stretched across the whole hue range.
- **drone pitch → hue slide** (`toneHue`). Bend and key moves are read straight
  off the synth instead of being inferred from the FFT. A sweeping filter is
  hard to recover from a spectrum, and `filter.frequency.value` will not show
  it either — an `AudioParam` reports its own value, not the LFO summed into
  it — so the exact number is used where there is one.
- **beats → hue kick, brightness pop, extra glyph glitching**
  (`beatHue`, `beatThreshold`)
- every hue is finally folded into `CONFIG.hueWindow`. The slides stack, and
  without a wall they add up past `360` and wrap round into warm colours.
  Because the wall is absolute, the slides themselves can be pushed hard.
- the background rain follows the same bands: each column speeds up, brightens
  and shifts hue with the frequency sitting above it

Whenever the signal goes quiet — before the first click, or with
`CONFIG.audio.enabled = false` — slow LFOs drive a travelling hump across the
bands so the display keeps moving (`idleDrift`).

## Pointer reaction

The page stays non-interactive (`pointer-events: none`, no links, no hit
targets). Input is read from window-level listeners and only drives decoration:

- moving the cursor dissolves nearby art cells into katakana and speeds up and
  brightens the rain columns under it
- clicking or tapping fires an expanding shockwave that scrambles the cells and
  rain columns it passes through, then fades

While the cursor is **over the art** it also plays the drone (`pointer.drone`):

- left to right opens the drone filter, from `drone.cutoff[0]` to
  `drone.cutoff[1]` times its resting cutoff
- up and down bends the whole stack by up to `drone.bend` cents. The bend is a
  constant source summed into every oscillator's detune, so it rides on top of
  the per-voice spread instead of flattening it
- a click strikes a note: the column picks the degree off `scale`, the row picks
  the octave
- leaving the art glides everything back, `drone.release` times slower than it
  moved

Turn it off with `CONFIG.pointer.enabled = false`.

Add an effect by dropping another entry into `EFFECTS` with `init`, `duration`
and `frame`. Keep `frame` free of state that depends on previous frames, or
reverse playback will not work.
