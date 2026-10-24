import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn } from './PageTransition';
import {
  ENS_APP_URL, SNS_APP_URL,
  ensYearlyUsd, normalizeIdLabel, solLabelOk
} from '../lib/shopHub';
import { openUrl } from '../lib/browser';
import { IconGlobe, IconSwap } from './ShopIcons';

/**
 * WEB3 DOMAINS & IDENTITY — a format checker and a funding route, in one card.
 * ---------------------------------------------------------------------------
 * `.eth` and `.sol` names turn a 42-character address into something you can
 * say out loud, and the shop already sends this audience to real-world
 * payments; identity is the same job on-chain. Two constraints shape what
 * this card may claim:
 *
 *   1. NON-CUSTODIAL AND NON-ORACLE. We do NOT assert availability. On ENS a
 *      name is only free if the registry says so at the moment of commit,
 *      and a "looks available!" badge read from anything but the chain is
 *      how a name gets lost in an auction. What we CAN answer without the
 *      network is the arithmetic of the rules — label shape, and the .eth
 *      annual price, which is a function of LENGTH ALONE (5 chars+ = $5/yr,
 *      4 = $160/yr, 3 = $640/yr — the published ladder in the ENS docs).
 *      Anything beyond that is one tap away, on the official app.
 *   2. THE COIN COMES FROM OUR SWAP, NOT FROM US. Buying the ETH/SOL for
 *      registration runs through the in-app /swap and /solana routes (0.70%
 *      platform fee, same as every conversion here); the card only
 *      pre-selects the target asset. No "buy domain with FBT" button
 *      exists and none is faked.
 */
export default function ShopWeb3IdCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kind, setKind] = useState('eth');
  const [label, setLabel] = useState('');

  const check = useMemo(() => normalizeIdLabel(label), [label]);
  const ethPrice = useMemo(() => (check.ok ? ensYearlyUsd(check.label) : null), [check]);
  const solOk = check.ok && solLabelOk(check.label);
  const ready = kind === 'eth' ? Boolean(ethPrice?.ok) : solOk;
  const shortReason = check.reason && check.reason !== 'empty' ? check.reason : '';
  /* .sol caps at 32 characters and .eth refuses 1–2: each network says NO to
     a different length, and the card names which one rather than hiding both
     behind one fuzzy "invalid". */
  const tooLong = check.ok && kind === 'sol' && String(check.label).length > 32;

  const fullName = check.ok ? `${check.label}.${kind === 'eth' ? 'eth' : 'sol'}` : '';

  return (
    <motion.section
      className="card card-tight shop-web3id"
      variants={riseIn}
      initial="hidden"
      animate="show"
      data-testid="shop-web3id-card"
      aria-label={t('shop.web3id.title')}
    >
      <div className="shop-web3id-head">
        <span className="shop-web3id-mark" aria-hidden="true"><IconGlobe width={16} height={16} /></span>
        <div>
          <div className="shop-web3id-title">{t('shop.web3id.title')}</div>
          <p className="shop-web3id-sub">{t('shop.web3id.sub')}</p>
        </div>
      </div>

      <div className="shop-web3id-tabs" role="group" aria-label={t('shop.web3id.kinds')}>
        {['eth', 'sol'].map((k) => (
          <button
            key={k}
            type="button"
            className="shop-web3id-tab"
            data-on={kind === k ? 'true' : 'false'}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {k === 'eth' ? '.eth' : '.sol'}
          </button>
        ))}
      </div>

      <label className="shop-web3id-field">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.replace(/\s+/g, '').slice(0, 48))}
          placeholder={t(kind === 'eth' ? 'shop.web3id.phEth' : 'shop.web3id.phSol')}
          aria-label={t('shop.web3id.checkLabel')}
          dir="ltr"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <span className="shop-web3id-suffix" aria-hidden="true">.{kind === 'eth' ? 'eth' : 'sol'}</span>
      </label>

      {/*
        The verdict line. Four honest states, and the loudest one — "check it
        on the registry" — is deliberately NOT painted as a green tick: this
        screen knows the SHAPE of a label, not the state of a chain.
      */}
      <p
        className="shop-web3id-verdict"
        data-tone={!check.ok ? (shortReason ? 'bad' : 'idle') : ready ? 'ok' : 'warn'}
        aria-live="polite"
      >
        {!check.ok && (shortReason
          ? t(`shop.web3id.err.${shortReason}`)
          : t('shop.web3id.idle'))}
        {check.ok && kind === 'eth' && !ethPrice?.ok && t('shop.web3id.err.too_short')}
        {check.ok && kind === 'eth' && ethPrice?.ok && (
          <span dir="ltr">${ethPrice.usd} / yr · {fullName}</span>
        )}
        {check.ok && kind === 'sol' && (ready
          ? t('shop.web3id.okSol', { name: fullName })
          : t(tooLong ? 'shop.web3id.err.too_long' : 'shop.web3id.err.chars'))}
        {ready && <span className="faint"> · {t('shop.web3id.availability')}</span>}
      </p>

      <div className="shop-web3id-actions">
        <button
          type="button"
          className="btn btn-ghost shop-web3id-open"
          onClick={() => openUrl(kind === 'eth' ? ENS_APP_URL : SNS_APP_URL)}
        >
          {t('shop.web3id.registry')} ↗
        </button>
        <button
          type="button"
          className="btn btn-primary shop-web3id-fund"
          onClick={() => navigate(kind === 'eth' ? '/swap?to=ETH&chain=1' : '/solana?toMint=So11111111111111111111111111111111111111112')}
        >
          <IconSwap width={15} height={15} />
          <span>{t(kind === 'eth' ? 'shop.web3id.buyEth' : 'shop.web3id.buySol')}</span>
        </button>
      </div>

      <p className="shop-web3id-note faint">
        {t(kind === 'eth' ? 'shop.web3id.noteEth' : 'shop.web3id.noteSol')}
      </p>
    </motion.section>
  );
}
