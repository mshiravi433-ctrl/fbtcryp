/*
 * Load the vendored Kamino bundle in a REAL browser engine, over HTTP,
 * exactly the way the app does it: a dynamic `import()` of
 * /vendor/kamino-klend-sdk.js?v=<rev> from a page served on an origin.
 *
 * ─── WHY THIS EXISTS NEXT TO check-kamino-bundle.mjs ───────────────────────
 * The Node check hides the Node globals, which is most of the way there — but
 * it is still Node's module loader. The bug this harness caught on 2026-09-22
 * (the shipped bundle threw `ReferenceError: Buffer is not defined` in every
 * browser, behind «KAMINO_SDK_FAILED») needed a real engine to reproduce at
 * all, because Node ALWAYS has a global Buffer.
 *
 * Run it before shipping any change to scripts/vendor-kamino.mjs:
 *
 *     node scripts/check-kamino-browser.mjs            # public/vendor, locally served
 *     node scripts/check-kamino-browser.mjs --dir dist # the built app instead
 *
 * Browsers, in order of preference:
 *   1. `puppeteer` (a devDependency here) with its own downloaded Chromium.
 *   2. `@sparticuz/chromium` + `puppeteer-core` (a self-contained Chromium,
 *      used here for sandboxes with no browser cache: npm i -D @sparticuz/chromium puppeteer-core).
 * With neither installed the script reports SKIPPED and exits 0 (it must never
 * be the reason a build fails on a machine that has no browser at all); pass
 * --strict to make a missing browser a failure.
 */
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';


const args = process.argv.slice(2);
const strict = args.includes('--strict');
const dirIndex = args.indexOf('--dir');
const dir = resolve(dirIndex === -1 ? 'public' : (args[dirIndex + 1] || 'public'));
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8'
};

function skip(reason) {
  console.log(`… kamino browser check SKIPPED: ${reason}`);
  process.exit(strict ? 1 : 0);
}

/* ─── pick a browser ─────────────────────────────────────────────────────── */
let puppeteer = null;
let executablePath = null;
let launchEnv = process.env;
const extraArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
try {
  puppeteer = (await import('puppeteer')).default;
  try { executablePath = puppeteer.executablePath(); } catch { executablePath = null; }
  if (!executablePath || !existsSync(executablePath)) { puppeteer = null; executablePath = null; }
} catch { puppeteer = null; }

if (!puppeteer) {
  try {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    puppeteer = (await import('puppeteer-core')).default;
    executablePath = await sparticuz.executablePath();
    /* The shared libraries it depends on ship INSIDE the package (bin/), not
       next to the unpacked binary — walk up from its entry point to find them. */
    const pkgBin = (() => {
      let dir = dirname(createRequire(import.meta.url).resolve('@sparticuz/chromium'));
      for (let i = 0; i < 4; i += 1) {
        if (existsSync(join(dir, 'bin', 'al2023.tar.br'))) return join(dir, 'bin');
        if (existsSync(join(dir, 'al2023.tar.br'))) return dir;
        dir = dirname(dir);
      }
      return join(dir, 'bin');
    })();
    /* That Chromium is built for Amazon Linux: unpack the shared libraries it
       ships next to the binary and point the loader at them, which is what
       makes it runnable on a generic Linux sandbox. */
    const libs = mkdtempSync(join(tmpdir(), 'kamino-chromium-libs-'));
    const archive = join(pkgBin, 'al2023.tar.br');
    if (existsSync(archive)) {
      const tarFile = join(libs, 'libs.tar');
      writeFileSync(tarFile, brotliDecompressSync(readFileSync(archive)));
      execFileSync('tar', ['-xf', tarFile, '-C', libs], { stdio: 'ignore' });
    }
    launchEnv = { ...process.env, LD_LIBRARY_PATH: `${join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` };
    if (Array.isArray(sparticuz.args)) extraArgs.push(...sparticuz.args);
  } catch (error) {
    puppeteer = null;
    skip(`no Chromium available (${String(error?.message || error).slice(0, 90)}). Install with: npm i -D @sparticuz/chromium puppeteer-core`);
  }
}

const bundle = join(dir, 'vendor', 'kamino-klend-sdk.js');
if (!existsSync(bundle)) skip(`no vendor bundle at ${bundle} — run "npm run vendor:kamino" first`);

/* The cache-buster the app will use, read from the emitted manifest so this
   harness cannot drift from VENDOR_REV / KAMINO_VENDOR_REV. */
let rev = '3';
try { rev = String(JSON.parse(readFileSync(join(dir, 'vendor', 'kamino-klend-sdk.manifest.json'), 'utf8')).rev || rev); } catch { /* manifest is optional */ }

/* ─── serve the directory the way the app's server does ──────────────────── */
const PORT = Number(process.env.KAMINO_CHECK_PORT || 8931);
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(String(req.url || '/').split('?')[0]);
  const file = join(dir, path);
  if (existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }
  /* The SPA fallback every one of our servers has: a missing file answers
     200 + index.html. That is the OTHER way this module fails in production,
     so it is deliberately part of the fixture. */
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><body><div id="root"></div>' + '<!--pad-->'.repeat(200) + '</body></html>');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await puppeteer.launch({
  args: [...new Set(extraArgs)],
  executablePath,
  env: launchEnv,
  headless: true
});

try {
  const page = await browser.newPage();
  const result = await page.evaluate(async (url) => {
    try {
      const mod = await import(url);
      return {
        ok: typeof mod.KaminoMarket?.load === 'function'
          && typeof mod.KaminoAction?.buildDepositTxns === 'function'
          && String(mod.PROGRAM_ID || '').length > 32,
        exports: {
          KaminoMarket: typeof mod.KaminoMarket,
          KaminoAction: typeof mod.KaminoAction,
          VanillaObligation: typeof mod.VanillaObligation,
          PROGRAM_ID: String(mod.PROGRAM_ID || '')
        },
        bufferInstalled: typeof globalThis.Buffer?.from === 'function'
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300) };
    }
  }, `http://127.0.0.1:${PORT}/vendor/kamino-klend-sdk.js?v=${rev}`);

  if (result.ok && result.bufferInstalled) {
    console.log(`✓ kamino bundle starts in a real browser: ${JSON.stringify(result.exports)}`);
  } else {
    console.error(`✗ kamino bundle FAILED in a real browser: ${result.error || JSON.stringify(result)}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}
