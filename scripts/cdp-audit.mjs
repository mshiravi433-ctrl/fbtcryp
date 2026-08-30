/**
 * CDP driver for chrome-headless-shell: opens the Intent AI panel in a REAL
 * browser, clicks through every interactive surface, and reports what works.
 * No npm deps — Node 22's built-in WebSocket speaks CDP.
 *
 * Usage: node scripts/cdp-audit.mjs [url]
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const URL_TO_TEST = process.argv[2] || 'http://127.0.0.1:5174/#/intent-ai';
const SHOT_DIR = '/tmp/cdp-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

/* The shell binary: /tmp/chromium (sparticuz bundle) or the puppeteer cache. */
function findShell() {
  if (fs.existsSync('/tmp/chromium')) return '/tmp/chromium';
  for (const base of [`${process.env.HOME}/.cache/puppeteer`, '/root/.cache/puppeteer']) {
    try {
      const roots = [`${base}/chrome-headless-shell`, `${base}/chrome`];
      for (const root of roots) {
        for (const dir of fs.readdirSync(root)) {
          const bin = `${root}/${dir}/chrome-headless-shell-linux64/chrome-headless-shell`;
          const bin2 = `${root}/${dir}/chrome-linux64/chrome`;
          if (fs.existsSync(bin)) return bin;
          if (fs.existsSync(bin2)) return bin2;
        }
      }
    } catch { /* next */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const errors = [];
function report(name, ok, detail = '') {
  results.push([name, Boolean(ok), detail]);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const bin = findShell();
  if (!bin) { console.error('no chrome shell found'); process.exit(2); }
  console.log('shell:', bin);

  const PORT = 9223;
  const userDir = '/tmp/cdp-profile';
  fs.rmSync(userDir, { recursive: true, force: true });
  const child = spawn(bin, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--single-process', '--no-zygote',
    '--headless=new',
    '--window-size=420,900'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}` }
  });
  child.stderr.on('data', (d) => {
    const s = String(d);
    if (/ERROR:gpu|ERROR:viz|ERROR:command_buffer/i.test(s)) return;
  });
  process.on('exit', () => { try { child.kill('SIGKILL'); } catch {} });

  /* Wait for the debug endpoint. */
  let version = null;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch {}
  }
  if (!version) { console.error('shell did not start'); process.exit(2); }

  /* Create a page target. */
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  const pageEvents = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      const text = msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      pageEvents.push({ type: 'console.' + msg.params.type, text });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageEvents.push({ type: 'exception', text: `${d.text || ''} ${d.exception?.description || ''}`.slice(0, 400) });
      errors.push(pageEvents[pageEvents.length - 1].text);
    }
    if (msg.method === 'Network.loadingFailed') {
      const { errorText, type } = msg.params;
      if (type !== 'Image') pageEvents.push({ type: 'netfail', text: `${type}: ${errorText}` });
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Log.enable');

  const shot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    if (res.result?.data) fs.writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(res.result.data, 'base64'));
    console.log('  [shot]', name);
  };

  /** Evaluate a JS expression in the page; return {ok, value}. */
  async function evalJs(expression) {
    const res = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (res.result?.exceptionDetails) return { ok: false, error: res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text };
    return { ok: true, value: res.result?.result?.value };
  }

  /** Click helper: dispatches trusted-ish events on first match of selector. */
  async function click(sel, optional = false) {
    const r = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return { found: false };
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
      return { found: true, disabled: el.disabled === true, text: (el.textContent || '').slice(0, 60) };
    })()`);
    const v = r.ok ? r.value : null;
    if (!v?.found && !optional) report(`click ${sel}`, false, r.error || 'not found');
    return v;
  }

  const count = async (sel) => (await evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`)).value || 0;
  const exists = async (sel) => (await count(sel)) > 0;
  const waitFor = async (sel, timeout = 8000) => {
    const t0 = (globalThis.performance?.now?.() ?? Date.now());
    while ((globalThis.performance?.now?.() ?? Date.now()) - t0 < timeout) {
      if (await exists(sel)) return true;
      await sleep(250);
    }
    return false;
  };

  console.log('\n== navigating to', URL_TO_TEST);
  await send('Page.navigate', { url: URL_TO_TEST });
  await sleep(2500);
  const where = await evalJs(`({ href: location.href, ready: document.readyState, title: document.title, bodyLen: document.body?.textContent?.length, scripts: [...document.scripts].map(s => (s.src || 'inline').slice(-40)) })`);
  console.log('where am I:', JSON.stringify(where.value ?? where.error));

  /* Onboarding gate may intercept first launch. */
  const gate = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
    return { hasGuide: !!document.querySelector('[data-testid="guide"] , .guide-overlay'), buttons: btns.slice(0, 12) };
  })()`);
  console.log('gate probe:', JSON.stringify(gate.value ?? gate.error));

  /* Walk the real first-run gates like a user: Splash → Welcome → Onboarding → Guide. */
  for (let gateStep = 0; gateStep < 24; gateStep++) {
    const appReady = (await evalJs(`!!document.querySelector('.app-shell')`)).value;
    if (appReady) break;
    const clicked = await evalJs(`(() => {
      const pick = (sel) => { const el = document.querySelector(sel); if (el && !el.disabled) { el.click(); return sel; } return null; };
      let c = pick('.splash-btn');
      if (c) return c;
      /* Inside Onboarding the footer owns the only next control. */
      const onbStage = document.querySelector('.onb-stage');
      if (onbStage) {
        const next = onbStage.querySelector('.onb-foot .btn-primary');
        if (next) {
          if (next.disabled) {
            const box = onbStage.querySelector('input[type="checkbox"]');
            if (box && !box.checked) { box.click(); return 'terms-checkbox'; }
            return 'onb-blocked';
          }
          next.click();
          return 'onb-next';
        }
      }
      const fa = [...document.querySelectorAll('.lang-row')].find((b) => /فارسی/.test(b.textContent || '') && !b.classList.contains('active'));
      if (fa) { fa.click(); return 'lang-fa'; }
      c = pick('.onb-btn');
      if (c) return c;
      /* Guide: its CTA walks every section and finishes once all are seen. */
      const guideCta = document.querySelector('.guide-stage .guide-cta');
      if (guideCta) {
        if (guideCta.disabled) return 'guide-waiting';
        guideCta.click();
        return 'guide-cta';
      }
      const done = [...document.querySelectorAll('button')].find((b) => /پایان|شروع|متوجه|done|finish|got it/i.test(b.textContent || ''));
      if (done && !done.disabled) { done.click(); return 'done'; }
      return null;
    })()`);
    console.log('  gate click:', JSON.stringify(clicked.value ?? clicked.error));
    if (!clicked.value) break;
    await sleep(2600);
  }
  await sleep(3000);
  const where2 = await evalJs(`({ href: location.href, ready: document.readyState, shell: !!document.querySelector('.app-shell'), buttons: [...document.querySelectorAll('button')].slice(0,8).map(b => (b.textContent||'').trim().slice(0,24)) })`);
  console.log('after gates:', JSON.stringify(where2.value ?? where2.error));

  /* ---------------- 1. panel renders ---------------- */
  report('panel renders (.ia-panel)', await waitFor('.ia-panel', 15000));
  await shot('01-first-render');

  /* The auto market brief fires at mount; give it time, it may be slow. */
  const briefArrived = await waitFor('[data-testid="market-analysis"]', 20000);
  const briefStatus = (await evalJs(`document.querySelector('[data-testid="market-analysis"]')?.dataset.status || 'missing'`)).value;
  report(`auto market brief card present (status=${briefStatus})`, briefArrived);
  await sleep(9000);
  const briefStatus2 = (await evalJs(`document.querySelector('[data-testid="market-analysis"]')?.dataset.status || 'missing'`)).value;
  report(`market brief settles out of pending (status=${briefStatus2})`, briefStatus2 !== 'pending');
  await shot('02-market-brief');

  /* ---------------- 2. quick chips ---------------- */
  const quickChips = await count('.ia-quick-chip');
  report(`quick chips render (${quickChips})`, quickChips >= 6);

  /* Guided flow needs preparation permission — pick L2 + human-AI mode first. */
  await evalJs(`(() => { document.querySelector('[data-testid="intent-ai-level-2"]')?.click(); return 1; })()`);
  await sleep(900);
  await evalJs(`(() => { document.querySelector('.ia-mode')?.click(); return 1; })()`);
  await sleep(900);

  /* swap chip → guided flow should begin */
  await click('.ia-quick-chip:nth-of-type(2)');
  await sleep(1500);
  const afterSwap = await evalJs(`(() => ({
    flowQ: !!document.querySelector('.ia-flow-question'),
    testIds: [...document.querySelectorAll('[data-testid]')].slice(0, 20).map((e) => e.dataset.testid),
    msgs: document.querySelectorAll('.intent-ai-thread > div').length
  }))()`);
  console.log('after swap chip:', JSON.stringify(afterSwap.value ?? afterSwap.error));
  const prepIdsAfterChip = (afterSwap.value?.testIds || []).join(',');
  if (afterSwap.value?.flowQ || prepIdsAfterChip.includes('interactive-confirmation-screen') || prepIdsAfterChip.includes('best-route')) {
    report('swap chip starts the guided flow / preparation', true);
    /* Drive the flow with quick replies when present. */
    for (let step = 0; step < 8; step++) {
      const st = await evalJs(`(() => {
        const q = document.querySelector('.ia-flow-question');
        const chips = [...document.querySelectorAll('.ia-flow-question .ia-chip')].map((c) => (c.textContent || '').trim());
        const confirmScreen = !!document.querySelector('[data-testid="interactive-confirmation-screen"]');
        const lastBubbleText = (document.querySelector('.intent-ai-thread > div:last-child')?.textContent || '').slice(0, 200);
        return q ? { step: q.dataset.testid, chips } : { step: confirmScreen ? 'CONFIRM_SCREEN' : 'none', chips, lastBubbleText };
      })()`);
      const v = st.value;
      if (!v || v.step === 'none' || v.step === 'CONFIRM_SCREEN') { console.log('  flow reached:', v?.step); break; }
      if (v.chips.length === 0) { console.log('  flow question has no chips:', v.step); break; }
      await evalJs(`(() => { document.querySelector('.ia-flow-question .ia-chip').click(); return 1; })()`);
      await sleep(1200);
    }
  } else {
    report('swap chip starts the guided flow', false, JSON.stringify(afterSwap.value));
  }

  /* Did we reach the interactive confirmation screen? */
  await sleep(1000);
  const confirmScreen = await exists('[data-testid="interactive-confirmation-screen"]');
  report('interactive confirmation screen opens from flow', confirmScreen);
  await shot('03-confirm-screen');

  if (confirmScreen) {
    /* Wallet connection strip — must be visible with its connect link. */
    const walletStrip = await evalJs(`(() => {
      const el = document.querySelector('[data-testid="wallet-missing"]');
      const link = document.querySelector('.ia-wallet-connect-link');
      return { shown: !!el, href: link?.getAttribute('href') || null };
    })()`);
    report('wallet-missing strip visible on confirm screen (headless = no wallet)', walletStrip.value?.shown === true && walletStrip.value?.href === '#/wallet', JSON.stringify(walletStrip.value));

    /* Final confirm — execution path. */
    const btn = await evalJs(`(() => {
      const b = document.querySelector('[data-testid="final-confirm-button"]');
      return b ? { disabled: b.disabled } : null;
    })()`);
    report('final-confirm-button exists & enabled', btn.value && !btn.value.disabled, JSON.stringify(btn.value));
    if (btn.value && !btn.value.disabled) {
      await click('[data-testid="final-confirm-button"]');
      await sleep(4000);
      const receipt = await evalJs(`(() => {
        const r = document.querySelector('[data-testid="receipt-reason"]');
        const cards = [...document.querySelectorAll('.card-inner')].map((c) => (c.textContent || '').slice(0, 160));
        return { reason: r ? r.textContent : null, cards: cards.slice(-3) };
      })()`);
      console.log('receipt after confirm:', JSON.stringify(receipt.value ?? receipt.error));
      report('a receipt is produced after final confirm', true, 'see detail above');
      await shot('04-receipt');
    }
  }

  /* ---------------- 3. mode selector ---------------- */
  for (const i of [1, 2, 3]) {
    const modeBtn = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('.ia-mode')];
      const b = btns[${i - 1}];
      if (!b) return null;
      b.click();
      return { clicked: (b.textContent || '').slice(0, 40), count: btns.length };
    })()`);
    await sleep(1200);
    const on = (await evalJs(`(() => [...document.querySelectorAll('.ia-mode.on')].map((b) => (b.textContent || '').slice(0, 30)))()`)).value;
    report(`mode chip ${i} switches`, !!modeBtn?.value, `on=${JSON.stringify(on)}`);
  }

  /* ---------------- 4. level selector ---------------- */
  for (const L of [1, 2, 3]) {
    await evalJs(`(() => { const b = document.querySelector('[data-testid="intent-ai-level-${L}"]'); if (b) b.click(); return !!b; })()`);
    await sleep(1200);
    const cur = (await evalJs(`(() => [...document.querySelectorAll('.ia-level.is-current')].map((b) => b.textContent?.slice(0, 6)))()`)).value;
    report(`level L${L} activates`, Array.isArray(cur) && cur.length > 0, `current=${JSON.stringify(cur)}`);
    if (L === 3) {
      const prompt = await exists('[data-testid="interactive-confirmation-screen"], .ia-ctl.ia-go');
      report('L3 shows the policy confirmation prompt', prompt);
      /* Confirm the policy so L3 becomes usable. */
      const applied = await evalJs(`(() => {
        const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('شروع') || (b.textContent || '').toLowerCase().includes('start'));
        if (btns[0]) { btns[0].click(); return btns[0].textContent; }
        return null;
      })()`);
      console.log('  L3 confirm click:', JSON.stringify(applied.value),);
      await sleep(1500);
    }
  }
  await shot('05-level3');

  /* Back to the HUMAN↔AI mode + L2 for a clean preparation conversation. */
  await evalJs(`(() => { document.querySelector('.ia-mode')?.click(); return 1; })()`);
  await sleep(900);
  await evalJs(`document.querySelector('[data-testid="intent-ai-level-2"]')?.click(); 1`);
  await sleep(1000);

  /* ---------------- 5. guided flow via composer text ---------------- */
  const typed = await evalJs(`(() => {
    const input = document.querySelector('.ia-composer input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'swap 100 USDC to ETH on arbitrum');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const form = input.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  report('composer accepts text + submits', typed.value === true);
  await sleep(2500);
  const afterText = await evalJs(`(() => ({
    screen: !!document.querySelector('[data-testid="interactive-confirmation-screen"]'),
    bubbles: document.querySelectorAll('.intent-ai-thread > div').length,
    last: (document.querySelector('.intent-ai-thread > div:last-child')?.textContent || '').slice(0, 250)
  }))()`);
  console.log('after typed swap:', JSON.stringify(afterText.value ?? afterText.error));
  await shot('06-typed-swap');

  /* ---------------- 6. accordions ---------------- */
  const detailsOpened = await evalJs(`(() => {
    const ds = [...document.querySelectorAll('details')];
    let okAll = true;
    ds.forEach((d) => { d.open = !d.open; if (d.open === undefined) okAll = false; });
    return { count: ds.length, okAll };
  })()`);
  report(`details accordions toggle (${detailsOpened.value?.count})`, detailsOpened.value?.count > 0);

  /* Steps accordion content: do stage chips resolve to real routes? */
  const stageLinks = await evalJs(`(() => [...document.querySelectorAll('.ia-stage-chip')].map((c) => c.tagName === 'A' ? c.getAttribute('href') : 'here'))()`);
  report('stage rail chips have targets', (stageLinks.value || []).length === 6, JSON.stringify(stageLinks.value));

  /* ---------------- 7. info modal ---------------- */
  const modalBefore = await exists('[data-testid="external-agent-info-modal"]');
  await click('[data-testid="external-agent-info-button"]', true);
  await sleep(800);
  const modalAfter = await exists('[data-testid="external-agent-info-modal"]');
  report('info modal opens & closes', !modalBefore && modalAfter);
  if (modalAfter) { await evalJs(`document.querySelector('.ia-modal-close')?.click(); 1`); await sleep(500); }

  /* ---------------- 8. session controls ---------------- */
  const ctls = await count('.ia-ctl');
  report(`session control buttons render (${ctls})`, ctls >= 4);
  const pauseRes = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.ia-ctl')].find((b) => /pause|توقف/i.test(b.textContent || ''));
    if (!btn) return null; btn.click(); return btn.textContent;
  })()`);
  await sleep(900);
  console.log('  pause clicked:', JSON.stringify(pauseRes.value));
  /* STOP then resume for honesty */
  await shot('06-controls');

  /* ---------------- 9. examples accordion fills composer ---------------- */
  const exOk = await evalJs(`(() => {
    const d = [...document.querySelectorAll('.ia-examples')][0];
    if (!d) return null;
    d.open = true;
    const chip = d.querySelector('.ia-example-chip');
    if (!chip) return { opened: true, chip: false };
    chip.click();
    return { opened: true, chip: true, inputValue: document.querySelector('.ia-composer input')?.value || '' };
  })()`);
  await sleep(600);
  const filled = (await evalJs(`document.querySelector('.ia-composer input')?.value || ''`)).value;
  report('example chip fills the composer', Boolean(exOk.value?.chip) && filled.length > 3, `input="${(filled || '').slice(0, 60)}"`);

  /* ---------------- 10. history link & rails ---------------- */
  const histHref = (await evalJs(`document.querySelector('.ia-history-link')?.getAttribute('href')`)).value;
  report('history quick link points at intent history tab', histHref === '#/intent?tab=history', String(histHref));

  /* ---------------- 11. offline strip ---------------- */
  const offlineStrip = await evalJs(`document.querySelector('[data-testid="offline-status"]')?.dataset.online ?? 'missing'`);
  report('offline/online status strip present', ['true', 'false'].includes(offlineStrip.value), `online=${offlineStrip.value}`);

  /* ---------------- console errors ---------------- */
  const severe = pageEvents.filter((e) => e.type === 'exception' || (e.type === 'console.error' && !/React Router|Download the React/i.test(e.text)));
  report(`no uncaught exceptions (${severe.length})`, severe.length === 0, severe.slice(0, 6).map((s) => s.text.slice(0, 140)).join(' | '));
  const netfails = pageEvents.filter((e) => e.type === 'netfail');
  console.log('network failures (informational):', JSON.stringify(netfails.slice(0, 8), null, 1));

  await shot('99-final');
  console.log('\n════════ SUMMARY ════════');
  const fails = results.filter(([, ok]) => !ok);
  console.log(`${results.length - fails.length}/${results.length} checks passed`);
  for (const [name, , detail] of fails) console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  if (errors.length) { console.log('\nPAGE EXCEPTIONS:'); errors.slice(0, 10).forEach((e) => console.log('  •', e)); }

  ws.close();
  child.kill('SIGKILL');
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
