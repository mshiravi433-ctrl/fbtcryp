/**
 * FBT INTENT OS — Media Agent
 * ---------------------------------------------------------------------------
 * Spec §9 Media Control
 * Handles calm, relaxation, music playback
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

export function createMediaAgent({ audioService = null, navigation = null, eventBus = null } = {}) {
  let currentTrack = null;
  let isPlaying = false;

  return {
    id: 'media-agent',
    schema: MEDIA_AGENT_SCHEMA,
    
    async openCalm() {
      // Spec §9: navigate("/calm"); playMusic({ category: "relaxation" })
      if (navigation?.navigate) {
        await navigation.navigate({ route: '/explore' });
      }
      
      if (eventBus?.emit) {
        eventBus.emit('calm.opened', {}, 'media-agent');
      }
      
      return { ok: true, action: 'OPEN_CALM', route: '/explore' };
    },
    
    async play({ mood = 'relax', category = 'relaxation', trackId = null } = {}) {
      const resolvedMood = mood || detectMood(category) || 'relax';
      
      try {
        if (audioService?.play) {
          const result = await audioService.play({ mood: resolvedMood, category, trackId });
          currentTrack = result?.track || { mood: resolvedMood, category };
          isPlaying = true;
          
          if (eventBus?.emit) {
            eventBus.emit('music.played', { mood: resolvedMood, track: currentTrack }, 'media-agent');
          }
          
          return { ok: true, playing: true, track: currentTrack, mood: resolvedMood };
        }
        
        // Fallback: simulate
        currentTrack = { mood: resolvedMood, category: category || 'relaxation', id: trackId || `track_${Date.now()}` };
        isPlaying = true;
        
        if (eventBus?.emit) {
          eventBus.emit('music.played', { mood: resolvedMood, track: currentTrack }, 'media-agent');
        }
        
        return { ok: true, playing: true, track: currentTrack, mood: resolvedMood };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async pause() {
      try {
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
      
      // Spec §9: OPEN_CALM → GET_RECOMMENDED_TRACK → PLAY
      if (intent?.type === 'OPEN_CALM' || intent?.type === 'PLAY_MUSIC') {
        await this.openCalm();
        const playResult = await this.play({ mood, category: 'relaxation' });
        return {
          ok: true,
          action: 'PLAY_MUSIC',
          mood,
          track: playResult.track,
          message: context.locale?.startsWith('fa') || String(text).match(/[آ-ی]/)
            ? 'حتماً، یک موسیقی آرامش‌بخش برایت پخش کردم.'
            : 'Sure, I started a relaxing track for you.'
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
