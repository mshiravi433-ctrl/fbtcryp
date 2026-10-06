/**
 * PANEL 4 — CAUSAL INTELLIGENCE (زنجیرهٔ انتقال کلان).
 * ---------------------------------------------------------------------------
 * The server's OWN macro-graph engine, fetched lazily ONCE the first time this
 * tab is opened (module-level shared promise), with the local transmission
 * chain as the fallback when it cannot be reached. The 2026-10 pass polished
 * the drawing (kind-tinted nodes, seeded edge labels, contribution bars) but
 * kept the honesty contract byte-for-byte: node moves are real readings, edge
 * weights are first-order model sensitivities, and an edge activates only when
 * both endpoints were read.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiBase } from '../../../lib/apiBase.js';
import { buildCausalLocal } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';

const causalCache = { state: 'idle', body: null };
let causalPromise = null;
/* ONE shared read per session: the first open starts it, every later mount —
   even a remount while it is in flight — simply waits on the same promise. */
function fetchCausalGraph() {
  if (!causalPromise) {
    causalPromise = fetch(`${apiBase()}/deep/macro-graph?asset=BTC`, { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((body) => {
        if (body?.ok && body?.graph?.nodes?.length) { causalCache.state = 'done'; causalCache.body = body; }
        else causalCache.state = 'error';
        return causalCache;
      })
      .catch(() => { causalCache.state = 'error'; return causalCache; });
  }
  return causalPromise;
}

const CAUSAL_NODE_FA = {
  'topic:FED': 'فدرال‌رزرو', 'topic:INFLATION': 'تورم', 'topic:GEOPOLITICS': 'ژئوپلیتیک',
  'topic:GROWTH': 'رشد', 'topic:RATES': 'نرخ بهره', 'topic:ECB': 'اروپا', 'topic:POLITICS': 'سیاست',
  'topic:CRYPTO_POLICY': 'قانون رمزارز', 'topic:CRYPTO POLICY': 'قانون رمزارز',
  dxy: 'دلار (DXY)', yields2y: 'بازده ۲ ساله', yields10y: 'بازده ۱۰ ساله', curve2s10s: 'اختلاف ۲/۱۰',
  spx: 'اس‌اندپی ۵۰۰', gold: 'طلا', wti: 'نفت (WTI)', btc: 'بیت‌کوین', eth: 'اتریوم', sol: 'سولانا',
  rwa: 'دارایی واقعی', portfolio: 'پرتفوی شما'
};
const causalLabel = (node, isPersian) => {
  if (!isPersian) return node.label || node.id;
  return CAUSAL_NODE_FA[node.id] || (String(node.id).startsWith('topic:') ? String(node.id).slice(6) : node.label || node.id);
};

const KIND_META = {
  event: { icon: 'news', fa: 'رویداد', en: 'events' },
  instrument: { icon: 'chart', fa: 'سازوکار', en: 'instruments' },
  asset: { icon: 'coin', fa: 'دارایی', en: 'assets' },
  class: { icon: 'layers', fa: 'کلاس', en: 'classes' },
  portfolio: { icon: 'wallet', fa: 'پرتفوی', en: 'portfolio' }
};

export function CausalPanel({ world, L, isPersian }) {
  const [phase, setPhase] = useState(() => (
    causalCache.state === 'done' || causalCache.state === 'error' ? causalCache.state : 'loading'
  ));
  useEffect(() => {
    let cancelled = false;
    if (causalCache.state === 'done' || causalCache.state === 'error') {
      setPhase(causalCache.state);
      return undefined;
    }
    fetchCausalGraph().then(() => { if (!cancelled) setPhase(causalCache.state); });
    return () => { cancelled = true; };
  }, []);

  const local = useMemo(() => buildCausalLocal(world), [world]);
  const graph = phase === 'done' ? causalCache.body : null;
  const nodes = graph?.graph?.nodes || [];
  const cols = {
    event: nodes.filter((n) => n.kind === 'event'),
    instrument: nodes.filter((n) => n.kind === 'instrument'),
    asset: nodes.filter((n) => n.kind === 'asset' || n.kind === 'class'),
    portfolio: nodes.filter((n) => n.kind === 'portfolio')
  };
  const edges = graph?.graph?.edges || [];
  const why = graph?.whyRiskier;
  const impulse = graph?.portfolioRiskImpulse ?? graph?.graph?.portfolioRiskImpulse;
  const coverage = graph?.graph?.coverage || graph?.coverage || null;

  return (
    <div className="aigw-panel acc-causal">
      {phase === 'loading' && (
        <div className="aig-section" style={{ padding: 18 }}>
          <div className="aigw-skel" style={{ height: 16, width: '55%', marginBottom: 12 }} />
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aigw-skel" style={{ height: 46, marginBottom: 8 }} />)}
          <div className="aigw-note">{L('در حال خواندن گراف علّی مغز جهانی…', 'Reading the global brain\u2019s causal graph…')}</div>
        </div>
      )}

      {phase === 'done' && graph && (
        <>
          <div className="aigw-sec" style={{ marginBottom: 6 }}>
            <WIcon name="chain" size={17} />
            {L('گراف علّی مغز جهانی', 'The global brain\u2019s causal graph')}
            {typeof impulse === 'number' ? (
              <span className={`aigw-pill ${impulse > 0.05 ? 'bad' : impulse < -0.05 ? 'up' : 'flat'}`} style={{ marginInlineStart: 'auto' }}>
                {L('تکانهٔ ریسک پرتفوی', 'portfolio risk impulse')} <span className="aigw-ltr">{impulse > 0 ? '+' : ''}{impulse}</span>
              </span>
            ) : null}
          </div>

          {coverage ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="aigw-pill info">{L('گره', 'nodes')} <span className="aigw-ltr">{coverage.nodes ?? nodes.length}</span></span>
              <span className="aigw-pill info">{L('یال', 'edges')} <span className="aigw-ltr">{coverage.edges ?? edges.length}</span></span>
              {Array.isArray(coverage.sources) ? <span className="aigw-pill ghost">{L('منابع', 'sources')}: {coverage.sources.slice(0, 3).join(', ')}</span> : null}
            </div>
          ) : null}

          <div className="aigw-causal-cols">
            {['event', 'instrument', 'asset', 'portfolio'].map((k) => (
              <div key={k} className="aigw-causal-col">
                <h4><WIcon name={KIND_META[k].icon} size={12} /> {isPersian ? KIND_META[k].fa : KIND_META[k].en}</h4>
                {cols[k].length ? cols[k].map((n) => (
                  <div key={n.id} className={`aigw-node-chip ${n.riskDirection === 'risk_up' ? 'risk-up' : n.riskDirection === 'risk_down' ? 'risk-down' : ''}`}>
                    <DirMark dir={n.change24hPct === null || n.change24hPct === undefined ? 'flat' : n.change24hPct > 0 ? 'up' : n.change24hPct < 0 ? 'down' : 'flat'} size={9} />
                    <span style={{ minWidth: 0 }}>
                      {causalLabel(n, isPersian)}
                      {n.change24hPct !== null && n.change24hPct !== undefined ? (
                        <span className="aigw-ltr" style={{ color: n.change24hPct >= 0 ? 'var(--up)' : 'var(--down)' }}> {n.change24hPct > 0 ? '+' : ''}{n.change24hPct}%</span>
                      ) : null}
                      {n.attention ? <span style={{ color: 'var(--rgb-5)' }}> ×{isPersian ? faNum(n.attention) : n.attention}</span> : null}
                    </span>
                  </div>
                )) : <div className="aigw-note" style={{ marginTop: 0 }}>—</div>}
              </div>
            ))}
          </div>

          {why?.available && Array.isArray(why.drivers) && why.drivers.length ? (
            <div style={{ marginTop: 6 }}>
              <div className="aigw-sec">
                <WIcon name="warning" size={16} />
                {L('چرا BTC امروز ریسک دارد؟ — راننده‌های علّی', 'Why is BTC riskier today? — causal drivers')}
              </div>
              {why.drivers.map((d, i) => {
                const maxAbs = Math.max(0.0001, ...why.drivers.map((x) => Math.abs(x.contribution || 0)));
                const wPct = Math.min(100, (Math.abs(d.contribution || 0) / maxAbs) * 100);
                const up = (d.contribution || 0) >= 0;
                return (
                  <div key={`${d.from}-${i}`} className="aigw-driver">
                    <span className="aigw-driver-bar" aria-hidden="true">
                      <i style={{ insetInlineStart: up ? 0 : undefined, insetInlineEnd: up ? undefined : 0, width: `${wPct}%`, background: up ? 'var(--up)' : 'var(--down)' }} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 850, color: 'var(--text-1)', lineHeight: 1.6 }}>
                        {isPersian ? (CAUSAL_NODE_FA[d.from] || d.fromLabel || d.from) : (d.fromLabel || d.from)}
                        {d.fromChange24hPct !== null && d.fromChange24hPct !== undefined
                          ? <span className="aigw-ltr" style={{ color: d.fromChange24hPct >= 0 ? 'var(--up)' : 'var(--down)' }}> {d.fromChange24hPct > 0 ? '+' : ''}{d.fromChange24hPct}%</span>
                          : d.attention ? <span style={{ color: 'var(--rgb-5)' }}> ×{isPersian ? faNum(d.attention) : d.attention}</span> : null}
                        <span style={{ color: 'var(--text-3)', fontWeight: 700 }}> → {why.assetLabel || 'BTC'}</span>
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--text-3)', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                        <span className="aigw-ltr">w={d.sensitivity}</span> · {d.why}
                      </div>
                    </div>
                    <b className="aigw-ltr" style={{ fontSize: 11, color: up ? 'var(--up)' : 'var(--down)' }}>
                      {up ? '+' : ''}{d.contribution}
                    </b>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="aigw-note">
            {L(
              'حرکت گره‌ها واقعی و از همین دور است؛ وزن یال‌ها حساسیت‌های مرتبهٔ اولِ مدل‌اند، نه بتای اندازه‌گیری‌شده. یال فقط وقتی فعال است که هر دو سرش خوانده شده باشد.',
              'Node moves are real readings of this pass; edge weights are first-order model sensitivities, not measured betas. An edge activates only when both endpoints were read.'
            )}
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="aigw-sec" style={{ marginBottom: 4 }}>
            <WIcon name="chain" size={17} />
            {L('زنجیرهٔ انتقال کلان', 'The macro transmission chain')}
            <span className="aigw-pill ghost" style={{ marginInlineStart: 'auto' }}>{L('ساخته‌شده از همین دور', 'built from this pass')}</span>
          </div>
          <div className="aigw-chain">
            {local.nodes.map((n, i) => (
              <div key={n.id}>
                {i > 0 ? (
                  <div className={`aigw-chain-arrow ${local.edges[i - 1]?.lit ? 'lit' : ''}`} aria-hidden="true">
                    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M7 1v11" /><path d="m2.5 8.5 4.5 5 4.5-5" />
                    </svg>
                  </div>
                ) : null}
                <div className={`aigw-chain-node state-${n.state}`}>
                  <span className="aigw-chain-ico"><WIcon name={n.icon || 'pulse'} size={17} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 850, color: 'var(--text-1)' }}>{isPersian ? n.fa : n.en}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                      {n.state === 'read' ? (n.source ? `${L('منبع', 'source')}: ${n.source}` : L('خوانده شد', 'read'))
                        : n.state === 'proxy' ? (isPersian ? n.noteFa || 'پروکسی — از حرکت انرژی' : n.noteEn || 'proxy — from the energy move')
                          : n.state === 'model' ? (isPersian ? n.noteFa || 'گرهٔ مدل' : n.noteEn || 'model node')
                            : L('خوانده نشد', 'unread')}
                    </div>
                    {n.evidence ? <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 2 }} className="aigw-ltr">{n.evidence}</div> : null}
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
              'گراف علّی سرور در این دور در دسترس نبود؛ این زنجیرهٔ استاندارد انتقال است که فقط با خوانش‌های واقعی همین دور روشن شده — هر گرهٔ خاکستری یعنی داده‌ای نبود، نه اینکه اثری نبود.',
              'The server\u2019s causal graph was unreachable this pass; this is the standard transmission chain lit only by this pass\u2019s real reads — a grey node means no data, not no effect.'
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default CausalPanel;

/* kept for parity with the older panel surface */
export { pct };
