/**
 * EXTERNAL AGENT HUB — "is anything actually available?" for the chrome.
 * ---------------------------------------------------------------------------
 * The agents tab shows a switch between this account's automations and the
 * external hub. Two facts come from the server, never from the client:
 *
 *   enabled   the hub is switched on for this deployment
 *   count     how many reviewed agents are LIVE right now
 *
 * The rule this encodes: the external view becomes the DEFAULT only when there
 * is something real to show. An empty or disabled hub must not push a user's own
 * automations off the screen — that would be a nav improvement that costs them
 * the thing they opened the tab for.
 */
import { useEffect, useState } from 'react';
import { getCatalogCached } from './client.js';

/**
 * The default view for the agents tab, as a pure function so the rule is
 * testable without mounting the 8000-line page.
 *
 * External agents win ONLY when the server says the hub is on AND at least one
 * reviewed agent is live. Everything else — disabled, unknown, empty, failed —
 * keeps the user's own automations in front of them.
 */
export function defaultAgentsView(availability = {}) {
  return availability.known === true && availability.enabled === true && Number(availability.count) > 0
    ? 'external'
    : 'mine';
}

export function useAgentHubAvailability() {
  const [state, setState] = useState({ known: false, enabled: false, count: 0 });

  useEffect(() => {
    let alive = true;
    getCatalogCached()
      .then((out) => {
        if (!alive) return;
        setState({
          known: true,
          enabled: out?.ok === true && out.enabled === true,
          count: Array.isArray(out?.agents) ? out.agents.length : 0
        });
      })
      .catch(() => {
        /* Fail closed: an unreadable catalogue must not change the default view. */
        if (alive) setState({ known: false, enabled: false, count: 0 });
      });
    return () => { alive = false; };
  }, []);

  return state;
}
