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
OS, Ubuntu) and gives it a certificate, because the audio capture the spectrum
analyser runs on is only available on a **secure origin**: `https://`,
`localhost` or `127.0.0.1`. Reached as `http://pi.local/`, the page still runs
but the analyser is dead and idle drift takes over.

```sh
sudo ./deploy.sh              # nginx + self-signed cert, http redirects to https
sudo ./deploy.sh --kiosk      # also autostart Chromium fullscreen on this machine
sudo ./deploy.sh --no-tls     # plain http, no audio off localhost
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

## Putting it on the internet

There is no server code here, so the only thing worth protecting is the machine
underneath. Two ways, in order of preference:

**GitHub Pages.** Three static files need no Pi at all. `.github/workflows/pages.yml`
publishes them on every push: no open ports, no patching, a real certificate.
The Pi keeps serving itself over loopback. The workflow forces
`CONFIG.audio.source` to `"off"` for the public copy — a stranger's browser
asking to share their screen looks like an attack, and idle drift covers for it.
Set `PUBLIC_AUDIO_SOURCE: auto` in the workflow to keep the analyser.

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
| `fontSize`   | base font size before auto-scaling                                          || `maxFps`     | frame cap for weak hosts; `0` is uncapped                                  || `matrix`     | background katakana rain: `enabled`, `fontSize`, `hue`, `speed`, `trail`    |
| `glitch`     | katakana twitching on the held art: `rate`, `count`, `durationMs`           |
| `pointer`    | local reaction: `enabled`, `radius`, `hoverRate`, `ripple`, `rainBoost`     |
| `audio`      | system-audio analyser: `source`, `gain`, `spectrum`, `beatHue`, `idleDrift` |

Every effect re-rolls its speeds, delays, sweep direction and origin on each
run, so no two cycles look the same.

The cycle is `in -> hold -> out -> in ...`. Every effect is a pure function of
time, so the exit is just the effect played in reverse, and both ends of the
loop meet on an empty canvas — no visible seam.

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
  mapped over. The browser default tops out at `-30 dB`, which any normal track
  blows past in every band, so the ceiling is pushed up to `-8`.
- `spectrum.relative` subtracts part of each band's own running average
  (`spectrum.adapt` sets how fast that average follows). `0` draws the raw
  spectrum, `1` draws only what changed; halfway keeps both the standing shape
  and the transients.
- the frame is then stretched between the quietest and loudest column, so the
  art always uses the full palette. `spectrum.span` is the smallest spread that
  gets stretched, which stops silence from being amplified into noise.

`spectrum.tilt` lifts the quiet top octaves, `spectrum.blur` bleeds each band
into its neighbours, and `spectrum.floor` keeps every column carrying some
colour. Raise `blur` and `relative` for a broader, more reactive wash; drop
them for a spiky, literal analyser.

- **spectral balance → global hue slide** (`hueRange`)
- **beats → hue kick, brightness pop, extra glyph glitching**
  (`beatHue`, `beatThreshold`)
- the background rain follows the same bands: each column speeds up, brightens
  and shifts hue with the frequency sitting above it

### Where the audio comes from

The room microphone is never used. Sources, in order of preference:

1. **A loopback capture device** — Stereo Mix, VB-Cable, Voicemeeter, a
   PulseAudio "Monitor of…", BlackHole, Soundflower. Matched by
   `loopbackPattern`; anything that does not look like a loopback is rejected.
2. **The browser's system/tab audio share** — offered on the first click, since
   `getDisplayMedia` needs a gesture. Tick "Share audio" in the picker. The
   video track it forces on us is throttled to 1 fps and never rendered.

If neither is available, or the signal goes silent, slow LFOs drive a travelling
hump across the bands so the display keeps moving (`idleDrift`). Stopping the
share falls back automatically. Force a mode with
`CONFIG.audio.source = "system" | "loopback" | "off"`.

Both sources need a secure origin. On anything else `navigator.mediaDevices`
does not exist at all, so the audio paths are skipped and the corner note says
so instead of asking for a share that can never be granted.

## Pointer reaction

The page stays non-interactive (`pointer-events: none`, no links, no hit
targets). Input is read from window-level listeners and only drives decoration:

- moving the cursor dissolves nearby art cells into katakana and speeds up and
  brightens the rain columns under it
- clicking or tapping fires an expanding shockwave that scrambles the cells and
  rain columns it passes through, then fades

Turn it off with `CONFIG.pointer.enabled = false`.

Add an effect by dropping another entry into `EFFECTS` with `init`, `duration`
and `frame`. Keep `frame` free of state that depends on previous frames, or
reverse playback will not work.
