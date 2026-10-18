import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { rampOptions } from '../lib/rampDirectory';
import { openUrl } from '../lib/browser';
import {
  IconArrowUpRight, IconCard, IconCheck, IconChevronRight, IconExternal, IconGlobe, IconShield, IconSwap
} from './Icons';

/* Local line-art marks: no remote logo request and no implied official badge. */
const PROVIDER_MARKS = Object.freeze({
  ramp: IconArrowUpRight,
  swapzone: IconSwap,
  guardarian: IconShield,
  mercuryo: IconCard
});

const PROVIDER_ACCENTS = Object.freeze({
  ramp: '#f08b73',
  swapzone: '#a68cff',
  guardarian: '#53d7b1',
  mercuryo: '#68c7ee'
});

function ProviderMark({ id }) {
  const Mark = PROVIDER_MARKS[id] || IconGlobe;
  return (
    <span className={`bsw-ramp-mark is-${id}`} aria-hidden="true">
      <Mark width={21} height={21} />
    </span>
  );
}

/**
 * RAMP PROVIDER LIST — the doors that are actually open for THIS user.
 * ---------------------------------------------------------------------------
 * The wizard above collects amount → wallet → asset. This list answers the
 * next question honestly: given the country on the order, which keyless
 * on/off-ramps can this person actually walk through, which ones are closed
 * for a named reason, and — when all of them are closed — the peer-to-peer
 * rails that work everywhere.
 *
 * ─── WHAT IS NEVER SAID HERE ───────────────────────────────────────────────
 * · «payment confirmed». There is no webhook on this rail. The only truthful
 *   signal after a hand-off is the public blockchain, reported by
 *   WalletWatchReport below, in the wording the repo already enforces.
 * · «this provider supports your country» unless the provider publishes the
 *   list we verified. Rows without a published list say so in as many words.
 * · «use a VPN», «try another country», or anything else that walks around a
 *   provider's own eligibility decision. A closed door is reported, named and
 *   sourced — it is not routed around.
 *
 * ─── WHY THE LIST IS RANKED AND NOT ALPHABETICAL ───────────────────────────
 * The sort is by how much typing is left for the user (everything pre-filled
 * first, page-only doors last). It is NOT a claim that one provider is better
 * or cheaper than another — we do not and cannot see their live rates here.
 */
