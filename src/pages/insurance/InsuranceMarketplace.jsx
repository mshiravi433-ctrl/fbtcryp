import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel, typeLabel, reasonLabel, settlementLabel, claimLabel } from './insStatus.js';
import { insuranceError } from './insErrors.js';
import InsAlert from './InsAlert.jsx';
import ModernSelect from '../../components/ModernSelect.jsx';
import AssetIcon from '../../components/AssetIcon.jsx';
import {
  InsIconMarket, InsIconShield, InsIconSearch, InsIconRetry, InsIconExternal, InsIconInfo,
  InsIconCheck, InsIconAlert, InsIconEmpty, InsIconProtocol, InsIconChevronEnd,
  INS_TYPE_ICONS, INS_TYPE_TONES
} from './InsuranceIcons.jsx';

const TYPES = ['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'];
const DURATION_CHOICES = [28, 90, 180, 365];
const AMOUNT_CHOICES = [1000, 5000, 10000, 25000, 50000, 100000];
const CHAINS = [
  { id: 1, name: 'Ethereum' }, { id: 56, name: 'BNB Chain' }, { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum' }, { id: 10, name: 'Optimism' }, { id: 8453, name: 'Base' },
  { id: 43114, name: 'Avalanche' }, { id: 59144, name: 'Linea' }
];

/**
 * Protocol name → ticker for the offline artwork in AssetIcon. Only a display
 * hint: unknown names fall back to AssetIcon's monogram, never to a wrong logo.
 */
const PROTOCOL_TICKERS = [
  [/\baave\b/i, 'AAVE'], [/\bcompound\b/i, 'COMP'], [/\buniswap\b/i, 'UNI'], [/\blido\b/i, 'LDO'],
  [/\bmaker|\bsky\b/i, 'MKR'], [/\bcurve\b/i, 'CRV'], [/\bbalancer\b/i, 'BAL'], [/\bpendle\b/i, 'PENDLE'],
  [/\bgmx\b/i, 'GMX'], [/\bdydx\b/i, 'DYDX'], [/\bsynthetix\b/i, 'SNX'], [/\byearn\b/i, 'YFI'],
  [/\bsushi/i, 'SUSHI'], [/\brocket\s*pool\b/i, 'RPL'], [/\bfrax\b/i, 'FXS'], [/\bconvex\b/i, 'CVX'],
  [/\bmorpho\b/i, 'MORPHO'], [/\beigen/i, 'EIGEN'], [/\bstakewise\b/i, 'SWISE'], [/\b1inch\b/i, '1INCH'],
  [/\bsafe\b/i, 'SAFE'], [/\bbeefy\b/i, 'BIFI'], [/\bether\.?fi\b/i, 'ETHFI'], [/\bspark\b/i, 'SPK'],
  [/\bliquity\b/i, 'LQTY'], [/\bpancake/i, 'CAKE'], [/\bvenus\b/i, 'XVS'], [/\bthorchain\b/i, 'RUNE'],
  [/\bchainlink\b/i, 'LINK'], [/\bjupiter\b/i, 'JUP'], [/\bcoinbase|\bcbbtc\b/i, 'BTC'], [/\btether\b/i, 'USDT'],
  [/\bcircle\b|\busdc\b/i, 'USDC'], [/\bdai\b/i, 'DAI'], [/\bstargate\b/i, 'STG'], [/\bacross\b/i, 'ACX']
];
function protocolTicker(name) {
  const s = String(name || '');
  const hit = PROTOCOL_TICKERS.find(([re]) => re.test(s));
  if (hit) return hit[1];
  return s.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '?';
}

const bpsToPct = (bps) => {
  const n = Number(bps);
  if (!Number.isFinite(n) || n < 0) return null;
  return (n / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
};

export default function InsuranceMarketplace() {
  const { t } = useTranslation();
  const { wallet } = useOutletContext();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(TYPES.includes(sp.get('type')) ? sp.get('type') : 'smart-contract');
  const [chainId, setChainId] = useState(CHAINS.some((c) => c.id === Number(sp.get('chain'))) ? Number(sp.get('chain')) : 1);
  const [amount, setAmount] = useState(sp.get('amount') || '10000');
  const [duration, setDuration] = useState(DURATION_CHOICES.includes(Number(sp.get('duration'))) ? sp.get('duration') : '28');
  const [productId, setProductId] = useState(sp.get('product') || '');
  const [products, setProducts] = useState([]);
  const [productsState, setProductsState] = useState('loading'); // loading | ready | error
  const [productsNonce, setProductsNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState('');
  /* the machine code alone — the unavailable-state heading switches on it, and
     reading it off `err.text` would mean parsing prose back into a code */
  const [errCode, setErrCode] = useState('');
  const [failures, setFailures] = useState([]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [providers, setProviders] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    insuranceApi.providers().then((list) => {
      setProviders(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  /* Real products for the selected network — straight from the provider
     catalogue (GET /products?chainId=…). Nothing is invented client-side. */
  useEffect(() => {
    let alive = true;
    setProductsState('loading');
    insuranceApi.products(chainId)
      .then((list) => { if (!alive) return; setProducts(Array.isArray(list) ? list : []); setProductsState('ready'); })
      .catch(() => { if (!alive) return; setProducts([]); setProductsState('error'); });
    return () => { alive = false; };
  }, [chainId, productsNonce]);

  const typeProducts = useMemo(() => products.filter((p) => p.kind === type), [products, type]);
  const countByType = useMemo(() => {
    const m = {};
    for (const p of products) m[p.kind] = (m[p.kind] || 0) + 1;
    return m;
  }, [products]);

  /* Keep the selection honest: it must be a product of the chosen type on the
     chosen chain. A single candidate is pre-selected; otherwise the user picks. */
  useEffect(() => {
    if (productsState !== 'ready') return;
    if (productId && typeProducts.some((p) => p.id === productId)) return;
    setProductId(typeProducts.length === 1 ? typeProducts[0].id : '');
  }, [productsState, typeProducts, productId]);

  useEffect(() => {
    const next = new URLSearchParams(sp);
    next.set('type', type); next.set('chain', String(chainId)); next.set('duration', String(duration));
    if (productId) next.set('product', productId); else next.delete('product');
    if (next.toString() !== sp.toString()) setSp(next, { replace: true });
  }, [type, chainId, duration, productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProduct = typeProducts.find((p) => p.id === productId) || null;
  const chain = CHAINS.find((c) => c.id === chainId) || CHAINS[0];
  const sandboxOnly = providers.length > 0 && providers.every((p) => p.status !== 'LIVE' || !p.enabled) && providers.some((p) => p.status === 'SANDBOX');
  const liveProviders = providers.filter((p) => p.status === 'LIVE' && p.enabled);
  const providerName = (id) => providers.find((p) => p.providerId === id)?.displayName || products.find((p) => p.providerId === id)?.providerName || id;
  const noLiveQuote = (warnings || []).includes('LIVE_QUOTE_NOT_AVAILABLE');
  const needsProduct = productsState === 'ready' && typeProducts.length > 0 && !selectedProduct;

  async function getQuotes() {
    setErr(''); setErrCode(''); setResult(null); setFailures([]); setBusy(true);
    try {
      const res = await insuranceApi.quote({
        walletAddress: wallet,
        chainId,
        protectionType: type,
        productId: selectedProduct?.id || productId || undefined,
        protocol: selectedProduct?.name || undefined,
        coverageAmount: amount,
        durationDays: Number(duration),
        termsAccepted
      });
      if (!res.ok) {
        const e0 = res.errors?.[0] || {};
        /* `err` used to be the raw code («VALID_WALLET_REQUIRED» printed in a red
           box, in English, on a Persian page). Map it to one sentence and keep
           the code for the unavailable-state header comparison below. */
        const mapped = insuranceError({ code: e0.code || 'NO_ELIGIBLE_PROTECTION', message: e0.detail || '' }, t);
        setErr(mapped);
        setErrCode(mapped.code);
        setWarnings(res.warnings || []);
        setFailures(Array.isArray(res.data?.detail) ? res.data.detail : []);
      } else {
        setResult(res.data.quotes);
        setWarnings(res.warnings || []);
      }
    } catch (e) {
      setErr(insuranceError(e, t));
      setErrCode(String(e?.code || ''));
      setWarnings(e?.warnings || []);
      setFailures(Array.isArray(e?.data?.detail) ? e.data.detail : []);
    }
    setBusy(false);
  }

  const fmtFresh = (q) => {
    if (!q?.quoteUpdatedAt) return null;
    const d = new Date(Number(q.quoteUpdatedAt) || q.quoteUpdatedAt);
    return isNaN(d) ? null : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  };

  const chainOptions = CHAINS.map((c) => ({ value: c.id, label: c.name, sublabel: `chainId ${c.id}`, chain: c.id }));
  const productOptions = typeProducts.map((p) => {
    const pct = bpsToPct(p.minPrice);
    return {
      value: p.id,
      label: p.name || p.label || p.id,
      sublabel: [p.providerName, pct ? t('insurance.market.minPriceValue', { pct }) : null].filter(Boolean).join(' · '),
      meta: statusLabel(t, p.sandbox ? 'SANDBOX' : (p.providerStatus || 'LIVE')),
      iconNode: <AssetIcon symbol={protocolTicker(p.name)} size={40} radius={12} />
    };
  });

  const minPct = selectedProduct ? bpsToPct(selectedProduct.minPrice) : null;
  const productKv = selectedProduct ? [
    minPct ? { k: t('insurance.market.minPrice'), v: t('insurance.market.minPriceValue', { pct: minPct }) } : null,
    selectedProduct.gracePeriodDays != null ? { k: t('insurance.market.gracePeriod'), v: t('insurance.market.graceDays', { count: Number(selectedProduct.gracePeriodDays) }) } : null,
    Array.isArray(selectedProduct.coverAssets) && selectedProduct.coverAssets.length ? { k: t('insurance.market.coverAssets'), assets: selectedProduct.coverAssets } : null,
    selectedProduct.claimMethod ? { k: t('insurance.market.claimMethod'), v: claimLabel(t, selectedProduct.claimMethod) } : null,
    { k: t('insurance.quote.provider'), v: selectedProduct.providerName || providerName(selectedProduct.providerId) },
    { k: t('insurance.market.productId'), code: selectedProduct.id }
  ].filter(Boolean) : [];

  return (
    <div className="ins-market ins-tone-violet">
      <div className="ins-hero">
        <div className="ins-ico lg"><InsIconMarket /></div>
        <div className="ins-hero-body">
          <span className="ins-hero-badge"><InsIconShield /> {t('insurance.dashboard.heroBadge')}</span>
          <h1>{t('insurance.market.title')}</h1>
          <p>{t('insurance.market.subtitle')}</p>
          {sandboxOnly && <p className="ins-hero-note">{t('insurance.market.sandboxOnlyNote')}</p>}
        </div>
      </div>

      <div className="ins-card ins-form-card">
        {/* 1 · protection type */}
        <div className="ins-field">
          <div className="ins-label"><span>{t('insurance.market.protectionType')}</span></div>
          <div className="ins-type-grid" role="radiogroup" aria-label={t('insurance.market.protectionType')}>
            {TYPES.map((typeId) => {
              const Glyph = INS_TYPE_ICONS[typeId] || InsIconShield;
              const on = type === typeId;
              const n = countByType[typeId] || 0;
              return (
                <button
                  key={typeId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`ins-type ins-tone-${INS_TYPE_TONES[typeId] || 'cyan'}${on ? ' is-on' : ''}${productsState === 'ready' && n === 0 ? ' is-empty' : ''}`}
                  onClick={() => setType(typeId)}
                >
                  {productsState === 'ready' && n > 0 && <span className="ins-type-count">{n}</span>}
                  <span className="ins-type-ico"><Glyph /></span>
                  <span>{typeLabel(t, typeId)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2 · network + protocol */}
        <div className="ins-field-row">
          <div className="ins-field">
            <div className="ins-label"><span>{t('insurance.market.chain')}</span></div>
            <ModernSelect
              value={chainId}
              onChange={(v) => setChainId(Number(v))}
              options={chainOptions}
              title={t('insurance.market.chain')}
              placeholder={t('insurance.market.chain')}
              searchable={false}
              testId="ins-chain-select"
            />
          </div>
          <div className="ins-field">
            <div className="ins-label">
              <span>{t('insurance.market.product')}</span>
              {productsState === 'ready' && typeProducts.length > 0 && (
                <span className="ins-label-hint">{t('insurance.market.productCount', { count: typeProducts.length })}</span>
              )}
            </div>
            {productsState === 'loading' && <div className="ins-skel" aria-busy="true">{t('insurance.market.loadingProducts')}</div>}
            {productsState === 'error' && (
              <div className="ins-empty">
                <div className="ins-ico sm"><InsIconAlert /></div>
                <b>{t('insurance.market.productsLoadFailed')}</b>
                <button type="button" className="ins-btn ghost small" onClick={() => setProductsNonce((n) => n + 1)}><InsIconRetry /> {t('insurance.unavailable.retry')}</button>
              </div>
            )}
            {productsState === 'ready' && typeProducts.length > 0 && (
              <ModernSelect
                value={productId}
                onChange={(v) => setProductId(String(v))}
                options={productOptions}
                title={t('insurance.market.product')}
                placeholder={t('insurance.market.productPlaceholder')}
                testId="ins-product-select"
              />
            )}
            {productsState === 'ready' && typeProducts.length === 0 && (
              <div className="ins-empty" role="status">
                <div className="ins-ico sm"><InsIconEmpty /></div>
                <b>{products.length === 0 ? t('insurance.market.noProductsForChain') : t('insurance.market.noProductsForType')}</b>
                <p>{t('insurance.market.noProductsHint')}</p>
                {products.length === 0 && chainId !== 1 && (
                  <button type="button" className="ins-btn ghost small" onClick={() => setChainId(1)}>{t('insurance.market.switchToEthereum')}</button>
                )}
              </div>
            )}
            {productsState === 'ready' && typeProducts.length > 0 && !selectedProduct && (
              <p className="ins-hint">{t('insurance.market.productRequiredHint')}</p>
            )}
          </div>
        </div>

        {/* 3 · product details, before the quote */}
        {selectedProduct && (
          <div className="ins-product" data-testid="ins-product-details">
            <div className="ins-product-head">
              <AssetIcon symbol={protocolTicker(selectedProduct.name)} size={44} radius={14} className="asset-icon ins-product-mark" />
              <div className="ins-product-text">
                <div className="ins-product-name">{selectedProduct.name || selectedProduct.label}</div>
                <div className="ins-product-sub">{typeLabel(t, selectedProduct.kind)}{selectedProduct.productTypeName ? ` · ${selectedProduct.productTypeName}` : ''} · {chain.name}</div>
              </div>
              <span className={'ins-chip ' + (selectedProduct.sandbox ? 'SANDBOX' : (selectedProduct.providerStatus || 'LIVE'))}>
                {statusLabel(t, selectedProduct.sandbox ? 'SANDBOX' : (selectedProduct.providerStatus || 'LIVE'))}
              </span>
            </div>

            <div className="ins-kv-grid">
              {productKv.map((row, i) => (
                <div className="ins-kv" key={i}>
                  <span className="k">{row.k}</span>
                  {row.assets ? (
                    <span className="v">
                      {row.assets.map((a) => (
                        <span key={a.assetId ?? a.symbol} className="ins-assets"><AssetIcon symbol={a.symbol} size={18} radius={999} /> {a.symbol}</span>
                      ))}
                    </span>
                  ) : row.code ? (
                    <span className="v"><code>{row.code}</code></span>
                  ) : (
                    <span className="v">{row.v}</span>
                  )}
                </div>
              ))}
            </div>

            {(selectedProduct.termsUrl || selectedProduct.annexUrl) && (
              <div className="ins-links">
                {selectedProduct.termsUrl && <a className="ins-link" href={selectedProduct.termsUrl} target="_blank" rel="noopener noreferrer"><InsIconExternal /> {t('insurance.quote.termsLink')}</a>}
                {selectedProduct.annexUrl && <a className="ins-link" href={selectedProduct.annexUrl} target="_blank" rel="noopener noreferrer"><InsIconExternal /> {t('insurance.quote.annexLink')}</a>}
              </div>
            )}

            {Array.isArray(selectedProduct.exclusions) && selectedProduct.exclusions.length > 0 && (
              <div className="ins-excl">
                <b>{t('insurance.quote.exclusions')}</b>
                <ul>{selectedProduct.exclusions.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}

            <div className="ins-note">
              <InsIconInfo />
              <span>
                {minPct ? `${t('insurance.market.priceNote')} ` : ''}
                {selectedProduct.claimMembershipRequired ? t('insurance.market.membershipRequired') : ''}
                {!minPct && !selectedProduct.claimMembershipRequired ? t('insurance.market.productHint') : ''}
              </span>
            </div>
          </div>
        )}

        {/* 4 · duration + amount */}
        <div className="ins-field">
          <div className="ins-label">
            <span>{t('insurance.market.duration')}</span>
            <span className="ins-label-hint">{t('insurance.market.durationHint')}</span>
          </div>
          <div className="ins-opts grid" role="radiogroup" aria-label={t('insurance.market.duration')}>
            {DURATION_CHOICES.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={Number(duration) === d} className={'ins-opt' + (Number(duration) === d ? ' is-on' : '')} onClick={() => setDuration(String(d))}>
                {d} <small>{t('insurance.market.daysShort')}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="ins-field">
          <div className="ins-label"><span>{t('insurance.market.coverageAmount')}</span></div>
          <label className="ins-amount">
            <span className="ins-amount-cur" aria-hidden="true">$</span>
            <input type="number" inputMode="decimal" min={100} step="100" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('insurance.market.coverageAmount')} />
            <span className="ins-amount-unit">USD</span>
          </label>
          <div className="ins-opts" style={{ marginTop: 8 }}>
            {AMOUNT_CHOICES.map((a) => (
              <button key={a} type="button" className={'ins-opt' + (Number(amount) === a ? ' is-on' : '')} onClick={() => setAmount(String(a))}>${a.toLocaleString('en-US')}</button>
            ))}
          </div>
        </div>

        {/* 5 · terms + CTA */}
        <label className={'ins-terms' + (termsAccepted ? ' is-on' : '')}>
          <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
          <span className="ins-terms-box" aria-hidden="true"><InsIconCheck /></span>
          <span>{t('insurance.market.termsAccept')}</span>
        </label>

        <div className="ins-form-actions">
          <button className="ins-btn ins-cta" disabled={busy || !wallet || needsProduct} onClick={getQuotes}>
            {busy ? t('insurance.market.gettingQuotes') : (<><InsIconSearch /> {t('insurance.market.getQuotes')}</>)}
          </button>
          {needsProduct && wallet && <p className="ins-hint warn">{t('insurance.reason.PRODUCT_REQUIRED')}</p>}
          {!wallet && (
            <div className="ins-wallet-cta">
              <span>{t('insurance.market.needWallet')}</span>
              <Link className="ins-btn ghost small" to="/wallet">{t('insurance.shell.goWallet')}</Link>
            </div>
          )}
        </div>
      </div>

      {/* One honest, fully translated unavailable state */}
      {(err || noLiveQuote) && (
        <div className="ins-state-card">
          <div className="ins-ico lg"><InsIconShield /></div>
          <h2>{errCode === 'NO_ELIGIBLE_PROTECTION' || noLiveQuote ? t('insurance.unavailable.title') : t('insurance.unavailable.titleGeneric')}</h2>
          <p>{t('insurance.unavailable.body')}</p>

          {liveProviders.length === 0 && providers.length > 0 && (
            <div className="ins-state-row">
              <span className="k">{t('insurance.unavailable.providerState')}:</span>
              {providers.filter((p) => p.status !== 'SANDBOX').map((p) => (
                <span key={p.providerId} className="ins-tag">{p.displayName || p.name} · {statusLabel(t, p.enabled && p.status === 'LIVE' ? 'LIVE' : p.status === 'NOT_CONFIGURED' ? 'DISABLED' : p.status)}</span>
              ))}
            </div>
          )}

          {failures.length > 0 && (
            <div className="ins-state-detail">
              <span className="k">{t('insurance.unavailable.detail')}</span>
              {failures.map((f, i) => (
                <div key={i} className="ins-state-detail-row"><span>{providerName(f.providerId)}: {reasonLabel(t, f.reason)}</span></div>
              ))}
            </div>
          )}

          <div className="ins-state-actions">
            <button className="ins-btn ghost small" onClick={getQuotes} disabled={busy || needsProduct}><InsIconRetry /> {t('insurance.unavailable.retry')}</button>
            <Link className="ins-btn ghost small" to="/insurance/providers">{t('insurance.unavailable.providersLink')} <InsIconChevronEnd /></Link>
          </div>
          {sandboxOnly && <p className="ins-muted">{t('insurance.market.sandboxOnlyNote')}</p>}
        </div>
      )}
      {err && !noLiveQuote && !(failures.length || liveProviders.length === 0) ? <InsAlert error={err} /> : null}

      {result && result.length > 0 && (
        <div className="ins-sec-title">
          <span className="ins-ico"><InsIconProtocol /></span>
          {t('insurance.market.compare', { count: result.length })}
        </div>
      )}
      {result?.map((quote) => (
        <div className="ins-card ins-quote-card" key={quote.quoteId}>
          <div className="ins-quote-head">
            <div>
              <div className="ins-quote-provider">{quote.providerName} {quote.sandbox && <span className="ins-tag">{t('insurance.market.sandbox')}</span>}</div>
              <div className="ins-muted">{quote.product?.name ? `${quote.product.name} · ` : ''}{typeLabel(t, quote.protectionType)} · {t('insurance.quote.days', { count: quote.durationDays })}</div>
            </div>
            <span className={'ins-chip ' + (quote.providerHealth || 'HEALTHY')}>{statusLabel(t, quote.providerHealth || 'HEALTHY')}</span>
          </div>
          <div className="ins-quote-stats">
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.market.coverage')}</span><b>${usd(quote.coverageAmountMicro)}</b></div>
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.fee.providerPremium')}</span><b>${quote.premiumUsd}</b></div>
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.fee.fbtFeeShort')}</span><b>${quote.fbtFeeUsd}</b></div>
            <div className="ins-quote-stat acc"><span className="lbl">{t('insurance.fee.total')}</span><b>${quote.totalCostUsd}</b></div>
          </div>
          <div className="ins-row"><span>{t('insurance.market.settlement')}</span><span>{settlementLabel(t, quote.settlementModel)}</span></div>
          <div className="ins-row"><span>{t('insurance.market.claimMethod')}</span><span>{claimLabel(t, quote.claimMethod)}</span></div>
          <div className="ins-row"><span>{t('insurance.market.termsHash')}</span><code>{quote.termsHash?.slice(0, 20)}…</code></div>
          <div className="ins-source">
            <span><span className="k">{t('insurance.source.label')}:</span> {quote.quoteSource === 'provider-api' ? t('insurance.source.providerApi') : quote.quoteSource || 'UNKNOWN'} · {quote.providerName}</span>
            {fmtFresh(quote) && <span><span className="k">{t('insurance.source.updated')}:</span> {fmtFresh(quote)}</span>}
            <span><span className="k">{t('insurance.source.freshness')}:</span> {quote.sandbox ? t('insurance.source.simulated') : t('insurance.source.live')}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="ins-btn" onClick={() => nav(`/insurance/quote/${quote.quoteId}`)}>{t('insurance.market.reviewBuy')} <InsIconChevronEnd /></button>
          </div>
        </div>
      ))}

      {result && result.length === 0 && !err && <div className="ins-ok neutral"><InsIconInfo /><span>{t('insurance.market.noQuoteResult')}</span></div>}
    </div>
  );
}
