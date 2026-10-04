#!/usr/bin/env python3
"""Educational film: captions + continuous VO, video trimmed to speech."""
import os, subprocess, tempfile, struct, math, wave, re
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Intent-OS-Product-Film.mp4")
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR = 44100
W, H = 1920, 1080

# One card per VO clip so speech never waits on a long still
CARDS = [
    ("scene-01.jpg", "vo-01.mp3", "01  COMPLEXITY",
     "THE FINANCIAL WORLD NEVER STOPS.",
     "Every second, millions of financial events happen. Prices change. Liquidity moves. Markets react. Information without context is noise."),
    ("scene-02.jpg", "vo-02.mp3", "02  VISION",
     "FBT INTENT OS",
     "Instead of disconnected tools, it starts with you. Your goal. Your context. Your risk. Your intent."),
    ("scene-ui.jpg", "vo-03.mp3", "03  START WITH A GOAL",
     "WHAT WOULD YOU LIKE TO ACHIEVE?",
     "You don't need to know which tool to open first. Describe what you want to accomplish."),
    ("scene-ui.jpg", "vo-04.mp3", "04  UNDERSTANDING",
     "STRUCTURE BEHIND THE WORDS.",
     "Goal, time horizon, risk, context. When something important is missing, the system asks."),
    ("scene-engine.jpg", "vo-05.mp3", "05  CONTEXT",
     "INTENT WITHOUT CONTEXT IS INCOMPLETE.",
     "With permission: capital, portfolio, liquidity, risk, horizon. Same goal, different books, different plans."),
    ("scene-engine.jpg", "vo-06.mp3", "06  PLAN",
     "A STRUCTURED WORKFLOW. NOT A GUARANTEE.",
     "Understand position. Analyze environment. Evaluate strategies. Define the next step."),
    ("scene-nodes.jpg", "vo-07.mp3", "07  INTELLIGENCE",
     "MULTI-LAYER ANALYSIS",
     "Market, Signal, Smart Money, portfolio — one picture. Never claimed as certainty."),
    ("scene-confirm.jpg", "vo-08.mp3", "08  CONTROL",
     "USER APPROVAL REQUIRED",
     "Analyze, prepare, coordinate. Important actions stay under your authorization."),
    ("scene-01.jpg", "vo-09.mp3", "09–10  VERIFY & MONITOR",
     "PREPARING → CONFIRMED. THEN KEEP WATCHING.",
     "Execution is not the end. Markets move. Risk changes. Review when conditions change."),
    ("scene-final.jpg", "vo-10.mp3", "FBT SWAP  ·  INTENT OS",
     "UNDERSTAND. PLAN. VERIFY. ACT.",
     "Intent, context, analysis, strategy, action, authorization, execution, verification, monitoring. fbtswap.ir"),
]


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit((r.stderr or r.stdout)[-5000:].decode("utf-8", "replace"))
    return r