export default function RampProviderList({
  side = 'BUY',
  asset = null,
  network = null,
  walletAddress = null,
  fiatCurrency = null,
  fiatAmount = null,
  cryptoAmount = null,
  country = null,
  onOpened = null,
  onError = null
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');

  const result = useMemo(
    () => rampOptions({ country, side, asset, network, walletAddress, fiatCurrency, fiatAmount, cryptoAmount }),
    [asset, country, cryptoAmount, fiatAmount, fiatCurrency, network, side, walletAddress]
  );

  const openExternal = async (row) => {
    setBusy(row.id);
    try {
      const opened = await openUrl(row.url);
      if (!opened) {
        onError?.('CHECKOUT_OPEN_FAILED');
        return;
      }
      onOpened?.({ id: row.id, name: row.name, url: row.url });
    } finally {
      setBusy('');
    }
  };

  const openRail = async (rail) => {
    if (rail.internal) {
      navigate(rail.url);
      onOpened?.({ id: rail.id, name: rail.name, url: rail.url, internal: true });
      return;
    }
    setBusy(rail.id);
    try {
      const opened = await openUrl(rail.url);
      if (!opened) onError?.('CHECKOUT_OPEN_FAILED');
      else onOpened?.({ id: rail.id, name: rail.name, url: rail.url });
    } finally {
      setBusy('');
    }
  };

  const prefillNote = (option) => {
    if (option.tier === 'full') return t('buySell.ramp.prefillFull');
    if (option.tier === 'partial') return t('buySell.ramp.prefillPartial');
    return t('buySell.ramp.prefillNone');
  };

  const coverageNote = (option) => {
    if (option.coverage === 'listed') return t('buySell.ramp.coverageListed');
    if (option.coverage === 'unknown-country') return t('buySell.ramp.countryUnknown');
    return t('buySell.ramp.coverageDecides');
  };

  return (
    <div className="bsw-ramp">
      <div className="bsw-guided-badge">
        <IconShield width={13} height={13} /> {t('buySell.wizard.noRegistration')}
      </div>

      {result.options.length > 0 ? (
        <div className="bsw-ramp-list" role="list">
          {result.options.map((option) => (
            <div
              className={`bsw-ramp-row${option.id === result.recommended ? ' is-recommended' : ''}`}
              role="listitem"
              key={option.id}
              data-provider={option.id}
              style={{ '--bsw-provider-accent': PROVIDER_ACCENTS[option.id] || '#44d8d4' }}
            >
              <div className="bsw-ramp-card-top">
                <ProviderMark id={option.id} />
                <div className="bsw-ramp-brand">
                  <div className="bsw-ramp-head">
                    <span className="bsw-ramp-name">{option.name}</span>
                    {option.id === result.recommended && <span className="bsw-ramp-pill">{t('buySell.ramp.recommended')}</span>}
                  </div>
                </div>
              </div>
              <div className="bsw-ramp-notes">
                <p className="bsw-ramp-note"><IconCheck width={13} height={13} aria-hidden="true" /><span>{prefillNote(option)}</span></p>
                <p className="bsw-ramp-note"><IconGlobe width={13} height={13} aria-hidden="true" /><span>{coverageNote(option)}</span></p>
                <p className="bsw-ramp-note bsw-ramp-kyc"><IconShield width={13} height={13} aria-hidden="true" /><span>{t('buySell.ramp.kycNote')}</span></p>
              </div>
              <button
                type="button"
                className="btn btn-primary bsw-ramp-open"
                disabled={busy === option.id}
                onClick={() => openExternal(option)}
              >
                {t('buySell.ramp.open', { provider: option.name })}
                <IconArrowUpRight width={16} height={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="bsw-ramp-empty">
          <p><b>{t('buySell.ramp.noneTitle')}</b>{t('buySell.ramp.noneBody')}</p>
        </div>
      )}

      {result.unavailable.length > 0 && (
        <ul className="bsw-ramp-closed">
          {result.unavailable.map((row) => (
            <li key={`${row.id}-${row.reason}`}>
              <span className="bsw-ramp-closed-name">{row.name}</span>
              <span className="bsw-ramp-closed-reason">{t(`buySell.ramp.reasons.${row.reason}`, { defaultValue: t('buySell.ramp.reasons.UNAVAILABLE') })}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="bsw-ramp-p2p">
        <p className="section-label" style={{ margin: '0 0 6px' }}>{t('buySell.ramp.p2pTitle')}</p>
        <p className="bsw-ramp-note">{t('buySell.ramp.p2pNote')}</p>
        <div className="bsw-ramp-p2p-rows">
          {result.p2p.map((rail) => (
            <button type="button" className="bsw-ramp-p2p-row" key={rail.id} disabled={busy === rail.id} onClick={() => openRail(rail)}>
              <span className="bsw-ramp-name">{rail.name}</span>
              <span className="bsw-ramp-p2p-note">{t(`buySell.ramp.${rail.note}`)}</span>
              {rail.internal ? <IconChevronRight width={15} height={15} /> : <IconExternal width={14} height={14} />}
            </button>
          ))}
        </div>
      </div>

      {result.options.length > 0 && !result.coverageVerified && result.countryKnown && (
        <p className="bsw-ramp-note bsw-ramp-warn">{t('buySell.ramp.coverageUnverified')}</p>
      )}

      <p className="buy-sell-hosted-note">{t('buySell.ramp.noPromiseNote')}</p>
    </div>
  );
}
