/**
 * Settings profile badge — brand logo, animated ring, notification bell.
 * ---------------------------------------------------------------------------
 * The settings hero used to paint a plain gradient square with the first
 * letter of the username (or «✦» when unset) — reported as «یک آیکون است برای
 * عکس پروفایل که خالیه». This replaces it with:
 *
 *   · the site logo (the same PWA icon the launcher shows), inside
 *   · an animated conic-gradient ring — pure CSS, composited on the GPU
 *     (transform-only animation, no layout/paint work per frame, paused
 *     entirely under prefers-reduced-motion), so it costs nothing measurable;
 *   · when UNREAD notifications exist, the logo yields to a bell (with a
 *     count). Tapping the bell opens a popup listing each notification's
 *     type, reason and link — the popup is rendered from the SAME store rows
 *     the toasts came from, so it can never disagree with them. Closing the
 *     popup marks everything read and the logo returns.
 *
 * No polling, no timers: the component subscribes to the zustand inbox and
 * re-renders only when a notification actually arrives or is read.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { IconBell } from './Icons';

/* The PWA icon is already cached by the service worker for the home screen,
   so reusing it costs zero extra network. */
const LOGO_SRC = '/icon-192.png';

const KIND_GLYPH = { success: '✅', info: 'ℹ️', warn: '⚠️', error: '⛔' };

function timeAgo(ts, t) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return t('profileBadge.justNow', 'just now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('profileBadge.minAgo', { defaultValue: '{{n}}m ago', n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('profileBadge.hourAgo', { defaultValue: '{{n}}h ago', n: h });
  return t('profileBadge.dayAgo', { defaultValue: '{{n}}d ago', n: Math.floor(h / 24) });
}

export default function ProfileBadge() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inbox = useAppStore((s) => s.inbox || []);
  const markInboxRead = useAppStore((s) => s.markInboxRead);
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);

  const unread = inbox.filter((n) => !n.read);
  const hasUnread = unread.length > 0;

  /* Closing the popup is what "reads" the notifications — the moment the
     user has seen the list, the bell's reason to exist is gone and the logo
     comes back, exactly as requested. */
  const close = () => {
    setOpen(false);
    if (hasUnread) markInboxRead();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) close();
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasUnread]);

  const rows = open ? inbox.slice(0, 8) : [];

  return (
    <div className="profile-badge-wrap">
      <button
        type="button"
        className={`profile-badge${hasUnread ? ' has-unread' : ''}`}
        aria-label={hasUnread
          ? t('profileBadge.unread', { defaultValue: '{{n}} unread notifications', n: unread.length })
          : t('profileBadge.label', 'Profile')}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="profile-badge-ring" aria-hidden="true" />
        <span className="profile-badge-core">
          {hasUnread ? (
            <>
              <IconBell width={20} height={20} />
              <span className="profile-badge-count">{unread.length > 9 ? '9+' : unread.length}</span>
            </>
          ) : (
            <img src={LOGO_SRC} alt="" width={30} height={30} loading="lazy" draggable="false" />
          )}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popRef}
            className="profile-badge-pop glass"
            role="dialog"
            aria-label={t('profileBadge.title', 'Notifications')}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div className="profile-badge-pop-head">
              <strong>{t('profileBadge.title', 'Notifications')}</strong>
              <button type="button" className="profile-badge-pop-close" onClick={close} aria-label={t('common.close', 'Close')}>✕</button>
            </div>
            {rows.length === 0 ? (
              <p className="profile-badge-empty">{t('profileBadge.empty', 'No notifications yet.')}</p>
            ) : rows.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`profile-badge-item${n.read ? '' : ' is-unread'}`}
                onClick={() => {
                  close();
                  if (n.link) navigate(n.link);
                }}
              >
                <span className="profile-badge-item-ico" aria-hidden="true">{KIND_GLYPH[n.kind] || 'ℹ️'}</span>
                <span className="profile-badge-item-body">
                  <span className="profile-badge-item-title">
                    {n.title || (n.key ? t(`toast.${n.key}`, { defaultValue: n.key, ...(n.values || {}) }) : t('profileBadge.notice', 'Notice'))}
                  </span>
                  {n.body && <span className="profile-badge-item-sub">{n.body}</span>}
                  <span className="profile-badge-item-meta">
                    {timeAgo(n.at, t)}
                    {n.link && <span className="profile-badge-item-link"> · {t('profileBadge.open', 'Open')} ↗</span>}
                  </span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
