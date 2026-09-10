/**
 * InsAlert — the one place an insurance error is rendered.
 * ---------------------------------------------------------------------------
 * Pages used to write `<div className="ins-alert">{err}</div>` with `err` being
 * `e.message`, which is how a JSON-RPC dump reached the screen. They now store
 * the mapped object from `insuranceError()` and this component owns the shape:
 *
 *   · the sentence, on one line, for everyone;
 *   · the machine code / raw fragment, behind a `<details>` toggle, for support
 *     — present only when there is something worth copying, never inline.
 *
 * It still accepts a plain string, so a page that has not been mapped (or a
 * local validation message) renders exactly as before instead of crashing.
 */
import { useTranslation } from 'react-i18next';
import { InsIconAlert } from './InsuranceIcons.jsx';

export default function InsAlert({ error, tone = 'error', icon = true, className = '', style }) {
  const { t } = useTranslation();
  if (!error) return null;
  const mapped = typeof error === 'object';
  const text = mapped ? (error.text || error.message || '') : String(error);
  const technical = mapped ? String(error.technical || '').trim() : '';
  if (!text && !technical) return null;
  return (
    <div className={`ins-alert ins-alert--${tone}${className ? ` ${className}` : ''}`} style={style} role={tone === 'error' ? 'alert' : 'status'}>
      {icon ? <InsIconAlert /> : null}
      <span className="ins-alert-text">{text}</span>
      {technical ? (
        <details className="ins-alert-detail">
          <summary>{t('insurance.errors.detailToggle', { defaultValue: 'Details' })}</summary>
          <code>{technical}</code>
        </details>
      ) : null}
    </div>
  );
}
