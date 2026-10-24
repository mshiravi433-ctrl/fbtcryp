import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import InfoBox from './InfoBox';
import LanguagePicker from './LanguagePicker';
import ModernSelect from './ModernSelect';
import FancyQr from './FancyQr';
import {
  IconWallet, IconSparkle, IconCoins, IconLink, IconCopy, IconCheck, IconQr
} from './Icons';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS, DEFAULT_CHAIN } from '../lib/chains';
import {
  PAY_THEMES, PAY_THEME_ORDER,
  encodePayPayload, payLandingUrl,
  loadSavedPayLinks, savePayLink, removePayLink
} from '../lib/payLink';
import '../styles/pay-gateway.css';

export default function PayGatewayPanel() {
  const { t, i18n } = useTranslation();
  const wallet = useWallet();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const notify = useAppStore((st) => st.notify);

  const [theme, setTheme] = useState('mint');
  const [lang, setLang] = useState(i18n.language || 'en');
  const [chainId, setChainId] = useState(wallet.chainId || DEFAULT_CHAIN);
  const tokens = TOKENS[chainId] || [];
  const [token, setToken] = useState(tokens[0]?.symbol || 'USDT');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [links, setLinks] = useState(() => loadSavedPayLinks());
  const [copied, setCopied] = useState('');
  const [formErr, setFormErr] = useState('');

  const onChain = (id) => {
    const next = Number(id);
    setChainId(next);
    const list = TOKENS[next] || [];
    if (!list.some((tk) => tk.symbol === token)) setToken(list[0]?.symbol || '');
  };

  /*
   * Option rows for the two pickers. Every row carries the artwork ModernSelect
   * knows how to draw: `chain` for the network mark, `symbol` + `chain` for the
   * offline token art (so a payer on a blocked CDN still sees the coin's face),
   * and `token`/`chainId` so an address-keyed token resolves to its own icon
   * rather than borrowing a look-alike's.
   */
  const networkOptions = useMemo(
    () => EVM_CHAIN_ORDER
      .filter((id) => EVM_CHAINS[id])
      .map((id) => ({
        value: id,
        label: EVM_CHAINS[id].name,
        sublabel: EVM_CHAINS[id].native?.symbol
          ? `${t('pay.gasIn', { gas: EVM_CHAINS[id].native.symbol })}`
          : undefined,
        chain: String(id)
      })),
    [t]
  );

  const tokenOptions = useMemo(
    () => tokens.map((tk) => ({
      value: tk.symbol,
      label: tk.symbol,
      sublabel: tk.name,
      symbol: tk.symbol,
      chain: String(chainId),
      token: tk,
      chainId
    })),
    [tokens, chainId]
  );

  const create = () => {
    setFormErr('');
    if (!wallet.isConnected || !wallet.address) {
      setFormErr(t('pay.needWallet'));
      return;
    }
    if (!token) {
      setFormErr(t('pay.needToken'));
      return;
    }
    try {
      const code = encodePayPayload({
        to: wallet.address,
        chainId,
        token,
        amount: amount.replace(/\.$/, ''),
        lang,
        theme,
        name,
        note
      });
      const entry = {
        id: `${Date.now().toString(36)}-${code.slice(0, 8)}`,
        code,
        url: payLandingUrl(code),
        createdAt: Date.now(),
        to: wallet.address,
        chainId,
        token,
        amount,
        lang,
        theme,
        name,
        note
      };
      haptic?.('success');
      setLinks(savePayLink(entry));
    } catch (e) {
      const key = e?.message === 'INVALID_AMOUNT' ? 'pay.amountHint'
        : e?.message === 'INVALID_TOKEN' ? 'pay.needToken'
          : 'pay.needWallet';
      setFormErr(t(key));
    }
  };

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      notify?.('copied', 'success');
      setTimeout(() => setCopied(''), 1800);
    } catch {
      notify?.('copyFailed', 'error');
    }
  };

  const share = async (url) => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ url, title: t('pay.title') }); } catch { /* dismissed */ }
      return;
    }
    copy(url);
  };

  const connect = async () => {
    if (typeof window !== 'undefined' && window.ethereum) {
      await wallet.connectInjected();
    } else {
      await wallet.connectWalletConnect();
    }
  };

  return (
    <div className="pay-gw">
      <p className="prose-sm">{t('pay.subtitle')}</p>

      <InfoBox title={t('pay.section.wallet')} id="pay-wallet" defaultOpen icon={<IconWallet width={16} height={16} />}>
        {wallet.isConnected ? (
          <>
            <div className="pay-bound">
              <span className="faint">{t('pay.bound')}</span>
              <span className="mono">{shortAddress(wallet.address)}</span>
            </div>
          </>
        ) : (
          <>
            <p className="prose-sm">{t('pay.connect')}</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={connect}>
              {t('wallet.connect')}
            </button>
          </>
        )}
      </InfoBox>

      <InfoBox title={t('pay.section.look')} id="pay-look" icon={<IconSparkle width={16} height={16} />}>
        <div className="pay-field">
          <span>{t('pay.color')}</span>
          <div className="pay-themes" role="radiogroup" aria-label={t('pay.color')}>
            {PAY_THEME_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`pay-theme${theme === id ? ' is-on' : ''}`}
                style={{ '--swatch': PAY_THEMES[id].accent }}
                aria-pressed={theme === id}
                aria-label={t(`pay.theme.${id}`)}
                title={t(`pay.theme.${id}`)}
                onClick={() => { haptic?.('select'); setTheme(id); }}
              >
                {/* A tick, not just a ring: six near-identical squares where the
                    only signal is a 2px outline is a control you have to
                    squint at, and this is the one choice the payer sees. */}
                <span className="pay-theme-tick" aria-hidden="true"><IconCheck width={13} height={13} /></span>
              </button>
            ))}
          </div>
        </div>
        <div className="pay-field">
          <span>{t('pay.language')}</span>
          <LanguagePicker
            variant="compact"
            persist={false}
            value={lang}
            showCoverage={false}
            onPick={setLang}
          />
        </div>
      </InfoBox>

      <InfoBox title={t('pay.section.payment')} id="pay-payment" icon={<IconCoins width={16} height={16} />}>
        {/*
          ─── THE TWO PICKERS USED TO BE PLAIN <select> BOXES ──────────────────
          «درگاه پرداخت باکس انتخاب توکن و شبکه مدرن شود.» A native dropdown on
          a payment screen is the one control that cannot show the two things a
          payer actually checks: WHICH network (every EVM chain reuses the same
          0x address, so the network is the difference between paid and lost)
          and WHICH token (USDT on BSC is not USDT on Ethereum). Both now use
          the app's ModernSelect — the same bottom-sheet picker the swap and
          farm screens use — with the network mark, the token's own artwork and
          the native gas coin named on every row. One vocabulary, and a payer
          can no longer pick a token by guessing from three letters.
        */}
        <div className="pay-field">
          <span>{t('pay.network')}</span>
          <ModernSelect
            value={chainId}
            onChange={(value) => onChain(value)}
            options={networkOptions}
            title={t('pay.network')}
            placeholder={t('pay.network')}
            ariaLabel={t('pay.network')}
            testId="pay-network-select"
          />
        </div>
        <div className="pay-field">
          <span>{t('pay.token')}</span>
          <ModernSelect
            value={token}
            onChange={(value) => setToken(value)}
            options={tokenOptions}
            title={t('pay.token')}
            placeholder={t('pay.token')}
            ariaLabel={t('pay.token')}
            testId="pay-token-select"
          />
          <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
            {t('pay.gasNote', { gas: EVM_CHAINS[chainId]?.native?.symbol || '—' })}
          </p>
        </div>
        <label className="pay-field">
          <span>{t('pay.amount')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={t('pay.amountOpen')}
          />
        </label>
        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t('pay.amountHint')}</p>
        {/*
          ─── THE INVOICE NOTE — PHASE 2 ─────────────────────────────────────
          A merchant with four open orders and one USDT address used to send
          four links that looked identical to the payer. This field is what
          tells order #148 from order #149 on the landing page — and it rides
          inside the link itself (no server lookup, nothing to lose when the
          merchant clears the list), exactly like every other payload field.
          Optional, capped at 120 characters by the same sanitizer the
          decoder re-runs, so a link saved before this feature and a link
          typed with an essay in this box both behave.
        */}
        <label className="pay-field">
          <span>{t('pay.invoice')}</span>
          <input
            type="text"
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('pay.invoicePlaceholder')}
          />
        </label>
        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t('pay.invoiceHint')}</p>
        <label className="pay-field">
          <span>{t('pay.name')}</span>
          <input
            type="text"
            value={name}
            maxLength={48}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('pay.namePlaceholder')}
          />
        </label>
        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t('pay.nameHint')}</p>
      </InfoBox>

      <InfoBox title={t('pay.section.link')} id="pay-link" icon={<IconLink width={16} height={16} />}>
        <p className="prose-sm">{t('pay.feeNote')}</p>
        {formErr && <p className="notice" style={{ marginTop: 10 }}>{formErr}</p>}
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={create}>
          {t('pay.create')}
        </button>

        {links.length === 0 ? (
          <p className="faint" style={{ marginTop: 12 }}>{t('pay.emptyLinks')}</p>
        ) : links.map((row) => (
          <SavedLink
            key={row.id}
            row={row}
            copied={copied === row.url}
            onCopy={() => copy(row.url)}
            onShare={() => share(row.url)}
            onPreview={() => navigate(`/pay/${row.code}`)}
            onRemove={() => { haptic?.('select'); setLinks(removePayLink(row.id)); }}
            t={t}
          />
        ))}
      </InfoBox>
    </div>
  );
}

