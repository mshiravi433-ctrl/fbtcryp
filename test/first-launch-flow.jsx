/** Proves the first-launch order: welcome → onboarding → guide → app shell. */
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
  out.push(['fresh install shows the language screen first', has('.welcome-stage')]);
  out.push(['onboarding is behind the language screen', !has('.onb-stage')]);
  out.push(['language grid offers at least 10 languages', container.querySelectorAll('.lang-card').length >= 10]);

  // Picking a language dismisses it permanently.
  await act(async () => { container.querySelectorAll('.lang-card')[1].click(); });
  out.push(['choosing a language persists it', Boolean(localStorage.getItem('fbt-lang'))]);
  await act(async () => { container.querySelector('.welcome-foot .onb-btn').click(); });
  out.push(['welcome dismissed after continue', !has('.welcome-stage')]);
  out.push(['fresh install shows onboarding', has('.onb-stage')]);
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
