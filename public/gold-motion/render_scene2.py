#!/usr/bin/env python3
"""8s motion graphic: three glass panels, gold coin, gold bar, Persian headline."""
import math, os, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
import arabic_reshaper
from bidi.algorithm import get_display

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
OUT = os.path.join(ROOT, "FBT-Gold-Scene2-Look-Beyond-the-Price.mp4")
W, H, FPS, DUR = 1920, 1080, 24, 8.0
N = int(FPS * DUR)
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

QUESTIONS = [
    "What is the final\npurchase price?",
    "What fees and\nspreads apply?",
    "How does delivery\nor settlement work?",
]
HEAD_FA = "قیمت، کارمزد، تسویه"


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def fa(text):
    return get_display(arabic_reshaper.reshape(text))


def knock_black(im, thresh=28):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r < thresh and g < thresh and b < thresh:
                px[x, y] = (r, g, b, 0)
            else:
                # slight edge fade
                m = min(r, g, b)
                if m < thresh + 40:
                    px[x, y] = (r, g, b, int(255 * (m - thresh) / 40))
    return im


def load_cut(name, size):
    im = Image.open(os.path.join(IMG, name))
    im = knock_black(im)
    im.thumbnail(size, Image.Resampling.LANCZOS)
    return im


def glass_panel(w, h, title, t_glow=1.0):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # fill
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=22, fill=(28, 16, 48, int(150 * t_glow)))
    # violet outline
    col = (186, 140, 255, int(220 * t_glow))
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=22, outline=col, width=2)
    inner = (230, 210, 255, int(80 * t_glow))
    d.rounded_rectangle((8, 8, w - 9, h - 9), radius=18, outline=inner, width=1)
    font = ImageFont.truetype(FONT, 28)
    lines = title.split("\n")
    y = h // 2 - 18 * len(lines)
    for line in lines:
        tw = d.textlength(line, font=font)
        d.text(((w - tw) / 2, y), line, font=font, fill=(245, 240, 255, int(255 * t_glow)))
        y += 38
    return im.filter(ImageFilter.GaussianBlur(0.3))


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


def frame_at(i, bg, coin, bar):
    t = i / FPS
    canvas = bg.copy().convert("RGBA")
    # slow camera drift
    drift = 8 * math.sin(t * 0.7)

    # coin always center, bob
    coin_s = 0.92 + 0.04 * math.sin(t * 2.2)
    coin_a = ease((t - 0.15) / 0.5)
    paste(canvas, coin, W / 2 + drift * 0.3, H / 2 - 10 + 6 * math.sin(t * 1.6), coin_s, coin_a)

    # panel targets: left, top-right-ish, bottom — then gather around bar
    pw, ph = 420, 210
    # entrance start y
    starts = [
        (W * 0.22, H * 1.15),
        (W * 0.78, H * 1.15),
        (W * 0.50, H * 1.20),
    ]
    float_pos = [
        (W * 0.22 + drift, H * 0.38 + 4 * math.sin(t * 1.3)),
        (W * 0.78 - drift, H * 0.34 + 4 * math.sin(t * 1.3 + 1)),
        (W * 0.50, H * 0.78 + 3 * math.sin(t * 1.1)),
    ]
    gather = [
        (W * 0.32, H * 0.42),
        (W * 0.68, H * 0.42),
        (W * 0.50, H * 0.72),
    ]
    delays = [0.35, 0.55, 0.75]
    for n, q in enumerate(QUESTIONS):
        enter = ease((t - delays[n]) / 0.7)
        gather_t = ease((t - 4.0) / 1.4)
        x0, y0 = starts[n]
        x1, y1 = float_pos[n]
        x2, y2 = gather[n]
        x = lerp(lerp(x0, x1, enter), x2, gather_t)
        y = lerp(lerp(y0, y1, enter), y2, gather_t)
        a = min(1.0, enter)
        # fade panels a bit as bar takes over
        if t > 6.2:
            a *= 1 - ease((t - 6.2) / 1.4) * 0.85
        panel = glass_panel(pw, ph, q, t_glow=a)
        paste(canvas, panel, x, y, 1.0, a)

    # gold bar appears and grows toward camera
    bar_in = ease((t - 3.7) / 0.9)
    zoom = 1.0
    if t > 6.5:
        zoom = 1.0 + 1.8 * ease((t - 6.5) / 1.5)
    paste(canvas, bar, W / 2, H / 2 + 40, (0.55 + 0.1 * bar_in) * zoom, bar_in)

    # Persian headline
    if t > 5.4:
        ha = ease((t - 5.4) / 0.5)
        if t > 7.2:
            ha *= 1 - ease((t - 7.2) / 0.7)
        d = ImageDraw.Draw(canvas)
        font = ImageFont.truetype(FONT_B, 64)
        txt = fa(HEAD_FA)
        tw = d.textlength(txt, font=font)
        # glow
        for off in range(6, 0, -2):
            d.text(((W - tw) / 2, 70), txt, font=font, fill=(180, 140, 255, int(40 * ha)))
        d.text(((W - tw) / 2, 72), txt, font=font, fill=(250, 246, 255, int(255 * ha)))
        sub = ImageFont.truetype(FONT, 22)
        s = "Price  ·  Fees  ·  Settlement"
        sw = d.textlength(s, font=sub)
        d.text(((W - sw) / 2, 148), s, font=sub, fill=(200, 180, 230, int(200 * ha)))

    # kicker
    d = ImageDraw.Draw(canvas)
    k = ImageFont.truetype(FONT, 18)
    d.text((60, H - 48), "FBT SWAP   ·   fbtswap.ir", font=k, fill=(160, 150, 190, 180))
    return canvas.convert("RGB")


def main():
    bg = Image.open(os.path.join(IMG, "bg.jpg")).resize((W, H), Image.Resampling.LANCZOS)
    bg = ImageEnhance.Brightness(bg).enhance(0.55)
    coin = load_cut("coin.jpg", (280, 280))
    bar = load_cut("bar.jpg", (520, 320))
    tmp = tempfile.mkdtemp(prefix="goldsc2-")
    print("frames", N, "dir", tmp)
    for i in range(N):
        fr = frame_at(i, bg, coin, bar)
        fr.save(os.path.join(tmp, f"f{i:04d}.jpg"), quality=88)
        if i % 24 == 0:
            print("t", i / FPS)
    out = OUT
    subprocess.check_call([
        FF, "-y", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%04d.jpg"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "fast",
        out,
    ])
    print("wrote", out, os.path.getsize(out))


if __name__ == "__main__":
    main()
