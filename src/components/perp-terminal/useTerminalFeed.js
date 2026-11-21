import { useEffect, useRef, useState } from 'react';
import { isPollHidden, pollWhileVisible } from '../../lib/visibilityPoll';

/** Only poll the active feed, never overlap reads, and never show another market's data. */
export default function useTerminalFeed(key, read, interval, revision) {
  const [snapshot, setSnapshot] = useState(null);
  const pending = useRef(new Map());
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let inFlight = false;
    const load = async () => {
      if (stopped || inFlight || isPollHidden()) return;
      inFlight = true;
      try {
        let request = pending.current.get(key);
        if (!request) {
          request = Promise.resolve().then(() => read(key));
          pending.current.set(key, request);
        }
        let value;
        try { value = await request; } finally {
          if (pending.current.get(key) === request) pending.current.delete(key);
        }
        if (!stopped) setSnapshot((previous) => ({
          key, value, failed: !value?.live,
          lastGood: value?.live ? value : previous?.key === key ? previous.lastGood : null
        }));
      } catch {
        if (!stopped) setSnapshot((previous) => ({ key, failed: true, lastGood: previous?.key === key ? previous.lastGood : null }));
      } finally { inFlight = false; }
    };
    const stop = pollWhileVisible(load, interval);
    load();
    return () => { stopped = true; stop(); };
  }, [key, read, interval, revision]);
  return key && snapshot?.key === key ? snapshot : null;
}
