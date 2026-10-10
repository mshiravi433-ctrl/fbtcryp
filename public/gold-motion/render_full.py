#!/usr/bin/env python3
"""Full gold purchase motion film: logo, comparison, buy, disclosure, close."""
import math, os, subprocess, tempfile, re, struct, wave
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
import arabic_reshaper
from bidi.algorithm import get_display

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Gold-Purchase-Motion.mp4")
APP_LOGO = os.path.join(os.path.dirname(ROOT), "icon-512.png")
W, H, FPS = 1920, 1080, 24
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR = 44100

QUESTIONS = [
    "What is the final\npurchase price?",
    "What fees and\nspreads apply?",
    "How does delivery\nor settlement work?",
]


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def fa(text):
    return get_display(arabic_reshaper.reshape(text))


def duration(path):
    r = subprocess.run([FF, "-i", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", (r.stderr or b"").decode())
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mi * 60 + s


def knock_black(im, thresh=28):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r < thresh and g < thresh and b < thresh:
                px[x, y] = (0, 0, 0, 0)
    return im


def load_rgb(name, size=None):
    im = Image.open(os.path.join(IMG, name)).convert("RGB")
    if size:
        im = im.resize(size, Image.Resampling.LANCZOS)
    return im


def paste(base, spr, cx, cy, scale=1.0, alpha=1.0):
    if alpha <= 0 or scale <= 0.02:
        return
    if scale != 1.0:
        nw, nh = max(2, int(spr.width * scale)), max(2, int(spr.height * scale))
        spr = spr.resize((nw, nh), Image.Resampling.LANCZOS)
    if alpha < 1:
        spr = spr.copy()
        a = spr.split()[-1].point(lambda p: int(p * alpha))
        spr.putalpha(a)
    x, y = int(cx - spr.width / 2), int(cy - spr.height / 2)
    base.alpha_composite(spr, (x, y))


def glass_panel(w, h, title, t_glow=1.0):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=22, fill=(28, 16, 48, int(155 * t_glow)))
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=22, outline=(186, 140, 255, int(220 * t_glow)), width=2)
    d.rounded_rectangle((8, 8, w - 9, h - 9), radius=18, outline=(230, 210, 255, int(80 * t_glow)), width=1)
    font = ImageFont.truetype(FONT, 28)
    lines = title.split("\n")
    y = h // 2 - 18 * len(lines)
    for line in lines:
        tw = d.textlength(line, font=font)
        d.text(((w - tw) / 2, y), line, font=font, fill=(245, 240, 255, int(255 * t_glow)))
        y += 38
    return im


def caption(canvas, kicker, title, body, alpha=1.0):
    if alpha <= 0:
        return
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rectangle((0, int(H * 0.62), W, H), fill=(8, 6, 18, int(200 * alpha)))
    fk = ImageFont.truetype(FONT, 24)
    ft = ImageFont.truetype(FONT_B, 42)
    fb = ImageFont.truetype(FONT, 26)
    d.text((70, 70), "FBT GOLD", font=fk, fill=(212, 175, 55, int(230 * alpha)))
    d.text((70, 700), kicker, font=fk, fill=(186, 140, 255, int(230 * alpha)))
    d.text((70, 740), title, font=ft, fill=(250, 246, 255, int(255 * alpha)))
    y = 800
    words = body.split()
    line, font = "", fb
    for w_ in words:
        t = (line + " " + w_).strip()
        if d.textlength(t, font=font) > W - 140:
            d.text((70, y), line, font=font, fill=(210, 200, 220, int(240 * alpha)))
            y += 34
            line = w_
        else:
            line = t
    if line:
        d.text((70, y), line, font=font, fill=(210, 200, 220, int(240 * alpha)))
    d.text((70, H - 48), "fbtswap.ir", font=fk, fill=(160, 150, 190, int(200 * alpha)))
    canvas.alpha_composite(overlay)


def scene1(t, dur, assets):
    canvas = assets["bg"].copy().convert("RGBA")
    a = ease(t / 0.6) * (1 - 0.4 * ease((t - (dur - 0.5)) / 0.5) if t > dur - 0.5 else 1)
    logo = assets["logo"]
    paste(canvas, logo, W / 2, 340, 1.0 + 0.04 * math.sin(t * 1.2), a)
    bar_a = ease((t - 0.4) / 0.6)
    paste(canvas, assets["bar"], W / 2, 720, 0.55 + 0.05 * math.sin(t), bar_a * a)
    d = ImageDraw.Draw(canvas)
    ft = ImageFont.truetype(FONT_B, 64)
    fb = ImageFont.truetype(FONT_B, 36)
    fs = ImageFont.truetype(FONT, 30)

    def c(txt, y, font, fill):
        tw = d.textlength(txt, font=font)
        d.text(((W - tw) / 2, y), txt, font=font, fill=fill)

    fa_a = int(255 * ease((t - 0.8) / 0.4) * a)
    c("FBT SWAP", 820, ft, (250, 246, 255, fa_a))
    c("GOLD", 890, fb, (212, 175, 55, fa_a))
    c("fbtswap.ir", 950, fs, (220, 210, 230, fa_a))
    return canvas.convert("RGB")


