// Load every Lab sub-component through Vite SSR to verify they all
// compile and export valid React components. Catches missing imports
// or syntax errors that the build pipeline alone does not exercise
// (since the components are loaded lazily).
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn'
});

const components = [
  '/src/components/Lab/Shared.jsx',
  '/src/components/Lab/PracticeGroup.jsx',
  '/src/components/Lab/LearnGroup.jsx',
  '/src/components/Lab/AdvancedGroup.jsx',
  '/src/components/Lab/PredictionCard.jsx',
  '/src/components/Lab/PaperTrade.jsx',
  '/src/components/Lab/InvestmentSim.jsx',
  '/src/components/Lab/Challenges.jsx',
  '/src/components/Lab/Lesson.jsx',
  '/src/components/Lab/RiskTrainer.jsx',
  '/src/components/Lab/StrategyLab.jsx',
  '/src/components/Lab/DeFiSim.jsx',
  '/src/components/Lab/WhatIf.jsx',
  '/src/components/Lab/ComparePortfolios.jsx',
  '/src/components/Lab/LevelSystem.jsx',
  '/src/components/Lab/Leaderboard.jsx',
  '/src/pages/Lab.jsx',
  '/src/store/useLabStore.js',
  '/src/lib/lab/engine.js',
  '/src/lib/lab/scenarios.js',
  '/src/lib/lab/marketData.js'
];

let allOk = true;
for (const path of components) {
  try {
    const mod = await server.ssrLoadModule(path);
    const keys = Object.keys(mod);
    const hasDefault = typeof mod.default === 'function';
    const fname = (mod.default?.name || mod.default?.displayName || '(no-name)');
    console.log(`✓ ${path.padEnd(50)} exports: ${keys.length} (default: ${hasDefault ? 'fn' : hasDefault === false ? 'no' : '?'}) ${hasDefault ? '[' + fname + ']' : ''}`);
  } catch (e) {
    console.log(`✗ ${path.padEnd(50)} FAILED: ${e.message.split('\n')[0]}`);
    allOk = false;
  }
}

await server.close();

if (allOk) {
  console.log('\n✅ All Lab modules load via Vite SSR.');
} else {
  console.log('\n❌ Some modules failed.');
  process.exit(1);
}
