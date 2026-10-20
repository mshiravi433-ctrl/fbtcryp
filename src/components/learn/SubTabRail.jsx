/**
 * SubTabRail — the second navigation level inside every Learn tab.
 * ---------------------------------------------------------------------------
 * راهنما → پرسش‌های پرتکرار / پشتیبانی و منابع
 * مستندات → مبتدی / متوسط / حرفه‌ای
 * ویدیوها → درس‌ها / کانال رسمی
 *
 * ─── WHY ONE COMPONENT, NOT THREE ──────────────────────────────────────────
 * Three rails written separately drift within a week: one gets a count badge,
 * another forgets `aria-selected`, the third keeps a hover state that does not
 * exist elsewhere. The rail is therefore data-driven and the only thing each
 * page supplies is its list.
 *
 * ─── THE LABEL IS A KEY, NOT A STRING ──────────────────────────────────────
 * `labelPrefix` + item id, translated here. The alternative — every caller
 * passing `label: t('…')` — is what let the Business console ship raw i18n
 * keys on a Persian screen: nothing could tell an untranslated key from a
 * translated one at the call site.
 *
 * ─── THE HINT IS A SIBLING, NOT A CHILD ────────────────────────────────────
 * A `role="tablist"` may only contain tabs. One stray <p> inside it makes
 * assistive tech count it as a tab and announce "3 of 4" on a two-tab rail,
 * which is a real bug fixed on the Business console and kept dead here.
 */
import { useId } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { onTabListKeyDown } from './rovingTabs';

const grad = (a, b) => `linear-gradient(135deg, ${a}, ${b})`;

export default function SubTabRail({
  items,
  value,
  onChange,
  labelPrefix,
  label,
  hint,
  panelId,
  layoutId = 'lh-sub',
  locale
}) {
  const { t } = useTranslation();
  const uid = useId().replace(/:/g, '');

  const fmt = (n) =>
    locale ? new Intl.NumberFormat(locale).format(n) : String(n);

  return (
    <div className="lh-subwrap">
      <div
        className="lh-subtabs"
        role="tablist"
        aria-label={label}
        data-tablist-id={uid}
        onKeyDown={(e) => onTabListKeyDown(e, items, value, (item) => onChange(item.id))}
      >
        {items.map((st) => {
          const active = st.id === value;
          return (
            <button
              key={st.id}
              type="button"
              role="tab"
              id={`${uid}-${st.id}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              className={`lh-subtab${active ? ' is-active' : ''}`}
              onClick={() => onChange(st.id)}
              style={{ '--a': st.a, '--b': st.b }}
            >
              {active && (
                <motion.span
                  className="lh-subtab-pill"
                  layoutId={layoutId}
                  style={{ background: grad(st.a, st.b) }}
                  transition={{ type: 'spring', stiffness: 470, damping: 36 }}
                />
              )}
              <span className="lh-subtab-inner">
                {st.Icon && <st.Icon width={15} height={15} aria-hidden="true" />}
                <span className="lh-subtab-label">{t(`${labelPrefix}.${st.id}`)}</span>
                {typeof st.count === 'number' && (
                  <span className="lh-subtab-count">{fmt(st.count)}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {hint ? <p className="lh-hint">{hint}</p> : null}
    </div>
  );
}
