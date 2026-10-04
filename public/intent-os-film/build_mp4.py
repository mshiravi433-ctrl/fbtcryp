#!/usr/bin/env python3
"""Assemble Ken Burns + VO into a single MP4."""
import os, subprocess, tempfile

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Intent-OS-Product-Film.mp4")

# Scripted scene lengths (seconds) totaling 600s
SCENES = [
    ("scene-01.jpg", "vo-01.mp3", 45, "THE FINANCIAL WORLD NEVER STOPS."),
    ("scene-02.jpg", "vo-02.mp3", 35, "FBT SWAP  ·  INTENT OS"),
    ("scene-ui.jpg", "vo-03.mp3", 40, "WHAT WOULD YOU LIKE TO ACHIEVE?"),
    ("scene-ui.jpg", "vo-04.mp3", 50, "INTENT STRUCTURED"),
    ("scene-engine.jpg", "vo-05.mp3", 55, "INTENT WITHOUT CONTEXT IS INCOMPLETE"),
    ("scene-engine.jpg", "vo-06.mp3", 65, "PROPOSED PLAN"),
    ("scene-loop.jpg", "vo-07.mp3", 60, "MULTI-LAYER ANALYSIS"),
    ("scene-ui.jpg", "vo-08.mp3", 55, "USER APPROVAL REQUIRED"),
    ("scene-01.jpg", "vo-09.mp3", 50, "VERIFICATION MATTERS"),
    ("scene-loop.jpg", "vo-10.mp3", 50, "THE INTENT OS LOOP"),
    ("scene-loop.jpg", None, 30, "ONE INTENT. ONE WORKFLOW."),
    ("scene-final.jpg", None, 40, "UNDERSTAND. PLAN. VERIFY. ACT."),
    ("scene-final.jpg", None, 25, "fbtswap.ir"),
]


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit(r.stderr[-4000:].decode("utf-8", "replace"))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtfilm-")
    parts = []
    leftover_vo10 = None
    for i, (img, vo, dur, title) in enumerate(SCENES):
        frames = int(dur * 24)
        v = os.path.join(tmp, f"v{i:02d}.mp4")
        img_p = os.path.join(IMG, img)
        zoom = (
            f"[0:v]scale=2400:1350:force_original_aspect_ratio=increase,"
            f"crop=2400:1350,zoompan=z='min(zoom+0.00035,1.10)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=24,"
            f"format=yuv420p[v]"
        )
        cmd = [FF, "-y", "-loop", "1", "-i", img_p]
        maps = ["-map", "[v]"]
        if vo:
            cmd += ["-i", os.path.join(AUD, vo)]
            filt = zoom + ";[1:a]apad=pad_dur=600[a]"
            maps += ["-map", "[a]"]
            extra = ["-t", str(dur), "-c:a", "aac", "-b:a", "128k", "-shortest"]
        elif i == 10:
            # remainder of vo-10 if we already consumed ~50s in previous — skip, pad silence
            filt = zoom + ";anullsrc=r=44100:cl=stereo,atrim=0:" + str(dur) + ",aformat=sample_fmts=fltp[a]"
            # anullsrc as extra input
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
            filt = zoom
            maps = ["-map", "[v]", "-map", "1:a"]
            extra = ["-t", str(dur), "-c:a", "aac", "-b:a", "96k"]
        else:
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
            filt = zoom
            maps = ["-map", "[v]", "-map", "1:a"]
            extra = ["-t", str(dur), "-c:a", "aac", "-b:a", "96k"]
        cmd += [
            "-filter_complex", filt,
            *maps,
            *extra,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
            "-pix_fmt", "yuv420p",
            v,
        ]
        print("encoding", i, title, dur, "s")
        run(cmd)
        parts.append(v)

    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    run([
        FF, "-y", "-f", "concat", "-safe", "0", "-i", lst,
        "-c", "copy", OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
