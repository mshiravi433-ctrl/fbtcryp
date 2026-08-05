import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Sheet from '../components/Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS } from '../lib/chains';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal, IconShield } from '../components/Icons';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * NFT VIEWER — shows what this wallet already holds.
 *
 * ─── WHY A VIEWER AND NOT A MARKETPLACE ────────────────────────────────────
 * A marketplace needs verified-collection data, clone detection and a dispute
 * process. Without those we would be a storefront for fraud with our name on
 * it. A viewer sells nothing, so none of that risk exists — and it still gives
 * a reason to connect a wallet.
 *
 * ─── EVERY STRING ON THIS SCREEN IS HOSTILE UNTIL PROVEN OTHERWISE ─────────
 * Anyone can mint an NFT into anyone's wallet with arbitrary metadata, and
 * airdropped scam NFTs use the name field as the payload: "Claim $5,000 at
 * …". The server strips markup, bidi overrides and control characters; this
 * screen renders everything as plain text and never as HTML.
 *
 * Two rules follow from that and are worth stating:
 *
 *   1. NOTHING here is clickable through to an arbitrary URL. A scam NFT's
 *      whole purpose is to get you onto its site. The only outbound link is
 *      to the chain's own explorer, built from the contract address — a value
 *      we validated, not one the token supplied.
 *
 *   2. Unverified items are labelled as such, and the empty state explains
 *      that receiving an unexpected NFT is normal and not a sign of a
 *      compromised wallet. People panic about that.
 */
export default function Nft() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { haptic } = useTelegram();

  const [chains, setChains] = useState(null); // null = still asking
  const [chainId, setChainId] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);

  // Which chains the backend can actually index. Asked once, because
  // guessing and then failing is worse than knowing up front.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/nft/chains`);
        const data = await res.json();
        if (!alive) return;
        const list = Array.isArray(data?.chains) ? data.chains : [];
        setChains({ list, configured: Boolean(data?.configured) });
        // Prefer the chain the wallet is already on.
        setChainId(list.includes(wallet.chainId) ? wallet.chainId : list[0] ?? null);
      } catch {
        if (alive) setChains({ list: [], configured: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [wallet.chainId]);

  const load = useCallback(async () => {
    if (!wallet.address || !chainId) return;
    setState('loading');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/nft/${chainId}/${wallet.address}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP_${res.status}`);
      }
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setState('done');
    } catch (e) {
      setError(String(e.message || 'FAILED'));
      setState('error');
    }
  }, [wallet.address, chainId]);

  useEffect(() => {
    if (wallet.address && chainId) load();
  }, [wallet.address, chainId, load]);

  const supported = useMemo(
    () => (chains?.list ?? []).map((id) => EVM_CHAINS[id]).filter(Boolean),
    [chains]
  );

  const openContract = (item) => {
    const chain = EVM_CHAINS[chainId];
    if (!chain || !/^0x[a-fA-F0-9]{40}$/.test(item.contract)) return;
    // Built from a validated address, never from token-supplied data.
    openUrl(`${chain.explorer}/token/${item.contract}`);
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('nft.title')}</h1>
      </motion.div>

      <p className="muted">{t('nft.subtitle')}</p>

      {/* ---------- not connected ---------- */}
      {!wallet.address && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="muted" style={{ fontSize: 12.5 }}>{t('nft.connectFirst')}</p>
          <button className="btn btn-primary" style={{ marginTop: 11 }} onClick={() => navigate('/wallet')}>
            {t('wallet.connect')}
          </button>
        </motion.section>
      )}

      {/* ---------- backend has no indexer key ---------- */}
      {wallet.address && chains && !chains.configured && (
        <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
          {t('nft.notConfigured')}
        </motion.p>
      )}

      {/* ---------- chain picker ---------- */}
      {wallet.address && chains?.configured && supported.length > 0 && (
        <div className="tag-scroll">
          {supported.map((c) => (
            <button
              key={c.id}
              className={`tag ${chainId === c.id ? 'active' : ''}`}
              onClick={() => {
                haptic?.('select');
                setChainId(c.id);
              }}
            >
              {c.short ?? c.name}
            </button>
          ))}
        </div>
      )}

      {/* BNB Chain is the app's default but has no NFT index, so say so rather
          than showing an empty grid that reads as "you own nothing". */}
      {wallet.address && chains?.configured && !chains.list.includes(wallet.chainId) && (
        <p className="faint" style={{ lineHeight: 1.7 }}>
          {t('nft.chainUnsupported', { network: EVM_CHAINS[wallet.chainId]?.name ?? '—' })}
        </p>
      )}

      {state === 'loading' && (
        <div className="nft-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="nft-card nft-skel" />
          ))}
        </div>
      )}

      {state === 'error' && (
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="muted" style={{ fontSize: 12.4 }}>
            {t(`nft.err.${error}`, { defaultValue: t('nft.err.FAILED') })}
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={load}>
            {t('common.retry')}
          </button>
        </motion.div>
      )}

      {state === 'done' && items.length === 0 && (
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85 }}>{t('nft.empty')}</p>
        </motion.div>
      )}

      {state === 'done' && items.length > 0 && (
        <>
          <motion.div className="nft-grid" variants={stagger} initial="hidden" animate="show">
            {items.map((n) => (
              <motion.button
                key={n.id}
                className="nft-card"
                variants={riseIn}
                whileTap={{ scale: 0.98 }}
                onClick={() => setDetail(n)}
              >
                <span className="nft-thumb">
                  {n.image ? (
                    // Referrer is withheld: an image URL under the token
                    // author's control would otherwise report which wallet
                    // viewed it, back to them.
                    <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="nft-noimg">{(n.collection || n.name || '?').slice(0, 2)}</span>
                  )}
                  {n.verified && (
                    <span className="nft-badge" title={t('nft.verified')}>
                      <IconShield width={11} height={11} />
                    </span>
                  )}
                </span>
                <span className="nft-name">{n.name}</span>
                <span className="nft-coll">{n.collection || '—'}</span>
              </motion.button>
            ))}
          </motion.div>

          <InfoBox title={t('nft.safetyTitle')} tone="warn" id="nft-safety">
            <p>{t('nft.safety')}</p>
          </InfoBox>
        </>
      )}

      {/* ---------- detail ---------- */}
      <Sheet open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <div>
            {detail.image && (
              <div className="nft-hero">
                <img src={detail.image} alt="" referrerPolicy="no-referrer" />
              </div>
            )}

            <div className="nft-rows">
              <div className="row-between">
                <span className="faint">{t('nft.collection')}</span>
                <span style={{ fontSize: 12.4 }}>{detail.collection || '—'}</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('nft.standard')}</span>
                <span className="mono" style={{ fontSize: 12 }}>{detail.standard}</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('nft.tokenId')}</span>
                <span className="mono" style={{ fontSize: 12, wordBreak: 'break-all', direction: 'ltr' }}>
                  {detail.tokenId}
                </span>
              </div>
              {detail.standard === 'ERC1155' && (
                <div className="row-between">
                  <span className="faint">{t('nft.owned')}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{detail.balance}</span>
                </div>
              )}
            </div>

            {!detail.verified && <p className="notice" style={{ marginTop: 11 }}>{t('nft.unverified')}</p>}

            <button className="btn btn-ghost" style={{ marginTop: 11 }} onClick={() => openContract(detail)}>
              {t('nft.viewContract')} <IconExternal width={13} height={13} />
            </button>
          </div>
        )}
      </Sheet>
    </PageTransition>
  );
}
