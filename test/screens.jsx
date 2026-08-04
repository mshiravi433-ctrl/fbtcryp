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
   */
  async function mount(name, node, opts = {}) {
    const before = errors.length;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<Wrap>{node}</Wrap>);
      });
      const scope = opts.portal ? document.body : container;
      const rendered = scope.textContent.trim().length > 0;
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
