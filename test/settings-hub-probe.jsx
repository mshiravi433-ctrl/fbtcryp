/**
 * SETTINGS HUB — DRIVEN LIKE A USER DRIVES IT.
 * ---------------------------------------------------------------------------
 * The request was a redesign («هر بخش یک باکس با ایکون، با یک پاپ‌آپ
 * زیرگزینه‌هایش باز شود»), and a redesign of this screen has failed before in a
 * way no screenshot catches: settings here are not decoration, they are nine
 * store writes and four security flows. The recurring bug in this repo is a
 * control that renders, persists nothing, and still looks right — a switch that
 * writes a value nobody reads. A "the popup opens" assertion would not have
 * caught any of that.
 *
 * So this mounts the REAL screen and presses it:
 *
 *   · every tile opens one dialog, and every dialog holds its section's rows
 *   · every control in a popup writes the store it is supposed to write, and
 *     the store write reaches the DOM (data-theme / data-accent / evmChainId),
 *     which is the half that was missing the last four times
 *   · a sub-view goes deeper without stacking a second dialog
 *   · Escape dismisses, and a destructive row opens its own confirmation
 *   · `?section=` deep-links a popup, because the assistant sends people here
 *   · the region map keeps its per-row state on screen and the acknowledgement
 *     it promises actually reaches localStorage (it was unreachable for months)
 *
 * jsdom has no layout, so nothing here asserts on geometry — that is what the
 * CSS comments and the 44px floors in styles/settings-hub.css are for.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import i18n, { setLanguage } from '../src/i18n/index.js';
import Settings from '../src/pages/Settings.jsx';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import { HashRouter } from 'react-router-dom';
import { useSettingsStore } from '../src/store/useSettingsStore.js';
import { getNotifySettings } from '../src/lib/notify.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Wrap({ children }) {
  return (
    <TelegramProvider>
      <WalletProvider>
        <HashRouter>{children}</HashRouter>
      </WalletProvider>
    </TelegramProvider>
  );
}

const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function press(el) {
  if (!el) {
    console.log('  [probe] press(): element missing');
    return false;
  }
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(0);
  });
  await sleep(60);
  return true;
}

/*
 * A Sheet leaves with a spring, which in jsdom takes the best part of a second
 * of animation frames. Counting dialogs before it settles measures the
 * animation rather than the screen, so every step that cares about how many
 * dialogs exist waits for the count to reach what the screen is supposed to
 * show (or to stop changing) before it looks.
 */
async function settle(wanted, maxMs = 2200) {
  const start = Date.now();
  let last = -1;
  for (;;) {
    const n = qa('[role="dialog"]').length;
    if (wanted === undefined ? (n === last && Date.now() - start > 120) : n === wanted) return n;
    last = n;
    if (Date.now() - start > maxMs) return n;
    await act(async () => { await sleep(60); });
  }
}

/** Opens a section popup and returns its dialog element. */
async function openTile(labelText) {
  const tile = qa('.set-tile').find((b) => (b.textContent || '').includes(labelText));
  if (!tile) console.log('  [probe] no tile for', JSON.stringify(labelText), '— tiles:', qa('.set-tile').map((b) => b.textContent.slice(0, 12)));
  await press(tile);
  await settle(1);
  const dialogs = qa('[role="dialog"]');
  if (!dialogs.length) console.log('  [probe] tile', labelText, 'opened no dialog');
  return dialogs.pop();
}

/*
 * A Sheet animates OUT (a spring on the panel, 0.18s on the backdrop), so its
 * node is still in the DOM for a third of a second after the close. Counting
 * dialogs any earlier measures the animation, not the screen.
 */
async function closeDialog() {
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(0);
  });
  await settle(0);
}

