#!/usr/bin/env python3
"""Sync all radio players and chapter exports to the latest mixed master."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "radio_build" / "generated"
MANIFEST = ROOT / "radio_build" / "dialogue_2026-11-fa.json"
CHAPTERS_JSON = GENERATED / "dialogue-chapters.json"

BASE_CHAPTERS = [
    (9, "معرفی رادیو FBT"),
    (637.08, "کریپتو چیست؟"),
    (690.56, "بیت‌کوین، پادشاه بازار"),
    (740.36, "اتریوم و آلت‌کوین‌ها"),
    (1120.42, "مصاحبه: ساختار بازار"),
    (1223.98, "رادار نهنگ‌ها"),
    (2080.05, "اخبار داغ کریپتو"),
    (2132.05, "آینده کریپتو"),
    (2470.53, "استیبل‌کوین و دیفای"),
    (2528.17, "ان‌اف‌تی و متاورس"),
    (2584.85, "آموزش ترید"),
    (2640.17, "امنیت کیف پول"),
]


def fa_digits(value: str | int) -> str:
    digits = "۰۱۲۳۴۵۶۷۸۹"
    return re.sub(r"\d", lambda match: digits[int(match.group())], str(value))


def clock(seconds: float, *, hours: bool = True) -> str:
    total = max(0, int(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if hours or h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def cue_clock(seconds: float) -> str:
    """Format an INDEX timestamp as CUE's MM:SS:FF (75 CD frames per second)."""
    total_frames = max(0, int(round(seconds * 75)))
    minutes, remainder = divmod(total_frames, 75 * 60)
    whole_seconds, frames = divmod(remainder, 75)
    return f"{minutes:02d}:{whole_seconds:02d}:{frames:02d}"


