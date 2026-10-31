import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import Market from '../../src/pages/Market.jsx';
import RgbBackground from '../../src/components/RgbBackground.jsx';
import '../../src/index.css';

// The real Market and data hooks. Only the browser runner intercepts API calls;
// fixture values are never part of the production app or its data fallback.
const params = new URLSearchParams(location.search);
await setLanguage(params.get('lang') || 'fa');
document.documentElement.dir = i18n.dir();
document.documentElement.dataset.theme = params.get('theme') || 'dark';
for (const attribute of ['native', 'lite', 'reduce-motion']) {
  if (params.get(attribute)) document.documentElement.setAttribute(`data-${attribute}`, 'true');
}
function RouteProbe() {
  const route = useLocation();
  return <output hidden data-testid="route-probe">{route.pathname}{route.search}</output>;
}
createRoot(document.getElementById('root')).render(
  <MemoryRouter><RgbBackground /><div className="app-shell"><RouteProbe /><div className="app-tab-swipe-zone"><Market /></div></div></MemoryRouter>
);
