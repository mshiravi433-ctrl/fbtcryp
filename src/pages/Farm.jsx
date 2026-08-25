import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import SegIndicator from '../components/SegIndicator';
import VaultCard from '../components/VaultCard';
import { fmtCompact, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { IconExternal, IconPools, IconShield, IconSwap } from '../components/Icons';
import TokenIcon from '../lib/tokenIcon';
import { useHideBalances } from '../hooks/useHideBalances';
import {
  RISK_BANDS,
  getYields,
  farmScore,
  impermanentLoss,
  pairSwapRoute,
  pairTokens,
  projectEarnings,
  rateIsUnusual,
  realShare
} from '../lib/yields';
import { TOKENS } from '../lib/chains';
import { getSolanaAssets, projectStake, yieldForLst } from '../lib/solanaAssetsClient';
import { vaultConfig } from '../lib/vault';
import { GMX_CODE, isValidGmxCode, withReferral } from '../lib/venueReferral';

/**
 * FARM — live yields + in-app revenue routes.
 *
 * Tabs live ON this page. Existing /earn /stocks /ostium /dydx stay mounted
 * elsewhere; we only deep-link. Nothing is deleted.
 */

const RISK_FILTERS = ['all', ...RISK_BANDS];
const AMOUNTS = [100, 1000, 10000];
const FARM_TABS = ['inapp', 'market', 'trade'];

/**
 * Deep-link targets for `?focus=`.
 *
 * Earn's yield rows open a PRODUCT, not a tab: "gold" has to land on the gold
 * section, not somewhere near the top of the in-app tab with the user still
 * scrolling. The id is the section's own DOM id, so a section that is renamed
 * here breaks the scroll and nothing else.
 */
const FARM_FOCUS = {
  gold: 'farm-gold',
  eth: 'farm-eth',
  sol: 'farm-sol'
};
const HORIZONS = ['day', 'week', 'month', 'year'];
const HORIZON_DIVISOR = { day: 365, week: 52, month: 12, year: 1 };

const ETH_STAKE_TOKENS = (TOKENS[1] ?? []).filter((tk) => tk.stake === 'eth');
const GOLD_TOKENS = (TOKENS[1] ?? []).filter((tk) => tk.rwa === 'gold');

function RiskPill({ risk, t }) {
  const cls = risk === 'low' ? 'pill-neutral' : risk === 'medium' ? 'pill-rgb' : 'pill-down';
  return <span className={`pill ${cls}`}>{t(`farm.risk.${risk}`)}</span>;
}

function SplitBar({ pool }) {
  const share = realShare(pool);
  if (share == null) return null;
  return (
    <div className="farm-split" title={`${Math.round(share * 100)}%`}>
      <div className="farm-split-real" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

function FeePill({ label }) {
  return <span className="pill pill-rgb">{label}</span>;
}

function PoolRow({ pool, amount, horizon, onOpen, onGetTokens, t }) {
  const share = realShare(pool);
  const unusual = rateIsUnusual(pool);
  const score = farmScore(pool);
  const projection = projectEarnings(pool, amount);
  const route = pairSwapRoute(pool);
  const pair = pairTokens(pool);
  const [showIl, setShowIl] = useState(false);
  const [ilK, setIlK] = useState(1.5);
  const shown = projection ? projection[horizon] : null;
  const realPart = projection?.fromRealYield;
  const div = HORIZON_DIVISOR[horizon] ?? 1;
  const shownReal = realPart == null ? null : realPart / div;
  const il = pair.length === 2 ? impermanentLoss(ilK) : null;
  const ilPct = il == null ? null : `${(il * 100).toFixed(2)}%`;

  return (
    <motion.div className="farm-pool" variants={riseIn} id={`farm-pool-${pool.id}`}>
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
          {score != null && <div className="farm-score mono">{t('farm.score', { score })}</div>}
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <RiskPill risk={pool.risk} t={t} />
        {pool.ilRisk && <span className="pill pill-down">{t('farm.ilShort')}</span>}
        {pool.stablecoin && <span className="pill pill-neutral">{t('farm.stableShort')}</span>}
        <span className="pill pill-neutral">{t('farm.tvl')} {fmtCompact(pool.tvlUsd)}</span>
        {/*
          The Solana pill does NOT say 0.70%: that is the EVM rate. On
          Solana the fee is what the quote shows (some routes carry 0%
          today), and a pill that states a flat rate would be a number the
          screen would not honour.
        */}
        {route && <FeePill label={route.kind === 'solana' ? t('farm.earn.solanaFee') : t('farm.earn.inAppFee')} />}
      </div>

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

      {unusual && (
        <p className={`farm-unusual farm-unusual-${unusual.direction}`}>
          {t(`farm.unusual.${unusual.direction}`, { ratio: unusual.ratio, mean: unusual.mean })}
        </p>
      )}

      {projection && (
        <div className="farm-calc">
          <span className="faint">{t('farm.wouldEarn', { amount: fmtUsd(amount) })}</span>
          <span className="mono farm-calc-num">
            {fmtUsd(shown)}
            <span className="faint">/{t(`farm.${horizon}`)}</span>
          </span>
        </div>
      )}
      {projection && <p className="faint farm-calc-cond">{t('farm.rateConditional')}</p>}
      {shownReal != null && (
        <p className="faint" style={{ marginTop: 4 }}>
          {t('farm.realShareMoney', { amount: fmtUsd(shownReal) })}
        </p>
      )}

      {pair.length === 2 && (
        <div className="farm-il">
          <button
            type="button"
            className="farm-il-toggle"
            aria-expanded={showIl}
            onClick={() => setShowIl((v) => !v)}
          >
            <span style={{ color: 'var(--down)', flexShrink: 0 }}>{showIl ? '−' : '+'}</span>
            <span>{t('farm.ilToyTitle')}</span>
          </button>
          {showIl && (
            <div className="farm-il-body">
              <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="faint">{t('farm.ilMultiple')}:</span>
                <input
                  className="farm-il-input"
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  step="0.1"
                  value={Number.isFinite(ilK) ? ilK : 0.1}
                  onChange={(e) => setIlK(Math.max(0.1, Number(e.target.value) || 0.1))}
                  aria-label={t('farm.ilMultiple')}
                />
                <span className="faint">×</span>
              </div>
              <div className="mono farm-il-out">{ilPct}</div>
              <p className="faint farm-il-note">{t('farm.ilFeeNote')}</p>
            </div>
          )}
        </div>
      )}

      <div className="farm-actions">
        {route && (
          <button
            className="btn btn-ghost farm-btn"
            title={t('farm.getTokens', { a: route.from, b: route.to })}
            onClick={() => onGetTokens(route)}
          >
            <IconSwap width={15} height={15} />
            <span className="farm-btn-text">
              <span className="farm-btn-label">{t('farm.getPair')}</span>
              <span className="farm-btn-sub">{route.from}·{route.to}</span>
            </span>
          </button>
        )}
        <button
          className="btn btn-ghost farm-btn farm-btn-minor"
          title={t('farm.openPoolHint')}
          onClick={() => onOpen(pool.url)}
        >
          {t('farm.openPool')}
          <IconExternal width={15} height={15} />
        </button>
      </div>
    </motion.div>
  );
}

function InvestCard({ title, sub, apy, pills, cta, onCta, extra }) {
  return (
    <motion.div className="farm-pool" variants={riseIn}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="farm-pool-sym">{title}</div>
          {sub && <div className="set-row-sub">{sub}</div>}
        </div>
        {apy != null && (
          <div style={{ textAlign: 'end', flexShrink: 0 }}>
            <div className="farm-apy mono">{typeof apy === 'number' ? `${apy}%` : apy}</div>
          </div>
        )}
      </div>
      {pills && (
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{pills}</div>
      )}
      {extra}
      {cta && (
        <div className="farm-actions">
          <button className="btn btn-ghost farm-btn" onClick={onCta}>
            <IconSwap width={15} height={15} />
            {cta}
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default function Farm() {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();

  const fromUrl = params.get('tab');
  const tab = FARM_TABS.includes(fromUrl) ? fromUrl : 'inapp';
  const focus = params.get('focus');

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lst, setLst] = useState([]);
  const [risk, setRisk] = useState('all');
  const [amount, setAmount] = useState(AMOUNTS[1]);
  const [customAmt, setCustomAmt] = useState('');
  const [horizon, setHorizon] = useState('year');
  const [showIl, setShowIl] = useState(false);
  const [q, setQ] = useState('');
  const [onlyStable, setOnlyStable] = useState(false);
  const [onlyBuyable, setOnlyBuyable] = useState(false);
  const [chainFilter, setChainFilter] = useState('all');

  /*
   * Scroll to the section a deep link asked for.
   *
   * Declared below the state it lists as dependencies: a dependency array is
   * evaluated during render, so naming `data` or `lst` above their `useState`
   * lines throws in the temporal dead zone before the effect ever registers.
   *
   * It re-runs when the pool data lands because the gold and staking sections
   * are rendered from that data — on the first pass they do not exist yet and
   * `getElementById` finds nothing. The ref makes it fire at most once per
   * requested focus, so a later refresh cannot yank the page back up while
   * the user is reading.
   */
  const focusedRef = useRef(null);
  useEffect(() => {
    const id = focus ? FARM_FOCUS[focus] : null;
    if (!id || focusedRef.current === focus) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    focusedRef.current = focus;
  }, [focus, data, lst]);


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
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const deposit = useMemo(() => {
    const n = Number(customAmt);
    if (Number.isFinite(n) && n > 0) return n;
    return amount;
  }, [amount, customAmt]);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const getTokens = (route) => {
    haptic?.('select');
    /*
     * Solana pools route to the Solana screen, never /swap: the EVM registry
     * has no say there, and `?toMint=` is the parameter SolanaSwap honours
     * with a verified mint (the route was already resolved against the
     * mint-verified lists in lib/yields.js — an unresolved leg would never
     * reach this button).
     */
    if (route.kind === 'solana') {
      navigate(`/solana?toMint=${encodeURIComponent(route.toMint)}`);
      return;
    }
    navigate(`/swap?chain=${route.chainId}&from=${encodeURIComponent(route.from)}&to=${encodeURIComponent(route.to)}`);
  };

  const selectTab = (id) => {
    if (id === tab) return;
    haptic?.('select');
    setParams({ tab: id }, { replace: true });
  };

  const chainOptions = useMemo(() => {
    const set = new Set((data?.pools ?? []).map((p) => p.chain).filter(Boolean));
    return ['all', ...[...set].sort()];
  }, [data]);

  const pools = useMemo(() => {
    let all = data?.pools ?? [];
    if (risk !== 'all') all = all.filter((p) => p.risk === risk);
    if (onlyStable) all = all.filter((p) => p.stablecoin);
    if (chainFilter !== 'all') all = all.filter((p) => p.chain === chainFilter);
    if (onlyBuyable) all = all.filter((p) => pairSwapRoute(p));
    const needle = q.trim().toLowerCase();
    if (needle) {
      all = all.filter((p) =>
        `${p.symbol} ${p.project} ${p.chain}`.toLowerCase().includes(needle)
      );
    }
    return all;
  }, [data, risk, onlyStable, chainFilter, onlyBuyable, q]);

  /*
   * Top of the already-filtered list by farmScore, used by both the hot strip
   * and the advisor. Computed once from the filtered `pools` so the two agree
   * and neither fetches anything extra.
   */
  const topPools = useMemo(() => {
    return pools
      .map((p) => ({ pool: p, score: farmScore(p) }))
      .filter((x) => x.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [pools]);

  const scrollToPool = (id) => {
    haptic?.('light');
    document.getElementById(`farm-pool-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const stakingRows = useMemo(
    () => lst.map((a) => ({ asset: a, live: yieldForLst(a, data?.pools ?? []) })),
    [lst, data]
  );

  const vault = vaultConfig();

  const amountBar = (
    <div className="farm-amounts">
      <span className="faint">{t('farm.ifIDeposit')}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            className={`tag ${amount === a && !customAmt ? 'active' : ''}`}
            onClick={() => {
              setAmount(a);
              setCustomAmt('');
            }}
          >
            {fmtUsd(a)}
          </button>
        ))}
        <input
          className="farm-amt-input"
          inputMode="decimal"
          placeholder={t('farm.customAmt')}
          value={customAmt}
          onChange={(e) => setCustomAmt(e.target.value.replace(/[^\d.]/g, ''))}
          aria-label={t('farm.customAmt')}
        />
        <div className="segmented" style={{ flex: '0 0 auto' }}>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              className={horizon === h ? 'active' : ''}
              onClick={() => {
                haptic?.('select');
                setHorizon(h);
              }}
              style={{ isolation: 'isolate' }}
            >
              {horizon === h && <SegIndicator id="farmhorizon" />}
              {t(`farm.${h}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('farm.title')}</h1>
        <p className="muted">{t('farm.subtitle')}</p>
      </motion.div>

      <div className="segmented seg-lg farm-tabs" role="tablist">
        {FARM_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => selectTab(id)}
            style={{ isolation: 'isolate' }}
          >
            {tab === id && <SegIndicator id="farmtab" />}
            {t(`farm.tab.${id}`)}
          </button>
        ))}
      </div>

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

      {amountBar}

      {tab === 'inapp' && (
        <>
          {vault && <VaultCard />}

          {stakingRows.length > 0 && (
            <section id="farm-sol">
              <p className="section-label">{t('farm.stakingTitle')}</p>
              <p className="farm-filtered faint">{t('farm.stakingIntro')}</p>
              <motion.div className="stack" style={{ gap: 10, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
                {stakingRows.map(({ asset, live }) => {
                  const projection = live ? projectStake(live.apy, deposit) : null;
                  const shown = projection && horizon ? projection.year / HORIZON_DIVISOR[horizon] : null;
                  return (
                    <motion.div key={asset.id} className="farm-pool" variants={riseIn}>
                      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
                        <div className="row" style={{ gap: 10, minWidth: 0 }}>
                          <TokenIcon token={asset} size={34} />
                          <div style={{ minWidth: 0 }}>
                            <div className="farm-pool-sym">{asset.symbol}</div>
                            <div className="set-row-sub">{asset.name}</div>
                          </div>
                        </div>
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
                          <span className="pill pill-neutral">{t('farm.protocolFee', { pct: asset.protocolFeePct })}</span>
                        )}
                        <FeePill label={t('farm.earn.inAppFee')} />
                      </div>
                      {projection && (
                        <div className="farm-calc">
                          <span className="faint">{t('farm.wouldEarn', { amount: fmtUsd(deposit) })}</span>
                          <span className="mono farm-calc-num">
                            {fmtUsd(shown)}
                            <span className="faint">/{t(`farm.${horizon}`)}</span>
                          </span>
                        </div>
                      )}
                      {projection && <p className="faint farm-calc-cond">{t('farm.rateConditional')}</p>}
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

          <section id="farm-eth">
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
                      {live?.apy != null && (
                        <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--rgb-4)' }}>
                          {live.apy.toFixed(2)}%
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <FeePill label={t('farm.earn.inAppFee')} />
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

          <section id="farm-gold">
            <p className="section-label">{t('farm.goldTitle')}</p>
            <p className="farm-filtered faint">{t('farm.goldIntro')}</p>
            <motion.div variants={stagger} initial="hidden" animate="show" className="stack" style={{ gap: 9 }}>
              {GOLD_TOKENS.map((tk) => (
                <InvestCard
                  key={tk.symbol}
                  title={tk.symbol}
                  sub={tk.name}
                  pills={(
                    <>
                      <span className="pill pill-down">{t('farm.goldFreeze')}</span>
                      <FeePill label={t('farm.earn.inAppFee')} />
                    </>
                  )}
                  extra={<p className="notice" style={{ marginTop: 10 }}>{t('farm.goldWarn')}</p>}
                  cta={t('farm.buyHere', { sym: tk.symbol })}
                  onCta={() => {
                    haptic?.('select');
                    navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(tk.symbol)}`);
                  }}
                />
              ))}
            </motion.div>
          </section>

          <InvestCard
            title={t('farm.stocksTitle')}
            sub={t('farm.stocksBody')}
            pills={<FeePill label={t('farm.earn.inAppFee')} />}
            cta={t('farm.stocksCta')}
            onCta={() => {
              haptic?.('select');
              navigate('/stocks');
            }}
          />

          <InvestCard
            title={t('farm.bridgeTitle')}
            sub={t('farm.bridgeBody')}
            pills={<FeePill label={t('farm.earn.bridgeFee')} />}
            cta={t('farm.bridgeCta')}
            onCta={() => {
              haptic?.('select');
              navigate('/bridge');
            }}
          />
        </>
      )}

      {tab === 'market' && (
        <section>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <p className="section-label" style={{ margin: 0 }}>{t('farm.pools')}</p>
          </div>
          {data && (
            <p className="farm-filtered faint">
              {t('farm.filteredNote', { shown: data.pools.length, considered: data.considered })}
            </p>
          )}

          <input
            className="farm-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('farm.search')}
            aria-label={t('farm.search')}
          />

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
            <button type="button" className={`tag ${onlyStable ? 'active' : ''}`} onClick={() => setOnlyStable((v) => !v)}>
              {t('farm.filterStable')}
            </button>
            <button type="button" className={`tag ${onlyBuyable ? 'active' : ''}`} onClick={() => setOnlyBuyable((v) => !v)}>
              {t('farm.filterBuyable')}
            </button>
            <select
              className="farm-chain-select"
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              aria-label={t('farm.filterChain')}
            >
              {chainOptions.map((c) => (
                <option key={c} value={c}>{c === 'all' ? t('farm.filter.all') : c}</option>
              ))}
            </select>
          </div>

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

          {!loading && !error && topPools.length > 0 && (
            <div className="farm-hot">
              <p className="section-label">{t('farm.hot')}</p>
              <div className="farm-hot-grid">
                {topPools.map(({ pool, score }) => (
                  <button
                    type="button"
                    className="farm-hot-card"
                    key={pool.id}
                    onClick={() => scrollToPool(pool.id)}
                  >
                    <span className="farm-hot-sym">{pool.symbol}</span>
                    <span className="mono farm-hot-apy">{pool.apy}%</span>
                    <span className="mono farm-hot-score">{t('farm.score', { score })}</span>
                    <RiskPill risk={pool.risk} t={t} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && !error && topPools.length > 0 && (
            <div className="farm-advisor">
              <p className="section-label">{t('farm.advisorTitle')}</p>
              <p className="farm-filtered faint" style={{ marginTop: 0 }}>
                {t('farm.ifIDeposit')} {fmtUsd(deposit)} · {risk === 'all' ? t('farm.filter.all') : t(`farm.filter.${risk}`)}
              </p>
              <div className="stack" style={{ gap: 8 }}>
                {topPools.map(({ pool, score }) => (
                  <div key={pool.id} className="farm-advisor-row">
                    <span className="farm-advisor-sym">{pool.symbol}</span>
                    <span className="mono farm-advisor-apy">{pool.apy}%</span>
                    <span className="mono farm-advisor-score">{t('farm.score', { score })}</span>
                    <RiskPill risk={pool.risk} t={t} />
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  amount={deposit}
                  horizon={horizon}
                  onOpen={open}
                  onGetTokens={getTokens}
                  t={t}
                />
              ))}
            </motion.div>
          )}

          <p className="faint" style={{ marginTop: 10, lineHeight: 1.7 }}>{t('farm.aprNote')}</p>
        </section>
      )}

      {tab === 'trade' && (
        <section className="stack" style={{ gap: 10 }}>
          <p className="section-label">{t('farm.tradeTitle')}</p>
          <p className="farm-filtered faint">{t('farm.tradeIntro')}</p>
          <InvestCard
            title={t('nav.ostium')}
            sub={t('farm.tradeOstium')}
            pills={<FeePill label={t('farm.earn.builderFee')} />}
            cta={t('farm.tradeOpen')}
            onCta={() => {
              haptic?.('select');
              navigate('/ostium');
            }}
          />
          <InvestCard
            title={t('nav.dydx')}
            sub={t('farm.tradeDydx')}
            pills={<FeePill label={t('farm.earn.builderFee')} />}
            cta={t('farm.tradeOpen')}
            onCta={() => {
              haptic?.('select');
              navigate('/dydx');
            }}
          />
          {isValidGmxCode(GMX_CODE) && (
            <InvestCard
              title="GMX"
              sub={t('farm.tradeGmx')}
              pills={<FeePill label={t('farm.earn.refFee')} />}
              cta={t('farm.tradeOpen')}
              onCta={() => open(withReferral('gmx', 'https://app.gmx.io/#/trade'))}
            />
          )}
        </section>
      )}

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
