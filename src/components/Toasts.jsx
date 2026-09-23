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
 * Resolve one notification key.
 *
 * Order, and why it is this order:
 *   1. `toast.<key>` — the shared namespace, where every generic notification
 *      lives. Never skipped, so nothing that used to resolve can stop.
 *   2. the key itself, when the page that raised it owns a namespace of its own
 *      (`loan.chooseAssetFirst`, `loan.error.MARKET_PAUSED` — the loan page
 *      names its toasts that way, and `toast.loan.…` cannot exist under a
 *      prefix the page never writes to).
 *   3. `loanErrorText` — for a code that has no sentence yet: a translated
 *      generic that carries the code, instead of the code alone.
 *   4. the raw key, last: if i18n has nothing at all to say, showing the key is
 *      still better than showing an empty toast.
 */
/* Exported for the l10n contract test (test/loan-errors-l10n.test.js): the
   toast host is a resolver, and a resolver is worth testing without a DOM. */
export function toastTextForTest(t, key, values) {
  return toastText(t, key, values);
}

function toastText(t, key, values) {
  const raw = String(key ?? '');
  const shared = t(`toast.${raw}`, { defaultValue: '', ...values });
  if (shared) return shared;
  if (raw.startsWith(LOAN_NAMESPACE)) return loanErrorText(t, raw, values);
  return t(raw, { defaultValue: raw, ...values });
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
