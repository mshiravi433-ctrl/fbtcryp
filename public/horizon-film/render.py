#!/usr/bin/env python3
"""Global Horizon ad film — light RGB, animated logo, warnings last."""
import math, os, subprocess, tempfile, re, struct, wave, random
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter
import arabic_reshaper
from bidi.algorithm import get_display

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG, AUD = os.path.join(ROOT, "img"), os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Global-Horizon-Oil-Metals.mp4")
W, H, FPS, SR = 1920, 1080, 24, 44100
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
RNG = random.Random(7)


def fa(s):
    return get_display(arabic_reshaper.reshape(s))


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def duration(path):
    r = subprocess.run([FF, "-i", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", (r.stderr or b"").decode())
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def knock_white(im, thr=232):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > thr and g > thr and b > thr:
                px[x, y] = (255, 255, 255, 0)
    return im


def paste(base, spr, cx, cy, scale=1.0, alpha=1.0, rot=0):
    if alpha <= 0 or scale <= 0.02:
        return
    im = spr
    if rot:
        im = im.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
    if scale != 1.0:
        im = im.resize((max(2, int(im.width * scale)), max(2, int(im.height * scale))), Image.Resampling.LANCZOS)
    if alpha < 1:
        im = im.copy()
        im.putalpha(im.split()[-1].point(lambda p: int(p * alpha)))
    base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def rgb_ring(d, cx, cy, rad, t, width=4):
    cols = [(0, 220, 255, 180), (255, 40, 160, 170), (255, 200, 40, 170)]
    for i, col in enumerate(cols):
        a0 = t * 220 + i * 120
        d.arc((cx - rad, cy - rad, cx + rad, cy + rad), a0, a0 + 70, fill=col, width=width)


def particles(d, t, n=40):
    for i in range(n):
        seed = RNG.random() if False else (i * 17.3)
        x = (seed * 137 + t * (40 + i % 7) * 12) % W
        y = (i * 53 + math.sin(t * 1.4 + i) * 30 + 80) % H
        r = 2 + (i % 4)
        col = [(0, 210, 255, 140), (255, 50, 170, 130), (255, 190, 50, 140)][i % 3]
        d.ellipse((x, y, x + r, y + r), fill=col)


def ken(base, t, dur, z0=1.04, z1=1.16):
    z = z0 + (z1 - z0) * (t / max(dur, 0.01))
    nw, nh = int(W * z), int(H * z)
    im = base.resize((nw, nh), Image.Resampling.LANCZOS)
    return im.crop(((nw - W) // 2, (nh - H) // 2, (nw - W) // 2 + W, (nh - H) // 2 + H)).convert("RGBA")


def glass_cap(canvas, kicker, title, body, alpha=1, warn=False):
    if alpha <= 0:
        return
    o = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    fill = (255, 245, 248, int(200 * alpha)) if not warn else (255, 236, 220, int(210 * alpha))
    d.rounded_rectangle((48, 680, W - 48, H - 40), 28, fill=fill)
    edge = (255, 40, 160, int(160 * alpha)) if not warn else (220, 90, 20, int(200 * alpha))
    d.rounded_rectangle((48, 680, W - 48, H - 40), 28, outline=edge, width=2)
    fk, ft, fb = ImageFont.truetype(FONT, 22), ImageFont.truetype(FONT_B, 36), ImageFont.truetype(FONT, 24)
    d.text((80, 56), fa("افق جهانی"), font=fk, fill=(180, 40, 160, int(240 * alpha)))
    d.text((80, 700), fa(kicker), font=fk, fill=(20, 160, 200, int(240 * alpha)))
    d.text((80, 738), fa(title), font=ft, fill=(30, 20, 70, int(255 * alpha)))
    y = 790
    line = ""
    for w_ in body.split():
        trial = (line + " " + w_).strip()
        if d.textlength(fa(trial), font=fb) > W - 180:
            d.text((80, y), fa(line), font=fb, fill=(50, 40, 90, int(245 * alpha)))
            y += 32
            line = w_
        else:
            line = trial
    if line:
        d.text((80, y), fa(line), font=fb, fill=(50, 40, 90, int(245 * alpha)))
    d.text((80, H - 72), "fbtswap.ir", font=fk, fill=(140, 40, 150, int(220 * alpha)))
    canvas.alpha_composite(o)


def scene0(t, dur, A):
    c = A["bg"].copy().convert("RGBA")
    d = ImageDraw.Draw(c)
    particles(d, t, 55)
    cx, cy = W / 2, 400
    rgb_ring(d, cx, cy, 250 + 8 * math.sin(t * 3), t)
    rgb_ring(d, cx, cy, 310, -t * 0.7)
    spin = t * 25
    pop = 0.2 + 0.95 * ease(t / 0.7)
    paste(c, A["logo"], cx, cy, pop * (1 + 0.04 * math.sin(t * 2.5)), min(1, t * 2), rot=spin * 0.15)
    a = ease((t - 0.5) / 0.4)
    ft, fb = ImageFont.truetype(FONT_B, 62), ImageFont.truetype(FONT_B, 34)
    tw = d.textlength(fa("افق جهانی"), font=ft)
    d.text(((W - tw) / 2, 700), fa("افق جهانی"), font=ft, fill=(30, 20, 80, int(255 * a)))
    s = fa("نفت  ·  طلا  ·  نقره  ·  بازار جهان")
    sw = d.textlength(s, font=fb)
    d.text(((W - sw) / 2, 780), s, font=fb, fill=(255, 40, 150, int(255 * a)))
    ir = "fbtswap.ir"
    iw = d.textlength(ir, font=ImageFont.truetype(FONT, 28))
    d.text(((W - iw) / 2, 840), ir, font=ImageFont.truetype(FONT, 28), fill=(0, 180, 220, int(255 * a)))
    return c.convert("RGB")


def scene1(t, dur, A):
    c = ken(A["globe"], t, dur)
    d = ImageDraw.Draw(c)
    particles(d, t + 3, 35)
    paste(c, A["oil"], 420 + 20 * math.sin(t), 360, 0.55 + 0.04 * math.sin(t * 2), 0.95)
    paste(c, A["metals"], 1500 - 18 * math.cos(t), 380, 0.5, 0.95)
    glass_cap(c, "بازار جهان، همین‌جا", "طلا را فقط نگه ندار. نفت را فقط خبر نخوان.",
              "روی افق جهانی بازار واقعی جهان را از همان اپ لمس کن. روشن، سریع، مدرن.",
              ease((t - 0.15) / 0.3))
    return c.convert("RGB")


def scene2(t, dur, A):
    c = ken(A["desk"], t, dur, 1.02, 1.12)
    d = ImageDraw.Draw(c)
    particles(d, t + 8, 28)
    # orbiting commodities
    for i, spr in enumerate((A["oil"], A["metals"])):
        ang = t * 0.9 + i * math.pi
        paste(c, spr, W / 2 + math.cos(ang) * 520, 300 + math.sin(ang) * 80, 0.28, 0.9)
    glass_cap(c, "یک صفحه. یک کیف پول.", "طلا، نقره، نفت، فارکس، شاخص.",
              "وثیقه یو‌اس‌دی‌سی روی آربیتروم. تو امضا می‌کنی. کلید پیش ما نیست.",
              ease((t - 0.1) / 0.3))
    return c.convert("RGB")


def scene3(t, dur, A):
    c = ken(A["desk"], t, dur, 1.08, 1.0)
    overlay = A["globe"].copy().convert("RGBA")
    overlay.putalpha(70)
    c.alpha_composite(overlay)
    glass_cap(c, "شفاف، قبل از امضا", "اسپرد، ساعت بازار، فاندینگ روی صفحه.",
              "افق جهانی یعنی دسترسی به بازار جهان؛ بدون سپردن دارایی به ما.",
              ease((t - 0.1) / 0.3))
    return c.convert("RGB")


def scene4(t, dur, A):
    c = A["bg"].copy().convert("RGBA")
    d = ImageDraw.Draw(c)
    particles(d, t, 20)
    paste(c, A["logo"], W / 2, 280, 0.85 + 0.05 * math.sin(t * 2), 1, rot=t * 8)
    rgb_ring(d, W / 2, 280, 220, t)
    glass_cap(
        c, "هشدار ریسک",
        "این‌ها خودِ نفت و طلا نیستند. مشتقهٔ اهرمی‌اند.",
        "اهرم می‌تواند کل وثیقه را لیکویید کند. بیشتر معامله‌گران خرده‌پا ضرر می‌کنند. فقط با پولی وارد شو که از دست دادنش زندگی‌ات را عوض نکند.",
        ease((t - 0.1) / 0.25),
        warn=True,
    )
    return c.convert("RGB")


def music(path, seconds):
    n = int(seconds * SR)
    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = bytearray()
        for i in range(n):
            t = i / SR
            env = 0.3 + 0.1 * math.sin(2 * math.pi * t / 7)
            if t > seconds - 5:
                env *= max(0.06, (seconds - t) / 5)
            s = (0.14 * math.sin(2 * math.pi * 65 * t) + 0.08 * math.sin(2 * math.pi * 98 * t) + 0.05 * math.sin(2 * math.pi * 130 * t)) * env
            v = int(max(-0.95, min(0.95, s)) * 15000)
            buf += struct.pack("<hh", v, int(v * 0.9))
            if len(buf) > 400000:
                w.writeframes(bytes(buf))
                buf.clear()
        if buf:
            w.writeframes(bytes(buf))


def main():
    vos = [f"vo-{i:02d}.mp3" for i in range(5)]
    durs = [duration(os.path.join(AUD, v)) for v in vos]
    print("durs", [round(x, 2) for x in durs], sum(durs))
    bg = ImageEnhance.Brightness(Image.open(os.path.join(IMG, "bg.jpg")).resize((W, H))).enhance(1.15)
    A = {
        "bg": bg,
        "logo": Image.open(os.path.join(IMG, "logo.png")).convert("RGBA").resize((420, 420)),
        "oil": knock_white(Image.open(os.path.join(IMG, "oil.jpg"))),
        "metals": knock_white(Image.open(os.path.join(IMG, "metals.jpg"))),
        "globe": ImageEnhance.Brightness(Image.open(os.path.join(IMG, "globe.jpg")).resize((W, H))).enhance(1.1),
        "desk": ImageEnhance.Brightness(Image.open(os.path.join(IMG, "desk.jpg")).resize((W, H))).enhance(1.08),
    }
    A["oil"].thumbnail((640, 640))
    A["metals"].thumbnail((640, 640))
    scenes = [scene0, scene1, scene2, scene3, scene4]
    tmp = tempfile.mkdtemp(prefix="hz-")
    idx = 0
    for si, (fn, dur) in enumerate(zip(scenes, durs)):
        nf = max(1, int(round(dur * FPS)))
        print("scene", si, nf)
        for i in range(nf):
            fn(i / FPS, dur, A).save(os.path.join(tmp, f"f{idx:05d}.jpg"), quality=86)
            idx += 1
    raw = os.path.join(tmp, "raw.mp4")
    subprocess.check_call([FF, "-y", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%05d.jpg"),
                           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "veryfast", raw])
    lst = os.path.join(tmp, "a.txt")
    with open(lst, "w") as f:
        for v in vos:
            f.write(f"file '{os.path.join(AUD, v)}'\n")
    speech = os.path.join(tmp, "sp.mp3")
    subprocess.check_call([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", speech])
    mus = os.path.join(tmp, "m.wav")
    music(mus, sum(durs) + 1)
    subprocess.check_call([
        FF, "-y", "-i", raw, "-i", speech, "-i", mus,
        "-filter_complex",
        "[2:a]volume=0.18,afade=t=in:st=0:d=0.8,afade=t=out:st=" + f"{max(1,sum(durs)-4):.1f}" + ":d=3[m];"
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.22[v];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.42[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
