#!/usr/bin/env python3
"""Loans + Insurance educational film. Opens on the real FBT app logo."""
import os, subprocess, tempfile, struct, math, wave, re
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Loans-Insurance-Product-Film.mp4")
APP_LOGO = os.path.join(os.path.dirname(ROOT), "icon-512.png")
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR, W, H = 44100, 1920, 1080

CARDS = [
    ("logo", "vo-00.mp3", "", "FBT SWAP", "LOANS  ·  INSURANCE    fbtswap.ir"),
    ("loans-ui.jpg", "vo-01.mp3", "LOANS",
     "LENDING AND BORROWING. NON-CUSTODIAL.",
     "Supply to earn yield, or lock collateral and borrow. Keys stay with you. FBT holds nothing."),
    ("loans-ui.jpg", "vo-02.mp3", "OPEN LOANS",
     "SUPPLY. BORROW. POSITIONS.",
     "Rates are read live from the protocol — Aave, Morpho, or Kamino where the market is wired."),
    ("health.jpg", "vo-03.mp3", "COLLATERAL",
     "HEALTH MUST STAY ABOVE ONE.",
     "LTV and max borrowable update as you type. Below one means liquidation. Risk is shown before you sign."),
    ("sign.jpg", "vo-04.mp3", "YOUR SIGNATURE",
     "FBT NEVER SIGNS FOR YOU.",
     "If collateral falls below the threshold, the contract can liquidate. Irreversible. FBT cannot stop it."),
    ("insurance.jpg", "vo-05.mp3", "PROTECTION",
     "OPEN INSURANCE. SEE WHAT IS COVERED.",
     "Connect so existing covers are read. The dashboard shows coverage, expiry, and uncovered assets."),
    ("insurance.jpg", "vo-06.mp3", "MARKETPLACE",
     "COMPARE. QUOTE. SIGN.",
     "Smart contract, depeg, exchange. Premium is shown before you sign. Cover starts when the transaction confirms."),
    ("sign.jpg", "vo-07.mp3", "NOT A GUARANTOR",
     "FBT IS AN INTERFACE. NOT AN INSURER.",
     "Keys, premiums and assets stay with you and the provider. Payouts follow the provider's policy."),
    ("health.jpg", "vo-08.mp3", "MANAGE",
     "WATCH HEALTH. FILE A CLAIM. STAY IN CONTROL.",
     "Positions, alerts near danger, and claims if something goes wrong. Every action needs your signature."),
    ("final.jpg", "vo-09.mp3", "FBT SWAP",
     "LEND. BORROW. PROTECT.",
     "Verify every action.  fbtswap.ir"),
]


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit((r.stderr or r.stdout)[-5000:].decode("utf-8", "replace"))


def duration(path):
    r = subprocess.run([FF, "-i", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    txt = (r.stderr or b"").decode("utf-8", "replace")
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", txt)
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


def logo_plate(path):
    im = Image.new("RGB", (W, H), (4, 6, 16))
    # vignette
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    logo = Image.open(APP_LOGO).convert("RGBA")
    logo = logo.resize((420, 420), Image.Resampling.LANCZOS)
    lx, ly = (W - 420) // 2, 210
    im.paste(logo, (lx, ly), logo)
    d2 = ImageDraw.Draw(im)
    ft = ImageFont.truetype(FONT_B, 64)
    fb = ImageFont.truetype(FONT_B, 36)
    fs = ImageFont.truetype(FONT, 32)
    def center(txt, y, font, fill):
        tw = d2.textlength(txt, font=font)
        d2.text(((W - tw) / 2, y), txt, font=font, fill=fill)
    center("FBT SWAP", 670, ft, (248, 250, 252))
    center("LOANS  ·  INSURANCE", 750, fb, (96, 165, 250))
    center("fbtswap.ir", 820, fs, (226, 232, 240))
    im.save(path, quality=95)


def card_image(src, kicker, title, body, path, logo=False):
    if logo:
        logo_plate(path)
        return
    base = fit_cover(Image.open(os.path.join(IMG, src)), W, H)
    base = ImageEnhance.Brightness(base).enhance(0.55)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rectangle((0, int(H * 0.42), W, H), fill=(5, 8, 20, 210))
    d.rectangle((0, H - 8, W, H), fill=(59, 130, 246, 255))
    fk = ImageFont.truetype(FONT, 28)
    ft = ImageFont.truetype(FONT_B, 46)
    fb = ImageFont.truetype(FONT, 30)
    fs = ImageFont.truetype(FONT, 22)
    d.text((80, 70), "FBT LOANS  ·  INSURANCE", font=fk, fill=(147, 197, 253, 255))
    d.text((80, 520), kicker, font=fk, fill=(96, 165, 250, 255))
    y = 570
    for line in wrap(d, title, ft, W - 160):
        d.text((80, y), line, font=ft, fill=(248, 250, 252, 255))
        y += 56
    y += 8
    for line in wrap(d, body, fb, W - 180):
        d.text((80, y), line, font=fb, fill=(203, 213, 225, 255))
        y += 42
    d.text((80, H - 56), "fbtswap.ir   ·   Lend. Borrow. Protect.", font=fs, fill=(148, 163, 184, 255))
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
            env = 0.36 + 0.1 * math.sin(2 * math.pi * t / 14)
            if t > seconds - 6:
                env *= max(0.05, (seconds - t) / 6)
            a = 0.2 * math.sin(2 * math.pi * 51.9 * t)
            b = 0.12 * math.sin(2 * math.pi * 77.8 * t)
            c = 0.08 * math.sin(2 * math.pi * 103.8 * t)
            s = max(-0.95, min(0.95, (a + b + c) * env))
            v = int(s * 18000)
            chunk += struct.pack("<hh", v, int(v * 0.9))
            if len(chunk) > 400000:
                w.writeframes(bytes(chunk))
                chunk.clear()
        if chunk:
            w.writeframes(bytes(chunk))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtli-")
    durs = [duration(os.path.join(AUD, vo)) for _, vo, *_ in CARDS]
    total = sum(durs)
    print("total", round(total, 2), durs)
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
        "-shortest", OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT), "s", round(total, 2))


if __name__ == "__main__":
    main()
