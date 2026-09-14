// @vitest-environment jsdom
/**
 * «با وجود زبان انگلیسی در هوش مصنوعی باز این جمله فارسیه — سلام من AI هستم…»
 *
 * THE AI GREETING MUST SPEAK THE LANGUAGE THE USER PICKED.
 *
 * Two separate defects produced that one Persian sentence in an English app:
 *
 *   1. THE GREETING WAS BAKED IN WHEN THE THREAD STARTED. The hello was stored
 *      as a literal string inside the message, and the thread is persisted and
 *      restored (`loadThreadSnapshot`). A device that had once run in Persian
 *      therefore reopened every later English session with a Persian greeting,
 *      and switching the language changed everything on screen except the one
 *      line the user was complaining about. The fix is to translate the hello
 *      at RENDER time — `m.kind === 'hello'` is re-read from the dictionary —
 *      so it follows the picker instantly, restored threads included.
 *
 *   2. NINE LANGUAGES HAD NO TRANSLATION AND A PERSIAN DEFAULT. The call read
 *      `t('intentAIOS.hello', { defaultValue: 'سلام! من Intent AI هستم…' })`,
 *      and es/fr/hi/id/pt/ru/tr/ur/zh had no `intentAIOS` block at all — so
 *      i18next never fell back to English, it fell back to the Persian
 *      defaultValue. A default is a last resort, and a last resort written in
 *      one specific language is a language bug, not a safety net. Those nine
 *      locales now carry the block, and every Persian defaultValue in the AI
 *      panel is gone (asserted below, so it cannot come back).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../src/context/WalletContext', () => ({ useWallet: () => ({ isConnected: false, address: null }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k, i18n: { language: 'en' } }) }));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});

import { ConversationRow } from '../src/components/IntentAIUnified';

/*
 * Plain paths, not `import.meta.url`: under the jsdom environment that file is
 * an http-style URL and `new URL(...)` throws "The URL must be of scheme file".
 * Vitest always runs from the repository root, so cwd-relative is the honest
 * anchor here.
 */
const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, 'src/i18n/locales');
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const readLocale = (code) => JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8'));
const ALL_LOCALES = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

/* A `t` that answers from one real locale file, the way the app's does. */
const translator = (code) => {
  const dict = readLocale(code);
  return (key, values = {}) => {
    const text = key.split('.').reduce((o, k) => o?.[k], dict);
    return String(text ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
  };
};

/** The exact message a thread persisted while the app was in Persian. */
const PERSIAN_HELLO_ON_DISK = {
  id: 'm1',
  role: 'ai',
  kind: 'hello',
  content: 'سلام! من Intent AI هستم. درباره کیف پول، بازار یا هر هدف مالی‌ات صحبت کن.',
  ui: { type: 'TEXT' }
};

const rowProps = (m, t, locale) => ({
  m, t, locale,
  onConnectWallet: () => {}, onChoose: () => {}, onMonitorAction: () => {},
  onMonitorOpportunity: () => {}, onFeedback: () => {}, onOpenRoute: () => {},
  onGoalExecute: () => {}, onStrategyExecute: () => {}, onStrategyMonitor: () => {},
  onStrategyRevise: () => {}, strategyLive: false, autonomyEngine: null,
  autonomyStrategies: [], onAutonomyArm: () => {}, onAutonomyDisarm: () => {},
  onAutonomyMode: () => {}, onAutonomyStart: () => {}, onAutonomyStop: () => {},
  onAutonomyTick: () => {}
});

const textOf = (m, code) => {
  const { container } = render(<ConversationRow {...rowProps(m, translator(code), code)} />);
  const out = container.querySelector('.iaos-msg-text')?.textContent ?? '';
  cleanup();
  return out;
};

describe('the AI greeting follows the selected language', () => {
  it('renders an English session in English even when the stored thread is Persian', () => {
    const shown = textOf(PERSIAN_HELLO_ON_DISK, 'en');
    expect(shown).toBe(readLocale('en').intentAIOS.hello);
    expect(ARABIC_SCRIPT.test(shown)).toBe(false);
  });

  it.each(ALL_LOCALES)('greets in %s, never in the language the thread was written in', (code) => {
    const shown = textOf(PERSIAN_HELLO_ON_DISK, code);
    expect(shown).toBe(readLocale(code).intentAIOS.hello);
    if (code !== 'fa' && code !== 'ar' && code !== 'ur') expect(ARABIC_SCRIPT.test(shown)).toBe(false);
  });

  it('still says the Persian greeting when Persian is what the user picked', () => {
    const shown = textOf({ ...PERSIAN_HELLO_ON_DISK, content: 'Hi — I am Intent AI.' }, 'fa');
    expect(shown).toBe(readLocale('fa').intentAIOS.hello);
    expect(ARABIC_SCRIPT.test(shown)).toBe(true);
  });

  it('leaves every real turn exactly as it was stored', () => {
    /* Only the greeting is re-translated. A user's own words and the answers
       already given are history — rewriting them would be forgery. */
    const turn = { id: 'm2', role: 'user', kind: 'user', content: 'BTC بخر', ui: { type: 'TEXT' } };
    expect(textOf(turn, 'en')).toBe('BTC بخر');
    const answer = { id: 'm3', role: 'ai', kind: 'assistant', content: 'Quote ready — 0.01 BTC.', ui: { type: 'TEXT' } };
    expect(textOf(answer, 'fa')).toBe('Quote ready — 0.01 BTC.');
  });
});

describe('no language can fall back into Persian by accident', () => {
  it.each(ALL_LOCALES)('%s translates the whole Intent AI surface', (code) => {
    const en = readLocale('en').intentAIOS;
    const dict = readLocale(code).intentAIOS ?? {};
    for (const key of Object.keys(en)) {
      expect(dict[key], `${code}.intentAIOS.${key}`).toBeTruthy();
    }
    if (code === 'en') return;
    /*
     * A block that is still English pasted under another file name is the
     * failure this catches — but NOT by demanding every string differ. Some
     * words are legitimately the same in two languages («Actions» is correct
     * French, «Intent AI» is a brand everywhere), and a test that rejects
     * those produces a false alarm the next person silences by weakening it.
     * So: the greeting itself must be translated, and the block as a whole
     * must be overwhelmingly not-English.
     */
    expect(dict.hello).not.toBe(en.hello);
    const same = Object.keys(en).filter((key) => dict[key] === en[key]);
    expect(same.length / Object.keys(en).length).toBeLessThan(0.25);
  });

  it('the only Persian greeting lives in the Persian file', () => {
    for (const code of ALL_LOCALES) {
      const hello = readLocale(code).intentAIOS?.hello ?? '';
      expect(ARABIC_SCRIPT.test(hello), `${code}.intentAIOS.hello`).toBe(['fa', 'ar', 'ur'].includes(code));
    }
  });

  it('the AI panel no longer carries a Persian defaultValue to leak', () => {
    const source = readFileSync(join(ROOT, 'src/components/IntentAIUnified.jsx'), 'utf8');
    const defaults = [...source.matchAll(/defaultValue:\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2]);
    const persian = defaults.filter((d) => ARABIC_SCRIPT.test(d));
    expect(persian).toEqual([]);
    // And every key the panel asks for exists in the always-loaded English
    // bundle — that is what makes dropping the defaults safe rather than a
    // raw-key regression.
    const en = readLocale('en');
    const keys = new Set([...source.matchAll(/t\('(intentAIOS\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.split('.').reduce((o, k) => o?.[k], en), key).toBeTruthy();
    }
  });
});
