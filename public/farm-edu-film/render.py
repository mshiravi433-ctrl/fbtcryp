#!/usr/bin/env python3
"""90s FBT farming education film — Persian, 16:9 + 9:16."""
import math, os, subprocess, tempfile, re, struct, wave
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import arabic_reshaper
from bidi.algorithm import get_display

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG, AUD = os.path.join(ROOT, "img"), os.path.join(ROOT, "audio")
OUT16 = os.path.join(ROOT, "FBT-Farming-Liquidity-16x9.mp4")
OUT916 = os.path.join(ROOT, "FBT-Farming-Liquidity-9x16.mp4")
W, H, FPS, SR = 1920, 1080, 24, 44100
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

HEADS = [
    ("دارایی تو. استراتژی تو.", "دیفای غیرمتمرکز"),
    ("استخر نقدینگی چیست؟", "دارایی در قرارداد هوشمند"),
    ("فارم دیفای چیست؟", "پاداش تضمینی نیست"),
    ("چطور مشارکت کنیم؟", "نمونهٔ آموزشی — اول بررسی کن"),
    ("پاداش را بفهم. ریسک را بفهم.", "ضرر ناپایدار واقعی است"),
    ("کشف کن. بفهم. مسئولانه وارد شو.", "فقط ویژگی واقعی پلتفرم"),
    ("اف‌بی‌تی سواپ", "کشف دنیای دیفای"),
    ("اف‌بی‌تی سواپ", "تصمیم با توست  ·  fbtswap.ir"),
]
BODIES = [
    "اگر دارایی فقط در کیف پول نماند چه می‌شود؟",
    "سواپ بدون دفتر سفارش سنتی. سهم احتمالی از کارمزد.",
    "کارمزد یا توکن انگیزشی. بازده هیچ‌وقت تضمینی نیست.",
    "۱ استخرها  ۲ نسبت و ریسک  ۳ تأیید در کیف پول",
    "قیمت، پاداش متغیر، آسیب‌پذیری قرارداد.",
    "تصمیم آگاهانه. بدون عدد ساختگی سود.",
    "مسئولانه کشف کنید. هر تصمیم را جدی بگیرید.",
    "استخر را بشناس، فارم را بفهم، با کیف پول خودت وارد شو.",
]


def fa(s):
    return get_display(arabic_reshaper.reshape(s))


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def duration(p):
    r = subprocess.run([FF, "-i", p], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", (r.stderr or b"").decode())
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def ken(im, t, dur, z0=1.05, z1=1.18):
    z = z0 + (z1 - z0) * (t / max(dur, 0.01))
    nw, nh = int(W * z), int(H * z)
    x = ImageEnhance.Contrast(im.resize((nw, nh), Image.Resampling.LANCZOS)).enhance(1.05)
    return x.crop(((nw - W) // 2, (nh - H) // 2, (nw - W) // 2 + W, (nh - H) // 2 + H)).convert("RGBA")


def cap(c, i, a=1.0):
    o = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.rectangle((0, 620, W, H), fill=(8, 0, 22, int(210 * a)))
    d.rectangle((0, H - 6, W, H), fill=(200, 40, 180, int(220 * a)))
    k, t = HEADS[i]
    fk, ft, fb = ImageFont.truetype(FONT, 22), ImageFont.truetype(FONT_B, 40), ImageFont.truetype(FONT, 26)
    d.text((70, 70), fa("فارم و استخر نقدینگی"), font=fk, fill=(220, 120, 255, int(240 * a)))
    d.text((70, 650), fa(k), font=ft, fill=(250, 240, 255, int(255 * a)))
    d.text((70, 710), fa(t), font=fk, fill=(255, 80, 200, int(240 * a)))
    d.text((70, 760), fa(BODIES[i]), font=fb, fill=(210, 190, 230, int(245 * a)))
    d.text((70, H - 48), "fbtswap.ir", font=fk, fill=(180, 140, 220, int(220 * a)))
    c.alpha_composite(o)


def paste(base, spr, cx, cy, sc=1, a=1, rot=0):
    im = spr
    if rot:
        im = im.rotate(rot, expand=True, resample=Image.Resampling.BICUBIC)
    if sc != 1:
        im = im.resize((max(2, int(im.width * sc)), max(2, int(im.height * sc))), Image.Resampling.LANCZOS)
    if a < 1:
        im = im.copy()
        im.putalpha(im.split()[-1].point(lambda p: int(p * a)))
    base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def frame(si, t, dur, A):
    img_i = min(si, 6)
    c = ken(A[img_i], t, dur)
    cap(c, si, ease(min(1, t / 0.35)))
    if si in (0, 6, 7):
        sc = 1.15 if si == 7 else 0.85
        paste(c, A["logo"], W / 2, 340, sc + 0.08 * math.sin(t * 2), 0.98, rot=t * (18 if si == 7 else 12))
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
            env = 0.28 + 0.1 * math.sin(2 * math.pi * t / 8)
            if t > seconds - 5:
                env *= max(0.05, (seconds - t) / 5)
            s = (0.15 * math.sin(2 * math.pi * 55 * t) + 0.08 * math.sin(2 * math.pi * 110 * t)) * env
            v = int(max(-0.95, min(0.95, s)) * 16000)
            buf += struct.pack("<hh", v, int(v * 0.9))
            if len(buf) > 400000:
                w.writeframes(bytes(buf))
                buf.clear()
        if buf:
            w.writeframes(bytes(buf))


def main():
    vos = [f"vo-{i:02d}.mp3" for i in range(1, 9)]
    durs = [duration(os.path.join(AUD, v)) for v in vos]
    print("durs", [round(x, 2) for x in durs], "total", round(sum(durs), 2))
    A = {i: Image.open(os.path.join(IMG, f"s{i+1}.jpg")).resize((W, H)) for i in range(7)}
    A["logo"] = Image.open(os.path.join(IMG, "logo.png")).convert("RGBA").resize((380, 380))
    tmp = tempfile.mkdtemp(prefix="farmedu-")
    idx = 0
    for si, dur in enumerate(durs):
        nf = max(1, int(round(dur * FPS)))
        print("scene", si + 1, nf)
        for i in range(nf):
            frame(si, i / FPS, dur, A).save(os.path.join(tmp, f"f{idx:05d}.jpg"), quality=85)
            idx += 1
    raw = os.path.join(tmp, "raw.mp4")
    subprocess.check_call([FF, "-y", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%05d.jpg"),
                           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast", raw])
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
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.18[v];"
        "[2:a]volume=0.2,afade=t=in:st=0:d=1,afade=t=out:st=" + f"{max(1, sum(durs)-5):.1f}" + ":d=4[m];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.45[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT16,
    ])
    # 9:16 center crop after scale
    subprocess.check_call([
        FF, "-y", "-i", OUT16,
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-c:a", "copy", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", OUT916,
    ])
    print("16x9", os.path.getsize(OUT16), "9x16", os.path.getsize(OUT916))


if __name__ == "__main__":
    main()
