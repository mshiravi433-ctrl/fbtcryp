import { createContext, useContext, useEffect, useState } from 'react';

const TelegramContext = createContext(null);

export function TelegramProvider({ children }) {
  const [user, setUser] = useState(null);
  const tg = window?.Telegram?.WebApp;

  useEffect(() => {
    if (!tg) return; // running outside Telegram, e.g. in a normal browser during dev
    tg.ready();
    tg.expand();
    setUser(tg.initDataUnsafe?.user ?? null);

    // Match the Mini App chrome to our own theme rather than the default Telegram one.
    tg.setHeaderColor?.('#0b1220');
    tg.setBackgroundColor?.('#0b1220');
  }, [tg]);

  return (
    <TelegramContext.Provider value={{ tg, user }}>
      {children}
    </TelegramContext.Provider>
  );
}

export const useTelegram = () => useContext(TelegramContext);
