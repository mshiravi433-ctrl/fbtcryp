import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import { getFlashLiquidityCapabilities } from '../lib/intentNetwork';
import {
  DEMO_SNAPSHOTS,
  parseFlashIntent,
  planFlashArbitrage,
  createFlashPolicy,
  buildFlashReceipt,
  chainName
} from '../lib/intent-ai/flashLiquidity.js';
import '../styles/flash-liquidity.css';

const INTENT_EXAMPLE_FA = 'با ۰ سرمایه اولیه، هر آربیتراژی که بعد از Gas + Flash Fee حداقل ۰.۵٪ سود دارد اجرا کن';
const INTENT_EXAMPLE_EN = 'Zero initial capital — run any arbitrage netting at least 0.5% profit after gas + flash fee';

/* Demo market lives on Arbitrum (see DEMO_SNAPSHOTS.marketDefaults) whose gas
   token is ETH — the config used to price gas at $0.8/native, which made the
   gas line render as $0.0000 and every economics table look fake. */
const DEMO_CONFIG = {
  gasPriceGwei: 0.01,
  nativePriceUsd: 2500,
  gasUnits: 650000,
  platformFeeBps: 70,
  mevBufferBps: 10,
  slippageBps: 30,
  deadlineSeconds: 60
};

const STEP_TITLES = [
  'collect-prices',
  'find-arbitrage',
  'optimal-size',
  'gas-estimate',
  'flash-fee',
  'slippage',
  'simulation',
  'send-gate',
  'abort-or-emit'
];

function StepRow({ step, t }) {
  const key = `flashLiquidity.steps.${step.id}`;
  return (
    <div className={`fl-step ${step.ok ? 'ok' : 'bad'}`}>
      <span className="fl-step-mark">{step.ok ? '✓' : '✗'}</span>
      <div>
        <strong>{t(key, { defaultValue: step.id })}</strong>
        <small>{step.detail}</small>
      </div>
    </div>
  );
}

function Money({ value, currency = '$', digits = 4 }) {
  const num = Number(value);
  if (!Number.isFinite(num)) return <span>—</span>;
  return <span>{currency}{num.toLocaleString('en-US', { maximumFractionDigits: digits })}</span>;
}

/**
 * FBT Flash Liquidity — فاز ۱۵۲
 * Client-side deterministic planner over clearly-labeled demo snapshots or
 * user-imported ones. Nothing here signs, broadcasts, or holds funds: the
 * pipeline's honest outcome for an unprofitable intent is NO_TRADE — nothing
 * is sent and no gas is spent.
 */
