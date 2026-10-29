// @vitest-environment jsdom
/** The real FCM data-to-foreground-card path, with only Capacitor mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { androidPresentation } from '../src/lib/notificationDesign.js';
import { useAppStore } from '../src/store/useAppStore.js';

const { native } = vi.hoisted(() => ({ native: { listeners: {}, permission: 'denied' } }));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: async (name, callback) => {
      native.listeners[name] = callback;
      return { remove: () => { delete native.listeners[name]; } };
    }
  }
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: async () => ({ remove() {} }),
    checkPermissions: async () => ({ display: native.permission }),
    requestPermissions: async () => ({ display: native.permission }),
    schedule: vi.fn()
  }
}));

const { initNativePushListeners, previewNotification } = await import('../src/lib/notify.js');
let dispose;

beforeEach(async () => {
  window.Capacitor = { isNativePlatform: () => true };
  localStorage.setItem('fbt-notify-v1', JSON.stringify({ sound: false, vibrate: false }));
  useAppStore.setState({ notifBar: [], inbox: [] });
  native.permission = 'denied';
  dispose = await initNativePushListeners();
});
afterEach(() => {
  dispose?.();
  delete window.Capacitor;
  native.listeners = {};
});

describe('foreground native FCM', () => {
  it('delivers the value, label, kicker, progress and safe destination to the card', async () => {
    const payload = {
      title: 'هدف رسید', body: 'قیمت تغییر کرد', tone: 'profit', stage: 'ready',
      value: '+12.4%', label: 'BTC > USDT', kicker: 'TARGET HIT', progress: 68,
      url: '/#/coin/bitcoin'
    };
    const presentation = androidPresentation(payload, 'fa', { origin: 'https://fbtswap.ir' });
    expect(Object.values(presentation.data).every((v) => typeof v === 'string')).toBe(true);
    native.listeners.pushNotificationReceived({ title: payload.title, body: payload.body, data: presentation.data });
    await vi.waitFor(() => expect(useAppStore.getState().notifBar).toHaveLength(1));
    expect(useAppStore.getState().notifBar[0]).toMatchObject({
      title: payload.title, tone: 'profit', value: '+12.4%', label: 'BTC > USDT',
      kicker: 'TARGET HIT', progress: 68, link: '/#/coin/bitcoin'
    });
  });

  it('keeps older payloads working without creating a false 0% rail', async () => {
    native.listeners.pushNotificationReceived({ title: 'خبر', data: { stage: 'ready', url: '/#/orders' } });
    await vi.waitFor(() => expect(useAppStore.getState().notifBar).toHaveLength(1));
    expect(useAppStore.getState().notifBar[0]).toMatchObject({
      tone: 'ready', label: '', kicker: 'READY', progress: null
    });
  });

  it('removes the foreground listener on cleanup so reinitialising cannot duplicate cards', () => {
    expect(native.listeners.pushNotificationReceived).toBeTypeOf('function');
    dispose();
    dispose = null;
    expect(native.listeners.pushNotificationReceived).toBeUndefined();
  });

  it('reports a denied native preview instead of claiming it was sent', async () => {
    expect(await previewNotification('info', { lang: 'en' })).toEqual({ ok: false, via: 'none' });
  });
});
