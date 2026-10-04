/* ==========================================================================
   tools/render-all.mjs — the parallel pass
   --------------------------------------------------------------------------
   The film is 14 400 frames. On the two-core sandbox this project was built
   in, one worker needs about two hours; the work splits perfectly along
   segment boundaries, so this runs N workers over disjoint second-ranges and
   merges their outputs into one ordered segment list.

   Two honest constraints shaped the defaults:
     · rasterisation is CPU-bound, so more workers than cores buys little;
     · each worker holds a 4K browser, so RAM, not CPU, is the real ceiling —
       3 workers is the safe maximum on a 3 GB machine.

   Usage: node tools/render-all.mjs --workers 3 --segment 30
   ========================================================================== */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const WORKERS = Number(arg('workers', 3));
const SEGMENT = Number(arg('segment', 30));
const SCALE = Number(arg('scale', 1));
const CRF = arg('crf', '12');
const GRADE = arg('grade', '0') === '1' ? ['--grade', '1'] : [];
const DURATION = Number(arg('duration', 600));
const WORK = arg('work', '/home/user/film-work');
const OUT = path.join(WORK, 'segments');
const LOGS = path.join(WORK, 'logs');

await fsp.mkdir(OUT, { recursive: true });
await fsp.mkdir(LOGS, { recursive: true });

/* Split the timeline into balanced blocks. Blocks are multiples of the
   segment length so every worker produces whole, independently decodable
   files and a stopped worker never corrupts a neighbour's output. */
const totalSegs = Math.ceil(DURATION / SEGMENT);
const perWorker = Math.ceil(totalSegs / WORKERS);
const jobs = [];
for (let w = 0; w < WORKERS; w++) {
  const from = w * perWorker * SEGMENT;
  const to = Math.min(DURATION, (w + 1) * perWorker * SEGMENT);
  if (from >= to) break;
  jobs.push({ w, from, to, port: 8200 + w, log: path.join(LOGS, `worker-${w}.log`) });
}

console.log(`[render-all] ${WORKERS} workers · ${totalSegs} segments of ${SEGMENT}s · ${1920 * SCALE}x${1080 * SCALE} · grade ${GRADE.length ? 'on' : 'off'}`);
for (const j of jobs) console.log(`   worker ${j.w}: ${j.from}s → ${j.to}s  (log: ${path.basename(j.log)})`);

const children = jobs.map((j) => {
  const log = fs.createWriteStream(j.log, { flags: 'a' });
  const p = spawn(process.execPath, [
    path.join(HERE, 'render.mjs'),
    '--from', String(j.from), '--to', String(j.to),
    '--segment', String(SEGMENT), '--scale', String(SCALE),
    '--crf', String(CRF), '--port', String(j.port), '--out', OUT,
    '--lite', '1', ...GRADE
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  return { ...j, proc: p };
});

const report = () => {
  const line = children.map((c) => `w${c.w}:${c.proc.exitCode === null ? 'run' : c.proc.exitCode}`).join(' ');
  process.stdout.write(`[render-all] ${line}\n`);
};
const timer = setInterval(report, 60000);

const results = await Promise.all(children.map((c) => new Promise((res) => {
  c.proc.on('exit', (code) => res({ ...c, code }));
})));

clearInterval(timer);
const failed = results.filter((r) => r.code !== 0);
for (const r of results) console.log(`[render-all] worker ${r.w} exited ${r.code} (${r.from}-${r.to}s)`);

/* Merge the per-worker segment lists into one ordered list. The renderer
   writes its own list, so the merge is by filename order — deterministic. */
const files = (await fsp.readdir(OUT)).filter((f) => /^seg_\d+_\d+-\d+\.mp4$/.test(f))
  .sort((a, b) => Number(/_([0-9]+)-/.exec(a)[1]) - Number(/_([0-9]+)-/.exec(b)[1]));
await fsp.writeFile(path.join(OUT, 'segments.json'), JSON.stringify(files, null, 2));
console.log(`[render-all] ${files.length} segments present · ${failed.length ? 'FAILED WORKERS: ' + failed.map((f) => f.w).join(', ') : 'all workers clean'}`);
process.exit(failed.length ? 1 : 0);