/**
 * ONE SAVED LINK.
 *
 * ─── WHY THE QR IS THE APP'S FANCY QR NOW ──────────────────────────────────
 * This row used to hand-roll its own matrix and paint it as a flat black
 * square — a fourth copy of the same encoder, and the plainest thing on a
 * screen whose whole job is to look like somebody's business. FancyQr is the
 * component this repo built for exactly this, and it is the only QR surface
 * whose decodability is pinned by a test that rasterises the painted path and
 * pushes it through a real decoder. Four implementations is four chances to
 * ship a code that scans to the wrong string; one is one.
 *
 * The frame ACCENT is the merchant's own theme colour, so a gold link reads
 * gold and a night link reads blue — the choice they made in the box above is
 * visible on the code they print.
 */
function SavedLink({ row, copied, onCopy, onShare, onPreview, onRemove, t }) {
  const chain = EVM_CHAINS[row.chainId];
  const theme = PAY_THEMES[row.theme] ?? PAY_THEMES.mint;
  const accent = useMemo(
    () => [theme.accent, PAY_THEMES.violet.accent, PAY_THEMES.cyan.accent],
    [theme]
  );
  return (
    <div className="pay-link-row" style={{ '--pay-link-accent': theme.accent }}>
      <div className="pay-link-head">
        <span className="pay-link-mark" aria-hidden="true">
          {(row.name || row.token || '·').trim().charAt(0).toUpperCase()}
        </span>
        <div className="pay-link-title">
          <strong>
            {row.name || shortAddress(row.to)} · {row.token}
            {row.amount ? ` ${row.amount}` : ` · ${t('pay.amountOpen')}`}
          </strong>
          <span>{chain?.name}</span>
          {row.note && (
            <span className="pay-link-note">{row.note}</span>
          )}
        </div>
      </div>
      <div className="pay-link-url mono">{row.url}</div>
      <FancyQr
        value={row.url}
        label={t('pay.qr')}
        className="pay-qr"
        accent={accent}
        badge={<IconQr width={17} height={17} />}
      />
      <div className="pay-link-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy}>
          {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
          {copied ? t('pay.copied') : t('pay.copy')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onShare}>
          <IconLink width={14} height={14} />
          {t('pay.share')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onPreview}>
          <IconQr width={14} height={14} />
          {t('pay.preview')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm pay-remove" onClick={onRemove}>
          {t('pay.remove')}
        </button>
      </div>
    </div>
  );
}
