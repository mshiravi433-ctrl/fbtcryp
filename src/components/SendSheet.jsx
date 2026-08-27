import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import QrScanner, { scannerSupported } from './QrScanner';
import { useWallet } from '../context/WalletContext';
import { formatUnitsExact, getTokenBalance, NATIVE_GAS_FLOOR, sendToken } from '../lib/swap';
import { EVM_CHAINS, TOKENS } from '../lib/chains';
import {
  looksLikeDomain,
  structurallyValidAddress,
  checksumState,
  recipientRisk,
  estimateSendFeeNative,
  hasEnoughGas,
  verifySendContext,
  labelRequestType,
  setWalletRiskFormatters
} from '../lib/walletRisk';
import { IconQr, IconCheck, IconExternal, IconWallet, IconShield } from './Icons';
import { IconSend } from './WalletArt';
import TokenIcon from '../lib/tokenIcon';
import { checkPolicy, recordSpend } from '../lib/smartWallet';
import { screenRecipient, assertRecipientCleared } from '../lib/intent-ai';
import { readSendHistory, recordSend } from '../lib/sendHistory';

const loadEthers = () => import('ethers');

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
export default function SendSheet({ open, onClose, token: initialToken = null, swapForGasTarget = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [stage, setStage] = useState('form'); // form → confirm → sending → done
  const [error, setError] = useState(null);
  const [hash, setHash] = useState(null);

  /* Smart-send verification state (ENS + on-chain recipient risk + gas). */
  const [ens, setEns] = useState(null); // resolving | resolved | failed
  const [risk, setRisk] = useState(null); // { loading, flags, checksummed }
  const [gas, setGas] = useState(null); // { nativeBalance, feeNative, enough }
  const ensSeq = useRef(0);
  const riskSeq = useRef(0);

  /*
   * PHASE 82 — the address-poisoning shield. A separate decision from the
   * transaction confirmation: `addressOk` is the user saying "yes, this is
   * really the address I mean", and it is reset the moment the address
   * changes so it can never carry over to a different recipient.
   */
  const [addressOk, setAddressOk] = useState(false);

  const chain = EVM_CHAINS[wallet.chainId];

  /*
   * THE CRASH: this read `chain.tokens[0]`, but EVM_CHAINS entries have no
   * `tokens` key — the token lists live in a separate TOKENS map keyed by
   * chain id. So `chain.tokens` was undefined and indexing it threw
   * "Cannot read properties of undefined (reading '0')", which the error
   * boundary caught as an unexpected failure the moment P2P mounted.
   *
   * Also note this must not assume the chain is known. A wallet can be
   * connected to a network we do not support (the user switched it in
   * MetaMask), in which case both lookups legitimately come back empty and
   * the sheet has to say so rather than crash.
   */
  const chainTokens = TOKENS[wallet.chainId] ?? [];
  /*
   * WHICH token, chosen by the user.
   *
   * This used to be fixed to `initialToken ?? chainTokens[0]`, so a transfer
   * opened from the tap-to-pay flow could only ever send the chain's first
   * token. Reported: «چه نوعی این مهمه» — which asset is being moved matters,
   * and the screen never asked.
   *
   * `initialToken` is still honoured as the STARTING selection so an explicit
   * hand-off (from a coin page, say) is respected, but it no longer locks the
   * choice.
   */
  const [tokenSym, setTokenSym] = useState(null);
  const token =
    chainTokens.find((tk) => tk.symbol === tokenSym) ?? initialToken ?? chainTokens[0] ?? null;

  // Reset every time the sheet opens: a stale address from a previous send is
  // the kind of thing that quietly sends money to the wrong person.
  useEffect(() => {
    if (!open) return;
    setTo('');
    setAmount('');
    setTokenSym(null);
    setStage('form');
    setError(null);
    setHash(null);
    setEns(null);
    setRisk(null);
    setGas(null);
    setAddressOk(false);
  }, [open]);

  /*
   * ENS RESOLUTION — only when the input is actually a domain, and only with
   * a REAL resolveName against the connected provider. A failed lookup shows
   * an honest failure; nothing is ever guessed.
   */
  useEffect(() => {
    const raw = to.trim();
    if (!looksLikeDomain(raw)) {
      setEns(null);
      return undefined;
    }
    let alive = true;
    const seq = ++ensSeq.current;
    setEns({ type: 'resolving' });
    const timer = setTimeout(async () => {
      try {
        const provider = wallet.getReadProvider();
        const { isAddress } = await loadEthers();
        const resolved = await provider.resolveName(raw);
        if (!alive || seq !== ensSeq.current) return;
        if (resolved && isAddress(resolved)) {
          setTo(resolved);
          setEns({ type: 'resolved' });
        } else {
          setEns({ type: 'failed' });
        }
      } catch {
        if (alive && seq === ensSeq.current) setEns({ type: 'failed' });
      }
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);

  /*
   * ON-CHAIN RECIPIENT RISK — nonce and code are real facts from the RPC:
   * a zero nonce means "no previous activity" and a non-empty code means the
   * destination is a contract. Both are warnings, never verdicts.
   */
  useEffect(() => {
    const raw = to.trim();
    if (!structurallyValidAddress(raw)) {
      setRisk(null);
      return undefined;
    }
    let alive = true;
    const seq = ++riskSeq.current;
    setRisk({ loading: true, flags: [], checksummed: null });
    const timer = setTimeout(async () => {
      try {
        const provider = wallet.getReadProvider();
        const { getAddress } = await loadEthers();
        const [txCount, code] = await Promise.all([
          provider.getTransactionCount(raw).catch(() => null),
          provider.getCode(raw).catch(() => null)
        ]);
        if (!alive || seq !== riskSeq.current) return;
        const flags = recipientRisk({
          txCount: txCount == null ? undefined : txCount,
          code: code == null ? undefined : code,
          checksummed: checksumState(raw, getAddress) === 'checksummed'
        });
        setRisk({ loading: false, flags, checksummed: checksumState(raw, getAddress) });
      } catch {
        if (alive && seq === riskSeq.current) {
          setRisk({ loading: false, flags: [], checksummed: null });
        }
      }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);

  /*
   * GAS INTELLIGENCE — estimate the transfer fee in native coin from the
   * provider's real fee data, and compare it to the wallet's native balance.
   * "Get Gas" is only offered when a swap route to native exists.
   */
  const checkGas = useCallback(async () => {
    if (!open || !token || !wallet.address) return;
    try {
      const provider = wallet.getReadProvider();
      const { formatEther } = await loadEthers();
      setWalletRiskFormatters({ formatEther });
      const [balWei, feeData] = await Promise.all([
        provider.getBalance(wallet.address).catch(() => null),
        provider.getFeeData().catch(() => null)
      ]);
      const nativeBalance = balWei == null ? null : Number(formatEther(balWei));
      const feeNative = estimateSendFeeNative({ fee: feeData, token });
      setGas({
        nativeBalance,
        feeNative,
        enough: hasEnoughGas({ nativeBalance, feeNative })
      });
    } catch {
      setGas(null);
    }
  }, [open, token, wallet]);

  useEffect(() => {
    if (stage === 'confirm') checkGas();
  }, [stage, checkGas]);

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

  /**
   * Send a PERCENTAGE of the balance.
   *
   * Requested: «درصد مقدار ۲۵ درصد و ۵۰ درصد ۷۵ درصد و ۱۰۰ درصد را انتخاب کند
   * و یا هر مقداری که میخاد».
   *
   * 100% is routed through `setMax()` rather than multiplying by 1, because
   * for a NATIVE coin the whole balance is not spendable — the gas has to
   * come out of the same balance, and a transfer of literally everything is
   * unmineable. That reserve logic already exists in one place and must not
   * be duplicated here where it would drift.
   *
   * The lower percentages need no reserve: 75% of a balance always leaves
   * more than the gas floor behind.
   */
  const setPercent = (pct) => {
    if (!balanceText || !token) return;
    if (pct >= 100) return setMax();
    const v = (Number(balanceText) * pct) / 100;
    if (!Number.isFinite(v) || v <= 0) return;
    /*
     * Trim to the token's own precision. Sending more decimal places than the
     * token has causes the transfer to be rejected when the value is parsed
     * back into base units, and USDT has 6 while ETH has 18.
     */
    setAmount(String(Number(v.toFixed(Math.min(token.decimals ?? 18, 8)))));
  };

  const addressLooksValid = /^0x[a-fA-F0-9]{40}$/.test(to.trim());
  const amountValid = Number(amount) > 0;
  const overBalance = balanceText != null && Number(amount) > Number(balanceText);
  /*
   * The shield reads the wallet's own history: an address that has been paid
   * before is a counterparty, anything else is a stranger. A lookalike of a
   * known address, or an address that only ever arrived as dust, is a hard
   * stop — not a warning next to a live button.
   */
  const shield = useMemo(() => {
    if (!addressLooksValid) return null;
    return screenRecipient({
      recipient: to.trim(),
      history: readSendHistory(wallet.address),
      self: wallet.address,
      confirmedNewAddress: addressOk
    });
  }, [to, addressLooksValid, wallet.address, addressOk]);

  // A new address must be confirmed on its own before the amount even matters.
  const recipientCleared = shield ? assertRecipientCleared(shield).ok : false;
  const canReview = addressLooksValid && amountValid && !overBalance && recipientCleared;

  /*
   * TRANSACTION FIREWALL — the verification shown before signing.
   * For WalletConnect this is a READ-ONLY gate: the request chain must match
   * the app's selected chain (otherwise the confirm button locks), the
   * recipient must be structurally valid, and the amount is displayed in the
   * token's own decimals — never raw or converted to dollars. Calldata is
   * never rewritten; the wallet app shows the same request.
   */
  const firewall = useMemo(() => {
    const ctx = verifySendContext({
      tokenChainId: wallet.chainId,
      walletChainId: wallet.chainId,
      supported: wallet.chainOk
    });
    return {
      chainOk: ctx.chainOk && Boolean(wallet.chainOk),
      requestType: labelRequestType(token),
      amountLabel: `${amount || '0'} ${token?.symbol || ''}`,
      networkName: chain?.name ?? null
    };
  }, [amount, token, chain, wallet.chainId, wallet.chainOk]);

  const spendUsdGuess = () => {
    if (token && ['USDT', 'USDC', 'DAI', 'FDUSD'].includes(token.symbol)) {
      const n = Number(amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  };

  const doSend = async () => {
    setStage('sending');
    setError(null);
    try {
      const usd = spendUsdGuess();
      if (usd != null) {
        const gate = checkPolicy({ usd, to: to.trim() });
        if (!gate.ok) {
          setError(gate.code);
          setStage('confirm');
          return;
        }
      }
      // The shield is re-asserted here, not just in the button's disabled
      // state: a UI flag is a hint, this is the gate.
      const cleared = assertRecipientCleared(shield);
      if (!cleared.ok) {
        setError('RECIPIENT_BLOCKED');
        setStage('confirm');
        return;
      }
      const signer = wallet.getSigner();
      if (!signer) throw new Error('NO_SIGNER');
      const tx = await sendToken({ signer, token, to: to.trim(), amount });
      setHash(tx.hash);
      setStage('done');
      // Now this address is a counterparty, so the next send to it is not a
      // first-time send.
      recordSend({ owner: wallet.address, address: to.trim(), valueUsd: usd, chainId: wallet.chainId });
      if (usd != null) recordSpend(usd);
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

  /*
   * An unsupported network is a real state, not an impossible one — so say
   * what is wrong and how to fix it. Returning null here just made the button
   * appear broken.
   */
  if (!token || !chain) {
    return (
      <Sheet open={open} onClose={onClose} title={t('send.title')}>
        <p className="notice">{t('send.err.WRONG_NETWORK')}</p>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={t('send.title')}>
        {stage === 'done' ? (
          <div className="xfer-done">
            <div className="xfer-done-ico" aria-hidden="true"><IconCheck width={30} height={30} /></div>
            <div className="xfer-done-title">{t('send.sent')}</div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 6 }}>{t('send.sentBody')}</p>
            {hash && chain?.explorer && (
              <button
                className="recv-btn recv-btn-share"
                style={{ marginTop: 14 }}
                onClick={() => window.open(`${chain.explorer}/tx/${hash}`, '_blank', 'noopener,noreferrer')}
              >
                <IconExternal width={15} height={15} /> {t('send.viewTx')}
              </button>
            )}
            <button className="xfer-submit" style={{ marginTop: 10 }} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        ) : stage === 'confirm' ? (
          <div className="xfer-form">
            <p className="section-label" style={{ marginBottom: 10 }}>{t('send.confirmTitle')}</p>

            <div className="xfer-summary">
              <div className="xfer-summary-ico" aria-hidden="true"><IconSend width={20} height={20} /></div>
              <div className="xfer-summary-amount">
                {amount} <span>{token.symbol}</span>
              </div>
              <div className="xfer-summary-net-row">
                <span className="xfer-summary-net">🔗 {t('send.onNetwork', { network: chain?.name })}</span>
              </div>
              <div className="xfer-summary-divider" />
              <div className="faint" style={{ fontSize: 11, fontWeight: 700 }}>{t('send.toAddress')}</div>
              {/* Chunked + LTR so an RTL layout cannot visually reorder hex. */}
              <div className="xfer-summary-addr">{chunked(to.trim())}</div>
            </div>

            <p className="notice" style={{ marginTop: 12 }}>{t('send.irreversible')}</p>

            {/* Transaction firewall — verification before sign */}
            <div className="card card-tight" style={{ marginTop: 10, borderColor: 'var(--line-strong)' }}>
              <div className="row-between" style={{ marginBottom: 7 }}>
                <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 800 }}>
                  <IconShield width={14} height={14} /> {t('send.firewall.title')}
                </span>
                {firewall.chainOk
                  ? <span className="pill pill-up" style={{ fontSize: 9 }}>{t('send.firewall.ok')}</span>
                  : <span className="pill pill-down" style={{ fontSize: 9 }}>{t('send.firewall.locked')}</span>}
              </div>
              <div className="row-between" style={{ padding: '4px 0', fontSize: 11.5 }}>
                <span className="faint">{t('send.firewall.request')}</span>
                <span className="mono" style={{ fontWeight: 700 }}>eth_sendTransaction · {t(`send.firewall.type.${firewall.requestType}`)}</span>
              </div>
              <div className="row-between" style={{ padding: '4px 0', fontSize: 11.5, borderTop: '1px solid var(--line)' }}>
                <span className="faint">{t('send.firewall.amount')}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{firewall.amountLabel}</span>
              </div>
              <div className="row-between" style={{ padding: '4px 0', fontSize: 11.5, borderTop: '1px solid var(--line)' }}>
                <span className="faint">{t('send.firewall.network')}</span>
                <span className="mono" style={{ fontWeight: 700 }}>
                  {firewall.networkName || '—'}
                  {firewall.chainOk ? '' : ` · ${t('send.firewall.wrongNetwork')}`}
                </span>
              </div>
              {!firewall.chainOk && (
                <p className="notice notice-danger" style={{ margin: '8px 0 0', fontSize: 11.5 }}>{t('send.firewall.lockBody')}</p>
              )}
              {wallet.mode === 'wc' && firewall.chainOk && (
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 10.5, lineHeight: 1.6 }}>
                  {t('send.firewall.wcNote')}
                </p>
              )}
            </div>

            {/* Gas intelligence — real fee estimate vs native balance */}
            {gas && gas.feeNative != null && (
              <div className="row-between" style={{ marginTop: 9, fontSize: 11.5 }}>
                <span className="faint">{t('send.gasEstimate')}</span>
                <span className="mono" style={{ fontWeight: 800 }}>
                  ≈ {gas.feeNative.toFixed(6)} {chain?.native?.symbol}
                </span>
              </div>
            )}
            {gas && gas.enough === false && (
              <div className="stack" style={{ gap: 7, marginTop: 8 }}>
                <p className="notice notice-danger" style={{ margin: 0, fontSize: 11.5 }}>
                  {t('send.gasLow', { symbol: chain?.native?.symbol || '' })}
                </p>
                {swapForGasTarget && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ minHeight: 38, borderRadius: 11 }}
                    onClick={() => navigate(`/swap?from=${encodeURIComponent(swapForGasTarget)}&to=${encodeURIComponent(chain?.native?.symbol || '')}&chain=${wallet.chainId}`)}
                  >
                    {t('send.getGas', { from: swapForGasTarget, to: chain?.native?.symbol || '' })}
                  </button>
                )}
              </div>
            )}

            {error && (
              <p className="notice notice-danger" style={{ marginTop: 9 }}>
                {t(
                  error === 'OVER_DAILY_LIMIT' || error === 'OVER_TX_LIMIT' || error === 'NOT_ALLOWLISTED'
                    ? `smart.err.${error}`
                    : `send.err.${error}`
                )}
              </p>
            )}

            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn btn-ghost" style={{ flex: 1, minHeight: 48, borderRadius: 14 }} onClick={() => setStage('form')}>
                {t('common.back')}
              </button>
              <button
                className="xfer-submit xfer-submit-danger"
                style={{ flex: 1, marginTop: 0, minHeight: 48 }}
                disabled={stage === 'sending' || !firewall.chainOk}
                onClick={doSend}
              >
                {stage === 'sending' ? t('send.sending') : t('send.confirm')}
              </button>
            </div>
          </div>
        ) : (
          <div className="xfer-form">
            <div className="xfer-label-row">
              <span className="xfer-label">{t('send.toAddress')}</span>
              {scannerSupported() && (
                <button className="xfer-scan" onClick={() => setScanOpen(true)}>
                  <IconQr width={13} height={13} /> {t('send.scan')}
                </button>
              )}
            </div>

            <div className={`xfer-input xfer-input-ltr ${to ? (addressLooksValid ? 'is-valid' : 'is-invalid') : ''}`}>
              <span className="xfer-input-icon" aria-hidden="true"><IconWallet width={16} height={16} /></span>
              <input
                type="text"
                value={to}
                onChange={(e) => { setTo(e.target.value); setAddressOk(false); }}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
              />
              {addressLooksValid && <span className="xfer-ok" aria-hidden="true"><IconCheck width={14} height={14} /></span>}
            </div>
            {to && !addressLooksValid && (
              <p className="notice notice-danger" style={{ marginTop: 7 }}>{t('send.err.INVALID_ADDRESS')}</p>
            )}

            {/* ENS resolution status — real resolveName result, honest failure */}
            {ens?.type === 'resolving' && (
              <p className="notice" style={{ marginTop: 7 }}>{t('send.ensResolving')}</p>
            )}
            {ens?.type === 'failed' && (
              <p className="notice" style={{ marginTop: 7 }}>{t('send.ensFailed')}</p>
            )}

            {/* On-chain recipient risk — facts from the RPC, warnings not verdicts */}
            {risk?.loading && <p className="notice" style={{ marginTop: 7 }}>…</p>}
            {risk && !risk.loading && risk.flags.length > 0 && (
              <div className="stack" style={{ gap: 5, marginTop: 7 }}>
                {risk.flags.includes('fresh') && (
                  <p className="notice" style={{ marginTop: 0 }}>{t('send.risk.fresh')}</p>
                )}
                {risk.flags.includes('contract') && (
                  <p className="notice notice-danger" style={{ marginTop: 0 }}>{t('send.risk.contract')}</p>
                )}
                {risk.flags.includes('unchecksummed') && (
                  <p className="notice" style={{ marginTop: 0 }}>{t('send.risk.unchecksummed')}</p>
                )}
              </div>
            )}
            {risk && !risk.loading && risk.flags.length === 0 && addressLooksValid && (
              <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>✓ {t('send.risk.clean')}</p>
            )}

            {/*
              PHASE 82 — poisoning shield. Hard stops render as blocking
              notices with BOTH addresses in full, because the abbreviation is
              exactly what the attack exploits. A first-time address gets its
              own checkbox, separate from the transaction confirmation.
            */}
            {shield && shield.flags.length > 0 && (
              <div className="xfer-shield" data-testid="address-shield">
                {shield.flags.filter((f) => f.severity === 'reject').map((f) => (
                  <p key={f.code} className="notice notice-danger" style={{ marginTop: 0 }} data-testid="address-shield-block">
                    {t(f.i18nKey, f.params)}
                  </p>
                ))}
                {shield.verdict !== 'reject' && shield.requiresSeparateAddressConfirmation && (
                  <label className="xfer-shield-confirm" data-testid="address-shield-confirm">
                    <input
                      type="checkbox"
                      checked={addressOk}
                      onChange={(e) => setAddressOk(e.target.checked)}
                    />
                    <span>
                      {t('intentAI.addressShield.flag.firstTime', { fingerprint: shield.fingerprint })}
                    </span>
                  </label>
                )}
              </div>
            )}

            {/*
              WHICH ASSET. Previously fixed to the chain's first token, so a
              transfer could only ever move one thing and the screen never
              said which. Only rendered when there is a real choice.
            */}
            <div className="xfer-label" style={{ marginTop: 15 }}>{t('send.asset')}</div>
            {chainTokens.length > 1 ? (
              <div className="xfer-chips">
                {chainTokens.map((tk) => (
                  <button
                    key={tk.symbol}
                    className={`xfer-chip ${token.symbol === tk.symbol ? 'active' : ''}`}
                    onClick={() => {
                      setTokenSym(tk.symbol);
                      /* A figure typed for one asset is meaningless for another
                         and would silently become an over-send. */
                      setAmount('');
                    }}
                  >
                    <TokenIcon token={{ symbol: tk.symbol, address: tk.address, native: tk.native }} chainId={wallet.chainId} size={18} />
                    {tk.symbol}
                  </button>
                ))}
              </div>
            ) : (
              <div className="xfer-chip-single">
                <TokenIcon token={{ symbol: token.symbol, address: token.address, native: token.native }} chainId={wallet.chainId} size={20} />
                <span>
                  <b>{token.symbol}</b> <span className="faint">{token.name}</span>
                </span>
              </div>
            )}

            <div className="xfer-label-row" style={{ marginTop: 15 }}>
              <span className="xfer-label">{t('send.amount')}</span>
              {balanceText && (
                <span className="xfer-balance">
                  {t('send.balance')}: <b>{Number(balanceText).toFixed(6)} {token.symbol}</b>
                </span>
              )}
            </div>

            <div className="xfer-input xfer-amount-input">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
              />
              <span className="xfer-token-sym">{token.symbol}</span>
            </div>

            {/*
              QUARTER STEPS PLUS MAX.

              Typing an amount by hand is the slow, error-prone part of a
              transfer standing in front of someone. 100% deliberately calls
              setMax(), which reserves gas on a native coin — a literal
              whole-balance transfer cannot be mined, so a plain ×1 here would
              produce a button that always fails.
            */}
            {balanceText && Number(balanceText) > 0 && (
              <div className="xfer-pcts">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    className="xfer-pct"
                    onClick={() => setPercent(pct)}
                  >
                    {pct === 100 ? t('send.max') : `${pct}%`}
                  </button>
                ))}
              </div>
            )}
            {overBalance && (
              <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('send.err.INSUFFICIENT')}</p>
            )}

            {token.native && (
              <p className="xfer-hint">{t('send.gasReserve')}</p>
            )}

            <button
              className="xfer-submit"
              disabled={!canReview}
              onClick={() => setStage('confirm')}
            >
              <IconSend width={17} height={17} /> {t('send.review')}
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
