import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import SolanaWalletTab from '../components/SolanaWalletTab';
import InfoBox from '../components/InfoBox';
import AnimatedNumber from '../components/AnimatedNumber';
import Sheet from '../components/Sheet';
import SegIndicator from '../components/SegIndicator';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import WalletConnectSheet from '../components/WalletConnectSheet';
import SendSheet from '../components/SendSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import BtcCard from '../components/BtcCard';
import BtcHubSheet from '../components/BtcHubSheet';
import WalletActionRow from '../components/WalletActionRow';
import WalletIntelTiles from '../components/WalletIntelTiles';
import WalletPnl from '../components/WalletPnl';
import ActiveOrdersCard from '../components/ActiveOrdersCard';
import TokenDetailSheet from '../components/TokenDetailSheet';
import Portfolio from '../pages/Portfolio';
import { explorerAddr } from '../lib/chains';
import { solanaAddress } from '../lib/solanaWallet';
import { EVM_CHAINS, TOKENS } from '../lib/chains';
import { currencyOf } from '../lib/currency';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHideBalances } from '../hooks/useHideBalances';
import { useMultiChainPortfolio } from '../hooks/useMultiChainPortfolio';
import { useAppStore } from '../store/useAppStore';
import { exportWallet, shareWalletBackup, BACKUP_FILENAME } from '../lib/walletBackup';
import { revealMnemonic } from '../lib/localWallet';
import { buildIntelligence } from '../lib/portfolioIntel';
import { cleanAssetText, groupHoldings } from '../lib/walletRisk';
import { apiBase } from '../lib/apiBase';
import TokenIcon from '../lib/tokenIcon';
import NetworkSelect from '../components/NetworkSelect';
import AssetIcon from '../components/AssetIcon';
import { balancesHidden } from '../lib/format';
import { IconGlobe, IconChevronRight, IconShield, IconWallet } from '../components/Icons';
import {
  WalIdenticon, IconWalCopy, IconWalCheck, IconWalEye, IconWalEyeOff,
  IconWalRefresh, IconWalPower, IconWalLock, IconWalExternal, IconWalSearch,
  IconWalLayers, IconWalNodes, IconWalPool, IconWalGem, IconWalTrend,
  IconWalKey, IconWalArchive, IconWalTriUp, IconWalTriDown
} from '../components/WalletGlassIcons';
import { WalletMesh, WalletEmptyMark } from '../components/WalletArt';
import '../styles/wallet-modern.css';
import '../styles/wallet.css';
/* Glass 3.0 — imported LAST so the scoped redesign wins its cascade ties.
   Everything in it lives under `.walx`; see the file's header for the
   anti-flicker contract (opaque hero, static aurora, no backdrop blur on
   native/lite, one-shot entrance). */
import '../styles/wallet-glass.css';

/*
 * ─── HIDE-BALANCES FINALLY REACHES THIS PAGE ───────────────────────────────
 * lib/format.js masks money (`•••`) at the formatter, for exactly the reason
 * written there: "a screen where SOME numbers are masked leaks exactly the
 * ones that were missed". THIS page was the miss — it formats with its own
 * fmtCurrencyValue/fmtQty, so the hero total, every chain total and every
 * asset row stayed visible while the settings toggle was on (only the
 * network dropdown and the blurred address honoured it). Both local
 * formatters now read the same module flag the store keeps in sync, and
 * `Wallet()` already subscribes via useHideBalances() so the mask lands the
 * instant the switch moves — including from the new eye on the balance box.
 */
const WAL_MASK = '•••';

function fmtCurrencyValue(v, currency, opts = {}) {
  if (v == null || !Number.isFinite(v)) return null;
  if (balancesHidden()) return WAL_MASK;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.code,
      maximumFractionDigits: v < 1 ? 4 : v < 1000 ? 2 : 0,
      ...opts
    }).format(v);
  } catch {
    return `${currency.symbol}${v.toFixed(2)}`;
  }
}

function fmtQty(v) {
  if (!Number.isFinite(v)) return '—';
  if (balancesHidden()) return WAL_MASK;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1000) return (v / 1000).toFixed(2) + 'K';
  if (abs < 0.00001 && abs > 0) return v.toExponential(2);
  if (abs < 1) return v.toFixed(6);
  return v.toFixed(4);
}

function copyText(text, haptic) {
  try { navigator.clipboard?.writeText(text); haptic?.('success'); } catch { /* noop */ }
}

function openInExplorer(url) { if (url) window.open(url, '_blank', 'noopener,noreferrer'); }

/* The refresh/power glyphs that used to be hand-rolled here moved to
   WalletGlassIcons (IconWalRefresh / IconWalPower) so the whole page draws
   at one stroke weight — IconDisconnect was defined and never rendered,
   which is how the disconnect button ended up text-only next to iconned
   neighbours. */

/* Provider label helpers */
function providerLabel(wallet, t) {
  if (!wallet.address || wallet.locked) return t('wallet.notConnected');
  switch (wallet.mode) {
    case 'wc': return 'WalletConnect';
    case 'injected': {
      /* The EIP-6963 info of the provider we actually attached (exposed as
         wallet.injectedInfo). Fall back to the legacy window.ethereum flags
         only when no announcement was matched — never guess a brand. */
      if (wallet.injectedInfo?.name) return wallet.injectedInfo.name;
      const eth = window.ethereum;
      if (eth?.isMetaMask) return 'MetaMask';
      if (eth?.isTrust) return 'Trust Wallet';
      if (eth?.isCoinbaseWallet) return 'Coinbase Wallet';
      return t('wallet.injected');
    }
    case 'local': return t('wallet.localWallet');
    default: return t('wallet.onchain');
  }
}

