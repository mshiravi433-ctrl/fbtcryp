import { useAppStore } from '../store/useAppStore';
import { tierFor } from '../lib/ranks';

/**
 * The user's reputation points and the tier they produce.
 *
 * ─── WHY THIS HOOK EXISTS RATHER THAN A DIRECT STORE READ ───────────────────
 * Adding a rank medal to the header meant the header needed `points`, and
 * `points` lives in `useAppStore` — the same store that holds `balance`, the
 * play-money NX credits used by the arcade and paper-trading screens.
 *
 * Wiring section 21 forbids `useAppStore` in Header.jsx outright, and that
 * check is right to be blunt. The header once displayed that virtual balance
 * beside the brand on every page, so the first number a user saw on a
 * non-custodial exchange was fake money that looked like theirs. The rule
 * exists because the nuanced version of it — "only read the safe fields" — is
 * exactly the rule that erodes one field at a time.
 *
 * So the header does not get access to the store; it gets access to a score.
 * This hook is the narrow opening: it exposes `points` and the derived tier
 * and nothing else, so no future edit in the header can reach `balance`
 * without deliberately importing the store and failing the check again.
 *
 * `points` is a SCORE and never a currency — see lib/ranks.js. That is also
 * why the header renders only the medal and not the number: a total beside the
 * brand would read as a balance, which is the very confusion being avoided.
 */
export function usePoints() {
  const points = useAppStore((s) => s.points);
  return { points, tier: tierFor(points) };
}
