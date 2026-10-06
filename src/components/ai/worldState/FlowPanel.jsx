/**
 * PANEL 5 — GLOBAL CAPITAL FLOW MAP + MACRO TRANSMISSION.
 * ---------------------------------------------------------------------------
 * REPORTED: «زنجیرهٔ انتقال کلان و جریان سرمایه اصلاً داده‌ای ندارد و ناقص
 * هست با انیمیشن و ایکون زشت».
 *
 * What the tab shows now, all from this pass:
 *   · the NET measured flow (stablecoin supply delta + token market-cap delta
 *     + labelled smart-money net) as one honest hero number, with its parts;
 *   · the six-node capital route, each node carrying its real value, evidence
 *     row and source, with animated connectors that light per hop only when
 *     both ends were read;
 *   · WHERE the money actually went: token inflow/outflow leaders with $ and
 *     %, stablecoin per-chain deltas with bars, per-class breadth, whale
 *     transfers and the labelled smart-money tokens;
 *   · the macro transmission chain (oil → inflation → yields → dollar → EM →
 *     crypto liquidity) with the same read/proxy/unread contract.
 */
import { useMemo } from 'react';
import { buildCapitalFlow, buildTransmission, usdCompact } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';

const FLOW_ICON = { usd: 'bank', treasuries: 'layers', gold: 'coin', btc: 'pulse', defi: 'waves', rwa: 'building' };
const CLASS_FA = { crypto: 'رمزارز', stocks: 'سهام', forex: 'ارز', commodities: 'کالا', rwa: 'دارایی واقعی' };
const CLASS_EN = { crypto: 'crypto', stocks: 'stocks', forex: 'forex', commodities: 'commodities', rwa: 'RWA' };

