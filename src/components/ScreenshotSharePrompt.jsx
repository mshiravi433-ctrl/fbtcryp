import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import { siteShareUrl } from '../lib/referral';
import { BRAND_NAME, brandDomain } from '../lib/brand';
import { subscribeScreenshots } from '../lib/screenshotDetect';
import '../styles/screenshot-prompt.css';

/** How long the offer stays after a screenshot. */
export const SCREENSHOT_PROMPT_MS = 30_000;

/**
 * THE SCREENSHOT PROMPT — shown only after a screenshot, for 30 seconds.
 * ---------------------------------------------------------------------------
 * «باکس بالای فوتر که دکمه اشتراک و آدرس سایت هست را پاک کن. وقتی کسی اسکرین
 * گرفت یک بند برای ۳۰ ثانیه بیاد که بگه شما اسکرین گرفتید، می‌خواهید اشتراک
 * بگذارید اسکرین‌شات را با واترمارک آدرس سایت — نه اینکه همیشه باشه.» (2026-09-24)
 *
 * This replaces the always-on brand rail. Nothing is pinned above the nav any
 * more; the page gets its bottom space back. When `lib/screenshotDetect.js`
 * reports a capture, a banner slides in:
 *
 *     You took a screenshot · Share it with the fbtswap.ir watermark?
 *     [ Share with watermark ]  [ × ]
 *
 * with a 30-second bar draining under it. Another screenshot restarts the
 * clock; × or the timer closes it; a share closes it when it finishes.
 *
 * «Share» runs the same capture → brand → share chain the rail used
 * (`lib/screenShare.js`): the screen is re-rendered and the brand strip —
 * coin, name, canonical address — is DRAWN into the picture, so what reaches
 * the chat always carries the site's address. The banner itself is excluded
 * from that picture (`data-screenshot-ignore`).
 *
 * The address is `brandDomain()`, derived from `publicAppUrl()`, never typed.
 */
export default function ScreenshotSharePrompt({ placement = 'nav', durationMs = SCREENSHOT_PROMPT_MS }) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const { haptic, user } = useTelegram();
  const ensureRefCode = useAppStore((state) => state.ensureRefCode);
  const notify = useAppStore((state) => state.notify);
  /* `shotAt` doubles as the key of the countdown bar: a new screenshot restarts
     both the timer and the animation. `null` = hidden. */
  const [shotAt, setShotAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const domain = brandDomain();
  const refCode = useMemo(() => (typeof ensureRefCode === 'function' ? ensureRefCode(user?.id) : ''), [ensureRefCode, user?.id]);
  const route = `${pathname || '/'}${search || ''}`;

  useEffect(() => subscribeScreenshots(({ at }) => {
    setShotAt(at);
    try { haptic?.('light'); } catch { /* haptics are a nicety */ }
  }), [haptic]);

  /* The 30-second clock. Held while a share is running: closing the banner
     under the user's finger mid-share would drop the result on the floor. */
  useEffect(() => {
    if (shotAt == null || busy) return undefined;
    const left = Math.max(0, durationMs - (Date.now() - shotAt));
    const timer = setTimeout(() => setShotAt(null), left);
    return () => clearTimeout(timer);
  }, [shotAt, busy, durationMs]);

  const close = useCallback(() => { if (!busyRef.current) setShotAt(null); }, []);

  const onShare = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    haptic?.('light');
    try {
      /* Imported at tap time: it pulls `html-to-image`, which nobody who does not
         share should download. */
      const { takeScreenshotAndShare } = await import('../lib/screenShare.js');
      const result = await takeScreenshotAndShare({
        screen: route,
        url: siteShareUrl(route, refCode),
        title: BRAND_NAME,
        text: t('share.screenText', { defaultValue: `${BRAND_NAME} · ${domain}` })
      });

      /* A dismissed sheet is the user changing their mind — no toast. */
      if (result && result.reason !== 'DISMISSED') {
        if (result.ok) {
          if (result.via === 'download') {
            notify(result.reason === 'SAVED_AND_COPIED' ? 'screenSavedAndCopied'
              : result.reason === 'SAVED' ? 'screenSaved' : 'screenLinkCopied', 'success');
          } else if (result.via === 'link' || result.via === 'copy') {
            notify(result.via === 'copy' ? 'screenLinkCopied' : 'screenLinkShared', 'success');
          }
        } else {
          notify('screenFailed', 'error');
        }
      }
    } catch {
      notify('screenFailed', 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
      setShotAt(null);
    }
  }, [domain, haptic, notify, refCode, route, t]);

  if (shotAt == null) return null;

  return (
    <div
      className={`screenshot-prompt screenshot-prompt--${placement}`}
      data-testid="screenshot-prompt"
      data-placement={placement}
      data-screenshot-ignore="true"
      role="status"
      aria-live="polite"
    >
      <div className="screenshot-prompt-row">
        <span className="screenshot-prompt-mark" aria-hidden="true">
          <BrandMark size={16} gradientId="shotPromptGrad" className="screenshot-prompt-coin" />
        </span>
        <div className="screenshot-prompt-text">
          <div className="screenshot-prompt-title">{t('share.shotTitle', { defaultValue: 'You took a screenshot' })}</div>
          <div className="screenshot-prompt-body">
            {t('share.shotBody', { domain, defaultValue: `Share it with the ${domain} watermark?` })}
          </div>
        </div>
        <button
          type="button"
          className="screenshot-prompt-close"
          data-testid="screenshot-prompt-close"
          onClick={close}
          disabled={busy}
          aria-label={t('share.shotClose', { defaultValue: 'Close' })}
          title={t('share.shotClose', { defaultValue: 'Close' })}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="screenshot-prompt-share"
        data-testid="screenshot-share"
        onClick={onShare}
        disabled={busy}
        aria-busy={busy ? 'true' : 'false'}
        aria-label={t('share.screenAria', { defaultValue: 'Share this screen as a picture with the site address' })}
      >
        {busy ? (
          <span className="screenshot-prompt-spinner" aria-hidden="true" />
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
            <path d="M12 15V3" />
            <path d="M7.5 7.5 12 3l4.5 4.5" />
          </svg>
        )}
        <span>{busy ? t('share.screenBusy', { defaultValue: '…' }) : t('share.shotShare', { defaultValue: 'Share with watermark' })}</span>
        <span className="screenshot-prompt-domain" dir="ltr">{domain}</span>
      </button>

      {/* The 30-second drain. Keyed on the screenshot so a new one restarts it;
          frozen while a share is running, like the timer it draws. */}
      <span
        key={shotAt}
        className={`screenshot-prompt-timer${busy ? ' is-paused' : ''}`}
        style={{ animationDuration: `${durationMs}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}
