#!/usr/bin/env python3
"""Append the new Persian, two-host educational block to the FBT Radio master.

The generated voice clips are kept under radio_build/generated/ (ignored by
Git, just like the original narration sources). This script creates fresh,
non-repeating instrumental beds from music_engine.py, ducks them under each
voice, appends the result to the existing two-hour stream, and writes the new
chapter offsets for the app and standalone radio page.

Run with the studio environment described in README.md:
  /tmp/radvenv/bin/python radio_build/append_dialogue.py
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from scipy.signal import lfilter

BUILD = Path(__file__).resolve().parent
ROOT = BUILD.parent
PUBLIC = ROOT / "public" / "radio"
GENERATED = BUILD / "generated"
MANIFEST = BUILD / "dialogue_2026-11-fa.json"
STREAM = PUBLIC / "fbt-radio-2h.mp3"
WORK = Path(os.environ.get("FBT_RADIO_WORKDIR", "/tmp/fbt-radio-dialogue"))
BASE_MP3 = WORK / "original-fbt-radio-2h.mp3"
EXTENSION_WAV = WORK / "dialogue-extension.wav"
OUTPUT_TMP = PUBLIC / "fbt-radio-2h.building.mp3"
CHAPTERS_OUT = GENERATED / "dialogue-chapters.json"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SR = 44100

sys.path.insert(0, str(BUILD))
from music_engine import build_track, soft_clip  # noqa: E402


VOICE_BEDS = {
    "history": {"bpm": 78, "prog": "aeolian", "seed": 61, "cutoff": 1450, "transpose": 0},
    "candles": {"bpm": 84, "prog": "bright", "seed": 62, "cutoff": 1720, "transpose": 2},
    "venues": {"bpm": 74, "prog": "night", "seed": 63, "cutoff": 1260, "transpose": -1},
    "swap": {"bpm": 92, "prog": "lofi", "seed": 64, "cutoff": 1580, "transpose": 1},
    "wallet": {"bpm": 78, "prog": "deep", "seed": 65, "cutoff": 1160, "transpose": 0},
    "networks": {"bpm": 88, "prog": "bright", "seed": 66, "cutoff": 1780, "transpose": -2},
    "farm": {"bpm": 76, "prog": "aeolian", "seed": 67, "cutoff": 1420, "transpose": 1},
    "global": {"bpm": 82, "prog": "night", "seed": 68, "cutoff": 1510, "transpose": 0},
    "futures": {"bpm": 96, "prog": "deep", "seed": 69, "cutoff": 1830, "transpose": 2},
    "auto": {"bpm": 86, "prog": "lofi", "seed": 70, "cutoff": 1650, "transpose": -1},
    "opening": {"bpm": 108, "prog": "bright", "seed": 71, "cutoff": 2380, "transpose": 3},
    "chart-break": {"bpm": 82, "prog": "night", "seed": 72, "cutoff": 2100, "transpose": 0},
    "liquidity-break": {"bpm": 96, "prog": "bright", "seed": 73, "cutoff": 2300, "transpose": 1},
    "network-break": {"bpm": 76, "prog": "aeolian", "seed": 74, "cutoff": 1950, "transpose": -2},
    "risk-break": {"bpm": 88, "prog": "deep", "seed": 75, "cutoff": 2050, "transpose": 2},
    "outro": {"bpm": 80, "prog": "lofi", "seed": 76, "cutoff": 2000, "transpose": 0},
}

# Keep the selected voices' expressive dynamics instead of crushing every phrase
# to one level. A light compressor controls peaks; gentle EQ and normalization keep
# the narration clear without making it sound over-processed.
VOICE_FILTER = (
    "highpass=f=70,"
    "equalizer=f=190:t=q:w=1.1:g=-1.2,"
    "equalizer=f=2600:t=q:w=1.3:g=1.0,"
    "equalizer=f=7200:t=q:w=1.0:g=0.6,"
    "acompressor=threshold=-22dB:ratio=1.6:attack=14:release=240:makeup=1.0,"
    "loudnorm=I=-17:TP=-1.5:LRA=11"
)


def ff(*args: object) -> None:
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *map(str, args)],
        check=True,
    )


def preset_track(key: str, seconds: float, *, drums: bool) -> np.ndarray:
    preset = VOICE_BEDS[key]
    bar_seconds = 240.0 / preset["bpm"]
    bars = max(4, math.ceil((seconds + 1.5) / bar_seconds))
    stereo = build_track(
        f"FBT dialogue {key}",
        bpm=preset["bpm"],
        prog=preset["prog"],
        bars=bars,
        seed=preset["seed"],
        drums=drums,
        arp=True,
        cutoff=preset["cutoff"],
        transpose=preset["transpose"],
    )
    mono = stereo.mean(axis=1).astype(np.float32, copy=False)
    wanted = max(1, int(round(seconds * SR)))
    if len(mono) < wanted:
        repeats = math.ceil(wanted / max(1, len(mono)))
        mono = np.tile(mono, repeats)
    return mono[:wanted]


def voice_array(entry: dict, index: int) -> np.ndarray:
    source = GENERATED / entry["audio"]
    if not source.is_file():
        raise FileNotFoundError(
            f"Missing generated narration {source}. The voice clips are studio inputs, not Git assets."
        )
    decoded = WORK / f"voice-{index:02d}.wav"
    ff(
        "-i", source,
        "-af", VOICE_FILTER,
        "-ar", SR,
        "-ac", 1,
        "-c:a", "pcm_s16le",
        decoded,
    )
    with wave.open(str(decoded), "rb") as reader:
        if reader.getnchannels() != 1 or reader.getsampwidth() != 2 or reader.getframerate() != SR:
            raise RuntimeError(f"Unexpected decoded narration format: {decoded}")
        data = np.frombuffer(reader.readframes(reader.getnframes()), dtype=np.int16)
    if not len(data):
        raise RuntimeError(f"Narration clip is empty: {source}")
    voice = data.astype(np.float32) / 32768.0
    fade = min(int(0.025 * SR), len(voice) // 2)
    if fade:
        voice[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
        voice[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    return voice


def fade_bed(bed: np.ndarray, fade_in: float = 0.8, fade_out: float = 1.25) -> np.ndarray:
    out = bed.copy()
    fi = min(len(out), int(fade_in * SR))
    fo = min(len(out), int(fade_out * SR))
    if fi:
        out[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32) ** 0.8
    if fo:
        out[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32) ** 0.8
    return out


def mix_voice_bed(voice: np.ndarray, music_key: str) -> np.ndarray:
    duration = len(voice) / SR
    bed = preset_track(music_key, duration, drums=False)

    # Smooth speech envelope and side-chain duck the bed beneath both hosts.
    attack = max(1, int(0.045 * SR))
    release = max(1, int(0.34 * SR))
    envelope = lfilter([1 - math.exp(-1 / attack)], [1, -math.exp(-1 / attack)], np.abs(voice))
    envelope = lfilter([1 - math.exp(-1 / release)], [1, -math.exp(-1 / release)], envelope)
    envelope /= float(np.max(envelope) + 1e-8)
    duck = 1.0 - 0.68 * np.clip(envelope * 1.9, 0.0, 1.0)
    bed = fade_bed(bed, fade_in=1.0, fade_out=1.5) * duck.astype(np.float32) * 0.11
    return np.clip(soft_clip(voice + bed), -0.96, 0.96).astype(np.float32)


def render_voice(entry: dict, index: int) -> np.ndarray:
    voice = voice_array(entry, (index - 1) * 3)
    return mix_voice_bed(voice, entry["music"])


def render_conversation(entry: dict, index: int, turn_pause: float) -> np.ndarray:
    turns = entry.get("turns", [])
    if len(turns) < 2 or len({turn["speaker"] for turn in turns}) < 2:
        raise ValueError(f"{entry['id']} must contain an exchange between two distinct hosts")

    pause = np.zeros(max(0, int(round(turn_pause * SR))), dtype=np.float32)
    parts = []
    for turn_index, turn in enumerate(turns):
        voice_index = (index - 1) * 3 + turn_index
        parts.append(voice_array(turn, voice_index))
        if turn_index + 1 < len(turns):
            parts.append(pause)
    return mix_voice_bed(np.concatenate(parts), entry["music"])


def render_instrumental(key: str, seconds: float) -> np.ndarray:
    music = preset_track(key, seconds, drums=True)
    music = fade_bed(music, fade_in=1.1, fade_out=min(2.5, seconds / 5))
    return np.clip(soft_clip(music * 0.43), -0.92, 0.92).astype(np.float32)


def write_audio(writer: wave.Wave_write, audio: np.ndarray) -> None:
    pcm = np.clip(audio, -1.0, 1.0)
    writer.writeframes((pcm * 32767.0).astype(np.int16).tobytes())


def write_pause(writer: wave.Wave_write, seconds: float) -> None:
    count = int(round(seconds * SR))
    if count:
        writer.writeframes(np.zeros(count, dtype=np.int16).tobytes())


def mp3_duration(path: Path) -> float:
    probe = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    match = re.search(r"Duration: (\d+):(\d+):([\d.]+)", probe.stderr)
    if not match:
        raise RuntimeError(f"Could not read MP3 duration: {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def ensure_base_master(expected_seconds: float) -> None:
    """Find the untouched 2h source; never append onto an already extended file."""
    if BASE_MP3.is_file():
        if abs(mp3_duration(BASE_MP3) - expected_seconds) <= 1.0:
            return
        raise RuntimeError(f"The saved base master is not {expected_seconds:.0f} seconds: {BASE_MP3}")

    if abs(mp3_duration(STREAM) - expected_seconds) <= 1.0:
        shutil.copy2(STREAM, BASE_MP3)
        return

    # On a clean checkout of the completed branch, the current stream is
    # already extended. Recover the original from Git history if available.
    for revision in ("HEAD", "HEAD^"):
        restored = WORK / f"base-{revision.replace('^', '-parent')}.mp3"
        with restored.open("wb") as handle:
            result = subprocess.run(
                ["git", "-C", str(ROOT), "show", f"{revision}:public/radio/fbt-radio-2h.mp3"],
                stdout=handle,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        if result.returncode == 0 and abs(mp3_duration(restored) - expected_seconds) <= 1.0:
            os.replace(restored, BASE_MP3)
            return
        restored.unlink(missing_ok=True)

    raise RuntimeError(
        "The current stream is already extended and the original two-hour master "
        "is not available in Git history. Restore the base stream before rebuilding."
    )


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    GENERATED.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not STREAM.is_file():
        raise FileNotFoundError(STREAM)

    # Preserve the source master once and fail closed instead of double-appending.
    ensure_base_master(float(manifest["baseDurationSeconds"]))

    dialogue = manifest["dialogue"]
    if len(dialogue) != 10:
        raise ValueError(f"Expected exactly 10 dialogue chapters, found {len(dialogue)}")
    for entry in dialogue:
        turns = entry.get("turns", [])
        if len(turns) != 2 or len({turn["speaker"] for turn in turns}) != 2:
            raise ValueError(f"{entry['id']} must have exactly two distinct hosts")
    interludes = {int(item["after"]): item for item in manifest["interludes"]}
    chapters = []
    cursor = float(manifest["baseDurationSeconds"])

    with wave.open(str(EXTENSION_WAV), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(SR)

        opening_duration = float(manifest["openingSeconds"])
        opening = render_instrumental("opening", opening_duration)
        chapters.append({
            "start": round(cursor, 2), "end": round(cursor + len(opening) / SR, 2),
            "title": "موسیقی اختصاصی — آغاز گفت‌وگو", "kind": "music",
        })
        write_audio(writer, opening)
        cursor += len(opening) / SR

        for index, entry in enumerate(dialogue, start=1):
            if index > 1 and (index - 1) not in interludes:
                pause = float(manifest["naturalPauseSeconds"])
                write_pause(writer, pause)
                cursor += pause

            talk = render_conversation(entry, index, float(manifest["turnPauseSeconds"]))
            speakers = [turn["speaker"] for turn in entry["turns"]]
            talk_seconds = len(talk) / SR
            chapters.append({
                "start": round(cursor, 2), "end": round(cursor + talk_seconds, 2),
                "title": entry["title"], "kind": "talk", "speakers": speakers,
            })
            write_audio(writer, talk)
            cursor += talk_seconds

            interlude = interludes.get(index)
            if interlude:
                seconds = float(manifest["interludeSeconds"])
                music = render_instrumental(interlude["music"], seconds)
                chapters.append({
                    "start": round(cursor, 2), "end": round(cursor + len(music) / SR, 2),
                    "title": interlude["title"], "kind": "music",
                })
                write_audio(writer, music)
                cursor += len(music) / SR

        outro_seconds = float(manifest["outroSeconds"])
        outro = render_instrumental("outro", outro_seconds)
        chapters.append({
            "start": round(cursor, 2), "end": round(cursor + len(outro) / SR, 2),
            "title": "موسیقی اختصاصی — پایان برنامه", "kind": "music",
        })
        write_audio(writer, outro)
        cursor += len(outro) / SR

    with CHAPTERS_OUT.open("w", encoding="utf-8") as handle:
        json.dump({"totalDuration": round(cursor, 2), "chapters": chapters}, handle, ensure_ascii=False, indent=2)

    # Re-encode once at the radio's existing 48 kbps mono stream rate. The
    # app still has one same-origin MP3 URL and keeps Range-based seeking.
    ff(
        "-i", BASE_MP3,
        "-i", EXTENSION_WAV,
        "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]",
        "-map", "[out]",
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "48k",
        "-ar", SR,
        "-ac", 1,
        "-metadata", "title=FBT Radio — Crypto conversations",
        "-metadata", "artist=FBT Radio",
        "-metadata", "album=FBT Radio",
        "-metadata", "comment=Original FBT Radio music and Persian educational dialogue",
        "-id3v2_version", 3,
        OUTPUT_TMP,
    )
    os.replace(OUTPUT_TMP, STREAM)

    print(json.dumps({
        "stream": str(STREAM),
        "totalDuration": round(cursor, 2),
        "addedSeconds": round(cursor - float(manifest["baseDurationSeconds"]), 2),
        "sizeBytes": STREAM.stat().st_size,
        "chapters": chapters,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
