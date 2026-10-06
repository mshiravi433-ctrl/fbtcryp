/**
 * PANEL 5 — GLOBAL CAPITAL FLOW MAP + MACRO TRANSMISSION.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «جریان سرمایه: اطلاعات طلا، دلار و اوراق دوباره ناقص است».
 *
 * What the tab shows, all from this pass:
 *   · the NET measured flow (stablecoin supply delta + token market-cap delta
 *     + labelled smart-money net) as one honest hero number, with its parts;
 *   · THE MACRO TABLE — dollar, gold, silver, oil, copper, equities and the
 *     Treasury curve in one place, each with its level, its daily move, HOW it
 *     was obtained (direct · proxy · level only · last good read) and who
 *     supplied it. A missing direct read falls back to a labelled proxy
 *     (resolve.js) before it ever shows «خوانده نشد»;
 *   · the six-node capital route, each node carrying its real value, its
 *     provenance and animated connectors that light per hop only when both
 *     ends were read;
 *   · WHERE the money actually went: token inflow/outflow leaders, stablecoin
 *     per-chain deltas, per-class breadth, whale transfers and labelled flows;
 *   · the macro transmission chain (oil → inflation → yields → dollar → EM →
 *     crypto liquidity) with a sentence per link and a test of whether the
 *     downstream market actually did what the mechanism predicts.
 */
import { useMemo } from 'react';
import { buildCapitalFlow, buildTransmission, usdCompact, usdFaCompact, chainFa } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';
import { QualityBadge, Ltr } from './parts.jsx';
import { ChainView } from './ChainView.jsx';

const FLOW_ICON = { usd: 'bank', treasuries: 'layers', gold: 'coin', btc: 'pulse', defi: 'waves', rwa: 'building' };
const CLASS_FA = { crypto: 'رمزارز', stocks: 'سهام', forex: 'ارز', commodities: 'کالا', rwa: 'دارایی واقعی' };
const CLASS_EN = { crypto: 'crypto', stocks: 'stocks', forex: 'forex', commodities: 'commodities', rwa: 'RWA' };

