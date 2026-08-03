import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../src/i18n/index.js';
import QrScanner from '../src/components/QrScanner.jsx';

/**
 * DOES THE CAMERA SURVIVE A PARENT RE-RENDER?
 * ---------------------------------------------------------------------------
 * Reported: «مطمئن شو کیو‌آر کدخوان برای ارسال رمزارز خوب کار می‌ده چون گاهی
 * تصویر طوسی نشون می‌ده».
 *
 * The cause was not the camera code but the EFFECT DEPENDENCIES. The effect
 * listed `onClose` and `onResult`; both call sites pass inline arrow
 * functions, so every parent re-render produced new identities, re-ran the
 * effect, and its cleanup stopped the video track. A <video> with no source
 * paints its own background — grey.
 *
 * Intermittent because the trigger is WalletContext's 30-second balance poll,
 * which re-renders every consumer including SendSheet. Scan fast and you never
 * saw it; hesitate and the camera died under you.
 *
 * ─── WHY A STATIC CHECK IS NOT ENOUGH ───────────────────────────────────────
 * Wiring check #32 greps for the dependency array, which proves the array was
 * WRITTEN correctly. It cannot prove the camera stays alive — that depends on
 * how React compares those dependencies at runtime, and on nothing else in the
 * component calling stop(). So this drives the real component with a fake
 * getUserMedia and COUNTS how many times the hardware is opened and released.
 *
 * Scanning is the safety feature that stops people hand-typing a 42-character
 * address they cannot verify by eye, so a scanner people stop trusting costs
 * real money.
 */
export async function run(container) {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const w = window;

  let opened = 0;
  let stopped = 0;
  Object.defineProperty(w.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        opened += 1;
        const track = { stop: () => { stopped += 1; } };
        return { getTracks: () => [track] };
      }
    }
  });

  // jsdom's HTMLMediaElement has no play(); without this the component throws
  // before reaching the part under test.
  w.HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };

  const root = createRoot(container);

  /*
   * The parent mirrors the REAL call sites: fresh arrow functions on every
   * render, exactly as SendSheet and Explore write them. Passing stable
   * callbacks here would test a component nobody actually renders — and would
   * have passed while the bug was live.
   */
  let bump = () => {};
  function Parent() {
    const [, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return <QrScanner open onClose={() => {}} onResult={() => {}} />;
  }

  await act(async () => { root.render(<Parent />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });

  t(`the camera opens once on mount (opened=${opened})`, opened === 1);

  const openedAtMount = opened;
  const stoppedAtMount = stopped;

  // Five re-renders ≈ two and a half minutes of the wallet's balance poll.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { bump(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }

  /*
   * THE ASSERTIONS THAT MATTER. Before the fix these were 6 opens and 5 stops
   * — a torn-down camera, and a grey frame, on every single re-render.
   */
  t(`re-rendering the parent does not reopen the camera (opened=${opened})`, opened === openedAtMount);
  t(
    `re-rendering the parent does not stop the track (extra stops=${stopped - stoppedAtMount})`,
    stopped === stoppedAtMount
  );

  /*
   * And closing must genuinely release it. A camera light left on after the
   * sheet closes reads as spyware, and on Android it blocks every other app
   * from opening the camera at all.
   */
  await act(async () => root.unmount());
  t(`unmounting releases the camera (stopped=${stopped})`, stopped >= 1);

  return rows;
}
