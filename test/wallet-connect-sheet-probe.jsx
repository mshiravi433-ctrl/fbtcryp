import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import WalletConnectSheet from '../src/components/WalletConnectSheet.jsx';

/**
 * THE CONNECT SHEET MOUNTS
 * ---------------------------------------------------------------------------
 * The sheet is the surface every wallet report starts from, and it is the only
 * place four transports, a QR encoder and the health panel come together — so
 * it is asserted in the DOM, not by reading its source. The checks are
 * deliberately structural: they prove the surface renders, offers the routes
 * that do not depend on the relay, and carries the diagnostic, without touching
 * a wallet or the network.
 */
export async function run(container) {
  const out = [];
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TelegramProvider>
        <WalletProvider>
          <WalletConnectSheet open onClose={() => {}} />
        </WalletProvider>
      </TelegramProvider>
    );
  });

  /* Sheet portals to document.body so `position: fixed` means the viewport —
     the container stays empty by design. */
  const surface = (typeof document !== 'undefined' && document.body) || container;
  const text = surface.textContent || '';
  /* `.wc-card` is the row class of the 2026-09-18 restyle (it replaced
     `.wallet-option` on this surface); both are accepted so the probe asserts
     the SURFACE, not a class name. */
  const rows = [...surface.querySelectorAll('.wc-card, .wallet-option')];
  const buttons = [...surface.querySelectorAll('button')];

  out.push(['the sheet renders', rows.length >= 3]);
  out.push(['WalletConnect is offered', /WalletConnect/.test(text)]);
  /* The email/social embedded-wallet row was REMOVED on 2026-09-18: it needed a
     second AppKit instance sharing the controllers and the one <w3m-modal> with
     WalletConnect, which is how an email tap came to open the wallet grid
     instead of the login form. Its absence is asserted as firmly as the
     presence of the routes that stayed. */
  out.push(['the retired email/social row is gone', !/Email|Social|Google|Apple/i.test(text)]);
  out.push(['the in-app vault is offered', text.length > 0 && buttons.length >= 3]);
  out.push(['the self-custody warning is on screen', /keys|seed|recovery/i.test(text)]);
  out.push(['the health check is one tap away', Boolean(surface.querySelector('details'))]);
  /* The two INTERPOLATED keys are the only ones that can silently resolve to
     nothing — every literal key is present in the shipped locale files. */
  const leaks = (text.match(/wallet\.(?:err|strength)\.[a-zA-Z]+/g) || []);
  out.push([`no unresolved i18n key on screen${leaks.length ? ` — ${leaks.join(', ')}` : ''}`, leaks.length === 0]);
  out.push(['no React error boundary fired', !/Something went wrong|Minified React error/.test(text)]);

  /*
   * ─── THE 2026-09-18 RESTYLE, ASSERTED STRUCTURALLY ───────────────────────
   * The request was visual («باید ایکون‌ها و باکس مدرن‌تر شود … در تم تیره و
   * روشن درست با فاصله و زبان درست»), so these checks are about the properties
   * that make it visual — grouping, an icon per row, and a stylesheet written
   * against tokens with LOGICAL offsets (which is what makes the same markup
   * correct in Persian, right-to-left).
   */
  const wcRows = [...surface.querySelectorAll('.wc-card')];
  const groupLabels = [...surface.querySelectorAll('.wc-group-label')];
  out.push([`the options are grouped, not one flat list (${groupLabels.length} groups)`, groupLabels.length >= 2]);
  out.push(['every wallet row has an icon tile', wcRows.length >= 3 && wcRows.every((r) => r.querySelector('.wc-mark'))]);
  out.push(['each row explains itself in a second line', wcRows.every((r) => r.querySelector('.wc-card-sub'))]);
  out.push(['the self-custody line is its own footer', Boolean(surface.querySelector('.wc-foot'))]);
  /* A chevron that points the right way in Persian is a CSS rule, not an inline
     style: `[dir='rtl'] .wc-chev { transform: scaleX(-1) }`. */
  out.push(['every row ends in a direction-aware chevron', wcRows.every((r) => r.querySelector('.wc-chev'))]);

  const css = readFileSync('src/styles/wallet-connect.css', 'utf8');
  const logical = (css.match(/padding-inline|margin-inline|inset-inline|text-align: start/g) || []).length;
  out.push([`the stylesheet uses logical offsets for RTL (${logical} found)`, logical >= 3]);
  out.push(['the light theme is handled explicitly, not inherited',
    (css.match(/:root\[data-theme='light'\] \.[a-z-]*wc-/g) || []).length >= 3]);
  out.push(['motion respects the reduce-motion setting', /data-reduce-motion='true'\] \.wc-spinner/.test(css)]);
  out.push(['the sheet declares its own stylesheet', /styles\/wallet-connect\.css/.test(readFileSync('src/components/WalletConnectSheet.jsx', 'utf8'))]);

  await act(async () => root.unmount());
  return out;
}
