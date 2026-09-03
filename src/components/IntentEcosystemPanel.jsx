/**
 * AGENTS & STRATEGIES, INSIDE THE OPERATIONS CENTER.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *   «قابلیت‌های ایجنت و استراتژی که در صفحه توسعه‌دهندگان بود حذف شده —
 *    آن‌ها را به مرکز عملیات برگردان و کارآمدشان کن»
 *
 * The agents and strategies catalog is implemented in `src/pages/IntentOS.jsx`
 * (`AgentCard`, `StrategyCard`, `CatalogSection`). That page is NOT routed —
 * `App.jsx` lazy-imports it purely to keep a dead-source audit quiet — so the
 * feature became unreachable to users while still passing every test. That is
 * precisely the disappearance the user is reporting.
 *
 * ─── WHY THIS IS A NEW COMPONENT AND NOT A MOVE ─────────────────────────────
 * Six assertions in `test/run.mjs` ("ecosystem catalog UI") grep the literal
 * TEXT of `src/pages/IntentOS.jsx` for `<CatalogSection`, `state ===
 * 'unavailable'`, `emptyLiveBody`, `entry.certification`, `EvidenceDrawer`
 * and `rel="noreferrer noopener"`. Cutting those components out of that file
 * would turn six green tests red without a single behavioural regression —
 * and, worse, would tempt someone to weaken the tests. `IntentOS.jsx` also
 * belongs to a different design system (`ios-*` / `.btn`), so its markup would
 * look foreign dropped into the `iaos-*` shell.
 *
 * So the SHARED part is shared and the presentation is native:
 *   · `src/lib/ecosystemCatalog.js` — the read-only, well-tested client, with
 *     all the honesty rules (certified⇔reviewer-issued, reputation dropped
 *     under 5 samples, https-only evidence, unavailable ≠ empty). Imported,
 *     not reimplemented. A second copy of those rules is how one of them
 *     eventually gets relaxed.
 *   · this file — `iaos-*` markup, fa/en/ar via `opsPanelStrings`.
 *
 * ─── WHAT "FUNCTIONAL" MEANS HERE, AND WHAT IT DOES NOT ─────────────────────
 * The user asked for these to work. What works is DISCOVERY: the panel reads
 * the live registry, pages it with the server's cursor, shows real
 * certification evidence and distinguishes all four honest states.
 *
 * There is deliberately NO run / install / sign / enable control, because the
 * server has no endpoint that would execute a third-party listing against a
 * user's wallet, and `phase2Schemas.js` fails closed on exactly that:
 * `withdrawFunds` is rejected and `mode` is forced to `approval_required`. A
 * button that looked like it ran an agent would be a lie about custody — the
 * one class of lie this codebase is most careful about. Writes (create,
 * submit, publish) stay in the Developers console, which authenticates the
 * publisher; this panel links there rather than forging an unauthenticated
 * form.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCatalog, fetchCertifications, localizedValue } from '../lib/ecosystemCatalog.js';
import { opsText } from '../lib/intent-ai/os/opsPanelStrings.js';
import { langOf } from '../lib/intent-ai/os/opsCatalogI18n.js';
import { IconShield, IconLink } from './Icons.jsx';
import { IconRobot, IconTarget } from './OpsIconSet.jsx';

/* A listing states its chains as numeric ids; show them as ids rather than
   inventing names for chains this build may not support. */
function chainSummary(list, locale) {
  if (!Array.isArray(list) || !list.length) return opsText('eco.anyChain', locale);
  return list.slice(0, 6).join(' · ') + (list.length > 6 ? ` +${list.length - 6}` : '');
}

/**
 * The certification evidence behind a badge.
 *
 * A badge nobody can check is decoration. This opens the actual certificate
 * rows: issuer, type, and either an https evidence link or a sha256 digest.
 * `fetchCertifications` has already dropped any non-https URI, so nothing
 * here can be an http:// or javascript: link.
 */
