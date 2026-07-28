/**
 * END-TO-END BOOT TEST — the actual bug this round.
 *
 * Reproduces the reported symptom ("it just spins and scrolls, nothing loads")
 * by serving the real built app with every external host black-holed, the way
 * a restricted ISP behaves: packets vanish, connections hang, nothing RSTs.
 *
 * Two harnesses:
 *   A. static  — parses the shipped dist/index.html and asserts nothing in
 *                <head> can block the parser.
 *   B. runtime — executes the whole real app (built as one classic script,
 *                because jsdom has no ES-module support) under those same
 *                dead-network conditions and asserts React paints anyway.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import jsdomPkg from '../node_modules/jsdom/lib/api.js';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdomPkg;
const results = [];
const check = (name, ok) => results.push([name, Boolean(ok)]);

/* ---------------------------- A. static checks ---------------------------- */

const shipped = fs.readFileSync(path.resolve('dist/index.html'), 'utf8');
const sdom = new JSDOM(shipped);
const head = sdom.window.document.head;

const headLinks = [...head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
const headScripts = [...head.querySelectorAll('script[src]')];

check('head has no stylesheet from a third-party host',
  headLinks.every((h) => h.startsWith('/') || h.startsWith('./')));
check('head has no render-blocking script[src]',
  headScripts.every((s) => s.async || s.defer || s.type === 'module'));
check('fonts are served from our own origin',
  /url\('\/fonts\/Vazirmatn-var\.woff2'\)/.test(shipped));
check('font files exist in dist',
  fs.existsSync('dist/fonts/Vazirmatn-var.woff2') && fs.existsSync('dist/fonts/JetBrainsMono-var.woff2'));
check('boot watchdog present', /__FBT_BOOTED__/.test(shipped) && /data-failed/.test(shipped));

/* ------------------------- B. runtime under blackout ---------------------- */

const distDir = path.resolve('test/.out/iife');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(distDir, url === '/' ? 'index.html' : url);
  if (!file.startsWith(distDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(file);
  res.writeHead(200, { 'content-type': ext === '.css' ? 'text/css' : 'text/javascript' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// The real index.html, but with the module script swapped for the classic
// bundle. Everything else — the async Telegram tag, the watchdog, the
// @font-face rules — is byte-for-byte what ships.
const page = shipped.replace(
  /<script type="module"[^>]*><\/script>/,
  `<script src="${base}/app.js"></script>`
).replace(/<link rel="stylesheet"[^>]*>/g, '');

const blocked = [];
const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', (e) => jsErrors.push(e.message));

const dom = new JSDOM(page, {
  url: 'https://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  resources: {
    interceptors: [
      requestInterceptor(async (request) => {
        if (request.url.startsWith(base)) return undefined;
        blocked.push(request.url);
        await new Promise(() => {}); // hang forever, like a black-holed route
      })
    ]
  }
});

await new Promise((r) => setTimeout(r, 4000));

const doc = dom.window.document;
const root = doc.getElementById('root');
const boot = doc.getElementById('boot');
const text = (root?.textContent || '').replace(/\s+/g, ' ').trim();

check('telegram SDK was requested asynchronously', blocked.some((u) => u.includes('telegram.org')));
check('that request never resolved (network really is dead)', blocked.length > 0);
check('React mounted despite the dead network', Boolean(root && root.children.length > 0));
check('__FBT_BOOTED__ was set', dom.window.__FBT_BOOTED__ === true);
check('boot overlay was dismissed', !boot || boot.style.opacity === '0');
check('watchdog did not fire', !boot || boot.getAttribute('data-failed') !== 'true');
// A fresh install lands on onboarding; the guide gates the app right after it.
check('Persian UI rendered (onboarding first screen)', /[\u0600-\u06FF]/.test(text) && text.includes('رد کردن'));
check('no uncaught script errors', jsErrors.length === 0);

console.log('  external hosts blocked:', [...new Set(blocked.map((u) => new URL(u).host))].join(', ') || 'none');
console.log('  first screen text     :', text.slice(0, 90));
if (jsErrors.length) console.log('  js errors             :', jsErrors.slice(0, 2));

dom.window.close();
server.close();

export default results;
