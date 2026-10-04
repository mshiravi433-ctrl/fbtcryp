/* ==========================================================================
   tools/subtitles.mjs — the subtitle track
   --------------------------------------------------------------------------
   The subtitle timings are DERIVED, not retyped: each cue starts at the second
   the narration for its scene begins (from the measured timing file) and is
   estimated at the narrator's measured pace, so the words on screen and the
   words in the ear stay together.

   Usage: node tools/subtitles.mjs --out out/fbt-intent-os.en.srt
   ========================================================================== */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', path.join(ROOT, 'out/fbt-intent-os.en.srt'));

const script = JSON.parse(await fsp.readFile(path.join(HERE, 'narration.json'), 'utf8'));
const timing = (await import(path.join(ROOT, 'src/narration-timing.js')))
  .NARRATION.reduce((m, c) => (m[c.id] = c, m), {});

/* Read the narration as subtitle LINES rather than paragraphs: one thought per
   cue, kept under ~74 characters so the line never wraps to a third row. */
const LINES = {
  sc01: [
    'Every second, millions of financial events happen around the world.',
    'Prices change. Liquidity moves. Markets react. Wallets transact.',
    'Opportunities appear. And disappear.',
    "The challenge isn't finding more information.",
    "It's understanding what to do with it.",
    'Because information without context is just noise.'
  ],
  sc02: [
    'FBT Intent OS takes a different approach.',
    'Instead of asking users to navigate a world of disconnected financial tools…',
    'it starts with something much simpler.',
    'You.',
    'Your goal. Your context. Your risk. Your intent.'
  ],
  sc03: [
    'Using Intent OS begins exactly where a financial decision begins.',
    'With a goal.',
    "You don't need to know which tool to open first.",
    "You simply describe what you're trying to accomplish."
  ],
  sc04: [
    "Intent OS doesn't simply read the words. It interprets the structure behind them.",
    'What are you trying to achieve? How long do you have?',
    'What constraints matter? What information is still missing?',
    'When something important is missing, the system asks.'
  ],
  sc05: [
    'The next layer is context.',
    "With the user's permission, Intent OS can work with available portfolio and market information.",
    'This matters, because the same goal can require very different strategies depending on the context.',
    'Intent without context is incomplete.'
  ],
  sc06: [
    'This is where Intent OS becomes more than a conversation.',
    'It turns an objective into a structured workflow.',
    'First, understand the current position. Then analyze the environment.',
    'Then evaluate possible strategies. Then define what should happen next.',
    'The goal is not to predict the future with certainty.',
    'The goal is to make the decision process more structured, transparent and informed.'
  ],
  sc07: [
    'Intent OS can coordinate different capabilities inside FBT.',
    'Market information can provide one perspective. Signal can add technical context.',
    'Smart Money can provide on-chain information. Portfolio data adds personal context.',
    'Together, they create a broader analytical picture.'
  ],
  sc08: [
    'But intelligence does not mean losing control.',
    'Intent OS can analyze. It can prepare. It can coordinate.',
    'But important actions remain subject to user authorization.'
  ],
  sc09a: [
    'Once authorized, the action can move into execution.',
    'But execution is only one part of the process.'
  ],
  sc09b: [
    'Verification matters.',
    'Intent OS can follow the workflow from preparation through confirmation,',
    'so the user can see what happened — not simply what was requested.'
  ],
  sc10: [
    "A financial workflow doesn't end when a transaction is completed.",
    'Markets continue moving. Risk changes. New information arrives.',
    'And when relevant conditions change, Intent OS can bring the information back into the workflow.'
  ],
  sc11: [
    'This is the Intent OS loop.',
    'Intent. Context. Analysis. Strategy. Action.',
    'Authorization. Execution. Verification. Monitoring.',
    'And when the environment changes…',
    'the process can begin again.'
  ],
  sc12: [
    'The future of financial technology may not be about adding more screens.',
    'It may be about making complex systems easier to understand.',
    'One intent. One intelligent workflow. One connected environment.'
  ],
  sc13: [
    'FBT Intent OS.',
    'Understand your intent. Structure your plan.',
    'Verify every important action. And stay in control.',
    'FBT Swap. The intelligent way to interact with a connected financial world.'
  ]
};

/* Also caption the two lines the film writes on screen but never speaks. */
const SILENT = [
  { start: 25.0, end: 40.5, text: 'THE FINANCIAL WORLD NEVER STOPS.' },
  { start: 60.5, end: 74.0, text: 'FBT SWAP · INTENT OS · AI-POWERED FINANCIAL OPERATING SYSTEM' },
  { start: 213.0, end: 224.0, text: 'INTENT WITHOUT CONTEXT IS INCOMPLETE.' },
  { start: 261.0, end: 290.0, text: 'PROPOSED PLAN ≠ GUARANTEED RESULT' },
  { start: 340.0, end: 350.0, text: 'MULTI-LAYER ANALYSIS' },
  { start: 370.0, end: 383.5, text: 'USER APPROVAL REQUIRED — the wallet signs, not the AI' },
  { start: 430.0, end: 443.0, text: 'ACTION → TRANSACTION → BLOCKCHAIN → VERIFICATION' },
  { start: 468.5, end: 484.0, text: 'MARKET CONDITION CHANGED · REVIEW RECOMMENDED' },
  { start: 585.0, end: 593.0, text: 'FBT SWAP · INTENT OS · UNDERSTAND. PLAN. VERIFY. ACT. · FBTSWAP.IR' }
];

const cues = [];
for (const [id, lines] of Object.entries(LINES)) {
  const t = timing[id];
  if (!t) continue;
  const chars = lines.reduce((s, l) => s + l.length, 0);
  // measured pace of this very clip (characters per second), so the last line
  // ends where the clip ends instead of drifting
  const cps = chars / t.duration;
  let at = t.start;
  for (const line of lines) {
    const dur = Math.max(1.6, line.length / cps);
    cues.push({ start: at, end: Math.min(t.end + 0.35, at + dur), text: line });
    at += dur;
  }
}
for (const s of SILENT) cues.push({ start: s.start, end: s.end, text: s.text });

cues.sort((a, b) => a.start - b.start);
// never let two cues overlap — the previous one yields
for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end) cues[i - 1].end = cues[i].start - 0.06;

const ts = (s) => {
  const ms = Math.round((s % 1) * 1000);
  const total = Math.floor(s);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss},${String(ms).padStart(3, '0')}`;
};

const srt = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
await fsp.mkdir(path.dirname(OUT), { recursive: true });
await fsp.writeFile(OUT, srt, 'utf8');
console.log(`[subtitles] ${cues.length} cues → ${OUT}`);
