import { useCallback, useEffect, useState } from 'react';
import { newCommitment, sha256Hex } from '../lib/fairness';

/**
 * Holds one commit–reveal session (server seed + hash + client seed + nonce)
 * and rotates it whenever the player changes their client seed.
 */
export function useFairSession() {
  const [session, setSession] = useState(null);
  const [revealed, setRevealed] = useState(null);

  useEffect(() => {
    let ok = true;
    newCommitment().then((c) => ok && setSession(c));
    return () => {
      ok = false;
    };
  }, []);

  const nextNonce = useCallback(() => {
    let n = 0;
    setSession((s) => {
      if (!s) return s;
      n = s.nonce + 1;
      return { ...s, nonce: n };
    });
    return n;
  }, []);

  const setClientSeed = useCallback((clientSeed) => {
    setSession((s) => (s ? { ...s, clientSeed, nonce: 0 } : s));
  }, []);

  const rotate = useCallback(async () => {
    const old = session;
    if (old) setRevealed({ serverSeed: old.serverSeed, hash: old.hash, rounds: old.nonce });
    const c = await newCommitment();
    setSession(c);
    return c;
  }, [session]);

  const verify = useCallback(async (serverSeed, hash) => (await sha256Hex(serverSeed)) === hash, []);

  return { session, revealed, nextNonce, setClientSeed, rotate, verify };
}
