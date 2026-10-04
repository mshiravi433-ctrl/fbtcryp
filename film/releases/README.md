# FBT INTENT OS — the film

The finished film lives in this folder so it can be downloaded straight from
the repository.

| File | What it is |
|---|---|
| `fbt-intent-os-1080p.mp4` | The film · 1920×1080 · 24 fps · stereo AAC 128 kbps · 10:00 |
| `fbt-intent-os.en.srt` | English subtitles · 65 cues, timed to the measured narration |
| `fbt-intent-os-poster.jpg` | Key art / thumbnail |

**Why here and not a release asset.** GitHub release assets are uploaded to
`uploads.github.com`, which the build environment cannot reach (TLS is reset
before the handshake), so the file is committed instead. The tree copy is the
same picture as the graded master — the video stream is copied bit-for-bit, and
the audio was encoded once from the 48 kHz master rather than copied from a
previous encode. Re-encoding the audio to 128 kbps is what brings the file under
GitHub's 100 MB per-file limit.

The 4K UHD master (3840×2160) is deliberately **not** in this repository: at
roughly a gigabyte it is four times the per-file limit and would be permanent
history. It is rendered from the same sources, by the same tools, with
`--scale 2`.

## Making it again

```bash
cd film/intent-os
npm i
node tools/render-all.mjs --workers 2 --segment 60 --scale 2 --crf 13   # 4K frames
node tools/grade.mjs --in <assembled>.mp4 --out out/master-1080p.mp4 \
     --height 1080 --crf 21 --grain 2 --duration 600                   # finishing
node tools/assemble.mjs                                                # + audio
node tools/subtitles.mjs                                               # → .srt
```

Full write-up: [`../intent-os/README.md`](../intent-os/README.md) ·
Persian production report: [`../intent-os/docs/PRODUCTION-FA.md`](../intent-os/docs/PRODUCTION-FA.md)
