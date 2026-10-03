import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { loanErrorText } from '../lib/loanErrors';

const LIFETIME = 3200;

/**
 * A toast is raised with a KEY (`notify('loan.error.MARKET_PAUSED')`) and the
 * host renders it under the `toast.` namespace. That prefix is right for the
 * generic notifications and WRONG for anything a page namespaces itself:
 * `toast.loan.error.MARKET_PAUSED` does not exist and cannot exist, so `t`
 * gave back the defaultValue — the key itself — and the user read
 * `loan.error.MARKET_PAUSED` in red over a Persian UI («سه‌جا با استرینگ هست به
 * جای زبان درست»).
 *
 * The loan page owns its error sentences under `loan.error.*`, so those keys
 * are resolved through the loan door instead of being assumed to live under
 * `toast.`. Everything else, and every translation that DOES exist under
 * `toast.`, behaves exactly as before.
 */
const LOAN_NAMESPACE = 'loan.';

/**
 * A MISSING SENTINEL, NOT AN EMPTY STRING.
 *
 * ─── THE BUG THIS REPLACES (reported: «در سفارش سولانا ارورها را به صورت
 *     استرینگ میزنه یا هشدار را») ───────────────────────────────────────────
 * The resolver used to test whether the shared namespace had an answer with
 *
 *     const shared = t(`toast.${raw}`, { defaultValue: '' });
 *     if (shared) return shared;
 *
 * and src/i18n/index.js sets `returnEmptyString: false` — deliberately, so a
 * locale that has an empty translation shows the key rather than a blank
 * toast. The two settings collide exactly on the missing-key path: i18next
 * never returned the empty default, it returned the KEY, `toast.<raw>`, which
 * is a non-empty string, so `if (shared)` was always true and every toast
 * raised with a namespaced key printed its own key path.
 *
 * That is not a Loan-only problem, whatever the earlier fix assumed. The
 * Solana order card on AUTO ORDERS raises `orders.solana.notice` (its
 * success message) and `orders.solana.err.BAD_AMOUNT` / `SAME_TOKEN` — all
 * three written and translated in twelve locales, and all three rendered as
 * the literal text `toast.orders.solana.notice` over the UI. Same for
 * `orders.revisionReview`, raised by the DCA revision flow.
 *
 * A sentinel cannot be confused with a translation, an empty string or a key,
 * so the check is now unambiguous no matter how i18next is configured.
 */
const MISSING = '\u0000__fbt_missing__\u0000';

/**
 * Resolve one notification key.
 *
 * Order, and why it is this order:
 *   1. `toast.<key>` — the shared namespace, where every generic notification
 *      lives. Never skipped, so nothing that used to resolve can stop.
 *   2. `t(<key>)` ITSELF — the page-owned namespace. This is the door that was
 *      missing: pages name their own messages after themselves
 *      (`orders.solana.notice`, `orders.revisionReview`, `loan.chooseAssetFirst`,
 *      `loan.error.MARKET_PAUSED`), and those keys are real, translated, root
 *      keys — they simply never lived under `toast.`. Without this step the
 *      sentinel above falls straight through to step 4 and the user reads a
 *      key path.
 *   3. `loanErrorText` — for a loan code that has no sentence yet: a translated
 *      generic that carries the code, instead of the code alone.
 *   4. the raw key, last: if i18n has nothing at all to say, showing the key is
 *      still better than showing an empty toast. This is now genuinely rare
 *      rather than the normal path for anything namespaced.
 */
/* Exported for the l10n contract test (test/loan-errors-l10n.test.js): the
   toast host is a resolver, and a resolver is worth testing without a DOM. */
export function toastTextForTest(t, key, values) {
  return toastText(t, key, values);
}

function toastText(t, key, values) {
  const raw = String(key ?? '');
  if (!raw) return '';

  const shared = t(`toast.${raw}`, { defaultValue: MISSING, ...values });
  if (shared && shared !== MISSING) return shared;

  const own = t(raw, { defaultValue: MISSING, ...values });
  if (own && own !== MISSING) return own;

  if (raw.startsWith(LOAN_NAMESPACE)) return loanErrorText(t, raw, values);
  return raw;
}

function Toast({ item }) {
  const { t } = useTranslation();
  const dismiss = useAppStore((s) => s.dismiss);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), LIFETIME);
    return () => clearTimeout(timer);
  }, [item.id, dismiss]);

  return (
    <motion.div
      layout
      className={`toast toast-${item.kind}`}
      initial={{ opacity: 0, y: -22, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
    >
      {toastText(t, item.key, item.values)}
    </motion.div>
  );
}

export default function Toasts() {
  const notifications = useAppStore((s) => s.notifications);
  return (
    <div className="toast-host">
      <AnimatePresence initial={false}>
        {notifications.slice(0, 3).map((n) => (
          <Toast key={n.id} item={n} />
        ))}
      </AnimatePresence>
    </div>
  );
}