def scene2(t, dur, assets):
    canvas = assets["bg"].copy().convert("RGBA")
    drift = 8 * math.sin(t * 0.7)
    coin_s = 0.92 + 0.04 * math.sin(t * 2.2)
    paste(canvas, assets["coin"], W / 2 + drift * 0.3, H / 2 - 10 + 6 * math.sin(t * 1.6), coin_s, ease((t - 0.1) / 0.4))
    starts = [(W * 0.22, H * 1.15), (W * 0.78, H * 1.15), (W * 0.50, H * 1.20)]
    float_pos = [
        (W * 0.22 + drift, H * 0.38),
        (W * 0.78 - drift, H * 0.34),
        (W * 0.50, H * 0.78),
    ]
    gather = [(W * 0.32, H * 0.42), (W * 0.68, H * 0.42), (W * 0.50, H * 0.72)]
    delays = [0.25, 0.45, 0.65]
    for n, q in enumerate(QUESTIONS):
        enter = ease((t - delays[n]) / 0.65)
        g = ease((t - dur * 0.48) / 1.2)
        x = lerp(lerp(starts[n][0], float_pos[n][0], enter), gather[n][0], g)
        y = lerp(lerp(starts[n][1], float_pos[n][1], enter), gather[n][1], g)
        a = min(1.0, enter)
        if t > dur - 1.6:
            a *= 1 - ease((t - (dur - 1.6)) / 1.4) * 0.8
        paste(canvas, glass_panel(420, 200, q, a), x, y, 1.0, a)
    bar_in = ease((t - dur * 0.45) / 0.8)
    zoom = 1.0 + (1.6 * ease((t - (dur - 1.5)) / 1.5) if t > dur - 1.5 else 0)
    paste(canvas, assets["bar"], W / 2, H / 2 + 36, (0.55 + 0.1 * bar_in) * zoom, bar_in)
    if t > dur * 0.62:
        ha = ease((t - dur * 0.62) / 0.4)
        if t > dur - 0.8:
            ha *= 1 - ease((t - (dur - 0.8)) / 0.7)
        d = ImageDraw.Draw(canvas)
        font = ImageFont.truetype(FONT_B, 64)
        txt = fa("قیمت، کارمزد، تسویه")
        tw = d.textlength(txt, font=font)
        d.text(((W - tw) / 2, 72), txt, font=font, fill=(250, 246, 255, int(255 * ha)))
        sub = ImageFont.truetype(FONT, 22)
        s = "Price  ·  Fees  ·  Settlement"
        sw = d.textlength(s, font=sub)
        d.text(((W - sw) / 2, 148), s, font=sub, fill=(200, 180, 230, int(200 * ha)))
    d = ImageDraw.Draw(canvas)
    d.text((60, H - 48), "FBT SWAP   ·   fbtswap.ir", font=ImageFont.truetype(FONT, 18), fill=(160, 150, 190, 180))
    return canvas.convert("RGB")


def ken(base, t, dur, zoom0=1.0, zoom1=1.12):
    z = lerp(zoom0, zoom1, t / max(dur, 0.01))
    bw, bh = base.size
    nw, nh = int(W * z), int(H * z)
    im = base.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (nw - W) // 2
    y = (nh - H) // 2 + int(10 * math.sin(t * 0.6))
    return im.crop((x, y, x + W, y + H)).convert("RGBA")


def scene3(t, dur, assets):
    canvas = ken(assets["grid"], t, dur, 1.02, 1.14)
    # buy UI slides in
    ui_t = ease((t - 1.2) / 0.8)
    ui = assets["buy"].resize((980, 560), Image.Resampling.LANCZOS).convert("RGBA")
    ui.putalpha(Image.new("L", ui.size, int(230 * ui_t)))
    paste(canvas, ui, W * 0.62, H * 0.42, 1.0, ui_t)
    caption(
        canvas, "BUY ON FBT", "PAXG  ·  XAUt  ·  A FRACTION OF AN OUNCE.",
        "Swap like any ERC-20. Rate, fee and minimum received before you sign. No dealer appointment. FBT holds nothing.",
        ease((t - 0.3) / 0.4) * (1 if t < dur - 0.4 else 1 - ease((t - (dur - 0.4)) / 0.4)),
    )
    return canvas.convert("RGB")


