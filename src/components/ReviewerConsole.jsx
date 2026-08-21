import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasTelegramSession } from '../lib/telegramSession';
import {
  buildEvidence,
  certifierStatus,
  issueCertification,
  revokeCertification,
  reviewQueue
} from '../lib/developerConsole';

/**
 * REVIEWER CONSOLE — issuing and withdrawing the only badge that means
 * anything in this system.
 *
 * WHY IT IS ALLOWED TO EXIST AT ALL
 * ---------------------------------------------------------------------------
 * The allowlist lives in `ECOSYSTEM_CERTIFIERS` and is checked on the server
 * for every issue and revoke. This component asks `/api/ecosystem/certifier`
 * whether to render itself, which is a CONVENIENCE: a user who forces it open
 * still cannot certify anything, they just get 403 codes on screen.
 *
 * WHAT A REVIEWER SEES
 * ---------------------------------------------------------------------------
 * The submitted listing exactly as the public would see it, and nothing about
 * who submitted it. Reviewing the account instead of the artefact is how a
 * review pipeline turns into a favour pipeline, so the queue endpoint does not
 * return an owner at all.
 *
 * Evidence is required and must be checkable — an https link or a sha256
 * digest. The server refuses free text, and so does the hint under the field:
 * evidence nobody can verify is just a longer way of saying "trust me".
 */

const emptyForm = { subjectId: '', subjectType: 'agent', certificationType: 'sandbox_reviewed', evidence: '', evidenceType: 'sandbox_test_run' };

export default function ReviewerConsole() {
  const { t } = useTranslation();
  const session = hasTelegramSession();
  const [status, setStatus] = useState(null);
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    const who = await certifierStatus();
    if (!who.ok || !who.data?.isCertifier) {
      /* Keep the payload even when the caller is not a reviewer: it carries
         the setup line for an operator whose allowlist is still empty. */
      setStatus(who.ok ? who.data : null);
      setQueue([]);
      return;
    }
    setStatus(who.data);
    const pending = await reviewQueue();
    setQueue(pending.ok ? pending.data || [] : []);
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!session || !status) return null;

  /*
   * NOBODY can certify yet. That is the honest default — an unconfigured
   * review pipeline yields an empty catalog rather than a self-certified one —
   * but it is also the single question an operator will otherwise file a bug
   * about ("I published it, why is the catalog empty?"). So when the allowlist
   * is unset we render the one-line fix, with the caller's own id filled in.
   */
  if (!status.configured) {
    const line = `${status.callerId}:FBT Review`;
    return (
      <section className="card" style={{ marginTop: 12 }}>
        <p className="section-label">{t('dev.review.setupTitle')}</p>
        <p className="prose-sm">{t('dev.review.setupBody', { envVar: status.envVar })}</p>
        <code className="mono" style={{ display: 'block', wordBreak: 'break-all', margin: '6px 0' }}>{status.envVar}={line}</code>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(`${status.envVar}=${line}`)}>{t('common.copy')}</button>
        <small style={{ display: 'block', marginTop: 8, opacity: .75 }}>{t('dev.review.setupNote')}</small>
      </section>
    );
  }

  /* Configured, but this account is not a reviewer → render nothing. No
     teaser: an invitation to a permission you cannot request is just noise. */
  if (!status.isCertifier) return null;

  const run = async (fn) => {
    setBusy(true);
    setNotice(null);
    const result = await fn();
    setBusy(false);
    setNotice({ level: result.ok ? 'success' : 'danger', code: result.ok ? 'OK' : result.code });
    await refresh();
    return result;
  };

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <p className="section-label">{t('dev.review.title')}</p>
      <p className="prose-sm">{t('dev.review.body', { issuer: status.label })}</p>

      {notice && (
        <p className={notice.level === 'danger' ? 'notice notice-danger' : 'notice'} role="status">
          {notice.code === 'OK' ? t('dev.console.done') : t('dev.console.refused', { code: notice.code })}
        </p>
      )}

      <p className="section-label" style={{ marginTop: 12 }}>{t('dev.review.queue')}</p>
      {queue.length === 0 && <small style={{ display: 'block', opacity: .75 }}>{t('dev.review.emptyQueue')}</small>}
      {queue.map((row) => (
        <div key={`${row.type}:${row.id}`} style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
          <div className="row-between">
            <span>
              <b>{row.name?.en || row.id}</b>
              <small className="mono" style={{ display: 'block', opacity: .7 }}>{row.type} · {row.id}</small>
            </span>
            <span className="pill pill-neutral">{t(`dev.console.status.${row.status}`)}</span>
          </div>
          {row.description?.en && <small style={{ display: 'block', marginTop: 4 }}>{row.description.en}</small>}
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            style={{ marginTop: 6 }}
            onClick={() => setForm({ ...form, subjectId: row.id, subjectType: row.type })}
          >
            {t('dev.review.prefill')}
          </button>
        </div>
      ))}

      <p className="section-label" style={{ marginTop: 14 }}>{t('dev.review.issue')}</p>
      <div className="stack" style={{ gap: 8 }}>
        <input className="input" value={form.subjectId} placeholder={t('dev.review.subjectId')} aria-label={t('dev.review.subjectId')} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} />
        <select className="input" value={form.subjectType} aria-label={t('dev.review.subjectType')} onChange={(e) => setForm({ ...form, subjectType: e.target.value })}>
          {['agent', 'strategy', 'liquidity', 'project', 'solver'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="input" value={form.certificationType} aria-label={t('dev.review.certificationType')} onChange={(e) => setForm({ ...form, certificationType: e.target.value })}>
          {(status.certificationTypes || []).map((item) => <option key={item} value={item}>{t(`intentOS.catalog.certificationType.${item}`)}</option>)}
        </select>
        <select className="input" value={form.evidenceType} aria-label={t('dev.review.evidenceType')} onChange={(e) => setForm({ ...form, evidenceType: e.target.value })}>
          {(status.evidenceTypes || []).map((item) => <option key={item} value={item}>{t(`dev.review.evidence.${item}`)}</option>)}
        </select>
        <input className="input" value={form.evidence} placeholder={t('dev.review.evidenceValue')} aria-label={t('dev.review.evidenceValue')} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
        <small style={{ opacity: .75 }}>{t('dev.review.evidenceHint')}</small>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !form.subjectId.trim() || !form.evidence.trim()}
          onClick={() => run(() => issueCertification({
            subjectId: form.subjectId.trim().toLowerCase(),
            subjectType: form.subjectType,
            certificationType: form.certificationType,
            evidence: buildEvidence(form)
          })).then((result) => { if (result.ok) setForm(emptyForm); })}
        >
          {t('dev.review.issueButton')}
        </button>
      </div>

      <p className="section-label" style={{ marginTop: 14 }}>{t('dev.review.revoke')}</p>
      <RevokeCertification busy={busy} onRevoke={(id) => run(() => revokeCertification(id))} t={t} />
      <small style={{ display: 'block', marginTop: 10, opacity: .75 }}>{t('dev.review.note')}</small>
    </section>
  );
}

function RevokeCertification({ busy, onRevoke, t }) {
  const [id, setId] = useState('');
  return (
    <div className="row" style={{ gap: 8 }}>
      <input className="input" value={id} placeholder={t('dev.review.certificationId')} aria-label={t('dev.review.certificationId')} onChange={(event) => setId(event.target.value)} />
      <button className="btn btn-ghost" type="button" disabled={busy || !id.trim()} onClick={() => onRevoke(id.trim()).then(() => setId(''))}>
        {t('dev.review.revokeButton')}
      </button>
    </div>
  );
}
