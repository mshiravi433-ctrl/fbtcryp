#!/usr/bin/env python3
"""Educational film: cinematic stills with on-screen spoken text. No host."""
import os, subprocess, tempfile, struct, math, wave, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Intent-OS-Product-Film.mp4")
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR = 44100
W, H = 1920, 1080

# Educational cards: image, vo file or None, seconds, kicker, title, body
CARDS = [
    ("scene-01.jpg", "vo-01.mp3", 12, "01  COMPLEXITY", "THE FINANCIAL WORLD NEVER STOPS.",
     "Every second, millions of financial events happen around the world."),
    ("scene-01.jpg", None, 12, "01  COMPLEXITY", "PRICES. LIQUIDITY. MARKETS.",
     "Prices change. Liquidity moves. Markets react. Wallets transact. Opportunities appear — and disappear."),
    ("scene-01.jpg", None, 21, "01  COMPLEXITY", "INFORMATION WITHOUT CONTEXT IS NOISE.",
     "The challenge isn't finding more information. It's understanding what to do with it."),
    ("scene-02.jpg", "vo-02.mp3", 18, "02  VISION", "FBT INTENT OS",
     "Instead of navigating disconnected financial tools, it starts with something simpler: you."),
    ("scene-02.jpg", None, 17, "02  VISION", "YOUR GOAL. YOUR CONTEXT. YOUR RISK.",
     "AI-powered financial operating system  ·  fbtswap.ir"),
    ("scene-ui.jpg", "vo-03.mp3", 20, "03  START WITH A GOAL", "WHAT WOULD YOU LIKE TO ACHIEVE?",
     "Grow portfolio  ·  Protect capital  ·  Explore  ·  Generate yield  ·  Analyze  ·  Rebalance  ·  Create a strategy"),
    ("scene-ui.jpg", None, 20, "03  START WITH A GOAL", "DESCRIBE WHAT YOU WANT TO ACCOMPLISH.",
     "You don't need to know which tool to open first. Example: grow my portfolio over three years while managing risk."),
    ("scene-ui.jpg", "vo-04.mp3", 25, "04  UNDERSTANDING INTENT", "IT READS STRUCTURE, NOT JUST WORDS.",
     "Goal: portfolio growth  ·  Horizon: 3 years  ·  Risk: controlled  ·  Context: portfolio"),
    ("scene-ui.jpg", None, 25, "04  CLARIFICATION REQUIRED", "WHEN SOMETHING IS MISSING, THE SYSTEM ASKS.",
     "What are you trying to achieve? How long do you have? What constraints matter? What level of risk are you comfortable with?"),
    ("scene-engine.jpg", "vo-05.mp3", 28, "05  CONTEXT", "CONNECT WALLET  ·  USER AUTHORIZATION REQUIRED",
     "Available capital, current portfolio, liquidity needs, risk preference, time horizon — only with permission."),
    ("scene-nodes.jpg", None, 27, "05  CONTEXT", "INTENT WITHOUT CONTEXT IS INCOMPLETE.",
     "The same goal can require very different strategies depending on ETH, USDC, BTC, RWA and the rest of the book."),
    ("scene-engine.jpg", "vo-06.mp3", 32, "06  FROM INTENT TO PLAN", "INTENT OS ENGINE",
     "Goal + risk + time + portfolio + market data → a structured workflow. Not a guaranteed result."),
    ("scene-engine.jpg", None, 33, "06  PROPOSED PLAN", "STRUCTURED. TRANSPARENT. INFORMED.",
     "1 Analyze portfolio  2 Identify concentration  3 Review markets  4 Evaluate opportunities  5 Define allocation  6 Monitor risk"),
    ("scene-nodes.jpg", "vo-07.mp3", 30, "07  FBT INTELLIGENCE", "MULTI-LAYER ANALYSIS",
     "Market  ·  Signal  ·  Smart Money  ·  Wallet  ·  Swap  ·  Lending  ·  RWA  ·  Earn  ·  Futures  ·  Explore"),
    ("scene-nodes.jpg", None, 30, "07  COORDINATION", "ONE BROADER PICTURE — NEVER CERTAINTY.",
     "Market is one view. Signal adds technical context. Smart Money adds on-chain data. Portfolio adds you."),
    ("scene-confirm.jpg", "vo-08.mp3", 28, "08  YOU STAY IN CONTROL", "REVIEW ACTION",
     "Example: Swap 100 USDC → ETH on Ethereum. Network fee, protocol fee, slippage, destination — then CONFIRM."),
    ("scene-confirm.jpg", None, 27, "08  USER APPROVAL REQUIRED", "INTELLIGENCE DOES NOT MEAN LOSING CONTROL.",
     "Intent OS can analyze, prepare, and coordinate. Important actions stay subject to your authorization."),
    ("scene-01.jpg", "vo-09.mp3", 25, "09  EXECUTION", "PREPARING  →  SUBMITTED  →  CONFIRMING  →  CONFIRMED",
     "Once authorized, the action can move into execution. Verification matters."),
    ("scene-loop.jpg", None, 25, "10  MONITORING", "A WORKFLOW DOES NOT END AT CONFIRMATION.",
     "Markets keep moving. Risk changes. When conditions change: MARKET CONDITION CHANGED  ·  REVIEW RECOMMENDED."),
    ("scene-loop.jpg", "vo-10.mp3", 35, "11  THE INTENT OS LOOP", "INTENT → CONTEXT → ANALYSIS → STRATEGY",
     "Then action → authorization → execution → verification → monitoring. When the environment changes, the loop can begin again."),
    ("scene-loop.jpg", None, 25, "12  THE FUTURE", "NOT MORE SCREENS. CLEARER SYSTEMS.",
     "One intent. One intelligent workflow. One connected environment."),
    ("scene-final.jpg", None, 28, "FBT SWAP  ·  INTENT OS", "UNDERSTAND. PLAN. VERIFY. ACT.",
     "Understand your intent. Structure your plan. Verify every important action. Stay in control.  fbtswap.ir"),
]


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit(r.stderr[-5000:].decode("utf-8", "replace"))


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
    base = ImageEnhance.Contrast(base).enhance(1.08)
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
    y += 12
    for line in wrap(d, body, fb, W - 180):
        d.text((80, y), line, font=fb, fill=(203, 213, 225, 255))
        y += 44
    d.text((80, H - 56), "fbtswap.ir   ·   Understand. Plan. Verify. Act.", font=fs, fill=(148, 163, 184, 255))
    out = Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
    out.save(path, quality=90)


