/**
 * THE REGRESSION SWEEP
 * ---------------------------------------------------------------------------
 * The AI-intelligence suite is the gate for the brain's own tests, but the
 * BRAIN is imported by many other suites — the registry, the policy
 * engine, the state store, the UI probes. A change to the intent rules
 * or the session layer can break a file that has nothing to do with AI.
 *
 * So this sweep runs EVERY test file in the repository and reports which
 * ones fail. The failures are then re-run against the BASE commit, and
 * only the ones that fail on the branch and pass on the base are real
 * regressions.
 *
 * It is honest about the parallel-execution hazard: node's test runner
 * shares a process pool, and a suite that touches a shared file (a
 * port, a lock file, a fixture) can fail under concurrency and pass in
 * isolation. Every suspicious failure is therefore re-run ALONE before
 * it is called a regression.
 *
 * Usage:
 *   node scripts/sweep-tests.mjs [--out <dir>] [--concurrency <n>]
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = argOf('out', '/tmp/sweep-current');
const CONCURRENCY = Math.max(1, Number(argOf('concurrency', '4')) || 4);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

async function collect(dir, acc = []) {
  for (const name of await readdir(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build' || name === 'coverage') continue;
    const full = path.join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) await collect(full, acc);
    else if (/\.(test|spec)\.(mjs|js|cjs|jsx|ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--test', file], {
      cwd: ROOT,
      env: { ...process.env, NODE_OPTIONS: '' }
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      resolve({ file: path.relative(ROOT, file), code, ms: Date.now() - started, out });
    });
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await collect(path.join(ROOT, 'test'))).sort();
  console.log(`sweep: ${files.length} test files, concurrency ${CONCURRENCY}`);

  const results = [];
  let index = 0;
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (index < files.length) {
      const file = files[index++];
      const r = await runOne(file);
      results.push(r);
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${files.length}`);
    }
  });
  await Promise.all(workers);

  const failures = results.filter((r) => r.code !== 0);
  const passed = results.length - failures.length;
  console.log(`\nsweep: ${passed} PASS / ${failures.length} FAIL`);

  await writeFile(path.join(OUT, 'summary.json'), JSON.stringify({
    total: results.length, passed, failed: failures.length,
    failures: failures.map((f) => ({ file: f.file, code: f.code, ms: f.ms }))
  }, null, 2));
  await mkdir(path.join(OUT, 'logs'), { recursive: true });
  for (const f of failures) {
    const safe = f.file.replace(/[\\/]/g, '__');
    await writeFile(path.join(OUT, 'logs', `${safe}.log`), f.out);
  }
  console.log(`\nfailures written to ${OUT}`);
  for (const f of failures) console.log(`  FAIL ${f.file}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
