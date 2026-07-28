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
  // Footer buttons now share .guide-btn (equal sizing); the primary is last.
  const btns = () => qa('.guide-btn');
  const cta = () => btns()[btns().length - 1];
  const rail = () => qa('.guide-rail-item');

  results.push(['4 rail items', rail().length === 4]);
  results.push(['only the primary button on section 1', btns().length === 1]);
  results.push(['starts on section 1', rail()[0].dataset.state === 'active']);
  results.push(['CTA enabled on sec1 (it is "next")', cta().disabled === false]);

  // Jump straight to the last section, skipping 2 and 3.
  await act(async () => { rail()[3].click(); });
  results.push(['jumped to section 4', rail()[3].dataset.state === 'active']);
  results.push(['Back and Next are both present after section 1', btns().length === 2]);
  results.push(['both footer buttons share the equal-size class',
    btns().every((b) => b.classList.contains('guide-btn'))]);
  results.push(['finish button DISABLED after skipping', cta().disabled === true]);
  await act(async () => { cta().click(); });
  results.push(['clicking disabled finish does nothing', doneCalled === 0]);
  results.push(['hint shown when locked', Boolean(q('.guide-hint'))]);

  // Now visit the two skipped sections.
  await act(async () => { rail()[1].click(); });
  await act(async () => { rail()[2].click(); });
  await act(async () => { rail()[3].click(); });
  results.push(['finish ENABLED once all four seen', cta().disabled === false]);

  // Finishing now plays a 420ms fade-out before committing, so the guide
  // doesn't blink out of existence. Wait past it before asserting.
  await act(async () => { cta().click(); });
  results.push(['does not commit before the exit animation', doneCalled === 0]);
  await act(async () => { await new Promise((r) => setTimeout(r, 550)); });
  results.push(['onDone fired after the exit animation', doneCalled === 1]);
  results.push(['guideReadAt persisted', useSettingsStore.getState().guideReadAt > 0]);

  // replayGuide must clear it so Help can re-open the guide.
  act(() => { useSettingsStore.getState().replayGuide(); });
  results.push(['replayGuide clears the flag', useSettingsStore.getState().guideReadAt === 0]);

  return results;
}
