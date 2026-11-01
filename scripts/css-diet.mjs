#!/usr/bin/env node
/**
 * CSS DIET — remove rules a stylesheet carries for markup that no longer exists.
 * =============================================================================
 *
 * ─── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────────
 *   «سرعت صفحه بازار خیلی پایین اومده … دیر انیمیشن و لوگو ها بالا میاد»
 *
 * The market screen is the app's HOME route, and its stylesheet chunk measured
 * 324,635 bytes (57.8 KB gzipped) — the largest CSS chunk in the build, larger
 * than the entry stylesheet of every other screen. It is five files stacked by
 * five redesigns, and each redesign left the previous one's selectors behind:
 * an Aparat video page that moved to the learn-hub sheet, an AI fox mascot that
 * was replaced by the Decision Orb, a hero card that became the deck.
 *
 * A dead rule is not free. It is downloaded on the home route, it is parsed by
 * the CSS engine, and — the part that shows up as "the page is slow" — every
 * one of its selectors is matched against EVERY element the route creates, on
 * first style resolution and again on each style recalculation. 438 classes in
 * one file, of which 205 appear nowhere in the app, is roughly half the
 * selector-matching work of the home screen spent on markup that does not exist.
 *
 * ─── WHAT IT DOES ────────────────────────────────────────────────────────────
 * It reads a stylesheet, splits it into rules with a real brace-matching parser
 * (so `@media` and `@supports` blocks are handled as units and comments are
 * never mistaken for selectors), and drops a rule when EVERY selector in it can
 * never match: a selector cannot match when it requires a class the app never
 * puts on an element.
 *
 * Then it drops `@keyframes` no surviving rule animates with, and finally
 * collapses any `@media`/`@supports` block left empty.
 *
 * ─── HOW IT CANNOT EAT SOMETHING LIVE ────────────────────────────────────────
 *   1. THE CORPUS IS EVERYTHING THAT CAN NAME A CLASS: every `.jsx`, `.js`,
 *      `.mjs`, `.css`, `.html` and `.json` under `src/`, `server/`, `test/`,
 *      `scripts/` and the repo root's preview pages, plus `index.html`. A class
 *      mentioned by a test, a design preview or another stylesheet counts as
 *      used. Only a class mentioned NOWHERE is dead.
 *   2. DYNAMIC PREFIXES ARE ALLOWLISTED. `className={\`mx-row-${kind}\`}` names
 *      no literal class, so the script collects every `prefix-${` and
 *      `"prefix-" +` pattern in the corpus and treats every class starting with
 *      such a prefix as used, whatever it looks like.
 *   3. SELECTORS WITHOUT A CLASS ARE NEVER DEAD. Element, attribute, pseudo and
 *      `:root`-style selectors carry no evidence either way, so any rule
 *      containing one is kept.
 *   4. IT IS A REPORT FIRST. Default mode prints what it would remove and how
 *      many bytes that is, and changes nothing. `--write` applies it.
 *      `--check` exits non-zero when a file still carries dead rules, which is
 *      what the test suite runs so the weight cannot silently come back.
 *
 * Usage:
 *   node scripts/css-diet.mjs src/styles/market-modern.css            (report)
 *   node scripts/css-diet.mjs --write src/styles/market-modern.css    (apply)
 *   node scripts/css-diet.mjs --check src/styles/market-modern.css    (gate)
 *   node scripts/css-diet.mjs --json src/styles/market-modern.css     (machine)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Directories whose files can put a class on an element, or can pin one in a
   test. `dist` and `node_modules` are build output and other people's code;
   `docs` and the root `.md` notes PROSE about selectors, and prose is not a
   usage — a class only a document mentions is still dead in the app. */
const CORPUS_DIRS = ['src', 'server', 'test', 'scripts', 'public'];
const CORPUS_EXT = /\.(jsx?|mjs|cjs|css|html|json|svg|ts|tsx)$/;
/* The lockfile is 1.1 MB of package metadata: it can name no class, and
   reading it into the corpus only slows the scan. */
const CORPUS_SKIP_FILES = new Set(['package-lock.json']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'coverage']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (CORPUS_EXT.test(entry) && !CORPUS_SKIP_FILES.has(entry)) out.push(full);
  }
  return out;
}

