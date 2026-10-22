import { createContext } from 'react';

/**
 * React overlay depth, independent of where a portal is attached in the DOM.
 *
 * A Sheet opened by content inside a FullScreenSheet still portals to
 * document.body, but React context continues to flow through that portal.
 * The Sheet uses this depth to paint above the surface that opened it instead
 * of mounting invisibly underneath it.
 */
export const OverlayDepthContext = createContext(0);
