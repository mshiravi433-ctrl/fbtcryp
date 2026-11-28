import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FBT_RADIO_CHAPTERS,
  FBT_RADIO_DURATION_LABEL,
  FBT_RADIO_DURATION_SECONDS,
  FBT_RADIO_TOPIC_COUNT
} from '../src/lib/fbtRadioMetadata.js';
import { publishRadioStandaloneFiles } from '../radio_build/publish_standalone.mjs';

const manifest = JSON.parse(readFileSync(new URL('../radio_build/dialogue_2026-11-fa.json', import.meta.url), 'utf8'));
const player = readFileSync(new URL('../src/components/FbtRadioBox.jsx', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../src/lib/fbtRadioEngine.js', import.meta.url), 'utf8');
const standalone = readFileSync(new URL('../radio_fbt.html', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../fbt-radio-box-preview.html', import.meta.url), 'utf8');
const cue = readFileSync(new URL('../FBT_Radio_2Hours.cue', import.meta.url), 'utf8');
const chapterExportPath = new URL('../FBT_Radio_2Hours_chapters.txt', import.meta.url);
const streamPath = new URL('../public/radio/fbt-radio-2h.mp3', import.meta.url);
const standaloneDurationMatch = standalone.match(/const DEFAULT_DURATION = ([\d.]+);/);

test('the master duration and highlighted chapters describe the extended stream', () => {
  assert.ok(FBT_RADIO_DURATION_SECONDS > 8000);
  const toFaDigits = (value) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  const hours = Math.floor(FBT_RADIO_DURATION_SECONDS / 3600);
  const minutes = Math.floor((FBT_RADIO_DURATION_SECONDS % 3600) / 60);
  assert.equal(FBT_RADIO_DURATION_LABEL, `${toFaDigits(hours)} ساعت و ${toFaDigits(minutes)} دقیقه`);
  assert.equal(FBT_RADIO_TOPIC_COUNT, 10);
  assert.ok(standaloneDurationMatch, 'standalone player has a fallback duration');
  assert.equal(Number(standaloneDurationMatch[1]), FBT_RADIO_DURATION_SECONDS);

  const newChapters = FBT_RADIO_CHAPTERS.filter((chapter) => chapter.t >= 7200);
  assert.equal(newChapters.length, 10);
  assert.ok(newChapters.every((chapter, i) => i === 0 || chapter.t > newChapters[i - 1].t));
  assert.ok(newChapters.at(-1).t < FBT_RADIO_DURATION_SECONDS);
});

test('all ten requested subjects are two-host conversations', () => {
  const expected = [
    'تاریخچه کریپتو',
    'شناخت ترید و نمودار شمعی',
    'ونوم و dYdX',
    'سواپ و سیگنال',
    'والت، والت‌کانکت و نگهداری امن',
    'شبکه‌ها و تفاوت‌هایشان',
    'فارم و شرایط استفاده',
    'FBT جهانی و اسمارت‌مانی',
    'فیوچرز و تفاوت تب‌ها',
    'استفاده از سفارش خودکار'
  ];
  assert.deepEqual(manifest.dialogue.map((chapter) => chapter.title), expected);

  assert.equal(manifest.version, 6);
  assert.equal(manifest.dialogue.length, 10);
  assert.ok(manifest.turnPauseSeconds >= 0.4, 'hosts have room for a natural conversational pause');
  const expectedSpeakerOrder = [
    ['امیر', 'رها'], ['رها', 'امیر'], ['امیر', 'رها'], ['رها', 'امیر'], ['رها', 'امیر'],
    ['رها', 'امیر'], ['امیر', 'رها'], ['رها', 'امیر'], ['امیر', 'رها'], ['رها', 'امیر']
  ];
  for (const [index, chapter] of manifest.dialogue.entries()) {
    assert.equal(chapter.turns.length, 2, `${chapter.id} has two turns`);
    assert.notEqual(chapter.turns[0].speaker, chapter.turns[1].speaker);
    assert.deepEqual(chapter.turns.map((turn) => turn.speaker), expectedSpeakerOrder[index]);
    assert.ok(chapter.turns.every((turn) => turn.audio.includes('fbt-radio-dialogue-v6-') && turn.audio.endsWith('.mp3')));
  }
  assert.equal(manifest.interludes.length, 4);
  assert.equal(new Set(manifest.dialogue.map((chapter) => chapter.music)).size, 10);
});

test('the app and both player pages request the current version and expose synced chapters', () => {
  assert.match(engine, /fbt-radio-2h\.mp3\?v=20261127-dialogue-v6/);
  assert.match(player, /FBT_RADIO_CHAPTERS/);
  assert.match(player, /FBT_RADIO_TOPIC_COUNT/);
  for (const chapter of manifest.dialogue) {
    assert.ok(standalone.includes(chapter.title), `standalone page includes ${chapter.title}`);
  }
  assert.match(standalone, /CH\.push\(\.\.\.EXT_CHAPTERS\)/);

  const previewPairs = preview.split(String.fromCharCode(10)).flatMap((line) => {
    let row = line.trim();
    if (row.endsWith(',')) row = row.slice(0, -1);
    if (!row.startsWith('[') || !row.endsWith(']')) return [];
    try {
      const pair = JSON.parse(row);
      return Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'number' && typeof pair[1] === 'string'
        ? [pair]
        : [];
    } catch {
      return [];
    }
  });
  for (const chapter of FBT_RADIO_CHAPTERS.filter((item) => item.t >= 7200)) {
    assert.ok(
      previewPairs.some(([time, title]) => time === chapter.t && title === chapter.label),
      `design preview has the current offset for ${chapter.label}`
    );
  }
});

test('the production output includes the standalone player and its chapter download', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'fbt-radio-output-'));
  try {
    const emitted = publishRadioStandaloneFiles(outDir);
    assert.deepEqual(emitted, ['radio_fbt.html', 'FBT_Radio_2Hours_chapters.txt']);

    const deployedPlayer = readFileSync(join(outDir, 'radio_fbt.html'), 'utf8');
    assert.match(deployedPlayer, /20261127-dialogue-v6/);
    assert.match(deployedPlayer, /src="\/radio\/fbt-radio-cover\.jpg"/);
    assert.match(deployedPlayer, /href="FBT_Radio_2Hours_chapters\.txt"/);
    assert.equal(
      readFileSync(join(outDir, 'FBT_Radio_2Hours_chapters.txt'), 'utf8'),
      readFileSync(chapterExportPath, 'utf8')
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the CUE export uses frame-accurate timestamps for all chapters', () => {
  const lines = cue.split(String.fromCharCode(10)).map((line) => line.trim());
  assert.equal(lines.filter((line) => line.startsWith('TRACK ') && line.endsWith(' AUDIO')).length, 58);
  const indexes = lines.filter((line) => line.startsWith('INDEX 01 ')).map((line) => line.slice('INDEX 01 '.length));
  assert.equal(indexes.length, 58);

  let priorSeconds = -1;
  for (const index of indexes) {
    const parts = index.split(':').map(Number);
    assert.equal(parts.length, 3, `CUE timestamp has MM:SS:FF format: ${index}`);
    const [minutes, seconds, frames] = parts;
    assert.ok(Number.isInteger(minutes) && minutes >= 0);
    assert.ok(Number.isInteger(seconds) && seconds >= 0 && seconds < 60);
    assert.ok(Number.isInteger(frames) && frames >= 0 && frames < 75);
    const position = minutes * 60 + seconds + frames / 75;
    assert.ok(position > priorSeconds, `CUE index ${index} follows the previous chapter`);
    priorSeconds = position;
  }
  assert.ok(priorSeconds < FBT_RADIO_DURATION_SECONDS);
});

test('the shipped radio master is an MP3 large enough to include the added broadcast', () => {
  const stats = statSync(streamPath);
  const header = readFileSync(streamPath).subarray(0, 3).toString('ascii');
  assert.equal(header, 'ID3');
  assert.ok(stats.size > 45_000_000);
});
