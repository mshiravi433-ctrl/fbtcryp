import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import { fetchTokenRisk, goplusChainId } from '../lib/tokenRisk';
import { IconAlertTriangle, IconChevronRight, IconDoc, IconPools, IconSparkle, IconUser } from './Icons';

/**
 * LIVE TOKEN-SECURITY READOUT — «ریسک هوش مصنوعی»
 * ---------------------------------------------------------------------------
 * «در صفحهٔ توکن تب خرید و فروش، ریسک هوش مصنوعی — باکس بازشونده را خیلی
 *  مدرن و کارآمد کن.»
 *
 * ─── WHAT WAS WRONG WITH THE OLD BOX ───────────────────────────────────────
 * It was four label/value rows and a thin progress bar: `Liquidity — Low`,
 * `Top 10 — 10%`, `Contract — Low`, `Rug — 0%`. Every one of those values is a
 * judgement, and none of them was shown AS a judgement — the reader had to
 * translate "Medium" into "should I buy this" by themselves, on the one screen
 * where getting that wrong costs money.
 *
 * ─── WHAT IT IS NOW ────────────────────────────────────────────────────────
 *   1. A VERDICT, first: a 96px risk dial (conic, coloured by level) with the
 *      score inside, the level named under it, and one sentence saying what
 *      that means for THIS trade. The score is explicitly a RISK score —
 *      higher is worse — and the dial's aria-valuenow is that same number.
 *   2. Four metric TILES instead of rows: each has its own icon, its own
 *      surface and its own tone, so "liquidity is thin but the contract is
 *      clean" is legible at a glance instead of assembled from four lines.
 *   3. The FLAGS as chips, not as paragraphs: a flag is a discrete finding,
 *      and a list of chips reads as "these specific things", which is what it
 *      is. Each keeps its own translated sentence on `title` for the detail.
 *   4. ADVICE: one short line on what to do next. The card is a warning
 *      system, and a warning with no next step is just anxiety.
 *
 * ─── THE HONESTY RULES ARE UNCHANGED ───────────────────────────────────────
 * A missing address or an unsupported chain still renders NOTHING. A failed
 * scan still renders «not a clean bill of health» and lifts `null` to the
 * parent gate — unknown is never safe. A honeypot still cannot hide behind a
 * collapsed header, and the card still auto-opens on `high`/`critical`.
 *
 * The collapse API is untouched (`collapsible`, `compact`, `onRisk`), the
 * `.infobox` / `.infobox-head` / `.infobox-body` structure that the token-tab
 * probe reads is untouched, and the score is still exposed as
 * `role="meter"` with `aria-valuenow`.
 */

const LEVEL_TONE = { low: 'safe', medium: 'warn', high: 'danger', critical: 'danger', unknown: 'info' };

