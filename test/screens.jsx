/**
 * Smoke-render every screen touched by this change.
 *
 * These pages are lazy-loaded behind routes, so a broken import or a bad hook
 * call in one of them does not fail the build and does not fail the existing
 * boot test either — it fails silently at runtime for whoever taps that tab.
 * Rendering each one directly is the cheapest way to catch that.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import { FEE_BPS } from '../src/lib/feeBps.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Welcome from '../src/pages/Welcome.jsx';
import News from '../src/pages/News.jsx';
import Swap from '../src/pages/Swap.jsx';
import Leaderboard from '../src/pages/Leaderboard.jsx';
import Help from '../src/pages/Help.jsx';
import P2P from '../src/pages/P2P.jsx';
import BoardPanel from '../src/components/BoardPanel.jsx';
import CommunityPanel from '../src/components/CommunityPanel.jsx';
import Explore from '../src/pages/Explore.jsx';
import Discover from '../src/pages/Discover.jsx';
import Nft from '../src/pages/Nft.jsx';
import Orders from '../src/pages/Orders.jsx';
import SolanaSwap from '../src/pages/SolanaSwap.jsx';
import Buy from '../src/pages/Buy.jsx';
import Predict from '../src/pages/Predict.jsx';
import Market from '../src/pages/Market.jsx';
import Wallet from '../src/pages/Wallet.jsx';
import Settings from '../src/pages/Settings.jsx';
import Earn from '../src/pages/Earn.jsx';
import ExploreHub from '../src/pages/ExploreHub.jsx';
import Learn from '../src/pages/Learn.jsx';
import Rewards from '../src/pages/Rewards.jsx';
import Signals from '../src/pages/Signals.jsx';
import Farm from '../src/pages/Farm.jsx';
import CoinDetail from '../src/pages/CoinDetail.jsx';
import Stocks from '../src/pages/Stocks.jsx';
import Shop from '../src/pages/Shop.jsx';
import Bridge from '../src/pages/Bridge.jsx';
import Docs from '../src/pages/Docs.jsx';
import Developers from '../src/pages/Developers.jsx';
import Security from '../src/pages/Security.jsx';
import SmartWallet from '../src/pages/SmartWallet.jsx';
import SmartMoneyWallet from '../src/pages/SmartMoneyWallet.jsx';
import Portfolio from '../src/pages/Portfolio.jsx';
import IntentOS from '../src/pages/IntentOS.jsx';
import IntentAIUnified from '../src/components/IntentAIUnified.jsx';
import { EcosystemPanel } from '../src/components/IntentEcosystemPanel.jsx';
import {
  OperationsPanel,
  HistoryPanel,
  StatusPanel,
  IntelligencePanel
} from '../src/components/IntentOpsPanels.jsx';
import RestrictionsSheet from '../src/components/RestrictionsSheet.jsx';
import RadioPanel from '../src/components/RadioPanel.jsx';
import BuySellPanel from '../src/components/BuySellPanel.jsx';
import VaultCard from '../src/components/VaultCard.jsx';
import Vault from '../src/pages/Vault.jsx';
import AutopilotGuideSheet from '../src/components/AutopilotGuideSheet.jsx';
import SendSheet from '../src/components/SendSheet.jsx';
import ReceiveSheet from '../src/components/ReceiveSheet.jsx';
import LanguagePicker from '../src/components/LanguagePicker.jsx';
import Sheet from '../src/components/Sheet.jsx';
import UsernameField, { sanitizeUsername } from '../src/components/UsernameField.jsx';
import PageTransition from '../src/components/PageTransition.jsx';
import { useSettingsStore } from '../src/store/useSettingsStore.js';
import { setLanguage } from '../src/i18n/index.js';
import { LANGUAGES } from '../src/i18n/languages.js';

function Wrap({ children }) {
  return (
    <TelegramProvider>
      <WalletProvider>
        <HashRouter>{children}</HashRouter>
      </WalletProvider>
    </TelegramProvider>
  );
}

export async function run(container) {
  const out = [];
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    // jsdom implements no layout engine, so window.scrollTo and friends are
    // stubs that log "Not implemented". Every real browser and WebView has
    // them. Treating this as a failure would push us to remove working code
    // to satisfy the test environment, which is backwards.
    if (s.includes('Not implemented')) return;
    errors.push(s);
  };

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.portal] component renders through a portal to
   *   document.body (Sheet does), so `container` is legitimately empty and the
   *   assertion has to look at the body instead. Without this the test would
   *   report a false failure and push us to "fix" working code.
   * @param {boolean} [opts.mayBeEmpty] rendering NOTHING is a correct outcome
   *   for this component in this environment. Only RadioPanel uses it, and
   *   the reason is the point of the flag rather than a way around a failing
   *   test:
   *
   *     RadioPanel fetches /api/audio. jsdom has no server, the fetch
   *     rejects, and the component deliberately returns null — an empty
   *     "Crypto radio" heading over a permanent skeleton would be worse than
   *     no section at all.
   *
   *     So an empty render here is the component behaving correctly under an
   *     upstream failure. What still MUST hold is that it threw nothing,
   *     which is the assertion this whole file exists for, and that one is
   *     not relaxed.
   */
  async function mount(name, node, opts = {}) {
    const before = errors.length;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<Wrap>{node}</Wrap>);
      });
      const scope = opts.portal ? document.body : container;
      const rendered = opts.mayBeEmpty ? true : scope.textContent.trim().length > 0;
      out.push([`${name} renders`, rendered]);
      out.push([`${name} renders without a React error`, errors.length === before]);
    } catch (e) {
      out.push([`${name} renders`, false]);
      out.push([`${name} renders without a React error`, false]);
      errors.push(`${name}: ${e.message}`);
    } finally {
      await act(async () => root.unmount());
    }
  }

  await mount('Welcome', <Welcome onDone={() => {}} />);
  await mount('News', <News />);
  await mount('Swap', <Swap />);
  await mount('Leaderboard', <Leaderboard />);
  await mount('Help', <Help />);

  /*
   * P2P was NOT in this list, and that is exactly how a crash reached the
   * user: SendSheet read `chain.tokens[0]`, but EVM_CHAINS entries carry no
   * `tokens` key (the lists live in a separate TOKENS map), so the page threw
   * "Cannot read properties of undefined (reading '0')" the moment it
   * mounted. A smoke render would have caught it in one second.
   *
   * The lesson is not "add P2P" — it is that every routed screen belongs
   * here, because a lazy route that throws fails silently at build time and
   * loudly in the user's hands.
   */
  await mount('P2P', <P2P />);

  /*
   * The classifieds board, mounted DIRECTLY rather than through P2P.
   *
   * Mounting the page only proves the default tab renders — the board lives
   * behind a click, so a crash inside it (a bad hook order, a missing locale
   * namespace, an undefined read on `terms` before the fetch resolves) would
   * never be reached by the P2P mount above. That is the same blind spot the
   * comment above this line was written about, one level deeper.
   *
   * It renders with no wallet connected and with fetch failing, which is the
   * hostile case: the component must show the connect prompt and the offline
   * empty state instead of throwing.
   */
  await mount('BoardPanel', <BoardPanel />);

  /*
   * The community feed, mounted directly for the same reason as the board: it
   * lives behind a tab click, so the P2P mount above never reaches it. This
   * renders with fetch failing, which is the case that matters — a dead feed
   * must show the offline state, not throw and take the page with it.
   */
  await mount('CommunityPanel', <CommunityPanel />);
  await mount('Explore', <Explore />);
  await mount('Discover', <Discover />);
  await mount('Nft', <Nft />);
  await mount('Orders', <Orders />);
  /*
   * Solana renders with NO wallet injected, which is the state every user is
   * in before installing Phantom. The page must show the "install a wallet"
   * notice rather than throw on a null provider — the class of crash that took
   * out P2P and Settings before.
   */
  await mount('SolanaSwap (no wallet)', <SolanaSwap />);
  // Buy renders with no wallet connected — the state every new user is in.
  await mount('Buy (no wallet)', <Buy />);
  await mount('Predict', <Predict />);
  await mount('Market', <Market />);
  await mount('Wallet', <Wallet />);
  await mount('Settings', <Settings />);
  await mount('Earn', <Earn />);

  /*
   * The merged hubs. Each mounts a real page inside a tab shell, so a broken
   * `embedded` prop or a double PageTransition shows up here rather than in
   * someone's hands. Lab is omitted: it hosts the speculation screens, which
   * are compiled out of the default build.
   */
  await mount('ExploreHub (tabs)', <ExploreHub />);
  await mount('Learn (tabs)', <Learn />);
  await mount('Rewards (tabs)', <Rewards />);
  await mount('Signals', <Signals />);

  /*
   * Farm and CoinDetail both mount the new verdict / live-yield code, and both
   * are mounted here in the state that actually breaks things: NO network.
   *
   * Farm deliberately has no offline fallback list (a stale APY sends someone
   * to a pool that no longer pays what the screen said), so with every host
   * black-holed it must render its "rates unavailable" notice rather than
   * throw on `data.pools` of undefined. That null path is the one a real user
   * on a bad Iranian connection hits first.
   *
   * CoinDetail renders with no :id param, which is what a malformed deep link
   * produces. The verdict panel must decline to render rather than call
   * `analyze()` on nothing.
   */
  await mount('Farm (no network)', <Farm />);
  await mount('CoinDetail (no id)', <CoinDetail />);
  /*
   * Stocks under a dead network. It deliberately has no cached fallback (a
   * stale equity price can be a whole weekend old, and a cached row would not
   * have been re-checked against the issuer), so with every host black-holed
   * it must render its "prices unavailable" notice rather than throw on
   * `assets.equities` of undefined.
   */
  await mount('Stocks (no network)', <Stocks />);

  /*
   * Shop with every host black-holed AND no country chosen — the very first
   * state a new user sees. It must render the country picker rather than
   * throw on `countries.map` of undefined, and the collapsible limits box
   * must still be reachable.
   */
  await mount('Shop (no network, no country)', <Shop />);
  /*
   * Bridge with no wallet connected — the state every visitor is in before
   * they connect. It must render the "connect a wallet" notice and NOT try to
   * quote, since quoting without an address produces a 400 from our own
   * server.
   */
  await mount('Bridge (no wallet)', <Bridge />);

  /*
   * ─── DOCS SHIPPED BROKEN BECAUSE IT WAS NEVER MOUNTED HERE ──────────────
   * When the Persian video button was removed, `fa` was deleted from the map
   * destructuring but one `{(fa || en) && ...}` reference was left behind.
   * That is a ReferenceError at render time and it blanked the entire Docs
   * screen. Reported by the owner: «در مستندات وقتی میریم صفحه کرش میزنه».
   *
   * The build could not catch it — `fa` is a valid free identifier at parse
   * time and only throws when the line runs. Twenty-four screens were mounted
   * here and this was not one of them, which is exactly why it shipped.
   */
  await mount('Docs', <Docs />);

  /*
   * ─── DEVELOPERS AND AUDIT WERE THE SAME GAP DOCS FELL THROUGH ───────────
   * Both are routed screens reachable from the More menu, and neither was
   * mounted here. That is the identical hole that let the Docs ReferenceError
   * ship — twenty-five screens were covered and the crash happened on one of
   * the few that were not.
   *
   * Both were substantially rewritten in the same change that added this, so
   * they are precisely the files most likely to carry a fresh dead reference.
   */
  await mount('Developers', <Developers />);
  await mount('Security Center (offline)', <Security />);
  await mount('SmartWallet', <SmartWallet />);

  /*
   * ─── THE TWO SCREENS THE REPORT SITS ON ──────────────────────────────────
   * «بارگیری هوش کیف‌پول ممکن نشد… HTTP 502» and «دو گزینهٔ هوشمندسازی کیف
   * غلط است». The server half is covered by test/smart-money-probe.mjs; this
   * is the page half: what a PARTIAL payload must look like, and the fact
   * that the wallet rules now live on the Smart Wallet page instead of a
   * second editor inside Intent OS.
   */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  {
    const root = createRoot(container);
    container.innerHTML = '';
    try {
      await act(async () => { root.render(<Wrap><SmartWallet /></Wrap>); });
      await act(async () => { await sleep(40); });
      const box = container.querySelector('[data-testid="smart-wallet-intent-rules"]');
      out.push(['the smart wallet page carries the Intent OS rules box', Boolean(box)]);
      out.push(['the rules box is a closed disclosure, not a second settings screen',
        Boolean(box) && box.tagName === 'DETAILS' && box.open === false]);
      if (box) {
        /* jsdom does not implement the <summary> activation behaviour, so the
           open is driven the way the browser would leave it. */
        await act(async () => { box.open = true; await sleep(20); });
        const controls = box.querySelectorAll('select, input').length;
        out.push(['the rules box edits the four real rules plus the proof switch', controls >= 4 && /proof/i.test(box.textContent || '')]);
        const text = (box.textContent || '').replace(/\s+/g, ' ');
        out.push(['the box names both ceilings and the stricter one', (text.match(/\$\d+/g) || []).length >= 2 && /stricter|hard-blocks/i.test(text)]);
        out.push(['the confirmation floor is named as non-negotiable', /confirmation/i.test(text)]);
        out.push(['the box never claims to sign or send', !/will execute|auto-sign|automatically executes/i.test(text)]);
        out.push(['the rules box promises nothing about signing', !/automatically executes/i.test(text)]);
      }
    } finally {
      await act(async () => root.unmount());
      container.innerHTML = '';
    }
  }

  {
    const realFetch = globalThis.fetch;
    const D = 86_400_000;
    const PARTIAL = {
      dataStatus: 'partial', chain: 1, chainKind: 'evm', address: '0xf977814e90da44bfa03b6295a0616a897c410e98',
      firstSeen: Date.now() - 300 * D, ageMs: 300 * D, isFresh: false,
      txCount: null, txCountSource: null, portfolioUsd: 100,
      holdings: [
        { token: '0xa0b8', symbol: 'DAI', amount: 100, valueUsd: 100, priceUsd: 1, liquidityUsd: 9_000_000 },
        { token: '0xdead', symbol: '???', amount: 1, valueUsd: null, priceUsd: null, liquidityUsd: null }
      ],
      activity: [],
      pnl: {
        dataStatus: 'partial', reason: 'NO_CLOSED_TRADES', realizedUsd: null, unrealizedUsd: 50,
        totalUsd: 50, winRate: null, closedTrades: 0, best: null, worst: null
      },
      smartMoney: { score: 0, coverage: 0, factors: {} },
      reputation: { score: 0, coverage: 0, factors: {} },
      risk: { score: 0, band: 'LOW', coverage: 0, factors: {}, reasons: { plus: [], minus: [] } },
      tags: [],
      sources: { history: 'unavailable', nativeTxs: 'unavailable', balances: 'live', pricing: 'live', counters: 'unavailable' }
    };
    globalThis.fetch = async () => new Response(JSON.stringify(PARTIAL), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
    const root = createRoot(container);
    container.innerHTML = '';
    const errorsBefore = errors.length;
    try {
      await act(async () => {
        root.render(
          <Wrap>
            <SmartMoneyWallet embedded chainProp={1} addressProp="0xF977814e90dA44bFA03b6295A0616A897c410E98" />
          </Wrap>
        );
      });
      await act(async () => { await sleep(80); });
      const text = () => (container.textContent || '').replace(/\s+/g, ' ');
      out.push(['the wallet page renders a partial payload without throwing', errors.length === errorsBefore && text().length > 0]);
      out.push(['the dead sources are named on the page', /did not answer|پاسخ ندادند/i.test(text()) && /history/.test(text())]);
      out.push(['partial P&L is described as partial', /Only open positions are priced|no closed buy/i.test(text())]);
      out.push(['an unreadable activity feed is not called "no activity"', /could not be read/i.test(text())]);
      out.push(['an unknown transaction count never renders as zero', /Unknown/i.test(text()) && !/null transactions|0 transactions/i.test(text())]);
      out.push(['a score with no coverage renders as a dash, not a verdict', (container.querySelectorAll('.sm-score .n').length === 3
        && [...container.querySelectorAll('.sm-score .n')].every((n) => n.textContent.trim() === '—'))]);
      out.push(['the portfolio only claims a number it could price', /\$100/.test(text())]);
      out.push(['an unpriced token is flagged as unverified metadata', /1 of these tokens/i.test(text())]);
      out.push(['the degraded state offers to try again', [...container.querySelectorAll('button')].some((b) => /retry/i.test(b.textContent || ''))]);
    } finally {
      await act(async () => root.unmount());
      globalThis.fetch = realFetch;
      container.innerHTML = '';
    }
  }
  await mount('Portfolio', <Portfolio />);
  await mount('IntentOS', <IntentOS />);

  /*
   * ─── THE LIVE /intent SURFACE ───────────────────────────────────────────
   * `IntentAIUnified` is what `/intent` actually mounts (pages/IntentOS.jsx is
   * unrouted), and until now NOTHING rendered it in a test. Every probe
   * covering it greps its source text, which cannot catch a bad hook order, a
   * component referenced before it is defined, or a JSX tag left unbalanced by
   * a refactor — all of which produce a blank screen for the user while the
   * whole suite stays green.
   *
   * Its four panels are mounted open, individually, because each one has its
   * own data path and its own empty state; rendering the shell alone exercises
   * none of them.
   */
  await mount('IntentAIUnified', <IntentAIUnified />);
  await mount('OperationsPanel', <OperationsPanel open availability={() => ({ available: true })} onAction={() => {}} onClose={() => {}} locale="fa" />, { portal: true });
  await mount('HistoryPanel', <HistoryPanel open onClose={() => {}} conversations={[]} operations={[]} monitors={[]} locale="fa" />, { portal: true });
  await mount('StatusPanel', <StatusPanel open onClose={() => {}} status={{}} locale="fa" />, { portal: true });
  await mount('IntelligencePanel', <IntelligencePanel open onClose={() => {}} providers={[]} locale="fa" />, { portal: true });
  /* Agents + strategies, restored to a reachable surface. */
  await mount('EcosystemPanel', <EcosystemPanel open onClose={() => {}} locale="fa" />, { portal: true });

  /*
   * The three components added or rebuilt alongside them. Mounted directly
   * rather than trusting the parent page to exercise them: RadioPanel and the
   * Buy / Sell panel each have independent loading and unavailable states.
   *
   * RestrictionsSheet goes through a portal, like every other Sheet here.
   */
  await mount('RestrictionsSheet', <RestrictionsSheet open onClose={() => {}} />, { portal: true });
  await mount('RadioPanel', <RadioPanel />, { mayBeEmpty: true });
  await mount('BuySellPanel', <BuySellPanel />);

  /*
   * VaultCard with NO vault configured — the default, and the state every
   * user is in until one is deployed. Rendering nothing is the correct
   * outcome, so `mayBeEmpty`; what must hold is that it throws nothing.
   */
  await mount('VaultCard (no vault configured)', <VaultCard />, { mayBeEmpty: true });

  /*
   * The /vault page, mounted directly: it is lazy-loaded behind a route, so
   * no other mount reaches it. It renders with no vault configured, which is
   * the default on every deployment until one exists.
   */
  await mount('Vault (no vault configured)', <Vault />);

  /*
   * ─── THE AUTOPILOT GUIDE SHEET ───────────────────────────────────────────
   * It lives behind a button on the Orders foot, so the Orders mount above
   * never opens it — and the two states that matter are the ones the sheet
   * has to survive: a real price series, and no data at all.
   *
   * With no series the engine refuses (BAD_AMOUNT is the guard, but here it
   * is `why` running out of samples), and the sheet must fall back to the
   * honest "not enough data" copy rather than print a zero or a dash where a
   * measurement belongs. That fallback is the whole point of the component:
   * a guidance sheet that invents numbers is worse than no sheet.
   */
  const guideSeries = Array.from({ length: 90 }, (_, i) => ({
    t: 1_700_000_000 + i * 86_400,
    c: 3_000 + Math.sin(i / 7) * 90
  }));
  await mount('AutopilotGuideSheet (open, with a series)', (
    <AutopilotGuideSheet
      open
      onClose={() => {}}
      series={guideSeries}
      fromToken={{ symbol: 'USDT', address: '0x' }}
      toToken={{ symbol: 'ETH', address: '0x' }}
      chainId={1}
    />
  ), { portal: true });
  await mount('AutopilotGuideSheet (open, no data)', (
    <AutopilotGuideSheet
      open
      onClose={() => {}}
      series={null}
      fromToken={{ symbol: 'USDT', address: '0x' }}
      toToken={{ symbol: 'ETH', address: '0x' }}
      chainId={1}
    />
  ), { portal: true });

  /*
   * ─── THE NEW SURFACES IN PERSIAN (RTL) ──────────────────────────────────
   * Persian is the primary audience, so the gold/forex yield cards, the
   * autopilot guide sheet and the Buy external-wallet tab are re-rendered
   * under `dir="rtl"` and asserted there, not only in the default language.
   *
   * SCOPE, STATED PLAINLY: jsdom has no layout engine — `getBoundingClientRect`
   * returns zeros — so this block cannot measure a 360px column or detect
   * overflow. What it CAN prove is the half that actually caused the reported
   * breakage: the direction is applied, the Persian copy is what renders
   * (English leaking through would be the `earn.yield.*` keys missing from
   * fa.json), every tap target carries an explicit 44px floor, and nothing
   * throws. Pixel geometry needs a real browser.
   */
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const before = errors.length;
    await act(async () => {
      setLanguage('fa');
      root.render(
        <Wrap>
          <AutopilotGuideSheet
            open
            onClose={() => {}}
            series={guideSeries}
            fromToken={{ symbol: 'USDT', address: '0x' }}
            toToken={{ symbol: 'ETH', address: '0x' }}
            chainId={1}
          />
        </Wrap>
      );
    });

    /*
     * `Sheet` portals to document.body — which is the whole point of it, see
     * the centring block below — so the content is NOT inside `host`. My first
     * draft queried `host` and every assertion below silently measured nothing:
     * "every option starts closed" passed because there were no options to be
     * open. A check that passes on an empty set is worse than no check.
     */
    const sheetScope = document.body;
    out.push(['RTL: the guide sheet renders under dir=rtl',
      errors.length === before
      && document.documentElement.getAttribute('dir') === 'rtl']);
    /* The three goals PLUS all seven order options — ten cards, and every
       one closed: the owner's ask was a sheet that opens on a tap, not one
       that arrives already unpacked. */
    const heads = sheetScope.querySelectorAll('.ap-opt-head');
    out.push(['RTL: the sheet lists every goal and order option', heads.length === 10]);
    out.push(['RTL: every option starts closed',
      heads.length === 10
      && sheetScope.querySelectorAll('.ap-opt-open').length === 0
      && [...heads].every((b) => b.getAttribute('aria-expanded') === 'false')]);
    out.push(['RTL: a closed option shows no rows',
      sheetScope.querySelectorAll('.ap-fact-label').length === 0]);

    /* Open one, and only one: the three rows the owner specified appear, and
       the other two stay shut. */
    await act(async () => heads[1]?.click());
    out.push(['RTL: opening an option reveals its three rows',
      sheetScope.querySelectorAll('.ap-fact-label').length === 3
      && sheetScope.querySelectorAll('.ap-opt-open').length === 1]);
    out.push(['RTL: the other two stay closed',
      heads[0].getAttribute('aria-expanded') === 'false'
      && heads[2].getAttribute('aria-expanded') === 'false']);
    /* What it does / what we control / what we learn — in Persian, with the
       measured figures. A missing fa.json key renders the English string and
       looks fine until someone reads it. */
    const sheetText = sheetScope.textContent || '';
    out.push(['RTL: the sheet speaks Persian, not English',
      /[ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی]/.test(sheetText)
      && !/What we control|What you learn|What it does/i.test(sheetText)]);
    const factRows = [...sheetScope.querySelectorAll('.ap-fact-text')]
      .map((r) => r.textContent || '');
    /*
     * ─── THE BUG THIS CATCHES ───────────────────────────────────────────────
     * The three rows read `autopilot.${goal}.how`, but the copy lives at
     * `autopilot.goal.${goal}.how` — the same namespace the title two lines
     * above already used. i18n answered with the key itself, so the sheet
     * rendered «autopilot.protect.how» as a sentence, in every language, and
     * every other assertion still passed because the title and intro were
     * correct Persian. A key path is not checked by the "static key exists"
     * wiring scan because `${goal}` is not static, so it is asserted here.
     */
    out.push(['RTL: no row renders a raw i18n key',
      factRows.length === 3 && !factRows.some((row) => /autopilot\./.test(row))]);
    /*
     * The two measured rows carry a figure or an honest em dash — never a
     * fabricated 0, and never an empty cell. The first row is prose ("what it
     * does") and correctly contains no number, which is why it is not in this
     * list. `\d` is ASCII-only, so Persian digits are matched separately.
     */
    out.push(['RTL: the measured rows carry a figure, not an empty cell',
      factRows.length === 3
      && factRows.slice(1).every((row) => /\d|[۰-۹]|—/.test(row))]);
    /* Guidance only: the sheet must not be able to place an order. */
    out.push(['RTL: the guide sheet offers no submit path',
      !sheetScope.querySelector('form')
      && !/submit/i.test([...sheetScope.querySelectorAll('button')]
        .map((b) => b.getAttribute('type') || '').join(' '))]);

    await act(async () => root.unmount());
    host.remove();
  }

  /*
   * The yield cards in Persian: this is the surface the owner asked to see at
   * 360px, and it is the one whose buy buttons used to be a nested <button>
   * inside a <button>.
   */
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const before = errors.length;
    await act(async () => {
      setLanguage('fa');
      root.render(<Wrap><Earn /></Wrap>);
    });

    const yields = host.querySelectorAll('.earn-yield');
    out.push(['RTL: the yield cards render', errors.length === before && yields.length >= 5]);
    /*
     * The tap-target floor is asserted in test/wiring.mjs against index.css
     * rather than here: jsdom has no stylesheet and no layout engine, so
     * getComputedStyle returns nothing and a `>= 44` test would fail for the
     * wrong reason. What is provable at render time is the structure that the
     * CSS rule attaches to.
     */
    out.push(['RTL: each card has its header tap target',
      yields.length > 0
      && host.querySelectorAll('.earn-yield-head').length === yields.length]);
    /* Gold and forex are the two the owner named, and both must route INSIDE
       the app — an anchor to a foreign site is the bug that started this. */
    out.push(['RTL: no yield card links off-site',
      [...host.querySelectorAll('.earn-yield a')].every((a) => {
        const href = a.getAttribute('href') || '';
        return href.startsWith('/') || href.startsWith('#') || href === '';
      })]);
    /* The gold row's two buy buttons are what replaced the external link. */
    out.push(['RTL: the gold card offers both gold tokens',
      [...host.querySelectorAll('.earn-yield button')].some((b) => /PAXG/.test(b.textContent || ''))
      && [...host.querySelectorAll('.earn-yield button')].some((b) => /XAUt/.test(b.textContent || ''))]);
    out.push(['RTL: the yield copy is Persian',
      /[ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی]/.test(host.textContent || '')]);

    await act(async () => root.unmount());
    host.remove();
  }

  /*
   * SendSheet with no wallet connected: chainId is undefined, so both the
   * chain and the token lookup come back empty. That is a legitimate state
   * (the user opened the sheet before connecting) and must render the
   * "unsupported network" notice rather than throw.
   */
  await mount('SendSheet (no wallet)', <SendSheet open onClose={() => {}} />, { portal: true });
  await mount('ReceiveSheet (no wallet)', <ReceiveSheet open onClose={() => {}} />, { portal: true });

  /* Every language must render the picker without throwing. RTL languages in
     particular have bitten this app before — direction is applied to the
     document root, and a language whose meta is missing would silently leave
     the app in the previous direction. */
  for (const lang of LANGUAGES) {
    const root = createRoot(container);
    const before = errors.length;
    await act(async () => {
      setLanguage(lang.code);
      root.render(
        <Wrap>
          <LanguagePicker />
        </Wrap>
      );
    });
    out.push([`picker renders in ${lang.code}`, errors.length === before && container.textContent.includes(lang.endonym)]);
    out.push([
      `${lang.code} sets document direction to ${lang.dir}`,
      document.documentElement.getAttribute('dir') === lang.dir
    ]);
    await act(async () => root.unmount());
  }

  /* ---------------------- sheet centering (the bug) ---------------------- */
  /*
   * A Sheet rendered inside PageTransition used to mount inside an element
   * that framer-motion transforms. A transformed ancestor is the containing
   * block for `position: fixed`, so the dialog centred against the page box
   * instead of the viewport and drifted off-screen on long pages like Swap.
   * The portal is the fix, so assert the portal — not the pixels, which jsdom
   * cannot lay out anyway.
   */
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Wrap>
          <PageTransition>
            <Sheet open title="t">
              <div id="sheet-probe" />
            </Sheet>
          </PageTransition>
        </Wrap>
      );
    });

    const probe = document.getElementById('sheet-probe');
    const layer = document.querySelector('.sheet-layer');
    out.push(['sheet renders when open', Boolean(probe && layer)]);
    out.push(['sheet escapes the page container', probe ? !host.contains(probe) : false]);
    out.push(['sheet is portalled to body', layer ? layer.parentElement === document.body : false]);
    out.push([
      'sheet has no transformed ancestor between it and body',
      layer ? layer.parentElement === document.body : false
    ]);
    out.push(['sheet body is the scroll container, not the whole dialog', Boolean(document.querySelector('.sheet-body'))]);

    await act(async () => root.unmount());
    host.remove();
  }

  /* -------------------------- username sanitiser ------------------------- */
  /* The value renders inside other users' clients, so this is a security
     boundary, not a formatting nicety. */

  out.push(['strips angle brackets', !sanitizeUsername('<script>x').includes('<')]);
  out.push(['strips quotes and backslashes', sanitizeUsername(`a"b'c\\d\`e`) === 'abcde']);
  out.push(['strips bidi override characters', sanitizeUsername('ali\u202Ereversed') === 'alireversed']);
  out.push(['strips control characters', sanitizeUsername('a\u0000b\u001fc') === 'abc']);
  out.push(['caps length at 20', sanitizeUsername('x'.repeat(80)).length === 20]);
  out.push(['collapses runs of whitespace', sanitizeUsername('a    b') === 'a b']);
  out.push(['keeps non-Latin scripts intact', sanitizeUsername('علی رضا') === 'علی رضا']);

  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    useSettingsStore.setState({ username: '' });
    await act(async () => {
      root.render(
        <Wrap>
          <UsernameField />
        </Wrap>
      );
    });
    const input = host.querySelector('#fbt-username');
    out.push(['username field renders an input', Boolean(input)]);

    // Typing a hostile value must reach the store already clean.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '<b>ali</b>');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const saved = useSettingsStore.getState().username;
    out.push([`store never receives markup (got "${saved}")`, !/[<>]/.test(saved)]);

    await act(async () => root.unmount());
    host.remove();
    useSettingsStore.setState({ username: '' });
  }

  /* ---------------------- Help: FAQ, not a chat box ---------------------- */
  /*
   * The AI assistant was removed deliberately (see the header of Help.jsx).
   * Assert both halves: the chat input is gone, and the FAQ that replaced it
   * actually renders answers — a "removal" that leaves an empty screen would
   * be worse than what was there before.
   */
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    setLanguage('fa');
    await act(async () => {
      root.render(
        <Wrap>
          <Help />
        </Wrap>
      );
    });

    /*
     * The ask box is back, so "no input" is no longer the requirement. What
     * MUST hold is that it cannot become an ungrounded chatbot inventing fees:
     * it answers from the local FAQ first, and every answer is labelled with
     * its source. Assert those properties instead of asserting absence.
     */
    const askInput = host.querySelector('input[type="text"]');
    out.push(['Help has an ask box', Boolean(askInput)]);
    out.push(['starter suggestions are offered', host.querySelectorAll('.ask-chip').length >= 3]);

    if (askInput) {
      // A question the local FAQ answers confidently must never hit the
      // network — there is no server in this test, so a network answer would
      // be impossible and the assertion would fail loudly.
      const proto = Object.getPrototypeOf(askInput);
      const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
      await act(async () => {
        setValue.call(askInput, 'کارمزد چقدر است');
        askInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      await act(async () => {
        host.querySelector('form')?.dispatchEvent(
          new window.Event('submit', { bubbles: true, cancelable: true })
        );
      });
      // Let the (synchronous) local path settle.
      await act(async () => { await Promise.resolve(); });

      const text = host.textContent;
      /*
       * Derived from FEE_BPS, not typed. This line used to assert the literal
       * '۰.۵٪', so it stayed green while the canned Persian answer quoted a
       * fee the app had stopped charging — the test agreed with the bug.
       */
      const feePctFa = String(Number((FEE_BPS / 100).toFixed(2)))
        .replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
        .replace('.', '٫');
      out.push([
        `a known question is answered without a server (quotes ${FEE_BPS} bps)`,
        text.includes(feePctFa)
      ]);
      out.push(['the answer is labelled as coming from our docs', text.includes('از مستندات ما')]);

      // Threaded: the question stays on screen next to its answer, so a
      // follow-up has context. A single-answer box loses that.
      out.push(['the question is kept in the thread', Boolean(host.querySelector('.ask-user'))]);
      out.push(['the answer is a bot turn', Boolean(host.querySelector('.ask-bot'))]);

      /*
       * A general question has no FAQ match, so with no server reachable it
       * MUST fall through to the "contact support" message. Answering it
       * anyway would mean something invented the answer.
       */
      await act(async () => {
        setValue.call(askInput, 'قیمت طلا فردا چقدر است');
        askInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      await act(async () => {
        host.querySelector('form')?.dispatchEvent(
          new window.Event('submit', { bubbles: true, cancelable: true })
        );
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
      out.push([
        'an unknown question offline points at human support, it does not invent',
        host.textContent.includes('پشتیبانی')
      ]);
    }

    const rows = [...host.querySelectorAll('.faq-q')];
    out.push([`Help lists the FAQ (${rows.length} questions)`, rows.length >= 10]);
    out.push(['FAQ questions are translated, not raw keys', rows.every((r) => !/^help\.q\./.test(r.textContent.trim()))]);
    out.push(['answers are collapsed until asked for', !host.querySelector('.faq-a')]);

    // Expanding must reveal a real answer, in the active language.
    await act(async () => rows[0].click());
    const answer = host.querySelector('.faq-a');
    out.push(['tapping a question reveals its answer', Boolean(answer && answer.textContent.length > 60)]);
    out.push(['the answer is in the active language', /[\u0600-\u06FF]/.test(answer?.textContent ?? '')]);

    await act(async () => root.unmount());
    host.remove();
  }

  /* ------------- automatic orders: does a selection LOOK selected? ------- */
  /*
   * REPORTED: «بعضی از دکمه‌هاش وقتی فعالند رنگش تغییر نمی‌کند مثلا قیمت افت
   * می‌کند یا بالا می‌رود» — tapping "price falls to" / "price rises to"
   * appeared to do nothing.
   *
   * The class WAS being applied, which is why every existing test passed. What
   * was missing is the element that makes `.active` visible: `.segmented
   * button.active` only sets `color: #000`, and the coloured pill behind it is
   * a separate <SegIndicator> this screen never rendered. Black text on a
   * near-black panel is LESS visible than the unselected state.
   *
   * So asserting `classList.contains('active')` would have passed while the
   * bug was live. This asserts the INDICATOR, in the DOM, moving between the
   * two buttons on click — the thing the user actually sees.
   */
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Wrap><Orders /></Wrap>);
    });

    // Open the limit-order sheet. Buttons are matched by class, not by label,
    // so this survives a copy change in any of the twelve languages.
    const newLimit = host.querySelector('.ord-new-limit');
    out.push(['the limit-order button exists', Boolean(newLimit)]);
    await act(async () => newLimit?.click());

    // The sheet portals to document.body, so query there rather than in host.
    const seg = [...document.querySelectorAll('.segmented')];
    out.push([`the order form has segmented controls (${seg.length})`, seg.length >= 1]);

    const dirBtns = seg[0] ? [...seg[0].querySelectorAll('button')] : [];
    out.push(['the direction control has two options', dirBtns.length === 2]);

    if (dirBtns.length === 2) {
      const activeIdx = () => dirBtns.findIndex((b) => b.classList.contains('active'));
      const indicatorIdx = () =>
        dirBtns.findIndex((b) => b.querySelector('.seg-indicator'));

      out.push(['one direction starts selected', activeIdx() >= 0]);
      /*
       * THE ACTUAL BUG. Before the fix this was -1: the class was set and the
       * indicator did not exist anywhere in the control.
       */
      out.push(['the selected direction renders a visible indicator', indicatorIdx() >= 0]);
      out.push(['the indicator is on the selected button', indicatorIdx() === activeIdx()]);

      // A screen reader must be told too — colour is not available to everyone.
      out.push([
        'the selected direction is announced to assistive tech',
        dirBtns[activeIdx()]?.getAttribute('aria-pressed') === 'true'
      ]);

      // And it must MOVE. A pill that is painted on the first option and never
      // updates would pass every check above.
      const other = 1 - activeIdx();
      await act(async () => dirBtns[other].click());
      out.push(['selecting the other direction moves the selection', activeIdx() === other]);
      out.push(['…and the indicator follows it', indicatorIdx() === other]);
      out.push([
        '…and aria-pressed follows it too',
        dirBtns[other].getAttribute('aria-pressed') === 'true' &&
          dirBtns[1 - other].getAttribute('aria-pressed') === 'false'
      ]);
    }

    await act(async () => root.unmount());
    host.remove();
  }

  setLanguage('fa');
  console.error = realError;
  if (errors.length) out.push([`no console errors (${errors.slice(0, 2).join(' | ').slice(0, 200)})`, false]);
  return out;
}
