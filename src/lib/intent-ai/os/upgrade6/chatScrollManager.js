/**
 * FBT AI / Intent OS — UPGRADE 6
 * Chat Scroll — Complete Redesign + Intelligent Auto Scroll + Streaming Optimization + Mobile
 * Spec §23, §24, §25, §26
 */

function now() { return Date.now(); }

/**
 * Chat Scroll Manager — Handles:
 * - Container: display:flex; flex-direction:column; height:100%; overflow:hidden
 * - Message viewport: flex:1; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch
 * - No nested scrolls
 * - Intelligent auto scroll (only if user at bottom)
 * - Throttled scroll + requestAnimationFrame + bottom proximity detection for streaming
 * - Mobile keyboard handling
 */
export class ChatScrollManager {
  constructor({ viewportRef = null, threshold = 96 } = {}) {
    this.viewportRef = viewportRef;
    this.threshold = threshold; // px from bottom to consider "at bottom"
    this.stickToBottom = true;
    this.isUserScrolling = false;
    this.scrollTimeout = null;
    this.rafId = null;
    this.lastScrollTop = 0;
    this.newMessageIndicator = false;
    this.listeners = new Set();
    this.throttleMs = 100;
    this.lastThrottledAt = 0;
    this.keyboardHeight = 0;
    this.isMobile = this.detectMobile();
  }

