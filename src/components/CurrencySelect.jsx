import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ModernSelect from './ModernSelect';
import '../styles/modern-select.css';

/**
 * FIAT CURRENCY FIELD — the «نوع ارز» box of the Buy / Sell screen.
 * ---------------------------------------------------------------------------
 * «تب نوع ارز مثل دلار در تم روشن خرابه و هاشور خورده … باکس نوع ارز باید
 * مدرن باشد همراه با ایکون، مثلا USD با پرچم آمریکا»
 *
 * Two things were wrong, and only one of them was a missing feature.
 *
 * THE HATCH. The currency was a native `<select>` that `buy-sell.css` restyled
 * with the `background` SHORTHAND:
 *
 *     .bsw-amount select { background: rgba(255,255,255,.03); }      // 0-1-1
 *
 * A shorthand sets every longhand it does not mention, so that one line also
 * wrote `background-image: none`, `background-repeat: repeat` and
 * `background-position: 0% 0%`. The arrow is a `background-image` declared on
 * the bare `select` rule (0-0-1) — so the shorthand killed it — except in the
 * LIGHT theme, where `:root[data-theme='light'] select` re-declares the arrow
 * at 0-2-1 and out-specifies the shorthand. Result: light mode got the chevron
 * back, but with `repeat` and the origin in the corner, so the 12×8 arrow was
 * TILED across the whole control. That is the هاشور — diagonal stripes nobody
 * could explain, in exactly one theme.
 *
 * This control never touches `background` on a select. It is not a select at
 * all: it is the app's own sheet picker (ModernSelect), whose options carry the
 * currency's real flag from `lib/assetIconData` — vendored inline SVG, so the
 * flag is there offline, in Telegram's WebView and in the APK, not only when a
 * flag CDN answers.
 *
 * THE Fallback. A currency the app cannot name used to render the raw code as
 * a label with no artwork. `symbol={code}` falls through `FLAG_SVG` first and
 * only then to AssetIcon's deterministic monogram, so the row is never empty.
 */

/* The curated fiat list is the guided-checkout list — one source of truth for
   what this app can actually settle in, shared with the provider handoff. */
export const FIAT_META = ['USD', 'EUR', 'GBP', 'CHF', 'PLN', 'TRY', 'AED', 'BRL'];

export default function CurrencySelect({
  value,
  onChange,
  codes = FIAT_META,
  titleKey,
  labelKey,
  disabled = false,
  testId = 'currency-select',
  ariaLabelKey = 'buySell.wizard.currencyLabel',
  className = ''
}) {
  const { t } = useTranslation();

  const options = useMemo(() => codes.map((code) => ({
    value: code,
    /* The code stays Latin on purpose: it is what the provider's checkout
       field expects and what a support ticket will quote back. */
    label: code,
    sublabel: t(`buySell.fiat.${code}`, { defaultValue: code }),
    /* Flag-first artwork, resolved offline (see AssetIcon.jsx). */
    symbol: code
  })), [codes, t]);

  return (
    <div className={`buy-sell-currency ${className}`.trim()} dir="ltr">
      <ModernSelect
        value={value}
        onChange={onChange}
        options={options}
        title={titleKey ? t(titleKey) : t('buySell.wizard.chooseCurrency')}
        placeholder={t('buySell.wizard.chooseCurrency')}
        compact
        disabled={disabled}
        testId={testId}
        /* Inside the amount ticket there is no visible label for a screen
           reader to attach this button to, and the old <select> had an
           aria-label for exactly that reason. Keep it. */
        ariaLabel={ariaLabelKey ? t(ariaLabelKey) : undefined}
        triggerSublabel={labelKey ? t(labelKey) : undefined}
      />
    </div>
  );
}
