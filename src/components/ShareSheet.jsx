import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useAppStore } from '../store/useAppStore';
import { copyText, shareTargets } from '../lib/share';

/**
 * The fallback share list — desktop browsers and anything without a native
 * share sheet.
 *
 * On a phone this should almost never appear: `shareLink()` hands off to the
 * OS first (Capacitor sheet in the APK, Web Share API in Safari/Chrome). This
 * exists so that a desktop user, or a browser that refuses the API, still has
 * a working route instead of a button that does nothing.
 *
 * Copy is listed FIRST and is always present. Every network link can fail —
 * blocked host, app not installed, popup blocker — but the clipboard cannot,
 * and pasting a link into whatever the user already has open is the one path
 * that works on every device on earth.
 */
export default function ShareSheet({ open, onClose, url, text = '', title }) {
  const { t } = useTranslation();
  const notify = useAppStore((s) => s.notify);
  const [copied, setCopied] = useState(false);

  if (!url) return null;

  const doCopy = async () => {
    const ok = await copyText(url);
    notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title ?? t('share.title')} size="sm">
      <div className="stack" style={{ gap: 10 }}>
        {/* The link itself, visible. People trust a link they can read. */}
        <div className="share-url mono" dir="ltr">{url}</div>

        <button className="btn btn-primary" onClick={doCopy}>
          {copied ? `✓ ${t('common.copied')}` : t('share.copy')}
        </button>

        <div className="share-grid">
          {shareTargets(url, text).map((s) => (
            <a
              key={s.id}
              className="share-target"
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
            >
              {/*
                A coloured dot, not a brand logo. Shipping WhatsApp's and X's
                marks means shipping their trademark guidelines with them; a
                tinted initial carries the same recognition with none of that.
              */}
              <span className="share-dot" style={{ background: s.color }} />
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