  detectMobile() {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    } catch {
      return false;
    }
  }

  setViewportRef(ref) {
    this.viewportRef = ref;
    if (ref?.current) {
      this.attachListeners(ref.current);
    }
  }

  getViewport() {
    if (!this.viewportRef) return null;
    if (this.viewportRef.current) return this.viewportRef.current;
    if (this.viewportRef instanceof HTMLElement) return this.viewportRef;
    return null;
  }

  attachListeners(el) {
    if (!el) return;
    // Scroll listener to track if user is at bottom
    const onScroll = () => {
      this.handleScroll();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // Touch start/end to detect user intent
    const onTouchStart = () => {
      this.isUserScrolling = true;
    };
    const onTouchEnd = () => {
      setTimeout(() => { this.isUserScrolling = false; }, 300);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    // Keyboard handling for mobile
    if (this.isMobile) {
      this.setupKeyboardHandling(el);
    }

    // Store cleanup
    this.cleanup = () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      if (this.keyboardCleanup) this.keyboardCleanup();
    };
  }

  setupKeyboardHandling(viewportEl) {
    try {
      // Visual Viewport API for keyboard-aware viewport
      if (window.visualViewport) {
        const onResize = () => {
          const vv = window.visualViewport;
          const keyboardHeight = window.innerHeight - vv.height;
          this.keyboardHeight = Math.max(0, keyboardHeight);
          // Adjust viewport if needed, keep scroll position
          if (this.keyboardHeight > 100) {
            // Keyboard open — ensure input visible, but don't force scroll if user was reading history
            if (this.stickToBottom) {
              this.scrollToBottom({ behavior: 'auto' });
            }
          }
          this.emit('keyboard', { height: this.keyboardHeight, open: this.keyboardHeight > 100 });
        };
        window.visualViewport.addEventListener('resize', onResize);
        window.visualViewport.addEventListener('scroll', onResize);
        this.keyboardCleanup = () => {
          window.visualViewport.removeEventListener('resize', onResize);
          window.visualViewport.removeEventListener('scroll', onResize);
        };
      } else {
        // Fallback: window resize
        let initialHeight = window.innerHeight;
        const onResize = () => {
          const diff = initialHeight - window.innerHeight;
          this.keyboardHeight = Math.max(0, diff);
          this.emit('keyboard', { height: this.keyboardHeight, open: this.keyboardHeight > 100 });
        };
        window.addEventListener('resize', onResize);
        this.keyboardCleanup = () => window.removeEventListener('resize', onResize);
      }
    } catch {}
  }

  handleScroll() {
    const el = this.getViewport();
    if (!el) return;

    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasSticking = this.stickToBottom;
    this.stickToBottom = distance < this.threshold;
    this.lastScrollTop = el.scrollTop;

    // If user scrolled up and new message indicator was showing, keep it
    if (!this.stickToBottom && wasSticking) {
      // User intentionally scrolled up
      this.emit('user_scrolled_up', { distance });
    }

    if (this.stickToBottom && !wasSticking) {
      // User scrolled back to bottom
      this.newMessageIndicator = false;
      this.emit('user_scrolled_to_bottom', {});
    }

    this.emit('scroll', { stickToBottom: this.stickToBottom, distance, scrollTop: el.scrollTop });
  }

  /**
   * Intelligent Auto Scroll — Spec §24
   * If user at bottom: new message → auto scroll
   * If user reading old messages: new message → DO NOT force scroll, show indicator
   */
  onNewMessage({ force = false } = {}) {
    if (force || this.stickToBottom) {
      this.scrollToBottom({ behavior: 'auto' });
      this.newMessageIndicator = false;
      return { scrolled: true, reason: force ? 'forced' : 'at_bottom' };
    } else {
      // User reading history — don't force scroll, show indicator
      this.newMessageIndicator = true;
      this.emit('new_message_while_reading', {});
      return { scrolled: false, reason: 'user_reading_history', showIndicator: true };
    }
  }

  /**
   * Streaming without breaking scroll — Spec §25
   * Don't scrollToBottom() on every token — causes jump and lag
   * Use throttled scroll + requestAnimationFrame + bottom proximity detection
   */
  onStreamingToken({ immediate = false } = {}) {
    if (!this.stickToBottom) return { scrolled: false, reason: 'not_at_bottom' };

    const nowMs = now();
    if (immediate) {
      this.scrollToBottomThrottled();
      return { scrolled: true, reason: 'streaming_immediate' };
    }

    // Throttled scroll
    if (nowMs - this.lastThrottledAt < this.throttleMs) {
      // Schedule RAF
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          if (this.stickToBottom) {
            this.scrollToBottom({ behavior: 'auto' });
            this.lastThrottledAt = now();
          }
        });
      }
      return { scrolled: false, reason: 'throttled', scheduled: true };
    }

    this.scrollToBottom({ behavior: 'auto' });
    this.lastThrottledAt = nowMs;
    return { scrolled: true, reason: 'streaming_throttled' };
  }

  scrollToBottom({ behavior = 'auto' } = {}) {
    const el = this.getViewport();
    if (!el) return;

    try {
      // Use instant jump for new message, avoid laggy tween
      el.scrollTo({ top: el.scrollHeight, behavior });
    } catch {
      el.scrollTop = el.scrollHeight;
    }
    this.stickToBottom = true;
    this.newMessageIndicator = false;
  }

  scrollToBottomThrottled() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.scrollToBottom({ behavior: 'auto' });
    });
  }

  shouldShowNewMessageIndicator() {
    return this.newMessageIndicator && !this.stickToBottom;
  }

  clearNewMessageIndicator() {
    this.newMessageIndicator = false;
    this.scrollToBottom({ behavior: 'smooth' });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, payload) {
    for (const fn of this.listeners) {
      try { fn({ type, payload, at: now() }); } catch {}
    }
  }

  destroy() {
    if (this.cleanup) this.cleanup();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.listeners.clear();
  }

  // Mobile helpers per §26
  getMobileStyles() {
    return {
      container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        // Safe-area support
        paddingBottom: 'env(safe-area-inset-bottom)',
        // Keyboard-aware
        ...(this.keyboardHeight > 0 ? { paddingBottom: `${this.keyboardHeight}px` } : {})
      },
      viewport: {
        flex: 1,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        // Prevent layout jump
        contain: 'layout paint',
        // Preserve scroll position
        scrollBehavior: 'auto'
      },
      input: {
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        background: 'inherit',
        // Safe-area
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))'
      }
    };
  }
}

// Singleton
let instance = null;
export function getChatScrollManager(opts = {}) {
  if (!instance) instance = new ChatScrollManager(opts);
  return instance;
}

export function resetChatScrollManager() {
  if (instance) instance.destroy();
  instance = null;
}
