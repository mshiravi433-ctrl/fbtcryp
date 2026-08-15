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
 * Also guarded here: the project ID must be a single source of truth (env var
 * first, one hardcoded fallback), and every place that mentions a WalletConnect
 * project ID must agree, so Solana/TON/dYdX prompts never disagree about the
 * site's identity.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ID = '14bdc2642bb5f01972ffe799e43b978d';

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

  /* ---- 3. the project ID is one documented source of truth ---- */
  const envExample = readFileSync('.env.example', 'utf8');
  t('VITE_WALLETCONNECT_PROJECT_ID is documented in .env.example', /VITE_WALLETCONNECT_PROJECT_ID=/.test(envExample));
  t('the documented .env.example value is the official project ID',
    new RegExp(`VITE_WALLETCONNECT_PROJECT_ID=${PROJECT_ID}`).test(envExample));
  t('WalletContext keeps the env override first', /import\.meta\.env\?\.VITE_WALLETCONNECT_PROJECT_ID \|\|/.test(code));
  t('the hardcoded fallback equals the official project ID',
    code.includes(`|| '${PROJECT_ID}'`));
  // The value must never appear with a different ID anywhere else in client code.
  const otherIds = [
    ...code.matchAll(/['"]14bdc2642bb5f01972ffe799e43b978d['"]/g)
  ].length;
  t('the project ID appears exactly once as the fallback literal', otherIds === 1);

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
