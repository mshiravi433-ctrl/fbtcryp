/**
 * WORLD CONSOLE — the macro transmission chain, drawn once and used twice
 * (the capital-flow tab and the causal tab). Every node carries its real
 * reading and its provenance; every link carries a sentence and — when both
 * ends moved by more than a quiet day — a test of whether the downstream
 * market actually did what the mechanism predicts.
 */
import { WIcon, DirMark } from './icons.jsx';
import { faNum } from './format.jsx';
import { QualityBadge, Ltr } from './parts.jsx';

export function ChainView({ chain, L, isPersian }) {
  return (
    <>
      <div className="aigw-chain">
        {chain.nodes.map((n, i) => (
          <div key={n.id}>
            {i > 0 ? (
              <div className={`aigw-chain-arrow ${chain.edges[i - 1]?.lit ? 'lit' : ''}`} aria-hidden={chain.edges[i - 1]?.mechFa ? undefined : 'true'}>
                <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M7 1v11" /><path d="m2.5 8.5 4.5 5 4.5-5" /></svg>
                {chain.edges[i - 1]?.lit && chain.edges[i - 1]?.mechFa ? (
                  <span className="aigw-chain-cap">
                    {isPersian ? chain.edges[i - 1].mechFa : chain.edges[i - 1].mechEn}
                    {chain.edges[i - 1].agree !== null ? (
                      <b className={chain.edges[i - 1].agree ? 'ok' : 'no'}>
                        {chain.edges[i - 1].agree ? L('همخوان', 'agrees') : L('ناهمخوان', 'contradicts')}
                      </b>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className={`aigw-chain-node state-${n.state}`}>
              <span className="aigw-chain-ico"><WIcon name={n.icon} size={17} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 850, color: 'var(--text-1)' }}>
                  {isPersian ? n.fa : n.en}
                  {n.state !== 'unread' && n.quality ? <QualityBadge quality={n.quality} isPersian={isPersian} /> : null}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                  {n.state === 'read' ? ((isPersian ? n.sourceFa : n.sourceEn) ? `${L('منبع', 'source')}: ${isPersian ? n.sourceFa : n.sourceEn}` : L('خوانده شد', 'read'))
                    : n.state === 'proxy' ? (isPersian ? n.noteFa : n.noteEn)
                      : n.state === 'model' ? (isPersian ? n.noteFa : n.noteEn)
                        : L('خوانده نشد', 'unread')}
                </div>
                {(isPersian ? n.evidenceFa : n.evidence) ? <div className="aigw-chain-ev">{isPersian ? n.evidenceFa : <Ltr>{n.evidence}</Ltr>}</div> : null}
              </div>
              {n.value ? (
                <span className={`aigw-pill ${n.dir === 'up' ? 'up' : n.dir === 'down' ? 'down' : 'flat'}`}>
                  <DirMark dir={n.dir} size={9} /><Ltr>{isPersian ? (n.valueFa || n.value) : n.value}</Ltr>
                </span>
              ) : n.state === 'read' ? <span className="aigw-pill flat">{L('خوانده شد', 'read')}</span> : <span className="aigw-pill ghost">—</span>}
            </div>
          </div>
        ))}
      </div>
      {chain.consistency && chain.consistency.tested > 0 ? (
        <div className="aigw-note" role="status">
          {L(
            `از ${faNum(chain.consistency.tested)} پیوند قابل‌سنجش، ${faNum(chain.consistency.agreed)} مورد با سازوکار نظری همخوان بود.`,
            `${chain.consistency.agreed} of ${chain.consistency.tested} testable links agreed with the textbook mechanism.`
          )}
        </div>
      ) : null}
    </>
  );
}

export default ChainView;