/** Every file that could name a class, minus the stylesheet under audit. */
export function corpusFiles(exclude = []) {
  const skip = new Set(exclude.map((f) => path.resolve(ROOT, f)));
  const files = [];
  for (const dir of CORPUS_DIRS) walk(path.join(ROOT, dir), files);
  /* Root-level pages and previews: index.html is the shell, and the *-preview
     pages are the design artifacts the redesign notes point at. */
  for (const entry of readdirSync(ROOT)) {
    const full = path.join(ROOT, entry);
    if (statSync(full).isFile() && CORPUS_EXT.test(entry) && !CORPUS_SKIP_FILES.has(entry)) files.push(full);
  }
  return files.filter((f) => !skip.has(f));
}

/* ────────────────────────────────────────────────────────────────────────────
   REACHABILITY — a component nobody imports cannot put a class on an element.
   ────────────────────────────────────────────────────────────────────────────

   Scanning "every file under src/" is not enough, and the market sheet is the
   proof: `FBTAICinemaBanner.jsx` sits in src/components with a hand-drawn fox
   mascot, and NOTHING imports it — the market screen replaced it with the
   Decision Orb. Its 28 KB of `.fox-*` / `.fbt-ai-*` rules (fifteen looping
   animations: blinking eyes, twitching ears, orbiting rings, drifting glows)
   still ship on the home route, because they live in `market-modern.css`,
   which Market.jsx DOES import.

   So the corpus is the module graph reachable from the app's entry, walked
   through static AND dynamic `import()` specifiers. A class named only by an
   unreachable file is dead exactly like a class named by no file at all.

   Everything else stays in the corpus on purpose: tests pin selectors, other
   stylesheets cross-reference them, `scripts/gen-landing.mjs` emits HTML, and
   the root preview pages are design artifacts. Reachability narrows the JSX
   and JS only — the files that can actually render.
*/

const ENTRY_POINTS = ['src/main.jsx', 'index.html'];
const RESOLVE_EXT = ['', '.jsx', '.js', '.mjs', '.css', '.json', '/index.jsx', '/index.js', '/index.mjs'];

function resolveSpecifier(spec, fromFile) {
  if (/^(https?:|node:|data:)/.test(spec)) return null;
  let base = null;
  if (spec.startsWith('/')) base = path.resolve(ROOT, spec.slice(1));       /* root-relative, as in index.html */
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  if (!base) return null; /* a bare package: its classes are its own business */
  for (const ext of RESOLVE_EXT) {
    const candidate = `${base}${ext}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* try the next extension */ }
  }
  return null;
}

/** Import specifiers in one module: static, re-exported and dynamic. */
export function specifiersOf(code) {
  const specs = [];
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*\/\*[^*]*\*\/\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) specs.push(m[1]);
  }
  /* `<script type="module" src="…">` in the HTML shell. */
  for (const m of code.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) specs.push(m[1]);
  return specs;
}

/** The set of modules the running app can reach, as absolute paths. */
export function reachableModules() {
  const seen = new Set();
  const queue = [];
  for (const entry of ENTRY_POINTS) {
    const abs = path.resolve(ROOT, entry);
    try {
      if (statSync(abs).isFile()) queue.push(abs);
    } catch { /* an entry that does not exist contributes nothing */ }
  }
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(jsx?|mjs|cjs|html|css)$/.test(file)) continue;
    let code;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of specifiersOf(code)) {
      const next = resolveSpecifier(spec, file);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/**
 * Class-name fragments the corpus builds at runtime.
 *
 * `mx-deck-${kind}` and `'mx-deck-' + kind` name no literal class, so every
 * class under that stem is treated as used. The stem is captured up to the last
 * hyphen before the interpolation, which is the shape this codebase uses.
 */
export function dynamicStems(corpus) {
  const stems = new Set();
  const patterns = [
    /([A-Za-z][\w-]*-)\$\{/g,          // `mx-deck-${kind}`
    /([A-Za-z][\w-]*-)\$\(/g,          // `mx-deck-$(kind)` (rare)
    /(['"`])([A-Za-z][\w-]*-)\1\s*\+/g, // 'mx-deck-' + kind
    /\+\s*(['"`])([A-Za-z][\w-]*-)\1/g  // kind + '-mx-deck' is not a thing, but
                                        // `x + '-row'` is: caught below instead
  ];
  for (const re of patterns) {
    for (const m of corpus.matchAll(re)) stems.add(m[2] ?? m[1]);
  }
  /* Suffix interpolation: `${base}-row`. The literal tail is a stem of its own
     for our purposes only if some class ends with it, so it needs no rule —
     those classes are written literally in the CSS and matched by the tail
     check in `isDynamic`. */
  return [...stems];
}