def radio_clock(seconds: float) -> str:
    total = max(0, int(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def replace_one(text: str, pattern: str, replacement: str, path: Path) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected one metadata block in {path}; found {count}")
    return result


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    audio_meta = json.loads(CHAPTERS_JSON.read_text(encoding="utf-8"))
    duration = float(audio_meta["totalDuration"])
    base_duration = float(manifest["baseDurationSeconds"])
    added = round(duration - base_duration)
    minutes, seconds = divmod(added, 60)
    duration_clock = clock(duration)
    duration_fa = fa_digits(radio_clock(duration))
    duration_hours = int(duration // 3600)
    duration_minutes = int((duration % 3600) // 60)
    duration_label_fa = fa_digits(f"{duration_hours} ساعت و {duration_minutes} دقیقه")
    duration_phrase_fa = duration_label_fa + "‌ای"
    version = f"20261127-dialogue-v{manifest['version']}"
    chapters = audio_meta["chapters"]

    # React player metadata: original highlights plus the ten new talk chapters.
    talk_chapters = [
        {"t": chapter["start"], "label": chapter["title"]}
        for chapter in chapters if chapter.get("kind") == "talk"
    ]
    metadata = [
        "/* Static metadata for the versioned, single-stream FBT Radio master. */",
        f"export const FBT_RADIO_DURATION_SECONDS = {duration:.2f};",
        f"export const FBT_RADIO_DURATION_LABEL = '{duration_label_fa}';",
        f"export const FBT_RADIO_TOPIC_COUNT = {len(talk_chapters)};",
        "",
        "/** The app box highlights the original editorial chapters plus the new lessons. */",
        "export const FBT_RADIO_CHAPTERS = Object.freeze([",
    ]
    for index, (start, title) in enumerate(BASE_CHAPTERS + [(c["t"], c["label"]) for c in talk_chapters]):
        comma = "," if index < len(BASE_CHAPTERS) + len(talk_chapters) - 1 else ""
        metadata.append(f"  {{ t: {start}, label: {json.dumps(title, ensure_ascii=False)} }}{comma}")
    metadata.append("]);")
    (ROOT / "src/lib/fbtRadioMetadata.js").write_text("\n".join(metadata) + "\n", encoding="utf-8")

    # Standalone web player: chapter list, fallback duration, cache-busted master.
    player_path = ROOT / "radio_fbt.html"
    player = player_path.read_text(encoding="utf-8")
    chapters_js = json.dumps(chapters, ensure_ascii=False, separators=(",", ":"))
    player = replace_one(
        player,
        r"const EXT_CHAPTERS = .*?;\nconst DEFAULT_DURATION = [^;]+;",
        f"const EXT_CHAPTERS = {chapters_js};\nconst DEFAULT_DURATION = {duration:.2f};",
        player_path,
    )
    player = re.sub(r'(<span id="dur">)[^<]+', rf"\g<1>{duration_clock}", player)
    player = re.sub(r'(<span class="chip">⏱ مدت <b>)[^<]+', rf"\g<1>{duration_fa}", player)
    player = re.sub(r"۲ ساعت و \d+ دقیقه‌ای", duration_phrase_fa, player)
    player = re.sub(r"fbt-radio-2h\.mp3\?v=[^\"']+", f"fbt-radio-2h.mp3?v={version}", player)
    player_path.write_text(player, encoding="utf-8")

    # Design preview and app audio URL.
    preview_path = ROOT / "fbt-radio-box-preview.html"
    preview = preview_path.read_text(encoding="utf-8")
    preview = re.sub(r"(const DEFAULT_DURATION=)[^;]+;", rf"\g<1>{duration:.2f};", preview)
    preview = re.sub(r'(<span class="fbr-remain" id="rem">)−[^<]+', rf"\g<1>−{duration_fa}", preview)
    preview = re.sub(r'(<span id="dur">)[^<]+', rf"\g<1>{duration_fa}", preview)
    preview = re.sub(r"۲ ساعت و \d+ دقیقه‌ای", duration_phrase_fa, preview)
    preview = re.sub(r'(<span class="fbr-chip">)۲ ساعت و \d+ دقیقه(</span>)', rf"\g<1>{duration_label_fa}\g<2>", preview)
    preview = re.sub(r"fbt-radio-2h\.mp3\?v=[^\"']+", f"fbt-radio-2h.mp3?v={version}", preview)
    preview_chapters = BASE_CHAPTERS + [(c["t"], c["label"]) for c in talk_chapters]
    preview_js = "const CHAPTERS=[\n" + ",\n".join(
        f" [{start},{json.dumps(title, ensure_ascii=False)}]"
        for start, title in preview_chapters
    ) + "\n];"
    preview = replace_one(
        preview,
        r"const CHAPTERS=\[.*?\];",
        preview_js,
        preview_path,
    )
    preview_path.write_text(preview, encoding="utf-8")

    engine_path = ROOT / "src/lib/fbtRadioEngine.js"
    engine = engine_path.read_text(encoding="utf-8")
    engine = re.sub(r"fbt-radio-2h\.mp3\?v=[^'\"]+", f"fbt-radio-2h.mp3?v={version}", engine)
    engine_path.write_text(engine, encoding="utf-8")

    # Human-readable chapter sheet with second-level offsets.
    chapter_path = ROOT / "FBT_Radio_2Hours_chapters.txt"
    chapter_text = chapter_path.read_text(encoding="utf-8")
    chapter_text = re.sub(r"FBT RADIO — پخش ۲ ساعت و \d+ دقیقه‌ای دنیای کریپتو", f"FBT RADIO — پخش {duration_phrase_fa} دنیای کریپتو", chapter_text, count=1)
    marker = "فصل گفت‌وگوی آموزشی تازه"
    prefix = chapter_text.split(marker, 1)[0]
    lines = [f"{marker} — ۱۰ موضوع، دو میزبان، موسیقی اختصاصیِ تازه:"]
    for chapter in chapters:
        icon = "🎵" if chapter.get("kind") == "music" else "🎙"
        lines.append(f"{clock(float(chapter['start']))}  {icon}  {chapter['title']}")
    chapter_path.write_text(prefix.rstrip() + "\n\n\n" + "\n".join(lines) + "\n", encoding="utf-8")

    # CUE tracks 43 onward mirror each appended talk and instrumental chapter.
    cue_path = ROOT / "FBT_Radio_2Hours.cue"
    cue_text = cue_path.read_text(encoding="utf-8")
    cue_text = re.sub(r'TITLE "FBT Radio — پخش ۲ ساعت و \d+ دقیقه‌ای دنیای کریپتو"', f'TITLE "FBT Radio — پخش {duration_phrase_fa} دنیای کریپتو"', cue_text, count=1)
    cue_prefix = cue_text.split("  TRACK 43 AUDIO", 1)[0]
    def normalize_cue_index(match: re.Match[str]) -> str:
        hours, minutes, seconds, milliseconds = map(int, match.groups())
        absolute = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
        return f"INDEX 01 {cue_clock(absolute)}"
    cue_prefix = re.sub(
        r"INDEX 01 (\d+):(\d{2}):(\d{2})\.(\d{3})",
        normalize_cue_index,
        cue_prefix,
    )
    cue_tracks = []
    for number, chapter in enumerate(chapters, start=43):
        cue_tracks.extend([
            f"  TRACK {number:02d} AUDIO",
            f"    TITLE \"{chapter['title']}\"",
            "    PERFORMER \"FBT Radio\"",
            f"    INDEX 01 {cue_clock(float(chapter['start']))}",
        ])
    cue_path.write_text(cue_prefix.rstrip() + "\n" + "\n".join(cue_tracks) + "\n", encoding="utf-8")

    # Playlist and README duration strings.
    playlist_path = ROOT / "playlist.m3u"
    playlist = playlist_path.read_text(encoding="utf-8")
    playlist = re.sub(r"#EXTINF:\d+,.*", f"#EXTINF:{int(duration)},FBT Radio — {clock(duration)} Crypto Broadcast", playlist, count=1)
    playlist_path.write_text(playlist, encoding="utf-8")

    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    readme = re.sub(r"# 📻 رادیو FBT — پخش .* دنیای کریپتو", f"# 📻 رادیو FBT — پخش {duration_phrase_fa} دنیای کریپتو", readme, count=1)
    readme = re.sub(r"(\| `public/radio/fbt-radio-2h\.mp3` \| \*\*)[^*]+(\*\* \|)", rf"\g<1>{duration_fa}\g<2>", readme, count=1)
    added_label = f"{fa_digits(minutes)} دقیقه و {fa_digits(seconds)} ثانیه"
    readme = re.sub(r"- \*\*مدت فعلی:\*\* .*", f"- **مدت فعلی:** {added_label} به برنامه افزوده شده؛ فایل فعلی {duration_fa} است.", readme, count=1)
    readme = re.sub(r"۲ ساعت و \d+ دقیقه‌ای", duration_phrase_fa, readme)
    readme = re.sub(r"\?v=20261127-dialogue(?:-v\d+)*", f"?v={version}", readme)
    readme_path.write_text(readme, encoding="utf-8")

    print(json.dumps({"duration": duration, "durationLabel": duration_clock, "addedSeconds": added, "cacheVersion": version}, ensure_ascii=False))


if __name__ == "__main__":
    main()
