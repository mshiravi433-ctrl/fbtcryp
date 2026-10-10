#!/usr/bin/env python3
"""Light glass gold film — Persian VO + captions. Transparent logo on first/last."""
import math, os, subprocess, tempfile, re, struct, wave
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import arabic_reshaper
from bidi.algorithm import get_display

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
AUD = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Gold-Purchase-Motion.mp4")
W, H, FPS = 1920, 1080, 24
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SR = 44100

QUESTIONS = [
    "قیمت نهایی خرید چیست؟",
    "کارمزد و اسپرد چقدر است؟",
    "تسویه چطور انجام می‌شود؟",
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


def knock(im, dark=True, thresh=240):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if dark:
                if r < 22 and g < 22 and b < 22:
                    px[x, y] = (0, 0, 0, 0)
            else:
                if r > thresh and g > thresh and b > thresh:
                    px[x, y] = (255, 255, 255, 0)
    return im


def load_rgb(name, size=None):
    im = Image.open(os.path.join(IMG, name)).convert("RGB")
    if size:
        im = im.resize(size, Image.Resampling.LANCZOS)
    return ImageEnhance.Brightness(im).enhance(1.12)


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
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=26, fill=(255, 255, 255, int(165 * t_glow)))
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=26, outline=(168, 120, 230, int(230 * t_glow)), width=2)
    d.rounded_rectangle((10, 10, w - 11, h - 11), radius=20, outline=(210, 180, 255, int(120 * t_glow)), width=1)
    font = ImageFont.truetype(FONT_B, 30)
    txt = fa(title)
    tw = d.textlength(txt, font=font)
    d.text(((w - tw) / 2, h / 2 - 18), txt, font=font, fill=(72, 40, 120, int(255 * t_glow)))
    return im


def caption(canvas, kicker, title, body, alpha=1.0):
    if alpha <= 0:
        return
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle((40, 640, W - 40, H - 36), radius=28, fill=(255, 255, 255, int(200 * alpha)))
    fk = ImageFont.truetype(FONT, 22)
    ft = ImageFont.truetype(FONT_B, 38)
    fb = ImageFont.truetype(FONT, 26)
    d.text((70, 70), fa("طلای اف‌بی‌تی"), font=fk, fill=(140, 90, 210, int(240 * alpha)))
    d.text((70, 665), fa(kicker), font=fk, fill=(120, 70, 190, int(240 * alpha)))
    t1 = fa(title)
    d.text((70, 705), t1, font=ft, fill=(40, 24, 80, int(255 * alpha)))
    y = 760
    font = fb
    line = ""
    for w_ in body.split():
        trial = (line + " " + w_).strip()
        shaped = fa(trial)
        if d.textlength(shaped, font=font) > W - 160:
            d.text((70, y), fa(line), font=font, fill=(70, 50, 110, int(245 * alpha)))
            y += 34
            line = w_
        else:
            line = trial
    if line:
        d.text((70, y), fa(line), font=font, fill=(70, 50, 110, int(245 * alpha)))
    d.text((70, H - 70), "fbtswap.ir", font=fk, fill=(130, 90, 180, int(220 * alpha)))
    canvas.alpha_composite(overlay)


def center_text(d, txt, y, font, fill):
    tw = d.textlength(txt, font=font)
    d.text(((W - tw) / 2, y), txt, font=font, fill=fill)


def scene1(t, dur, A):
    canvas = A["bg"].copy().convert("RGBA")
    a = ease(t / 0.5)
    paste(canvas, A["logo"], W / 2, 340, 1.05 + 0.03 * math.sin(t * 1.4), a)
    paste(canvas, A["bar"], W / 2, 700, 0.62, ease((t - 0.3) / 0.5) * a)
    d = ImageDraw.Draw(canvas)
    fa_a = int(255 * ease((t - 0.6) / 0.4) * a)
    center_text(d, fa("اف‌بی‌تی سواپ"), 800, ImageFont.truetype(FONT_B, 58), (50, 30, 90, fa_a))
    center_text(d, fa("طلا"), 870, ImageFont.truetype(FONT_B, 40), (160, 110, 40, fa_a))
    center_text(d, "fbtswap.ir", 930, ImageFont.truetype(FONT, 30), (90, 60, 140, fa_a))
    return canvas.convert("RGB")


def scene2(t, dur, A):
    canvas = A["bg"].copy().convert("RGBA")
    caption(canvas, "چرا از ما؟", "شمش دست ما نیست. توکن در کیف پول شماست.",
            "در بسیاری از سایت‌های ایرانی موجودی پیش فروشنده می‌ماند. اینجا حضانت نداریم.",
            ease((t - 0.15) / 0.35))
    paste(canvas, A["coin"], W / 2, 360, 0.9 + 0.04 * math.sin(t * 2), ease(t / 0.4))
    return canvas.convert("RGB")


