#!/usr/bin/env python3
"""Launch + Farm educational film. Female VO. Opens on the FBT app logo."""
import os, subprocess, tempfile, struct, math, wave, re
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Launch-Farm-Product-Film.mp4")
APP_LOGO = os.path.join(os.path.dirname(ROOT), "icon-512.png")
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR, W, H = 44100, 1920, 1080

CARDS = [
    ("logo", "vo-00.mp3", "", "FBT SWAP", "LAUNCH  ·  FARM"),
    ("launch.jpg", "vo-01.mp3", "LAUNCH",
     "CREATE A TOKEN. LAUNCH A POOL. GO LIVE.",
     "Non-custodial, end to end. You choose network, name, supply, and rules. Nothing is signed until you say so."),
    ("token.jpg", "vo-02.mp3", "RULES",
     "NETWORK. TOKEN. RULES. LIQUIDITY. LAUNCH.",
     "A basic token is fixed supply. Advanced owner powers raise the risk score and stay on-chain forever."),
    ("token.jpg", "vo-03.mp3", "YOUR WALLET CREATES THE CONTRACT",
     "FBT DOES NOT HOLD THE TOKEN OR THE KEYS.",
     "The address is shown before you sign and verified on-chain afterwards."),
    ("farm.jpg", "vo-04.mp3", "FARM",
     "YIELD FROM REAL ACTIVITY. NOT A HEADLINE.",
     "Deposit into a pool. Earn a share of interest, swap fees, or rewards. 900% APY is not paying you out of revenue."),
    ("il.jpg", "vo-05.mp3", "IMPERMANENT LOSS",
     "READ THIS BEFORE YOU DEPOSIT.",
     "If the two tokens move apart, you can be worse off than holding. No rate or return is guaranteed."),
    ("farm.jpg", "vo-06.mp3", "CUSTODY",
     "POOLS ARE NOT RUN BY FBT.",
     "You deposit from your wallet into their contracts. We never touch funds. We do not show a stale yield."),
    ("farm.jpg", "vo-07.mp3", "STAKING",
     "SIMPLER YIELD. STILL NOT A SAVINGS ACCOUNT.",
     "Some tokens grow against the base asset with no lock. Swapping out is how you stop. No guaranteed exit price."),
    ("final.jpg", "vo-08.mp3", "FBT SWAP",
     "LAUNCH WITH A RISK SCORE. FARM WITH EVIDENCE.",
     "Your wallet signs. You stay in control.  fbtswap.ir"),
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
    d2 = ImageDraw.Draw(im)
    logo = Image.open(APP_LOGO).convert("RGBA").resize((420, 420), Image.Resampling.LANCZOS)
    im.paste(logo, ((W - 420) // 2, 210), logo)
    ft = ImageFont.truetype(FONT_B, 64)
    fb = ImageFont.truetype(FONT_B, 36)
    fs = ImageFont.truetype(FONT, 32)

    def center(txt, y, font, fill):
        tw = d2.textlength(txt, font=font)
        d2.text(((W - tw) / 2, y), txt, font=font, fill=fill)

    center("FBT SWAP", 670, ft, (248, 250, 252))
    center("LAUNCH  ·  FARM", 750, fb, (96, 165, 250))
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
    d.text((80, 70), "FBT LAUNCH  ·  FARM", font=fk, fill=(147, 197, 253, 255))
    d.text((80, 520), kicker, font=fk, fill=(96, 165, 250, 255))
    y = 570
    for line in wrap(d, title, ft, W - 160):
        d.text((80, y), line, font=ft, fill=(248, 250, 252, 255))
        y += 56
    y += 8
    for line in wrap(d, body, fb, W - 180):
        d.text((80, y), line, font=fb, fill=(203, 213, 225, 255))
        y += 42
    d.text((80, H - 56), "fbtswap.ir   ·   Launch. Farm. Stay in control.", font=fs, fill=(148, 163, 184, 255))
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
            a = 0.2 * math.sin(2 * math.pi * 58.3 * t)
            b = 0.12 * math.sin(2 * math.pi * 87.3 * t)
            c = 0.08 * math.sin(2 * math.pi * 116.5 * t)
            s = max(-0.95, min(0.95, (a + b + c) * env))
            v = int(s * 18000)
            chunk += struct.pack("<hh", v, int(v * 0.9))
            if len(chunk) > 400000:
                w.writeframes(bytes(chunk))
                chunk.clear()
        if chunk:
            w.writeframes(bytes(chunk))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtlf-")
    durs = [duration(os.path.join(AUD, vo)) for _, vo, *_ in CARDS]
    total = sum(durs)
    print("total", round(total, 2))
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
