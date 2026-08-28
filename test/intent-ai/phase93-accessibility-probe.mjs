/**
 * PHASE 93 — ACCESSIBILITY
 * The Intent AI panel has to work with a keyboard and a screen reader, and its
 * text has to be readable. This probe audits described controls and then scans
 * the real panel source for the defects that matter.
 */
import { readFileSync } from 'node:fs';
import {
  contrastRatio, meetsContrast, auditControl, auditDialog, auditScreen, assertAccessible,
  CONTRAST_AA, CONTRAST_AA_LARGE, MIN_TARGET_PX, A11Y_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
const html = readFileSync('index.html', 'utf8');

try {
  /* ---------- contrast is measured, not guessed ---------- */
  check('black on white is maximum contrast', contrastRatio('#000000', '#ffffff') === 21);
  check('white on white has no contrast', contrastRatio('#ffffff', '#ffffff') === 1);
  check('shorthand hex is understood', contrastRatio('#000', '#fff') === 21);
  check('a colour we cannot read returns null, not a guess', contrastRatio('rebeccapurple', '#fff') === null);
  check('readable body text passes AA', meetsContrast({ foreground: '#111111', background: '#ffffff' }).ok === true);
  check('grey on white fails AA', meetsContrast({ foreground: '#a0a0a0', background: '#ffffff' }).ok === false);
  check('the failing contrast is a translatable notice', meetsContrast({ foreground: '#a0a0a0', background: '#ffffff' }).i18nKey === 'intentAI.a11y.contrastLow');
  check('large text uses the lower AA threshold', meetsContrast({ foreground: '#949494', background: '#ffffff', large: true }).required === CONTRAST_AA_LARGE);
  check('body text uses the 4.5 threshold', meetsContrast({ foreground: '#000', background: '#fff' }).required === CONTRAST_AA);
  check('an unmeasurable contrast fails closed', meetsContrast({ foreground: 'var(--fg)', background: '#fff' }).ok === false);

  /* ---------- controls ---------- */
  check('a labelled native button passes', auditControl({ id: 'send', tag: 'button', text: 'Send' }).ok === true);
  check('a button with no name fails', auditControl({ id: 'x', tag: 'button' }).findings.includes('NO_ACCESSIBLE_NAME'));
  check('an icon-only button without aria-label fails',
    auditControl({ id: 'close', tag: 'button', iconOnly: true, text: '✕' }).findings.includes('ICON_WITHOUT_LABEL'));
  check('an icon-only button with aria-label passes',
    auditControl({ id: 'close', tag: 'button', iconOnly: true, ariaLabel: 'Close' }).ok === true);
  const clickableDiv = auditControl({ id: 'row', tag: 'div', onClick: true, text: 'Open' });
  check('a clickable div is not keyboard reachable', clickableDiv.findings.includes('NOT_KEYBOARD_REACHABLE'));
  check('a clickable div has no role', clickableDiv.findings.includes('NO_ROLE'));
  check('a clickable div is mouse-only', clickableDiv.findings.includes('MOUSE_ONLY'));
  check('a properly wired div passes',
    auditControl({ id: 'row', tag: 'div', role: 'button', tabIndex: 0, onClick: true, onKeyDown: true, text: 'Open' }).ok === true);
  check('a positive tabindex is a defect', auditControl({ tag: 'button', text: 'x', tabIndex: 3 }).findings.includes('POSITIVE_TABINDEX'));
  check('a tiny tap target is a defect', auditControl({ tag: 'button', text: 'x', sizePx: 24 }).findings.includes('TARGET_TOO_SMALL'));
  check('a 44px target is fine', auditControl({ tag: 'button', text: 'x', sizePx: MIN_TARGET_PX }).ok === true);
  check('a low-contrast control is a defect',
    auditControl({ tag: 'button', text: 'x', foreground: '#bbbbbb', background: '#ffffff' }).findings.includes('LOW_CONTRAST'));
  check('static text is not audited as a control', auditControl({ tag: 'p', text: 'hello' }).interactive === false);

  /* ---------- dialogs ---------- */
  const goodDialog = { id: 'gate', role: 'dialog', ariaLabel: 'Confirm', ariaModal: true, trapsFocus: true, restoresFocus: true, closeOnEscape: true };
  check('a well-built dialog passes', auditDialog(goodDialog).ok === true);
  check('an unnamed dialog fails', auditDialog({ ...goodDialog, ariaLabel: null }).findings.includes('DIALOG_WITHOUT_NAME'));
  check('a dialog that does not trap focus fails', auditDialog({ ...goodDialog, trapsFocus: false }).findings.includes('FOCUS_NOT_TRAPPED'));
  check('a dialog that loses focus on close fails', auditDialog({ ...goodDialog, restoresFocus: false }).findings.includes('FOCUS_NOT_RESTORED'));
  check('a dialog with no escape fails', auditDialog({ ...goodDialog, closeOnEscape: false }).findings.includes('NO_ESCAPE'));
  check('a non-modal dialog fails', auditDialog({ ...goodDialog, ariaModal: false }).findings.includes('NOT_MODAL'));

  /* ---------- a whole screen ---------- */
  const clean = auditScreen({
    screen: 'intent-ai-panel',
    controls: [
      { id: 'send', tag: 'button', text: 'Send' },
      { id: 'stop', tag: 'button', ariaLabel: 'Emergency stop', iconOnly: true },
      { id: 'input', tag: 'input', ariaLabel: 'Your intent' }
    ],
    dialogs: [goodDialog]
  });
  check('a clean screen passes', clean.ok === true && clean.schema === A11Y_SCHEMA);
  check('the clean screen is keyboard complete', clean.keyboardComplete === true);
  check('the clean screen counts what it checked', clean.checked === 4);
  check('the clean result is a translatable notice', clean.i18nKey === 'intentAI.a11y.screenOk');
  const dirty = auditScreen({ screen: 'x', controls: [{ id: 'row', tag: 'div', onClick: true }] });
  check('a screen with a defect fails', dirty.ok === false);
  check('the defective screen is not keyboard complete', dirty.keyboardComplete === false);
  check('the failing control is named', dirty.failing[0].id === 'row');
  check('the failure count is reported for the user', dirty.i18nParams.failing === 1);

  /* ---------- the guard ---------- */
  check('an honest report passes the guard', assertAccessible(clean).ok === true);
  check('a report passing with failures is caught',
    assertAccessible({ ...dirty, ok: true }).reasons.includes('PASSED_WITH_FAILURES'));
  check('a report passing without keyboard access is caught',
    assertAccessible({ schema: A11Y_SCHEMA, ok: true, failing: [], keyboardComplete: false, checked: 3 }).reasons.includes('PASSED_WITHOUT_KEYBOARD_ACCESS'));
  check('an empty audit cannot be declared clean',
    assertAccessible({ schema: A11Y_SCHEMA, ok: true, failing: [], keyboardComplete: true, checked: 0 }).reasons.includes('PASSED_WITHOUT_CHECKING_ANYTHING'));
  check('something that is not a report is rejected', assertAccessible({ ok: true }).ok === false);

  /* ---------- the real panel source ---------- */
  const interactiveTags = panel.match(/<(button|input|select|textarea)\b/g) || [];
  check('the panel actually has interactive controls', interactiveTags.length > 20);
  check('every panel control is a native focusable element (no role=button divs)',
    /<div[^>]*role="button"/.test(panel) === false);
  const clickableDivs = (panel.match(/<div[^>]*onClick=/g) || []);
  check('the only clickable non-button elements are the modal backdrop and its stopPropagation guard',
    clickableDivs.length <= 2);
  check('the modal is announced as a dialog', /role="dialog"/.test(panel));
  check('the modal is modal', /aria-modal="true"/.test(panel));
  check('the modal has an accessible name', /role="dialog"[\s\S]{0,200}aria-label=/.test(panel));
  check('the modal close button has an aria-label', /ia-modal-close[\s\S]{0,160}aria-label=/.test(panel));
  check('the icon-only info button has an aria-label', /aria-label=\{t\('intentAI\.externalInfo\.button'\)\}/.test(panel));
  check('the mode switcher is a labelled group', /role="group"[\s\S]{0,120}aria-label=/.test(panel));
  check('live activation state is announced to screen readers', /role="status"/.test(panel));
  check('no positive tabindex anywhere in the panel', /tabIndex=\{[1-9]/.test(panel) === false);
  check('the panel never removes focus outlines', /outline:\s*(none|0)/.test(panel) === false);
  check('every aria-label in the panel comes from i18n, never a hardcoded string',
    (panel.match(/aria-label=[^\s>]*/g) || []).every((m) => m.startsWith('aria-label={t(')));
  check('the viewport still reaches the safe area', /viewport-fit=cover/.test(html));
  check('the document declares its language and direction', /<html lang="[a-z]{2}" dir="(rtl|ltr)"/.test(html));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the a11y copy is translated in en, fa and ar',
    locales.every((loc) => ['screenOk', 'screenFails', 'controlOk', 'controlFails', 'contrastOk', 'contrastLow', 'contrastUnknown']
      .every((k) => typeof loc?.intentAI?.a11y?.[k] === 'string')));

  /* ------------------------------------------------------------------ */
  /* The newly-wired surfaces are held to the same phase-93 bar.          */
  /* ------------------------------------------------------------------ */
  /*
   * Wiring a module into the UI is where accessibility regressions get in:
   * a new "Delete" affordance built out of a clickable div, or a dialog with
   * no role, passes every module-level test and is still unusable with a
   * keyboard. These checks cover the phase-92 and phase-87 sections added to
   * settings, and the phase-88/94 strips added to the panel.
   */
  const settings = readFileSync('src/pages/Settings.jsx', 'utf8');

  check('every my-data control is a real button',
    ['my-data-export', 'my-data-delete', 'delete-confirm-button', 'delete-cancel-button']
      .every((id) => new RegExp(`<button[^>]*data-testid="${id}"|data-testid="${id}"[^>]*>`, 's').test(settings)
        && new RegExp(`type="button"[\\s\\S]{0,200}data-testid="${id}"`).test(settings)));
  check('the my-data controls carry visible text labels, not bare icons',
    /data-testid="my-data-export"[\s\S]{0,120}\{t\('intentAI\.lifecycle\.exportAction'\)\}/.test(settings)
    && /data-testid="my-data-delete"[\s\S]{0,120}\{t\('intentAI\.lifecycle\.deleteAction'\)\}/.test(settings));
  check('the delete dialog is a Sheet, which supplies role and aria-modal',
    /<Sheet open=\{deleteOpen\}/.test(settings));
  check('the delete dialog can be dismissed without confirming',
    /<Sheet open=\{deleteOpen\} onClose=\{\(\) => setDeleteOpen\(false\)\}/.test(settings));
  const sheet = readFileSync('src/components/Sheet.jsx', 'utf8');
  check('Sheet still declares role="dialog" and aria-modal',
    /role="dialog"/.test(sheet) && /aria-modal="true"/.test(sheet));
  check('Sheet still closes on Escape',
    /e\.key === 'Escape'/.test(sheet));
  check('the region availability rows use no positive tabindex',
    /tabIndex=\{[1-9]/.test(settings) === false);
  check('the new settings sections remove no focus outline',
    /outline:\s*(none|0)/.test(settings) === false);
  check('the region state is exposed as data, not colour alone',
    /data-state=\{feature\.state\}/.test(settings)
    && /\{t\(`intentAI\.compliance\.state\./.test(settings));

  check('the offline strip is a live region',
    /className=\{`ia-connection[\s\S]{0,200}role="status"/.test(panel));
  check('the fiat boundary notice is announced as a note',
    /className="ia-ramp-notice"[\s\S]{0,80}role="note"/.test(panel));
  check('neither new panel strip introduces a clickable div',
    (panel.match(/<div[^>]*onClick=/g) || []).length <= 2);
  check('the new panel strips add no hardcoded aria-label',
    (panel.match(/aria-label=[^\s>]*/g) || []).every((m) => m.startsWith('aria-label={t(')));

  console.log(JSON.stringify({ probe: 'phase93-accessibility', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