export default function TokenRiskCard({ chainId, address, symbol, compact = false, onRisk = null, collapsible = true }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openState, setOpenState] = useState(false);
  const open = collapsible ? openState : true;
  const Head = collapsible ? 'button' : 'div';

  const canScan = useMemo(
    () => Boolean(goplusChainId(chainId) && address && /^0x[a-fA-F0-9]{40}$/.test(address)),
    [chainId, address]
  );

  useEffect(() => {
    if (!canScan) {
      setRisk(null);
      return undefined;
    }
    let alive = true;
    setBusy(true);
    fetchTokenRisk({ chainId, address })
      .then((r) => {
        if (!alive) return;
        setRisk(r);
        // Lift the verdict to the parent so the execution gate can enforce it
        // (block a honeypot, require acknowledgement on high risk). The card
        // stays the display; this callback is how the signing button learns.
        if (typeof onRisk === 'function') onRisk(r);
        // Auto-open when the verdict is scary so a real warning can't hide
        // behind a collapsed header.
        if (r && (r.level === 'critical' || r.level === 'high')) setOpenState(true);
      })
      .catch(() => {
        if (!alive) return;
        setRisk(null);
        // A failed scan is honest data: the gate treats "no report" as
        // unknown, never safe. Lift null so the parent can warn accordingly.
        if (typeof onRisk === 'function') onRisk(null);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [canScan, chainId, address]);

  if (!canScan) return null;

  const level = risk?.level ?? 'unknown';
  const danger = level === 'critical' || level === 'high';
  const warn = level === 'medium';
  const tone = danger ? 'danger' : warn ? 'warn' : 'info';
  const score = risk?.score != null && Number.isFinite(Number(risk.score))
    ? Math.max(0, Math.min(100, Number(risk.score)))
    : null;
  const empty = !risk || risk.unknown;

  /**
   * The four readings, as tiles. `band` values are already translated bands
   * ("low"/"medium"/"high") — the tile never invents a number it was not
   * given, and «—» is the honest answer for a missing one.
   */
  const tiles = [
    {
      key: 'liquidity',
      label: t('risk.liquidity'),
      value: risk ? t(`risk.band.${risk.liquidityRisk}`) : '—',
      bad: risk?.liquidityRisk === 'high',
      warn: risk?.liquidityRisk === 'medium',
      Icon: IconPools
    },
    {
      key: 'holders',
      label: t('risk.holders'),
      value: risk?.holderConcentration == null ? '—' : `${risk.holderConcentration}%`,
      bad: Number(risk?.holderConcentration) >= 50,
      warn: Number(risk?.holderConcentration) >= 25 && Number(risk?.holderConcentration) < 50,
      Icon: IconUser
    },
    {
      key: 'contract',
      label: t('risk.contract'),
      value: risk ? t(`risk.band.${risk.contractRisk}`) : '—',
      bad: risk?.contractRisk === 'high',
      warn: risk?.contractRisk === 'medium',
      Icon: IconDoc
    },
    {
      key: 'rug',
      label: t('risk.rug'),
      value: risk?.rugPull == null ? '—' : `${risk.rugPull}%`,
      bad: Number(risk?.rugPull) >= 50,
      warn: Number(risk?.rugPull) >= 20 && Number(risk?.rugPull) < 50,
      Icon: IconAlertTriangle
    }
  ];

  const flags = (!compact && Array.isArray(risk?.flags)) ? risk.flags : [];

  return (
    <div
      className={`infobox infobox-${tone} token-risk-card ${open ? 'is-open' : ''}`}
      data-risk-level={level}
      data-tone={LEVEL_TONE[level] || 'info'}
      style={{ marginTop: 10 }}
    >
      <Head
        type={collapsible ? 'button' : undefined}
        className={`infobox-head${collapsible ? '' : ' is-static'}`}
        aria-expanded={collapsible ? open : undefined}
        onClick={collapsible ? () => { haptic?.('select'); setOpenState((v) => !v); } : undefined}
      >
        <span className="token-risk-mark" aria-hidden="true">
          <IconSparkle width={15} height={15} />
        </span>
        <span className="infobox-title token-risk-title">
          <span className="token-risk-title-text">
            {t('risk.badge', { symbol: symbol || 'Token' })}
          </span>
          <span
            className={`pill token-risk-pill ${level === 'low' ? 'pill-up' : danger ? 'pill-down' : warn ? '' : 'pill-neutral'}`}
          >
            {busy ? t('common.loading') : t(`risk.level.${level}`)}
          </span>
        </span>
        {score != null && !collapsible && (
          <span className="token-risk-scorechip mono" aria-hidden="true">{score}<small>/100</small></span>
        )}
        {collapsible && (
          <motion.span
            className="infobox-chev"
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.18 }}
            aria-hidden="true"
          >
            <IconChevronRight width={15} height={15} />
          </motion.span>
        )}
      </Head>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="infobox-body token-risk-body">
              {busy && !risk && <p className="faint token-risk-note">{t('common.loading')}</p>}

              {!busy && empty && (
                <p className="faint token-risk-note">{t('risk.unknown')}</p>
              )}

              {!busy && risk && !risk.unknown && (
                <>
                  {/* ── the verdict ─────────────────────────────────────── */}
                  <div className="token-risk-verdict">
                    <div
                      className="token-risk-dial"
                      data-level={level}
                      role="meter"
                      aria-label={t('risk.score')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={score ?? 0}
                      style={{ '--dial': `${score ?? 0}` }}
                    >
                      <span className="token-risk-dial-core">
                        <b>{score ?? '—'}</b>
                        <small>/100</small>
                      </span>
                    </div>
                    <div className="token-risk-verdict-copy">
                      <span className="token-risk-verdict-label">{t('risk.score')}</span>
                      <strong className="token-risk-verdict-level">{t(`risk.level.${level}`)}</strong>
                      <p className="token-risk-advice">{t('risk.advice')}</p>
                    </div>
                  </div>

                  {/* ── the four readings ───────────────────────────────── */}
                  <div className="token-risk-grid">
                    {tiles.map(({ key, label, value, bad, warn: isWarn, Icon }) => (
                      <div
                        className="token-risk-tile"
                        key={key}
                        data-state={bad ? 'bad' : isWarn ? 'warn' : 'ok'}
                      >
                        <span className="token-risk-tile-top">
                          <Icon width={13} height={13} aria-hidden="true" />
                          <span className="token-risk-tile-label">{label}</span>
                        </span>
                        <span className="token-risk-tile-value mono">{value}</span>
                      </div>
                    ))}
                  </div>

                  {risk.honeypot && (
                    <p className="notice notice-danger token-risk-honeypot">{t('risk.honeypot')}</p>
                  )}

                  {flags.length > 0 && (
                    <div className="token-risk-flags">
                      {flags.slice(0, 6).map((f) => {
                        const text = t(`risk.flag.${f.id}`, { ...f.values, defaultValue: f.id });
                        return (
                          <span className="token-risk-flag" key={f.id} title={text}>
                            <IconAlertTriangle width={11} height={11} aria-hidden="true" />
                            <span>{text}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
