import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import SolanaWalletTab from '../components/SolanaWalletTab';
import InfoBox from '../components/InfoBox';
import HardwareWalletCard from '../components/HardwareWalletCard';
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
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from '../lib/chains';
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
import { IconCopy, IconGlobe, IconChevronRight } from '../components/Icons';
import { WalletMesh } from '../components/WalletArt';
import '../styles/wallet-modern.css';
import '../styles/wallet.css';

function fmtCurrencyValue(v, currency, opts = {}) {
  if (v == null || !Number.isFinite(v)) return null;
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

const IconRefresh = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>
  </svg>
);
const IconDisconnect = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>
  </svg>
);

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
  onConnect, onDisconnect, onRefresh, onCopy, onExplorer, switchChain, haptic, children
}) {
  const connected = Boolean(wallet.address) && !wallet.locked;
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState(null);

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
    <section className={`wallet-hero-modern wal-hero`}>
      <div className="wallet-hero-aurora wal-hero-aurora" aria-hidden="true" />
      <WalletMesh className="wal-mesh" />

      {connected ? (
        <div className="stack" style={{ gap: 13, position: 'relative' }}>
          <div className="row-between">
            <span className="wallet-chip-modern">
              <span className={`wal-chip-dot ${wallet.locked ? '' : 'is-live'}`} />
              <span className="mono" style={{ fontWeight: 700 }}>
                <button
                  className={`wal-addr-plain ${hideBalances ? 'wal-addr-blur' : ''}`}
                  onClick={() => onCopy(wallet.address)}
                  title={t('wallet.copyAddress')}
                  aria-label={t('wallet.copyAddress')}
                  style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {shortAddress(wallet.address, 6)}
                  <IconCopy width={12} height={12} />
                </button>
              </span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className="pill pill-rgb" style={{ fontSize: 10.5, padding: '4px 8px' }}>{wallet.chain?.short ?? 'BSC'}</span>
              <span className={`pill ${wallet.locked ? 'pill-down' : 'pill-up'}`} style={{ fontSize: 10.5 }}>{wallet.locked ? '🔒' : providerLabel(wallet, t)}</span>
            </span>
          </div>

          <div className="wal-hero-value">
            <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.7 }}>{t('wallet.portfolioTotal')} · {currency.code}</div>
            <div className="wal-hero-total">
              {portfolio.loading && portfolio.totalValue === 0 ? (
                <span style={{ opacity: 0.5 }}>…</span>
              ) : (
                <AnimatedNumber value={portfolio.totalValue} format={(v) => fmtCurrencyValue(v, currency) || '—'} />
              )}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 6, fontSize: 11 }}>
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
            </div>

            {/* 24H / 7D / 30D — real snapshot deltas only; else — */}
            <div className="wal-chg-row" role="group" aria-label={t('wallet.changes')}>
              {[['24H', intel?.change24h], ['7D', intel?.change7d], ['30D', intel?.change30d]].map(([label, ch]) => (
                <span key={label} className={`pill ${ch && ch.abs >= 0 ? 'pill-up' : ch ? 'pill-down' : ''}`} style={{ fontSize: 10.5, padding: '5px 9px' }}>
                  {label} {changeLabel(ch, currency)}
                </span>
              ))}
            </div>

            {/* Assets / DeFi / NFT chips — honest counts or explicit not-indexed */}
            <div className="wal-hero-chips">
              <button type="button" className="wal-hero-chip" onClick={() => children?.onAssets?.()} title={t('wallet.assets')}>
                <span className="wal-hero-chip-label">{t('wallet.assets')}</span>
                <strong>{portfolio.totalCount}</strong>
              </button>
              <button type="button" className="wal-hero-chip" onClick={() => children?.onFarm?.()} title={t('nav.farm')}>
                <span className="wal-hero-chip-label">{t('wallet.defi')}</span>
                <strong className="faint">—</strong>
                <small className="wal-hero-chip-note">{t('wallet.notIndexed')}</small>
              </button>
              <button type="button" className="wal-hero-chip" onClick={() => children?.onNft?.()} title={t('nav.nft')}>
                <span className="wal-hero-chip-label">{t('wallet.nft')}</span>
                {chips.nft.state === 'count'
                  ? <strong>{chips.nft.count}</strong>
                  : <strong className="faint">—</strong>}
                {chips.nft.state !== 'count' && <small className="wal-hero-chip-note">{t('wallet.notScanned')}</small>}
              </button>
            </div>
          </div>

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
            <button className="wal-util" onClick={onRefresh}>{portfolio.loading ? '…' : t('common.refresh')}</button>
            <button className="wal-util" onClick={() => onExplorer(wallet.address)} title={t('swap.viewOnExplorer')} aria-label={t('swap.viewOnExplorer')}><IconGlobe width={15} height={15} /></button>
            {wallet.mode === 'local' && !wallet.locked && (
              <button className="wal-util" onClick={wallet.lock}>{t('wallet.lock')}</button>
            )}
            {wallet.locked ? (
              <button className="wal-util" onClick={onConnect}>{t('wallet.unlock')}</button>
            ) : (
              <button className="wal-util wal-util-danger wal-danger" onClick={onDisconnect}>{t('wallet.disconnect')}</button>
            )}
          </div>

          {wallet.mode === 'local' && !wallet.locked && (
            <div className="wal-utils">
              <button className="wal-util" onClick={() => children?.setSeedSheet?.(true)}>{t('wallet.revealSeed')}</button>
              <button className="wal-util" onClick={() => children?.setBackupSheet?.(true)}>{t('wallet.backupFile')}</button>
            </div>
          )}

          {/* Network quick-switch */}
          <div className="wal-net-picker" role="tablist" aria-label={t('wallet.network')}>
            <button className="wal-net-chip" title={t('wallet.allNetworks')}>
              <IconGlobe width={12} height={12} />
              <span>{t('wallet.allNetworks')}</span>
            </button>
            {EVM_CHAIN_ORDER.slice(0, 6).map((cid) => {
              const cfg = EVM_CHAINS[cid];
              const isActive = wallet.chainId === cid;
              return (
                <button
                  key={cid}
                  className={`wal-net-chip ${isActive ? 'active' : ''}`}
                  onClick={() => handleSwitch(cid)}
                  style={{ '--chip-color': cfg.color }}
                  title={cfg.name}
                >
                  <span className="wal-net-dot" style={{ background: cfg.color }} />
                  <span>{cfg.short}</span>
                </button>
              );
            })}
          </div>
          {switchErr && (
            <div className="wal-note wal-note-err">
              {t(`wallet.switchErr.${switchErr}`)}
            </div>
          )}
        </div>
      ) : (
        <div className="wal-empty" style={{ position: 'relative', textAlign: 'center', padding: '6px 0 2px' }}>
          <div style={{ width: 68, height: 68, borderRadius: 19, margin: '0 auto 13px', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff', fontSize: 26, boxShadow: '0 12px 32px rgba(0,229,255,0.24)' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
            </svg>
          </div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{t('wallet.emptyTitle')}</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.85, margin: '8px 0 0' }}>{t('wallet.emptyBody')}</p>
          <button className="btn btn-primary" style={{ marginTop: 15, minHeight: 44, borderRadius: 14, padding: '0 24px' }} onClick={onConnect}>{t('wallet.connect')}</button>
          <p className="faint" style={{ fontSize: 11.5, marginTop: 11, lineHeight: 1.7 }}>{t('wallet.emptyReassure')}</p>
        </div>
      )}
    </section>
  );
}

