/**
 * FBT INTENT OS — Media Agent
 * ---------------------------------------------------------------------------
 * «یک آهنگ آرام بذار» — the assistant starts calm audio.
 *
 * ─── WHO ACTUALLY OWNS PLAYBACK ─────────────────────────────────────────────
 * Not this file. `components/RadioDock.jsx` holds the app's ONLY <audio>
 * element and is mounted in App.jsx OUTSIDE <AnimatePresence>, precisely so
 * that navigating does not unmount it (see store/useRadioStore.js for the full
 * history of that bug). The agent's job is to RESOLVE a track and hand it to
 * that store. Creating audio here would produce a second element and two
 * things playing at once — the exact failure the dock was built to prevent.
 *
 * ─── TWO THINGS THAT WERE WRONG HERE ────────────────────────────────────────
 *  1. `openCalm()` navigated to `/calm`, which is not a route in this app
 *     (App.jsx has no such path) — it silently landed on the market fallback.
 *     Calm audio lives on `/news`; the dock collapses to a pill everywhere
 *     else, so playing does not require navigating at all.
 *  2. The `catch` fell through to a fabricated track object and reported
 *     `playing: true` over silence. A player that claims to be playing when
 *     nothing was resolved is the dishonest state this codebase keeps
 *     deleting. It now reports the failure.
 */

export const MEDIA_AGENT_SCHEMA = 'fbt.media-agent.v1';

const MOOD_MAP = Object.freeze({
  relax: ['relaxation', 'calm', 'آرامش', 'آرام'],
  focus: ['focus', 'تمرکز'],
  sleep: ['sleep', 'خواب'],
  meditation: ['meditation', 'مدیتیشن', 'مراقبه'],
  nature: ['nature', 'طبیعت'],
  lofi: ['lofi', 'لوفای']
});

function detectMood(text) {
  const lower = String(text || '').toLowerCase();
  for (const [mood, keywords] of Object.entries(MOOD_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return mood;
    }
  }
  return 'relax';
}

export function createMediaAgent({ audioService = null, navigation = null, eventBus = null, radio = null } = {}) {
  let currentTrack = null;
  let isPlaying = false;

  /**
   * The radio store, if the host surface handed one in. Optional on purpose:
   * the agent is unit-tested in Node where no store exists, and a missing
   * store must degrade to "resolved but not started", never to a fake play.
   */
  const dispatch = (method, ...args) => {
    const fn = radio?.[method];
    if (typeof fn !== 'function') return false;
    try { fn(...args); return true; } catch { return false; }
  };

  return {
    id: 'media-agent',
    schema: MEDIA_AGENT_SCHEMA,
    
    /**
     * Opening the calm surface is a NAVIGATION, and it is optional: the dock
     * plays from any screen. It is performed only when the caller explicitly
     * asked to see the page, so «یک آهنگ بذار» starts audio without yanking
     * the user off whatever they were reading.
     */
    async openCalm({ navigate = false } = {}) {
      const route = '/news';
      if (navigate && navigation?.navigate) {
        await navigation.navigate({ route });
      }
      if (eventBus?.emit) eventBus.emit('calm.opened', { route, navigated: navigate }, 'media-agent');
      return { ok: true, action: 'OPEN_CALM', route, navigated: Boolean(navigate) };
    },
    
    async play({ mood = 'relax', category = 'relaxation', trackId = null } = {}) {
      const resolvedMood = mood || detectMood(category) || 'relax';

      if (!audioService?.resolve && !audioService?.play) {
        return { ok: false, playing: false, error: 'NO_AUDIO_SERVICE', mood: resolvedMood };
      }

      try {
        // resolve() reads the real /api/calm catalogue and returns a track or
        // an explicit failure. It never starts playback itself.
        const result = audioService.resolve
          ? await audioService.resolve({ mood: resolvedMood, category, trackId })
          : await audioService.play({ mood: resolvedMood, category, trackId });

        if (!result?.ok || !result.track) {
          return {
            ok: false,
            playing: false,
            mood: resolvedMood,
            error: result?.reason || 'NO_TRACK',
            dataStatus: result?.dataStatus || 'unavailable'
          };
        }

        currentTrack = result.track;

        // Hand the track to the store that owns the surviving <audio>. If no
        // store is wired, say the track is ready rather than that it plays.
        const started = dispatch('play', currentTrack, []);
        isPlaying = started;

        if (eventBus?.emit) {
          eventBus.emit('music.played', { mood: resolvedMood, track: currentTrack, started }, 'media-agent');
        }

        return {
          ok: true,
          playing: started,
          // The browser decides whether audio actually begins (autoplay
          // policy). `pending` is the truthful word when we handed it over
          // but cannot observe the element from here.
          pending: !started,
          track: currentTrack,
          mood: resolvedMood
        };
      } catch (err) {
        return { ok: false, playing: false, error: String(err?.message || err), mood: resolvedMood };
      }
    },
    
    async pause() {
      try {
        dispatch('setPlaying', false);
        if (audioService?.pause) await audioService.pause();
        isPlaying = false;
        if (eventBus?.emit) eventBus.emit('music.paused', {}, 'media-agent');
        return { ok: true, playing: false };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async stop() {
      try {
        dispatch('stop');
        if (audioService?.stop) await audioService.stop();
        isPlaying = false;
        currentTrack = null;
        if (eventBus?.emit) eventBus.emit('music.stopped', {}, 'media-agent');
        return { ok: true, playing: false };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const text = intent?.message || intent?.content || String(intent || '');
      const mood = detectMood(text);
      
      if (intent?.type === 'OPEN_CALM' || intent?.type === 'PLAY_MUSIC') {
        // OPEN_CALM is the one that asked to SEE the page; PLAY_MUSIC just
        // wants sound and keeps the user where they are.
        const wantsPage = intent?.type === 'OPEN_CALM';
        const opened = await this.openCalm({ navigate: wantsPage });
        const playResult = await this.play({ mood, category: 'relaxation' });

        const fa = String(context.locale || '').startsWith('fa') || /[آ-ی]/.test(String(text));

        if (!playResult.ok) {
          return {
            ok: false,
            action: 'PLAY_MUSIC',
            mood,
            error: playResult.error,
            // Do not claim to have played anything. Say what happened.
            message: fa
              ? 'نتوانستم آهنگی را از سرویس آرامش بگیرم. فهرست پخش الان در دسترس نیست.'
              : 'I could not fetch a track from the calm service — the playlist is unavailable right now.'
          };
        }

        return {
          ok: true,
          action: 'PLAY_MUSIC',
          mood,
          track: playResult.track,
          playing: playResult.playing,
          route: opened.route,
          navigated: opened.navigated,
          message: fa
            ? (playResult.playing
                ? `آهنگ «${playResult.track?.title || 'آرامش'}» را پخش کردم — با رفتن به صفحات دیگر قطع نمی‌شود.`
                : `آهنگ «${playResult.track?.title || 'آرامش'}» آماده است؛ برای شروع پخش روی دکمه پخش بزنید.`)
            : (playResult.playing
                ? `Playing "${playResult.track?.title || 'calm'}" — it keeps going as you move between pages.`
                : `"${playResult.track?.title || 'Calm'}" is queued — press play to start it.`)
        };
      }
      
      return { ok: false, error: 'NO_MEDIA_INTENT' };
    },
    
    getState() {
      return { isPlaying, currentTrack };
    }
  };
}

export const mediaAgent = createMediaAgent();
