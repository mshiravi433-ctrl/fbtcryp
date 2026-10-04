#!/usr/bin/env python3
"""Ken Burns film + continuous music bed + VO. 10 minutes."""
import os, subprocess, tempfile, struct, math, wave

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Intent-OS-Product-Film.mp4")
SR = 44100
DUR = 600

# Alternate host / cinematic so the narrator is present, motion on stills
SCENES = [
    ("scene-01.jpg", "vo-01.mp3", 45),
    ("host-01.jpg", None, 0),  # placeholder unused
    ("scene-02.jpg", "vo-02.mp3", 35),
    ("host-02.jpg", "vo-03.mp3", 40),
    ("scene-ui.jpg", "vo-04.mp3", 50),
    ("host-03.jpg", "vo-05.mp3", 55),
    ("scene-engine.jpg", "vo-06.mp3", 65),
    ("scene-nodes.jpg", "vo-07.mp3", 60),
    ("scene-confirm.jpg", "vo-08.mp3", 55),
    ("host-01.jpg", "vo-09.mp3", 50),
    ("scene-loop.jpg", "vo-10.mp3", 50),
    ("host-02.jpg", None, 30),
    ("scene-final.jpg", None, 40),
    ("host-03.jpg", None, 25),
]

# Clean list without dummy
SCENES = [
    ("scene-01.jpg", "vo-01.mp3", 45),
    ("host-01.jpg", "vo-02.mp3", 35),
    ("scene-02.jpg", "vo-03.mp3", 20),
    ("host-02.jpg", None, 20),
    ("scene-ui.jpg", "vo-04.mp3", 50),
    ("host-03.jpg", "vo-05.mp3", 55),
    ("scene-engine.jpg", "vo-06.mp3", 65),
    ("scene-nodes.jpg", "vo-07.mp3", 60),
    ("scene-confirm.jpg", "vo-08.mp3", 55),
    ("host-01.jpg", "vo-09.mp3", 50),
    ("scene-loop.jpg", "vo-10.mp3", 70),
    ("host-02.jpg", None, 30),
    ("scene-final.jpg", None, 45),
]


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit(r.stderr[-5000:].decode("utf-8", "replace"))


def write_music(path, seconds):
    n = int(seconds * SR)
    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = bytearray()
        for i in range(n):
            t = i / SR
            # evolving cinematic drone + slow pulse (original, not a copied score)
            env = 0.35 + 0.15 * math.sin(2 * math.pi * t / 18)
            if t > 350 and t < 410:
                env *= 0.35  # quieter around authorization
            if t > 540:
                env *= 0.5 + 0.5 * min(1, (t - 540) / 20)
                if t > 580:
                    env *= max(0.05, 1 - (t - 580) / 20)
            a = 0.18 * math.sin(2 * math.pi * 55 * t)
            b = 0.12 * math.sin(2 * math.pi * 82.4 * t + 0.2)
            c = 0.08 * math.sin(2 * math.pi * 110 * t * (1 + 0.002 * math.sin(t / 7)))
            pulse = 0.06 * math.sin(2 * math.pi * 1.8 * t) * math.sin(2 * math.pi * 220 * t)
            noise = 0.015 * math.sin(2 * math.pi * 0.07 * t) * math.sin(i * 0.013)
            s = (a + b + c + pulse + noise) * env
            s = max(-0.95, min(0.95, s))
            v = int(s * 22000)
            buf += struct.pack("<hh", v, int(v * 0.92))
            if i % 200000 == 0:
                w.writeframes(bytes(buf))
                buf.clear()
        if buf:
            w.writeframes(bytes(buf))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtfilm-")
    music = os.path.join(tmp, "music.wav")
    print("writing music bed")
    write_music(music, DUR + 2)

    parts = []
    t_cursor = 0
    for i, (img, vo, dur) in enumerate(SCENES):
        frames = int(dur * 24)
        v = os.path.join(tmp, f"v{i:02d}.mp4")
        img_p = os.path.join(IMG, img)
        zdir = "+" if i % 2 == 0 else "-"
        zexpr = "min(zoom+0.0005,1.14)" if i % 2 == 0 else "if(eq(on,1),1.12,max(zoom-0.0004,1.0))"
        zoom = (
            f"[0:v]scale=2560:1440:force_original_aspect_ratio=increase,"
            f"crop=2560:1440,zoompan=z='{zexpr}':d={frames}:"
            f"x='iw/2-(iw/zoom/2)+40*sin(on/40)':y='ih/2-(ih/zoom/2)':"
            f"s=1280x720:fps=24,format=yuv420p[v]"
        )
        cmd = [FF, "-y", "-loop", "1", "-i", img_p]
        if vo:
            cmd += ["-i", os.path.join(AUD, vo)]
            filt = zoom + ";[1:a]apad=whole_dur=" + str(dur) + "[a]"
            cmd += ["-filter_complex", filt, "-map", "[v]", "-map", "[a]", "-t", str(dur)]
        else:
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
            cmd += ["-filter_complex", zoom, "-map", "[v]", "-map", "1:a", "-t", str(dur)]
        cmd += [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
            "-c:a", "aac", "-b:a", "128k", "-pix_fmt", "yuv420p", v,
        ]
        print("encoding", i, img, dur)
        run(cmd)
        parts.append(v)
        t_cursor += dur

    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    raw = os.path.join(tmp, "raw.mp4")
    run([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", raw])

    mixed = os.path.join(tmp, "mixed.mp4")
    # music always on; duck under VO
    run([
        FF, "-y", "-i", raw, "-i", music,
        "-filter_complex",
        "[1:a]volume=0.28,afade=t=in:st=0:d=3,afade=t=out:st=585:d=14[m];"
        "[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[v];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.55[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-t", str(DUR),
        OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
