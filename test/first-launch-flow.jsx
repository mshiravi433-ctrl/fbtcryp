/** Proves the first-launch order: onboarding → guide → app shell. */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import App from '../src/App.jsx';
import '../src/i18n/index.js';
import { useSettingsStore } from '../src/store/useSettingsStore.js';

export async function run(container) {
  const out = [];
  const root = createRoot(container);
  const has = (s) => Boolean(container.querySelector(s));

  // fresh install
  act(() => { useSettingsStore.setState({ onboarded: false, guideReadAt: 0 }); });
  await act(async () => { root.render(<App />); });
  out.push(['fresh install shows onboarding', has('.onb-stage')]);
  out.push(['guide not shown yet', !has('.guide-stage')]);
  out.push(['app shell not shown yet', !has('.app-shell')]);

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
