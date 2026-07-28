/**
 * Behavioural test for the guide gate. Uses react-dom/client on jsdom so the
 * real click handlers run — a static render can't prove the button unlocks.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import Guide from '../src/pages/Guide.jsx';
import '../src/i18n/index.js';
import { useSettingsStore } from '../src/store/useSettingsStore.js';

export async function run(container) {
  const results = [];
  let doneCalled = 0;
  const root = createRoot(container);
  await act(async () => { root.render(<Guide onDone={() => { doneCalled += 1; }} />); });

  const q = (s) => container.querySelector(s);
  const qa = (s) => [...container.querySelectorAll(s)];
  const cta = () => q('.guide-cta');
  const rail = () => qa('.guide-rail-item');

  results.push(['4 rail items', rail().length === 4]);
  results.push(['starts on section 1', rail()[0].dataset.state === 'active']);
  results.push(['CTA enabled on sec1 (it is "next")', cta().disabled === false]);

  // Jump straight to the last section, skipping 2 and 3.
  await act(async () => { rail()[3].click(); });
  results.push(['jumped to section 4', rail()[3].dataset.state === 'active']);
  results.push(['finish button DISABLED after skipping', cta().disabled === true]);
  await act(async () => { cta().click(); });
  results.push(['clicking disabled finish does nothing', doneCalled === 0]);
  results.push(['hint shown when locked', Boolean(q('.guide-hint'))]);

  // Now visit the two skipped sections.
  await act(async () => { rail()[1].click(); });
  await act(async () => { rail()[2].click(); });
  await act(async () => { rail()[3].click(); });
  results.push(['finish ENABLED once all four seen', cta().disabled === false]);

  await act(async () => { cta().click(); });
  results.push(['onDone fired', doneCalled === 1]);
  results.push(['guideReadAt persisted', useSettingsStore.getState().guideReadAt > 0]);

  // replayGuide must clear it so Help can re-open the guide.
  act(() => { useSettingsStore.getState().replayGuide(); });
  results.push(['replayGuide clears the flag', useSettingsStore.getState().guideReadAt === 0]);

  return results;
}
