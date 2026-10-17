"""FBT Radio - generative music engine (ambient / synthwave beds).
All audio is original, synthesized from scratch with numpy/scipy.
"""
import numpy as np
from scipy.signal import butter, sosfilt, oaconvolve

SR = 44100
RNG = np.random.default_rng(20261017)


# ---------------------------------------------------------------- utilities
def midi_hz(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def _saw(freq, n, phase=0.0):
    t = np.arange(n, dtype=np.float64) / SR
    return 2.0 * ((freq * t + phase) % 1.0) - 1.0


def _sine(freq, n, phase=0.0):
    t = np.arange(n, dtype=np.float64) / SR
    return np.sin(2 * np.pi * freq * t + phase)


def _tri(freq, n, phase=0.0):
    t = np.arange(n, dtype=np.float64) / SR
    ph = (freq * t + phase) % 1.0
    return 4.0 * np.abs(ph - 0.5) - 1.0


def adsr(n, a=0.01, d=0.1, s=0.8, r=0.3):
    a = max(1, int(a * SR)); d = max(1, int(d * SR)); r = max(1, int(r * SR))
    if a + d + r >= n:
        a = max(1, int(n * 0.15)); d = max(1, int(n * 0.15)); r = max(1, int(n * 0.2))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a) ** 1.5
    e[a:a + d] = 1 - (1 - s) * np.linspace(0, 1, d)
    e[a + d:] = s
    e[-r:] *= np.linspace(1, 0, r) ** 1.3
    return e


def lp(x, cutoff, order=2):
    cutoff = min(cutoff, SR * 0.45)
    sos = butter(order, cutoff, btype="low", fs=SR, output="sos")
    return sosfilt(sos, x, axis=-1)


def hp(x, cutoff, order=2):
    sos = butter(order, cutoff, btype="high", fs=SR, output="sos")
    return sosfilt(sos, x, axis=-1)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x, axis=-1)


def make_ir(seconds=2.4, decay=3.2, damp=4200.0):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    env = np.exp(-decay * t)
    ir = RNG.normal(0, 1, (n, 2)) * env[:, None]
    ir[:, 0] = lp(ir[:, 0], damp)
    ir[:, 1] = lp(ir[:, 1], damp)
    # early reflections
    for delay, g in ((0.011, 0.5), (0.019, 0.35), (0.031, 0.22), (0.047, 0.14)):
        k = int(delay * SR)
        ir[k:, 0] += g * ir[:n - k, 1]
        ir[k:, 1] += g * ir[:n - k, 0]
    return ir / np.max(np.abs(ir)) * 0.9


IR = make_ir()


def reverb(x, wet=0.25, ir=IR):
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    wet_sig = np.stack([oaconvolve(x[:, 0], ir[:, 0], mode="same"),
                        oaconvolve(x[:, 1], ir[:, 1], mode="same")], 1)
    wet_sig /= (np.max(np.abs(wet_sig)) + 1e-9)
    return (1 - wet) * x + wet * wet_sig * np.max(np.abs(x)) * 1.1


def pingpong(x, delay_s=0.34, fb=0.34, mix=0.3):
    d = int(delay_s * SR)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    out = x.copy()
    buf = np.zeros((len(x), 2))
    src = x.copy()
    for k in range(1, 5):
        shift = d * k
        if shift >= len(x):
            break
        g = fb ** k
        if k % 2:
            buf[shift:, 0] += src[:len(x) - shift, 0] * g
        else:
            buf[shift:, 1] += src[:len(x) - shift, 1] * g
    return (1 - mix) * out + mix * (out + buf)


def pan(x, p):
    """p in [-1, 1]"""
    if x.ndim == 1:
        l = x * np.sqrt((1 - p) / 2)
        r = x * np.sqrt((1 + p) / 2)
        return np.stack([l, r], 1)
    return x


def add(buf, sig, start):
    if start >= len(buf):
        return
    n = min(len(sig), len(buf) - start)
    if sig.ndim == 1:
        buf[start:start + n] += sig[:n]
    else:
        buf[start:start + n] += sig[:n]


def soft_clip(x):
    return np.tanh(x * 1.15) / np.tanh(1.15)


def norm(x, peak=0.9):
    m = np.max(np.abs(x))
    return x if m < 1e-9 else x / m * peak


