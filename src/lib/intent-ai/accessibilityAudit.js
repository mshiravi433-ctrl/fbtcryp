/**
 * FBT INTENT AI — PHASE 93: ACCESSIBILITY
 * ---------------------------------------------------------------------------
 * A UI that only works with a mouse and perfect eyesight is not a UI for
 * everyone. Phase 93 gives the test suite a real a11y probe over the panel
 * source: keyboard reachability, names for controls, and contrast.
 *
 *   · every interactive element must be focusable and have an accessible name
 *   · an icon-only control needs aria-label; a div acting as a button needs a
 *     role and a key handler, or it is a defect
 *   · contrast is computed with the WCAG formula, not eyeballed
 *   · a dialog must trap focus and be announced; an unlabelled dialog fails
 */

import { classifyFailure } from './failureModes.js';

export const A11Y_SCHEMA = 'fbt.accessibility.v1';
export const CONTRAST_AA = 4.5;
export const CONTRAST_AA_LARGE = 3;
export const MIN_TARGET_PX = 44;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function parseColor(hex) {
  const m = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(m)) return null;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** WCAG relative luminance contrast ratio. */
export function contrastRatio(fg, bg) {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const lum = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const l1 = lum(a);
  const l2 = lum(b);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return Math.round(ratio * 100) / 100;
}

export function meetsContrast({ foreground = null, background = null, large = false } = {}) {
  const ratio = contrastRatio(foreground, background);
  const required = large ? CONTRAST_AA_LARGE : CONTRAST_AA;
  if (ratio === null) {
    return { ok: false, ratio: null, required, reason: 'UNREADABLE_COLOR', i18nKey: 'intentAI.a11y.contrastUnknown' };
  }
  return { ok: ratio >= required, ratio, required, i18nKey: ratio >= required ? 'intentAI.a11y.contrastOk' : 'intentAI.a11y.contrastLow' };
}

/** Audit one described control. */
export function auditControl(control = {}) {
  const findings = [];
  const tag = String(control.tag || '').toLowerCase();
  const interactive = Boolean(control.onClick || control.onKeyDown || ['button', 'a', 'input', 'select', 'textarea'].includes(tag));
  if (!interactive) return { ok: true, id: control.id ?? null, interactive: false, findings: [] };

  const name = control.ariaLabel || control.text || control.title || control.ariaLabelledBy;
  if (!name) findings.push('NO_ACCESSIBLE_NAME');
  if (control.iconOnly === true && !control.ariaLabel) findings.push('ICON_WITHOUT_LABEL');
  const nativelyFocusable = ['button', 'a', 'input', 'select', 'textarea'].includes(tag);
  if (!nativelyFocusable) {
    if (num(control.tabIndex) === null) findings.push('NOT_KEYBOARD_REACHABLE');
    if (!control.role) findings.push('NO_ROLE');
    if (control.onClick && !control.onKeyDown) findings.push('MOUSE_ONLY');
  }
  if (control.tabIndex !== undefined && num(control.tabIndex) > 0) findings.push('POSITIVE_TABINDEX');
  if (control.disabled === true && control.ariaDisabled === undefined && !nativelyFocusable) findings.push('DISABLED_NOT_ANNOUNCED');
  if (num(control.sizePx) !== null && num(control.sizePx) < MIN_TARGET_PX) findings.push('TARGET_TOO_SMALL');
  if (control.foreground && control.background) {
    const c = meetsContrast({ foreground: control.foreground, background: control.background, large: control.largeText === true });
    if (!c.ok) findings.push('LOW_CONTRAST');
  }
  return {
    ok: findings.length === 0,
    id: control.id ?? null,
    interactive: true,
    findings,
    i18nKey: findings.length ? 'intentAI.a11y.controlFails' : 'intentAI.a11y.controlOk'
  };
}

/** Audit a described dialog. */
export function auditDialog(dialog = {}) {
  const findings = [];
  if (dialog.role !== 'dialog' && dialog.role !== 'alertdialog') findings.push('NO_DIALOG_ROLE');
  if (!dialog.ariaLabel && !dialog.ariaLabelledBy) findings.push('DIALOG_WITHOUT_NAME');
  if (dialog.ariaModal !== true) findings.push('NOT_MODAL');
  if (dialog.trapsFocus !== true) findings.push('FOCUS_NOT_TRAPPED');
  if (dialog.restoresFocus !== true) findings.push('FOCUS_NOT_RESTORED');
  if (dialog.closeOnEscape !== true) findings.push('NO_ESCAPE');
  return { ok: findings.length === 0, id: dialog.id ?? null, findings };
}

/** The whole screen. One failing control fails the audit. */
export function auditScreen({ screen = null, controls = [], dialogs = [], now = Date.now() } = {}) {
  const rows = (Array.isArray(controls) ? controls : []).map(auditControl);
  const dialogRows = (Array.isArray(dialogs) ? dialogs : []).map(auditDialog);
  const failing = [...rows, ...dialogRows].filter((r) => r.ok !== true);
  const interactive = rows.filter((r) => r.interactive);
  return {
    ok: failing.length === 0,
    schema: A11Y_SCHEMA,
    screen: screen ?? null,
    checked: rows.length + dialogRows.length,
    interactiveCount: interactive.length,
    failing,
    // Every interactive control must be reachable by keyboard alone.
    keyboardComplete: interactive.every((r) => !r.findings.includes('NOT_KEYBOARD_REACHABLE') && !r.findings.includes('MOUSE_ONLY')),
    i18nKey: failing.length ? 'intentAI.a11y.screenFails' : 'intentAI.a11y.screenOk',
    i18nParams: { failing: failing.length },
    at: now
  };
}

/** An a11y report may not be presented as clean when it is not. */
export function assertAccessible(report) {
  const reasons = [];
  if (!report || report.schema !== A11Y_SCHEMA) reasons.push('NOT_AN_A11Y_REPORT');
  if (report?.ok === true && (report.failing || []).length) reasons.push('PASSED_WITH_FAILURES');
  if (report?.ok === true && report.keyboardComplete !== true) reasons.push('PASSED_WITHOUT_KEYBOARD_ACCESS');
  if (report?.ok === true && (report.checked ?? 0) === 0) reasons.push('PASSED_WITHOUT_CHECKING_ANYTHING');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
