import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CollapsibleCard from '../CollapsibleCard';
import { IconRefresh, IconShield } from '../Icons';
import { fetchTokenRisk, goplusChainId } from '../../lib/tokenRisk';

/**
 * AI TOKEN RISK — one folding box per selected token
 * ---------------------------------------------------------------------------
 * «ریسک هوش مصنوعی برای هر توکن انتخابی به صورت باکس بازشونده بیاد و مدرن و
 * زیبا با اطلاعات به روز و کامل باشد.»
 *
 * The engine behind it is the app's existing one (lib/tokenRisk.js → the
 * server's GoPlus reader). It answers "can I sell this, and who already owns
 * it" — honeypot, sell tax, mint rights, owner powers, holder concentration,
 * liquidity and a rug blend — and it is deliberately NOT a price forecast.
 *
 * WHAT THE BOX SHOWS
 *   • the verdict in the header, always readable without opening the fold:
 *     a pill in the token's risk colour, next to the token's symbol;
 *   • inside: the 0–100 score as a meter, then four measured rows (liquidity,
 *     top-10 holders, contract risk, whale activity), the rug blend, and every
 *     flag the scorer raised as a chip;
 *   • a re-scan control, because a report is a moment in time.
 *
 * WHAT IT REFUSES TO DO
 *   · invent "safe" from missing data. An unread contract is `unknown`, and
 *     the box says so with the app's own line («اسکن امنیتی کامل نشد. این به
 *     معنی امن بودن نیست»).
 *   · scan something there is nothing to scan: a network's own gas coin has no
 *     token contract, and a chain GoPlus does not cover gets the honest
 *     "no scanner for this network" line instead of a green badge.
 */
export default function SpotTokenRisk({ chainId, token }) {
  const { t } = useTranslation();
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const chainOk = goplusChainId(chainId) != null;
  const address = token?.address ?? null;
  const native = Boolean(token) && (Boolean(token?.native) || address == null);
  const canScan = chainOk && !native && /^0x[a-fA-F0-9]{40}$/.test(String(address ?? ''));

  useEffect(() => {
    if (!canScan) {
      setRisk(null);
      setBusy(false);
      return undefined;
    }
    let alive = true;
    setBusy(true);
    fetchTokenRisk({ chainId, address })
      .then((r) => {
        if (alive) setRisk(r);
      })
      .catch(() => {
        // A failed scan is honest data: unknown, never "safe".
        if (alive) setRisk(null);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [canScan, chainId, address, nonce]);

  if (!token) return null;

  const level = risk?.level ?? 'unknown';
  const score = Number.isFinite(risk?.score) ? Math.max(0, Math.min(100, risk.score)) : 0;
  const flags = Array.isArray(risk?.flags) ? risk.flags : [];

  const rows = risk
    ? [
      [t('risk.liquidity'), t(`risk.band.${risk.liquidityRisk}`)],
      [t('risk.holders'), risk.holderConcentration != null ? `${risk.holderConcentration}%` : '—'],
      [t('risk.contract'), t(`risk.band.${risk.contractRisk}`)],
      [t('spot.risk.whaleLabel'), t(`spot.risk.whale.${risk.whaleActivity ?? 'unknown'}`)],
      [t('risk.rug'), `${risk.rugPull}%`]
    ]
    : [];

  return (
    <CollapsibleCard
      id="spot-risk"
      className={`spot-risk is-${level}`}
      icon={<IconShield width={18} height={18} />}
      title={t('risk.badge', { symbol: token.symbol })}
      subtitle={t('spot.risk.subtitle')}
      badge={<span className={`spot-risk-pill is-${level}`}>{t(`risk.level.${level}`)}</span>}
      defaultOpen={false}
    >
      <div className="spot-risk-body">
        {!chainOk && <p className="spot-risk-note">{t('risk.flag.unsupportedChain')}</p>}
        {chainOk && native && <p className="spot-risk-note">{t('spot.risk.native')}</p>}

        {busy && !risk && <p className="spot-risk-note">{t('spot.risk.scanning')}</p>}

        {!busy && risk?.unknown && <p className="spot-risk-note is-warn">{t('risk.unknown')}</p>}

        {risk && !risk.unknown && (
          <>
            <div className="spot-risk-meter" role="img" aria-label={`${t('spot.risk.score')} — ${t('spot.risk.scoreOf', { n: score })}`}>
              <span className="spot-risk-meter-head">
                <span>{t('spot.risk.score')}</span>
                <span className="mono" dir="ltr">{t('spot.risk.scoreOf', { n: score })}</span>
              </span>
              <span className="spot-risk-meter-track" aria-hidden="true">
                <span className="spot-risk-meter-fill" style={{ width: `${score}%` }} />
              </span>
            </div>

            <dl className="spot-risk-rows">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd dir="ltr" className="mono">{v}</dd>
                </div>
              ))}
            </dl>

            {flags.length > 0 ? (
              <ul className="spot-risk-flags">
                {flags.map((f) => (
                  <li key={f.id} className={`spot-risk-flag is-${f.severity}`}>
                    {t(`risk.flag.${f.id}`, f.values ?? {})}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="spot-risk-note is-good">{t('spot.risk.clean')}</p>
            )}
          </>
        )}

        {canScan && (
          <button
            type="button"
            className="spot-btn spot-btn-ghost spot-risk-rescan"
            onClick={() => setNonce((n) => n + 1)}
            disabled={busy}
          >
            <IconRefresh width={14} height={14} aria-hidden="true" /> {t('spot.risk.rescan')}
          </button>
        )}
      </div>
    </CollapsibleCard>
  );
}
