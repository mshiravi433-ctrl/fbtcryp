/**
 * Lock body scroll WITHOUT shifting the layout.
 *
 * `overflow: hidden` alone removes the scrollbar, and on desktop/Android
 * WebViews with a classic (non-overlay) scrollbar that reclaims ~15px of
 * width. Everything reflows sideways for the duration of the modal, which
 * reads as the whole UI twitching when you open the menu.
 *
 * Compensating with padding-right of exactly the scrollbar width keeps the
 * content box identical. Overlay scrollbars report 0 here, so this is a no-op
 * on iOS and most phones — it only pays for itself where the bug exists.
 */
export function lockBodyScroll() {
  const { body, documentElement: html } = document;
  const prevOverflow = body.style.overflow;
  const prevPadding = body.style.paddingRight;

  const scrollbar = window.innerWidth - html.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

  return () => {
    body.style.overflow = prevOverflow;
    body.style.paddingRight = prevPadding;
  };
}
