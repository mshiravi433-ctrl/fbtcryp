# FBT SWAP — INTENT OS · Cinematic Product Film

A ten-minute product documentary about **FBT Intent OS**, rendered frame by
frame in a real headless browser and encoded to 4K UHD.

**Deliverable:** `fbt-intent-os-4k.mp4` · 3840×2160 · 24 fps · stereo · 10:00

---

## 1. What this is

The film is **software**, not an NLE project. Every frame is drawn by code and
is reproducible: the same source renders the same film, on any machine, with
no timeline file, no plugin set and no stock footage.

That has three consequences worth stating plainly:

* **It is reviewable as text.** A camera move is an `ease`, a colour is a
  token, a scene is a file. Diffs work. Comments work.
* **It is re-renderable selectively.** `--stills 140` renders one frame at any
  resolution — 1080p for review, 4K for the master.
* **Nothing is faked for the camera.** The interface in the film is built from
  the same vocabulary the product uses (`INTENT OS`, `CLARIFICATION REQUIRED`,
  `PROPOSED PLAN`, `USER APPROVAL REQUIRED`), and the two places where the film
  must show data it cannot have — the portfolio and the transaction hash — are
  labelled as such on screen.

## 2. Layout

```
film/intent-os/
├── src/
│   ├── index.html          the stage: 1920×1080 CSS px, captured at DPR 2 → 4K
│   ├── film.css            the visual language (tokens, type, panels, devices)
│   ├── film.js             the director: `seek(t)` renders the exact frame for second t
│   ├── lib/
│   │   ├── fx.js           camera + projection, sprite glow, DoF, grain, the room
│   │   ├── kit.js          shared sets: data field, market ring, node graph,
│   │   │                   blockchain lattice, engine vortex, world grid
│   │   └── ui.js           the product surface: nav, panels, wallet sheet,
│   │                       action card, execution rail — real DOM at stage scale
│   └── scenes/             s01…s13, one file per scene, in the brief's order
├── tools/
│   ├── render.mjs          Chromium → PNG frames → ffmpeg segments
│   ├── score.mjs           the score, synthesised (no samples, no loops)
│   ├── sfx.mjs             the sound design, synthesised (253 cues)
│   ├── narration.json      the narration script + the second each line begins
│   └── build_audio.mjs     narration + score + effects → master, with ducking
├── assets/fonts/           Inter + JetBrains Mono (SIL Open Font License)
└── docs/                   the production report (fa)
```

## 3. Rendering

The renderer needs Chromium and ffmpeg. In this repository's sandbox both come
from npm (`puppeteer-core` + `@sparticuz/chromium` + `@ffmpeg-installer/ffmpeg`)
because there is no package manager access; a normal workstation can use any
Chromium build and any ffmpeg.

```bash
cd film/intent-os
npm i                     # puppeteer-core, @sparticuz/chromium, @ffmpeg-installer/ffmpeg

# review frames at half resolution — fast, no encoding
node tools/render.mjs --stills 3,140,436,558 --scale 0.5

# one scene, to check a change
node tools/render.mjs --from 0 --to 45 --segment 45 --scale 1

# the film: 30-second segments, 4K, visually lossless intermediates
node tools/render.mjs --all --segment 30 --scale 1 --crf 12

node tools/assemble.mjs   # concatenate segments + mux the master audio
```

Measured on the two-core sandbox used to make this film: **≈0.5 s per 4K
frame** (scene-dependent; the blockchain act costs about 1.4 s/frame and the
interface acts about 0.3 s). A full pass is ~2 hours single-threaded and about
35 minutes across six parallel workers, which is why segments are written
separately and skipped when they already exist.

### The two performance decisions the film depends on

Software rasterisation, not a GPU, is what renders this film, so two things
matter more than they would in a browser tab:

1. **Frames are captured over CDP, not through Puppeteer's screenshot API.**
   The same frame costs ~620 ms over CDP and ~3 500 ms through
   `page.screenshot()`; the API's extra surface readback quadruples the cost.
2. **The finishing layers are composited on the canvas, not on the DOM.**
   Full-screen blended DOM layers (grain, bloom, vignette) each cost a 4K
   composite per frame. `room()` in `fx.js` paints the graded background,
   key light and vignette into the canvas that already sits behind the scene,
   which both fixed a real visual bug — an opaque DOM background was erasing
   every particle behind the interface — and roughly tripled the frame rate.

## 4. Audio

Three synthesised elements, one master:

```bash
node tools/score.mjs --out work/audio/music.wav   # the score
node tools/sfx.mjs   --out work/audio/sfx.wav     # the sound design
node tools/build_audio.mjs                        # narration + both → master.wav
```

`build_audio.mjs` reads `tools/narration.json`, places one generated narration
clip per scene at its scripted second, side-chain ducks the score and the
effects under the voice, and writes `src/narration-timing.js` so on-screen
words can be paced to what the narrator actually says rather than to a guess.
Nothing is sampled: every note and every click is written in code, so the film
carries no third-party music licence.

## 5. The rules the film keeps

The brief for this film contained a set of prohibitions, and they are treated
as testable constraints rather than tone notes:

| Rule | How it is kept in the build |
|---|---|
| Do not promise profits or guaranteed predictions | On-screen copy states `PROPOSED PLAN ≠ GUARANTEED RESULT`; the narrator says "the goal is not to predict the future with certainty" |
| Do not imply autonomous access to funds | The wallet sheet shows `Signing rights: None`; the authorization gate pauses the film; the narrator says "important actions remain subject to user authorization" |
| Do not show the AI inventing information | Missing context produces `CLARIFICATION REQUIRED` and a question — never a filled-in value |
| Do not present a fabricated hash as real | The execution panel prints an example hash **and** the sentence that says so, in frame |
| No distorted or invented text | All on-screen type is real, hinted DOM text at stage scale; no text is drawn as an image |
| No generic stock footage | There is no footage. Every frame is generated |
| No excessive neon | Palette is black, deep navy, one electric blue, one violet accent, one mint confirmation |

## 6. Scripts, scenes and time

| Scene | Time | Beat |
|---|---|---|
| 01 | 00:00–00:45 | A point of light becomes the whole financial world |
| 02 | 00:45–01:20 | The line that draws FBT Swap, then Intent OS |
| 03 | 01:20–02:00 | Opening `fbtswap.ir`, asking the user's goal |
| 04 | 02:00–02:50 | The sentence becomes structure; a missing fact is asked for |
| 05 | 02:50–03:45 | Context: authorization, read-only portfolio, two portfolios compared |
| 06 | 03:45–04:50 | Inputs fall into the engine; a workflow comes out |
| 07 | 04:50–05:50 | Ten capabilities, six analytical layers |
| 08 | 05:50–06:45 | Everything stops. The wallet — not the AI — signs |
| 09 | 06:45–07:35 | Execution, then verification as the point |
| 10 | 07:35–08:20 | Time-lapse, a condition change, the workflow resumes |
| 11 | 08:20–09:10 | The nine-word loop, closing into a circle |
| 12 | 09:10–09:40 | The interface inside a connected world |
| 13 | 09:40–10:00 | The mark, the promise, the address |

## 7. Rights

The film, the score and the sound design are original to this repository.
Typefaces are Inter and JetBrains Mono, both under the SIL Open Font License
(`assets/fonts/OFL-*.txt`). `fbtswap.ir` is the address shown throughout.
