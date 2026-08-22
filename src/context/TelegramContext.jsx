import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { captureReferral } from '../lib/referral';

const TelegramContext = createContext(null);

/**
 * Thin wrapper over `window.Telegram.WebApp`.
 * Everything degrades silently when the app runs in a normal browser so the
 * same build works for local development and inside Telegram.
 */
export function TelegramProvider({ children }) {
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!tg) return;
    tg.ready();
    tg.expand?.();
    tg.disableVerticalSwipes?.(); // stops the sheet closing while dragging charts
    setUser(tg.initDataUnsafe?.user ?? null);

    /*
     * A direct Main Mini App link carries `startapp=CODE`; Telegram makes that
     * value available only inside the signed Web App payload. Capture it here
     * after the provider has access to initDataUnsafe. The referral module is
     * first-touch-wins, so this cannot overwrite a normal ?ref= link or a
     * previously attributed user.
     */
    captureReferral('', tg.initDataUnsafe?.start_param);

    // Force our own black chrome instead of the user's Telegram theme.
    tg.setHeaderColor?.('#000000');
    tg.setBackgroundColor?.('#000000');
    tg.setBottomBarColor?.('#06070c');
  }, [tg]);

  const haptic = useCallback(
    (style = 'light') => {
      const h = tg?.HapticFeedback;
      if (!h) return;
      if (style === 'success' || style === 'error' || style === 'warning') h.notificationOccurred?.(style);
      else if (style === 'select') h.selectionChanged?.();
      else h.impactOccurred?.(style);
    },
    [tg]
  );

  const share = useCallback(
    (url, text) => {
      const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text ?? '')}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(link);
      else window.open(link, '_blank', 'noopener');
    },
    [tg]
  );

  const value = useMemo(
    () => ({
      tg,
      user,
      isTelegram: Boolean(tg?.initData),
      haptic,
      share,
      close: () => tg?.close?.()
    }),
    [tg, user, haptic, share]
  );

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}

export const useTelegram = () => useContext(TelegramContext) ?? {};
