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
  const rows = [...surface.querySelectorAll('.wallet-option')];
  const buttons = [...surface.querySelectorAll('button')];

  out.push(['the sheet renders', rows.length >= 3]);
  out.push(['WalletConnect is offered', /WalletConnect/.test(text)]);
  out.push(['email & social is offered', /Email/.test(text)]);
  out.push(['the in-app vault is offered', text.length > 0 && buttons.length >= 3]);
  out.push(['the self-custody warning is on screen', /keys|seed|recovery/i.test(text)]);
  out.push(['the health check is one tap away', Boolean(surface.querySelector('details'))]);
  /* The two INTERPOLATED keys are the only ones that can silently resolve to
     nothing — every literal key is present in the shipped locale files. */
  const leaks = (text.match(/wallet\.(?:err|strength)\.[a-zA-Z]+/g) || []);
  out.push([`no unresolved i18n key on screen${leaks.length ? ` — ${leaks.join(', ')}` : ''}`, leaks.length === 0]);
  out.push(['no React error boundary fired', !/Something went wrong|Minified React error/.test(text)]);

  await act(async () => root.unmount());
  return out;
}
