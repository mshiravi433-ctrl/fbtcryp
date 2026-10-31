/** Real Buy page for visual regression tests. Never submits a payment.
 * Start the web server, then run test/buy-sell-layout-browser.mjs.
 * API responses are local fixtures: this review works without credentials.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../../src/i18n/index.js';
import fa from '../../src/i18n/locales/fa.json';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import Buy from '../../src/pages/Buy.jsx';
import '../../src/index.css';

i18n.addResourceBundle('fa', 'translation', fa);
const params = new URLSearchParams(location.search);
await i18n.changeLanguage(params.get('lang') || 'fa');
document.documentElement.lang = i18n.language;
document.documentElement.dir = i18n.dir();
document.documentElement.dataset.theme = params.get('theme') || 'dark';

/* Optional read-only injected-wallet fixture. It exposes a public test address,
   never a key, and cannot sign or send a transaction. */
if (params.get('wallet') === '1') {
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'];
      if (method === 'eth_chainId') return '0x38';
      if (method === 'net_version') return '56';
      return null;
    },
    on() {},
    removeListener() {}
  };
}

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const path = String(typeof input === 'string' ? input : input?.url || '');
  let payload;
  if (path.includes('/iran/buy/config')) payload = {
    enabled: false,
    referral: {
      partner: 'bitpin', url: 'https://bitpin.ir/register?ref=VISUAL_FIXTURE',
      discountNote: fa.iranBuy.referral.disclosure,
      network: { id: 'BEP20', label: 'BEP20', walletFamily: 'EVM', chainId: 56 }
    },
    readiness: ['ACTIVATION']
  };
  else if (path.includes('/buy-sell/providers')) payload = { buyAvailable: false, sellAvailable: false, providers: [] };
  else if (path.includes('/buy-sell/assets')) payload = { assets: [] };
  if (payload) return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  return nativeFetch(input, init);
};

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/buy']}>
    <div className="app-shell buy-sell-fixture">
      <WalletProvider>
        <Routes><Route path="/buy" element={<Buy />} /></Routes>
      </WalletProvider>
    </div>
  </MemoryRouter>
);