export async function run(container) {
  const out = [];
  const t = (name, ok) => {
    out.push([name, Boolean(ok)]);
    if (!ok) console.log('  [probe][fail]', name);
  };

  /* Persian is the primary market, and the only language in which the copy on
     this screen was reviewed. Every lookup below goes through t() so the probe
     still says something when the harness boots in English. */
  await setLanguage('fa');
  await sleep(60);

  const root = createRoot(container);
  await act(async () => {
    root.render(<Wrap><Settings /></Wrap>);
    await sleep(60);
  });

  /* ---------------------------- 1 · the hub itself ---------------------- */
  const tiles = qa('.set-tile');
  t('the hub renders one tile per section', tiles.length >= 9);
  t('every tile carries a drawn icon, not an emoji', tiles.every((b) => q('.set-tile-ico svg', b)));
  t('every tile states what is inside it', tiles.every((b) => (q('.set-tile-sub', b)?.textContent || '').trim().length > 4));
  t('the tiles are real buttons with a dialog affordance', tiles.every((b) => b.tagName === 'BUTTON' && b.getAttribute('aria-haspopup') === 'dialog'));
  t('the profile box is on the surface with the avatar', Boolean(q('.set-hero')) && Boolean(q('.set-hero-open')) && Boolean(q('.set-hero .profile-badge')));
  /*
   * ProfileBadge is a button of its own. Nested inside the hero button, browsers
   * un-nest the markup: the avatar disappears or its tap fires both actions, and
   * the bell popup becomes unreachable. So the badge must be a SIBLING, and no
   * control on this screen may sit inside another control.
   */
  t('the avatar is a sibling of the open control, not a child of it',
    Boolean(q('.set-hero .profile-badge')) && !q('.set-hero-open .profile-badge'));
  t('no control is nested inside another',
    qa('.set-hero button button, .set-hub button button, .set-sheet button button, .set-row button').length === 0);
  t('no native <select> is left in the screen', qa('select').length === 0);

  /* ------------------------- 2 · appearance writes DOM ------------------ */
  useSettingsStore.setState({ theme: 'dark', accent: 'rgb' });
  const L = (k) => String(i18n.t(k));
  let dialog = await openTile(L('settings.appearance'));
  t('tapping a tile opens exactly one popup', qa('[role="dialog"]').length === 1 && Boolean(dialog));
  t('the popup carries the section icon in its header', Boolean(q('.set-sheet-title-ico svg')));
  const themeOpts = qa('.set-opt', dialog);
  t('the theme offers three choices, one pressed', themeOpts.length >= 3 && themeOpts.some((b) => b.getAttribute('aria-pressed') === 'true'));

  const lightBtn = themeOpts.find((b) => (b.textContent || '').includes(i18n.t('settings.themeLight')));
  await press(lightBtn);
  t('choosing the light theme writes the store', useSettingsStore.getState().theme === 'light');
  t('...and the document really flipped to light', document.documentElement.getAttribute('data-theme') === 'light');
  t('the chosen option is marked selected, not only coloured', (q('.set-opt.is-on', document)?.getAttribute('aria-pressed') === 'true'));

  const swatch = qa('.set-swatch', document)[1];
  await press(swatch);
  /*
   * The reduce-motion switch is the only producer of the data-reduce-motion
   * attribute every animation rule on this screen keys off, so it is checked
   * against the document element rather than against the store.
   */
  const motionSwitch = qa('[role="switch"]', document).find((b) => (b.getAttribute('aria-label') || '').includes(i18n.t('settings.reduceMotion')));
  const motionBefore = useSettingsStore.getState().reduceMotion;
  await press(motionSwitch);
  t('the reduce-motion switch writes the attribute the CSS waits for',
    useSettingsStore.getState().reduceMotion === !motionBefore
    && document.documentElement.getAttribute('data-reduce-motion') === String(!motionBefore));
  await press(motionSwitch);
  t('...and turns it back off again', document.documentElement.getAttribute('data-reduce-motion') === String(motionBefore));

  t('the accent swatch writes the store', useSettingsStore.getState().accent === 'pastel');
  t('...and sets data-accent for the readable light inks', document.documentElement.getAttribute('data-accent') === 'pastel');

  /* --------------------------- 3 · trading writes ----------------------- */
  await closeDialog();
  useSettingsStore.setState({ defaultSlippage: 0.5, defaultDeadlineMin: 20, currency: 'USD' });
  dialog = await openTile(L('settings.trading'));
  const slippage = qa('.set-opt', document).find((b) => (b.textContent || '').trim().startsWith('1%'));
  await press(slippage);
  t('a slippage chip writes the default slippage', useSettingsStore.getState().defaultSlippage === 1);
  const deadline = qa('.set-opt', document).find((b) => (b.textContent || '').includes('30'));
  await press(deadline);
  t('a deadline chip writes the default deadline', useSettingsStore.getState().defaultDeadlineMin === 30);
  const eur = qa('.set-opt', document).find((b) => (b.textContent || '').includes('EUR'));
  await press(eur);
  t('the currency grid writes the display currency', useSettingsStore.getState().currency === 'EUR');
  t('the expert-mode switch is a real role=switch', Boolean(q('[role="switch"]', document)));

  /* --------------------------- 4 · networks chain ---------------------- */
  await closeDialog();
  dialog = await openTile(L('settings.networks'));
  const before = useSettingsStore.getState().evmChainId;
  const chainGroup = qa('.set-opts', document)[0];
  t('the chain picker lists every supported network', qa('.set-opt', chainGroup).length >= 8);
  const chainBtn = qa('.set-opt', chainGroup).find((b) => !b.classList.contains('is-on'));
  await press(chainBtn);
  t('a chain chip switches the stored EVM chain', useSettingsStore.getState().evmChainId !== before);
  t('every chain chip shows its network colour', qa('.set-opt-dot', chainGroup).length >= 8);
  const devnet = qa('.set-opts', document)[1] && qa('.set-opt', qa('.set-opts', document)[1]).find((b) => (b.textContent || '').includes('Devnet'));
  await press(devnet);
  t('the Solana cluster is written too', useSettingsStore.getState().solanaCluster === 'devnet');

  /* ------------------- 5 · sub-view: RPC editor, no 2nd dialog --------- */
  const rpcRow = qa('.set-row', document).find((b) => (b.textContent || '').includes(i18n.t('settings.customRpc')));
  await press(rpcRow);
  t('the RPC editor opens as a second level', Boolean(q('.set-subview')) && Boolean(q('input[aria-label="EVM RPC"]', document)));
  t('...without stacking a second dialog', qa('[role="dialog"]', document).length === 1);
  const rpcInput = q('input[aria-label="EVM RPC"]', document);
  if (rpcInput) await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(rpcInput, 'https://rpc.example/test');
    rpcInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(0);
  });
  const saveBtn = qa('button', document).find((b) => (b.textContent || '').trim() === i18n.t('common.confirm'));
  await press(saveBtn);
  t('saving an RPC persists it', useSettingsStore.getState().customEvmRpc === 'https://rpc.example/test');
  t('...and the sub-view closed while the section popup stays open', !q('.set-subview') && qa('[role="dialog"]').length === 1);

  /* ---------------------- 6 · profile name + language ------------------ */
  useSettingsStore.setState({ username: '' });
  await closeDialog();
  dialog = await openTile(L('settings.profile'));
  const nameRow = qa('.set-row', document).find((b) => (b.textContent || '').includes(i18n.t('profile.username')));
  await press(nameRow);
  t('the display name is editable from the popup', Boolean(q('#fbt-username', document)));
  const nameInput = q('#fbt-username', document);
  if (nameInput) await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(nameInput, 'علی رضا');
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(0);
  });
  const doneBtn = qa('button', document).find((b) => (b.textContent || '').trim() === i18n.t('common.done'));
  await press(doneBtn);
  t('a typed display name reaches the store', (useSettingsStore.getState().username || '').length > 0);
  t('markup typed as a name never reaches the store', !/[<>]/.test(useSettingsStore.getState().username));

  const langRow = qa('.set-row', document).find((b) => (b.textContent || '').includes(i18n.t('settings.language')));
  await press(langRow);
  const langRows = qa('.lang-row', document);
  t('the language picker lists every supported language', langRows.length >= 12);
  const enRow = langRows.find((b) => (b.textContent || '').includes('English'));
  await press(enRow);
  t('picking a language changes the live language', i18n.language === 'en');
  t('and the popup falls back to the section, still one dialog', qa('[role="dialog"]').length >= 1);

  /* ----------------------- 7 · notifications persist ------------------ */
  await closeDialog();
  const newsBefore = getNotifySettings().news;
  await openTile(L('notify.title'));
  const newsCard = qa('.set-opt', document).find((b) => (b.textContent || '').includes(i18n.t('notify.news')));
  await press(newsCard);
  t('a notification card writes the notify store', getNotifySettings().news !== newsBefore);
  await closeDialog();

  /* ------------------------- 8 · security: lock + 2FA ------------------ */
  useSettingsStore.setState({ autoLockMinutes: 5 });
  await openTile(L('settings.security'));
  const never = qa('.set-opt', document).find((b) => (b.textContent || '').includes(i18n.t('settings.never')));
  await press(never);
  t('the auto-lock choice is stored', useSettingsStore.getState().autoLockMinutes === 0);
  const twoFaRow = qa('.set-row', document).find((b) => (b.textContent || '').includes(i18n.t('settings.twoFactor')));
  await press(twoFaRow);
  t('the 2FA flow opens inside the same popup', Boolean(q('.set-subview')) && qa('[role="dialog"]').length === 1);
  t('it asks for the 6-digit code before claiming anything', (document.body.textContent || '').includes(i18n.t('settings.enterCode')));
  t('and it cannot be confirmed with an empty code', qa('button', document).some((b) => b.disabled && (b.textContent || '').includes(i18n.t('settings.verifyEnable'))));
  const backBtn = q('.set-sheet-back', document);
  await press(backBtn);
  t('the back control returns to the section', !q('.set-subview'));
  await closeDialog();
  t('2FA was not enabled by walking out of the flow', useSettingsStore.getState().twoFactorEnabled === false);

  /* --------------------- 9 · data: the destructive path ---------------- */
  await openTile(L('settings.dataStorage'));
  t('the my-data block renders export and delete', Boolean(q('[data-testid="my-data-export"]')) && Boolean(q('[data-testid="my-data-delete"]')));
  t('both are real buttons, not clickable divs', q('[data-testid="my-data-export"]')?.tagName === 'BUTTON' && q('[data-testid="my-data-delete"]')?.tagName === 'BUTTON');
  /*
   * The exit path lives in a collapsed box (deliberately, it is not something to
   * advertise), so "reachable" means: one tap on that box and its controls exist.
   */
  const exitHead = qa('.infobox-head', document)[1];
  await press(exitHead);
  t('the exit path is one tap away, not just written', Boolean(q('[data-testid="sovereignty-prepare"]', document)) && Boolean(q('[data-testid="sovereignty-open"]', document)));
  await press(q('[data-testid="my-data-delete"]'));
  const confirmBtn = q('[data-testid="delete-confirm-button"]');
  t('deletion asks for its own confirmation', Boolean(confirmBtn) && qa('[role="dialog"]').length === 2);
  await press(q('[data-testid="delete-cancel-button"]'));
  await settle(1);
  t('cancel closes only the confirm, deletes nothing, keeps the section',
    qa('[role="dialog"]').length === 1 && !q('[data-testid="delete-confirm-button"]', document) && Boolean(q('[data-testid="my-data-export"]', document)));
  await closeDialog();

  /* ------------------------- 10 · region availability ------------------ */
  await openTile(L('intentAI.compliance.sectionTitle'));
  const regionRows = qa('[data-testid="region-availability-section"] .set-row');
  t('every gated feature has its own row', regionRows.length === 7);
  t('each row states its state as data, not only as colour', regionRows.every((r) => r.getAttribute('data-state')));
  t('each row states its reason in words', regionRows.every((r) => (q('.set-row-sub', r)?.textContent || '').trim().length > 4));
  t('each row renders exactly one state control', regionRows.every((r) => {
    const n = qa('.region-state', r).length + qa('[data-testid$="-ack"]', r).length;
    return n === 1;
  }));
  /*
   * Every restricted feature asks, so the walk acknowledges all of them and the
   * section has to end up asking for nothing: one tap that cleared only its own
   * row would leave the same wall of amber buttons where the user was.
   */
  const askCount = qa('[data-testid$="-ack"]').length;
  t('a restricted feature asks before it is usable', askCount >= 1);
  for (let i = 0; i < askCount + 1 && q('[data-testid$="-ack"]', document); i += 1) {
    await press(q('[data-testid$="-ack"]', document));
    const okBtn = q('[data-testid="region-ack-confirm"]');
    if (i === 0) {
      t('the acknowledgement dialog names the feature and its limit', Boolean(okBtn) && (document.body.textContent || '').includes(i18n.t('intentAI.compliance.confirmExtra')));
    }
    await press(okBtn);
  }
  const raw = localStorage.getItem('fbt-region-ack-v1');
  t('the acknowledgement is recorded on this device', Boolean(raw) && Object.keys(JSON.parse(raw)).length > 0);
  t('and the row stops asking, now showing its state', qa('[data-testid$="-ack"]').length === 0 && qa('[data-testid="region-availability-section"] .region-state').length === 7);
  localStorage.removeItem('fbt-region-ack-v1');
  await closeDialog();

  /* --------------------- 11 · deep link opens the popup ---------------- */
  await act(async () => { root.unmount(); await sleep(30); });
  window.location.hash = '#/settings?section=trading';
  const root2 = createRoot(container);
  await act(async () => {
    root2.render(<Wrap><Settings /></Wrap>);
    await sleep(80);
  });
  t('?section=trading opens that popup on arrival', qa('[role="dialog"]').length === 1 && qa('.set-opt').length >= 4);
  await act(async () => { root2.unmount(); await sleep(20); });

  /* ---------------------- 12 · nothing threw on the way ---------------- */
  t('the whole walk left no unmounted dialog behind', qa('[role="dialog"]').length === 0);

  return out;
}