def duration(path):
    r = subprocess.run([FF, "-i", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    txt = (r.stderr or b"").decode("utf-8", "replace")
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", txt)
    if not m:
        raise SystemExit("no duration for " + path + "\n" + txt[-800:])
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mi * 60 + s


def fit_cover(im, w, h):
    im = im.convert("RGB")
    r = max(w / im.width, h / im.height)
    nw, nh = int(im.width * r), int(im.height * r)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x, y = (nw - w) // 2, (nh - h) // 2
    return im.crop((x, y, x + w, y + h))


def wrap(draw, text, font, max_w):
    words = text.split()
    lines, cur = [], ""
    for word in words:
        t = (cur + " " + word).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def card_image(src, kicker, title, body, path):
    base = fit_cover(Image.open(os.path.join(IMG, src)), W, H)
    base = ImageEnhance.Brightness(base).enhance(0.55)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rectangle((0, int(H * 0.42), W, H), fill=(5, 8, 20, 210))
    d.rectangle((0, H - 8, W, H), fill=(59, 130, 246, 255))
    fk = ImageFont.truetype(FONT, 28)
    ft = ImageFont.truetype(FONT_B, 52)
    fb = ImageFont.truetype(FONT, 32)
    fs = ImageFont.truetype(FONT, 22)
    d.text((80, 70), "FBT INTENT OS", font=fk, fill=(147, 197, 253, 255))
    d.text((80, 520), kicker, font=fk, fill=(96, 165, 250, 255))
    y = 570
    for line in wrap(d, title, ft, W - 160):
        d.text((80, y), line, font=ft, fill=(248, 250, 252, 255))
        y += 62
    y += 10
    for line in wrap(d, body, fb, W - 180):
        d.text((80, y), line, font=fb, fill=(203, 213, 225, 255))
        y += 44
    d.text((80, H - 56), "fbtswap.ir   ·   Understand. Plan. Verify. Act.", font=fs, fill=(148, 163, 184, 255))
    Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB").save(path, quality=90)


def write_music(path, seconds):
    n = int(seconds * SR)
    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        chunk = bytearray()
        for i in range(n):
            t = i / SR
            env = 0.38 + 0.1 * math.sin(2 * math.pi * t / 14)
            if t > seconds - 8:
                env *= max(0.05, (seconds - t) / 8)
            a = 0.2 * math.sin(2 * math.pi * 48.99 * t)
            b = 0.12 * math.sin(2 * math.pi * 73.42 * t)
            c = 0.08 * math.sin(2 * math.pi * 97.99 * t)
            s = max(-0.95, min(0.95, (a + b + c) * env))
            v = int(s * 18000)
            chunk += struct.pack("<hh", v, int(v * 0.9))
            if len(chunk) > 400000:
                w.writeframes(bytes(chunk))
                chunk.clear()
        if chunk:
            w.writeframes(bytes(chunk))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtedu-")
    durs = []
    for img, vo, kicker, title, body in CARDS:
        d = duration(os.path.join(AUD, vo))
        durs.append(d)
        print(vo, round(d, 2))
    total = sum(durs)

    # concat VO with no gaps
    lst_a = os.path.join(tmp, "audio.txt")
    with open(lst_a, "w") as f:
        for _, vo, *_ in CARDS:
            f.write(f"file '{os.path.join(AUD, vo)}'\n")
    speech = os.path.join(tmp, "speech.mp3")
    run([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst_a, "-c", "copy", speech])

    music = os.path.join(tmp, "music.wav")
    write_music(music, total + 1)

    parts = []
    for i, ((img, vo, kicker, title, body), dur) in enumerate(zip(CARDS, durs)):
        still = os.path.join(tmp, f"s{i:02d}.jpg")
        card_image(img, kicker, title, body, still)
        frames = max(24, int(round(dur * 24)))
        v = os.path.join(tmp, f"v{i:02d}.mp4")
        zexpr = "min(zoom+0.0008,1.12)" if i % 2 == 0 else "if(eq(on,1),1.10,max(zoom-0.0006,1.0))"
        zoom = (
            f"[0:v]scale=2304:1296:force_original_aspect_ratio=increase,crop=2304:1296,"
            f"zoompan=z='{zexpr}':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"s=1920x1080:fps=24,format=yuv420p[v]"
        )
        run([
            FF, "-y", "-loop", "1", "-i", still,
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-filter_complex", zoom,
            "-map", "[v]", "-map", "1:a",
            "-t", f"{dur:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "64k", "-pix_fmt", "yuv420p", v,
        ])
        print("video", i, round(dur, 2))
        parts.append(v)

    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    raw = os.path.join(tmp, "raw.mp4")
    run([FF, "-y", "-f", "concat", "-safe", "-0", "-i", lst, "-c", "copy", raw] if False else
        [FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", raw])

    run([
        FF, "-y", "-i", raw, "-i", speech, "-i", music,
        "-filter_complex",
        "[2:a]volume=0.22,afade=t=in:st=0:d=1.5,afade=t=out:st=" + f"{max(1, total-6):.2f}" + ":d=5[m];"
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.15[v];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.45[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT), "seconds", round(total, 2))


if __name__ == "__main__":
    main()
