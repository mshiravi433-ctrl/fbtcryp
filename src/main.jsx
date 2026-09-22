import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { releaseAllScrollLocks } from './lib/scrollLock.js';
import { clearHardReloadFlag } from './lib/refresh.js';
import { installDeeplinkReturnListeners } from './lib/solana/deeplink.js';
import { measureVerifyEnclave, warmVerifyEnclave } from './lib/wc/verify.js';
import './i18n';
import './index.css';

/*
 * ─── THE BUILD STAMP, VISIBLE BEFORE REACT MOUNTS ──────────────────────────
 * «تغییرات لایو نمی‌شوند» stays support-relevant until "which build is this
 * really?" is a one-line answer instead of a dashboard argument. The define
 * below is baked by vite from the build environment (VERCEL_GIT_COMMIT_* or
 * GITHUB_SHA or the local checkout), and this publishes it at module level —
 * before the first paint, in every harness — so DevTools, the logs a user
 * pastes, and the Settings page all describe the SAME build.
 *
 * The `typeof` guard is the same pattern as __APP_VERSION__: test vite
 * configs do not carry the define, and an unguarded reference is a boot
 * crash there.
 */
if (typeof window !== 'undefined') {
  try {
    window.__FBT_BUILD__ = typeof __FBT_BUILD__ !== 'undefined' ? __FBT_BUILD__ : null;
  } catch { /* a stamp is a convenience, never a boot blocker */ }
}

/*
 * The WalletConnect verify enclave, warmed AND measured at boot.
 *
 * Attestation has a flat 5-second budget at pair time (the SDK's
 * FIVE_SECONDS): DNS + TLS + the enclave's own JS alone can exceed that on a
 * slow mobile network, and when it does the wallet renders «Cannot verify»
 * for a domain that is perfectly registered. Warming opens the connection
 * early; measuring records — once per page — whether the enclave page loads
 * here at all. That measurement is the GATE for the extended-budget retry
 * installed on connect (src/lib/wc/session.js): reachable-but-slow networks
 * get a second, longer attestation attempt; filtered networks pay nothing.
 * Both are advisory and never throw.
 */
try {
  warmVerifyEnclave({});
  measureVerifyEnclave({});
} catch { /* an advisory warm-up must never gate boot */ }


/*
 * ─── THE WALLET'S ANSWER, CAUGHT BEFORE REACT MOUNTS ────────────────────────
 *
 * When a Solana wallet approves a deeplink request it sends the user back with
 * the answer in the URL (`?phantom_encryption_public_key=…&nonce=…&data=…`), or
 * — inside the APK — as a deep link that native code forwards into this page.
 * Both arrive as a document that is already loading, so the listener has to be
 * installed here, before the first render: a connect that completes only after
 * React is up is a connect that silently loses the first frame's answer, and
 * the user is left looking at a wallet they connected.
 *
 * It is a no-op on every page load that is not a wallet return.
 */
installDeeplinkReturnListeners();

/*
 * Payment-gateway return hop.
 *
 * The Iranian Toman checkout has to hand the PSP a plain https callback URL
 * with no query of its own (the gateway appends ?Authority=…&Status=…), while
 * this app routes on the hash. So the configured return path is a real path,
 * and the only thing it does is bounce back into the SPA with the gateway's
 * query string intact. Returning here NEVER means "paid": the panel asks the
 * server, which asks the provider.
 */
if (typeof window !== 'undefined'
  && window.location.pathname.replace(/\/+$/, '') === '/iran-buy/return') {
  window.location.replace(`/${window.location.search}#/buy`);
}

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
  /*
   * The hard-reload loop guard (lib/refresh.js) is one-shot per incident:
   * reaching a successful first paint proves the reload fixed the incident,
   * so the guard can be cleared and the NEXT incident may reload once again.
   */
  clearHardReloadFlag();
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 420);
});
