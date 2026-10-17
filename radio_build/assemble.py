"""Assemble the FBT Radio 2-hour broadcast: original music + narration + jingles."""
import json
import os
import subprocess
import wave
from dataclasses import dataclass

import numpy as np

from music_engine import (SR, build_track, jingle, lp, hp, norm, reverb,
                          add, pan, soft_clip)

ROOT = "/home/user/fbtcryp"
WORK = "/tmp/radio"
TRACKS = os.path.join(WORK, "tracks")
FFMPEG = "/tmp/radvenv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
os.makedirs(TRACKS, exist_ok=True)

TOTAL = 7200.0  # 2 hours

# ------------------------------------------------------------------ speech
CLIPS = {
    "intro":    ("fbt_radio_part01_intro.mp3", "معرفی رادیو FBT"),
    "what":     ("fbt_radio_part02_crypto_chist.mp3", "کریپتو چیست؟"),
    "btc":      ("fbt_radio_part03_bitcoin.mp3", "بیت‌کوین، پادشاه بازار"),
    "alts":     ("fbt_radio_part04_ethereum_altcoins.mp3", "اتریوم و آلت‌کوین‌ها"),
    "news":     ("fbt_radio_part05_news.mp3", "اخبار داغ کریپتو"),
    "future":   ("fbt_radio_part06_future.mp3", "آینده کریپتو"),
    "defi":     ("fbt_radio_part07_stablecoin_defi.mp3", "استیبل‌کوین و دیفای"),
    "nft":      ("fbt_radio_part08_nft_metaverse.mp3", "ان‌اف‌تی و متاورس"),
    "trading":  ("fbt_radio_part09_trading.mp3", "آموزش ترید حرفه‌ای"),
    "security": ("fbt_radio_part10_security.mp3", "امنیت و کیف پول"),
    "iq1":      ("parts/fbt_radio_part11_interview_q1.mp3", "مصاحبه: ساختار بازار"),
    "ia1":      ("parts/fbt_radio_part12_interview_a1.mp3", "مصاحبه: تحلیل آنچین"),
    "iq2":      ("parts/fbt_radio_part13_interview_q2.mp3", "مصاحبه: حرکت نهنگ‌ها"),
    "ia2":      ("parts/fbt_radio_part14_interview_a2.mp3", "مصاحبه: رادار نهنگ‌ها"),
    "iq3":      ("parts/fbt_radio_part15_interview_q3.mp3", "مصاحبه: آینده بازار"),
    "ia3":      ("parts/fbt_radio_part16_interview_a3.mp3", "مصاحبه: سه موج آینده"),
}

VOICE_CACHE = {}


def ff(*args):
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration_of(path):
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(path)


def prep_voice(key):
    if key in VOICE_CACHE:
        return VOICE_CACHE[key]
    src = os.path.join(ROOT, CLIPS[key][0])
    dst = os.path.join(WORK, f"v_{key}.wav")
    if not os.path.exists(dst):
        ff("-i", src, "-af",
           "highpass=f=80,"
           "equalizer=f=190:t=q:w=1.1:g=-2.5,"
           "equalizer=f=2600:t=q:w=1.3:g=2.2,"
           "equalizer=f=7200:t=q:w=1.0:g=1.5,"
           "acompressor=threshold=-19dB:ratio=3.2:attack=6:release=170:makeup=2.5,"
           "loudnorm=I=-16:TP=-1.5:LRA=9,"
           "aresample=44100",
           "-ac", "2", "-c:a", "pcm_s16le", dst)
    with wave.open(dst, "rb") as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        data = data.reshape(-1, 2).astype(np.float32) / 32768.0
    VOICE_CACHE[key] = data
    return data


# ------------------------------------------------------------------ music
TRACK_DEFS = [
    # name, bpm, progression, bars, seed, drums, arp, cutoff
    ("T1 Genesis",     84, "aeolian", 104, 11, True,  True,  1450),
    ("T2 Ledger",      92, "bright",  104, 12, True,  True,  1600),
    ("T3 Orbit",       80, "night",   104, 13, True,  True,  1250),
    ("T4 Deep Liquidity", 88, "deep", 104, 14, True,  True,  1150),
    ("T5 Night Desk",  76, "lofi",    100, 15, True,  True,  1050),
    ("T6 Bull Run",   100, "bright",  112, 16, True,  True,  1750),
    ("T7 Cold Storage", 72, "night",   96, 17, True,  True,   950),
    ("T8 Signal",      96, "aeolian", 112, 18, True,  True,  1500),
]
TRACK_META = {}