export function FlowMapPanel({ world, L, isPersian }) {
  const flow = useMemo(() => buildCapitalFlow(world), [world]);
  const chain = useMemo(() => buildTransmission(world), [world]);
  const { route, anchors, token, stable, classMoves, whales, verdict } = flow;

  const usdText = (v) => {
    if (v === null || v === undefined) return '—';
    return isPersian ? usdFaCompact(v, { signed: false }) : usdCompact(v).replace('+', '').replace('-', '\u2212');
  };
  const chainName = (c) => (isPersian ? chainFa(c) : c);
  const maxLeader = Math.max(1, ...token.leaders.map((l) => Math.abs(l.valueUsd || 0)));
  const maxChain = Math.max(1, ...stable.chains.map((c) => Math.abs(c.net24hUsd || 0)));
  const sum = anchors.summary;

  return (
    <div className="aigw-panel acc-flows">
      {/* ── the net measured flow ────────────────────────────────────────── */}
      <div className="aigw-flow-hero">
        <span style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 17, color: '#fff', background: 'var(--acc-grad)' }}>
          <WIcon name="flow" size={24} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="aigw-flow-hero-k">{L('جریان خالص اندازه‌گیری‌شده در ۲۴ ساعت', 'net measured flow over 24h')}</div>
          <div className="aigw-flow-hero-val">
            {verdict ? <Ltr>{usdText(verdict.netUsd)}</Ltr> : '—'}
            {verdict ? <span style={{ fontSize: 12, marginInlineStart: 8, color: verdict.dir === 'up' ? 'var(--up)' : verdict.dir === 'down' ? 'var(--down)' : 'var(--text-3)' }}>
              {isPersian ? verdict.labelFa : verdict.labelEn}
            </span> : null}
          </div>
          <div className="aigw-flow-hero-sub">
            {verdict
              ? verdict.bits.map((b) => (
                `${b.id === 'stablecoin' ? L('استیبل‌کوین', 'stablecoins') : b.id === 'tokenMcap' ? L('ارزش بازار توکن‌ها', 'token market cap') : L('جریان نهادی', 'institutional flow')} ${usdText(b.value)}`
              )).join(' · ')
              : L('هیچ‌یک از منابع جریان در این دور خوانده نشد.', 'None of the flow sources was read this pass.')}
          </div>
        </div>
      </div>

      {/* ── THE MACRO TABLE: dollar · gold · bonds · oil · equities ───────── */}
      <div className="aigw-sec">
        <WIcon name="bank" size={17} />
        {L('دلار، طلا و اوراق', 'Dollar, gold and bonds')}
        <span className="aigw-sec-sub">
          {isPersian
            ? `${faNum(sum.direct)} مستقیم · ${faNum(sum.proxy)} پروکسی${sum.levelOnly ? ` · ${faNum(sum.levelOnly)} فقط سطح` : ''}${sum.unread ? ` · ${faNum(sum.unread)} نرسید` : ''}`
            : `${sum.direct} direct · ${sum.proxy} proxy${sum.levelOnly ? ` · ${sum.levelOnly} level only` : ''}${sum.unread ? ` · ${sum.unread} unread` : ''}`}
        </span>
      </div>
      <div className="aigw-anchors">
        {anchors.rows.map((r) => (
          <div key={r.id} data-anchor={r.id} className={`aigw-anchor st-${r.status} q-${r.quality || 'none'}`}>
            <div className="aigw-anchor-top">
              <span className="aigw-anchor-ico"><WIcon name={r.icon} size={16} /></span>
              <span className="aigw-anchor-name">{isPersian ? r.fa : r.en}</span>
              {r.status !== 'unread' ? <QualityBadge quality={r.quality} isPersian={isPersian} /> : null}
            </div>
            {r.status === 'unread' ? (
              <div className="aigw-anchor-unread">{L('در این دور خوانده نشد', 'not read this pass')}</div>
            ) : (
              <>
                <div className="aigw-anchor-level">
                  {(isPersian ? r.levelFa : r.levelEn) ? <Ltr>{isPersian ? r.levelFa : r.levelEn}</Ltr> : <span className="aigw-anchor-dim">{L('سطح نرسید', 'no level')}</span>}
                </div>
                <div className="aigw-anchor-move">
                  {(isPersian ? r.moveFa : r.moveEn)
                    ? (
                      <span className={`aigw-pill ${r.dir === 'up' ? 'up' : r.dir === 'down' ? 'down' : 'flat'}`}>
                        <DirMark dir={r.dir} size={9} /><Ltr>{isPersian ? r.moveFa : r.moveEn}</Ltr>
                      </span>
                    )
                    : <span className="aigw-pill ghost">{L('تغییر روزانه نرسید', 'no daily change')}</span>}
                  {(isPersian ? r.sourceFa : r.sourceEn) ? <span className="aigw-anchor-src">{isPersian ? r.sourceFa : r.sourceEn}</span> : null}
                </div>
                {(isPersian ? r.basisFa : r.basisEn) ? <div className="aigw-anchor-basis">{isPersian ? r.basisFa : r.basisEn}</div> : null}
              </>
            )}
          </div>
        ))}
      </div>

      {/* wide screens: the route and the chain on one side, the money-flow
          tables on the other; a phone still reads them top to bottom */}
      <div className="gw-cols">
        <div className="gw-col">
      {/* ── the reference route ──────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="funnel" size={17} />
        {L('مسیر مرجع سرمایه', 'The reference capital route')}
        <span className="aigw-sec-sub">{L('هر گره فقط با عدد واقعی روشن می‌شود', 'a node lights only from a real number')}</span>
      </div>
      <div>
        {route.nodes.map((n, i) => (
          <div key={n.id}>
            {i > 0 ? (
              <>
                <div className={`aigw-flow-conn ${route.edges[i - 1]?.active ? 'on' : ''}`} aria-hidden="true" />
                <span className="aigw-flow-chevron" aria-hidden="true">
                  <svg width="12" height="7" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m1 1 5 5 5-5" /></svg>
                </span>
              </>
            ) : null}
            <div className={`aigw-flow-node ${n.status === 'ok' || n.status === 'level' ? 'on' : ''}`}>
              <span className="aigw-flow-ico"><WIcon name={FLOW_ICON[n.id] || 'coin'} size={19} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="aigw-flow-node-name">
                  {isPersian ? n.fa : n.en}
                  {n.status !== 'unread' ? <QualityBadge quality={n.quality} isPersian={isPersian} /> : null}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                  {n.status === 'unread'
                    ? L('در این دور خوانده نشد', 'not read in this pass')
                    : (isPersian ? n.sourceFa : n.sourceEn)
                      ? `${L('منبع', 'source')}: ${isPersian ? n.sourceFa : n.sourceEn}`
                      : L('خوانده شد', 'read')}
                </div>
                {(isPersian ? n.levelFa : n.levelEn) ? <div className="aigw-flow-node-lvl"><Ltr>{isPersian ? n.levelFa : n.levelEn}</Ltr></div> : null}
                {(isPersian ? n.basisFa : n.basisEn) && n.quality === 'proxy' ? <div className="aigw-flow-node-basis">{isPersian ? n.basisFa : n.basisEn}</div> : null}
              </div>
              {n.status === 'ok' ? (
                <span className={`aigw-pill ${n.dir === 'up' ? 'up' : n.dir === 'down' ? 'down' : 'flat'}`}>
                  <DirMark dir={n.dir} size={9} /><Ltr>{isPersian ? n.valueFa : n.value}</Ltr>
                </span>
              ) : n.status === 'level' ? <span className="aigw-pill flat">{L('فقط سطح', 'level only')}</span> : <span className="aigw-pill ghost">—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── the macro transmission chain ─────────────────────────────────── */}
      <div className="aigw-sec" style={{ marginTop: 16 }}>
        <WIcon name="chain" size={17} />
        {L('زنجیرهٔ انتقال کلان', 'Macro transmission chain')}
        <span className="aigw-sec-sub">{L('نفت ← تورم ← بازده ← دلار ← فشار ← نقدینگی رمزارز', 'oil → inflation → yields → dollar → pressure → crypto liquidity')}</span>
      </div>
      <ChainView chain={chain} L={L} isPersian={isPersian} />

        </div>
        <div className="gw-col">
      {/* ── token leaders ────────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="coin" size={17} />
        {L('پول به کدام توکن رفت', 'where the money went — tokens')}
        <span className="aigw-sec-sub">{token.status === 'ok' && token.count ? `${token.source === 'coingecko' ? 'CoinGecko' : token.source} · ${isPersian ? faNum(token.count) : token.count} ${L('توکن', 'tokens')}` : L('خوانده نشد', 'unread')}</span>
      </div>
      {token.leaders.length ? token.leaders.map((l) => (
        <div key={`${l.dir}:${l.symbol}`} className="aigw-leader">
          <div style={{ minWidth: 0 }}>
            <div className="aigw-leader-sym">
              <span className="aigw-dot" style={{ background: l.dir === 'in' ? 'var(--up)' : 'var(--down)' }} />
              <Ltr>{l.symbol}</Ltr>
              {l.name ? <span className="aigw-leader-name">{l.name}</span> : null}
            </div>
            <div className="aigw-bar" style={{ marginTop: 6 }} aria-hidden="true">
              <i style={{
                insetInlineStart: l.dir === 'in' ? 0 : undefined, insetInlineEnd: l.dir === 'in' ? undefined : 0,
                width: `${Math.round((Math.abs(l.valueUsd || 0) / maxLeader) * 100)}%`,
                background: l.dir === 'in' ? 'var(--up)' : 'var(--down)'
              }} />
            </div>
          </div>
          <span className={`aigw-leader-val ${l.dir === 'in' ? 'up' : 'down'}`} style={{ color: l.dir === 'in' ? 'var(--up)' : 'var(--down)' }}><Ltr>{usdText(l.valueUsd)}</Ltr></span>
          <span className="aigw-leader-pct" style={{ color: 'var(--text-2)' }}><Ltr>{pct(l.changePct, isPersian)}</Ltr></span>
        </div>
      )) : <div className="aig-empty">{L('جریان توکن‌ها در این دور خوانده نشد.', 'Token flows were not read this pass.')}</div>}

      {token.status === 'ok' && token.leaders.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span className="aigw-pill up">{L('ورودی', 'inflow')} <Ltr>{usdText(token.inflowUsd)}</Ltr></span>
          <span className="aigw-pill down">{L('خروجی', 'outflow')} <Ltr>{token.outflowUsd === null || token.outflowUsd === undefined ? '—' : usdText(-Math.abs(token.outflowUsd))}</Ltr></span>
          <span className={`aigw-pill ${token.netUsd >= 0 ? 'up' : 'down'}`}>{L('خالص', 'net')} <Ltr>{usdText(token.netUsd)}</Ltr></span>
        </div>
      ) : null}

      {/* ── stablecoin chains ────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="drop" size={17} />
        {L('استیبل‌کوین روی کدام زنجیره‌ها', 'stablecoins by chain')}
        <span className="aigw-sec-sub">{stable.status === 'ok' ? `${L('کل', 'total')} ${usdText(stable.totalUsd)} · ${L('۷ روز', '7d')} ${usdText(stable.net7dUsd)}` : L('خوانده نشد', 'unread')}</span>
      </div>
      {stable.chains.length ? stable.chains.map((c) => (
        <div key={`${c.dir}:${c.chain}`} className="aigw-leader" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
          <div style={{ minWidth: 0 }}>
            <div className="aigw-leader-sym">{isPersian ? <span>{chainName(c.chain)}</span> : <Ltr>{c.chain}</Ltr>}</div>
            <div className="aigw-bar" style={{ marginTop: 6 }} aria-hidden="true">
              <i style={{
                insetInlineStart: c.dir === 'in' ? 0 : undefined, insetInlineEnd: c.dir === 'in' ? undefined : 0,
                width: `${Math.round((Math.abs(c.net24hUsd || 0) / maxChain) * 100)}%`,
                background: c.dir === 'in' ? 'var(--up)' : 'var(--down)'
              }} />
            </div>
          </div>
          <span className="aigw-leader-val" style={{ color: c.dir === 'in' ? 'var(--up)' : 'var(--down)' }}><Ltr>{usdText(c.net24hUsd)}</Ltr></span>
          <span className="aigw-leader-pct" style={{ color: 'var(--text-2)' }}><Ltr>{pct(c.net24hPct, isPersian)}</Ltr></span>
        </div>
      )) : <div className="aig-empty">{L('جریان زنجیره‌ها در این دور خوانده نشد.', 'Chain flows were not read this pass.')}</div>}

      {/* ── per-class breadth ────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="layers" size={17} />
        {L('حرکت هر کلاس دارایی', 'per-class movement')}
      </div>
      <div className="aigw-stations aigw-stations-compact">
        {classMoves.map((c) => (
          <div key={c.cls} className="aigw-station" style={{ padding: '10px 11px' }}>
            <div className="aigw-station-name">{isPersian ? CLASS_FA[c.cls] || c.cls : CLASS_EN[c.cls] || c.cls}</div>
            <div className="aigw-station-val" style={{ fontSize: 15, color: c.avg === null ? 'var(--text-3)' : c.avg >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {c.avg === null ? '—' : <Ltr>{pct(c.avg, isPersian)}</Ltr>}
            </div>
            <div className="aigw-station-ev">
              {c.advancing !== null || c.declining !== null
                ? `${isPersian ? faNum(c.advancing ?? 0) : c.advancing ?? 0}▲ / ${isPersian ? faNum(c.declining ?? 0) : c.declining ?? 0}▼${c.withChange ? ` ${L('از', 'of')} ${isPersian ? faNum(c.withChange) : c.withChange}` : ''}`
                : L('تغییر ۲۴ ساعته خوانده نشد', 'no 24h change read')}
            </div>
          </div>
        ))}
      </div>

      {/* ── whales + labelled institutional tokens ───────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="waves" size={17} />
        {L('نهنگ‌ها و جریان برچسب‌دار', 'whales and labelled flows')}
        <span className="aigw-sec-sub">{whales.status === 'ok' ? `${isPersian ? faNum(whales.count ?? 0) : whales.count ?? 0} ${L('انتقال', 'transfers')}` : L('خوانده نشد', 'unread')}</span>
      </div>
      {whales.events.length ? whales.events.map((e, i) => (
        <div key={`${e.symbol}-${i}`} className="aigw-leader" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <div style={{ minWidth: 0 }}>
            <div className="aigw-leader-sym"><Ltr>{e.symbol}</Ltr>{e.chain ? <span className="aigw-leader-name">{isPersian ? chainFa(e.chain) : e.chain}</span> : null}</div>
            <div className="aigw-leader-name">{e.flow === 'in' ? L('ورود به صرافی', 'to an exchange') : e.flow === 'out' ? L('خروج از صرافی', 'from an exchange') : L('انتقال', 'transfer')}</div>
          </div>
          <span className="aigw-leader-val" style={{ color: 'var(--text-1)' }}><Ltr>{e.valueUsd === null ? '—' : usdText(e.valueUsd)}</Ltr></span>
        </div>
      )) : (
        <div className="aig-empty">{whales.status === 'ok' ? L('در این دور انتقال بزرگی ثبت نشد.', 'No large transfer was recorded this pass.') : L('اسکنر نهنگ در این دور خوانده نشد.', 'The whale scanner was not read this pass.')}</div>
      )}

      {whales.smartTokens.length ? (
        <>
          <div className="aigw-note" style={{ marginTop: 8 }}>{L('توکن‌های جریان برچسب‌دار (برچسب‌گذاری‌شده، نه معاملهٔ زوجی):', 'labelled smart-money tokens (labelled transfers, not paired trades):')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {whales.smartTokens.map((t) => (
              <span key={`${t.symbol}-${t.chain}`} className={`aigw-pill ${(t.netUsd ?? 0) >= 0 ? 'up' : 'down'}`}>
                <Ltr>{t.symbol}</Ltr>
                <Ltr>{usdText(t.netUsd ?? t.valueUsd)}</Ltr>
              </span>
            ))}
          </div>
        </>
      ) : null}

        </div>
      </div>

      <div className="aigw-note">
        {L(
          'همهٔ اعداد این صفحه از خوانش‌های واقعی همین دور است: دلار، طلا و اوراق از منبع مستقیم یا جایگزین برچسب‌دار، تغییر عرضهٔ استیبل‌کوین (دیفای‌لاما)، تغییر ارزش بازار توکن‌ها (کوین‌گکو)، انتقال‌های بزرگ و جریان‌های برچسب‌دار. خط بین گره‌ها مسیر مرجع است و فقط وقتی دو سر آن خوانده شده باشد متحرک می‌شود؛ هیچ مقداری ساخته نمی‌شود.',
          'Every number here is a real read of this pass: the dollar, gold and bonds from a direct source or a labelled stand-in, stablecoin supply deltas (DefiLlama), token market-cap deltas (CoinGecko), large transfers and labelled flows. The line between nodes is the reference route and animates only when both ends were read; no value is made up.'
        )}
      </div>
    </div>
  );
}

export default FlowMapPanel;
