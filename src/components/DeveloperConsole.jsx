import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasTelegramSession } from '../lib/telegramSession';
import {
  buildListingPayload,
  diagnoseTelegramAuth,
  whoamiBot,
  createProject,
  createProjectKey,
  listMyListings,
  listProjects,
  moveListing,
  revokeProjectKey,
  createListing
} from '../lib/developerConsole';

/**
 * DEVELOPER CONSOLE — the owner half of the ecosystem registry.
 *
 * Until now everything behind /api/ecosystem and /api/developer could only be
 * reached with curl: projects, API keys and the listing lifecycle all existed
 * server-side with no screen attached. This is that screen.
 *
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It never decides. Ownership, scopes, the publish gate and the certifier
 * allowlist are enforced by the server; this component renders state and
 * reports the exact refusal code when the server says no. It cannot run,
 * sign or execute a listing, because no such endpoint exists.
 *
 * THE API KEY SECRET
 * ---------------------------------------------------------------------------
 * Shown once, in memory, and never written to storage: the server keeps only
 * a sha256 hash and genuinely cannot re-issue it. The copy on screen says so,
 * because a developer who assumes they can find it later loses the key.
 */

const LISTING_TYPES = ['agent', 'strategy'];
const ACTIONS = { draft: ['submitted'], submitted: ['published', 'draft'], published: ['revoked'], revoked: ['draft'] };
const ACTION_BY_STATUS = { submitted: 'submit', published: 'publish', revoked: 'revoke', draft: 'draft', deleted: 'delete' };

const emptyForm = { id: '', name: '', description: '', chains: '1', executionMode: 'simulation-only', trigger: 'price', maxAmountUsd: '250', maxSlippageBps: '50' };
const AUTH_DIAGNOSIS_REASONS = new Set(['NO_INIT_DATA_SENT', 'BAD_SIGNATURE', 'EXPIRED']);
const isAuthFailure = (code) => code === 'AUTH_REQUIRED' || AUTH_DIAGNOSIS_REASONS.has(code);
const safeAuthReason = (reason) => AUTH_DIAGNOSIS_REASONS.has(reason) ? reason : 'UNKNOWN';

function Row({ children }) {
  return <div className="row-between" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>{children}</div>;
}

