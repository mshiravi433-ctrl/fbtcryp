import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import QrScanner, { scannerSupported } from './QrScanner';
import { useWallet } from '../context/WalletContext';
import { formatUnitsExact, getTokenBalance, NATIVE_GAS_FLOOR, sendToken } from '../lib/swap';
import { EVM_CHAINS } from '../lib/chains';
import { IconQr } from './Icons';

/**
 * DIRECT SEND (the real OTC leg)
 * ---------------------------------------------------------------------------
 * The P2P screen's "on-chain OTC" button used to navigate to
 * `/wallet?action=send`, but Wallet.jsx never read that parameter and no send
 * form existed anywhere. The button was a dead end: it changed the URL and
 * nothing else. This is the screen it should have opened.
 *
 * Why a direct transfer is the honest "P2P" here: there is no fiat leg, so
 * there is nothing to escrow and no dispute to arbitrate. Two people agree a
 * price off-platform, one sends crypto, the chain settles it. That is
 * genuinely trustless — and the risk is entirely in the address, which is why
 * this screen is built around getting the address right.
 *
 * THREE SAFETY RULES, EACH FROM A REAL WAY PEOPLE LOSE MONEY
 *
 * 1. Scanning is offered before typing. A 42-character address has no
 *    human-checkable checksum; one wrong character sends funds to an address
 *    nobody controls, permanently.
 *
 * 2. The confirm step shows the address broken into chunks, and the amount and
 *    network in words. "Send 50 USDT on BNB Smart Chain" is checkable;
 *    a wall of hex is not.
 *
 * 3. Native sends reserve gas. Sending your entire BNB balance leaves nothing
 *    to pay the fee, so the transaction cannot even be mined — the classic way
 *    to strand a wallet.
 */