def ensure_tracks():
    for name, bpm, prog, bars, seed, drums, arp, cutoff in TRACK_DEFS:
        path = os.path.join(TRACKS, name.split()[0] + ".npy")
        if not os.path.exists(path):
            print("rendering", name, flush=True)
            tr = build_track(name, bpm=bpm, prog=prog, bars=bars, seed=seed,
                             drums=drums, arp=arp, cutoff=cutoff)
            np.save(path, tr.astype(np.float32))
        arr = np.load(path, mmap_mode="r")
        TRACK_META[name] = (path, len(arr) / SR)
        print(f"  {name}: {len(arr)/SR:.1f}s", flush=True)


def get_track(name, start, length):
    path, dur = TRACK_META[name]
    arr = np.load(path, mmap_mode="r")
    edge = int(1.0 * SR)
    body = arr[edge:len(arr) - edge]          # never read the de-click edges
    L = len(body)
    s = int((start % (L / SR)) * SR)
    out = np.zeros((int(length * SR), 2), dtype=np.float32)
    take = min(L - s, len(out))
    out[:take] = body[s:s + take]
    if take < len(out):                        # wrap inside the musical body
        rem = len(out) - take
        while rem > 0:
            chunk = min(L, rem)
            out[take:take + chunk] = body[:chunk]
            take += chunk
            rem -= chunk
    return out


# ------------------------------------------------------------------ timeline
@dataclass
class Item:
    kind: str          # jingle | talk | music
    ref: object
    seconds: float
    title: str = ""
    bed: str = ""


def talk(key, bed="T3 Orbit", title=None):
    d = len(prep_voice(key)) / SR
    return Item("talk", key, d, title or CLIPS[key][1], bed)


def music(name, seconds, title="ست موسیقی"):
    return Item("music", name, seconds, title)


def jing(kind, seconds=8.0):
    return Item("jingle", kind, seconds, "جینگل")


