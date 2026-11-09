/**
 * FUTURES TERMINAL — `/perp/terminal`.
 * ---------------------------------------------------------------------------
 * A thin shell around `components/perp-terminal/PerpTerminalPane` — the SAME
 * desk the «ترمینال» sub-tab of «پرپچوال» (`/perp`) mounts with
 * `embedded`. Two entries, one implementation: the route exists for deep links
 * (and for sharing `…/perp/terminal?market=SOL`), the sub-tab exists because
 * the terminal is a room of the perpetual screen, not a place one navigates
 * away to.
 *
 * ─── WHAT IS REAL HERE ──────────────────────────────────────────────────────
 *   markets      the three in-app venues (dYdX, Ostium, Velocity), from the
 *                same reads `/perp` uses, refreshed only while visible
 *   chart        components/FuturesMarketChart — the venue's own candles, with
 *                the on-device AI projection (Kronos) behind its own button
 *   book + tape  dYdX's public indexer via our BFF (cached server-side)
 *   risk         the position list and the engines in futures-engine/risk.js,
 *                fed per venue (dYdX subaccount / Ostium BFF / Velocity SDK)
 *   ticket       the SAME prepare → sign paths `/perp` uses (see Ticket.jsx),
 *                plus the one-signature dYdX session activation when the wallet
 *                is connected but the session is not
 *
 * ─── WHAT IT SAYS WHEN IT CANNOT BE REAL ────────────────────────────────────
 * Every panel has an explicit empty/unknown state, and an unknown number is
 * «—», never 0. A venue that cannot be read keeps its last known list and is
 * labelled stale; when EVERY read fails the header says so with a retry.
 * Nothing on this screen is simulated, and nothing is labelled "live" unless
 * a read succeeded.
 */
import { useMemo } from 'react';

import PageTransition from '../components/PageTransition';
import PerpTerminalPane from '../components/perp-terminal/PerpTerminalPane';
import { useMarkets } from '../hooks/useMarket';
import '../styles/perp-terminal.css';

export default function PerpTerminal() {
  /* CoinGecko logos for the pair dropdown — the same table `/perp` uses. */
  const { data: coins } = useMarkets(250);
  const images = useMemo(() => {
    const m = {};
    for (const c of coins ?? []) {
      const sym = String(c?.symbol || '').trim().toUpperCase();
      if (sym && !m[sym]) m[sym] = { image: c.image || null, name: c.name || '', id: c.id || null };
    }
    return m;
  }, [coins]);

  return (
    <PageTransition>
      <PerpTerminalPane embedded={false} images={images} testId="perp-terminal" />
    </PageTransition>
  );
}