function ChainBreakdown({ portfolio, activeChainId, onSelect, selectedChain, t, currency }) {
  const chains = portfolio.chains || [];
  const selected = selectedChain === 'all' ? null : selectedChain;
  return (
    <section className="wallet-pie-card wal-card" style={{ padding: 14, borderRadius: 18 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="wallet-section-title">{t('wallet.networks')}</span>
        <span className="faint" style={{ fontSize: 11 }}>{chains.length} {t('wallet.networksUnit')}</span>
      </div>
      <div className="wal-chain-grid">
        <button
          className={`wal-chain-row ${selected === null ? 'is-active' : ''}`}
          onClick={() => onSelect('all')}
        >
          <span className="wal-chain-dot-wrap"><IconGlobe width={14} height={14} /></span>
          <span style={{ flex: 1 }}>
            <strong>{t('wallet.allNetworks')}</strong>
            <small>{portfolio.totalCount} {t('wallet.assetsUnit')}</small>
          </span>
          <span className="mono" style={{ fontWeight: 800 }}>
            {fmtCurrencyValue(portfolio.totalValue, currency)}
          </span>
        </button>
        {chains.map((c) => {
          const isActive = activeChainId === c.chainId;
          const isSelected = selected === c.chainId;
          return (
            <button
              key={c.chainId}
              className={`wal-chain-row ${isSelected ? 'is-active' : ''}`}
              onClick={() => onSelect(c.chainId)}
              style={{ '--chip-color': c.chainColor }}
            >
              <span className="wal-chain-dot-wrap">
                <span className="wal-chain-dot" style={{ background: c.chainColor }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>
                  {c.chainShort}
                  {isActive && <span className="wal-badge-live">{t('wallet.active.title')}</span>}
                </strong>
                <small>
                  {c.error
                    ? t('wallet.chainUnavailable')
                    : `${c.rows.length} ${t('wallet.assetsUnit')} · ${fmtQty(c.nativeAmount)} ${c.native.symbol}`}
                </small>
              </span>
              <span className="mono" style={{ fontWeight: 800, color: c.error ? 'var(--text-3)' : undefined }}>
                {c.error ? '—' : (fmtCurrencyValue(c.totalValue, currency) ?? '—')}
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
    <section className="wallet-pie-card wal-card" style={{ padding: 14, borderRadius: 18 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="wallet-section-title">{t('wallet.assets')}</span>
        <span className="faint" style={{ fontSize: 11 }}>
          {groups.length} {t('wallet.assetsUnit')}
        </span>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <span className="icon-btn" style={{ pointerEvents: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('wallet.searchAssets')}
          style={{ flex: 1 }}
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
            const chain = EVM_CHAINS[g.items[0]?.chainId];
            const partial = g.total > g.priced;
            return (
              <button
                key={g.symbol}
                type="button"
                className="wallet-token-row-modern wal-asset-row wal-asset-group"
                onClick={() => onOpenToken?.(g)}
              >
                <TokenIcon token={{ symbol: g.symbol, address: g.items[0]?.address, native: g.items[0]?.native }} chainId={g.items[0]?.chainId} size={34} />
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
  const currency = currencyOf(currencyCode);

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
   * P&L / intelligence from the local lot ledger + live holdings. Only built
   * when there is a real priced total: an unpriced-only wallet would record
   * a zero snapshot and poison the 24h/7d/30d deltas.
   */
  const intel = useMemo(() => {
    if (!portfolio.totalValue || portfolio.totalValue <= 0) return null;
    return buildIntelligence({
      holdings: portfolio.rows.map((r) => ({
        symbol: r.symbol, name: r.name, value: r.value, amount: r.amount, chainId: r.chainId, native: r.native
      }))
    });
  }, [portfolio.rows, portfolio.totalValue]);

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
      <div className="segmented wal-tab-strip" style={{ padding: 5, borderRadius: 18, gap: 4 }}>
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
          </button>
        ))}
      </div>

      {/* ----------------- on-chain wallet (non-custodial) ----------------- */}
      {tab === 'real' && (
        <>
          <WalHero
            wallet={wallet}
            currency={currency}
            portfolio={portfolio}
            intel={intel}
            chips={{ nft: nftChip }}
            hideBalances={hideBalances}
            t={t}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onRefresh={handleRefresh}
            onCopy={handleCopy}
            onExplorer={handleExplorer}
            switchChain={wallet.switchChain}
            haptic={haptic}
          >
            {heroApi}
          </WalHero>

          {wallet.address && !wallet.locked && (
            <>
              {/* Intelligence | P&L | Risk — the command-center trio */}
              <div style={{ marginTop: 14 }}>
                <WalletIntelTiles intel={intel} onIntel={() => setIntelSheet(true)} onPnl={() => setPnlSheet(true)} />
              </div>

              <div style={{ marginTop: 14 }}>
                <ChainBreakdown
                  portfolio={portfolio}
                  activeChainId={wallet.chainId}
                  onSelect={handleSelectChain}
                  selectedChain={selectedChain}
                  t={t}
                  currency={currency}
                />
              </div>

              <div style={{ marginTop: 14 }}>
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
              <div style={{ marginTop: 14 }}>
                <ActiveOrdersCard />
              </div>

              {/* Real-wallet holdings beyond the current chain: pools + NFTs */}
              <section className="wallet-pie-card" style={{ marginTop: 14, padding: 14, borderRadius: 18 }}>
                <div className="row-between" style={{ marginBottom: 12 }}>
                  <span style={{ fontWeight: 800, fontSize: 13.5 }}>{t('wallet.holdingsMore')}</span>
                </div>
                <p className="muted" style={{ fontSize: 12.7, lineHeight: 1.85, margin: '0 0 14px' }}>{t('wallet.liquidityBody')}</p>
                <div className="row" style={{ gap: 10 }}>
                  <button className="btn btn-ghost" style={{ flex: 1, minHeight: 42, borderRadius: 12 }} onClick={() => navigate('/farm')}>{t('wallet.viewPools')}</button>
                  <button className="btn btn-ghost" style={{ flex: 1, minHeight: 42, borderRadius: 12 }} onClick={() => navigate('/nft')}>{t('nav.nft')}</button>
                </div>
                <div className="row" style={{ gap: 10, marginTop: 8 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, minHeight: 36, borderRadius: 10 }} onClick={() => navigate('/trade')}>{t('wallet.startTrading')}</button>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {tab === 'real' && <HardwareWalletCard />}

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

      <div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
        <InfoBox title={t('wallet.custodyTitle')} tone="info" id="wallet-custody">
          <p style={{ fontSize: 12.5, lineHeight: 1.85 }}>{t('wallet.custodyNotice')}</p>
        </InfoBox>
      </div>

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

      {/* Intelligence — the existing embedded Portfolio dashboard */}
      <Sheet open={intelSheet} onClose={() => setIntelSheet(false)} title={t('intel.title')} anchor="bottom" size="lg">
        <Portfolio embedded />
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