/** Compact change label for the hero 24H/7D/30D chips — real data only. */
function changeLabel(ch, currency) {
  if (!ch) return '—';
  if (ch.from && ch.from > 0) {
    const pct = (ch.abs / ch.from) * 100;
    return `${ch.abs >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }
  return `${ch.abs >= 0 ? '+' : ''}${fmtCurrencyValue(ch.abs, currency) ?? ''}`;
}

function WalHero({
  wallet, currency, portfolio, intel, chips, hideBalances, t,
  onConnect, onDisconnect, onRefresh, onCopy, onExplorer, switchChain, haptic, onRetry, onToggleHide,
  /* The portfolio view filter: which network's holdings the page is showing.
     It is NOT the wallet's active chain — «همه شبکه‌ها» is a view, and so is
     looking at Base while the wallet sits on BSC. */
  selectedChain = 'all', onSelectChain, children
}) {
  const connected = Boolean(wallet.address) && !wallet.locked;
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState(null);

  /* Copy feedback: the address pill shows a check for a beat after a copy.
     Clipboard + haptic stay with the parent's onCopy — this state is purely
     the visual receipt (a silent clipboard write is indistinguishable from
     a dead button in a WebView where navigator.clipboard may not exist). */
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const handleCopyAddress = useCallback(() => {
    onCopy?.(wallet.address);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  }, [onCopy, wallet.address]);

  /* Spectrum-bar segments: each priced network's share of the same total
     the hero prints, from the same read — so the bar can never disagree
     with the number above it or the breakdown below it. Errored chains
     (totalValue null/0) contribute nothing, same as they contribute no
     money. Hidden with the balances: proportions are holdings information. */
  const spectrum = useMemo(() => {
    if (hideBalances || !portfolio?.loaded || !(portfolio?.totalValue > 0)) return [];
    return (portfolio.chains ?? [])
      .filter((c) => Number.isFinite(c.totalValue) && c.totalValue > 0)
      .map((c) => ({
        chainId: c.chainId,
        share: c.totalValue / portfolio.totalValue,
        color: c.chainColor || 'var(--rgb-1)',
        label: c.chainShort
      }))
      .sort((a, b) => b.share - a.share);
  }, [portfolio?.chains, portfolio?.loaded, portfolio?.totalValue, hideBalances]);

  /* Per-network figures for the picker's rows. Built from the portfolio the
     hero already renders, so the dropdown and the breakdown below it can never
     disagree about what is on a chain; `hideBalances` is respected here too —
     a hidden portfolio must not leak a total through a dropdown. */
  const { chainMeta, allMeta } = useMemo(() => {
    const meta = {};
    for (const chain of portfolio?.chains ?? []) {
      meta[chain.chainId] = {
        amount: hideBalances ? '' : (fmtCurrencyValue(chain.totalValue, currency) ?? ''),
        assets: chain.rows?.length ?? 0
      };
    }
    const assets = portfolio?.totalCount ?? 0;
    return {
      chainMeta: meta,
      allMeta: hideBalances
        ? (assets ? `${assets} ${t('wallet.assetsUnit')}` : '')
        : [fmtCurrencyValue(portfolio?.totalValue, currency), assets ? `${assets} ${t('wallet.assetsUnit')}` : '']
          .filter(Boolean).join(' · ')
    };
  }, [portfolio?.chains, portfolio?.totalCount, portfolio?.totalValue, currency, hideBalances, t]);

  const handleSwitch = useCallback(async (targetId) => {
    if (switching) return;
    setSwitching(true);
    setSwitchErr(null);
    haptic?.('select');
    try {
      const ok = await switchChain(Number(targetId));
      if (!ok) setSwitchErr('REJECTED');
    } catch {
      setSwitchErr('FAILED');
    } finally {
      setSwitching(false);
      setTimeout(() => setSwitchErr(null), 2500);
    }
  }, [switchChain, switching, haptic]);

  return (
    <section className="wallet-hero-modern wal-hero walx-hero">
      <div className="wallet-hero-aurora wal-hero-aurora" aria-hidden="true" />
      <WalletMesh className="wal-mesh" />

      {connected ? (
        <div className="walx-hero-in">
          {/* Identity: a face grown from the address (WalIdenticon), the
              copyable address with its live dot, then chain + provider. */}
          <div className="walx-idrow walx-rise">
            <span className="walx-id">
              <WalIdenticon address={wallet.address} size={34} />
              <button
                type="button"
                className={`walx-addr ${hideBalances ? 'wal-addr-blur' : ''}`}
                onClick={handleCopyAddress}
                title={t('wallet.copyAddress')}
                aria-label={t('wallet.copyAddress')}
              >
                <span className={`wal-chip-dot ${wallet.locked ? '' : 'is-live'}`} style={{ background: 'var(--up)' }} aria-hidden="true" />
                {/* An address is LTR data in every locale — without dir=ltr
                    the ellipsis seam reorders under RTL and the pill wrapped
                    onto two lines in the screenshot pass. */}
                <span dir="ltr">{shortAddress(wallet.address, 6)}</span>
                {copied
                  ? <IconWalCheck className="walx-copied" />
                  : <IconWalCopy />}
              </button>
            </span>
            <span className="walx-pills">
              <span className="walx-pill">
                <AssetIcon chain={wallet.chainId ?? 56} size={15} radius={5} />
                {wallet.chain?.short ?? 'BSC'}
              </span>
              <span className="walx-pill is-live">
                {wallet.locked
                  ? <IconWalLock width={12} height={12} />
                  : <span className="walx-pill-text">{providerLabel(wallet, t)}</span>}
              </span>
            </span>
          </div>

          {/* The balance box: label + the privacy eye, the number, its quiet
              metadata, then WHERE it sits (spectrum) and HOW it moved (24H/7D/30D). */}
          <div className="walx-balance walx-rise" style={{ '--walx-d': '45ms' }}>
            <div className="walx-bal-top">
              <span className="walx-bal-label">{t('wallet.portfolioTotal')} · {currency.code}</span>
              {/* The Settings switch, on the number it protects. Toggling
                  writes the same store key Settings owns — one flag, the
                  formatter masks, every figure on this page follows. */}
              <button
                type="button"
                className="walx-eye"
                onClick={onToggleHide}
                aria-pressed={hideBalances ? 'true' : 'false'}
                title={t('settings.hideBalances')}
                aria-label={t('settings.hideBalances')}
              >
                {hideBalances ? <IconWalEyeOff /> : <IconWalEye />}
              </button>
            </div>
            <div className="wal-hero-total walx-total">
              {/*
                THE NUMBER NEVER BECOMES «…» AGAIN.

                This is the reported bug verbatim: «هر چند ثانیه یکبار عدد
                موجودی کیف پول به سه نقطه تبدیل می‌شود». The old condition was
                `portfolio.loading && portfolio.totalValue === 0`, and
                `loading` is true for the whole of every refresh — a market
                tick re-runs the multi-chain read every 30 seconds, and a chain
                whose RPC timed out could zero the total it contributed. So the
                placeholder appeared and disappeared over a balance that was
                never wrong.

                Now the placeholder exists for exactly one state — NOTHING HAS
                BEEN READ YET (`portfolio.loaded === false`) — and it is a
                skeleton rather than a bare ellipsis. Once a number has been
                shown it stays on screen through every refresh, and when a read
                succeeds AnimatedNumber tweens to the NEW figure and flashes
                green/red. That is the whole requested behaviour: «باید روی
                موجودی بمونه و اگر بروز شد عدد جدید را نشان بدهد».

                Hide-balances is NOT an exception to that rule — it is the
                user asking for the mask, and the mask comes out of the same
                fmtCurrencyValue (it reads the format.js flag), so the dots
                are a value, not a loading state. `duration={0}` + no flash
                while hidden: tweening behind a mask would leak the
                DIRECTION of the change through the flash colour.
              */}
              {!portfolio.loaded ? (
                <span className="wal-total-skeleton" aria-hidden="true" />
              ) : (
                <AnimatedNumber
                  value={portfolio.totalValue}
                  format={(v) => fmtCurrencyValue(v, currency) || '—'}
                  flash={!hideBalances}
                  duration={hideBalances ? 0 : 520}
                />
              )}
            </div>
            <div className="walx-bal-meta">
              {/* Refreshing is shown as a quiet, non-destructive cue beside the
                  number — never in place of it. */}
              {portfolio.loaded && portfolio.loading && (
                <span className="wal-reval">
                  <span className="wal-reval-dot" aria-hidden="true" />
                  {t('wallet.updating')}
                </span>
              )}
              {portfolio.partial && portfolio.pricedCount > 0 && (
                <span className="wal-note">
                  {t('wallet.coverageShort', { priced: portfolio.pricedCount, total: portfolio.totalCount })}
                </span>
              )}
              {portfolio.updatedAt > 0 && (
                <span className="faint">
                  {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(portfolio.updatedAt)}
                </span>
              )}
              {/* The number came off the device, not off the network yet
                  (a reload, or a session still re-attaching). Saying so is the
                  difference between «fast» and «stale lying to me». */}
              {portfolio.fromSnapshot && (
                <span className="faint">{t('wallet.fromLastRead')}</span>
              )}
            </div>

            {/* Where the money sits — one segment per priced network, sized
                by its share of the total above. Decorative duplication of
                the breakdown card, so aria-hidden; the data is read there. */}
            {spectrum.length > 0 && (
              <div className="walx-spectrum" aria-hidden="true">
                {spectrum.map((s) => (
                  <span
                    key={s.chainId}
                    className="walx-spectrum-seg"
                    style={{ flexGrow: s.share, background: s.color }}
                    title={s.label}
                  />
                ))}
              </div>
            )}

            {/* 24H / 7D / 30D — real snapshot deltas only; else — */}
            <div className="walx-chg" role="group" aria-label={t('wallet.changes')}>
              {[['24H', intel?.change24h], ['7D', intel?.change7d], ['30D', intel?.change30d]].map(([label, ch]) => (
                <span key={label} className={`walx-chg-cell ${ch ? (ch.abs >= 0 ? 'is-up' : 'is-down') : ''}`}>
                  <span className="walx-chg-k">{label}</span>
                  {ch && (ch.abs >= 0 ? <IconWalTriUp /> : <IconWalTriDown />)}
                  <span className="walx-chg-v">{changeLabel(ch, currency)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Assets / DeFi / NFT chips — honest counts or explicit not-indexed */}
          <div className="wal-hero-chips walx-rise" style={{ '--walx-d': '90ms' }}>
            <button type="button" className="wal-hero-chip" onClick={() => children?.onAssets?.()} title={t('wallet.assets')}>
              <span className="walx-stat-ico t-assets" aria-hidden="true"><IconWalLayers width={17} height={17} /></span>
              <span className="walx-stat-text">
                <span className="wal-hero-chip-label">{t('wallet.assets')}</span>
                <strong>{portfolio.totalCount}</strong>
              </span>
            </button>
            <button type="button" className="wal-hero-chip" onClick={() => children?.onFarm?.()} title={t('nav.farm')}>
              <span className="walx-stat-ico t-defi" aria-hidden="true"><IconWalPool width={17} height={17} /></span>
              <span className="walx-stat-text">
                <span className="wal-hero-chip-label">{t('wallet.defi')}</span>
                <strong className="faint">—</strong>
                <small className="wal-hero-chip-note">{t('wallet.notIndexed')}</small>
              </span>
            </button>
            <button type="button" className="wal-hero-chip" onClick={() => children?.onNft?.()} title={t('nav.nft')}>
              <span className="walx-stat-ico t-nft" aria-hidden="true"><IconWalGem width={17} height={17} /></span>
              <span className="walx-stat-text">
                <span className="wal-hero-chip-label">{t('wallet.nft')}</span>
                {chips.nft.state === 'count'
                  ? <strong>{chips.nft.count}</strong>
                  : <strong className="faint">—</strong>}
                {chips.nft.state !== 'count' && <small className="wal-hero-chip-note">{t('wallet.notScanned')}</small>}
              </span>
            </button>
          </div>

          {/*
            HOW LONG THIS CONNECTION LASTS — the user's own setting, on screen.
            A number here is a promise the app can keep (the lease in
            lib/wc/lease.js), and «تا قطع دستی» is the honest label for the
            never-expires option. A refresh inside this window re-attaches
            silently; after it, the wallet is asked again — which is exactly
            what the setting says.
          */}
          {wallet.lease && (
            <p className="wal-lease" role="status">
              <IconShield width={13} height={13} aria-hidden="true" />
              <span>
                {wallet.leaseMinutesLeft == null
                  ? t('wallet.leaseUntilDisconnect')
                  : t('wallet.leaseMinutesLeft', { n: wallet.leaseMinutesLeft })}
              </span>
            </p>
          )}

          {/* One equal-sized action row + Optimize (proposal only) */}
          <WalletActionRow
            onSend={() => children?.onSend?.()}
            onReceive={() => children?.onReceive?.()}
            onBitcoin={() => children?.onBitcoin?.()}
            onSwap={() => children?.onSwap?.()}
            onBridge={() => children?.onBridge?.()}
            onBuy={() => children?.onBuy?.()}
            onEarn={() => children?.onEarn?.()}
            onOptimize={() => children?.onOptimize?.()}
            canOptimize={children?.canOptimize}
            showBitcoin={children?.showBitcoin}
          />

          {/* Utility / wallet management row */}
          <div className="wal-utils">
            {/* A spinning icon carries "working" without replacing the label:
                «…» where a word belongs reads as missing text, and it flickered
                every time the 30-second portfolio cycle started. */}
            <button className="wal-util" onClick={onRefresh} aria-busy={portfolio.loading ? 'true' : 'false'}>
              <IconWalRefresh
                className={portfolio.loading ? 'wal-spin' : undefined}
                aria-hidden="true"
              />
              <span>{t('common.refresh')}</span>
            </button>
            <button className="wal-util walx-util-ico" onClick={() => onExplorer(wallet.address)} title={t('swap.viewOnExplorer')} aria-label={t('swap.viewOnExplorer')}><IconWalExternal /></button>
            {wallet.mode === 'local' && !wallet.locked && (
              <button className="wal-util" onClick={wallet.lock}><IconWalLock aria-hidden="true" /><span>{t('wallet.lock')}</span></button>
            )}
            {wallet.locked ? (
              <button className="wal-util" onClick={onConnect}><IconWalKey aria-hidden="true" /><span>{t('wallet.unlock')}</span></button>
            ) : (
              <button className="wal-util wal-util-danger wal-danger" onClick={onDisconnect}><IconWalPower aria-hidden="true" /><span>{t('wallet.disconnect')}</span></button>
            )}
          </div>

          {wallet.mode === 'local' && !wallet.locked && (
            <div className="wal-utils" style={{ borderTop: 'none', paddingTop: 0, marginTop: -6 }}>
              <button className="wal-util" onClick={() => children?.setSeedSheet?.(true)}><IconWalKey aria-hidden="true" /><span>{t('wallet.revealSeed')}</span></button>
              <button className="wal-util" onClick={() => children?.setBackupSheet?.(true)}><IconWalArchive aria-hidden="true" /><span>{t('wallet.backupFile')}</span></button>
            </div>
          )}

          {/*
            THE NETWORK PICKER — one dropdown, every network.

            For two releases this was a wrapping row of sixteen chips: a 7px
            coloured dot and a three-letter abbreviation each (SCR, HOOD,
            LINEA…), four ragged lines deep on a phone, with «همه شبکه‌ها» as
            a button that did nothing at all. Readable to nobody who does not
            already know the short codes, and impossible to scan.

            `NetworkSelect` is the replacement: the selected network's real
            logo and its full name on one 52px control, and — «باید به صورت
            پاپ اپ شود وقتی روش میزنی» — a real POPUP behind it rather than an
            inline dropdown: dimmed backdrop, a card that rises from the bottom
            on a phone and centres itself on a wide screen, portalled to
            `document.body` so the hero's `overflow: hidden` and the page
            transition's `transform` can neither clip nor mis-place it. Inside
            it: a searchable listbox, «همه شبکه‌ها» pinned first, each row
            carrying its own artwork, the count of assets the portfolio
            actually found there, and a badge on the chain the wallet is
            connected to. The icons are vendored SVG
            (src/lib/assetIconData.js), so it looks the same on a phone that
            cannot reach a CDN, in dark and light.

            Behaviour kept from the chips: choosing a real network also asks
            the wallet to switch to it, and a refusal is still shown as a
            named error below.
          */}
          <NetworkSelect
            value={selectedChain}
            onChange={onSelectChain}
            activeChainId={wallet.chainId}
            chainMeta={chainMeta}
            allMeta={allMeta}
            label={t('wallet.network')}
            allLabel={t('wallet.allNetworks')}
            assetsLabel={t('wallet.assetsUnit')}
            activeLabel={t('wallet.active.title')}
            searchLabel={t('wallet.netSearch')}
            closeLabel={t('common.close')}
            testId="wallet-network-select"
          />
          {/*
            A view filter is not a network switch. «همه شبکه‌ها» and any chain
            the wallet is not on are legitimate ways to LOOK at the portfolio;
            the wallet itself stays where the user put it until they ask.
          */}
          {selectedChain !== 'all' && Number(selectedChain) !== Number(wallet.chainId) && (
            <button
              type="button"
              className="wal-net-switch"
              onClick={() => handleSwitch(Number(selectedChain))}
              disabled={switching}
            >
              {switching ? t('wallet.switching') : t('wallet.switchTo', { net: EVM_CHAINS[selectedChain]?.name ?? '' })}
            </button>
          )}
          {switchErr && (
            <div className="wal-note wal-note-err">
              {t(`wallet.switchErr.${switchErr}`)}
            </div>
          )}
        </div>
      ) : (
        <div className="wal-empty" style={{ position: 'relative' }}>
          {/*
            RECONNECTING vs NOT CONNECTED.

            These two states look identical from React state alone — no address
            either way — and drawing the "connect your wallet" call to action
            during the first one is how a working background resume gets read as
            «حسابم قطع شد»: the user taps Connect and approves a second wallet
            session while the first one was already attaching itself. The lease
            is what tells them apart (see lib/wc/lease.js), so while one is live
            the hero says what is actually happening — and offers the manual
            retry for the case where the wallet app is the thing that is slow.
          */}
          {wallet.restoring ? (
            <>
              <div className="wal-reconnect-ring" aria-hidden="true">
                <span className="wal-reconnect-dot" />
              </div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{t('wallet.reconnectingTitle')}</div>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.85, margin: '8px 0 0' }}>
                {t('wallet.reconnectingBody')}
              </p>
              <button
                className="btn btn-ghost"
                style={{ marginTop: 14, minHeight: 44, borderRadius: 14 }}
                onClick={onRetry}
              >
                {t('wallet.reconnectNow')}
              </button>
            </>
          ) : (
            <>
              <div className="walx-empty-orb walx-rise" aria-hidden="true">
                <WalletEmptyMark />
              </div>
              <div style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-0.01em' }}>{t('wallet.emptyTitle')}</div>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.85, margin: '8px 0 0', maxWidth: 340 }}>{t('wallet.emptyBody')}</p>
              <button className="btn btn-primary walx-connect" style={{ marginTop: 16 }} onClick={onConnect}>{t('wallet.connect')}</button>
              <p className="faint" style={{ fontSize: 11.5, marginTop: 11, lineHeight: 1.7 }}>{t('wallet.emptyReassure')}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ChainBreakdown({ portfolio, activeChainId, onSelect, selectedChain, t, currency, hideBalances = false }) {
  const chains = portfolio.chains || [];
  const selected = selectedChain === 'all' ? null : selectedChain;
  /* A chain's share of the hero total — the same figures, one division.
     Withheld while balances are hidden (proportions leak allocation even
     when amounts do not), and on errored chains that contributed nothing. */
  const shareOf = (c) => {
    if (hideBalances || c.error || !(portfolio.totalValue > 0) || !(c.totalValue > 0)) return null;
    return Math.min(100, Math.max(0, (c.totalValue / portfolio.totalValue) * 100));
  };
  return (
    <section className="wallet-pie-card wal-card" style={{ padding: 15 }}>
      <div className="walx-sec-head">
        <span className="walx-sec-title">
          <span className="walx-sec-ico" aria-hidden="true"><IconWalNodes width={16} height={16} /></span>
          <span className="wallet-section-title">{t('wallet.networks')}</span>
        </span>
        <span className="walx-sec-count">{chains.length} {t('wallet.networksUnit')}</span>
      </div>
      <div className="wal-chain-grid">
        <button
          type="button"
          className={`wal-chain-row ${selected === null ? 'is-active' : ''}`}
          onClick={() => onSelect('all')}
        >
          <span className="walx-chain-ico" aria-hidden="true"><IconGlobe width={18} height={18} /></span>
          <span className="walx-chain-main">
            <strong>{t('wallet.allNetworks')}</strong>
            <small>{portfolio.totalCount} {t('wallet.assetsUnit')}</small>
          </span>
          <span className="walx-chain-fig">
            <span className="walx-chain-val mono">{fmtCurrencyValue(portfolio.totalValue, currency)}</span>
          </span>
        </button>
        {chains.map((c) => {
          const isActive = activeChainId === c.chainId;
          const isSelected = selected === c.chainId;
          const pct = shareOf(c);
          return (
            <button
              type="button"
              key={c.chainId}
              className={`wal-chain-row ${isSelected ? 'is-active' : ''}`}
              onClick={() => onSelect(c.chainId)}
              style={{ '--chip-color': c.chainColor }}
            >
              {/* The network's own vendored SVG mark — the same artwork the
                  NetworkSelect popup uses, so a chain looks like itself in
                  both places instead of a coloured dot here and a logo there. */}
              <span className="walx-chain-ico" aria-hidden="true">
                <AssetIcon chain={c.chainId} size={26} radius={8} />
              </span>
              <span className="walx-chain-main">
                <strong>
                  <span dir="auto">{EVM_CHAINS[c.chainId]?.name || c.chainShort}</span>
                  {isActive && <span className="wal-badge-live">{t('wallet.active.title')}</span>}
                </strong>
                <small>
                  {c.error
                    ? t('wallet.chainUnavailable')
                    : `${c.rows.length} ${t('wallet.assetsUnit')} · ${fmtQty(c.nativeAmount)} ${c.native.symbol}`}
                </small>
                {pct != null && (
                  <span
                    className="walx-share"
                    style={{ '--walx-cc': c.chainColor || 'var(--rgb-1)', '--walx-pct': pct.toFixed(1) }}
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="walx-chain-fig">
                <span className="walx-chain-val mono" style={{ color: c.error ? 'var(--text-3)' : undefined }}>
                  {c.error ? '—' : (fmtCurrencyValue(c.totalValue, currency) ?? '—')}
                </span>
                {pct != null && <span className="walx-chain-pct mono">{pct < 0.1 ? '<0.1' : pct.toFixed(1)}%</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Asset list with CROSS-CHAIN UNIFICATION.
 *
 * On "All networks" the same symbol held on several chains merges into ONE
 * row (ETH on 3 networks → one row with the summed amount) with the chains
 * listed underneath. Tapping any row opens the TokenDetailSheet.
 */
function AssetList({ portfolio, selectedChain, onSelect, onOpenToken, t, currency }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    let list = portfolio.rows || [];
    if (selectedChain !== 'all') list = list.filter((r) => r.chainId === selectedChain);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((r) => r.symbol.toLowerCase().includes(needle) || r.name?.toLowerCase().includes(needle));
    }
    return list;
  }, [portfolio.rows, selectedChain, q]);

  const groups = useMemo(() => {
    if (selectedChain === 'all') return groupHoldings(rows);
    /* The per-chain branch used to build rows by hand with `name: r.name` and
       no fallback, so a token the lists have no name for rendered a blank
       sub-line — one of the three causes of the broken rows. It now produces
       exactly the same normalised shape groupHoldings does. */
    return rows.map((r) => ({
      symbol: r.symbol,
      displaySymbol: cleanAssetText(r.symbol, 14) || '?',
      name: cleanAssetText(r.name, 44) || cleanAssetText(r.symbol, 44) || '—',
      items: [r],
      chains: 1,
      totalAmount: r.amount,
      value: r.value,
      priced: r.value != null ? 1 : 0,
      total: 1
    }));
  }, [rows, selectedChain]);

  /* True when the CURRENT filter is empty but the wallet holds assets on
     other networks — the "my Bitcoin is missing" case, where the answer is
     one tap away, not a bug. */
  const hasElsewhere = useMemo(
    () => !portfolio.loading && rows.length === 0 && !q.trim()
      && selectedChain !== 'all'
      && (portfolio.rows || []).some((r) => r.chainId !== selectedChain),
    [portfolio.loading, portfolio.rows, rows.length, selectedChain, q]
  );

  return (
    <section className="wallet-pie-card wal-card" style={{ padding: 15 }}>
      <div className="walx-sec-head">
        <span className="walx-sec-title">
          <span className="walx-sec-ico t-assets" aria-hidden="true"><IconWalLayers width={16} height={16} /></span>
          <span className="wallet-section-title">{t('wallet.assets')}</span>
        </span>
        <span className="walx-sec-count">
          {groups.length} {t('wallet.assetsUnit')}
        </span>
      </div>
      {/* Search as one glass field, icon inside the field it belongs to —
          the old separate icon chip read as a button that did nothing. */}
      <div className="walx-search">
        <IconWalSearch aria-hidden="true" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('wallet.searchAssets')}
          aria-label={t('wallet.searchAssets')}
        />
      </div>
      {portfolio.loading && !rows.length ? (
        <div className="stack" style={{ gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 58, borderRadius: 14 }} />
          ))}
        </div>
      ) : !groups.length ? (
        <div className="wal-empty-asset">
          {selectedChain === 'all' ? t('wallet.noAssets') : t('wallet.noAssetsChain')}
          {hasElsewhere && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => onSelect?.('all')}
            >
              {t('wallet.showAllNetworks')}
            </button>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {groups.map((g) => {
            const partial = g.total > g.priced;
            return (
              <button
                key={g.symbol}
                type="button"
                className="wallet-token-row-modern wal-asset-row wal-asset-group"
                onClick={() => onOpenToken?.(g)}
              >
                <span className="walx-token-ico" aria-hidden="true">
                  <TokenIcon token={{ symbol: g.symbol, address: g.items[0]?.address, native: g.items[0]?.native }} chainId={g.items[0]?.chainId} size={37} />
                </span>
                {/*
                  ─── THE ROW IS PINNED TO EXACTLY TWO LINES ───────────────
                  `wal-asset-main` is the overflow context and `wal-asset-sym`
                  is the one element allowed to shrink; the chain chips and the
                  gas pill never shrink and are clipped instead. Without the
                  explicit min-width:0 chain a flex child refuses to go below
                  its content width, which is what let a scam token's
                  advert-as-a-symbol wrap onto three lines and shove the
                  balance out of the row. `dir="auto"` is per-element so a
                  Persian layout keeps the numbers on the correct side while a
                  Latin symbol still reads left-to-right.
                */}
                <span className="wal-asset-main">
                  <span className="wal-asset-line">
                    <strong className="wal-asset-sym" dir="auto" title={g.symbol}>{g.displaySymbol}</strong>
                    {g.items.map((r) => {
                      const c = EVM_CHAINS[r.chainId];
                      return (
                        <span key={r.chainId} className="wal-chip-net" style={{ background: c?.color ? `${c.color}22` : 'rgba(255,255,255,0.06)', color: c?.color || 'var(--text-2)' }}>
                          {c?.short}
                        </span>
                      );
                    })}
                    {g.items[0]?.native && <span className="pill pill-rgb" style={{ fontSize: 9, flexShrink: 0 }}>{t('wallet.gasCoin')}</span>}
                  </span>
                  <small className="faint wal-asset-name" dir="auto" title={g.name}>
                    {g.name}
                    {partial && <span className="wal-note" style={{ marginInlineStart: 6, fontSize: 9 }}>{t('wallet.partial')}</span>}
                  </small>
                </span>
                <span className="wal-asset-figures">
                  <div className="mono" style={{ fontWeight: 800, fontSize: 13 }}>
                    {fmtQty(g.totalAmount)}
                  </div>
                  <div className="faint mono" style={{ fontSize: 11 }}>
                    {g.value != null ? fmtCurrencyValue(g.value, currency) : '—'}
                  </div>
                </span>
                <IconChevronRight width={14} height={14} style={{ flexShrink: 0, opacity: 0.5 }} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function Wallet() {
  const hideBalances = useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const currencyCode = useSettingsStore((s) => s.currency);
  const toggleSetting = useSettingsStore((s) => s.toggle);
  const currency = currencyOf(currencyCode);

  /* The balance box's eye — the Settings `hideBalances` switch, reachable
     from the number itself. One store key, one formatter flag (the store
     subscription pushes it into lib/format), and this page re-renders via
     useHideBalances() above. */
  const handleToggleHide = useCallback(() => {
    haptic?.('select');
    toggleSetting('hideBalances');
  }, [haptic, toggleSetting]);

  const portfolio = useMultiChainPortfolio(wallet);

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [btcHubOpen, setBtcHubOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [selectedChain, setSelectedChain] = useState('all');
  const [tab, setTab] = useState(() => (searchParams.get('tab') === 'solana' ? 'solana' : 'real'));

  /* A ?tab=solana link can arrive while this route is already mounted; keep
     the strip in sync with the URL instead of only reading it once.

     ?tab=send is NOT a tab — it is the send action, reached from the Intent OS
     («بفرست به …»). It opens the real tab's send sheet and prefills the token
     when the connected chain has it. The recipient is never prefilled from a
     URL: a link-supplied address is a phishing vector, so it stays typed or
     scanned on the sheet. */
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'send') {
      setTab('real');
      const symbol = searchParams.get('token');
      if (symbol && wallet.chainId) {
        const chainTokens = TOKENS[wallet.chainId] ?? [];
        const match = chainTokens.find((tk) => String(tk.symbol || '').toUpperCase() === String(symbol).toUpperCase());
        if (match) {
          setSendToken({ symbol: match.symbol, name: match.name, address: match.address, native: match.native, decimals: match.decimals });
        }
      }
      setSendOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      next.delete('token');
      next.delete('toAddress');
      next.delete('amount');
      setSearchParams(next, { replace: true });
      return;
    }
    const next = tabParam === 'solana' ? 'solana' : 'real';
    setTab((cur) => (cur === next ? cur : next));
  }, [searchParams, wallet.chainId]);

  /*
   * ?return=/perp?tab=onchain&… — the "connect a wallet and come back" path.
   * Screens that need a Solana signature (the On-Chain futures tab is the
   * first) send the user here with ?tab=solana&return=<path> when no wallet is
   * connected; the moment a Solana wallet connects — or turns out to already
   * be connected — the page returns to that exact path, so the order the user
   * was building (market/side/collateral/leverage ride inside the return URL)
   * is still there. Security: only same-app paths are honoured (must start
   * with exactly one '/'), so a crafted link can never bounce the user to
   * another origin, and the parameter is consumed before navigating so a
   * refresh cannot re-trigger the redirect.
   */
  const solanaReturnRef = useRef('');
  useEffect(() => {
    const raw = searchParams.get('return');
    solanaReturnRef.current = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '';
  }, [searchParams]);
  useEffect(() => {
    const go = (addr) => {
      if (!addr || !solanaReturnRef.current) return;
      const back = solanaReturnRef.current;
      solanaReturnRef.current = '';
      const next = new URLSearchParams(searchParams);
      next.delete('return');
      setSearchParams(next, { replace: true });
      navigate(back);
    };
    /* already connected when landing here → return immediately */
    go(solanaAddress());
    const onSolanaChange = (event) => go(event?.detail?.address || solanaAddress() || null);
    window.addEventListener('solana:wallet-change', onSolanaChange);
    return () => window.removeEventListener('solana:wallet-change', onSolanaChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, navigate]);

  /*
   * ?action=disconnect — «والت را ببند» routes here. The wallet page owns
   * disconnect, so it performs the real disconnect once and consumes the
   * parameter (a refresh must not disconnect again).
   */
  const handledDisconnectRef = useRef('');
  useEffect(() => {
    if (searchParams.get('action') !== 'disconnect') {
      handledDisconnectRef.current = '';
      return;
    }
    const key = `${wallet.address || 'none'}:${wallet.chainId || ''}`;
    if (handledDisconnectRef.current === key) return;
    handledDisconnectRef.current = key;
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
    if (wallet.address && !wallet.locked) {
      haptic?.('warning');
      wallet.disconnect?.();
    }
  }, [searchParams, wallet, haptic]);
  const [seedSheet, setSeedSheet] = useState(false);
  const [seedPw, setSeedPw] = useState('');
  const [seedWords, setSeedWords] = useState(null);
  const [seedErr, setSeedErr] = useState(null);
  const [backupSheet, setBackupSheet] = useState(false);
  const [backupResult, setBackupResult] = useState(null);
  const [backupErr, setBackupErr] = useState(null);

  /* Command-center state */
  const [sendToken, setSendToken] = useState(null);
  const [tokenGroup, setTokenGroup] = useState(null);
  const [tokenSheet, setTokenSheet] = useState(false);
  const [intelSheet, setIntelSheet] = useState(false);
  const [pnlSheet, setPnlSheet] = useState(false);
  const [optimizeSheet, setOptimizeSheet] = useState(false);
  const [nftChip, setNftChip] = useState({ state: 'unknown' });

  const connected = Boolean(wallet.address) && !wallet.locked;

  useEffect(() => {
    if (wallet.chainId && wallet.isConnected) setSelectedChain(wallet.chainId);
  }, [wallet.chainId, wallet.isConnected]);

  const handleSelectChain = useCallback((id) => {
    haptic?.('select');
    setSelectedChain(id);
  }, [haptic]);

  const handleConnect = useCallback(() => setConnectOpen(true), []);
  const handleDisconnect = useCallback(() => {
    haptic?.('warning');
    wallet.disconnect?.();
  }, [wallet, haptic]);
  const handleCopy = useCallback((a) => copyText(a, haptic), [haptic]);
  const handleExplorer = useCallback((a) => openInExplorer(explorerAddr(wallet.chainId, a)), [wallet.chainId]);
  const handleRefresh = useCallback(() => {
    wallet.refreshBalance?.();
    portfolio.refresh?.();
  }, [wallet, portfolio]);

  /*
   * P&L / intelligence from the local lot ledger + live holdings. Always
   * built now — the "don't record a zero snapshot" guard moved INSIDE
   * buildIntelligence (which is what writes the snapshot), so an unpriced
   * wallet can no longer poison the 24h/7d/30d deltas by merely rendering.
   *
   * This object is also handed to the embedded Intelligence sheet below:
   * the sheet used to build its own from its own sixteen-chain re-read, and
   * while that read was in flight «تخصیص دارایی» told a CONNECTED wallet to
   * connect its wallet. One verified read, painted everywhere.
   */
  const intel = useMemo(() => buildIntelligence({
    holdings: portfolio.rows.map((r) => ({
      symbol: r.symbol, name: r.name, value: r.value, amount: r.amount, chainId: r.chainId, native: r.native
    }))
  }), [portfolio.rows]);

  /* Real NFT count for the hero chip — from /api/nft, or an honest "not scanned". */
  useEffect(() => {
    if (!connected) return undefined;
    let alive = true;
    setNftChip({ state: 'loading' });
    (async () => {
      try {
        const base = apiBase();
        const res = await fetch(`${base}/nft/chains`);
        const info = await res.json();
        if (!alive) return;
        if (!info?.configured || !Array.isArray(info?.chains) || !info.chains.includes(wallet.chainId)) {
          setNftChip({ state: 'notScanned' });
          return;
        }
        const r = await fetch(`${base}/nft/${wallet.chainId}/${wallet.address}`);
        if (!alive) return;
        const data = await r.json();
        const count = Array.isArray(data?.nfts) ? data.nfts.length : Number(data?.total) || 0;
        setNftChip(count > 0 ? { state: 'count', count } : { state: 'count', count: 0 });
      } catch {
        if (alive) setNftChip({ state: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [connected, wallet.address, wallet.chainId]);

  const canOptimize = connected && portfolio.rows.length > 0 && portfolio.totalValue > 0;

  /*
   * Bitcoin is derived from the INTERNAL local vault seed (BIP-84) only. A
   * wallet connected through WalletConnect / an injected provider (Trust
   * Wallet, MetaMask, …) has no BTC leg: show nothing for it — no action
   * row button, no card, no popup. `bitcoinAvailable` is what the BTC token
   * detail / card / sheet all read instead of re-deriving the mode each time.
   */
  const bitcoinAvailable = wallet.mode === 'local';

  const handleOptimize = useCallback(() => {
    haptic?.('select');
    if (!connected) { setConnectOpen(true); return; }
    if (!canOptimize) { setOptimizeSheet(true); return; }
    const priced = [...portfolio.rows].filter((r) => r.value != null).sort((a, b) => b.value - a.value);
    const top = priced[0];
    if (!top) { setOptimizeSheet(true); return; }
    const native = portfolio.rows.find((r) => r.chainId === wallet.chainId && r.native);
    let from = top.symbol;
    let to = from === 'USDC' ? 'ETH' : 'USDC';
    if (native && from === native.symbol) to = 'USDC';
    navigate(`/intent?tab=compose&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&chain=${wallet.chainId}`);
  }, [haptic, connected, canOptimize, portfolio.rows, wallet.chainId, navigate]);

  const handleOpenToken = useCallback((group) => {
    haptic?.('select');
    setTokenGroup(group);
    setTokenSheet(true);
  }, [haptic]);

  const handleTokenSend = useCallback(async (row) => {
    if (!row) return;
    if (row.chainId && row.chainId !== wallet.chainId) {
      haptic?.('select');
      const ok = await wallet.switchChain(row.chainId);
      if (!ok) return;
    }
    setSendToken({
      symbol: row.symbol,
      name: row.name,
      address: row.address,
      native: row.native,
      decimals: row.decimals
    });
    setSendOpen(true);
  }, [wallet, haptic]);

  /* Top non-native holding on the active chain — the only honest "Get Gas"
     route: swap that token for native when gas is too low. */
  const gasSwapTarget = useMemo(() => {
    if (!wallet.chainId) return null;
    const onChain = (portfolio.rows || [])
      .filter((r) => r.chainId === wallet.chainId && !r.native && r.value != null)
      .sort((a, b) => b.value - a.value);
    return onChain[0]?.symbol ?? null;
  }, [portfolio.rows, wallet.chainId]);

  const heroApi = {
    onSend: () => setSendOpen(true),
    onReceive: () => setReceiveOpen(true),
    onBitcoin: () => setBtcHubOpen(true),
    onBuy: () => navigate('/buy'),
    onSwap: () => navigate('/swap'),
    onBridge: () => navigate('/bridge'),
    onEarn: () => navigate('/earn'),
    onOptimize: handleOptimize,
    canOptimize,
    showBitcoin: bitcoinAvailable,
    onAssets: () => setSelectedChain('all'),
    onFarm: () => navigate('/farm'),
    onNft: () => navigate('/nft'),
    setSeedSheet,
    setBackupSheet
  };

  return (
    <PageTransition>
      {/* Tab strip — two tabs: the on-chain EVM wallet and the Solana wallet.
          The old experimental/practice tab was removed on instruction; the
          Solana wallet connection moved here from the swap screen. */}
      <div className="segmented wal-tab-strip wal-wallet-accordion" style={{ padding: 5, borderRadius: 18, gap: 4 }}>
        {['real', 'solana'].map((k) => (
          <button
            key={k}
            className={tab === k ? 'active' : ''}
            onClick={() => {
              setTab(k);
              setSearchParams(k === 'real' ? {} : { tab: k }, { replace: true });
            }}
            style={{ isolation: 'isolate', minHeight: 38, borderRadius: 13, fontWeight: 800, fontSize: 13 }}
          >
            {tab === k && <SegIndicator id="wtab" />}
            {t(`wallet.tab.${k}`)}
            <span className="wal-acc-caret" aria-hidden="true">{tab === k ? '▾' : '▸'}</span>
          </button>
        ))}
      </div>

      {/* ----------------- on-chain wallet (non-custodial) -----------------
          `.walx` scopes the Glass-3.0 stylesheet to THIS tab: the Solana
          tab and every portalled sheet keep their existing surfaces. */}
      {tab === 'real' && (
        <div className="walx">
          <WalHero
            wallet={wallet}
            currency={currency}
            portfolio={portfolio}
            intel={intel}
            chips={{ nft: nftChip }}
            hideBalances={hideBalances}
            onToggleHide={handleToggleHide}
            t={t}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onRefresh={handleRefresh}
            onCopy={handleCopy}
            onExplorer={handleExplorer}
            switchChain={wallet.switchChain}
            haptic={haptic}
            selectedChain={selectedChain}
            onSelectChain={handleSelectChain}
            /* The manual retry the «reconnecting» hero offers — the same
               plan-driven attempt the cold start runs, exposed for the one
               case a ladder cannot cover: a wallet app the user just opened. */
            onRetry={() => wallet.reconnectWallet?.()}
          >
            {heroApi}
          </WalHero>

          {wallet.address && !wallet.locked && (
            <>
              {/* Intelligence | P&L | Risk — the command-center trio */}
              <div className="walx-rise" style={{ marginTop: 14, '--walx-d': '140ms' }}>
                <WalletIntelTiles intel={intel} onIntel={() => setIntelSheet(true)} onPnl={() => setPnlSheet(true)} />
              </div>

              <div className="walx-rise" style={{ marginTop: 14, '--walx-d': '190ms' }}>
                <ChainBreakdown
                  portfolio={portfolio}
                  activeChainId={wallet.chainId}
                  onSelect={handleSelectChain}
                  selectedChain={selectedChain}
                  t={t}
                  currency={currency}
                  hideBalances={hideBalances}
                />
              </div>

              <div className="walx-rise" style={{ marginTop: 14, '--walx-d': '240ms' }}>
                <AssetList
                  portfolio={portfolio}
                  selectedChain={selectedChain}
                  onSelect={handleSelectChain}
                  onOpenToken={handleOpenToken}
                  t={t}
                  currency={currency}
                />
              </div>

              {/* ACTIVE: live orders + recent intents */}
              <div className="walx-rise" style={{ marginTop: 14, '--walx-d': '290ms' }}>
                <ActiveOrdersCard />
              </div>

              {/* Real-wallet holdings beyond the current chain: pools + NFTs,
                  as two accent doors over one trade CTA (same destinations,
                  same copy — modern placement, honest size). */}
              <section className="wallet-pie-card walx-rise" style={{ marginTop: 14, padding: 15, '--walx-d': '340ms' }}>
                <div className="walx-sec-head" style={{ marginBottom: 8 }}>
                  <span className="walx-sec-title">
                    <span className="walx-sec-ico t-assets" aria-hidden="true"><IconWalPool width={16} height={16} /></span>
                    <span className="wallet-section-title">{t('wallet.holdingsMore')}</span>
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85, margin: '0 0 13px' }}>{t('wallet.liquidityBody')}</p>
                <div className="walx-more-grid">
                  <button type="button" className="walx-more-card" onClick={() => navigate('/farm')}>
                    <span className="walx-stat-ico t-defi" aria-hidden="true"><IconWalPool width={17} height={17} /></span>
                    <span className="walx-more-label">{t('wallet.viewPools')}</span>
                    <IconChevronRight className="walx-chev" width={15} height={15} />
                  </button>
                  <button type="button" className="walx-more-card t-nft" onClick={() => navigate('/nft')}>
                    <span className="walx-stat-ico t-nft" aria-hidden="true"><IconWalGem width={17} height={17} /></span>
                    <span className="walx-more-label">{t('nav.nft')}</span>
                    <IconChevronRight className="walx-chev" width={15} height={15} />
                  </button>
                </div>
                <button type="button" className="walx-trade-cta" onClick={() => navigate('/trade')}>
                  <IconWalTrend width={16} height={16} aria-hidden="true" />
                  <span>{t('wallet.startTrading')}</span>
                </button>
              </section>
            </>
          )}
        </div>
      )}

      {/* ----------------- internal bitcoin (same seed, BIP-84) -----------------
          Only the local vault can grow a BTC leg (zero law), and the card
          itself renders nothing for injected/locked wallets — so this line is
          a no-op for everyone who has no internal BTC wallet. It lives in the
          Wallet chunk only; no other route pulls it in. */}
      <div id="wallet-btc-card">{bitcoinAvailable && tab === 'real' && <BtcCard />}</div>

      {/* ----------------- Solana wallet -----------------
          Connection through Phantom / Solflare / Backpack belongs on the
          wallet page; the swap page keeps only quoting and execution. */}
      {tab === 'solana' && (
        <div style={{ marginTop: 12 }}>
          <SolanaWalletTab />
        </div>
      )}

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <SendSheet open={sendOpen} onClose={() => setSendOpen(false)} token={sendToken} swapForGasTarget={gasSwapTarget} />
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} />

      {/*
        ─── THE BITCOIN POPUP (action row, between Receive and Swap) ─────────
        `vaultState` is computed HERE because this page already holds the
        wallet context; the sheet itself stays free of any bitcoin-wallet
        import, which is what keeps its chunk small and the import-graph rule
        in the wiring suite satisfied.

        The sheet mounts on this page only, so the watch-only code and the
        /api/btc reads it performs are part of the Wallet chunk and cannot
        reach Home, Market or the swap path.
      */}
      {bitcoinAvailable && (
      <BtcHubSheet
        open={btcHubOpen}
        onClose={() => setBtcHubOpen(false)}
        vaultState={wallet.mode === 'local' ? (wallet.locked ? 'locked' : 'unlocked') : 'none'}
        onOpenCard={() => {
          /* The card is already on this page; scroll rather than duplicate it.
             `smooth` is skipped when the OS asks for reduced motion — the
             media query is read directly because this is a one-shot imperative
             call, not a render-time decision. */
          const behavior = typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
            ? 'auto' : 'smooth';
          document.getElementById('wallet-btc-card')?.scrollIntoView({ behavior, block: 'center' });
        }}
      />
      )}

      {/* Token detail (from the unified asset list) */}
      <TokenDetailSheet
        open={tokenSheet}
        onClose={() => setTokenSheet(false)}
        group={tokenGroup}
        intel={intel}
        wallet={wallet}
        currency={currency}
        onSend={handleTokenSend}
      />

      {/* Intelligence — the existing embedded Portfolio dashboard, fed by this
          page's own verified read (see the `intel` memo): opening the sheet
          paints instantly and can never claim the wallet is not connected
          while it demonstrably is. */}
      <Sheet open={intelSheet} onClose={() => setIntelSheet(false)} title={t('intel.title')} anchor="bottom" size="lg">
        <Portfolio embedded portfolio={portfolio} intel={intel} />
      </Sheet>

      {/* P&L detail */}
      <Sheet open={pnlSheet} onClose={() => setPnlSheet(false)} title={t('wallet.pnl.title')} anchor="bottom" size="lg">
        <WalletPnl intel={intel} />
      </Sheet>

      {/* Optimize explainer — why no draft was prefilled */}
      <Sheet open={optimizeSheet} onClose={() => setOptimizeSheet(false)} title={t('wallet.optimize')} anchor="bottom">
        <div className="stack" style={{ gap: 12 }}>
          <p className="notice">{t('wallet.optimizeExplain')}</p>
          <button className="btn btn-primary" style={{ minHeight: 46, borderRadius: 14 }} onClick={() => { setOptimizeSheet(false); navigate('/intent?tab=compose'); }}>
            {t('wallet.optimizeOpenManual')}
          </button>
        </div>
      </Sheet>

      {/* Seed reveal sheet */}
      <Sheet
        title={t('wallet.revealSeed')}
        open={seedSheet}
        onClose={() => { setSeedSheet(false); setSeedWords(null); setSeedPw(''); setSeedErr(null); }}
      >
        <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('wallet.backupWarning')}</p>
        {!seedWords ? (
          <>
            <label className="field-label">{t('wallet.password')}</label>
            <input type="password" value={seedPw} onChange={(e) => setSeedPw(e.target.value)} />
            {seedErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.err.BAD_PASSWORD')}</p>}
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={!seedPw}
              onClick={async () => {
                try { setSeedWords(await revealMnemonic(seedPw)); setSeedErr(null); }
                catch { setSeedErr(true); }
              }}
            >{t('wallet.revealSeed')}</button>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7 }}>
            {seedWords.split(' ').map((w, i) => (
              <div key={i} className="mono" style={{ fontSize: 11.5, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,.4)', border: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--text-3)', marginInlineEnd: 5 }}>{i + 1}</span>{w}
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {/* Backup sheet — completes the backupWallet quest on successful export */}
      <Sheet open={backupSheet} onClose={() => setBackupSheet(false)} title={t('wallet.backupFile')}>
        <p className="notice notice-danger">{t('wallet.backupWarn')}</p>
        <div className="card card-tight" style={{ marginTop: 11 }}>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t('wallet.backupWhat')}</p>
        </div>
        {backupResult && (
          <div className="card card-tight" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 11, borderColor: 'var(--up)' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5 }} className="up">✓ {t('wallet.backupSaved')}</div>
            <div className="faint">{t('wallet.backupLocation')}</div>
            <div className="mono" style={{ fontSize: 11.5, marginTop: 3, wordBreak: 'break-all' }}>{backupResult.hint} / {BACKUP_FILENAME}</div>
          </div>
        )}
        {backupErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`wallet.backupErr.${backupErr}`)}</p>}
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            setBackupErr(null);
            try {
              const res = await exportWallet();
              setBackupResult(res);
              useAppStore.getState().completeQuest('backupWallet');
              haptic?.('success');
            } catch (e) {
              setBackupErr(e.message === 'NO_VAULT' ? 'NO_VAULT' : 'FAILED');
              haptic?.('error');
            }
          }}
        >{t('wallet.backupSave')}</button>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 9 }}
          onClick={async () => {
            try {
              const res = await shareWalletBackup();
              if (res?.ok) {
                useAppStore.getState().notify(res.downloaded ? 'فایل دانلود شد — پوشه Downloads را ببین' : res.webShared ? 'اشتراکگذاری انجام شد' : 'آماده شد', 'success');
                haptic?.('success');
              } else { setBackupErr('FAILED'); haptic?.('error'); }
            } catch { setBackupErr('FAILED'); haptic?.('error'); }
          }}
        >{t('wallet.backupShare')}</button>
        <p className="notice" style={{ marginTop: 12 }}>{t('wallet.backupPaperNote')}</p>
      </Sheet>
    </PageTransition>
  );
}

/* Named for the command-center probe (test/wallet-command-center-probe.jsx),
   which mounts the connected hero with fabricated props — the page probe
   can only ever see the disconnected state, and the hero is where this
   screen's hardest-won behaviours live (number discipline, masking,
   spectrum honesty). The default export above is the routed page. */
export { WalHero, ChainBreakdown, AssetList };
