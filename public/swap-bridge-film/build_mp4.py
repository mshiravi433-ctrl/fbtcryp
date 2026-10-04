#!/usr/bin/env python3
"""Swap + Bridge (Solana & EVM) educational film. Opens on the FBT app logo."""
import os, subprocess, tempfile, struct, math, wave, re
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Swap-Bridge-Product-Film.mp4")
APP_LOGO = os.path.join(os.path.dirname(ROOT), "icon-512.png")
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR, W, H = 44100, 1920, 1080

CARDS = [
    ("logo", "vo-00.mp3", "", "FBT SWAP", "SWAP  ·  BRIDGE    SOLANA  ·  EVM"),
    ("swap.jpg", "vo-01.mp3", "SWAP",
     "SAME NETWORK. YOUR WALLET. NO DEPOSIT.",
     "You sign. It broadcasts to the chain. FBT never holds funds and cannot reverse a swap."),
    ("swap.jpg", "vo-02.mp3", "SOLANA AND EVM",
     "THE WALLET MUST MATCH THE NETWORK.",
     "EVM: MetaMask, Trust, OKX, WalletConnect. Solana: a Solana wallet. A swap never jumps chains by itself."),
    ("review.jpg", "vo-03.mp3", "THE QUOTE",
     "RATE. IMPACT. FEES. MINIMUM RECEIVED.",
     "That last number is the worst case you accept. Verify contracts. Fake tokens with real names drain wallets."),
    ("review.jpg", "vo-04.mp3", "SIGN WHAT THE WALLET SHOWS",
     "SLIPPAGE AND MEV GUARD.",
     "Approve if needed, then the swap. What the wallet shows is what executes."),
    ("bridge.jpg", "vo-05.mp3", "BRIDGE",
     "DIFFERENT NETWORKS. DIFFERENT TOKENS.",
     "USDT on BNB is not USDT on Arbitrum. USDC on Ethereum is not USDC on Solana until a bridge completes."),
    ("bridge.jpg", "vo-06.mp3", "ROUTE",
     "COMPARE. SIGN. NEVER CUSTODY.",
     "Solana routes need a Solana wallet. EVM routes need an EVM wallet. Read the destination twice. No undo."),
    ("transit.jpg", "vo-07.mp3", "IN TRANSIT",
     "SECONDS TO MINUTES IS NORMAL.",
     "Keep gas on the destination. Only bridge what you can have in transit. FBT cannot pause or recover a transfer."),
    ("final.jpg", "vo-08.mp3", "FBT SWAP",
     "SAME CHAIN: SWAP.  DIFFERENT CHAIN: BRIDGE.",
     "Solana and EVM, signed by you.  fbtswap.ir"),
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
    im.paste(logo, ((W - 420) // 2, 200), logo)
    ft = ImageFont.truetype(FONT_B, 64)
    fb = ImageFont.truetype(FONT_B, 34)
    fs = ImageFont.truetype(FONT, 32)

    def center(txt, y, font, fill):
        tw = d2.textlength(txt, font=font)
        d2.text(((W - tw) / 2, y), txt, font=font, fill=fill)

    center("FBT SWAP", 650, ft, (248, 250, 252))
    center("SWAP  ·  BRIDGE", 730, fb, (96, 165, 250))
    center("SOLANA  ·  EVM", 780, fb, (147, 197, 253))
    center("fbtswap.ir", 850, fs, (226, 232, 240))
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
    ft = ImageFont.truetype(FONT_B, 42)
    fb = ImageFont.truetype(FONT, 30)
    fs = ImageFont.truetype(FONT, 22)
    d.text((80, 70), "FBT SWAP  ·  BRIDGE", font=fk, fill=(147, 197, 253, 255))
    d.text((80, 520), kicker, font=fk, fill=(96, 165, 250, 255))
    y = 570
    for line in wrap(d, title, ft, W - 160):
        d.text((80, y), line, font=ft, fill=(248, 250, 252, 255))
        y += 52
    y += 8
    for line in wrap(d, body, fb, W - 180):
        d.text((80, y), line, font=fb, fill=(203, 213, 225, 255))
        y += 42
    d.text((80, H - 56), "fbtswap.ir   ·   Solana and EVM, signed by you.", font=fs, fill=(148, 163, 184, 255))
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
            a = 0.2 * math.sin(2 * math.pi * 49.0 * t)
            b = 0.12 * math.sin(2 * math.pi * 73.4 * t)
            c = 0.08 * math.sin(2 * math.pi * 98.0 * t)
            s = max(-0.95, min(0.95, (a + b + c) * env))
            v = int(s * 18000)
            chunk += struct.pack("<hh", v, int(v * 0.9))
            if len(chunk) > 400000:
                w.writeframes(bytes(chunk))
                chunk.clear()
        if chunk:
            w.writeframes(bytes(chunk))


def main():
    tmp = tempfile.mkdtemp(prefix="fbtsb-")
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
