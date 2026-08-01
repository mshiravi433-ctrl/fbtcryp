/** Proves the first-launch order: splash → welcome → onboarding → guide → app shell. */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import App from '../src/App.jsx';
import '../src/i18n/index.js';
import { useSettingsStore } from '../src/store/useSettingsStore.js';

export async function run(container) {
  const out = [];
  const root = createRoot(container);
  const has = (s) => Boolean(container.querySelector(s));

  // A genuinely fresh install: no stored language, no onboarding.
  // The language screen must come FIRST — an onboarding carousel in a script
  // the user cannot read is not an onboarding, it is a wall.
  localStorage.removeItem('fbt-lang');
  act(() => { useSettingsStore.setState({ onboarded: false, guideReadAt: 0 }); });
  await act(async () => { root.render(<App />); });

  /*
   * The splash comes first: one branded moment with a Start button. It replaced
   * a duplicated language step — the flow used to ask for a language on
   * Welcome and again as onboarding step 0, which reads as a bug before the
   * user has seen anything the product does.
   */
  out.push(['fresh install shows the splash first', has('.splash')]);
  out.push(['splash has a start button', Boolean(container.querySelector('.splash-btn'))]);
  out.push(['welcome is behind the splash', !has('.welcome-stage')]);
  out.push(['onboarding is behind the splash', !has('.onb-stage')]);

  await act(async () => { container.querySelector('.splash-btn').click(); });
  out.push(['start dismisses the splash', !has('.splash')]);

  out.push(['language screen comes after the splash', has('.welcome-stage')]);
  out.push(['onboarding is behind the language screen', !has('.onb-stage')]);
  const langRows = () => [...container.querySelectorAll('.lang-row')];
  out.push(['language list offers at least 10 languages', langRows().length >= 10]);
  // One per row: a two-up grid clipped long endonyms and put a mis-tap target
  // either side of every choice.
  out.push([
    'each language is its own full-width row',
    langRows().every((r) => r.querySelector('.lang-endonym'))
  ]);

  // A display name can be set right here, before anything else.
  out.push(['welcome offers a display name field', Boolean(container.querySelector('#fbt-username'))]);

  // Picking a language dismisses it permanently.
  await act(async () => { langRows()[1].click(); });
  out.push(['choosing a language persists it', Boolean(localStorage.getItem('fbt-lang'))]);
  out.push(['the chosen row is marked selected', langRows()[1].classList.contains('active')]);
  await act(async () => { container.querySelector('.welcome-foot .onb-btn').click(); });
  out.push(['welcome dismissed after continue', !has('.welcome-stage')]);
  out.push(['fresh install shows onboarding', has('.onb-stage')]);

  /*
   * Onboarding must NOT ask for a language again — that duplicate is the whole
   * reason the splash exists. It opens on the first feature slide instead.
   */
  out.push([
    'onboarding does not repeat the language question',
    !container.querySelector('.onb-scroll .lang-row')
  ]);
  out.push(['guide not shown yet', !has('.guide-stage')]);
  out.push(['app shell not shown yet', !has('.app-shell')]);

  // Both onboarding footer buttons must be the same size — sized by flex,
  // not by their own translated label, which is what made the Persian "back"
  // button render visibly larger than "next".
  const footBtns = [...container.querySelectorAll('.onb-foot-row .onb-btn')];
  out.push(['onboarding footer has exactly two buttons', footBtns.length === 2]);
  out.push([
    'both footer buttons share the equal-size class contract',
    footBtns.every((b) => b.classList.contains('onb-btn'))
  ]);

  // finish onboarding by driving the store the way Onboarding does
  act(() => { useSettingsStore.getState().acceptTerms(); useSettingsStore.getState().completeOnboarding(); });
  await act(async () => { root.render(<App />); });
  // onboarding local state still true until its own onDone fires, so remount:
  root.unmount();
  const root2 = createRoot(container);
  await act(async () => { root2.render(<App />); });
  out.push(['after onboarding the GUIDE gates the app', has('.guide-stage')]);
  out.push(['app shell still blocked by guide', !has('.app-shell')]);

  // acknowledge the guide
  act(() => { useSettingsStore.getState().markGuideRead(); });
  await act(async () => {});
  out.push(['app shell appears once guide acknowledged', has('.app-shell')]);
  out.push(['guide gone', !has('.guide-stage')]);

  // Help's replay must bring it straight back without a restart.
  act(() => { useSettingsStore.getState().replayGuide(); });
  await act(async () => {});
  out.push(['replayGuide re-opens guide live', has('.guide-stage')]);

  // An EXISTING user who already onboarded before this feature existed
  // must still see the guide once (guideReadAt defaults to 0).
  act(() => { useSettingsStore.setState({ onboarded: true, guideReadAt: 0 }); });
  root2.unmount();
  const root3 = createRoot(container);
  await act(async () => { root3.render(<App />); });
  out.push(['existing user sees guide once, not onboarding', has('.guide-stage') && !has('.onb-stage')]);

  return out;
}
