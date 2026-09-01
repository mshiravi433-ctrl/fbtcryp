// Build a self-contained HTML preview of the Lab page so the user can
// open it in any browser and visually confirm the design works.
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.fetch = async () => ({ ok: false, json: async () => ({}), text: async () => '' });

const React = await import('react');

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error'
});

try {
  const { useLabStore } = await server.ssrLoadModule('/src/store/useLabStore.js');
  useLabStore.getState().resetLab();
  // Pre-seed with some activity so the dashboard shows non-zero state
  useLabStore.getState().completeChallenge({ scenarioId: 'crash-30', choiceId: 'hold', outcome: 'win', impactPct: -8, xpAward: 30 });
  useLabStore.getState().completeChallenge({ scenarioId: 'bull-25', choiceId: 'take', outcome: 'win', impactPct: 7, xpAward: 30 });
  useLabStore.getState().completeLesson('lesson-01', 100);
  useLabStore.getState().completeLesson('lesson-02', 100);
  useLabStore.getState().completeLesson('lesson-04', 75);
  useLabStore.getState().openPaperTrade({ symbol: 'bitcoin', side: 'buy', qty: 0.05, entry: 100000, stop: 97000, tp: 110000 });
  const t = useLabStore.getState().paperTrades[0];
  useLabStore.getState().closePaperTrade(t.id, 108000);

  const { default: Lab } = await server.ssrLoadModule('/src/pages/Lab.jsx');
  const { MemoryRouter } = await import('react-router-dom');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/lab'] },
      React.createElement(Lab)
    )
  );

  const css = readFileSync('src/styles/lab-v2.css', 'utf8');
  // Also include the global theme tokens from index.css
  const theme = readFileSync('src/index.css', 'utf8').match(/:root\s*\{[^}]+\}/)?.[0] || '';

  const preview = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>FBT Lab — Preview</title>
<style>
${theme}
${css}
body { background: #000; padding: 0; margin: 0; font-family: system-ui, -apple-system, sans-serif; }
.lab2 { padding: 16px; max-width: 480px; margin: 0 auto; min-height: 100vh; }
.row { display: flex; align-items: center; }
</style>
</head>
<body>
${html}
</body>
</html>`;

  writeFileSync('lab-preview.html', preview);
  console.log('Static preview written to lab-preview.html');
  console.log('HTML size:', preview.length, 'bytes');
  console.log('Card count:', (html.match(/lab2-card/g) || []).length);
  console.log('Open in browser: file://' + process.cwd() + '/lab-preview.html');
} finally {
  await server.close();
}