def build_timeline():
    hour1 = [
        jing("open", 9.0),
        talk("intro", bed="T1 Genesis"),
        music("SET_A", 0, "ست موسیقی ۱ — طلوع بازار"),
        jing("id", 4.5),
        talk("what", bed="T2 Ledger"),
        talk("btc", bed="T2 Ledger"),
        talk("alts", bed="T3 Orbit"),
        music("SET_B", 0, "ست موسیقی ۲ — مدار"),
        jing("sting", 4.0),
        talk("iq1", bed="T4 Deep Liquidity"),
        talk("ia1", bed="T4 Deep Liquidity"),
        talk("iq2", bed="T4 Deep Liquidity"),
        talk("ia2", bed="T4 Deep Liquidity"),
        talk("iq3", bed="T5 Night Desk"),
        talk("ia3", bed="T5 Night Desk"),
        music("SET_C", 0, "ست موسیقی ۳ — عمق بازار"),
        talk("news", bed="T6 Bull Run"),
        talk("future", bed="T6 Bull Run"),
        music("SET_D", 0, "ست موسیقی ۴ — روند صعودی"),
        talk("defi", bed="T8 Signal"),
        talk("nft", bed="T8 Signal"),
        talk("trading", bed="T7 Cold Storage"),
        talk("security", bed="T7 Cold Storage"),
        music("SET_E", 0, "ست موسیقی ۵ — رادار نهنگ‌ها"),
    ]
    hour2 = [
        jing("id", 4.5),
        talk("news", bed="T2 Ledger"),
        talk("future", bed="T2 Ledger"),
        music("SET_F", 0, "ست موسیقی ۶ — نقدینگی"),
        talk("trading", bed="T3 Orbit"),
        talk("security", bed="T3 Orbit"),
        music("SET_G", 0, "ست موسیقی ۷ — شبانه"),
        talk("iq1", bed="T1 Genesis"),
        talk("ia1", bed="T1 Genesis"),
        talk("iq2", bed="T1 Genesis"),
        talk("ia2", bed="T1 Genesis"),
        talk("iq3", bed="T8 Signal"),
        talk("ia3", bed="T8 Signal"),
        music("SET_H", 0, "ست موسیقی ۸ — سیگنال"),
        talk("what", bed="T5 Night Desk"),
        talk("btc", bed="T5 Night Desk"),
        talk("alts", bed="T6 Bull Run"),
        music("SET_I", 0, "ست موسیقی ۹ — آلت‌کوین‌ها"),
        talk("defi", bed="T4 Deep Liquidity"),
        talk("nft", bed="T4 Deep Liquidity"),
        music("SET_J", 0, "ست موسیقی ۱۰ — افق"),
        talk("intro", bed="T7 Cold Storage"),
    ]

    # music set composition (track order repeats with variation)
    sets = {
        "SET_A": ["T1 Genesis", "T2 Ledger"],
        "SET_B": ["T3 Orbit"],
        "SET_C": ["T4 Deep Liquidity", "T5 Night Desk"],
        "SET_D": ["T6 Bull Run"],
        "SET_E": ["T1 Genesis", "T8 Signal", "T3 Orbit"],
        "SET_F": ["T2 Ledger", "T4 Deep Liquidity"],
        "SET_G": ["T5 Night Desk", "T7 Cold Storage"],
        "SET_H": ["T8 Signal", "T1 Genesis"],
        "SET_I": ["T6 Bull Run", "T2 Ledger"],
        "SET_J": ["T7 Cold Storage", "T3 Orbit", "T1 Genesis"],
    }

    # target music lengths per set (seconds) -- first pass
    targets = {
        "SET_A": 540, "SET_B": 300, "SET_C": 585, "SET_D": 260, "SET_E": 640,
        "SET_F": 600, "SET_G": 510, "SET_H": 540, "SET_I": 540, "SET_J": 560,
    }

    items = hour1 + hour2

    def effective_speech(seq):
        total = 0.0
        i = 0
        while i < len(seq):
            it = seq[i]
            if it.kind == "talk":
                j = i
                while j + 1 < len(seq) and seq[j + 1].kind == "talk" and seq[j + 1].bed == it.bed:
                    j += 1
                total += sum(seq[k].seconds for k in range(i, j + 1)) + 0.72 * (j - i)
                i = j + 1
            else:
                total += it.seconds
                i += 1
        return total

    speech = effective_speech(items)
    music_total = TOTAL - speech
    base = sum(targets.values())
    scale = music_total / base
    for it in items:
        if it.kind == "music":
            it.seconds = targets[it.ref] * scale
            it.title = f"{it.title}"
    # correct rounding to land exactly on TOTAL
    diff = TOTAL - effective_speech(items)
    last = [i for i in items if i.kind == "music"][-1]
    last.seconds += diff
    # attach track lists
    for it in items:
        if it.kind == "music":
            it.ref = sets[it.ref]
    return items, sets


# ------------------------------------------------------------------ rendering
def smooth_env(x, attack=0.05, release=0.35):
    a = int(attack * SR); r = int(release * SR)
    rect = np.abs(x).mean(axis=1) if x.ndim > 1 else np.abs(x)
    # moving max-ish via lfilter one-pole
    from scipy.signal import lfilter
    env = lfilter([1 - np.exp(-1 / a)], [1, -np.exp(-1 / a)], rect)
    env = lfilter([1 - np.exp(-1 / r)], [1, -np.exp(-1 / r)], env)
    return env


BED_COUNTER = [0]


def render_talk(item):
    return render_talk_block([item])[0]