def scene3(t, dur, A):
    canvas = A["bg"].copy().convert("RGBA")
    drift = 6 * math.sin(t * 0.8)
    paste(canvas, A["coin"], W / 2, H / 2 - 20, 0.85, 0.95)
    starts = [(W * 0.2, H * 1.1), (W * 0.8, H * 1.1), (W * 0.5, H * 1.15)]
    mid = [(W * 0.22 + drift, 280), (W * 0.78 - drift, 280), (W * 0.5, 520)]
    gather = [(W * 0.32, 340), (W * 0.68, 340), (W * 0.5, 560)]
    delays = [0.2, 0.4, 0.6]
    for n, q in enumerate(QUESTIONS):
        enter = ease((t - delays[n]) / 0.55)
        g = ease((t - dur * 0.5) / 1.1)
        x = lerp(lerp(starts[n][0], mid[n][0], enter), gather[n][0], g)
        y = lerp(lerp(starts[n][1], mid[n][1], enter), gather[n][1], g)
        paste(canvas, glass_panel(460, 150, q, min(1, enter)), x, y, 1.0, min(1, enter))
    paste(canvas, A["bar"], W / 2, 430, (0.5 + 0.9 * ease((t - dur + 1.4) / 1.3)) if t > dur - 1.4 else 0.5 * ease((t - dur * 0.45) / 0.7),
          ease((t - dur * 0.42) / 0.6))
    if t > dur * 0.58:
        ha = ease((t - dur * 0.58) / 0.35)
        d = ImageDraw.Draw(canvas)
        txt = fa("قیمت، کارمزد، تسویه")
        center_text(d, txt, 70, ImageFont.truetype(FONT_B, 56), (70, 40, 120, int(255 * ha)))
    return canvas.convert("RGB")


def ken(base, t, dur, z0=1.0, z1=1.1):
    z = lerp(z0, z1, t / max(dur, 0.01))
    nw, nh = int(W * z), int(H * z)
    im = base.resize((nw, nh), Image.Resampling.LANCZOS)
    x, y = (nw - W) // 2, (nh - H) // 2
    return im.crop((x, y, x + W, y + H)).convert("RGBA")


def scene4(t, dur, A):
    canvas = ken(A["grid"], t, dur, 1.02, 1.12)
    ui_t = ease((t - 0.8) / 0.7)
    ui = A["buy"].resize((920, 540), Image.Resampling.LANCZOS).convert("RGBA")
    paste(canvas, ui, W * 0.62, 380, 1.0, ui_t)
    caption(canvas, "خرید داخل اپ", "پکس‌جی و تتر گلد. کسری از اونس.",
            "نرخ، کارمزد و حداقل دریافتی قبل از امضا. بدون مراجعه به طلافروشی.",
            ease((t - 0.2) / 0.4))
    return canvas.convert("RGB")


def scene5(t, dur, A):
    canvas = ken(A["wallet"], t, dur, 1.0, 1.08)
    caption(canvas, "امنیت یعنی حضانت نداشتن ما",
            "طلا پیش اف‌بی‌تی نیست. کلید پیش شماست.",
            "توکن ادعای طلا نزد ناشر است نه شمش خانه. ناشر ممکن است آدرس را مسدود کند. قبل از خرید بخوانید.",
            ease((t - 0.15) / 0.35))
    return canvas.convert("RGB")


def scene6(t, dur, A):
    canvas = A["bg"].copy().convert("RGBA")
    a = ease(t / 0.45)
    paste(canvas, A["logo"], W / 2, 300, 1.08, a)
    paste(canvas, A["bar"], W / 2, 600, 0.7, a)
    d = ImageDraw.Draw(canvas)
    center_text(d, fa("شما امضا می‌کنید. توکن در کیف پولتان می‌نشیند."), 780,
                ImageFont.truetype(FONT_B, 36), (50, 30, 90, int(255 * ease((t - 0.4) / 0.4))))
    center_text(d, fa("اف‌بی‌تی سواپ  ·  طلا") + "  ·  fbtswap.ir", 850,
                ImageFont.truetype(FONT, 28), (140, 90, 40, int(255 * ease((t - 0.55) / 0.4))))
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
            env = 0.28 + 0.08 * math.sin(2 * math.pi * t / 9)
            if t > seconds - 4:
                env *= max(0.05, (seconds - t) / 4)
            s = (0.16 * math.sin(2 * math.pi * 52 * t) + 0.09 * math.sin(2 * math.pi * 78 * t)) * env
            v = int(max(-0.95, min(0.95, s)) * 16000)
            buf += struct.pack("<hh", v, int(v * 0.92))
            if len(buf) > 400000:
                w.writeframes(bytes(buf))
                buf.clear()
        if buf:
            w.writeframes(bytes(buf))


def main():
    vos = [f"vo-{i:02d}.mp3" for i in range(6)]
    durs = [duration(os.path.join(AUD, v)) for v in vos]
    print("durs", [round(d, 2) for d in durs], "total", round(sum(durs), 2))
    bg = load_rgb("bg-light.jpg", (W, H))
    coin = knock(Image.open(os.path.join(IMG, "coin-light.jpg")), dark=False)
    coin.thumbnail((300, 300), Image.Resampling.LANCZOS)
    bar = knock(Image.open(os.path.join(IMG, "bar-light.jpg")), dark=False)
    bar.thumbnail((540, 340), Image.Resampling.LANCZOS)
    logo = Image.open(os.path.join(IMG, "logo.png")).convert("RGBA").resize((400, 400), Image.Resampling.LANCZOS)
    A = {
        "bg": bg, "coin": coin, "bar": bar, "logo": logo,
        "grid": load_rgb("grid-light.jpg", (W, H)),
        "buy": Image.open(os.path.join(IMG, "buy-light.jpg")).convert("RGBA"),
        "wallet": load_rgb("wallet-light.jpg", (W, H)),
    }
    scenes = [scene1, scene2, scene3, scene4, scene5, scene6]
    tmp = tempfile.mkdtemp(prefix="goldfa-")
    idx = 0
    for si, (fn, dur) in enumerate(zip(scenes, durs)):
        nf = max(1, int(round(dur * FPS)))
        print("scene", si, nf)
        for i in range(nf):
            fr = fn(i / FPS, dur, A)
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
        "[2:a]volume=0.16,afade=t=in:st=0:d=1,afade=t=out:st=" + f"{max(1, sum(durs)-4):.1f}" + ":d=3[m];"
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.2[v];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.4[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