export function FlowMapPanel({ world, L, isPersian }) {
  const flow = useMemo(() => buildCapitalFlow(world), [world]);
  const chain = useMemo(() => buildTransmission(world), [world]);
  const { route, token, stable, classMoves, whales, verdict } = flow;

  const usdText = (v) => (v === null || v === undefined ? '—' : usdCompact(v).replace('+', '').replace('-', '\u2212'));
  const maxLeader = Math.max(1, ...token.leaders.map((l) => Math.abs(l.valueUsd || 0)));
  const maxChain = Math.max(1, ...stable.chains.map((c) => Math.abs(c.net24hUsd || 0)));

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
            {verdict ? usdText(verdict.netUsd) : '—'}
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
            <div className={`aigw-flow-node ${n.status === 'ok' ? 'on' : ''}`}>
              <span className="aigw-flow-ico"><WIcon name={FLOW_ICON[n.id] || 'coin'} size={19} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-1)' }}>{isPersian ? n.fa : n.en}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                  {n.status === 'ok'
                    ? (n.source ? `${L('منبع', 'source')}: ${n.source}` : L('خوانده شد', 'read'))
                    : L('در این دور خوانده نشد', 'not read in this pass')}
                </div>
                {n.evidence ? <div className="aigw-ltr" style={{ fontSize: 9, color: 'var(--text-2)', marginTop: 3 }}>{n.evidence}</div> : null}
              </div>
              {n.status === 'ok' ? (
                <span className={`aigw-pill ${n.dir === 'up' ? 'up' : n.dir === 'down' ? 'down' : 'flat'}`}>
                  <DirMark dir={n.dir} size={9} /><span className="aigw-ltr">{n.value}</span>
                </span>
              ) : <span className="aigw-pill ghost">—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── token leaders ────────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="coin" size={17} />
        {L('پول به کدام توکن رفت', 'where the money went — tokens')}
        <span className="aigw-sec-sub">{token.status === 'ok' ? `${token.source} · ${token.count ?? '—'} ${L('توکن', 'tokens')}` : L('خوانده نشد', 'unread')}</span>
      </div>
      {token.leaders.length ? token.leaders.map((l) => (
        <div key={`${l.dir}:${l.symbol}`} className="aigw-leader">
          <div style={{ minWidth: 0 }}>
            <div className="aigw-leader-sym">
              <span className="aigw-dot" style={{ background: l.dir === 'in' ? 'var(--up)' : 'var(--down)' }} />
              <span className="aigw-ltr">{l.symbol}</span>
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
          <span className={`aigw-leader-val ${l.dir === 'in' ? 'up' : 'down'}`} style={{ color: l.dir === 'in' ? 'var(--up)' : 'var(--down)' }}>{usdText(l.valueUsd)}</span>
          <span className="aigw-leader-pct" style={{ color: 'var(--text-2)' }}>{pct(l.changePct, isPersian)}</span>
        </div>
      )) : <div className="aig-empty">{L('جریان توکن‌ها در این دور خوانده نشد.', 'Token flows were not read this pass.')}</div>}

      {token.status === 'ok' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span className="aigw-pill up">{L('ورودی', 'inflow')} <span className="aigw-ltr">{usdText(token.inflowUsd)}</span></span>
          <span className="aigw-pill down">{L('خروجی', 'outflow')} <span className="aigw-ltr">{usdText(-Math.abs(token.outflowUsd || 0))}</span></span>
          <span className={`aigw-pill ${token.netUsd >= 0 ? 'up' : 'down'}`}>{L('خالص', 'net')} <span className="aigw-ltr">{usdText(token.netUsd)}</span></span>
        </div>
      ) : null}

      {/* ── stablecoin chains ────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="drop" size={17} />
        {L('استیبل‌کوین روی کدام زنجیره‌ها', 'stablecoins by chain')}
        <span className="aigw-sec-sub">{stable.status === 'ok' ? `${L('کل', 'total')} ${usdText(stable.totalUsd)} · ${L('۷روز', '7d')} ${usdText(stable.net7dUsd)}` : L('خوانده نشد', 'unread')}</span>
      </div>
      {stable.chains.length ? stable.chains.map((c) => (
        <div key={c.chain} className="aigw-leader" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
          <div style={{ minWidth: 0 }}>
            <div className="aigw-leader-sym"><span className="aigw-ltr">{c.chain}</span></div>
            <div className="aigw-bar" style={{ marginTop: 6 }} aria-hidden="true">
              <i style={{
                insetInlineStart: c.dir === 'in' ? 0 : undefined, insetInlineEnd: c.dir === 'in' ? undefined : 0,
                width: `${Math.round((Math.abs(c.net24hUsd || 0) / maxChain) * 100)}%`,
                background: c.dir === 'in' ? 'var(--up)' : 'var(--down)'
              }} />
            </div>
          </div>
          <span className="aigw-leader-val" style={{ color: c.dir === 'in' ? 'var(--up)' : 'var(--down)' }}>{usdText(c.net24hUsd)}</span>
          <span className="aigw-leader-pct" style={{ color: 'var(--text-2)' }}>{pct(c.net24hPct, isPersian)}</span>
        </div>
      )) : <div className="aig-empty">{L('جریان زنجیره‌ها در این دور خوانده نشد.', 'Chain flows were not read this pass.')}</div>}

      {/* ── per-class breadth ────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="layers" size={17} />
        {L('حرکت هر کلاس دارایی', 'per-class movement')}
      </div>
      <div className="aigw-stations">
        {classMoves.map((c) => (
          <div key={c.cls} className="aigw-station" style={{ padding: '10px 11px' }}>
            <div className="aigw-station-name">{isPersian ? CLASS_FA[c.cls] || c.cls : CLASS_EN[c.cls] || c.cls}</div>
            <div className="aigw-station-val" style={{ fontSize: 15, color: c.avg === null ? 'var(--text-3)' : c.avg >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {c.avg === null ? '—' : pct(c.avg, isPersian)}
            </div>
            <div className="aigw-station-ev">
              {c.advancing !== null || c.declining !== null
                ? `${isPersian ? faNum(c.advancing ?? 0) : c.advancing ?? 0}▲ / ${isPersian ? faNum(c.declining ?? 0) : c.declining ?? 0}▼${c.withChange ? ` ${L('از', 'of')} ${isPersian ? faNum(c.withChange) : c.withChange}` : ''}`
                : L('تغییر ۲۴س خوانده نشد', 'no 24h change read')}
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
            <div className="aigw-leader-sym"><span className="aigw-ltr">{e.symbol}</span>{e.chain ? <span className="aigw-leader-name">{e.chain}</span> : null}</div>
            <div className="aigw-leader-name">{e.flow || L('انتقال', 'transfer')}</div>
          </div>
          <span className="aigw-leader-val" style={{ color: 'var(--text-1)' }}>{e.valueUsd === null ? '—' : usdCompact(e.valueUsd).replace('+', '')}</span>
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
                <span className="aigw-ltr">{t.symbol}</span>
                <span className="aigw-ltr">{usdText(t.netUsd ?? t.valueUsd)}</span>
                {t.confidence !== null ? <span className="aigw-ltr" style={{ opacity: .7 }}>{t.confidence}</span> : null}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {/* ── the macro transmission chain ─────────────────────────────────── */}
      <div className="aigw-sec" style={{ marginTop: 16 }}>
        <WIcon name="chain" size={17} />
        {L('زنجیرهٔ انتقال کلان', 'Macro transmission chain')}
        <span className="aigw-sec-sub">{L('نفت → تورم → بازده → دلار → فشار → نقدینگی رمزارز', 'oil → inflation → yields → dollar → pressure → crypto liquidity')}</span>
      </div>
      <div className="aigw-chain">
        {chain.nodes.map((n, i) => (
          <div key={n.id}>
            {i > 0 ? (
              <div className={`aigw-chain-arrow ${chain.edges[i - 1]?.lit ? 'lit' : ''}`} aria-hidden="true">
                <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 1v11" /><path d="m2.5 8.5 4.5 5 4.5-5" /></svg>
              </div>
            ) : null}
            <div className={`aigw-chain-node state-${n.state}`}>
              <span className="aigw-chain-ico"><WIcon name={n.icon} size={17} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 850, color: 'var(--text-1)' }}>{isPersian ? n.fa : n.en}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                  {n.state === 'read' ? (n.source ? `${L('منبع', 'source')}: ${n.source}` : L('خوانده شد', 'read'))
                    : n.state === 'proxy' ? (isPersian ? n.noteFa : n.noteEn)
                      : n.state === 'model' ? (isPersian ? n.noteFa : n.noteEn)
                        : L('خوانده نشد', 'unread')}
                </div>
                {n.evidence ? <div className="aigw-ltr" style={{ fontSize: 9, color: 'var(--text-2)', marginTop: 2 }}>{n.evidence}</div> : null}
              </div>
              {n.value ? (
                <span className={`aigw-pill ${n.dir === 'up' ? 'up' : n.dir === 'down' ? 'down' : 'flat'}`}>
                  <DirMark dir={n.dir} size={9} /><span className="aigw-ltr">{n.value}</span>
                </span>
              ) : n.state === 'read' ? <span className="aigw-pill flat">{L('خوانده شد', 'read')}</span> : <span className="aigw-pill ghost">—</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="aigw-note">
        {L(
          'همهٔ اعداد این صفحه از خوانش‌های واقعی همین دور است: تغییر عرضهٔ استیبل‌کوین (دیفای‌لاما)، تغییر ارزش بازار توکن‌ها (کوین‌گکو)، انتقال‌های بزرگ و جریان برچسب‌دار. خط میان گره‌ها مسیر مرجع است و فقط وقتی جان می‌گیرد که دو سرش عدد داشته باشند؛ هیچ‌کدام مجوز اجرا نیست.',
          'Every number here is a real read of this pass: stablecoin supply deltas (DefiLlama), token market-cap deltas (CoinGecko), large transfers and labelled flows. The line between nodes is the reference route and animates only when both ends carry a number; none of it is execution authority.'
        )}
      </div>
    </div>
  );
}

export default FlowMapPanel;
