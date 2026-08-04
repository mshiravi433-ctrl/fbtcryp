import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Wallet from '../src/pages/Wallet.jsx';
/**
 * THE WALLET PANEL'S STRUCTURE
 * ---------------------------------------------------------------------------
 * Reported twice: "صفحه والت کامل بهم خورده، دکمه ها اندازشون درست نیست."
 *
 * The cause was three sources of truth for one panel's geometry — `.card`
 * setting 15px padding, `.wal-hero` setting 18px, and a divider hard-coding
 * `-18px` to bleed to the edges. Whichever won the cascade, the hairline was
 * 3px out on each side; and the Buy button was a `.btn-sm` (which declares
 * `width: auto`) with an inline `width: 100%` fighting it.
 *
 * Asserted in the DOM rather than by reading CSS, because the failure was a
 * CASCADE outcome: both rules were individually reasonable and the bug only
 * existed in their combination.
 */
export async function run(c) {
  const out=[]; const root=createRoot(c);
  await act(async()=>{root.render(<TelegramProvider><WalletProvider><HashRouter><Wallet/></HashRouter></WalletProvider></TelegramProvider>);});
  const hero=c.querySelector('.wal-hero');
  out.push(['hero exists', !!hero]);
  out.push(['hero is NOT also .card', hero && !hero.classList.contains('card')]);
  out.push(['mesh svg present', !!c.querySelector('.wal-mesh')]);
  out.push(['empty-state svg present', !!c.querySelector('.wal-empty svg')]);
  // count every button and look for inline width hacks
  const inline=[...c.querySelectorAll('[style*="width: 100%"]')];
  out.push([`no inline width:100% hacks (found ${inline.length})`, inline.length===0]);
  await act(async()=>root.unmount());
  return out;
}
