// Use Vite's SSR API to render the Lab page to a string, so we can verify
// the JSX executes and the DOM tree assembles correctly.
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
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

try {
  // We can't easily SSR React with vite-node here without a lot of setup,
  // but we CAN fetch the transformed module and verify it's valid JS.
  const { default: LabPage } = await server.ssrLoadModule('/src/pages/Lab.jsx');
  console.log('Lab module loaded, type:', typeof LabPage);
  console.log('Default export is a function:', typeof LabPage === 'function');
  console.log('Display name:', LabPage.displayName || LabPage.name || '(anon)');
} catch (e) {
  console.error('SSR load failed:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 8).join('\n'));
} finally {
  await server.close();
}
