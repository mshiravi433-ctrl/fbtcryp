// Generate a textual ASCII-art representation of the Lab page so the
// layout can be inspected from a terminal. This is NOT a visual screenshot
// — it is a structural map.
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html>', { url: 'http://localhost/' });
globalThis.localStorage = dom.window.localStorage;

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error'
});

const { useLabStore } = await server.ssrLoadModule('/src/store/useLabStore.js');
useLabStore.getState().resetLab();
useLabStore.getState().completeChallenge({ scenarioId: 'crash-30', choiceId: 'hold', outcome: 'win', impactPct: -8, xpAward: 30 });
useLabStore.getState().completeLesson('lesson-01', 100);

const { default: Lab } = await server.ssrLoadModule('/src/pages/Lab.jsx');
const { MemoryRouter } = await import('react-router-dom');
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const html = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/lab'] },
    React.createElement(Lab)
  )
);

await server.close();

// Now parse the HTML and produce a structural map.
const { window } = new JSDOM(`<!doctype html><body>${html}</body>`);
const doc = window.document;

function box(width, color = '─', fill = ' ') {
  return '┌' + color.repeat(width - 2) + '┐';
}
function mid(width, color = '─') {
  return '├' + color.repeat(width - 2) + '┤';
}
function end(width, color = '─') {
  return '└' + color.repeat(width - 2) + '┘';
}
function line(width) { return '│' + ' '.repeat(width - 2) + '│'; }
function lineWithText(width, text, align = 'left') {
  const max = width - 4;
  const t = text.length > max ? text.slice(0, max - 1) + '…' : text;
  const padded = align === 'center'
    ? ' '.repeat(Math.floor((max - t.length) / 2)) + t + ' '.repeat(Math.ceil((max - t.length) / 2))
    : t + ' '.repeat(max - t.length);
  return '│ ' + padded + ' │';
}

const W = 44;
console.log('┌' + '─'.repeat(W - 2) + '┐');
console.log(lineWithText(W, '🧪 FBT LAB — Financial Simulation Center', 'center'));
console.log(mid(W));

// Header
const header = doc.querySelector('.lab2-header');
if (header) {
  const balance = header.querySelector('.lab2-balance')?.textContent || '?';
  const level = header.querySelector('.lab2-level-badge')?.textContent || '?';
  const name = header.querySelector('.lab2-level-name strong')?.textContent || '?';
  const xpText = header.querySelector('.lab2-level-name span')?.textContent || '?';
  const stats = [...header.querySelectorAll('.lab2-stat')].map((s) => {
    const v = s.querySelector('.lab2-stat-val')?.textContent;
    const l = s.lastElementChild?.textContent;
    return `${l} ${v}`;
  }).join('  ');
  console.log(lineWithText(W, '┌── HEADER ──────────────────────┐'));
  console.log(lineWithText(W, `  Virtual Balance: ${balance}`));
  console.log(lineWithText(W, `  ${stats}`));
  console.log(lineWithText(W, `  Lvl ${level} · ${name} · ${xpText}`));
  console.log(mid(W));
}

// Tabs
const tabs = [...doc.querySelectorAll('.lab2-tab')];
console.log(lineWithText(W, '[ ' + tabs.map((t) => (t.classList.contains('active') ? '●' : '○') + ' ' + t.textContent.trim()).join(' │ ') + ' ]'));
console.log(mid(W));

// Cards
const cards = [...doc.querySelectorAll('.lab2-card')];
for (const card of cards) {
  const title = card.querySelector('.lab2-card-title')?.textContent || '';
  const sub = card.querySelector('.lab2-card-sub')?.textContent || '';
  console.log(lineWithText(W, `┌──┐  ${title}`));
  console.log(lineWithText(W, `│  │  ${sub}`));
  console.log(lineWithText(W, `└──┘`));
}

console.log(end(W));
