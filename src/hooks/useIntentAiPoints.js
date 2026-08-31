/**
 * useIntentAiPoints — the AI pays you back, in the app's own currency.
 * ---------------------------------------------------------------------------
 * Reported as: «ندادن امتیاز بهم هوش مصنوعی». Points are the app's
 * reputation score (src/lib/ranks.js, shown on /rewards), and using the
 * assistant earns them like every other real activity:
 *
 *   · a structured plan that reaches the confirmation screen → intentAiPlan
 *   · an intent that actually reaches a network (real txHash)    → intentAiExecuted
 *
 * Awards are deduplicated per key (terms hash / tx hash), so re-rendering or
 * re-opening a screen never mints points twice, and the award itself goes
 * through the SAME store every other points source uses — the total on
 * /rewards and the leaderboard move together with the AI panel.
 */
import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { POINT_VALUES } from '../lib/ranks';

export function useIntentAiPoints() {
  const points = useAppStore((s) => s.points);
  const [lastGain, setLastGain] = useState(null);
  const awardedKeys = useRef(new Set());

  const award = useCallback((key, action) => {
    const value = POINT_VALUES[action];
    if (!(value > 0)) return false;
    if (key) {
      if (awardedKeys.current.has(key)) return false;
      awardedKeys.current.add(key);
    }
    const store = useAppStore.getState();
    store.awardPoints(action, value, { source: 'intent-ai' });
    store.notify('pointsEarned', 'success', { amount: value, source: 'intent-ai' });
    setLastGain({ amount: value, action, at: Date.now() });
    return true;
  }, []);

  return { points, lastGain, award };
}

export default useIntentAiPoints;
