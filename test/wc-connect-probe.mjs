/**
 * WALLETCONNECT BEHAVIOR PROBE
 * ---------------------------------------------------------------------------
 * Tests the connect/disconnect logic in WalletContext.jsx without requiring a
 * live WalletConnect relay. Covers the double-tap guard (wcInitingRef), the
 * disconnect cleanup, and the project-id fallback shape.
 *
 * The full connect flow is not exercised here — it requires EthereumProvider
 * from @walletconnect/ethereum-provider — but the guards that prevent
 * duplicate sessions and ensure clean disconnects are structural.
 */
import { readFileSync } from 'node:fs';

const walletSrc = readFileSync('src/context/WalletContext.jsx', 'utf8');

/* Strip comments BEFORE searching: WalletContext.jsx documents the very bugs
   these checks guard against, and a check that matches its own prose is no
   check at all (this suite has tripped on that repeatedly). */
const code = walletSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. double-tap guard ---- */
  // The wcInitingRef guard prevents EthereumProvider.init() from running
  // twice when the user taps Connect rapidly.
  t('wcInitingRef guards against double init',
    /if \(wcInitingRef\.current\) return false;/.test(walletSrc));
  t('wcInitingRef is set BEFORE the init() call',
    code.indexOf('wcInitingRef.current = true') < code.indexOf('EthereumProvider.init('));
  t('wcInitingRef is reset in the finally block',
    /finally\s*\{[\s\S]{0,100}wcInitingRef\.current = false/.test(code));

  /* ---- 2. stale session cleanup before init ---- */
  // If there's already a connected WalletConnect instance, it must be
  // disconnected first to avoid two sessions fighting for the same state.
  t('a stale WC session is disconnected before re-init',
    /if \(wcRef\.current\) \{[\s\S]{0,200}wcRef\.current\.disconnect\(\)/.test(code));

  /* ---- 3. disconnect() cleans up both listeners and refs ---- */
  // The disconnect function must null all refs and clear all state.
  const disconnectBlock = code.slice(
    code.indexOf('const disconnect ='),
    code.indexOf('};\n', code.indexOf('const disconnect ='))
  );
  t('disconnect clears wcListenersRef', /wcListenersRef\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect clears wcRef', /wcRef\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect clears eip1193Ref', /eip1193Ref\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect clears signerRef', /signerRef\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect resets mode to null', /setMode\(null\)/.test(disconnectBlock));
  t('disconnect resets address to null', /setAddress\(null\)/.test(disconnectBlock));
  t('disconnect resets chainId to null', /setChainId\(null\)/.test(disconnectBlock));
  t('disconnect resets nativeBalance to null', /setNativeBalance\(null\)/.test(disconnectBlock));
  t('disconnect resets locked to false', /setLocked\(false\)/.test(disconnectBlock));
  t('disconnect resets error to null', /setError\(null\)/.test(disconnectBlock));

  /* ---- 4. disconnectRef forwarding ensures listener callbacks stay current ---- */
  t('disconnectRef is kept in sync with the latest disconnect implementation',
    /disconnectRef\.current = disconnect;/.test(code));

  /* ---- 5. WC listeners are attached after connect, not before ---- */
  t('the wc.on(disconnect) listener is registered after connect() succeeds',
    code.indexOf('wc.on(\'disconnect\'') > code.indexOf('await wc.connect()'));
  t('the wc.on(accountsChanged) listener is registered after connect() succeeds',
    code.indexOf('wc.on(\'accountsChanged\'') > code.indexOf('await wc.connect()'));
  t('the wc.on(chainChanged) listener is registered after connect() succeeds',
    code.indexOf('wc.on(\'chainChanged\'') > code.indexOf('await wc.connect()'));
  t('the wc.on(session_delete) listener is registered after connect() succeeds',
    code.indexOf('wc.on(\'session_delete\'') > code.indexOf('await wc.connect()'));

  /* ---- 6. the projectId fallback is a valid string, not empty ---- */
  t('the hardcoded projectId fallback is non-empty',
    code.includes("'14bdc2642bb5f01972ffe799e43b978d'"));
  t('the env var always takes precedence',
    /import\.meta\.env\?\.VITE_WALLETCONNECT_PROJECT_ID \|\| '14bdc2642bb5f01972ffe799e43b978d'/.test(code));

  /* ---- 7. mobile deep links are wallet-agnostic (no MetaMask hardcode) ---- */
  // Historical bug: on iOS a display_uri handler hard-navigated the page to
  // metamask.app.link, which forced every iOS user into MetaMask (Trust and
  // Rainbow could never be chosen) and navigated the page away mid-pairing.
  // The modal (showQrModal: true) must own deep links for every wallet.
  t('no display_uri handler navigates the page to MetaMask',
    !/window\.location\.href\s*=/.test(code));
  t('connect() runs exactly once (no iOS-only MetaMask branch)',
    (code.match(/await wc\.connect\(\)/g) || []).length === 1);
  t('the mobile wallet list includes Trust Wallet, not just MetaMask',
    /id:\s*'trust'/.test(code) && /id:\s*'metamask'/.test(code));
  t('the mobile wallet list supplies a universal link for Trust',
    /link\.trustwallet\.com/.test(code));

  /* ---- 8. modal options exclude the explorer wallet list on iOS ---- */
  t('iOS modal disables the explorer wallet list', /explorerExcludedWalletIds: 'ALL'/.test(code));
  t('iOS modal supplies explicit mobile wallet deep links',
    /mobileWallets: \[/.test(code));

  return rows;
}