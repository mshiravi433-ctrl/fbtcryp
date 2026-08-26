/**
 * FBT INTENT AI — STICKERS (UI reactions ONLY)
 * ---------------------------------------------------------------------------
 * Stickers are visual reactions in the chat / timeline. They are NOT commands
 * and MUST NEVER:
 *   - execute a transaction
 *   - change permissions
 *   - bypass guardian
 *   - activate a signer
 *   - carry a hidden command
 *
 * A sticker is validated at the display boundary: any sticker not on the
 * ALLOWLIST is rendered as a plain emoji-free placeholder so a malicious or
 * hallucinated agent cannot display a counterfeit "approved ✅" for a trade
 * that Guardian actually rejected.
 */

export const STICKERS = Object.freeze([
  'hello',
  'thinking',
  'research',
  'analysis',
  'verification',
  'warning',
  'recalculating',
  'new-idea',
  'agreement',
  'rejected',
  'approved',
  'executing',
  'target-reached',
  'completed',
  'goodbye'
]);

const EMOJI = {
  'hello': '👋',
  'thinking': '🤔',
  'research': '🔍',
  'analysis': '📊',
  'verification': '🛡️',
  'warning': '⚠️',
  'recalculating': '🔄',
  'new-idea': '💡',
  'agreement': '🤝',
  'rejected': '🚫',
  'approved': '✅',
  'executing': '⚙️',
  'target-reached': '🎯',
  'completed': '🏁',
  'goodbye': '👋'
};

export function isSafeSticker(name) {
  return typeof name === 'string' && STICKERS.includes(name);
}

export function stickerEmoji(name) {
  return isSafeSticker(name) ? EMOJI[name] : '•';
}

/**
 * Build a sticker message. This is a pure UI event; it never sets
 * `isCommand`, `executes`, or holds a payload beyond a label.
 */
export function stickerMessage(from, sticker, label = '') {
  if (!isSafeSticker(sticker)) {
    throw new Error(`UNSAFE_STICKER:${sticker}`);
  }
  return Object.freeze({
    kind: 'sticker',
    from: String(from || 'system').slice(0, 48),
    sticker,
    emoji: stickerEmoji(sticker),
    label: String(label || '').slice(0, 120),
    ts: Date.now(),
    isCommand: false,
    isExecutable: false,
    canBypassGuardian: false,
    canChangePermissions: false,
    canActivateSigner: false
  });
}

/**
 * Validate an incoming sticker event from any source (internal agent,
 * external agent, LLM). If invalid, returns a safe 'warning' sticker with
 * the reason instead of throwing — UI must degrade gracefully, never crash.
 */
export function safeSticker(from, sticker, label = '') {
  if (isSafeSticker(sticker)) return stickerMessage(from, sticker, label);
  return stickerMessage(from, 'warning', `unsafe-sticker-rejected:${String(sticker).slice(0, 40)}`);
}