def write_music(path, seconds):
    n = int(seconds * SR)
    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        chunk = bytearray()
        for i in range(n):
            t = i / SR
            env = 0.42 + 0.12 * math.sin(2 * math.pi * t / 16)
            if 340 < t < 410:
                env *= 0.4
            if t > 575:
                env *= max(0.08, 1 - (t - 575) / 24)
            a = 0.22 * math.sin(2 * math.pi * 48.99 * t)
            b = 0.14 * math.sin(2 * math.pi * 73.42 * t)
            c = 0.09 * math.sin(2 * math.pi * 97.99 * t)
            d = 0.05 * math.sin(2 * math.pi * 196 * t) * (0.5 + 0.5 * math.sin(2 * math.pi * t / 11))
            s = max(-0.95, min(0.95, (a + b + c + d) * env))
            v = int(s * 20000)
            chunk += struct.pack("<hh", v, int(v * 0.9))
            if len(chunk) > 400000:
                w.writeframes(bytes(chunk))
                chunk.clear()
        if chunk:
            w.writeframes(bytes(chunk))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtedu-")
    music = os.path.join(tmp, "music.wav")
    print("music")
    total = sum(c[2] for c in CARDS)
    write_music(music, total + 2)
    parts = []
    vo_used = set()
    for i, (img, vo, dur, kicker, title, body) in enumerate(CARDS):
        still = os.path.join(tmp, f"s{i:02d}.jpg")
        card_image(img, kicker, title, body, still)
        frames = int(dur * 24)
        v = os.path.join(tmp, f"v{i:02d}.mp4")
        zexpr = "min(zoom+0.00045,1.12)" if i % 2 == 0 else "if(eq(on,1),1.10,max(zoom-0.00035,1.0))"
        zoom = (
            f"[0:v]scale=2304:1296:force_original_aspect_ratio=increase,crop=2304:1296,"
            f"zoompan=z='{zexpr}':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"s=1920x1080:fps=24,format=yuv420p[v]"
        )
        cmd = [FF, "-y", "-loop", "1", "-i", still]
        use_vo = vo and vo not in vo_used
        if use_vo:
            vo_used.add(vo)
            cmd += ["-i", os.path.join(AUD, vo)]
            filt = zoom + f";[1:a]apad=whole_dur={dur}[a]"
            cmd += ["-filter_complex", filt, "-map", "[v]", "-map", "[a]", "-t", str(dur)]
        else:
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
            cmd += ["-filter_complex", zoom, "-map", "[v]", "-map", "1:a", "-t", str(dur)]
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k", "-pix_fmt", "yuv420p", v]
        print("encode", i, title[:40], dur)
        run(cmd)
        parts.append(v)
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    raw = os.path.join(tmp, "raw.mp4")
    run([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", raw])
    run([
        FF, "-y", "-i", raw, "-i", music,
        "-filter_complex",
        "[1:a]volume=0.32,afade=t=in:st=0:d=2,afade=t=out:st=" + str(max(1, total - 12)) + ":d=10[m];"
        "[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[v];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.7[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT), "seconds", total)


if __name__ == "__main__":
    main()