# ---------------------------------------------------------------- instruments
def pad_chord(notes, dur, cutoff=1500, detune=7.0, gain=1.0):
    n = int(dur * SR)
    out = np.zeros((n, 2))
    for i, m in enumerate(notes):
        f = midi_hz(m)
        sig = np.zeros(n)
        for k, cents in enumerate((-detune, 0.0, detune)):
            ff = f * 2 ** (cents / 1200.0)
            sig += _saw(ff, n, phase=RNG.random())
        sig /= 3
        sig = lp(sig, cutoff + 120 * i)
        e = adsr(n, a=0.9, d=0.8, s=0.82, r=1.6)
        sig *= e * gain
        out += pan(sig, (-0.35, 0.0, 0.35)[i % 3]) * (0.9 ** i)
    return out


def pluck(m, dur=0.55, gain=1.0, bright=2400):
    n = int(dur * SR)
    f = midi_hz(m)
    sig = 0.6 * _tri(f, n) + 0.4 * _sine(2 * f, n)
    sig = lp(sig, bright)
    e = np.exp(-np.linspace(0, 6.5, n)) * np.minimum(1, np.linspace(0, 1, n) * 200)
    return sig * e * gain


def bass_note(m, dur, gain=1.0):
    n = int(dur * SR)
    f = midi_hz(m)
    sig = 0.7 * _sine(f, n) + 0.3 * lp(_saw(f, n), 160)
    e = adsr(n, a=0.008, d=0.12, s=0.75, r=0.12)
    return sig * e * gain


def kick(gain=1.0, dur=0.42):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 118 * np.exp(-t * 26) + 44
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = RNG.normal(0, 1, n) * np.exp(-t * 320) * 0.25
    return (body + click) * gain


def snare(gain=1.0):
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    noise = bp(RNG.normal(0, 1, n), 900, 6500) * np.exp(-t * 17)
    tone = _sine(190, n) * np.exp(-t * 25) * 0.4
    return (noise * 0.7 + tone) * gain


def hat(gain=1.0, dur=0.09):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return hp(RNG.normal(0, 1, n), 6800) * np.exp(-t * 60) * gain


def shaker(gain=1.0):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    return bp(RNG.normal(0, 1, n), 4000, 9000) * np.exp(-t * 28) * gain


def riser(dur, gain=0.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = RNG.normal(0, 1, n)
    sweep = np.linspace(400, 9000, n)
    # simple time-varying band approximation via crossfade of bands
    lo = lp(noise, 1200); mid = bp(noise, 1200, 4000); hi = hp(noise, 4000)
    w = np.linspace(0, 1, n)
    sig = (1 - w) * lo + (0.5 - np.abs(w - 0.5)) * 2 * mid + w * hi
    return sig * (w ** 2) * gain


# ---------------------------------------------------------------- arranger
PROGRESSIONS = {
    "aeolian": [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],   # Am F C G
    "lofi":    [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 55, 59]],   # Am G F Em
    "deep":    [[50, 53, 57], [48, 52, 55], [46, 50, 53], [45, 48, 52]],   # Dm Bb Gm F  (minor)
    "night":   [[52, 55, 59], [50, 53, 57], [48, 52, 55], [53, 57, 60]],   # Em D C F
    "bright":  [[48, 52, 55], [53, 57, 60], [55, 59, 62], [57, 60, 64]],   # C F G Am
}


