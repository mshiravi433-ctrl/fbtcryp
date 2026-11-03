/*
 * Shared markup for the two static forecast-card previews.
 * This is PREVIEW-ONLY chrome: it mirrors the className contract of
 * src/components/ProChart/TokenChart.jsx so the REAL src/styles/pro-chart.css
 * can be reviewed without a market feed, a 33 MB model download or a build.
 * Nothing here is imported by the app.
 */
(function () {
  const svg = (body, width) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    spark: svg('<path d="M12 3.2l1.5 4.3 4.3 1.5-4.3 1.5L12 14.8l-1.5-4.3-4.3-1.5 4.3-1.5L12 3.2Z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/><path d="M5.5 16.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4Z"/>', 1.8),
    retry: svg('<path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 5v6h-6"/>', 2),
    trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', 1.9),
    stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>', 2),
    download: svg('<path d="M12 3v11m0 0 4-4m-4 4-4-4M4 18v2h16v-2"/>', 2)
  };

  const btn = (label, icon, tone, testid) =>
    `<button type="button" class="pc-fc-btn pc-fc-btn--${tone}" aria-label="${label}" title="${label}"` +
    `${testid ? ` data-testid="${testid}"` : ''}>` +
    `<span class="pc-fc-btn-ico" aria-hidden="true">${ICONS[icon]}</span>` +
    `<span class="pc-fc-btn-label">${label}</span></button>`;
  const head = (tag, tone, model, right = '', busy = false) =>
    `<div class="pc-fc-head"><span class="pc-fc-mark${busy ? ' is-busy' : ''}" aria-hidden="true">${ICONS.spark}</span>` +
    `<div class="pc-fc-title"><span class="pc-fc-tag ${tone}">${tag}</span>` +
    (model ? `<span class="pc-fc-model mono" dir="ltr">${model}</span>` : '') + '</div>' +
    (right || busy ? `<div class="pc-fc-tools">${busy ? '<span class="pc-spinner" aria-hidden="true"></span>' : ''}${right}</div>` : '') + '</div>';

  const STATES = {
    ready: `<div class="pc-fc pc-fc--ambient" dir="auto" data-testid="forecast-badge">
      ${head('مدل محلی روی دستگاه · Kronos', 'is-model is-local', 'Kronos-mini', btn('تلاش دوباره', 'retry', 'ghost', 'forecast-refresh'))}
      <div class="pc-fc-summary"><span>قیمت پایان سناریو <b class="mono" dir="ltr">3,498.20</b></span><span class="up" dir="ltr">+2.51%</span><span>۱۲ کندل آینده</span></div>
      <div class="pc-fc-meta mono" dir="ltr">WEBGPU · 812 ms · ۸۰ کندل تاریخچه</div>
      <div class="pc-fc-warning">این پیش‌بینی روی دستگاه شما محاسبه شده، نه روی سرور ما.</div>
      <div class="pc-fc-foot"><div class="pc-fc-actions">${btn('حذف مدل از این دستگاه', 'trash', 'danger', 'forecast-delete')}</div><div class="pc-fc-disc">برآورد مدل از کندل‌های گذشته — نه توصیه مالی، نه تضمین.</div></div>
    </div>`,
    error: `<div class="pc-fc pc-fc--setup" dir="auto" role="status" data-testid="forecast-error">
      ${head('مدل محلی روی دستگاه', 'is-local', '')}
      <div class="pc-fc-note is-error">خروجی معتبر نیست؛ کندل‌های تولیدشده اعتبارسنجی را رد کردند.</div>
      <div class="pc-fc-actions">${btn('تلاش دوباره', 'retry', 'ghost', 'forecast-retry')}</div>
    </div>`,
    download: `<div class="pc-fc pc-fc--setup" dir="auto" data-testid="forecast-download">
      ${head('مدل محلی روی دستگاه', 'is-local', 'Kronos-mini · WebGPU')}
      <div class="pc-fc-summary"><span>۵۷٫۰ MB برای یک‌بار دانلود</span><span class="pc-fc-bytes mono" dir="ltr">33.4 MB + 23.6 MB</span></div>
      <div class="pc-fc-warning">مدل داخل مرورگر شما اجرا می‌شود؛ بعد از دانلود، کندل‌ها هیچ‌جا نمی‌روند.</div>
      <div class="pc-fc-actions">${btn('دانلود و پیش‌بینی', 'download', 'primary', 'forecast-download-start')}${btn('توقف', 'stop', 'ghost')}</div>
      <div class="pc-fc-disc">برآورد مدل از کندل‌های گذشته — نه توصیه مالی، نه تضمین.</div>
    </div>`,
    progress: `<div class="pc-fc pc-fc--setup" dir="auto" data-testid="forecast-progress">
      ${head('مدل محلی روی دستگاه', 'is-local', 'model.onnx', '', true)}
      <div class="pc-fc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="64"><span style="width:64%"></span></div>
      <div class="pc-fc-summary"><span>۶۴٪ · ۲۱٫۳ MB / ۳۳٫۴ MB</span></div>
      <div class="pc-fc-actions">${btn('توقف', 'stop', 'ghost', 'forecast-cancel')}</div>
    </div>`
  };

  window.FcPreview = { ICONS, btn, head, STATES };
})();
