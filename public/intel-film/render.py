#!/usr/bin/env python3
"""FBT Global Intelligence ad — Persian VO, ~30–45s+ matching speech."""
import math, os, subprocess, tempfile, re, struct, wave
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import arabic_reshaper
from bidi.algorithm import get_display

FF = "/tmp/videnv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
ROOT = os.path.dirname(os.path.abspath(__file__))
IMG, AUD = os.path.join(ROOT, "img"), os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "FBT-Global-Intelligence.mp4")
W, H, FPS, SR = 1920, 1080, 24, 44100
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
HEADS = [
    ("هوش جهانی بیدار می‌شود", "شبکه مالی · داده · نهنگ نور"),
    ("اسمارت مانی", "جریان را ببین؛ سود را تضمین نکن"),
    ("اقتصاد جهان", "طلا · نفت · فلز · سهام · فارکس"),
    ("از داده به بینش", "احتمال و ریسک. هرگز سود تضمینی نیست"),
    ("اف‌بی‌تی سواپ", "هوش جهانی  ·  fbtswap.ir"),
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


def ken(im, t, dur, z0=1.04, z1=1.16):
    z = z0 + (z1 - z0) * (t / max(dur, 0.01))
    nw, nh = int(W * z), int(H * z)
    x = im.resize((nw, nh), Image.Resampling.LANCZOS)
    return x.crop(((nw - W) // 2, (nh - H) // 2, (nw - W) // 2 + W, (nh - H) // 2 + H)).convert("RGBA")


def cap(c, i, a=1):
    o = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.rectangle((0, 680, W, H), fill=(0, 8, 24, int(200 * a)))
    d.rectangle((0, H - 5, W, H), fill=(0, 220, 255, int(200 * a)))
    k, s = HEADS[i]
    d.text((70, 60), fa("هوش جهانی"), font=ImageFont.truetype(FONT, 22), fill=(0, 230, 255, int(240 * a)))
    d.text((70, 710), fa(k), font=ImageFont.truetype(FONT_B, 42), fill=(240, 250, 255, int(255 * a)))
    d.text((70, 770), fa(s), font=ImageFont.truetype(FONT, 26), fill=(255, 80, 200, int(240 * a)))
    d.text((70, H - 48), "fbtswap.ir", font=ImageFont.truetype(FONT, 22), fill=(160, 200, 230, int(220 * a)))
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
    keys = ["whale", "whale", "globe", "core", "rise"]
    c = ken(A[keys[si]], t, dur)
    if si == 3:
        overlay = A["dash"].copy().convert("RGBA")
        overlay.putalpha(int(160 * ease((t - 0.4) / 0.6)))
        c.alpha_composite(Image.blend(c, overlay.resize((W, H)), 0.35))
    cap(c, si, ease(min(1, t / 0.3)))
    if si == 4:
        paste(c, A["logo"], W / 2, 360, 1.05 + 0.06 * math.sin(t * 2.2), ease(t / 0.4), rot=t * 10)
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
            env = 0.32 + 0.1 * math.sin(2 * math.pi * t / 6)
            if t > seconds - 4:
                env *= max(0.05, (seconds - t) / 4)
            s = (0.16 * math.sin(2 * math.pi * 48 * t) + 0.09 * math.sin(2 * math.pi * 96 * t)) * env
            v = int(max(-0.95, min(0.95, s)) * 17000)
            buf += struct.pack("<hh", v, int(v * 0.9))
            if len(buf) > 400000:
                w.writeframes(bytes(buf))
                buf.clear()
        if buf:
            w.writeframes(bytes(buf))


def main():
    vos = [f"vo-{i:02d}.mp3" for i in range(1, 6)]
    durs = [duration(os.path.join(AUD, v)) for v in vos]
    print("total", round(sum(durs), 2), durs)
    A = {k: Image.open(os.path.join(IMG, k + ".jpg")).resize((W, H)) for k in ("whale", "globe", "core", "dash", "rise")}
    A["logo"] = Image.open(os.path.join(IMG, "logo.png")).convert("RGBA").resize((400, 400))
    tmp = tempfile.mkdtemp(prefix="intel-")
    idx = 0
    for si, dur in enumerate(durs):
        nf = max(1, int(round(dur * FPS)))
        print("scene", si, nf)
        for i in range(nf):
            frame(si, i / FPS, dur, A).save(os.path.join(tmp, f"f{idx:05d}.jpg"), quality=86)
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
    tot = sum(durs)
    subprocess.check_call([
        FF, "-y", "-i", raw, "-i", speech, "-i", mus,
        "-filter_complex",
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.2[v];"
        "[2:a]volume=0.22,afade=t=in:st=0:d=0.8,afade=t=out:st=" + f"{max(1, tot-4):.1f}" + ":d=3.5[m];"
        "[v][m]amix=inputs=2:duration=first:dropout_transition=0:weights=1 0.45[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT,
    ])
    print("wrote", OUT, os.path.getsize(OUT), "s", round(tot, 2))


if __name__ == "__main__":
    main()