def build_track(name, bpm=88, prog="aeolian", bars=96, seed=1,
                drums=True, arp=True, cutoff=1500, swing=0.0, transpose=0):
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    bar = 4 * beat
    total = bars * bar + 0.6
    n = int(total * SR)
    pad_bus = np.zeros((n, 2))
    arp_bus = np.zeros((n, 2))
    bass_bus = np.zeros((n, 2))
    drum_bus = np.zeros((n, 2))

    chords = PROGRESSIONS[prog]
    chords = [[m + transpose for m in c] for c in chords]

    # ---- pad: one chord per bar
    for b in range(bars):
        ch = chords[b % len(chords)]
        notes = [m + 12 if m < 52 else m for m in ch]
        sig = pad_chord(notes, bar * 1.05, cutoff=cutoff + rng.integers(-80, 80), gain=0.9)
        add(pad_bus, sig, int(b * bar * SR))

    # ---- arrangement map
    def section(b):
        if b < 8:
            return "intro"
        if b < 24:
            return "arp"
        if b < 48:
            return "full"
        if b < 56:
            return "break"
        if b < 88:
            return "full"
        return "outro"

    # ---- bass + arp + drums
    for b in range(bars):
        sec = section(b)
        ch = chords[b % len(chords)]
        root = ch[0] - 12
        t0 = b * bar
        if sec in ("arp", "full", "break", "outro"):
            # arpeggio: 8ths, pattern accent
            steps = 8
            pattern = [0, 1, 2, 3, 4, 2, 1, 2]
            tones = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[2] + 12]
            for s in range(steps):
                if sec == "break" and s % 2:
                    continue
                idx = pattern[s] % len(tones)
                note = tones[idx]
                velocity = 0.85 if s in (0, 3, 6) else 0.55
                t = t0 + s * beat / 2 + (swing * beat / 2 if s % 2 else 0)
                sig = pluck(note, 0.5 if sec != "break" else 0.9, gain=velocity * 0.5)
                add(arp_bus, pan(sig, 0.35 if s % 2 else -0.35), int(t * SR))
        if sec in ("full", "break", "outro"):
            # bass
            for s, dur in ((0, 1.6 * beat), (2, 1.2 * beat), (3.5, 0.9 * beat)):
                t = t0 + s * beat
                sig = bass_note(root + (0 if s < 3 else 7), dur * 1.1, gain=0.85)
                add(bass_bus, pan(sig, 0.0), int(t * SR))
        if sec in ("full", "outro") and drums:
            for s in (0, 2):
                add(drum_bus, pan(kick(0.95), 0), int((t0 + s * beat) * SR))
            for s in (1, 3):
                add(drum_bus, pan(snare(0.5), 0.05), int((t0 + s * beat) * SR))
            for s in range(8):
                g = 0.22 if s % 2 == 0 else 0.13
                add(drum_bus, pan(hat(g), 0.3 if s % 2 else -0.3), int((t0 + s * beat / 2) * SR))
            add(drum_bus, pan(shaker(0.10), -0.2), int((t0 + 3.5 * beat) * SR))

    # ---- effects
    pad = reverb(pad_bus, 0.32)
    arp = reverb(pingpong(arp_bus, delay_s=beat * 0.75, fb=0.32, mix=0.33), 0.22)
    bass = bass_bus
    drums = reverb(drum_bus, 0.10)

    mix = 0.95 * pad + 0.75 * arp + 0.55 * bass + 0.5 * drums

    # de-click only: no long track fades (sets are crossfaded by the assembler)
    t = np.arange(n) / SR
    di = np.clip(t / 0.20, 0, 1)[:, None]
    do = np.clip((total - t) / 0.35, 0, 1)[:, None]
    mix *= di * do

    # gentle high shelf + low cut
    mix[:, 0] = hp(mix[:, 0], 28)
    mix[:, 1] = hp(mix[:, 1], 28)
    mix = soft_clip(norm(mix, 0.92) * 0.9)
    return norm(mix, 0.9)


def jingle(kind="open", dur=9.0):
    n = int(dur * SR)
    buf = np.zeros((n, 2))
    if kind == "open":
        # rising arpeggio + impact + shimmer
        notes = [57, 60, 64, 69, 72, 76]
        for i, m in enumerate(notes):
            add(buf, pan(pluck(m, 1.4, 0.55, bright=5200), -0.5 + i * 0.2), int(i * 0.16 * SR))
        add(buf, pan(pad_chord([45, 57, 64, 69], dur, cutoff=2600, gain=0.55), 0), 0)
        add(buf, pan(kick(0.9), 0), int(0.62 * SR))
        add(buf, pan(riser(1.2, 0.22), 0), int(0.0 * SR))
        add(buf, pan(pluck(84, 2.6, 0.3, bright=9000), 0.4), int(2.6 * SR))
    elif kind == "id":
        add(buf, pan(kick(0.7), 0), 0)
        for i, m in enumerate([69, 72, 76]):
            add(buf, pan(pluck(m, 1.0, 0.45, bright=6000), -0.3 + 0.3 * i), int(i * 0.09 * SR))
        add(buf, pan(pad_chord([45, 57, 64], dur, cutoff=2200, gain=0.4), 0), 0)
    elif kind == "whoosh":
        add(buf, pan(riser(dur, 0.5), 0), 0)
    elif kind == "sting":
        add(buf, pan(pad_chord([45, 52, 57, 64], dur, cutoff=1800, gain=0.5), 0), 0)
        add(buf, pan(pluck(81, 2.2, 0.25, bright=8000), 0), 0)
    buf = reverb(buf, 0.4)
    return norm(buf, 0.85)


if __name__ == "__main__":
    import time, sys
    t0 = time.time()
    tr = build_track("test", bpm=88, prog="aeolian", bars=48, seed=3)
    print("shape", tr.shape, "secs", tr.shape[0] / SR, "render", round(time.time() - t0, 1))