def render_talk_block(clips):
    """One continuous music bed under a run of narration clips."""
    gap = np.zeros((int(0.72 * SR), 2), dtype=np.float32)
    parts, offsets, cur = [], [], 0
    for k, c in enumerate(clips):
        v = prep_voice(c.ref).astype(np.float32)
        offsets.append(cur)
        parts.append(v)
        cur += len(v)
        if k < len(clips) - 1:
            parts.append(gap)
            cur += len(gap)
    voice = np.concatenate(parts)
    n = len(voice)

    BED_COUNTER[0] += 1
    start = 8.0 + (BED_COUNTER[0] * 23.0) % 90.0
    bed = get_track(clips[0].bed, start=start, length=n / SR + 0.4)[:n]

    env = smooth_env(voice)
    env = env / (env.max() + 1e-9)
    duck = 1.0 - 0.60 * np.clip(env * 2.2, 0, 1)
    bed = bed * duck[:, None] * 0.115
    bed[:, 0] = lp(bed[:, 0], 5200)
    bed[:, 1] = lp(bed[:, 1], 5200)

    fi = int(1.2 * SR)
    fo = int(1.4 * SR)
    bed[:fi] *= np.linspace(0, 1, fi)[:, None] ** 0.7
    bed[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 0.7

    mix = soft_clip(norm(bed + voice, 0.86) * 0.98)
    spans = []
    for c, off in zip(clips, offsets):
        d = len(prep_voice(c.ref))
        spans.append((c, off / SR, (off + d) / SR))
    return mix, spans


def render_music_set(item):
    """Continuous set: tracks overlap-crossfaded so there is never dead air."""
    tracks = item.ref
    total = item.seconds
    n = len(tracks)
    overlap = 2.6
    seg_len = (total + overlap * (n - 1)) / n
    buf = np.zeros((int(total * SR) + int(0.5 * SR), 2), dtype=np.float32)
    pos = 0
    for k, name in enumerate(tracks):
        seg = get_track(name, start=16.0 + (k * 37.0) % 55.0, length=seg_len)
        L = len(seg)
        fi = int(overlap * SR)
        if k > 0:
            seg[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi))[:, None] ** 1.0
        if k < n - 1:
            seg[-fi:] *= np.cos(np.linspace(0, np.pi / 2, fi))[:, None] ** 1.0
        else:
            fo = int(7.0 * SR)
            seg[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 0.8
        m = min(L, len(buf) - pos)
        buf[pos:pos + m] += seg[:m]
        pos += L - fi
    mix = buf[: int(total * SR)]
    mix = soft_clip(norm(mix * 1.02, 0.9))
    return norm(mix, 0.88)


def main():
    ensure_tracks()
    items, _ = build_timeline()
    print("total items", len(items), "planned", sum(i.seconds for i in items))
    master = os.path.join(WORK, "master.wav")
    w = wave.open(master, "wb")
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)

    chapters = []
    cursor = 0.0
    idx = 0
    while idx < len(items):
        it = items[idx]
        if it.kind == "talk":
            j = idx
            while j + 1 < len(items) and items[j + 1].kind == "talk" and items[j + 1].bed == it.bed:
                j += 1
            block = items[idx:j + 1]
            sig, spans = render_talk_block(block)
            for clip, s0, s1 in spans:
                chapters.append({"start": round(cursor + s0, 2), "end": round(cursor + s1, 2),
                                 "title": clip.title, "kind": "talk"})
            idx = j + 1
        elif it.kind == "jingle":
            sig = jingle(it.ref, it.seconds)
            chapters.append({"start": round(cursor, 2), "end": round(cursor + it.seconds, 2),
                             "title": it.title, "kind": "jingle"})
            idx += 1
        else:
            sig = render_music_set(it)
            chapters.append({"start": round(cursor, 2), "end": round(cursor + it.seconds, 2),
                             "title": it.title, "kind": "music"})
            idx += 1

        n = min(len(sig), int(it.seconds * SR)) if it.kind != "talk" else len(sig)
        sig = sig[:n]
        pcm = np.clip(sig, -1, 1)
        w.writeframes((pcm * 32767).astype(np.int16).tobytes())
        cursor += n / SR
        print(f"[{int(cursor//60):02d}:{int(cursor%60):02d}] {it.kind:7s} {it.title}", flush=True)
    # pad silence if short
    if cursor < TOTAL:
        w.writeframes(np.zeros((int((TOTAL - cursor) * SR), 2), dtype=np.int16).tobytes())
    w.close()
    print("wrote", master, "duration", cursor)

    out = os.path.join(WORK, "FBT_Radio_2Hour_Master.wav")
    ff("-i", master,
       "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.94:level=false",
       "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", out)
    print("normalized", out)
    with open(os.path.join(WORK, "chapters.json"), "w") as f:
        json.dump(chapters, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
