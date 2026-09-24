// @vitest-environment jsdom
/**
 * PROXY ADVICE — «در صفحه ولکام پس انتخاب زبان فارسی یک پاپ هشدار مدرن بیاد
 * که بگه چون خیلی امکانات ما بر روی بستر خارج هست بهتر است از پروکسی استفاده
 * کنید».
 *
 * The advice is worth exactly as much as its timing: it has to arrive BEFORE
 * the first quote, the first bridge and the first AI answer time out against
 * a host the network cannot reach. After that it is not advice, it is an
 * excuse — the user has already concluded the app is broken.
 *
 * What is locked here:
 *
 *   1. Persian opens it, another language does not (this is advice for the one
 *      market whose connections are filtered, not a modal everyone must click
 *      through);
 *   2. it is a real MODAL in front of the whole stage — portalled, because the
 *      welcome screen is built out of animated, transformed layers and a
 *      `position: fixed` child of a transformed ancestor is positioned against
 *      that ancestor instead of the viewport;
 *   3. it is not a gate: closing it changes nothing, the language stays
 *      chosen, and Continue still works.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import { LANGUAGES } from '../src/i18n/languages';
import Welcome from '../src/pages/Welcome';

const setLanguage = vi.fn();

/* The real `t`, the real fa bundle — the popup's wording is the feature, so
   the test reads the same string the user will read. */
const t = (key, values = {}) => {
  const found = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), fa);
  let text = typeof found === 'string' ? found : undefined;
  if (text == null && typeof values === 'string') text = values;
  if (text == null) text = key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    values && typeof values === 'object' ? (values[k] ?? '') : '');
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } })
}));

/* `src/i18n/index.js` boots i18next and dynamically imports every locale;
   only the static registry is needed here. */
vi.mock('../src/i18n', async () => ({
  LANGUAGES: (await import('../src/i18n/languages')).LANGUAGES,
  RTL_LANGS: (await import('../src/i18n/languages')).RTL_LANGS,
  SUPPORTED: (await import('../src/i18n/languages')).SUPPORTED,
  setLanguage: (...args) => setLanguage(...args)
}));

/* Motion is stripped to its DOM: the assertions are about the popup being
   there, not about how it eases in. */
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => false,
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(
              Object.entries(props).filter(([k]) => ![
                'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'
              ].includes(k))
            );
            return React.createElement(Tag, clean, children);
          });
        }
        return components.get(tag);
      }
    })
  };
});

const renderWelcome = () =>
  render(
    <MemoryRouter>
      <Welcome onDone={() => {}} />
    </MemoryRouter>
  );

/** Click the row for `code` in the language list. */
const pickLanguage = (code) => {
  const index = LANGUAGES.findIndex((l) => l.code === code);
  const rows = document.querySelectorAll('.lang-row');
  fireEvent.click(rows[index]);
};

afterEach(() => {
  cleanup();
  setLanguage.mockClear();
});

describe('the proxy advice on the language screen', () => {
  it('offers it the moment Persian is chosen', () => {
    renderWelcome();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    pickLanguage('fa');
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(fa.welcome.proxy.title);
    expect(dialog.textContent).toContain(fa.welcome.proxy.body);
  });

  it('says WHY — most of the app runs outside the country — and names the fix', () => {
    renderWelcome();
    pickLanguage('fa');
    const text = screen.getByRole('alertdialog').textContent;
    /* «سرورهای خارج از کشور» is the reason; «فیلترشکن» is the word everyone in
       this market already knows for the fix. Advice that only says the first
       half is a complaint; advice that only says the second is jargon. */
    expect(text).toContain('خارج از کشور');
    expect(text).toContain('فیلترشکن');
    expect(text).toContain('پروکسی');
    expect(text).toContain('VPN');
  });

  it('reassures about what happens if they ignore it, rather than just warning', () => {
    renderWelcome();
    pickLanguage('fa');
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(fa.welcome.proxy.note);
    /* The failure mode must be described as the network's, not the app's —
       and never as a risk to money. */
    expect(fa.welcome.proxy.note).toContain('شبکه');
    expect(fa.welcome.proxy.note).not.toContain('دارایی شما از بین');
  });

  it('does not open for a language whose readers are not behind that filter', () => {
    renderWelcome();
    pickLanguage('en');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is a MODAL in front of the whole stage, not a child of the language column', () => {
    const { container } = renderWelcome();
    pickLanguage('fa');
    const dialog = screen.getByRole('alertdialog');
    /* Portalled to <body>: the welcome stage animates `transform`, which makes
       it the containing block for any fixed descendant — an un-portalled popup
       would be positioned against the animation instead of the screen. */
    expect(dialog.closest('.welcome-stage')).toBeNull();
    expect(container.querySelector('.proxyadv-card')).toBeNull();
    expect(document.body.querySelector('.proxyadv-card')).toBe(dialog);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('proxyadv-title');
  });

  it('names its own text for a screen reader, so the advice is announced, not just drawn', () => {
    renderWelcome();
    pickLanguage('fa');
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-describedby')).toBe('proxyadv-body');
    expect(dialog.querySelector('#proxyadv-body').textContent).toBe(fa.welcome.proxy.body);
  });

  it('closes on its own button — and the language that was chosen stays chosen', () => {
    renderWelcome();
    pickLanguage('fa');
    expect(setLanguage).toHaveBeenCalledWith('fa');
    fireEvent.click(screen.getByRole('button', { name: fa.welcome.proxy.cta }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(setLanguage).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    renderWelcome();
    pickLanguage('fa');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is advice, not a gate: it never blocks Continue', () => {
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <Welcome onDone={onDone} />
      </MemoryRouter>
    );
    pickLanguage('fa');
    /* Continue is clicked while the advice is still open — the popup is not a
       step in the flow and must not become one. */
    fireEvent.click(document.querySelector('.welcome-foot .onb-btn'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
