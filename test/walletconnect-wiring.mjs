/**
 * WALLETCONNECT WIRING GUARDS
 * ---------------------------------------------------------------------------
 * Two historical bugs must never come back, both documented in
 * src/context/WalletContext.jsx:
 *
 *   1. METADATA `url` FROM `window.location.origin` — inside the packaged
 *      Android app the page is served from https://localhost, so a wallet (a
 *      SEPARATE app) could not fetch that origin, could not show the user who
 *      was asking, and rejected the request outright ("MetaMask says the URL
 *      is invalid").
 *
 *   2. METADATA `icons` POINTING AT A FILE THAT DOES NOT EXIST — the files are
 *      icon-192.png and icon-512.png. Wallets fetch the icon URL to draw the
 *      connection dialog and treat a 404 as grounds to refuse.
 *
 * Also guarded here: the project ID must be a single source of truth — the
 * WC_PROJECT_ID constant in source, never an env var (a stale Vercel/CI copy
 * of VITE_WALLETCONNECT_PROJECT_ID once shipped a retired project) — and every
 * place that mentions a WalletConnect project ID must agree, so Solana/TON/
 * dYdX prompts never disagree about the site's identity.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20';

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const wallet = readFileSync('src/context/WalletContext.jsx', 'utf8');

  /* ---- 1. the localhost-origin bug never returns ---- */
  // The metadata must be built from publicAppUrl(), never from
  // window.location.origin (which is https://localhost inside the APK).
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = stripComments(wallet);
  const metadataBlock = code.slice(code.indexOf('metadata: {'), code.indexOf('});', code.indexOf('metadata: {')));

  t('WC metadata is built from the canonical public URL helper', /url: publicUrl/.test(metadataBlock));
  t(
    'WC metadata NEVER reads window.location.origin for the wallet-facing URL',
    !/url:\s*window\.location\.origin/.test(metadataBlock)
      && !/window\.location\.origin/.test(metadataBlock)
  );
  t(
    'the metadata url is not a local/private origin fallback',
    !/https:\/\/(localhost|127\.0\.0\.1)/.test(metadataBlock)
  );

  /* ---- 2. the icon-404 bug never returns ---- */
  // The icon must be one of the real files (icon-192.png / icon-512.png),
  // served from the same public URL as the metadata.
  const iconMatch = metadataBlock.match(/icons:\s*\[`\$\{publicUrl\}\/([^`]+)`\]/);
  t('WC metadata declares an icon from the public URL', Boolean(iconMatch));
  if (iconMatch) {
    const iconFile = iconMatch[1];
    t(`the WC icon (${iconFile}) is a real file`, existsSync(join('public', iconFile)));
    t('the WC icon is the canonical 192 or 512 icon', /^icon-(192|512)\.png$/.test(iconFile));
  }
  // The old broken path must not reappear under any spelling.
  t('no WC icon points at the nonexistent /icon.png', !/\/icon\.png/.test(metadataBlock));

  /* ---- 3. the project ID is one source of truth, in SOURCE, not env ---- */
  /*
   * HISTORY: the ID used to be `import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID
   * || '<fallback>'`. Three pipelines (Vercel, the APK workflow, local dev)
   * each carried their own copy of that variable, and a stale copy in any one
   * of them silently shipped an OLD WalletConnect project whose dashboard
   * allowlist still named the retired lawpoetics.ir domain — wallets refused
   * to connect while the code looked correct. The env override is therefore
   * BANNED: the ID is the WC_PROJECT_ID constant and nothing else.
   */
  const envExample = readFileSync('.env.example', 'utf8');
  t('.env.example no longer sets VITE_WALLETCONNECT_PROJECT_ID (env override is retired)',
    !/^\s*VITE_WALLETCONNECT_PROJECT_ID=/m.test(envExample));
  t('.env.example documents that the ID lives in WalletContext.jsx',
    /WC_PROJECT_ID/.test(envExample));
  t('WalletContext never reads VITE_WALLETCONNECT_PROJECT_ID',
    !/VITE_WALLETCONNECT_PROJECT_ID/.test(code));
  t('the WC_PROJECT_ID constant equals the official project ID',
    new RegExp(`const WC_PROJECT_ID = '${PROJECT_ID}';`).test(code));
  t('the project ID appears exactly once in WalletContext',
    (code.match(new RegExp(PROJECT_ID, 'g')) || []).length === 1);
  /*
   * NOTE on .github/workflows/build-apk.yml: it still exports
   * VITE_WALLETCONNECT_PROJECT_ID from a repository variable, but that is now
   * dead weight — the code assertion above proves nothing reads it. The line
   * itself cannot be removed from this branch: the CI token has no `workflows`
   * permission, so any push touching workflow files is rejected wholesale.
   */

  /* ---- 4. no other wallet integration uses a different projectId ---- */
  const otherProjectIds = [];
  for (const f of ['src/lib/solanaWallet.js', 'src/lib/dydx.js', 'src/pages/SolanaSwap.jsx']) {
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8');
    const matches = src.match(/projectId\s*[:=]\s*['"][^'"]+['"]/g) || [];
    for (const m of matches) otherProjectIds.push(`${f}: ${m}`);
  }
  t(
    `no Solana/dYdX code declares its own WalletConnect projectId${
      otherProjectIds.length ? ` — found: ${otherProjectIds.join('; ')}` : ''
    }`,
    otherProjectIds.length === 0
  );

  /* ---- 5. redirect metadata stays consistent with the Android manifest ---- */
  const scheme = /<string name="custom_url_scheme">([^<]+)</.exec(
    readFileSync('android/app/src/main/res/values/strings.xml', 'utf8')
  )?.[1];
  t('the Android custom URL scheme is declared', Boolean(scheme));
  if (scheme) {
    t('WC metadata redirect.native matches the manifest scheme', wallet.includes(`${scheme}://`));
  }
  // The universal redirect must point at the same public origin as the metadata url.
  t('WC metadata redirect.universal reuses the public URL', /universal: publicUrl/.test(metadataBlock));

  /* ---- 6. the privacy settings disclose the WalletConnect relay ---- */
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  t('Settings privacy section discloses the WalletConnect relay in one line',
    typeof en.settings?.walletPrivacyLine === 'string'
      && en.settings.walletPrivacyLine.includes('WalletConnect')
      && en.settings.walletPrivacyLine.length > 40);
  const settings = readFileSync('src/pages/Settings.jsx', 'utf8');
  t('the privacy line is actually rendered on Settings', /settings\.walletPrivacyLine/.test(settings));

  return rows;
}
