import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SmSwapGlyph } from './SmGlyphs';
import { swapDeepLink } from '../../lib/smartMoneySwap';
import { planCopyTrade, planLabel } from '../../lib/copyTrade';
import { useTelegram } from '../../context/TelegramContext';

/**
 * «کپی تراکنش» — the one-tap bridge from an observed fill to our own swap.
 *
 * Placed on receipts and token-activity rows, it does exactly two things:
 *
 *   1. puts the CONTRACT on the clipboard (best effort — the button is named
 *      "copy", so it should behave like one even where the clipboard is
 *      blocked by the WebView), and
 *   2. opens /swap (or /solana) with that same token preselected and the side
 *      already set, so the user is not asked to search for it again.
 *
 * It is deliberately NOT a "copy this wallet's trade" execution button: the
 * amount, slippage, gas and risk gate stay the user's, on the swap screen.
 * Renders nothing when the row has no usable contract — a dead button is
 * worse than no button.
 *
 * ─── THE ENGINE BEHIND IT (2026-11-12) ──────────────────────────────────────
 * «موتور کپی‌ترید را هوشمندتر کن و مطمئن شو با سیگنال هم‌جریان است»
 *
 * The button used to carry no opinion at all. It now carries the SAME read the
 * signal card carries — `planCopyTrade` is built on `readSmartMoney`, and the
 * read is handed to `readForConsensus` on the Signals page too, so the button
 * and the card cannot drift apart.
 *
 * What is rendered is still a button with the contract in it. The ADDITION is
 * the one-line verdict underneath, in the same glyph-and-label language the
 * toolbar already uses (no new control, no new colour, no new layout): the side
 * the observed flow implies, and — when a plan is passed in — the gate that
 * blocks it or the conviction it earned. An unmeasured read prints NOTHING
 * extra: a claim about evidence we do not have is worse than a plain button.
 *
 * @param {object}  props
 * @param {number|string} props.chain
 * @param {string}  props.token
 * @param {string}  [props.side]        'BUY' | 'SELL' (derived from the read when absent)
 * @param {object}  [props.verified]    the verified consensus row, if the surface has one
 * @param {object}  [props.tape]        `smartMoneyFlow` / unqualified swaps
 * @param {object}  [props.activity]    a `tokenActivity` row
 * @param {object}  [props.whales]      the whale-engine token read, when the surface has one
 * @param {string}  [props.window]
 * @param {object}  [props.tokenIntel]  liquidity/holders, for the gates
 * @param {number}  [props.plannedUsd]  the reader's planned size, if known
 * @param {number}  [props.bookUsd]
 * @param {number}  [props.volatilityPct]
 * @param {boolean} [props.showVerdict=true]
 */
export default function CopyTradeButton({
  chain,
  token,
  side,
  verified = null,
  tape = null,
  activity = null,
  whales = null,
  window = null,
  tokenIntel = null,
  plannedUsd = null,
  bookUsd = null,
  volatilityPct = null,
  showVerdict = true,
  className = ''
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const plan = useMemo(() => {
    const hasEvidence = !!(verified || tape || activity || whales);
    if (!hasEvidence && plannedUsd === null) return null;
    return planCopyTrade({
      chain,
      token,
      verified,
      tape,
      activity,
      whales,
      window,
      tokenIntel,
      plannedUsd,
      bookUsd,
      volatilityPct
    });
  }, [chain, token, verified, tape, activity, whales, window, tokenIntel, plannedUsd, bookUsd, volatilityPct]);

  /* The side follows the EVIDENCE when the evidence exists, and the caller's
     own side otherwise — never the other way round. A row that arrived with a
     side keeps it; a row that only has a flow gets its direction from it. */
  const resolvedSide = plan?.action || side || (plan?.read?.signal === 'DISTRIBUTION' ? 'SELL' : 'BUY');
  const href = swapDeepLink({ chain, token, side: resolvedSide });

  const go = useCallback((event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    haptic?.('light');
    try {
      navigator.clipboard?.writeText?.(String(token));
    } catch { /* clipboard is a nicety, never a requirement */ }
    if (href) navigate(href);
  }, [haptic, href, navigate, token]);

  if (!href) return null;

  const label = t('sm.copyTrade');
  const verdict = showVerdict && plan ? planLabel(plan) : null;
  /* The verdict line is a LABEL, not a control: it exists so the reader can
     see why the button would be a good or a bad idea before tapping it. */
  const verdictText = verdict && verdict.state !== 'none' ? t(verdict.key) : null;

  return (
    <span className="sm-copy-wrap">
      <button
        type="button"
        className={`sm-copy ${verdict?.tone === 'warn' ? 'is-blocked' : ''} ${className}`.trim()}
        onClick={go}
        title={t('sm.copyTradeHint')}
        aria-label={`${label} — ${t('sm.copyTradeHint')}${verdictText ? ` — ${verdictText}` : ''}`}
        data-testid="sm-copy-trade"
        data-verdict={verdict?.state || undefined}
        data-side={resolvedSide}
      >
        <SmSwapGlyph width={13} height={13} />
        <span>{label}</span>
      </button>
      {verdictText && (
        <small
          className={`sm-copy-verdict is-${verdict.tone}`}
          data-testid="sm-copy-verdict"
          title={plan?.context?.liquidityUsd != null ? undefined : t('copyTrade.note')}
        >
          {verdictText}
        </small>
      )}
    </span>
  );
}
