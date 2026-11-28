import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(ROOT, 'dist');
const playerPath = resolve(dist, 'radio_fbt.html');
const chapterPath = resolve(dist, 'FBT_Radio_2Hours_chapters.txt');
const streamPath = resolve(dist, 'radio/fbt-radio-2h.mp3');
const coverPath = resolve(dist, 'radio/fbt-radio-cover.jpg');
const player = readFileSync(playerPath, 'utf8');

assert.match(player, /20261127-dialogue-v5/, 'standalone page is the current radio version');
assert.match(player, /src="\/radio\/fbt-radio-cover\.jpg"/, 'cover resolves from the public radio directory');
assert.match(player, /href="FBT_Radio_2Hours_chapters\.txt"/, 'chapter download link resolves beside the page');
assert.equal(
  readFileSync(chapterPath, 'utf8'),
  readFileSync(resolve(ROOT, 'FBT_Radio_2Hours_chapters.txt'), 'utf8'),
  'deployed chapter export matches the source chapter listing'
);

for (const [builtPath, sourcePath] of [
  [streamPath, resolve(ROOT, 'public/radio/fbt-radio-2h.mp3')],
  [coverPath, resolve(ROOT, 'public/radio/fbt-radio-cover.jpg')]
]) {
  assert.equal(
    statSync(builtPath).size,
    statSync(sourcePath).size,
    `${builtPath.slice(dist.length + 1)} is present with the source byte length`
  );
}

console.log('✓ standalone radio page, chapter export, MP3 and cover are present in dist');
