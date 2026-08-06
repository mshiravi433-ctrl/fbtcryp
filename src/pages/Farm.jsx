import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import SegIndicator from '../components/SegIndicator';
import { fmtCompact, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { IconExternal, IconPools, IconShield, IconSwap } from '../components/Icons';
import TokenIcon from '../lib/tokenIcon';
import { useHideBalances } from '../hooks/useHideBalances';
import { RISK_BANDS, getYields, pairTokens, projectEarnings, rateIsUnusual, realShare } from '../lib/yields';
import { TOKENS } from '../lib/chains';
import { getSolanaAssets, projectStake, yieldForLst } from '../lib/solanaAssetsClient';

/**
 * FARM — live yields, filtered for safety.
 *
 * ─── WHAT THIS SCREEN USED TO BE ────────────────────────────────────────────
 * Four hard-coded pools with hand-written APR ranges ("15–40%"). The ranges
 * were honest about being ranges and completely disconnected from what those
 * pools actually paid. A yield figure that never moves is not a yield figure,
 * and a range that wide cannot be wrong, which is worse than being wrong.
 *
 * It now reads live rates from DefiLlama through our own backend, which does
 * the filtering — see server/yields.js. The upstream is free and keyless,
 * which is the only reason this feature exists at all.
 *
 * ─── THE THREE THINGS THIS SHOWS THAT OTHERS DO NOT ─────────────────────────
 *
 * 1. THE REAL/EMISSION SPLIT. Every aggregator shows one combined APY. A
 *    "24%" that is 22% freshly-minted governance tokens is a countdown, not
 *    an income, and the headline gives you no way to tell. We show the split
 *    on every row.
 *
 * 2. TODAY VERSUS THE 30-DAY AVERAGE. A pool at 40% today with a 6% average
 *    is not a 40% pool. Somebody deciding on the headline is deciding on a
 *    spike that will be gone before their deposit confirms.
 *
 * 3. HOW MANY POOLS WERE REJECTED. "40 of 312 passed" makes the filtering
 *    visible rather than implicit, and it is the fastest way to explain what
 *    this screen is actually doing for the user.
 *
 * ─── WHERE THE REVENUE IS, HONESTLY ─────────────────────────────────────────
 * We take NOTHING from anyone's yield and the screen says so. Skimming a
 * user's farming return would require custody, which this app does not have
 * and will not take.
 *
 * The revenue is upstream of the deposit: you cannot enter a CAKE-BNB pool
 * without holding CAKE and BNB, and most people arriving here hold neither.
 * The "get the tokens" button routes that swap through our own swap screen at
 * the standard 0.7%. That is a real service performed for a real fee, it is
 * disclosed, and the user can ignore it and swap elsewhere. Which is the only
 * kind of revenue worth building.
 */

/** Filters. `all` first because most users will not want to think about it. */
const RISK_FILTERS = ['all', ...RISK_BANDS];

/**
 * Preset amounts for the calculator.
 *
 * Round numbers a person actually thinks in, not $1/$10/$100 which invites
 * mental multiplication and gets it wrong. $1,000 is deliberately the default:
 * it is large enough that the yearly figure is legible and small enough that
 * it is not aspirational.
 */
const AMOUNTS = [100, 1000, 10000];

function RiskPill({ risk, t }) {
  const cls = risk === 'low' ? 'pill-neutral' : risk === 'medium' ? 'pill-rgb' : 'pill-down';
  return <span className={`pill ${cls}`}>{t(`farm.risk.${risk}`)}</span>;
}

/**
 * The yield split bar.
 *
 * Two segments: revenue and emissions. Rendered as a bar rather than as two
 * numbers because the RATIO is the point — "6% of 18%" requires arithmetic,
 * a third-full bar does not.
 */
function SplitBar({ pool }) {
  const share = realShare(pool);
  if (share == null) return null;
  return (
    <div className="farm-split" title={`${Math.round(share * 100)}%`}>
      <div className="farm-split-real" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

function PoolRow({ pool, amount, onOpen, onGetTokens, t }) {
  const share = realShare(pool);
  const unusual = rateIsUnusual(pool);
  const projection = projectEarnings(pool, amount);
  const pair = pairTokens(pool);

  return (
    <motion.div className="farm-pool" variants={riseIn}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div className="farm-pool-sym">{pool.symbol}</div>
          <div className="set-row-sub">
            {pool.project} · {pool.chain}
          </div>
        </div>
        <div style={{ textAlign: 'end', flexShrink: 0 }}>
          <div className="farm-apy mono">{pool.apy}%</div>
          <div className="faint" style={{ fontSize: 10.5 }}>{t('farm.apy')}</div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <RiskPill risk={pool.risk} t={t} />
        {pool.ilRisk && <span className="pill pill-down">{t('farm.ilShort')}</span>}
        {pool.stablecoin && <span className="pill pill-neutral">{t('farm.stableShort')}</span>}
        <span className="pill pill-neutral">{t('farm.tvl')} {fmtCompact(pool.tvlUsd)}</span>
      </div>

      {/* The split — the number every other aggregator hides. */}
      {share != null && (
        <div style={{ marginTop: 10 }}>
          <SplitBar pool={pool} />
          <div className="farm-split-legend faint">
            {t('farm.splitLine', {
              real: Math.round(share * 100),
              emissions: Math.round((1 - share) * 100)
            })}
          </div>
        </div>
      )}

      {/* Today versus normal. Only rendered when it is actually unusual. */}
      {unusual && (
        <p className={`farm-unusual farm-unusual-${unusual.direction}`}>
          {t(`farm.unusual.${unusual.direction}`, { ratio: unusual.ratio, mean: unusual.mean })}
        </p>
      )}

      {/* What the rate means in money, which is what the percentage does not. */}
      {projection && (
        <div className="farm-calc">
          <span className="faint">{t('farm.wouldEarn', { amount: fmtUsd(amount) })}</span>
          <span className="mono farm-calc-num">{fmtUsd(projection.year)}<span className="faint">/{t('farm.year')}</span></span>
        </div>
      )}

      <div className="farm-actions">
        {/*
          The revenue path, and the only one on this screen.

          Entering an LP pair requires holding both tokens and most people
          arriving here hold neither. Routing that swap through our own screen
          earns the standard fee for work we actually do. Single-asset pools
          get no such button, because there is nothing to pair up and adding
          one would be manufacturing a swap the user does not need.
        */}
        {pair.length === 2 && (
          <button className="btn btn-ghost farm-btn" onClick={() => onGetTokens(pair)}>
            <IconSwap width={15} height={15} />
            {t('farm.getTokens', { a: pair[0], b: pair[1] })}
          </button>
        )}
        <button className="btn btn-ghost farm-btn" onClick={() => onOpen(pool.url)}>
          {t('farm.openPool')}
          <IconExternal width={15} height={15} />
        </button>
      </div>
    </motion.div>
  );
}

/*
 * Read from the curated token table, never retyped. A second copy of a
 * contract address is a second chance to get one wrong, and these are tokens
 * the user will spend money on.
 */
const ETH_STAKE_TOKENS = (TOKENS[1] ?? []).filter((tk) => tk.stake === 'eth');

export default function Farm() {
  // Subscribe so the figures re-render the moment the switch moves; the
  // masking itself lives in the formatters.
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  /*
   * Liquid staking tokens, fetched alongside the pool list.
   *
   * A failure here must NOT take out the pools below — they are independent
   * features that happen to share a screen, and one dead upstream should cost
   * one section, not the page. Hence the separate state and the swallowed
   * rejection.
   */
  const [lst, setLst] = useState([]);
  const [risk, setRisk] = useState('all');
  const [amount, setAmount] = useState(AMOUNTS[1]);
  const [showIl, setShowIl] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getYields()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getSolanaAssets()
      .then((d) => alive && setLst(d.lst ?? []))
      .catch(() => {
        /* Section simply does not render. See the note on the state above. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  /*
   * Hand off to our own swap screen pre-filled with the pair. Swap already
   * accepts ?from=&to= (the Orders screen uses the same handoff), so this
   * reuses a path that is already tested rather than inventing a second one.
   */
  const getTokens = (pair) => {
    haptic?.('select');
    navigate(`/swap?from=${encodeURIComponent(pair[0])}&to=${encodeURIComponent(pair[1])}`);
  };

  const pools = useMemo(() => {
    const all = data?.pools ?? [];
    return risk === 'all' ? all : all.filter((p) => p.risk === risk);
  }, [data, risk]);

  /*
   * Join the live APY from the DefiLlama feed onto each staking token.
   *
   * Deliberately a join and not a constant. Writing `apy: 7.5` into the asset
   * list would be wrong within a week and nobody would notice — which is
   * precisely the bug the old hard-coded "15-40%" ranges had. A token with no
   * matching pool shows no yield rather than a stale one.
   */
  const stakingRows = useMemo(
    () => lst.map((a) => ({ asset: a, live: yieldForLst(a, data?.pools ?? []) })),
    [lst, data]
  );

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('farm.title')}</h1>
        <p className="muted">{t('farm.subtitle')}</p>
      </motion.div>

      {/* ---------- what farming is ---------- */}
      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}>
            <IconPools width={22} height={22} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('farm.whatTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('farm.whatBody')}</p>
          </div>
        </div>
      </motion.section>

      {/* ---------- the risk people underestimate ---------- */}
      <motion.button
        className="card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        onClick={() => setShowIl((v) => !v)}
        style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
      >
        <div className="row-between">
          <div className="row" style={{ gap: 10 }}>
            <span style={{ color: 'var(--down)' }}><IconShield width={19} height={19} /></span>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t('farm.ilTitle')}</div>
          </div>
          <span style={{ color: 'var(--text-3)' }}>{showIl ? '−' : '+'}</span>
        </div>
        <motion.div
          initial={false}
          animate={{ height: showIl ? 'auto' : 0, opacity: showIl ? 1 : 0 }}
          style={{ overflow: 'hidden' }}
        >
          <p className="muted" style={{ fontSize: 12.3, marginTop: 10, marginBottom: 0 }}>
            {t('farm.ilBody')}
          </p>
        </motion.div>
      </motion.button>

      {/*
        ─── LIQUID STAKING ────────────────────────────────────────────────
        Placed ABOVE the pool list on purpose. This is the only yield on this
        screen a beginner can take without meeting impermanent loss, and the
        only one that stays inside the app — the pool rows below all end in
        "open this somewhere else".

        Buying jitoSOL IS staking. No separate deposit, no lock-up, no new
        contract to approve: the token's exchange rate against SOL grows every
        epoch and swapping back out is how you unstake. That makes it the one
        real yield product this app can offer without taking custody of
        anything.
      */}
      {/*
        ─── THE AMOUNT SELECTOR LIVES HERE, ABOVE BOTH SECTIONS ────────────
        It used to sit inside the pools section further down the page, while
        the staking rows above it already read `amount` to compute their
        projection. So the staking numbers were driven by a control the user
        could not see until they had scrolled past them — the owner reported
        it as "it doesn't say how much", which is what a control that changes
        nothing visible looks like.

        One selector, above everything that depends on it. A control must be
        visible from whatever it changes.
      */}
      <div className="farm-amounts">
        <span className="faint">{t('farm.ifIDeposit')}</span>
        <div className="row" style={{ gap: 6 }}>
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              className={`tag ${amount === a ? 'active' : ''}`}
              onClick={() => setAmount(a)}
            >
              {fmtUsd(a)}
            </button>
          ))}
        </div>
      </div>

      {stakingRows.length > 0 && (
        <section>
          <p className="section-label">{t('farm.stakingTitle')}</p>
          <p className="farm-filtered faint">{t('farm.stakingIntro')}</p>

          <motion.div className="stack" style={{ gap: 10, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {stakingRows.map(({ asset, live }) => {
              const projection = live ? projectStake(live.apy, amount) : null;
              return (
                <motion.div key={asset.id} className="farm-pool" variants={riseIn}>
                  <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      {/* TokenIcon, not a bare <img>: a raw tag with no
                          onError leaves an empty circle when the CDN fails,
                          which reads as broken. See lib/tokenIcon.jsx. */}
                      <TokenIcon token={asset} size={34} />
                      <div style={{ minWidth: 0 }}>
                        <div className="farm-pool-sym">{asset.symbol}</div>
                        <div className="set-row-sub">{asset.name}</div>
                      </div>
                    </div>
                    {/* No yield shown at all when the feed has no match — a
                        missing number beats a stale one. */}
                    {live && (
                      <div style={{ textAlign: 'end', flexShrink: 0 }}>
                        <div className="farm-apy mono">{live.apy}%</div>
                        <div className="faint" style={{ fontSize: 10.5 }}>{t('farm.apy')}</div>
                      </div>
                    )}
                  </div>

                  <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <span className="pill pill-neutral">{t('farm.noIl')}</span>
                    {asset.capturesMev && <span className="pill pill-rgb">{t('farm.mevBoost')}</span>}
                    {asset.protocolFeePct != null && (
                      <span className="pill pill-neutral">
                        {t('farm.protocolFee', { pct: asset.protocolFeePct })}
                      </span>
                    )}
                  </div>

                  {projection && (
                    <div className="farm-calc">
                      <span className="faint">{t('farm.wouldEarn', { amount: fmtUsd(amount) })}</span>
                      <span className="mono farm-calc-num">
                        {fmtUsd(projection.year)}<span className="faint">/{t('farm.year')}</span>
                      </span>
                    </div>
                  )}

                  <div className="farm-actions">
                    <button
                      className="btn btn-ghost farm-btn"
                      onClick={() => {
                        haptic?.('select');
                        navigate(`/solana?to=${encodeURIComponent(asset.mint)}`);
                      }}
                    >
                      <IconSwap width={15} height={15} />
                      {t('farm.stakeNow', { sym: asset.symbol })}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          <p className="faint" style={{ marginTop: 10, lineHeight: 1.75 }}>{t('farm.stakingNote')}</p>
        </section>
      )}

      {/* ---------- ethereum staking ---------- */}
      {/*
        ─── WHY THIS SECTION EARNS AND THE POOL LIST BELOW DOES NOT ───────────
        The pools further down are read from DefiLlama and link OUT to the
        protocol. That is useful information and it pays us nothing — we do the
        work of finding the yield and hand the transaction to somebody else.

        Ethereum staking is different because buying the token IS the deposit.
        stETH and rETH grow against ETH by themselves; there is no separate
        stake step, no lock-up, and unstaking is just swapping back. So the
        exact outcome the user wants can be delivered by our own swap screen at
        the normal 0.70%, with no extra contract for them to approve.
        Verified live before shipping: both echoed our fee receiver back.

        This mirrors what the Solana section above already does with jitoSOL
        and mSOL — the EVM half was simply missing.
      */}
      <section>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('farm.ethStakingTitle')}</p>
        </div>

        <motion.div variants={stagger} initial="hidden" animate="show" className="stack" style={{ gap: 9 }}>
          {ETH_STAKE_TOKENS.map((tk) => {
            const live = (data?.pools ?? []).find(
              (pl) => String(pl.symbol || '').toUpperCase() === tk.symbol.toUpperCase()
            );
            return (
              <motion.div key={tk.symbol} className="card card-soft" variants={riseIn}>
                <div className="row-between">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{tk.symbol}</div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{tk.name}</div>
                  </div>
                  {/*
                    Only shown when the live feed actually carries this token.
                    A hard-coded APY would be wrong within a week and nobody
                    would notice — the same mistake this page was built to fix.
                  */}
                  {live?.apy != null && (
                    <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--rgb-4)' }}>
                      {live.apy.toFixed(2)}%
                    </div>
                  )}
                </div>

                <div className="farm-actions" style={{ marginTop: 10 }}>
                  <button
                    className="btn btn-ghost farm-btn"
                    onClick={() => {
                      haptic?.('select');
                      navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(tk.symbol)}`);
                    }}
                  >
                    <IconSwap width={15} height={15} />
                    {t('farm.stakeNow', { sym: tk.symbol })}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        <p className="faint" style={{ marginTop: 10, lineHeight: 1.75 }}>{t('farm.ethStakingNote')}</p>
      </section>

      {/* ---------- pools ---------- */}
      <section>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('farm.pools')}</p>
        </div>

        {/*
          How many were rejected. One line, and it explains the whole screen
          better than a paragraph would: the user can see that the short list
          is short on purpose.
        */}
        {data && (
          <p className="farm-filtered faint">
            {t('farm.filteredNote', { shown: data.pools.length, considered: data.considered })}
          </p>
        )}

        <div className="segmented" style={{ marginBottom: 10 }}>
          {RISK_FILTERS.map((k) => (
            <button
              key={k}
              className={risk === k ? 'active' : ''}
              onClick={() => {
                haptic?.('select');
                setRisk(k);
              }}
              style={{ isolation: 'isolate' }}
            >
              {risk === k && <SegIndicator id="farmrisk" />}
              {t(`farm.filter.${k}`)}
            </button>
          ))}
        </div>

        {loading && (
          <div className="stack" style={{ gap: 9, marginTop: 8 }}>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="skel"
                style={{ height: 96, borderRadius: 14 }}
                animate={{ opacity: [0.4, 0.9, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
              />
            ))}
          </div>
        )}

        {/*
          No offline fallback, deliberately — see the note in lib/yields.js.
          A stale price corrects itself next refresh; a stale APY sends someone
          to a pool that no longer pays what the screen said.
        */}
        {!loading && error && <p className="notice notice-danger">{t('farm.unavailable')}</p>}

        {!loading && !error && pools.length === 0 && (
          <p className="notice">{t('farm.noneInBand')}</p>
        )}

        {!loading && pools.length > 0 && (
          <motion.div className="stack" style={{ gap: 10, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {pools.map((p) => (
              <PoolRow
                key={p.id}
                pool={p}
                amount={amount}
                onOpen={open}
                onGetTokens={getTokens}
                t={t}
              />
            ))}
          </motion.div>
        )}

        <p className="faint" style={{ marginTop: 10, lineHeight: 1.7 }}>{t('farm.aprNote')}</p>
      </section>

      <AdBanner slot="swap" />

      <InfoBox title={t('farm.custodyTitle')} tone="info" id="farm-custody">
        <p>{t('farm.custodyNotice')}</p>
      </InfoBox>

      {!wallet.isConnected && (
        <button className="btn btn-ghost" onClick={() => navigate('/wallet')}>
          {t('wallet.connect')}
        </button>
      )}

      <motion.button
        className="card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/earn')}
        style={{ textAlign: 'start', cursor: 'pointer' }}
      >
        <div className="row-between">
          <div>
            <div style={{ fontWeight: 700 }}>{t('farm.rewardsLink')}</div>
            <div className="faint">{t('farm.rewardsLinkSub')}</div>
          </div>
          <span style={{ fontSize: 20 }}>›</span>
        </div>
      </motion.button>
    </PageTransition>
  );
}