function EvidenceDrawer({ subjectId, locale }) {
  const [state, setState] = useState({ status: 'loading', items: [] });

  useEffect(() => {
    let alive = true;
    fetchCertifications(subjectId)
      .then((res) => { if (alive) setState(res); })
      .catch(() => { if (alive) setState({ status: 'error', items: [] }); });
    return () => { alive = false; };
  }, [subjectId]);

  if (state.status === 'loading') return <p className="iaos-eco-evidence">{opsText('eco.loading', locale)}</p>;
  if (!state.items?.length) return <p className="iaos-eco-evidence">{opsText('eco.unverified', locale)}</p>;

  return (
    <ul className="iaos-eco-evidence">
      {state.items.map((cert) => (
        <li key={cert.id}>
          <strong>{cert.issuer}</strong> · {cert.type} · {cert.status}
          {cert.evidence.map((ev, i) => (
            ev.uri
              ? <a key={i} href={ev.uri} target="_blank" rel="noreferrer noopener">{ev.type}</a>
              : <code key={i}>{ev.sha256.slice(0, 12)}…</code>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Facts, not controls. Every row is a claim the server made about a listing. */
function Fact({ label, value }) {
  return (
    <div className="iaos-eco-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ListingCard({ kind, entry, locale }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const lang = langOf(locale);
  const name = localizedValue(entry.name, lang, entry.id);
  const description = localizedValue(entry.description, lang, null);

  const facts = kind === 'agent'
    ? [
      [opsText('eco.execution', locale), opsText(`eco.mode.${entry.executionMode}`, locale)],
      [opsText('eco.chains', locale), chainSummary(entry.supportedChains, locale)],
      [opsText('eco.approval', locale), opsText('eco.required', locale)],
      [opsText('eco.withdraw', locale), opsText('eco.never', locale)]
    ]
    : [
      [opsText('eco.trigger', locale), opsText(`eco.trigger.${entry.trigger || 'manual'}`, locale)],
      [opsText('eco.maxAmount', locale), entry.policy?.maxAmountUsd == null ? opsText('eco.notStated', locale) : `$${entry.policy.maxAmountUsd}`],
      [opsText('eco.maxSlippage', locale), entry.policy?.maxSlippageBps == null ? opsText('eco.notStated', locale) : `${entry.policy.maxSlippageBps} bps`],
      [opsText('eco.assets', locale), entry.policy?.allowedAssets?.length ? entry.policy.allowedAssets.join(' · ') : opsText('eco.notStated', locale)],
      [opsText('eco.chains', locale), chainSummary(entry.policy?.allowedChains, locale)],
      [opsText('eco.approval', locale), opsText('eco.required', locale)],
      [opsText('eco.automatic', locale), opsText('eco.never', locale)]
    ];

  return (
    <article className="iaos-eco-card" data-testid={`eco-${kind}-${entry.id}`}>
      <header className="iaos-eco-card-head">
        <span className="iaos-eco-icon">{kind === 'agent' ? <IconRobot /> : <IconTarget />}</span>
        <div>
          <strong>{name}</strong>
          {description ? <small>{description}</small> : null}
        </div>
        {/*
         * `entry.verified` is derived by the client from the server's
         * certification block — never read off the row, so a listing that
         * simply sets `verified: true` on itself still renders unreviewed.
         */}
        <span className={`iaos-pill iaos-pill-${entry.verified ? 'ok' : 'idle'}`}>
          {entry.verified ? opsText('eco.verified', locale) : opsText('eco.unverified', locale)}
        </span>
      </header>

      {entry.certificationStale ? (
        <p className="iaos-eco-stale">{opsText('eco.staleCert', locale)}</p>
      ) : null}

      <div className="iaos-eco-facts">
        {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
      </div>

      {entry.reputation ? (
        <p className="iaos-eco-rep">
          {opsText('eco.reputation', locale)}: {Math.round(entry.reputation.successRate * 100)}%
          {' · '}{entry.reputation.sampleSize} {opsText('eco.samples', locale)}
        </p>
      ) : null}

      {entry.limitations?.length ? (
        <details className="iaos-eco-limits">
          <summary>{opsText('eco.limitations', locale)}</summary>
          <ul>{entry.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </details>
      ) : null}

      <footer className="iaos-eco-card-foot">
        {entry.publisherRef === 'telegram-user' ? (
          <small className="iaos-eco-publisher"><IconShield /> {opsText('eco.publisher', locale)}</small>
        ) : null}
        {entry.homepage ? (
          <a className="iaos-eco-link" href={entry.homepage} target="_blank" rel="noreferrer noopener">
            <IconLink /> {opsText('eco.homepage', locale)}
          </a>
        ) : null}
        {entry.verified ? (
          <button type="button" className="iaos-eco-evidence-btn" onClick={() => setShowEvidence((v) => !v)}>
            {opsText('eco.verified', locale)} ↗
          </button>
        ) : null}
      </footer>

      {showEvidence ? <EvidenceDrawer subjectId={entry.id} locale={locale} /> : null}
    </article>
  );
}

/**
 * One honest state machine, matching the one the catalog tab has always used:
 *   loading      — the request is in flight
 *   error        — the request failed; we claim nothing about the registry
 *   unavailable  — no durable registry is configured
 *   live + empty — the registry answered and nobody has listed anything
 *   live + rows  — the listings
 *
 * `error` and `unavailable` are separate on purpose. Collapsing them into one
 * "nothing here" is the bug that makes an outage look like an empty product.
 */
function CatalogList({ kind, state, locale, onRetry, onLoadMore }) {
  if (state.status === 'loading') {
    return <p className="iaos-eco-empty">{opsText('eco.loading', locale)}</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="iaos-eco-empty">
        <strong>{opsText('eco.errorTitle', locale)}</strong>
        <p>{opsText('eco.errorBody', locale)}</p>
        <button type="button" className="iaos-btn iss-ghost" onClick={onRetry}>{opsText('eco.retry', locale)}</button>
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <div className="iaos-eco-empty">
        <strong>{opsText('eco.unavailableTitle', locale)}</strong>
        <p>{opsText('eco.unavailableBody', locale)}</p>
      </div>
    );
  }
  if (!state.items.length) {
    return (
      <div className="iaos-eco-empty">
        <strong>{opsText('eco.emptyTitle', locale)}</strong>
        <p>{opsText('eco.emptyBody', locale)}</p>
      </div>
    );
  }
  return (
    <>
      <div className="iaos-eco-list">
        {state.items.map((entry) => <ListingCard key={entry.id} kind={kind} entry={entry} locale={locale} />)}
      </div>
      {state.hasMore ? (
        <button
          type="button"
          className="iaos-btn iss-ghost iaos-eco-more"
          disabled={state.loadingMore}
          onClick={() => onLoadMore(state.cursor)}
        >
          {state.loadingMore ? opsText('eco.loading', locale) : opsText('eco.loadMore', locale)}
        </button>
      ) : null}
      {/* A failed NEXT page must not wipe the rows already on screen. */}
      {state.pageError ? <p className="iaos-eco-page-error">{opsText('eco.pageError', locale)}</p> : null}
    </>
  );
}

const EMPTY = { status: 'loading', items: [], cursor: null, hasMore: false, loadingMore: false, pageError: false };

export function EcosystemPanel({ open, onClose, locale = 'fa', initialKind = 'agent' }) {
  const [kind, setKind] = useState(initialKind === 'strategy' ? 'strategy' : 'agent');
  const [byKind, setByKind] = useState({ agent: EMPTY, strategy: EMPTY });
  /* Guards against a slow first page landing after the user switched tabs and
     overwriting the tab they are actually looking at. */
  const reqRef = useRef(0);

  const load = useCallback((which) => {
    const seq = ++reqRef.current;
    setByKind((prev) => ({ ...prev, [which]: { ...EMPTY, status: 'loading' } }));
    fetchCatalog(which)
      .then((res) => {
        if (seq !== reqRef.current) return;
        setByKind((prev) => ({
          ...prev,
          [which]: {
            status: res.status,
            items: res.items || [],
            cursor: res.cursor || null,
            hasMore: Boolean(res.hasMore),
            loadingMore: false,
            pageError: false
          }
        }));
      })
      .catch(() => {
        if (seq !== reqRef.current) return;
        setByKind((prev) => ({ ...prev, [which]: { ...EMPTY, status: 'error' } }));
      });
  }, []);

  /* Fetch on open, and whenever the visible tab changes — but only once per
     tab: re-opening the panel should not refetch a catalog already in hand. */
  useEffect(() => {
    if (!open) return;
    if (byKind[kind].status === 'loading' && !byKind[kind].items.length) load(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  /* Page with the SERVER's cursor. Inventing an offset silently desynchronizes
     from a registry that is being written to while it is read. */
  const loadMore = useCallback((cursor) => {
    if (!cursor) return;
    setByKind((prev) => ({ ...prev, [kind]: { ...prev[kind], loadingMore: true, pageError: false } }));
    fetchCatalog(kind, { cursor })
      .then((res) => {
        setByKind((prev) => {
          const cur = prev[kind];
          if (res.status !== 'live') return { ...prev, [kind]: { ...cur, loadingMore: false, pageError: true } };
          const seen = new Set(cur.items.map((i) => i.id));
          return {
            ...prev,
            [kind]: {
              ...cur,
              items: [...cur.items, ...(res.items || []).filter((i) => !seen.has(i.id))],
              cursor: res.cursor || null,
              hasMore: Boolean(res.hasMore),
              loadingMore: false,
              pageError: false
            }
          };
        });
      })
      .catch(() => setByKind((prev) => ({ ...prev, [kind]: { ...prev[kind], loadingMore: false, pageError: true } })));
  }, [kind]);

  if (!open) return null;

  return (
    <div className="iaos-panel-overlay" role="dialog" aria-modal="true" aria-label={opsText('eco.agents', locale)}>
      <div className="iaos-panel iaos-eco-panel">
        <div className="iaos-panel-head">
          <h2>{opsText(kind === 'agent' ? 'eco.agents' : 'eco.strategies', locale)}</h2>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="iaos-ops-cats" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'agent'}
            className={`iaos-ops-cat${kind === 'agent' ? ' is-on' : ''}`}
            data-testid="eco-tab-agents"
            onClick={() => setKind('agent')}
          >
            <IconRobot /> {opsText('eco.agents', locale)}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'strategy'}
            className={`iaos-ops-cat${kind === 'strategy' ? ' is-on' : ''}`}
            data-testid="eco-tab-strategies"
            onClick={() => setKind('strategy')}
          >
            <IconTarget /> {opsText('eco.strategies', locale)}
          </button>
        </div>

        <div className="iaos-eco-body">
          <CatalogList
            kind={kind}
            state={byKind[kind]}
            locale={locale}
            onRetry={() => load(kind)}
            onLoadMore={loadMore}
          />
        </div>

        <p className="iaos-panel-note">{opsText('eco.listNote', locale)}</p>
      </div>
    </div>
  );
}

export default EcosystemPanel;