function isDynamic(cls, stems) {
  return stems.some((stem) => cls.startsWith(stem));
}

/* ────────────────────────────────────────────────────────────────────────────
   A brace-matching reader.
   The CSS in these files carries comments that CONTAIN braces and selectors
   (the redesign notes are written inside the stylesheets), so a regex split on
   `}` would cut a rule in half. This walks characters, tracks comment and
   string state, and returns top-level statements with their leading comments.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * @param {string} css
 * @returns {Array<{type:'rule'|'at'|'comment'|'raw', text:string, start:number, end:number,
 *                  prelude?:string, body?:Array, name?:string}>}
 */
export function parseStatements(css, from = 0, to = css.length) {
  const out = [];
  let i = from;
  let pendingComment = '';
  while (i < to) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? to : end + 2;
      pendingComment += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingComment += ch;
      i += 1;
      continue;
    }
    /* A statement runs to the next top-level `;` (declarations, @import) or to
       the end of its `{…}` block. */
    let j = i;
    let depth = 0;
    let inString = null;
    let end = -1;
    let blockEnd = -1;
    while (j < to) {
      const c = css[j];
      if (inString) {
        if (c === '\\') j += 1;
        else if (c === inString) inString = null;
      } else if (c === '"' || c === "'") {
        inString = c;
      } else if (c === '/' && css[j + 1] === '*') {
        const close = css.indexOf('*/', j + 2);
        j = close === -1 ? to : close + 1;
      } else if (c === '{') {
        depth += 1;
        if (depth === 1) end = j;
      } else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          blockEnd = j;
          break;
        }
      } else if (c === ';' && depth === 0) {
        break;
      }
      j += 1;
    }
    const stop = blockEnd === -1 ? Math.min(j + 1, to) : blockEnd + 1;
    const text = css.slice(i, stop);
    if (text.startsWith('@')) {
      const preludeEnd = text.indexOf('{');
      const prelude = (preludeEnd === -1 ? text : text.slice(0, preludeEnd)).trim();
      const name = prelude.match(/^@([\w-]+)/)?.[1] ?? '';
      const stmt = {
        type: 'at',
        name,
        prelude,
        text,
        comment: pendingComment,
        start: i,
        end: stop
      };
      if (preludeEnd !== -1) {
        stmt.body = parseStatements(text, preludeEnd + 1, text.length - 1);
      }
      out.push(stmt);
    } else {
      out.push({ type: 'rule', text, comment: pendingComment, start: i, end: stop });
    }
    pendingComment = '';
    i = stop;
  }
  return out;
}

const selectorListOf = (rule) => {
  const open = rule.text.indexOf('{');
  return (open === -1 ? rule.text : rule.text.slice(0, open)).trim();
};

