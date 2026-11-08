// Direct chat entry: deliberately NEVER import AiAnalysis or its styles here.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatMarketRoom } from '../../src/components/ai/analysis/ChatIntelRooms.jsx';
import { overviewCompactCoins, overviewCompactGlobal } from './market-overview-compact-data.mjs';
import '../../src/index.css';
const params = new URLSearchParams(location.search);
const lang = params.get('lang') || 'fa';
document.documentElement.dataset.theme = params.get('theme') || 'dark';
document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
window.fetch = async (url) => new Response(JSON.stringify(
  String(url).includes('/markets') ? overviewCompactCoins :
    String(url).includes('/global') ? overviewCompactGlobal : {}
), { status: 200, headers: { 'Content-Type': 'application/json' } });
document.body.style.margin = '0';
createRoot(document.getElementById('root')).render(
  <main style={{ width: '100%', maxWidth: 720, padding: 8, margin: 'auto', boxSizing: 'border-box' }}>
    <ChatMarketRoom locale={lang} defaultOpen />
  </main>
);