export default function DeveloperConsole() {
  const { t } = useTranslation();
  const session = hasTelegramSession();
  const [projects, setProjects] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [secret, setSecret] = useState(null);
  const [listings, setListings] = useState({ agent: null, strategy: null });
  const [type, setType] = useState('agent');
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  /* One place for the last server refusal. Auth failures are diagnosed and
     translated below; other server codes stay visible because they are useful
     to a developer and are not confused with the Telegram session problem. */
  const [notice, setNotice] = useState(null);
  const [authReason, setAuthReason] = useState(null);
  const [authDiagnostic, setAuthDiagnostic] = useState(null);
  /* Result of the server-side "which bot owns your token" check, shown inside
     the BAD_SIGNATURE checklist. Null until the owner runs it. */
  const [botCheck, setBotCheck] = useState(null);
  const [botCheckBusy, setBotCheckBusy] = useState(false);

  const checkBot = async () => {
    setBotCheckBusy(true);
    setBotCheck(await whoamiBot());
    setBotCheckBusy(false);
  };

  /*
   * One translated line for the whoami-bot outcome. The server answers with
   * the bot's PUBLIC username/id (never the token); a 401 means the owner
   * must run the curl from a terminal because the broken session cannot
   * authenticate the browser call.
   */
  const botCheckLine = () => {
    if (!botCheck) return null;
    if (botCheck.ok && botCheck.data?.telegramAccepted === true && botCheck.data?.bot) {
      return t('dev.console.authcheck.botIs', {
        username: botCheck.data.bot.username ? `@${botCheck.data.bot.username}` : '?',
        id: String(botCheck.data.bot.id ?? '?')
      });
    }
    if (botCheck.ok && botCheck.data?.telegramAccepted === false) {
      return t('dev.console.authcheck.tokenRejected');
    }
    if (botCheck.ok && botCheck.data?.fullDiagnostics) {
      return t('dev.console.authcheck.cronMissing');
    }
    if (!botCheck.ok && botCheck.status === 401) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return t('dev.console.authcheck.needKey', { url: `${origin}/api/telegram/whoami-bot` });
    }
    return t('dev.console.authcheck.failed');
  };

  const serverFindings = () => {
    if (!authDiagnostic) return [];
    const hashLength = Number(authDiagnostic.hashLength);
    const shortHash = Number.isFinite(hashLength) && hashLength !== 64;
    const transit = authDiagnostic.transportMatch === 'MISMATCH' || shortHash;
    const poison = authDiagnostic.tokenHadQuotes === true || authDiagnostic.tokenHadInvisibleChars === true || authDiagnostic.tokenShapeValid === false;
    const lines = [];
    if (transit) lines.push(t('dev.console.authcheck.findTransit'));
    if (poison) lines.push(t('dev.console.authcheck.findPoison'));
    if (!transit && !poison && authDiagnostic.transportMatch === 'MATCH') lines.push(t('dev.console.authcheck.findOtherKey'));
    if (authDiagnostic.tokenFingerprint) {
      lines.push(t('dev.console.authcheck.findFp', {
        fingerprint: authDiagnostic.tokenFingerprint,
        length: String(authDiagnostic.tokenLength ?? '?')
      }));
    } else {
      lines.push(t('dev.console.authcheck.noToken'));
    }
    return lines;
  };

  const refresh = useCallback(async () => {
    if (!session) return;
    const [projectResult, agents, strategies] = await Promise.all([listProjects(), listMyListings('agent'), listMyListings('strategy')]);
    setProjects(projectResult.ok ? projectResult.data || [] : { error: projectResult.code });
    setListings({
      agent: agents.ok ? agents.data || [] : { error: agents.code },
      strategy: strategies.ok ? strategies.data || [] : { error: strategies.code }
    });

    const authFailure = [projectResult, agents, strategies].find((result) => !result.ok && isAuthFailure(result.code));
    if (authFailure) {
      const diagnosis = await diagnoseTelegramAuth();
      setAuthReason(safeAuthReason(diagnosis.data?.reason || authFailure.code));
      setAuthDiagnostic(diagnosis.data || null);
      setNotice({ level: 'danger', auth: true });
    } else {
      setAuthReason(null);
      setAuthDiagnostic(null);
    }
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn) => {
    setBusy(true);
    setNotice(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok && isAuthFailure(result.code)) {
      const diagnosis = await diagnoseTelegramAuth();
      setAuthReason(safeAuthReason(diagnosis.data?.reason || result.code));
      setAuthDiagnostic(diagnosis.data || null);
      setNotice({ level: 'danger', auth: true });
    } else if (!result.ok) {
      setAuthDiagnostic(null);
      setNotice({ level: 'danger', code: result.code });
    } else {
      setAuthReason(null);
      setAuthDiagnostic(null);
      setNotice({ level: 'success', code: 'OK' });
    }
    await refresh();
    return result;
  };

  const retryAuth = async () => {
    setBusy(true);
    setNotice(null);
    await refresh();
    setBusy(false);
  };

  if (!session) {
    return (
      <section className="card" style={{ marginTop: 12 }}>
        <p className="section-label">{t('dev.console.title')}</p>
        <p className="prose-sm">{t('dev.console.signedOut')}</p>
      </section>
    );
  }

  const rows = Array.isArray(listings[type]) ? listings[type] : [];
  const listingError = listings[type]?.error || null;
  const findingLines = authReason === 'BAD_SIGNATURE' ? serverFindings() : [];

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <p className="section-label">{t('dev.console.title')}</p>
      <p className="prose-sm">{t('dev.console.body')}</p>

      {notice?.auth && (
        <div className="notice notice-danger" role="alert">
          <p style={{ margin: 0 }}>{t(`dev.console.auth.${authReason || 'UNKNOWN'}`)}</p>
          {/* BAD_SIGNATURE has exactly three owner-fixable causes and they
              need OPPOSITE fixes (reopen the app / redeploy / replace the
              token). A numbered checklist plus a live server-side bot check
              turns "could not verify" into an actionable verdict without
              guessing. */}
          {authReason === 'BAD_SIGNATURE' && findingLines.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <b>{t('dev.console.authcheck.findingsTitle')}</b>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: 20, textAlign: 'start' }}>
                {findingLines.map((line) => <li key={line} style={{ marginBottom: 4 }}>{line}</li>)}
              </ul>
            </div>
          )}
          {authReason === 'BAD_SIGNATURE' && (
            <ol style={{ margin: '10px 0 0', paddingInlineStart: 20, textAlign: 'start' }}>
              <li style={{ marginBottom: 6 }}>{t('dev.console.authcheck.step1')}</li>
              <li style={{ marginBottom: 6 }}>{t('dev.console.authcheck.step2')}</li>
              <li>
                {t('dev.console.authcheck.step3')}
                <div style={{ marginTop: 6 }}>
                  <button className="btn btn-ghost btn-sm" type="button" disabled={botCheckBusy} onClick={checkBot}>
                    {botCheckBusy ? t('dev.console.authcheck.checking') : t('dev.console.authcheck.run')}
                  </button>
                </div>
                {botCheck && (
                  <small style={{ display: 'block', marginTop: 6, wordBreak: 'break-word' }}>
                    {botCheckLine()}
                    {botCheck.ok && botCheck.data?.fullDiagnostics && (
                      <>
                        <br />
                        {t('dev.console.authcheck.cronMissing')}
                      </>
                    )}
                    {botCheck.ok && botCheck.data?.usernameMatches === false && (
                      <>
                        <br />
                        <b>{t('dev.console.authcheck.wrongBot')}</b>
                      </>
                    )}
                  </small>
                )}
              </li>
            </ol>
          )}
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} style={{ marginTop: 8 }} onClick={retryAuth}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {notice && !notice.auth && (
        <div className={notice.level === 'danger' ? 'notice notice-danger' : 'notice'} role="status">
          <p style={{ margin: 0 }}>
            {notice.code === 'OK' ? t('dev.console.done') : t('dev.console.refused', { code: notice.code })}
          </p>
          {/* Operational refusals get a translated next-step under the code so a
              mobile operator does not have to open GO-LIVE mid-flow. Missing
              hint keys fall back to a generic string — never an empty row. */}
          {notice.code && notice.code !== 'OK' && (
            <small style={{ display: 'block', marginTop: 6, opacity: .85 }}>
              {t([`dev.console.hint.${notice.code}`, 'dev.console.hint._default'])}
            </small>
          )}
        </div>
      )}

      {/* ------------------------------ projects ------------------------------ */}
      <p className="section-label" style={{ marginTop: 12 }}>{t('dev.console.projects')}</p>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          value={projectName}
          maxLength={48}
          placeholder={t('dev.projectName')}
          aria-label={t('dev.projectName')}
          onChange={(event) => setProjectName(event.target.value)}
        />
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !projectName.trim()}
          onClick={() => run(() => createProject(projectName.trim(), ['read_network', 'manage_listings'])).then(() => setProjectName(''))}
        >
          {t('dev.console.createProject')}
        </button>
      </div>

      {projects?.error && !isAuthFailure(projects.error) && <small role="alert">{t('dev.console.refused', { code: projects.error })}</small>}
      {Array.isArray(projects) && projects.length === 0 && <small style={{ display: 'block', marginTop: 8, opacity: .75 }}>{t('dev.console.noProjects')}</small>}
      {Array.isArray(projects) && projects.map((project) => (
        <Row key={project.id}>
          <span>
            <b>{project.name}</b>
            <small style={{ display: 'block', opacity: .75 }}>{project.environment} · {project.scopes.join(' · ')}</small>
          </span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={busy}
            onClick={async () => {
              const result = await run(() => createProjectKey(project.id, ['manage_listings']));
              /* Held in memory only, and only until the next render the user
                 dismisses: the server cannot give it back. */
              if (result.ok && result.data?.secret) setSecret({ projectId: project.id, value: result.data.secret });
            }}
          >
            {t('dev.console.newKey')}
          </button>
        </Row>
      ))}

      {secret && (
        <div className="notice" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>{t('dev.console.secretOnce')}</p>
          <code className="mono" style={{ display: 'block', wordBreak: 'break-all', margin: '6px 0' }}>{secret.value}</code>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(secret.value)}>{t('common.copy')}</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSecret(null)}>{t('dev.console.hideSecret')}</button>
          </div>
        </div>
      )}

      {/* ------------------------------ listings ------------------------------ */}
      <p className="section-label" style={{ marginTop: 14 }}>{t('dev.console.listings')}</p>
      <div className="row" style={{ gap: 8 }}>
        {LISTING_TYPES.map((item) => (
          <button
            key={item}
            type="button"
            className={`btn btn-sm ${type === item ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setType(item); setForm(emptyForm); }}
          >
            {t(`dev.console.type.${item}`)}
          </button>
        ))}
      </div>

      {listingError && !isAuthFailure(listingError) && <small role="alert">{t('dev.console.refused', { code: listingError })}</small>}
      {!listingError && rows.length === 0 && <small style={{ display: 'block', marginTop: 8, opacity: .75 }}>{t('dev.console.noListings')}</small>}

      {rows.map((row) => (
        <div key={row.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
          <div className="row-between">
            <span>
              <b>{row.name?.en || row.id}</b>
              <small className="mono" style={{ display: 'block', opacity: .7 }}>{row.id}</small>
            </span>
            <span className={`pill ${row.visibleInCatalog ? 'pill-mint' : 'pill-neutral'}`}>{t(`dev.console.status.${row.status}`)}</span>
          </div>
          {/* Why a published listing is invisible is the single most confusing
              state in the whole flow, so it is spelled out rather than implied. */}
          {row.blockedReason && <small style={{ display: 'block', marginTop: 4 }}>{t(`dev.console.blocked.${row.blockedReason}`)}</small>}
          {row.verification?.status === 'certified' && (
            <small style={{ display: 'block', marginTop: 4 }}>{t('intentOS.catalog.certifiedBy', { issuer: row.verification.issuers.join(' · ') })}</small>
          )}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {(ACTIONS[row.status] || []).map((next) => (
              <button
                key={next}
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => run(() => moveListing(type, row.id, ACTION_BY_STATUS[next]))}
              >
                {t(`dev.console.action.${ACTION_BY_STATUS[next]}`)}
              </button>
            ))}
            {row.status === 'draft' && (
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => run(() => moveListing(type, row.id, 'delete'))}>
                {t('dev.console.action.delete')}
              </button>
            )}
          </div>
        </div>
      ))}

      {/* --------------------------- new draft form --------------------------- */}
      <p className="section-label" style={{ marginTop: 14 }}>{t('dev.console.newListing')}</p>
      <div className="stack" style={{ gap: 8 }}>
        <input className="input" value={form.id} placeholder={t('dev.console.field.id')} aria-label={t('dev.console.field.id')} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input className="input" value={form.name} placeholder={t('dev.console.field.name')} aria-label={t('dev.console.field.name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" value={form.description} placeholder={t('dev.console.field.description')} aria-label={t('dev.console.field.description')} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input className="input" value={form.chains} placeholder={t('dev.console.field.chains')} aria-label={t('dev.console.field.chains')} onChange={(e) => setForm({ ...form, chains: e.target.value })} />
        {type === 'agent' ? (
          <select className="input" value={form.executionMode} aria-label={t('intentOS.agents.execution')} onChange={(e) => setForm({ ...form, executionMode: e.target.value })}>
            <option value="simulation-only">{t('intentOS.agents.mode.simulation-only')}</option>
            <option value="manual">{t('intentOS.agents.mode.manual')}</option>
          </select>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" value={form.maxAmountUsd} placeholder={t('intentOS.strategies.maxAmount')} aria-label={t('intentOS.strategies.maxAmount')} onChange={(e) => setForm({ ...form, maxAmountUsd: e.target.value })} />
            <input className="input" value={form.maxSlippageBps} placeholder={t('intentOS.strategies.maxSlippage')} aria-label={t('intentOS.strategies.maxSlippage')} onChange={(e) => setForm({ ...form, maxSlippageBps: e.target.value })} />
          </div>
        )}
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !form.id.trim() || !form.name.trim()}
          onClick={() => run(() => createListing(type, buildListingPayload(type, form))).then((result) => { if (result.ok) setForm(emptyForm); })}
        >
          {t('dev.console.createListing')}
        </button>
      </div>
      <small style={{ display: 'block', marginTop: 10, opacity: .75 }}>{t('dev.console.note')}</small>
    </section>
  );
}