export default function FlashLiquidity() {
  const { t, i18n } = useTranslation();
  const isFa = (i18n.language || 'fa').startsWith('fa');

  const [intentText, setIntentText] = useState(isFa ? INTENT_EXAMPLE_FA : INTENT_EXAMPLE_EN);
  const [scenario, setScenario] = useState('profitable');
  const [customJson, setCustomJson] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [gasPriceGwei, setGasPriceGwei] = useState(DEMO_CONFIG.gasPriceGwei);
  const [minProfitBps, setMinProfitBps] = useState(50);
  const [plan, setPlan] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [serverStatus, setServerStatus] = useState(undefined);
  const resultRef = useRef(null);

  /* `undefined` = still asking, `null` = unreachable, object = answered.
     Only the answered state claims anything about the server. */
  useEffect(() => {
    let alive = true;
    getFlashLiquidityCapabilities()
      .then((caps) => { if (alive) setServerStatus(caps); })
      .catch(() => { if (alive) setServerStatus(null); });
    return () => { alive = false; };
  }, []);

  const parsedIntent = useMemo(() => parseFlashIntent(intentText), [intentText]);

  const snapshots = useMemo(() => {
    const now = Date.now();
    if (useCustom) {
      try {
        const rows = JSON.parse(customJson);
        if (Array.isArray(rows)) return rows.map((r) => ({ ...r, observedAtMs: Number(r.observedAtMs) || now }));
      } catch { /* fall through to demo */ }
      return DEMO_SNAPSHOTS.sets[scenario].map((s) => ({ ...s, observedAtMs: now }));
    }
    return DEMO_SNAPSHOTS.sets[scenario].map((s) => ({ ...s, observedAtMs: now }));
  }, [scenario, useCustom, customJson]);

  const market = useMemo(() => ({
    chainId: DEMO_SNAPSHOTS.marketDefaults.chainId,
    asset: DEMO_SNAPSHOTS.marketDefaults.asset,
    assetDecimals: DEMO_SNAPSHOTS.marketDefaults.assetDecimals,
    assetPriceUsd: DEMO_SNAPSHOTS.marketDefaults.assetPriceUsd,
    nativePriceUsd: DEMO_CONFIG.nativePriceUsd,
    snapshots
  }), [snapshots]);

  const runPipeline = useCallback(() => {
    setReceipt(null);
    const intent = parsedIntent.ok
      ? parsedIntent
      : { ok: true, kind: 'flash-arbitrage', initialCapital: 0, minNetProfitBps: minProfitBps, atomic: true, settlement: 'same-transaction' };
    const effectiveIntent = { ...intent, minNetProfitBps: intent.minNetProfitBps ?? minProfitBps };
    const policy = createFlashPolicy({ minNetProfitBps: effectiveIntent.minNetProfitBps });
    const result = planFlashArbitrage({
      intent: effectiveIntent,
      market,
      config: {
        ...DEMO_CONFIG,
        gasPriceGwei: Number(gasPriceGwei) > 0 ? Number(gasPriceGwei) : DEMO_CONFIG.gasPriceGwei
      },
      policy,
      context: { now: Date.now(), attemptsToday: 0 }
    });
    setPlan(result);
    /* The result lands below the fold on a phone — scroll it into view so a
       tap on «run» never looks like a dead button. */
    requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [parsedIntent, minProfitBps, market, gasPriceGwei]);

  const makeReceipt = useCallback((outcome) => {
    if (!plan || !plan.economics) return;
    const built = buildFlashReceipt({
      plan,
      outcome,
      netProfitUsd: outcome === 'profit-realized' ? plan.economics.netProfitUsd : 0,
      txHash: null
    });
    if (built.ok) setReceipt(built.receipt);
  }, [plan]);

  const decision = plan?.decision;
  const bannerClass = decision === 'EXECUTE_READY'
    ? 'fl-banner ready'
    : decision === 'GATED'
      ? 'fl-banner gated'
      : 'fl-banner no-trade';

  return (
    <PageTransition>
      <div className="page fl-page">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="fl-hero" style={riseIn}>
          <div className="fl-kicker">FBT · Flash Liquidity · Phase 152</div>
          <h1>{t('flashLiquidity.title', { defaultValue: 'فلش لیکوییدیتی — آربیتراژ بدون وثیقه' })}</h1>
          <p className="fl-sub">
            {t('flashLiquidity.subtitle', {
              defaultValue: 'وام فلاش پول رایگان نیست: اصل + کارمزد باید در همان تراکنش برگردد؛ وگرنه همه‌چیز revert می‌شود و گاز از دست می‌رود. این صفحه فقط برنامه‌ریز و داور است — هیچ تراکنشی از اینجا ارسال نمی‌شود.'
            })}
          </p>
          <div className="fl-badges">
            <span className="fl-badge">{t('flashLiquidity.badges.atomic', { defaultValue: 'اتمیک در همان تراکنش' })}</span>
            <span className="fl-badge warn">{t('flashLiquidity.badges.noFreeMoney', { defaultValue: 'نه پول رایگان، نه سود تضمینی' })}</span>
            <span className="fl-badge">{t('flashLiquidity.badges.mev', { defaultValue: 'ارسال فقط از مسیر خصوصی' })}</span>
            <span className="fl-badge audit">{t('flashLiquidity.badges.audit', { defaultValue: 'نیازمند قرارداد ممیزی‌شده' })}</span>
          </div>
        </section>

        {/* ── Intent composer ──────────────────────────────────────────── */}
        <section className="fl-panel fl-intent" style={riseIn}>
          <h2>{t('flashLiquidity.intent.title', { defaultValue: '۱) اینتنت را بنویس' })}</h2>
          <textarea
            className="fl-textarea"
            value={intentText}
            onChange={(e) => setIntentText(e.target.value)}
            rows={3}
            dir="auto"
            aria-label={t('flashLiquidity.intent.title', { defaultValue: 'اینتنت' })}
          />
          <div className="fl-chips">
            <span className={`fl-chip ${parsedIntent.ok ? 'ok' : 'bad'}`}>
              {parsedIntent.ok
                ? t('flashLiquidity.intent.parsed', { defaultValue: 'اینتنت معتبر' })
                : t('flashLiquidity.intent.invalid', { defaultValue: 'اینتنت فلش لان تشخیص داده نشد' })}
            </span>
            {parsedIntent.ok && (
              <>
                <span className="fl-chip ok">{t('flashLiquidity.intent.zeroCapital', { defaultValue: 'سرمایه اولیه: ۰' })}</span>
                <span className="fl-chip ok">
                  {t('flashLiquidity.intent.minProfit', { defaultValue: 'حداقل سود خالص' })}: {(parsedIntent.minNetProfitBps / 100).toFixed(2)}%
                </span>
                <span className="fl-chip ok">{t('flashLiquidity.intent.atomic', { defaultValue: 'تسویه: همان تراکنش' })}</span>
                {parsedIntent.chainId && <span className="fl-chip">{chainName(parsedIntent.chainId)}</span>}
                {parsedIntent.asset && <span className="fl-chip">{parsedIntent.asset}</span>}
              </>
            )}
          </div>
          {!parsedIntent.ok && (
            <p className="fl-hint">
              {t('flashLiquidity.intent.fallback', { defaultValue: 'با اینتنت نامعتبر، حداقل سود پایین‌نویسی‌شده زیر به‌کار می‌رود.' })}
              {' '}
              <input
                type="number"
                className="fl-number"
                min="10"
                max="5000"
                value={minProfitBps}
                onChange={(e) => setMinProfitBps(Number(e.target.value) || 50)}
              />
              <span> bps</span>
            </p>
          )}
        </section>

        {/* ── Market data (educational demo) ───────────────────────────── */}
        <section className="fl-panel fl-market" style={riseIn}>
          <h2>{t('flashLiquidity.market.title', { defaultValue: '۲) داده بازار (نمونه آموزشی)' })}</h2>
          <p className="fl-demo-note">
            {t('flashLiquidity.market.demoNote', {
              defaultValue: 'سناریوهای زیر داده زنده نیستند — reserve های ساختگی برای آموزش ریاضی خط لوله‌اند. تا وقتی snapshot واقعی وصل نشود، هر «سود» اینجا فقط تمرین است.'
            })}
          </p>
          <div className="fl-seg">
            {[
              ['profitable', t('flashLiquidity.market.profitable', { defaultValue: 'فرصت سودده' })],
              ['flat', t('flashLiquidity.market.flat', { defaultValue: 'قیمت‌های برابر' })],
              ['inverted', t('flashLiquidity.market.inverted', { defaultValue: 'اسپرد منفی' })]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`fl-seg-btn ${!useCustom && scenario === id ? 'active' : ''}`}
                onClick={() => { setScenario(id); setUseCustom(false); }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`fl-seg-btn ${useCustom ? 'active' : ''}`}
              onClick={() => setUseCustom(true)}
            >
              {t('flashLiquidity.market.custom', { defaultValue: 'JSON خودم' })}
            </button>
          </div>
          {useCustom && (
            <textarea
              className="fl-textarea mono"
              rows={5}
              dir="ltr"
              placeholder='[{"venueId":"dex-a","reserveA":"2500000000000","reserveB":"2500000000","feeBps":30,"observedAtMs":0}]'
              value={customJson}
              onChange={(e) => setCustomJson(e.target.value)}
            />
          )}
          <label className="fl-field">
            <span>{t('flashLiquidity.market.gasPrice', { defaultValue: 'قیمت گاز (gwei)' })}</span>
            <input
              type="number"
              step="0.001"
              min="0.001"
              className="fl-number"
              value={gasPriceGwei}
              onChange={(e) => setGasPriceGwei(e.target.value)}
            />
          </label>
          <button type="button" className="fl-run" onClick={runPipeline}>
            {t('flashLiquidity.run', { defaultValue: 'اجرا — شبیه‌سازی خط لوله ۹ مرحله‌ای' })}
          </button>
        </section>

        {/* ── Server deployment status: a quiet note, not an error box.
               The planner runs fully client-side; this strip only says what
               the optional deployment reports, and never blocks the lab. ── */}
        {serverStatus !== undefined && (
          <div className="fl-server" role="status" style={riseIn}>
            <span className={`fl-server-dot ${serverStatus ? '' : 'off'}`} aria-hidden="true" />
            <span>
              {t('flashLiquidity.server.status', { defaultValue: 'وضعیت استقرار (سرور)' })}:
              {' '}
              {serverStatus ? <code>{serverStatus.status}</code> : t('flashLiquidity.server.offlineShort', { defaultValue: 'در دسترس نیست' })}
            </span>
            {serverStatus?.missing?.length > 0 && (
              <span className="fl-server-missing">{serverStatus.missing.join(' · ')}</span>
            )}
            <span>
              {t('flashLiquidity.server.localNote', { defaultValue: 'برنامه‌ریز همین‌جا روی دستگاه اجرا می‌شود؛ سرور فقط گزارش وضعیت است.' })}
            </span>
          </div>
        )}

        {/* ── Pipeline result ─────────────────────────────────────────── */}
        {plan && (
          <section className="fl-panel fl-result" ref={resultRef} style={riseIn}>
            <div className={bannerClass}>
              {decision === 'EXECUTE_READY' && t('flashLiquidity.decision.ready', { defaultValue: 'آمادهٔ امضا — هنوز شبیه‌سازی زنده + امضای کیف پول لازم است' })}
              {decision === 'GATED' && t('flashLiquidity.decision.gated', { defaultValue: 'متوقف شد — گیت‌های ایمنی هنوز کامل نیستند' })}
              {decision === 'NO_TRADE' && t('flashLiquidity.decision.noTrade', { defaultValue: 'معامله‌ای ارسال نشد — سود خالص کافی نبود' })}
              {(!decision || decision === 'BLOCKED') && t('flashLiquidity.decision.blocked', { defaultValue: 'مسدود شد — ' }) + (plan.reasons || []).concat(plan.code ? [plan.code] : []).join(', ')}
            </div>

            {plan.reasons?.length > 0 && (
              <ul className="fl-reasons">
                {plan.reasons.map((r) => <li key={r}><code>{r}</code></li>)}
              </ul>
            )}

            <h3>{t('flashLiquidity.pipeline.title', { defaultValue: 'خط لوله ۹ مرحله‌ای' })}</h3>
            <div className="fl-steps">
              {STEP_TITLES.map((id) => {
                const step = plan.steps?.find((s) => s.id === id);
                return step ? <StepRow key={id} step={step} t={t} /> : null;
              })}
            </div>

            {plan.provider && (
              <div className="fl-provider">
                <h3>{t('flashLiquidity.provider.title', { defaultValue: 'منبع فلش لان' })}</h3>
                <div className="fl-provider-grid">
                  <div><strong>{plan.provider.label}</strong><small>{plan.provider.entryFunction}()</small></div>
                  <div><small>{t('flashLiquidity.provider.premium', { defaultValue: 'کارمزد فلش' })}</small><code>{plan.provider.premiumBps} bps</code></div>
                  <div><small>{t('flashLiquidity.provider.source', { defaultValue: 'قرارداد منبع' })}</small><code className="mono">{plan.provider.sourceAddress || '—'}</code></div>
                  <div><small>{t('flashLiquidity.provider.verified', { defaultValue: 'آدرس تأییدشده' })}</small><code>{plan.provider.sourceVerified ? '✓' : '✗'}</code></div>
                </div>
              </div>
            )}

            {plan.economics && (
              <div className="fl-econ">
                <h3>{t('flashLiquidity.economics.title', { defaultValue: 'حساب‌وکتاب سود (تخمینی)' })}</h3>
                <table className="fl-table">
                  <tbody>
                    <tr><td>{t('flashLiquidity.economics.loan', { defaultValue: 'حجم وام' })}</td><td className="mono">{plan.economics.loanUsd?.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD</td></tr>
                    <tr><td>{t('flashLiquidity.economics.gross', { defaultValue: 'سود ناخالص (بعد از کارمزد فلش)' })}</td><td className="mono pos"><Money value={plan.economics.grossProfitUsd} /></td></tr>
                    <tr><td>{t('flashLiquidity.economics.gas', { defaultValue: 'گاز' })}</td><td className="mono neg">-<Money value={plan.economics.gasUsd} digits={4} /></td></tr>
                    <tr><td>{t('flashLiquidity.economics.platform', { defaultValue: 'کارمزد پلتفرم ({{bps}} bps)', bps: plan.economics.platformFeeBps })}</td><td className="mono neg">-<Money value={plan.economics.platformFeeUsd} digits={4} /></td></tr>
                    <tr><td>{t('flashLiquidity.economics.mev', { defaultValue: 'حفاظ MEV' })}</td><td className="mono neg">-<Money value={plan.economics.mevBufferUsd} digits={4} /></td></tr>
                    <tr className="fl-total"><td>{t('flashLiquidity.economics.net', { defaultValue: 'سود خالص' })}</td><td className={`mono ${plan.economics.netProfitUsd > 0 ? 'pos' : 'neg'}`}><Money value={plan.economics.netProfitUsd} /></td></tr>
                    <tr><td>{t('flashLiquidity.economics.netBps', { defaultValue: 'سود خالص نسبت به وام' })}</td><td className="mono">{plan.economics.netProfitBps?.toFixed(2)} bps</td></tr>
                  </tbody>
                </table>
                <p className="fl-hint">{t('flashLiquidity.economics.estimateNote', { defaultValue: 'این عددها از reserveهای نشان‌داده‌شده محاسبه شده‌اند — تخمین‌اند، نه قول. در اجرای واقعی، چک on-chain سود، به‌جای معامله زیان‌ده کل تراکنش را revert می‌کند.' })}</p>
              </div>
            )}

            {plan.route && (
              <div className="fl-route">
                <h3>{t('flashLiquidity.route.title', { defaultValue: 'مسیر و slippage' })}</h3>
                <ol className="fl-hops">
                  {plan.route.hops.map((hop, i) => (
                    <li key={i}>
                      <code>{hop.assetIn} → {hop.assetOut}</code>
                      <small>minOut: {hop.minOut} · fee {hop.feeBps}bps</small>
                    </li>
                  ))}
                </ol>
                <small>{t('flashLiquidity.route.revertPolicy', { defaultValue: 'سیاست revert: abort-all — هر hop خراب، کل تراکنش را برمی‌گرداند.' })}</small>
              </div>
            )}

            <div className="fl-actions">
              <button type="button" className="fl-ghost" onClick={() => makeReceipt('not-sent')}>
                {t('flashLiquidity.receipt.notSent', { defaultValue: 'رسید «ارسال نشد» بساز' })}
              </button>
              {decision === 'EXECUTE_READY' && (
                <button type="button" className="fl-ghost" onClick={() => makeReceipt('reverted-no-profit')}>
                  {t('flashLiquidity.receipt.simulatedRevert', { defaultValue: 'رسید «revert در شبیه‌سازی» بساز' })}
                </button>
              )}
            </div>

            {receipt && (
              <div className="fl-receipt">
                <h3>{t('flashLiquidity.receipt.title', { defaultValue: 'رسید اثبات اجرا (شبیه‌سازی)' })}</h3>
                <pre className="mono" dir="ltr">{JSON.stringify(receipt, null, 2)}</pre>
                <small>{t('flashLiquidity.receipt.note', { defaultValue: 'اثم انگشت محتواست، نه امضای رمزنگارانه؛ مسیر اثبات رسمی همان Proof-of-Execution است.' })}</small>
              </div>
            )}
          </section>
        )}

        {/* ── Guarantees panel ─────────────────────────────────────────── */}
        <section className="fl-panel fl-guarantees" style={riseIn}>
          <h2>{t('flashLiquidity.guarantees.title', { defaultValue: 'چه چیزی قطعی است و چه چیزی نیست' })}</h2>
          <ul>
            <li>✓ {t('flashLiquidity.guarantees.atomic', { defaultValue: 'کل عملیات در یک تراکنش است: کمبود بازپرداخت = revert کامل.' })}</li>
            <li>✓ {t('flashLiquidity.guarantees.noTrade', { defaultValue: 'اگر سود خالص بعد از گاز + کارمزد فلش + کارمزد پلتفرم زیر حد اینتنت باشد، هیچ تراکنشی ساخته نمی‌شود.' })}</li>
            <li>✓ {t('flashLiquidity.guarantees.wallet', { defaultValue: 'اجرای واقعی فقط با امضای صریح کیف پول شما و شبیه‌سازی موفق انجام می‌شود.' })}</li>
            <li>✗ {t('flashLiquidity.guarantees.notGuaranteed', { defaultValue: 'هیچ سودی تضمین نیست؛ همه اعداد از داده‌های نشان‌دار (indicative) می‌آیند.' })}</li>
            <li>✗ {t('flashLiquidity.guarantees.noFreeMoney', { defaultValue: 'فلش لان اعتبار قابل خرج کردن نیست؛ فقط سرمایهٔ موقت داخل یک تراکنش است.' })}</li>
            <li>✗ {t('flashLiquidity.guarantees.noPublicMempool', { defaultValue: 'ارسال به ممپول عمومی برای آربیتراژ رد می‌شود (ریسک سندویچ)؛ فقط مسیر خصوصی.' })}</li>
          </ul>
          <p className="fl-hint">{t('flashLiquidity.guarantees.auditNote', { defaultValue: 'قرارداد مرجع FlashLiquidityRouter.sol کامپایل و باندل شده، اما مستقل ممیزی نشده است. تا پیش از ممیزی و پیکربندی آدرس، این قابلیت در وضعیت planning-only می‌ماند.' })}</p>
        </section>
      </div>
    </PageTransition>
  );
}
