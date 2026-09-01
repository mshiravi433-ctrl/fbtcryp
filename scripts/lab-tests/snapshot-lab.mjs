// Render the Lab page using Vite SSR + React renderToString to capture
// a snapshot of the DOM tree as a static HTML file. This isn't a visual
// screenshot (no real browser), but it proves the React tree assembles
// correctly and lets us inspect the markup the user will see.
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.fetch = async () => ({ ok: false, json: async () => ({}), text: async () => '' });

// Stub framer-motion's motion components
const React = await import('react');
const motionProxy = new Proxy({}, { get: (_, tag) => {
  return (props) => React.createElement(tag, props, props.children);
}});
globalThis.__motion__ = motionProxy;

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error'
});

try {
  // Pre-seed the store so the snapshot shows non-zero values
  const { useLabStore } = await server.ssrLoadModule('/src/store/useLabStore.js');
  useLabStore.getState().resetLab();
  // Make some activity so the dashboard shows real data
  useLabStore.getState().completeChallenge({ scenarioId: 'crash-30', choiceId: 'hold', outcome: 'win', impactPct: -8, xpAward: 30 });
  useLabStore.getState().completeChallenge({ scenarioId: 'bull-25', choiceId: 'take', outcome: 'win', impactPct: 7, xpAward: 30 });
  useLabStore.getState().completeChallenge({ scenarioId: 'rates-hike', choiceId: 'flight', outcome: 'win', impactPct: 1, xpAward: 30 });
  useLabStore.getState().completeLesson('lesson-01', 100);
  useLabStore.getState().completeLesson('lesson-02', 100);
  useLabStore.getState().completeLesson('lesson-03', 100);
  useLabStore.getState().completeLesson('lesson-04', 75);

  // Now load the page component
  const { default: Lab } = await server.ssrLoadModule('/src/pages/Lab.jsx');
  console.log('Lab component loaded:', typeof Lab);

  const { MemoryRouter } = await import('react-router-dom');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/lab'] },
      React.createElement(Lab)
    )
  );

  // Pretty-print and save
  const pretty = html
    .replace(/></g, '>\n<')
    .split('\n')
    .map((l, i, arr) => {
      let depth = 0;
      for (let j = 0; j < i; j++) {
        const prev = arr[j];
        if (prev.startsWith('</')) depth--;
        else if (prev.startsWith('<') && !prev.startsWith('<!') && !prev.startsWith('</') && !prev.endsWith('/>')) depth++;
        else if (prev.endsWith('/>')) {}
        else if (prev.startsWith('<')) depth++;
      }
      return '  '.repeat(Math.max(0, depth)) + l;
    })
    .join('\n');

  await import('node:fs').then(fs => fs.writeFileSync('/tmp/lab-snapshot.html', `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/lab-v2.css"></head>
<body style="background:#000;padding:20px;font-family:system-ui;">${html}</body></html>`));

  console.log('\n=== LAB PAGE SNAPSHOT ===\n');
  console.log(`HTML length: ${html.length} chars`);
  console.log(`Cards in DOM: ${(html.match(/lab2-card/g) || []).length}`);
  console.log(`Groups: ${(html.match(/lab2-group/g) || []).length}`);
  console.log(`Tabs: ${(html.match(/lab2-tab/g) || []).length}`);
  console.log(`Balance text: ${html.match(/\$[\d,]+/g)?.[0] || '(not found)'}`);

  // Check for key elements
  const checks = [
    ['Header (lab2-header)', 'lab2-header'],
    ['Balance label', 'Virtual Balance'],
    ['Practice group', 'Practice'],
    ['Learn group', 'Learn'],
    ['Advanced group', 'Advanced'],
    ['Prediction card', 'Prediction'],
    ['Paper Trading card', 'Paper Trading'],
    ['Investment Sim card', 'Investment Sim'],
    ['Challenges card', 'Challenges'],
    ['Lessons card', 'Lessons'],
    ['Risk Trainer card', 'Risk Trainer'],
    ['Strategy Lab card', 'Strategy Lab'],
    ['DeFi Lab card', 'DeFi Lab'],
    ['What-If card', 'What-If?'],
    ['Compare tool', 'Compare'],
    ['My Level tool', 'My Level'],
    ['Leaderboard tool', 'Leaderboard'],
    ['Lab2-stats (Level/Accuracy/Rank)', 'lab2-stats']
  ];
  console.log('\n=== Element checks ===');
  for (const [label, needle] of checks) {
    console.log(`  ${html.includes(needle) ? '✓' : '✗'} ${label} (${needle})`);
  }

  console.log('\nSnapshot saved to /tmp/lab-snapshot.html');
} catch (e) {
  console.error('Snapshot failed:', e.message);
  console.error(e.stack);
} finally {
  await server.close();
}