/** Split a selector list on commas that are not inside brackets or quotes. */
export function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let inString = null;
  let cur = '';
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (inString) {
      cur += c;
      if (c === '\\') { cur += list[++i] ?? ''; } else if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") { inString = c; cur += c; continue; }
    if (c === '(' || c === '[') depth += 1;
    if (c === ')' || c === ']') depth -= 1;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/**
 * Can this selector ever match?
 *
 * `null` — no evidence either way (no class in it): keep.
 * `true`/`false` — every class it requires is used / at least one never is.
 *
 * ─── THE THREE PSEUDO-CLASSES THAT CHANGE WHAT A CLASS MEANS ─────────────────
 * A class inside `:not(.x)` is an EXCLUSION: `.a:not(.b)` matches an element
 * wearing `.a` and NOT wearing `.b`, so an unused `.b` makes the selector match
 * MORE, not less. Treating it as a requirement would delete a live rule.
 *
 * `:is(.a, .b)` and `:where(.a, .b)` are a LIST where ANY branch may match, so
 * "every class must exist" is the wrong test there too — and the correct one
 * needs the branches parsed against the rest of the compound. Rather than get
 * that subtly wrong, a selector carrying one of them is reported as "no
 * evidence" and kept. Same for `:has()`. These are a few dozen rules in a
 * 270 KB file; keeping them costs nothing and cannot break a screen.
 */
export function selectorIsLive(selector, used, stems) {
  if (/:(?:is|where|has|matches|any)\(/.test(selector)) return null;
  /* Drop `:not(…)` / `:except(…)` bodies before collecting requirements. */
  const requirements = selector.replace(/:(?:not|except)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, ' ');
  const classes = [...requirements.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (!classes.length) return null;
  return classes.every((c) => used.has(c) || isDynamic(c, stems));
}

/** Collect the class names a stylesheet's selectors mention. */
export function classesIn(css) {
  return new Set([...css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
}

/* ────────────────────────────────────────────────────────────────────────────
   The prune.
   ──────────────────────────────────────────────────────────────────────────── */

/** Animation names a body of statements actually asks for (surviving rules only). */
function animatedNames(statements) {
  const names = new Set();
  const visit = (list) => {
    for (const st of list) {
      if (st.type === 'at' && st.body) { visit(st.body); continue; }
      if (st.type !== 'rule') continue;
      const open = st.text.indexOf('{');
      const decls = open === -1 ? '' : st.text.slice(open + 1, st.text.lastIndexOf('}'));
      for (const m of decls.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
        for (const part of m[1].split(',')) {
          /* `animation: mk-spin 24s linear infinite` — the name is the token
             that is not a number, a duration, an easing keyword or a fill mode. */
          for (const tok of part.trim().split(/\s+/)) {
            if (/^[A-Za-z_][\w-]*$/.test(tok)
              && !/^(none|inherit|initial|unset|revert|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|infinite|running|paused|cubic-bezier|steps|var)$/.test(tok)
              && !tok.startsWith('--')) names.add(tok);
          }
        }
      }
      /* A `var()` indirection could name anything: keep every keyframe then. */
      if (/animation[^:]*:\s*[^;}]*var\(/.test(decls)) names.add('*');
    }
  };
  visit(statements);
  return names;
}

function pruneList(statements, used, stems, removed) {
  const kept = [];
  for (const st of statements) {
    if (st.type === 'at') {
      if (st.name === 'keyframes') {
        /* Handled in a second pass: it can only be judged against the rules
           that survive this one. */
        kept.push(st);
        continue;
      }
      if (st.body) {
        const inner = pruneList(st.body, used, stems, removed);
        if (!inner.length) {
          removed.push({ kind: 'empty-at', prelude: st.prelude, bytes: st.text.length });
          continue;
        }
        kept.push({ ...st, body: inner, rebuilt: true });
        continue;
      }
      kept.push(st);
      continue;
    }
    if (st.type !== 'rule') { kept.push(st); continue; }
    const selectors = splitSelectors(selectorListOf(st));
    if (!selectors.length) { kept.push(st); continue; }
    const verdicts = selectors.map((s) => selectorIsLive(s, used, stems));
    const live = selectors.filter((_s, i) => verdicts[i] !== false);
    const dead = selectors.filter((_s, i) => verdicts[i] === false);
    if (!dead.length) { kept.push(st); continue; }
    if (!live.length) {
      removed.push({ kind: 'rule', selectors, bytes: st.text.length });
      continue;
    }
    /*
     * A MIXED LIST loses only its dead selectors.
     *
     * The guard blocks in these sheets are written as one long comma list
     * (`:root[data-lite] .market-breadth, :root[data-lite] .market-trending, …`),
     * so a rule is rarely dead as a whole even when most of what it addresses
     * no longer exists. Dropping the rule would delete the live half; keeping it
     * intact keeps matching a dozen classes the DOM never wears. Pruning the
     * list is the honest middle: the declaration block survives once, for the
     * selectors that can still match.
     */
    const open = st.text.indexOf('{');
    const body = st.text.slice(open);
    const rebuilt = `${live.join(',\n')} ${body}`;
    kept.push({ ...st, text: rebuilt, rebuilt: true });
    removed.push({ kind: 'selector', selectors: dead, bytes: st.text.length - rebuilt.length });
  }
  return kept;
}

function pruneKeyframes(statements, removed) {
  const names = animatedNames(statements);
  const walk = (list) => {
    const out = [];
    for (const st of list) {
      if (st.type === 'at' && st.name === 'keyframes') {
        const nm = st.prelude.replace(/^@keyframes\s+/, '').trim();
        if (!names.has('*') && !names.has(nm)) {
          removed.push({ kind: 'keyframes', name: nm, bytes: st.text.length });
          continue;
        }
        out.push(st);
        continue;
      }
      if (st.type === 'at' && st.body) {
        const inner = walk(st.body);
        if (!inner.length) {
          removed.push({ kind: 'empty-at', prelude: st.prelude, bytes: st.text.length });
          continue;
        }
        out.push({ ...st, body: inner, rebuilt: true });
        continue;
      }
      out.push(st);
    }
    return out;
  };
  return walk(statements);
}

function serialize(statements, indent = '') {
  return statements.map((st) => {
    const comment = st.comment ? `${st.comment.replace(/^\s+/, '')}` : '';
    if (st.type === 'at' && st.body) {
      const inner = serialize(st.body, `${indent}  `);
      return `${comment}${indent}${st.prelude} {\n${inner}\n${indent}}`;
    }
    const text = st.rebuilt ? st.text : st.text.replace(/^\s+/, '');
    return `${comment}${indent}${text}`;
  }).join('\n');
}

/**
 * Prune one stylesheet.
 * @returns {{css:string, removed:Array, before:number, after:number}}
 */
export function pruneCss(css, { used, stems }) {
  const statements = parseStatements(css);
  const removed = [];
  const first = pruneList(statements, used, stems, removed);
  const second = pruneKeyframes(first, removed);
  const out = serialize(second);
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  return {
    css: out,
    removed,
    /* BYTES, not characters: these sheets carry Persian comments, where one
       character is two bytes, and the number that matters is what a phone
       downloads. */
    before: bytes(css),
    after: bytes(out)
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   CLI
   ──────────────────────────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const json = args.includes('--json');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: node scripts/css-diet.mjs [--write|--check|--json] <stylesheet> [...]');
    process.exitCode = 2;
    return;
  }

  /*
   * THE CORPUS: what can name a class.
   *   · every module reachable from the app's entry (src/main.jsx, index.html)
   *     — an unreachable component cannot put a class on an element;
   *   · everything under test/, scripts/, server/ and public/, and the root's
   *     preview pages — a pinned selector, a generated landing page and a
   *     design artifact all count as a usage.
   */
  const reachable = reachableModules();
  const always = corpusFiles(targets).filter((f) => !f.startsWith(path.join(ROOT, 'src') + path.sep));
  const files = [...new Set([...reachable, ...always])].filter((f) => {
    const skip = new Set(targets.map((t) => path.resolve(ROOT, t)));
    return !skip.has(f) && statSync(f).isFile();
  });
  const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  if (!json) console.error(`corpus: ${files.length} files (${(corpus.length / 1e6).toFixed(1)}M chars), ${reachable.size} reachable modules`);
  const stems = dynamicStems(corpus);
  const used = new Set();
  /* A class is "used" when its NAME appears anywhere in the corpus. The corpus
     is text, not a DOM, so this is deliberately blunt in the safe direction: a
     class mentioned in a comment, a locale string or another stylesheet is
     kept. */
  for (const file of targets) {
    const css = readFileSync(path.resolve(ROOT, file), 'utf8');
    for (const cls of classesIn(css)) {
      if (corpus.includes(cls) || isDynamic(cls, stems)) used.add(cls);
    }
  }

  let deadFiles = 0;
  for (const file of targets) {
    const abs = path.resolve(ROOT, file);
    const css = readFileSync(abs, 'utf8');
    const out = pruneCss(css, { used, stems });
    const saved = out.before - out.after;
    if (out.removed.length) deadFiles += 1;
    if (json) {
      console.log(JSON.stringify({
        file,
        before: out.before,
        after: out.after,
        saved,
        pct: Number(((saved / out.before) * 100).toFixed(1)),
        removedRules: out.removed.filter((r) => r.kind === 'rule').length,
        removedKeyframes: out.removed.filter((r) => r.kind === 'keyframes').length,
        removed: out.removed.map((r) => (r.kind === 'rule' ? r.selectors.join(', ') : `${r.kind}:${r.name ?? r.prelude ?? ''}`))
      }, null, 2));
    } else {
      console.log(`${file}: ${out.before} → ${out.after} bytes (−${saved}, −${((saved / out.before) * 100).toFixed(1)}%)`);
      const byKind = {};
      for (const r of out.removed) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      console.log(`  removed: ${JSON.stringify(byKind)}`);
      for (const r of out.removed.slice(0, 40)) {
        console.log(`    · ${r.kind === 'rule' ? r.selectors.join(', ') : `${r.kind} ${r.name ?? r.prelude ?? ''}`.trim()} (${r.bytes}B)`);
      }
      if (out.removed.length > 40) console.log(`    … ${out.removed.length - 40} more`);
    }
    if (write && out.removed.length) {
      writeFileSync(abs, `${out.css.replace(/\s+$/, '')}\n`, 'utf8');
    }
  }
  if (check && deadFiles) {
    console.error(`css-diet: ${deadFiles} stylesheet(s) still carry rules for markup that does not exist`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
