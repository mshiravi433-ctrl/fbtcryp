import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { releaseAllScrollLocks } from './lib/scrollLock.js';
import './i18n';
import './index.css';
import './styles/shop-modern.css';

/**
 * Top-level crash guard.
 *
 * Without this, any throw during the first render leaves an empty <div id="root">
 * behind the boot overlay — which looks exactly like "the app just spins".
 * With it, the user gets a readable Persian message and a reload button, and we
 * get the error text on screen instead of only in a devtools console the user
 * has no way to open on a phone.
 */
class BootBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // Surface it to the HTML watchdog too, in case we crashed before paint.
    window.__FBT_BOOT_ERR__ = String(error?.message || error);

    /*
     * A component that throws never runs its effect cleanups, so a modal that
     * was holding a body-scroll lock when it crashed would leave the page
     * permanently unscrollable — the error screen itself included. Releasing
     * every lock here costs nothing and prevents "the app froze" on top of
     * whatever actually broke.
     */
    releaseAllScrollLocks();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          textAlign: 'center',
          background: '#000',
          color: '#fff',
          fontFamily: "'Vazirmatn', system-ui, sans-serif"
        }}
      >
        <div style={{ maxWidth: 340 }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>خطای غیرمنتظره</div>
          <p style={{ fontSize: 13, lineHeight: 1.85, color: '#9aa4bf' }}>
            بخشی از برنامه دچار مشکل شد. دارایی شما در امان است — FBT هیچ‌وقت دارایی شما را نگه نمی‌دارد و این خطا
            فقط مربوط به نمایش برنامه است.
          </p>
          <code
            style={{
              display: 'block',
              direction: 'ltr',
              fontSize: 10.5,
              color: '#5b647f',
              margin: '12px 0',
              wordBreak: 'break-all'
            }}
          >
            {String(this.state.error?.message || this.state.error).slice(0, 220)}
          </code>
          {/*
            * RECOVERY MUST LEAVE THE ROUTE THAT CRASHED.
            *
            * This used to be a plain location.reload(). The app is a
            * HashRouter, so a crash on Settings left the URL at `#/settings`
            * — reloading went straight back to the screen that had just
            * thrown, threw again, and showed this same page. The user was
            * permanently locked out of that screen with a button that looked
            * like a fix and was actually a loop. Reported as
            * «دیگه درست نمیشه».
            *
            * Clearing the hash first sends the reload to the home route, so
            * one tap always gets the user back into a working app even when
            * the underlying defect is still there.
            */}
          <button
            onClick={() => {
              try {
                window.location.hash = '#/';
              } catch {
                /* fall through to the reload regardless */
              }
              window.location.reload();
            }}
            style={{
              width: '100%',
              padding: 13,
              borderRadius: 14,
              border: 0,
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 700,
              color: '#000',
              background: 'linear-gradient(120deg,#00e5ff,#7c4dff)'
            }}
          >
            بازنشانی برنامه
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BootBoundary>
      <App />
    </BootBoundary>
  </React.StrictMode>
);

// Tell the HTML watchdog we made it, then fade out the pre-mount black screen.
requestAnimationFrame(() => {
  window.__FBT_BOOTED__ = true;
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 420);
});
