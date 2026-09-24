import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import { siteShareUrl } from '../lib/referral';
import { BRAND_NAME, brandDomain } from '../lib/brand';
import '../styles/brand-rail.css';

/**
 * THE BRAND RAIL — and the screenshot button that goes with it.
 * ---------------------------------------------------------------------------
 * The report (2026-09-23): «وقتی در سایت و اپ اسکرین‌شات گرفته می‌شود، لوگو و نام
 * سایت (یا آدرس سایت) پایین صفحه باشد. باید مدرن باشد و سایت را درست معرفی کند.
 * دکمهٔ اشتراک‌گذاری اسکرین‌شات هم اضافه کن.»
 *
 * Two facts decide the shape of this component:
 *
 *   1. The user takes the screenshot, not us. A phone's power+volume captures
 *      whatever is on screen, so branding that only exists at the END of a long
 *      page is branding that is almost never in the picture. It has to be pinned
 *      in the viewport: a slim rail above the bottom nav, present on every
 *      screen, quiet enough that it reads as furniture and not as an ad.
 *   2. The button next to it is the other half of the request: one tap takes the
 *      picture, composites the SAME brand line into it (`lib/screenShare.js` —
 *      drawn, not screenshotted, because a fixed element does not survive a DOM
 *      clone at the offset the user saw) and hands it to the platform's own
 *      share sheet.
 *
 * The address shown is `brandDomain()`, derived from `publicAppUrl()`, which
 * rejects any configured origin that is not the canonical host. That is not
 * pedantry: a stale env var once made this app introduce itself as
 * `lawpoetics.ir`, and a brand rail that states the wrong address is worse than
 * none.
 *
 * The rail opts ITSELF out of the capture (`data-screenshot-ignore` on the
 * button, `.brand-rail` in the capture filter): the shared picture gets the
 * drawn strip, not a picture of a button that says "share".
 */
export default function BrandRail({ bare = false }) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const { haptic, user } = useTelegram();
  const ensureRefCode = useAppStore((state) => state.ensureRefCode);
  const notify = useAppStore((state) => state.notify);
  const [busy, setBusy] = useState(false);

  const domain = brandDomain();
  /* The link the picture points at: this screen, on the canonical host, riding
     the sharer's own referral code exactly as `Shop` does — one mechanism, no
     new attribution promise. */
  const refCode = useMemo(() => (typeof ensureRefCode === 'function' ? ensureRefCode(user?.id) : ''), [ensureRefCode, user?.id]);
  const route = `${pathname || '/'}${search || ''}`;

  const onShare = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    haptic?.('light');
    try {
      /* The capture engine is imported at TAP time, not at first paint: it pulls
         `html-to-image` with it, and the rail — which is on every screen — should
         cost what a strip of text costs. `lib/brand.js` (a name, a host, an SVG
         string) is the part that renders, and that stays static. */
      const { takeScreenshotAndShare } = await import('../lib/screenShare.js');
      const result = await takeScreenshotAndShare({
        screen: route,
        url: siteShareUrl(route, refCode),
        title: BRAND_NAME,
        text: t('share.screenText', { defaultValue: `${BRAND_NAME} · ${domain}` })
      });

      /* A dismissed sheet is the user changing their mind. Reporting it as a
         failure is how an app starts nagging (the rule `lib/share.js` set). */
      if (!result || result.reason === 'DISMISSED') return;

      if (result.ok) {
        if (result.via === 'download') {
          notify(result.reason === 'SAVED_AND_COPIED' ? 'screenSavedAndCopied'
            : result.reason === 'SAVED' ? 'screenSaved' : 'screenLinkCopied', 'success');
        } else if (result.via === 'link' || result.via === 'copy') {
          notify(result.via === 'copy' ? 'screenLinkCopied' : 'screenLinkShared', 'success');
        }
        /* 'native' and 'web' need no toast: the platform's own sheet, with the
           picture in it, was the feedback. */
      } else {
        notify('screenFailed', 'error');
      }
    } catch {
      /* Nothing in the chain is supposed to throw; if something does, the honest
         sentence is still the honest one. */
      notify('screenFailed', 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, haptic, notify, refCode, route, t, domain]);

  return (
    <div
      className={`brand-rail${bare ? ' brand-rail--bare' : ''}`}
      data-testid="brand-rail"
      data-bare={bare ? 'true' : 'false'}
    >
      <span className="brand-rail-id" dir="ltr">
        <BrandMark size={14} gradientId="brandRailGrad" className="brand-rail-mark" />
        <span className="brand-rail-name">{BRAND_NAME}</span>
        <span className="brand-rail-dot" aria-hidden="true" />
        <span className="brand-rail-domain">{domain}</span>
      </span>

      <button
        type="button"
        className="brand-rail-share"
        data-testid="screenshot-share"
        data-screenshot-ignore="true"
        onClick={onShare}
        disabled={busy}
        aria-busy={busy ? 'true' : 'false'}
        aria-label={t('share.screenAria', { defaultValue: 'Take a screenshot of this screen and share it' })}
        title={t('share.screenAria', { defaultValue: 'Take a screenshot of this screen and share it' })}
      >
        {busy ? (
          <span className="brand-rail-spinner" aria-hidden="true" />
        ) : (
          /* Screen + an arrow leaving it: the picture is OF this screen, and it
             is going somewhere. Drawn here rather than added to Icons.jsx
             because nothing else in the app captures itself. */
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H9" />
            <path d="M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9" />
            <path d="M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15" />
            <path d="M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15" />
            <path d="M12 16V9" />
            <path d="M9.2 11.6 12 8.8l2.8 2.8" />
          </svg>
        )}
        <span className="brand-rail-share-label">{busy ? t('share.screenBusy', { defaultValue: '…' }) : t('share.screen', { defaultValue: 'Share' })}</span>
      </button>
    </div>
  );
}