export default function SendSheet({ open, onClose, token: initialToken = null }) {
  const { t } = useTranslation();
  const wallet = useWallet();

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [stage, setStage] = useState('form'); // form → confirm → sending → done
  const [error, setError] = useState(null);
  const [hash, setHash] = useState(null);

  const chain = EVM_CHAINS[wallet.chainId];
  const token = initialToken ?? (chain ? { ...chain.tokens[0], native: true } : null);

  // Reset every time the sheet opens: a stale address from a previous send is
  // the kind of thing that quietly sends money to the wrong person.
  useEffect(() => {
    if (!open) return;
    setTo('');
    setAmount('');
    setStage('form');
    setError(null);
    setHash(null);
  }, [open]);

  useEffect(() => {
    if (!open || !token || !wallet.address) return;
    let alive = true;
    (async () => {
      try {
        const provider = wallet.getReadProvider();
        const raw = await getTokenBalance(provider, token, wallet.address);
        if (alive) setBalance(raw);
      } catch {
        if (alive) setBalance(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, token, wallet]);

  const balanceText = useMemo(
    () => (balance == null || !token ? null : formatUnitsExact(balance, token.decimals)),
    [balance, token]
  );

  /**
   * MAX. For a native coin this must leave gas behind, or the send is
   * unmineable. The floor is per-chain because $1 of BNB and $1 of ETH buy
   * very different amounts of gas.
   */
  const setMax = () => {
    if (!balanceText || !token) return;
    if (!token.native) return setAmount(balanceText);
    const reserve = NATIVE_GAS_FLOOR[wallet.chainId] ?? 0.002;
    const spendable = Number(balanceText) - reserve;
    setAmount(spendable > 0 ? String(spendable) : '0');
  };

  const addressLooksValid = /^0x[a-fA-F0-9]{40}$/.test(to.trim());
  const amountValid = Number(amount) > 0;
  const overBalance = balanceText != null && Number(amount) > Number(balanceText);
  const canReview = addressLooksValid && amountValid && !overBalance;

  const doSend = async () => {
    setStage('sending');
    setError(null);
    try {
      const signer = wallet.getSigner();
      if (!signer) throw new Error('NO_SIGNER');
      const tx = await sendToken({ signer, token, to: to.trim(), amount });
      setHash(tx.hash);
      setStage('done');
      wallet.refreshBalance?.();
    } catch (e) {
      const msg = String(e?.message || '');
      if (msg.includes('INVALID_ADDRESS')) setError('INVALID_ADDRESS');
      else if (/user rejected|denied/i.test(msg)) setError('REJECTED');
      else if (/insufficient/i.test(msg)) setError('INSUFFICIENT');
      else setError('FAILED');
      setStage('confirm');
    }
  };

  /** Break the address into 4-character groups so it can be read aloud. */
  const chunked = (addr) => (addr.match(/.{1,4}/g) ?? []).join(' ');

  if (!token) return null;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={t('send.title')}>
        {stage === 'done' ? (
          <div style={{ padding: '4px 2px' }}>
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{t('send.sent')}</p>
            <p className="muted" style={{ fontSize: 12.3, lineHeight: 1.8 }}>{t('send.sentBody')}</p>
            {hash && chain?.explorer && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                onClick={() => window.open(`${chain.explorer}/tx/${hash}`, '_blank', 'noopener,noreferrer')}
              >
                {t('send.viewTx')}
              </button>
            )}
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        ) : stage === 'confirm' ? (
          <div style={{ padding: '4px 2px' }}>
            <p className="section-label" style={{ marginBottom: 8 }}>{t('send.confirmTitle')}</p>

            <div className="card card-tight" style={{ marginBottom: 10 }}>
              <div className="faint" style={{ fontSize: 11 }}>{t('send.youSend')}</div>
              <div style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>
                {amount} {token.symbol}
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                {t('send.onNetwork', { network: chain?.name })}
              </div>
            </div>

            <div className="card card-tight">
              <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>{t('send.toAddress')}</div>
              {/* Chunked + LTR so an RTL layout cannot visually reorder hex. */}
              <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.8, wordBreak: 'break-all', direction: 'ltr' }}>
                {chunked(to.trim())}
              </div>
            </div>

            <p className="notice" style={{ marginTop: 11 }}>{t('send.irreversible')}</p>

            {error && <p className="notice notice-danger" style={{ marginTop: 9 }}>{t(`send.err.${error}`)}</p>}

            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStage('form')}>
                {t('common.back')}
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={stage === 'sending'}
                onClick={doSend}
              >
                {stage === 'sending' ? t('send.sending') : t('send.confirm')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '4px 2px' }}>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="faint">{t('send.toAddress')}</span>
              {scannerSupported() && (
                <button className="btn btn-ghost btn-sm" onClick={() => setScanOpen(true)}>
                  <IconQr width={14} height={14} /> {t('send.scan')}
                </button>
              )}
            </div>

            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12.5, direction: 'ltr' }}
            />
            {to && !addressLooksValid && (
              <p className="notice notice-danger" style={{ marginTop: 7 }}>{t('send.err.INVALID_ADDRESS')}</p>
            )}

            <div className="row-between" style={{ margin: '14px 0 6px' }}>
              <span className="faint">{t('send.amount')}</span>
              {balanceText && (
                <button className="btn btn-ghost btn-sm" onClick={setMax}>
                  {t('send.max')} · {Number(balanceText).toFixed(6)} {token.symbol}
                </button>
              )}
            </div>

            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              style={{ width: '100%' }}
            />
            {overBalance && (
              <p className="notice notice-danger" style={{ marginTop: 7 }}>{t('send.err.INSUFFICIENT')}</p>
            )}

            {token.native && (
              <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('send.gasReserve')}</p>
            )}

            <button
              className="btn btn-primary"
              style={{ marginTop: 13 }}
              disabled={!canReview}
              onClick={() => setStage('confirm')}
            >
              {t('send.review')}
            </button>
          </div>
        )}
      </Sheet>

      <QrScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(parsed) => {
          if (parsed?.address) setTo(parsed.address);
          if (parsed?.amount) setAmount(String(parsed.amount));
        }}
      />
    </>
  );
}
