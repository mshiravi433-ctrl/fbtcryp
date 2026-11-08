/**
 * AI OPPORTUNITY ENGINE — the room
 * ---------------------------------------------------------------------------
 * «در موتور فرصت هوش مصنوعی باید اینها داشته باشد … و ظاهر باید مدرن باشد و
 *  برای هر فرصت دکمه بازکردن باشد»
 *
 * Four rooms, one scan:
 *
 *   برترین‌ها (Top)          ranked cards, each with its own open button
 *   شخصی‌سازی‌شده (Mine)     the same rows filtered to the user's capital,
 *                            active networks and risk appetite — with the
 *                            personalisation inputs visible and editable
 *   اسکنر هوشمند (Scanner)   what the engine just discovered, why it matched,
 *                            and whether it was eligible or excluded
 *   پوشش (Coverage)          which sources answered — so an empty tab reads as
 *                            "we looked and found nothing", not "broken"
 *
 * ─── PERSONALISATION IS NOT A MYSTERY ───────────────────────────────────────
 * The header shows the four inputs the ranking actually uses — wallet value,
 * spendable capital, active networks and risk appetite — and lets the user
 * change the two that are theirs to decide (capital and appetite). Everything
 * else is measured. A recomputed scan follows the change; the rows underneath
 * are re-priced, not re-guessed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition.jsx';
import {
  IconRefresh, IconSparkle, IconWallet, IconShield, IconSearch, IconGlobe
} from '../components/Icons.jsx';
import SectionGuard from '../components/SectionGuard.jsx';
import OpportunityCard from '../components/opportunity/OpportunityCard.jsx';
import { text as label, sanitizeScannerRow } from '../lib/opportunity/sanitize.js';
import {
  CATEGORIES, categoryLabel, money, num, timeAgo, isFa, exclusionText
} from '../components/opportunity/ui.jsx';
import { RISK_PROFILES, riskProfileNote } from '../lib/opportunity/feed.js';
import { useOpportunityEngine } from '../hooks/useOpportunityEngine.js';
import '../styles/opportunity-engine.css';

const TABS = [
  { id: 'top', fa: 'برترین‌ها', en: 'Top', Icon: IconSparkle },
  { id: 'mine', fa: 'شخصی‌سازی‌شده', en: 'For me', Icon: IconWallet },
  { id: 'scanner', fa: 'اسکنر هوشمند', en: 'AI scanner', Icon: IconSearch },
  { id: 'coverage', fa: 'پوشش منابع', en: 'Coverage', Icon: IconGlobe }
];

export default function Opportunities() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const locale = i18n.language?.startsWith('fa') ? 'fa' : 'en';
  const fa = isFa(locale);

  const engine = useOpportunityEngine({ enabled: true, autoScan: true });
  const { scan, capital, riskProfile, setRiskProfile, loading, error, refresh } = engine;

  const [tab, setTab] = useState(() => {
    const want = params.get('tab');
    return TABS.some((t) => t.id === want) ? want : 'top';
  });
  const [cat, setCat] = useState('ALL');
  const [showExcluded, setShowExcluded] = useState(false);
  const [capitalDraft, setCapitalDraft] = useState('');
  const [editingCapital, setEditingCapital] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (tab === 'top') next.delete('tab'); else next.set('tab', tab);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [tab, params, setParams]);

  const open = useCallback((to) => { if (to) navigate(to); }, [navigate]);
  const openExternal = useCallback((href) => {
    if (!href) return;
    try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
  }, []);
  const openDetails = useCallback((id) => { if (id) navigate(`/opportunities/${encodeURIComponent(id)}`); }, [navigate]);

  const accepted = scan?.opportunities ?? [];
  const rejected = scan?.rejected ?? [];

  const filtered = useMemo(() => {
    const rows = showExcluded ? rejected : accepted;
    if (cat === 'ALL') return rows;
    return rows.filter((r) => r.category === cat);
  }, [accepted, rejected, cat, showExcluded]);

  /* "For me" is not a second scan — it is the same ranking read against the
     personalisation inputs, so the two tabs can never disagree about a number. */
  const mine = useMemo(() => accepted.filter((o) => {
    if (o.risk?.score != null && scan?.profile?.riskTolerance != null && o.risk.score > scan.profile.riskTolerance) return false;
    const chain = String(o.chain || '').toLowerCase();
    const active = (capital?.activeChains || []).map((c) => String(c).toLowerCase());
    if (!chain) return true;
    return active.length === 0 || active.includes(chain);
  }), [accepted, scan, capital]);

  const counts = scan?.byCategory || {};
  const candidateCount = useMemo(
    () => (scan?.coverage || []).reduce((sum, c) => sum + (c.rows || 0), 0),
    [scan]
  );

  const submitCapital = (event) => {
    event.preventDefault();
    const amount = Number(capitalDraft);
    engine.setManualCapital(Number.isFinite(amount) && amount >= 0 ? amount : null);
    setEditingCapital(false);
    setCapitalDraft('');
    void refresh({ capital: Number.isFinite(amount) && amount >= 0 ? { ...capital, investableUsd: amount, capitalStatus: 'manual' } : undefined });
  };

  const statusLabel = scan?.dataStatus === 'live'
    ? (fa ? 'اسکن زنده' : 'Live scan')
    : scan ? (fa ? 'داده محدود' : 'Limited data') : (fa ? 'در انتظار اسکن' : 'Waiting for scan');

  return (
    <PageTransition>
      <div className="oep" dir={fa ? 'rtl' : 'ltr'} data-testid="opportunities-page">
        {/* ─── HERO + PERSONALISATION ─────────────────────────────────── */}
        <section className="oep-hero">
          <div className="oep-hero-top">
            <div>
              <span className="oep-eyebrow">
                <span className="oep-eyebrow-dot" />
                FBT AI · OPPORTUNITY ENGINE
              </span>
              <h1 className="oep-title">
                {fa ? 'موتور فرصت ' : 'The '}
                <span className="oep-title-grad">{fa ? 'هوش مصنوعی' : 'opportunity engine'}</span>
              </h1>
              <p className="oep-sub">
                {fa
                  ? 'فرصت‌ها بر پایه موجودی کیف پول، شبکه‌های فعال، سرمایه قابل استفاده و ریسک‌پذیری شما رتبه‌بندی می‌شوند؛ هر عدد با کارمزد، لغزش و گس تعدیل می‌شود.'
                  : 'Ranked by your wallet balance, active networks, spendable capital and risk appetite — every number net of fees, slippage and gas.'}
              </p>
            </div>
            <div className="oep-hero-actions">
              <button
                type="button"
                className={`oep-icon-btn${loading ? ' is-spinning' : ''}`}
                onClick={() => refresh()}
                disabled={loading}
                aria-label={fa ? 'اسکن دوباره' : 'Rescan'}
                title={fa ? 'اسکن دوباره' : 'Rescan'}
              >
                <IconRefresh width={16} height={16} />
              </button>
            </div>
          </div>

          <div className="oep-persona">
            <div className="oep-persona-cell">
              <small>{fa ? 'کیف پول' : 'Wallet'}</small>
              <b className={capital?.capitalStatus === 'live' ? 'is-accent' : capital?.capitalStatus === 'partial' ? 'is-warn' : ''}>
                {capital?.connected ? money(capital.totalValue) : (fa ? 'وصل نیست' : 'Not connected')}
              </b>
              <small style={{ marginTop: 4 }}>
                {capital?.connected
                  ? (capital.capitalStatus === 'live' ? (fa ? 'خوانده‌شده همین حالا' : 'read just now')
                    : capital.capitalStatus === 'partial' ? (fa ? 'خواندن ناقص' : 'partial read') : '')
                  : (fa ? 'اسکن با سرمایه دستی' : 'scan with manual capital')}
              </small>
            </div>
            <div className="oep-persona-cell">
              <small>{fa ? 'سرمایه قابل استفاده' : 'Spendable capital'}</small>
              {editingCapital ? (
                <form className="oep-capital-edit" onSubmit={submitCapital}>
                  <input
                    autoFocus
                    inputMode="decimal"
                    placeholder={String(Math.round(capital?.investableUsd || 0))}
                    value={capitalDraft}
                    onChange={(e) => setCapitalDraft(e.target.value.replace(/[^\d.]/g, ''))}
                    aria-label={fa ? 'سرمایه قابل استفاده' : 'Spendable capital'}
                  />
                  <button type="submit">{fa ? 'ثبت' : 'Set'}</button>
                </form>
              ) : (
                <b className="is-accent" role="button" tabIndex={0}
                  onClick={() => { setEditingCapital(true); setCapitalDraft(String(Math.round(capital?.investableUsd || 0))); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingCapital(true); setCapitalDraft(String(Math.round(capital?.investableUsd || 0))); } }}
                  title={fa ? 'برای تغییر سرمایه کلیک کنید' : 'Tap to change capital'}
                  style={{ cursor: 'pointer' }}
                >
                  {money(capital?.investableUsd)}
                </b>
              )}
              <small style={{ marginTop: 4 }}>
                {fa ? `${money(capital?.stableInvestableUsd)} نقد آماده` : `${money(capital?.stableInvestableUsd)} liquid`}
              </small>
            </div>
            <div className="oep-persona-cell">
              <small>{fa ? 'شبکه‌های فعال' : 'Active networks'}</small>
              <b>{capital?.chainCount ? num(capital.chainCount) : '—'}</b>
              <small style={{ marginTop: 4 }}>
                {capital?.activeChains?.length
                  ? capital.activeChains.slice(0, 3).map((c) => c.replace(/^\w/, (x) => x.toUpperCase())).join(' · ')
                  : (fa ? 'شبکه‌ای شناسایی نشد' : 'none detected')}
              </small>
            </div>
            <div className="oep-persona-cell">
              <small>{fa ? 'ریسک‌پذیری' : 'Risk appetite'}</small>
              <b>{riskProfileNote(riskProfile, fa).slice(0, 22)}</b>
              <small style={{ marginTop: 4 }}>
                {scan?.profile?.riskTolerance != null
                  ? (fa ? `سقف ریسک ${Number(scan.profile.riskTolerance).toFixed(1)} از ۱۰` : `risk ceiling ${Number(scan.profile.riskTolerance).toFixed(1)} / 10`)
                  : '—'}
              </small>
            </div>
          </div>

          <div className="oep-risk-rail" role="group" aria-label={fa ? 'ریسک‌پذیری' : 'Risk appetite'}>
            {RISK_PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                className="oep-risk-pill"
                aria-pressed={riskProfile === p.id}
                onClick={() => { setRiskProfile(p.id); void refresh({ riskProfile: p.id }); }}
              >
                {fa ? p.fa : p.en}
              </button>
            ))}
          </div>

          {!capital?.connected ? (
            <p className="oep-notice">
              <IconWallet width={13} height={13} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />
              {fa
                ? 'کیف پول وصل نیست؛ اسکن با سرمایه‌ای که وارد می‌کنید انجام می‌شود. ارزش کل کیف پول هرگز به‌عنوان سرمایه آزاد فرض نمی‌شود.'
                : 'No wallet is connected, so the scan uses the capital you enter. Total wallet value is never assumed to be free capital.'}
            </p>
          ) : capital?.capitalStatus !== 'live' ? (
            <p className="oep-notice">
              {fa
                ? 'قیمت‌ها کامل زنده نیستند؛ سرمایه نمایش‌داده‌شده کران پایین است.'
                : 'Prices are not fully live; the capital shown is a lower bound.'}
            </p>
          ) : null}
        </section>

        {/* ─── TABS ───────────────────────────────────────────────────── */}
        <div className="oep-tabs" role="tablist" aria-label={fa ? 'بخش‌های موتور فرصت' : 'Opportunity rooms'}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="oep-tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <t.Icon width={14} height={14} />
              {fa ? t.fa : t.en}
              {t.id === 'top' ? <span className="oep-tab-count">{accepted.length}</span> : null}
              {t.id === 'mine' ? <span className="oep-tab-count">{mine.length}</span> : null}
              {t.id === 'scanner' ? <span className="oep-tab-count">{scan?.scanner?.length ?? 0}</span> : null}
            </button>
          ))}
        </div>

        {error ? <div className="oep-empty">{fa ? 'اسکن انجام نشد؛ دوباره تلاش کنید.' : 'The scan failed. Try again.'}</div> : null}

        {/* ─── TOP / MINE ─────────────────────────────────────────────── */}
        {(tab === 'top' || tab === 'mine') ? (
          <>
            <div className="oep-chips">
              <button type="button" className="oep-chip" aria-pressed={cat === 'ALL'} onClick={() => setCat('ALL')}>
                {fa ? 'همه' : 'All'} <span className="oep-tab-count">{showExcluded ? rejected.length : accepted.length}</span>
              </button>
              {CATEGORIES.map((c) => {
                const count = counts[c.id] || 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="oep-chip"
                    aria-pressed={cat === c.id}
                    onClick={() => setCat(cat === c.id ? 'ALL' : c.id)}
                  >
                    <span className="oep-chip-dot" style={{ background: `var(--rgb-${c.id === 'LIQUIDITY_POOL' ? 1 : c.id === 'FARMING' ? 4 : c.id === 'LENDING' ? 2 : c.id === 'ARBITRAGE' ? 5 : 3})` }} />
                    {fa ? c.fa : c.en}
                    {count ? <span style={{ opacity: 0.7 }}>{count}</span> : null}
                  </button>
                );
              })}
              <button
                type="button"
                className="oep-chip"
                aria-pressed={showExcluded}
                onClick={() => setShowExcluded((v) => !v)}
              >
                <IconShield width={11} height={11} />
                {fa ? 'خارج از معیار' : 'Excluded'} <span style={{ opacity: 0.7 }}>{rejected.length}</span>
              </button>
            </div>

            {tab === 'mine' ? (
              <p className="oep-footnote" style={{ borderTop: 0, paddingTop: 0 }}>
                {fa
                  ? `فقط فرصت‌هایی که ریسکشان زیر سقف پروفایل شماست و روی شبکه‌های فعال‌تان هستند. ${candidateCount} مورد از منابع متصل بررسی شد.`
                  : `Only rows under your risk ceiling, on networks you are already using. ${candidateCount} candidates were scanned from connected feeds.`}
              </p>
            ) : null}

            {loading && !filtered.length ? (
              <div className="oep-grid">
                <div className="oep-skeleton" /><div className="oep-skeleton" /><div className="oep-skeleton" />
              </div>
            ) : filtered.length ? (
              <div className="oep-grid">
                {/* ONE CARD IS GUARDED ON ITS OWN.
                    A row whose shape this build has never seen used to throw
                    inside the card and take the ENTIRE route to «این صفحه به
                    مشکل خورد» — the reported bug. The engine and the cache now
                    normalise every drawn field (lib/opportunity/sanitize.js),
                    and this guard is the backstop: a fault that still gets
                    through hides THAT card and heals on the next scan
                    (`resetKey`), so one bad row can never blank eighty good
                    ones again. */}
                {filtered.map((o) => (
                  <SectionGuard key={o.opportunityId} resetKey={`${o.opportunityId}:${o.score ?? ''}:${scan?.scannedAt ?? ''}`}>
                    <OpportunityCard
                      opportunity={o}
                      locale={locale}
                      excluded={showExcluded}
                      onOpen={open}
                      onExternal={openExternal}
                      onDetails={openDetails}
                    />
                  </SectionGuard>
                ))}
              </div>
            ) : (
              <div className="oep-empty">
                {showExcluded
                  ? (fa ? 'هیچ موردی خارج از معیارهای شما نیست.' : 'Nothing is excluded under your current criteria.')
                  : (fa
                    ? (cat === 'ALL'
                      ? 'در این اسکن فرصتی که با سرمایه و ریسک‌پذیری شما جور باشد پیدا نشد. سرمایه یا ریسک‌پذیری را تغییر دهید یا دوباره اسکن کنید.'
                      : 'در این دسته موردی برای نمایش نیست؛ به تب پوشش منابع نگاه کنید.')
                    : (cat === 'ALL'
                      ? 'No opportunity matched your capital and risk appetite in this scan. Change either, or rescan.'
                      : 'Nothing in this category. Check the coverage tab.'))}
              </div>
            )}
          </>
        ) : null}

        {/* ─── AI SCANNER ─────────────────────────────────────────────── */}
        {tab === 'scanner' ? (
          <>
            <p className="oep-footnote" style={{ borderTop: 0, paddingTop: 0 }}>
              {fa
                ? 'موتور همین حالا این موارد را کشف کرده است؛ هر ردیف دلیل شناسایی و وضعیت بررسی خودش را دارد.'
                : 'What the engine has just discovered — each row carries the reason it matched and its review status.'}
            </p>
            {scan?.scanner?.length ? (
              <div className="oep-scan-feed">
                {scan.scanner.map((item) => {
                  /* The scanner room draws a row's title, chain and first reason
                     straight into the page, so they are put through the same
                     sanitiser the cards use — a feed (or an old cached scan)
                     that hands back an object here would otherwise throw during
                     render and take the route with it. */
                  const row = sanitizeScannerRow(item);
                  if (!row) return null;
                  const reason = row.reasons?.[0]?.detail ? label(row.reasons[0].detail, 200) : null;
                  return (
                    <div key={row.opportunityId} className="oep-scan-row">
                      <span className="oep-scan-kind">
                        <IconSparkle width={13} height={13} />
                      </span>
                      <div className="oep-scan-body">
                        <strong>{row.title || '—'}</strong>
                        <p>
                          {categoryLabel(row.category, locale)}
                          {row.chain ? ` · ${row.chain}` : ''}
                          {reason ? ` — ${reason}` : ''}
                        </p>
                        <p style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className={`oep-status-pill ${row.eligible ? 'is-live' : 'is-empty'}`}>
                            {row.eligible ? (fa ? 'واجد شرایط' : 'Eligible') : (fa ? 'بررسی‌شده / خارج' : 'Reviewed / excluded')}
                          </span>
                          {row.exclusionCodes?.length ? (
                            <span style={{ fontSize: 10, opacity: 0.8 }}>
                              {exclusionText(label(row.exclusionCodes[0], 60), locale)}
                            </span>
                          ) : null}
                          <span className="oep-scan-when">{timeAgo(row.discoveredAt, locale)}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="oep-detail-btn"
                        onClick={() => openDetails(row.opportunityId)}
                        aria-label={fa ? 'تحلیل عمیق' : 'Deep analysis'}
                        title={fa ? 'تحلیل عمیق' : 'Deep analysis'}
                      >
                        <IconSearch width={14} height={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="oep-empty">{fa ? 'اسکنر هنوز موردی کشف نکرده است.' : 'The scanner has not discovered anything yet.'}</div>
            )}
          </>
        ) : null}

        {/* ─── COVERAGE ───────────────────────────────────────────────── */}
        {tab === 'coverage' ? (
          <>
            <p className="oep-footnote" style={{ borderTop: 0, paddingTop: 0 }}>
              {fa
                ? 'فقط منابع متصل اسکن می‌شوند؛ چیزی که فید نداده ساخته نمی‌شود.'
                : 'Only connected sources are scanned; nothing a feed did not send is invented.'}
            </p>
            <div className="oep-coverage">
              {(scan?.coverage || []).map((c) => (
                <div key={c.id} className="oep-coverage-row">
                  <span>{categoryLabel(c.id, locale)}</span>
                  <b>{fa ? `${num(c.rows)} ردیف` : `${num(c.rows)} rows`}</b>
                  <span className={`oep-status-pill is-${c.status === 'live' || c.status === 'observed' ? 'live' : c.rows ? 'live' : 'empty'}`}>
                    {c.status === 'live' || c.status === 'observed'
                      ? (fa ? 'زنده' : 'live')
                      : (fa ? 'بدون مورد' : 'no rows')}
                  </span>
                </div>
              ))}
            </div>

            <div className="oep-coverage" style={{ marginTop: 10 }}>
              {Object.entries(scan?.feeds || {}).map(([key, f]) => (
                <div key={key} className="oep-coverage-row">
                  <span>{key}</span>
                  <b>{f?.rows != null ? num(f.rows) : '—'}</b>
                  <span className={`oep-status-pill is-${f?.status === 'live' || f?.status === 'observed' ? 'live' : f?.status === 'unavailable' ? 'unavailable' : 'empty'}`}>
                    {f?.status || '—'}
                  </span>
                </div>
              ))}
            </div>

            {scan?.cortex ? (
              <p className="oep-footnote">
                {fa
                  ? `کرتکس: ${scan.cortex.connected ? 'متصل' : 'ناموجود'} — قوانین آن اجرا/امضا/جابه‌جایی وجه را مجاز نمی‌کند.`
                  : `Cortex: ${scan.cortex.connected ? 'connected' : 'unavailable'} — its laws forbid execution, signing and moving funds.`}
              </p>
            ) : null}
          </>
        ) : null}

        <p className="oep-footnote">
          {fa
            ? 'بازده از نرخ فعلی تخمین زده می‌شود؛ نرخ، گس و لغزش تغییر می‌کنند و سود تضمین نمی‌شود. امتیاز و اطمینان درباره کیفیت شواهد است، نه احتمال سود.'
            : 'Yield is estimated from current rates; rates, gas and slippage change and profit is not guaranteed. Score and confidence describe the evidence, never the probability of profit.'}
          {scan?.scannedAt ? ` · ${timeAgo(scan.scannedAt, locale)}` : ''}
        </p>
      </div>
    </PageTransition>
  );
}
