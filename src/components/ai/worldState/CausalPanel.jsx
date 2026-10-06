/**
 * PANEL 4 — CAUSAL INTELLIGENCE (زنجیرهٔ علت).
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «زنجیره علت هنوز اطلاعاتش ناقصه».
 *
 * The server's macro graph is a COMPLEMENT now, not the page. In production it
 * often answered with a single edge (its yield nodes never lit), so the tab
 * looked empty. The LOCAL chain — oil → inflation → yields → dollar → EM →
 * crypto liquidity, built from the same resolved readings as the rest of the
 * console (gold/dollar/bond fall back to labelled proxies) — is drawn FIRST,
 * with a sentence per link and a test of whether the downstream market did
 * what the mechanism predicts. The server graph (fetched lazily ONCE, shared
 * promise) is shown below it when it arrives: node columns, the BTC risk
 * drivers with their model sensitivities, and its own coverage numbers.
 * The honesty contract is unchanged: node moves are real readings, edge
 * weights are first-order model sensitivities, and an edge activates only when
 * both endpoints were read.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiBase } from '../../../lib/apiBase.js';
import { buildCausalLocal } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum } from './format.jsx';
import { Ltr } from './parts.jsx';
import { ChainView } from './ChainView.jsx';

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
  'topic:GROWTH': 'رشد', 'topic:RATES': 'نرخ بهره', 'topic:ECB': 'بانک مرکزی اروپا', 'topic:POLITICS': 'سیاست',
  'topic:CRYPTO_POLICY': 'قانون رمزارز', 'topic:CRYPTO POLICY': 'قانون رمزارز',
  dxy: 'دلار', yields2y: 'بازده ۲ ساله', yields10y: 'بازده ۱۰ ساله', curve2s10s: 'اختلاف ۲ به ۱۰',
  spx: 'اس‌اندپی ۵۰۰', gold: 'طلا', wti: 'نفت', btc: 'بیت‌کوین', eth: 'اتریوم', sol: 'سولانا',
  rwa: 'دارایی واقعی', portfolio: 'پرتفوی شما'
};
/* the server's own one-line reasons, in Persian (keyed by the English sentence) */
const WHY_FA = {
  'a hawkish Fed reprices the dollar up': 'فدرال‌رزرو سخت‌گیرتر، دلار را بالا می‌برد',
  'policy expectations move the front end of the curve': 'انتظارات سیاست پولی، ابتدای منحنی را جابه‌جا می‌کند',
  'inflation expectations steepen the long end': 'انتظارات تورمی انتهای منحنی را تندتر می‌کند',
  'risk-off demand lifts havens': 'تقاضای پناه‌جویی، دارایی‌های امن را بالا می‌برد',
  'supply fear lifts energy': 'ترس از عرضه، انرژی را بالا می‌برد',
  'a stronger dollar drains liquidity from risk assets': 'دلار قوی‌تر نقدینگی را از دارایی‌های پرریسک بیرون می‌کشد',
  'the curve moves together at the front': 'ابتدای منحنی هم‌جهت حرکت می‌کند',
  'higher real yields discount long-duration assets harder': 'بازده واقعی بالاتر، دارایی‌های بلندمدت را سخت‌تر تنزیل می‌کند',
  'discount rates compress equity multiples': 'نرخ تنزیل بالاتر، ضریب‌های سهام را فشرده می‌کند',
  'dollar strength tightens financial conditions': 'دلار قوی شرایط مالی را سخت‌تر می‌کند',
  'crypto trades as the high-beta tail of risk appetite': 'رمزارز دُم پرنوسانِ ریسک‌پذیری بازار است',
  'ETH historically follows BTC with higher beta': 'اتریوم معمولاً با بتای بالاتر از بیت‌کوین پیروی می‌کند',
  'high-beta majors follow BTC': 'ارزهای بزرگِ پرنوسان از بیت‌کوین پیروی می‌کنند',
  'tokenized markets inherit crypto-market liquidity conditions': 'بازارهای توکنیزه شرایط نقدینگی رمزارز را به ارث می‌برند',
  'energy feeds headline inflation': 'انرژی به تورم کل می‌رسد',
  'havens and crypto compete for the same fear bid': 'دارایی‌های امن و رمزارز بر سر همان تقاضای ترس رقابت می‌کنند',
  'the portfolio holds it': 'پرتفوی شما آن را نگه می‌دارد',
  'the portfolio holds RWA exposure': 'پرتفوی شما در دارایی‌های واقعی سهم دارد',
  'equity beta reaches the portfolio through risk appetite': 'بتای سهام از مسیر ریسک‌پذیری به پرتفوی می‌رسد'
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

const signedPct = (v, isPersian) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const s = `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${isPersian ? faNum(Math.abs(n)) : Math.abs(n)}${isPersian ? '\u066a' : '%'}`;
  return s;
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
  const thin = graph && (coverage?.edges ?? edges.length) < 3;
  const readNodes = local.nodes.filter((n) => n.state !== 'unread').length;

  return (
    <div className="aigw-panel acc-causal">
      <div className="gw-cols">
        <div className="gw-col">
      {/* ── the LOCAL chain: built from this pass's resolved readings ───────── */}
      <div className="aigw-sec" style={{ marginBottom: 4 }}>
        <WIcon name="chain" size={17} />
        {L('زنجیرهٔ علّی این دور', 'The causal chain of this pass')}
        <span className="aigw-pill ghost" style={{ marginInlineStart: 'auto' }}>
          {isPersian ? `${faNum(readNodes)} از ${faNum(local.nodes.length)} گره خوانده شد` : `${readNodes} of ${local.nodes.length} nodes read`}
        </span>
      </div>
      <div className="aigw-note" style={{ marginTop: 0, marginBottom: 8 }}>
        {L(
          'از نفت تا نقدینگی رمزارز؛ هر گره با عدد واقعی همین دور پر شده و اگر خوانش مستقیم نبود، جایگزین برچسب‌دار (پروکسی) می‌گیرد. زیر هر پیوند می‌بینی سازوکار چیست و بازار پایین‌دست واقعاً همان‌طور حرکت کرده یا نه.',
          'From oil to crypto liquidity: every node is filled with a real reading of this pass, falling back to a labelled stand-in (proxy) when the direct read is missing. Under each link you see the mechanism and whether the downstream market actually moved that way.'
        )}
      </div>
      <ChainView chain={local} L={L} isPersian={isPersian} />
        </div>

        <div className="gw-col">
      {/* ── the server graph: a complement, never the whole page ───────────── */}
      {phase === 'loading' && (
        <div className="aig-section" style={{ padding: 16, marginTop: 14 }}>
          <div className="aigw-skel" style={{ height: 14, width: '50%', marginBottom: 10 }} />
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="aigw-skel" style={{ height: 40, marginBottom: 8 }} />)}
          <div className="aigw-note">{L('در حال خواندن گراف علّی مغز جهانی…', 'Reading the global brain\u2019s causal graph…')}</div>
        </div>
      )}

      {phase === 'done' && graph && (
        <>
          <div className="aigw-sec" style={{ marginTop: 16, marginBottom: 6 }}>
            <WIcon name="brain" size={17} />
            {L('گراف علّی مغز جهانی', 'The global brain\u2019s causal graph')}
            {typeof impulse === 'number' ? (
              <span className={`aigw-pill ${impulse > 0.05 ? 'bad' : impulse < -0.05 ? 'up' : 'flat'}`} style={{ marginInlineStart: 'auto' }}>
                {L('تکانهٔ ریسک پرتفوی', 'portfolio risk impulse')} <Ltr>{impulse > 0 ? '+' : ''}{isPersian ? faNum(impulse) : impulse}</Ltr>
              </span>
            ) : null}
          </div>

          {coverage ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="aigw-pill info">{L('گره', 'nodes')} <Ltr>{isPersian ? faNum(coverage.nodes ?? nodes.length) : (coverage.nodes ?? nodes.length)}</Ltr></span>
              <span className="aigw-pill info">{L('یال', 'edges')} <Ltr>{isPersian ? faNum(coverage.edges ?? edges.length) : (coverage.edges ?? edges.length)}</Ltr></span>
              {thin ? (
                <span className="aigw-pill warn">
                  {L('گراف سرور در این دور کم‌یال بود؛ زنجیرهٔ علّی این دور از خوانش‌های همین دور ساخته شده است', 'the server graph was thin this pass; the chain of this pass is built from this pass\u2019s reads')}
                </span>
              ) : null}
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
                        <Ltr style={{ color: n.change24hPct >= 0 ? 'var(--up)' : 'var(--down)', marginInlineStart: 4 }}>{signedPct(n.change24hPct, isPersian)}</Ltr>
                      ) : null}
                      {n.attention ? <span style={{ color: 'var(--rgb-5)' }}> {'\u00d7'}{isPersian ? faNum(n.attention) : n.attention}</span> : null}
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
                {L('چرا بیت‌کوین امروز ریسک دارد؟ — راننده‌های علّی', `Why is ${why.assetLabel || 'BTC'} riskier today? — causal drivers`)}
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
                          ? <Ltr style={{ color: d.fromChange24hPct >= 0 ? 'var(--up)' : 'var(--down)', marginInlineStart: 4 }}>{signedPct(d.fromChange24hPct, isPersian)}</Ltr>
                          : d.attention ? <span style={{ color: 'var(--rgb-5)' }}> {'\u00d7'}{isPersian ? faNum(d.attention) : d.attention}</span> : null}
                        <span style={{ color: 'var(--text-3)', fontWeight: 700 }}> {isPersian ? '← بیت‌کوین' : `→ ${why.assetLabel || 'BTC'}`}</span>
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--text-3)', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                        {L('وزن', 'weight')} <Ltr>{isPersian ? faNum(d.sensitivity) : String(d.sensitivity)}</Ltr> · {isPersian ? (WHY_FA[d.why] || L('سازوکار مدل', 'model mechanism')) : d.why}
                      </div>
                    </div>
                    <b style={{ fontSize: 11, color: up ? 'var(--up)' : 'var(--down)' }}>
                      <Ltr>{`${up ? '+' : ''}${isPersian ? faNum(d.contribution) : d.contribution}`}</Ltr>
                    </b>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="aigw-note">
            {L(
              'حرکت گره‌ها واقعی و از همین دور است؛ وزن یال‌ها حساسیت‌های مرتبهٔ اولِ مدل‌اند، نه بتای اندازه‌گیری‌شده. یال فقط وقتی فعال می‌شود که هر دو سرش خوانده شده باشد.',
              'Node moves are real readings of this pass; edge weights are first-order model sensitivities, not measured betas. An edge activates only when both endpoints were read.'
            )}
          </div>
        </>
      )}

      {phase === 'error' && (
        <div className="aigw-note" style={{ marginTop: 12 }}>
          {L(
            'گراف علّی سرور در این دور در دسترس نبود؛ زنجیرهٔ علّی این دور از همین دور ساخته شده و کامل است.',
            'The server causal graph was unavailable this pass; the chain of this pass is built from this pass and stands on its own.'
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

export default CausalPanel;
