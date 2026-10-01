// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import ar from '../src/i18n/locales/ar.json';
import es from '../src/i18n/locales/es.json';
import fr from '../src/i18n/locales/fr.json';
import hi from '../src/i18n/locales/hi.json';
import id from '../src/i18n/locales/id.json';
import pt from '../src/i18n/locales/pt.json';
import ru from '../src/i18n/locales/ru.json';
import tr from '../src/i18n/locales/tr.json';
import ur from '../src/i18n/locales/ur.json';
import zh from '../src/i18n/locales/zh.json';
import ConnectivityAlert from '../src/components/ConnectivityAlert';
import { classifyConnection } from '../src/lib/connectivity';
import { CONNECTIVITY_FALLBACKS } from '../src/i18n/connectivityFallbacks';

vi.mock('../src/lib/apiBase', () => ({ apiBase: () => '/api' }));

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
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
              Object.entries(props).filter(([key]) => !['initial', 'animate', 'exit', 'transition'].includes(key))
            );
            return ReactModule.createElement(Tag, clean, children);
          });
        }
        return components.get(tag);
      }
    })
  };
});

const i18n = i18next.createInstance();
const okResponse = () => ({ ok: true, json: async () => ({ ok: true }) });
const initialDocumentLanguage = document.documentElement.lang;
const localeBundles = { en, fa, ar, es, fr, hi, id, pt, ru, tr, ur, zh };
const originalOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
const originalConnection = Object.getOwnPropertyDescriptor(window.navigator, 'connection');

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function renderAlert() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ConnectivityAlert />
    </I18nextProvider>
  );
}

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      fa: { translation: fa }
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  });
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  setOnline(true);
  Object.defineProperty(window.navigator, 'connection', { configurable: true, value: undefined });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (originalOnline) Object.defineProperty(window.navigator, 'onLine', originalOnline);
  else delete window.navigator.onLine;
  if (originalConnection) Object.defineProperty(window.navigator, 'connection', originalConnection);
  else delete window.navigator.connection;
  document.documentElement.lang = initialDocumentLanguage;
});

describe('offline alert translations', () => {
  it('keeps the compact offline fallback synchronized with every locale bundle', () => {
    for (const [language, locale] of Object.entries(localeBundles)) {
      expect(CONNECTIVITY_FALLBACKS[language]).toEqual(locale.connectivityAlert);
    }
  });
});

describe('connection quality detection', () => {
  it('treats an explicit browser offline signal as offline', () => {
    expect(classifyConnection({ onLine: false })).toBe('offline');
  });

  it('recognises slow connections where Network Information API is available', () => {
    expect(classifyConnection({ onLine: true, connection: { effectiveType: '2g' } })).toBe('weak');
    expect(classifyConnection({ onLine: true, connection: { effectiveType: '4g', rtt: 2200 } })).toBe('weak');
    expect(classifyConnection({ onLine: true, connection: { effectiveType: '4g', downlink: 0.2 } })).toBe('weak');
  });

  it('keeps healthy and unsupported browsers usable', () => {
    expect(classifyConnection({ onLine: true })).toBe('online');
    expect(classifyConnection({ onLine: true, connection: { effectiveType: '4g', rtt: 90, downlink: 8 } })).toBe('online');
  });
});

describe('the full-screen connectivity alert', () => {
  it('shows the selected Persian copy and pins the acknowledgement to the footer', async () => {
    await i18n.changeLanguage('fa');
    setOnline(false);
    renderAlert();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('connectivity-alert-title');
    expect(screen.getByRole('heading', { name: fa.connectivityAlert.offlineTitle })).toBeTruthy();
    expect(dialog.textContent).toContain(fa.connectivityAlert.offlineBody);

    const acknowledge = screen.getByRole('button', { name: fa.connectivityAlert.acknowledge });
    expect(acknowledge.closest('footer')?.className).toContain('connectivity-alert-footer');
    expect(acknowledge.textContent).toContain('متوجه شدم');
  });

  it('keeps the chosen language on an offline cold start before its lazy locale file loads', async () => {
    const englishOnly = i18next.createInstance();
    await englishOnly.use(initReactI18next).init({
      resources: { en: { translation: en } },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false }
    });
    document.documentElement.lang = 'fa';
    setOnline(false);

    render(
      <I18nextProvider i18n={englishOnly}>
        <ConnectivityAlert />
      </I18nextProvider>
    );

    expect(await screen.findByRole('heading', { name: fa.connectivityAlert.offlineTitle })).toBeTruthy();
    expect(screen.getByRole('button', { name: fa.connectivityAlert.acknowledge })).toBeTruthy();
  });

  it('uses the weak-connection message when the browser reports 2G', async () => {
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '2g', addEventListener: vi.fn(), removeEventListener: vi.fn() }
    });
    renderAlert();

    expect(await screen.findByRole('heading', { name: en.connectivityAlert.weakTitle })).toBeTruthy();
    expect(screen.getByRole('alertdialog').textContent).toContain(en.connectivityAlert.transactionNote);
  });

  it('can be acknowledged without reopening until the connection recovers', async () => {
    setOnline(false);
    renderAlert();
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: en.connectivityAlert.acknowledge }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    /* A real recovery probe clears the acknowledgement, so a later outage is
       announced again instead of leaving the warning permanently suppressed. */
    setOnline(true);
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    setOnline(false);
    fireEvent(window, new Event('offline'));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('detects an unreachable app endpoint even when the browser says it is online', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    setOnline(true);

    await act(async () => {
      renderAlert();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(screen.getByRole('heading', { name: en.connectivityAlert.weakTitle })).toBeTruthy();
  });

  it('uses the translated I understand label in English', async () => {
    setOnline(false);
    renderAlert();
    expect(await screen.findByRole('button', { name: en.connectivityAlert.acknowledge })).toBeTruthy();
  });
});
