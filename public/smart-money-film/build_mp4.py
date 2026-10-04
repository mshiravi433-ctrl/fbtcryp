#!/usr/bin/env python3
"""Smart Money educational film: logo first, then captions synced to continuous VO."""
import os, subprocess, tempfile, struct, math, wave, re
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Smart-Money-Product-Film.mp4")
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR = 44100
W, H = 1920, 1080

CARDS = [
    ("logo.jpg", "vo-00.mp3", "FBT SWAP",
     "SMART MONEY",
     "fbtswap.ir"),
    ("chain.jpg", "vo-01.mp3", "ON-CHAIN CAPITAL",
     "SIZE MOVES QUIETLY.",
     "Large wallets transfer. Liquidity is added or removed. Exchanges receive deposits. The question is whether you can see where size is actually moving."),
    ("ui.jpg", "vo-02.mp3", "INTELLIGENCE, NOT PREDICTION",
     "TURN ACTIVITY INTO EVIDENCE.",
     "Whale movements. Large transactions. Holder changes. Wallet behavior where data exists. Smart Money does not predict prices."),
    ("ui.jpg", "vo-03.mp3", "OPEN SMART MONEY",
     "SEARCH. CHOOSE A WINDOW. INSPECT.",
     "Wallet, token, contract, or transaction. One hour to one month. The work begins with evidence, not a slogan. fbtswap.ir"),
    ("chain.jpg", "vo-04.mp3", "WHALES ARE CONTEXT",
     "A BIG TRANSFER IS NOT AUTOMATICALLY SMART MONEY.",
     "FBT separates whale transfers from qualified wallet evidence."),
    ("flows.jpg", "vo-05.mp3", "MONEY FLOW",
     "ACCUMULATION. DISTRIBUTION. NET FLOW.",
     "Exchange inflow and outflow. Liquidity added or removed. Buying and selling in the selected window. Inspectable numbers, not a promise."),
    ("ui.jpg", "vo-06.mp3", "TOKEN INTELLIGENCE",
     "HOLDERS. CONCENTRATION. RISK BANDS.",
     "If evidence is thin, the system says so. Coverage is shown when only part of the picture is observed."),
    ("wallet.jpg", "vo-07.mp3", "TRACK WITH PERMISSION",
     "ALERTS FOLLOW ACTIVITY. NOT YOUR FUNDS.",
     "Large buys and sells, exchange deposits, liquidity, accumulation, distribution. Tracking does not take control of funds."),
    ("wallet.jpg", "vo-08.mp3", "WALLET P&L IS HISTORY",
     "PAST RESULTS ARE NOT A FORECAST.",
     "Win rate, realized and unrealized P&L are presented as history, not a guarantee."),
    ("final.jpg", "vo-09.mp3", "FBT SWAP  ·  SMART MONEY",
     "SEE WHERE SIZE IS MOVING.",
     "Inspect the evidence. Stay in control.  fbtswap.ir"),
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


def card_image(src, kicker, title, body, path, logo=False):
    base = fit_cover(Image.open(os.path.join(IMG, src)), W, H)
    if logo:
        # Keep logo plate clean: darken slightly, centered titles already in art;
        # still burn website large at bottom for the request.
        base = ImageEnhance.Brightness(base).enhance(0.75)
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)
        ft = ImageFont.truetype(FONT_B, 72)
        fb = ImageFont.truetype(FONT_B, 48)
        fs = ImageFont.truetype(FONT, 36)
        d.rectangle((0, 0, W, H), fill=(0, 0, 0, 90))
        tw = d.textlength("FBT SWAP", font=ft)
        d.text(((W - tw) / 2, 390), "FBT SWAP", font=ft, fill=(248, 250, 252, 255))
        tw = d.textlength("SMART MONEY", font=fb)
        d.text(((W - tw) / 2, 490), "SMART MONEY", font=fb, fill=(96, 165, 250, 255))
        tw = d.textlength("fbtswap.ir", font=fs)
        d.text(((W - tw) / 2, 580), "fbtswap.ir", font=fs, fill=(226, 232, 240, 255))
        Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB").save(path, quality=92)
        return
    base = ImageEnhance.Brightness(base).enhance(0.55)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rectangle((0, int(H * 0.42), W, H), fill=(5, 8, 20, 210))
    d.rectangle((0, H - 8, W, H), fill=(59, 130, 246, 255))
    fk = ImageFont.truetype(FONT, 28)
    ft = ImageFont.truetype(FONT_B, 48)
    fb = ImageFont.truetype(FONT, 30)
    fs = ImageFont.truetype(FONT, 22)
    d.text((80, 70), "FBT SMART MONEY", font=fk, fill=(147, 197, 253, 255))
    d.text((80, 520), kicker, font=fk, fill=(96, 165, 250, 255))
    y = 570
    for line in wrap(d, title, ft, W - 160):
        d.text((80, y), line, font=ft, fill=(248, 250, 252, 255))
        y += 58
    y += 8
    for line in wrap(d, body, fb, W - 180):
        d.text((80, y), line, font=fb, fill=(203, 213, 225, 255))
        y += 42
    d.text((80, H - 56), "fbtswap.ir   ·   See where size is moving.", font=fs, fill=(148, 163, 184, 255))
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
            if t > seconds - 6:
                env *= max(0.05, (seconds - t) / 6)
            a = 0.2 * math.sin(2 * math.pi * 55 * t)
            b = 0.12 * math.sin(2 * math.pi * 82.4 * t)
            c = 0.08 * math.sin(2 * math.pi * 110 * t)
            s = max(-0.95, min(0.95, (a + b + c) * env))
            v = int(s * 18000)
            chunk += struct.pack("<hh", v, int(v * 0.9))
            if len(chunk) > 400000:
                w.writeframes(bytes(chunk))
                chunk.clear()
        if chunk:
            w.writeframes(bytes(chunk))


def main():
    if not os.path.exists(FF):
        raise SystemExit("ffmpeg missing")
    tmp = tempfile.mkdtemp(prefix="fbtsm-")
    durs = []
    for img, vo, kicker, title, body in CARDS:
        d = duration(os.path.join(AUD, vo))
        durs.append(d)
        print(vo, round(d, 2))
    total = sum(durs)
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
        card_image(img, kicker, title, body, still, logo=(i == 0))
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
    run([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", raw])
    run([
        FF, "-y", "-i", raw, "-i", speech, "-i", music,
        "-filter_complex",
        "[2:a]volume=0.22,afade=t=in:st=0:d=1.2,afade=t=out:st=" + f"{max(1, total-5):.2f}" + ":d=4[m];"
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
