import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../lib/chains';
import { IconChevronLeft, IconExternal, IconSearch } from '../components/Icons';
import QrScanner, { parseScanned, scannerSupported } from '../components/QrScanner';

/**
 * EXPLORER
 * ---------------------------------------------------------------------------
 * A lookup tool for transaction hashes and addresses.
 *
 * ─── WHY THIS DOES NOT RENDER CHAIN DATA ITSELF ────────────────────────────
 * Building a real block explorer means indexing every block of seven chains,
 * decoding logs, resolving token metadata and keeping it live. That is
 * infrastructure with a permanent running cost, and a half-built version is
 * actively dangerous: an explorer that misses a transaction, or shows a stale
 * "not found", makes a user believe their money vanished when it is simply
 * still pending. People make bad decisions from that screen — sending twice
 * is the common one.
 *
 * So this does the part that is genuinely useful and cannot be wrong: it
 * recognises WHAT you pasted, tells you which chain it belongs to, and opens
 * the canonical explorer for that chain. Etherscan and BscScan are already
 * correct, already live, and already trusted.
 *
 * The real value added here is the identification step. A user with a hash in
 * their clipboard usually does not know whether it is BSC or Polygon, and
 * picking the wrong explorer shows "not found" — which reads as "my money is
 * gone". Offering every chain at once removes that failure entirely.
 */

/** What kind of thing did the user paste? */
export function classifyQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) return { kind: 'empty' };

  // A tx hash is 32 bytes of hex; an address is 20. Both are 0x-prefixed, and
  // the length is what tells them apart.
  if (/^0x[a-fA-F0-9]{64}$/.test(q)) return { kind: 'tx', value: q };
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return { kind: 'address', value: q };

  // Tron and Solana have their own formats and their own explorers.
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(q)) return { kind: 'tron', value: q };
  if (/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(q)) return { kind: 'solana', value: q };

  // A bare number is a block height.
  if (/^\d{1,12}$/.test(q)) return { kind: 'block', value: q };

  return { kind: 'unknown', value: q };
}

const NON_EVM = {
  tron: { name: 'Tron', url: (v) => `https://tronscan.org/#/address/${v}` },
  solana: { name: 'Solana', url: (v) => `https://solscan.io/account/${v}` }
};

export default function Explore() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { haptic, tg } = useTelegram();

  const [q, setQ] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  const found = useMemo(() => classifyQuery(q), [q]);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  /** Every chain that could plausibly hold this hash or address. */
  const evmTargets = useMemo(() => {
    if (found.kind !== 'tx' && found.kind !== 'address' && found.kind !== 'block') return [];
    return Object.values(EVM_CHAINS).map((c) => ({
      chain: c,
      url:
        found.kind === 'tx'
          ? explorerTx(c.id, found.value)
          : found.kind === 'address'
            ? explorerAddr(c.id, found.value)
            : `${c.explorer}/block/${found.value}`
    }));
  }, [found]);

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('explore.title')}</h1>
      </motion.div>

      <p className="muted">{t('explore.subtitle')}</p>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 7 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('explore.placeholder')}
            spellCheck={false}
            autoComplete="off"
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, direction: 'ltr' }}
          />
          {scannerSupported() && (
            <button className="btn btn-ghost btn-sm" onClick={() => setScanOpen(true)} style={{ flexShrink: 0 }}>
              <IconSearch width={14} height={14} />
            </button>
          )}
        </div>

        {/* Say what it is before offering links. Naming the type is how the
            user learns the difference between a hash and an address. */}
        {q.trim() && (
          <p className="faint" style={{ marginTop: 9 }}>
            {t(`explore.kind.${found.kind}`)}
          </p>
        )}

        {wallet.address && !q.trim() && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10, width: '100%' }}
            onClick={() => setQ(wallet.address)}
          >
            {t('explore.useMine')}
          </button>
        )}
      </motion.section>

      {/* ---------------- EVM: offer every chain ---------------- */}
      {evmTargets.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 4 }}>{t('explore.openOn')}</p>
          <p className="faint" style={{ margin: '0 0 9px', lineHeight: 1.7 }}>
            {t('explore.chainHint')}
          </p>

          <div className="stack" style={{ gap: 7 }}>
            {evmTargets.map(({ chain, url }) => (
              <motion.button
                key={chain.id}
                className="exp-row"
                variants={riseIn}
                whileTap={{ scale: 0.99 }}
                onClick={() => open(url)}
              >
                <span className="exp-dot" style={{ background: chain.color }} />
                <span className="exp-name">{chain.name}</span>
                <span className="exp-go">
                  <IconExternal width={13} height={13} />
                </span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ---------------- non-EVM ---------------- */}
      {(found.kind === 'tron' || found.kind === 'solana') && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 9 }}>{t('explore.openOn')}</p>
          <button className="btn btn-primary" onClick={() => open(NON_EVM[found.kind].url(found.value))}>
            {NON_EVM[found.kind].name}
          </button>
          <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('explore.nonEvmNote')}</p>
        </motion.section>
      )}

      {found.kind === 'unknown' && (
        <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
          {t('explore.unrecognised')}
        </motion.p>
      )}

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('explore.learnTitle')}</p>
        <ul className="exp-learn">
          {['hash', 'address', 'pending', 'confirm'].map((k) => (
            <li key={k}>
              <strong>{t(`explore.learn.${k}.q`)}</strong>
              <span>{t(`explore.learn.${k}.a`)}</span>
            </li>
          ))}
        </ul>
      </motion.section>

      <QrScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(parsed, rawValue) => {
          // The scanner returns a parsed address when it recognises one, but a
          // block explorer should accept anything scannable — a tx hash QR is
          // common on receipts. Fall back to the raw payload.
          setQ(parsed?.address || rawValue || '');
        }}
      />
    </PageTransition>
  );
}

export { parseScanned };