def scene4(t, dur, assets):
    a = ken(assets["vault"], t, dur, 1.0, 1.1)
    b = ken(assets["wallet"], t, dur, 1.08, 1.0)
    mix = ease((t - dur * 0.45) / 0.9)
    canvas = Image.blend(a.convert("RGBA"), b.convert("RGBA"), mix)
    caption(
        canvas, "SETTLEMENT  ·  DISCLOSURE",
        "A CLAIM ON ISSUER GOLD. NOT A BAR IN YOUR HAND.",
        "Paxos or Tether can freeze or burn a balance. That is a real difference from ETH, BTC, or bullion you hold. Read it before you buy.",
        ease((t - 0.2) / 0.4),
    )
    return canvas.convert("RGB")


def scene5(t, dur, assets):
    canvas = assets["bg"].copy().convert("RGBA")
    a = ease(t / 0.5)
    paste(canvas, assets["logo"], W / 2, 300, 1.0, a)
    paste(canvas, assets["bar"], W / 2, 620, 0.7 + 0.15 * ease(t / dur), a)
    d = ImageDraw.Draw(canvas)
    ft = ImageFont.truetype(FONT_B, 56)
    fb = ImageFont.truetype(FONT, 28)
    txt = "YOU SIGN.  IT LANDS IN YOUR WALLET."
    tw = d.textlength(txt, font=ft)
    d.text(((W - tw) / 2, 780), txt, font=ft, fill=(250, 246, 255, int(255 * ease((t - 0.4) / 0.4))))
    s = "FBT SWAP  ·  GOLD  ·  fbtswap.ir"
    sw = d.textlength(s, font=fb)
    d.text(((W - sw) / 2, 860), s, font=fb, fill=(212, 175, 55, int(255 * ease((t - 0.6) / 0.4))))
    return canvas.convert("RGB")


def music(path, seconds):
    n = int(seconds * SR)
    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = bytearray()
        for i in range(n):
            t = i / SR
            env = 0.34 + 0.1 * math.sin(2 * math.pi * t / 10)
            if t > seconds - 5:
                env *= max(0.05, (seconds - t) / 5)
            s = (0.18 * math.sin(2 * math.pi * 49 * t) + 0.1 * math.sin(2 * math.pi * 73.5 * t) + 0.06 * math.sin(2 * math.pi * 98 * t)) * env
            v = int(max(-0.95, min(0.95, s)) * 18000)
            buf += struct.pack("<hh", v, int(v * 0.9))
            if len(buf) > 400000:
                w.writeframes(bytes(buf))
                buf.clear()
        if buf:
            w.writeframes(bytes(buf))


def main():
    vos = [f"vo-{i:02d}.mp3" for i in range(5)]
    durs = [duration(os.path.join(AUD, v)) for v in vos]
    print("durs", [round(d, 2) for d in durs], "total", round(sum(durs), 2))
    bg = load_rgb("bg.jpg", (W, H))
    bg = ImageEnhance.Brightness(bg).enhance(0.5)
    coin = knock_black(Image.open(os.path.join(IMG, "coin.jpg")))
    coin.thumbnail((280, 280), Image.Resampling.LANCZOS)
    bar = knock_black(Image.open(os.path.join(IMG, "bar.jpg")))
    bar.thumbnail((520, 320), Image.Resampling.LANCZOS)
    logo = Image.open(APP_LOGO).convert("RGBA").resize((380, 380), Image.Resampling.LANCZOS)
    assets = {
        "bg": bg, "coin": coin, "bar": bar, "logo": logo,
        "grid": load_rgb("grid.jpg", (W, H)),
        "buy": Image.open(os.path.join(IMG, "buy.jpg")).convert("RGBA"),
        "vault": load_rgb("vault.jpg", (W, H)),
        "wallet": load_rgb("wallet.jpg", (W, H)),
    }
    scenes = [scene1, scene2, scene3, scene4, scene5]
    tmp = tempfile.mkdtemp(prefix="goldfull-")
    idx = 0
    for si, (fn, dur) in enumerate(zip(scenes, durs)):
        nf = max(1, int(round(dur * FPS)))
        print("scene", si, "frames", nf, "dur", round(dur, 2))
        for i in range(nf):
            t = i / FPS
            fr = fn(t, dur, assets)
            fr.save(os.path.join(tmp, f"f{idx:05d}.jpg"), quality=86)
            idx += 1
    raw = os.path.join(tmp, "raw.mp4")
    subprocess.check_call([
        FF, "-y", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%05d.jpg"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast", raw,
    ])
    lst = os.path.join(tmp, "a.txt")
    with open(lst, "w") as f:
        for v in vos:
            f.write(f"file '{os.path.join(AUD, v)}'\n")
    speech = os.path.join(tmp, "speech.mp3")
    subprocess.check_call([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", speech])
    mus = os.path.join(tmp, "m.wav")
    music(mus, sum(durs) + 1)
    subprocess.check_call([
        FF, "-y", "-i", raw, "-i", speech, "-i", mus,
        "-filter_complex",
        "[2:a]volume=0.2,afade=t=in:st=0:d=1,afade=t=out:st=" + f"{max(1, sum(durs)-4):.1f}" + ":d=3.5[m];"
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.12[v];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.45[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
