import { useEffect, useState, useRef } from 'react';
import { feePercentString } from '../lib/feeBps';

/*
 * RwaHorizonFlipBanner — مدرن فلیپ بنر برای تب سهام توکنیزه
 *
 * Requested: «بنر در صفحه سهام تب توکنینزه بنر را مدرن و فلیپ وار کن برای هر دو
 * افق جهانی و rwa باشد با ایکون svg و مدرن و زیبا باشد»
 *
 * Two faces:
 *  - Front: RWA (طلا، خزانه، رابین‌هود)
 *  - Back: افق جهانی (فارکس، طلا، سهام، شاخص)
 *
 * Flip: hover on desktop, tap on mobile, auto every 5s. 3D preserve, 0.8s spring.
 * SVG: hand-drawn modern line+fill, not emoji, with gradient.
 */

function IconRwaModern({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rwa-g1" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00E5FF" />
          <stop offset="1" stopColor="#7C4DFF" />
        </linearGradient>
        <linearGradient id="rwa-g2" x1="12" y1="28" x2="36" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD54F" />
          <stop offset="1" stopColor="#FF8F00" />
        </linearGradient>
        <radialGradient id="rwa-glow" cx="0.5" cy="0.5" r="0.7">
          <stop stopColor="#00E5FF" stopOpacity="0.22" />
          <stop offset="1" stopColor="#00E5FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* glow */}
      <circle cx="24" cy="24" r="20" fill="url(#rwa-glow)" />
      {/* vault base */}
      <rect x="10" y="14" width="28" height="20" rx="6" fill="url(#rwa-g1)" opacity="0.16" />
      <rect x="10" y="14" width="28" height="20" rx="6" stroke="url(#rwa-g1)" strokeWidth="1.6" />
      {/* door line */}
      <path d="M24 14V34" stroke="url(#rwa-g1)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.6" />
      {/* lock */}
      <circle cx="24" cy="24" r="4.5" fill="url(#rwa-g2)" stroke="#1A1200" strokeWidth="0.8" />
      <circle cx="24" cy="24" r="1.6" fill="#1A1200" />
      {/* gold bars top */}
      <g transform="translate(0 -1)">
        <rect x="14" y="10" width="8" height="5" rx="1.5" fill="url(#rwa-g2)" />
        <rect x="26" y="10" width="8" height="5" rx="1.5" fill="url(#rwa-g2)" opacity="0.85" />
        <rect x="19" y="7" width="10" height="5" rx="1.5" fill="#FFE082" stroke="#FF8F00" strokeWidth="0.6" />
      </g>
      {/* tiny sparkle */}
      <path d="M38 10l1 2.2L41.2 13l-2.2.8L38 16l-1-2.2L34.8 13l2.2-.8L38 10Z" fill="#00E5FF" opacity="0.9" />
    </svg>
  );
}

function IconHorizonModern({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hz-g1" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22D3EE" />
          <stop offset="1" stopColor="#A78BFA" />
        </linearGradient>
        <linearGradient id="hz-g2" x1="10" y1="34" x2="38" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FF9D" />
          <stop offset="1" stopColor="#00E5FF" />
        </linearGradient>
        <radialGradient id="hz-glow" cx="0.5" cy="0.5" r="0.7">
          <stop stopColor="#7C4DFF" stopOpacity="0.24" />
          <stop offset="1" stopColor="#7C4DFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="20" fill="url(#hz-glow)" />
      {/* globe */}
      <circle cx="24" cy="24" r="11" stroke="url(#hz-g1)" strokeWidth="1.6" fill="rgba(124,77,255,0.08)" />
      <ellipse cx="24" cy="24" rx="5.5" ry="11" stroke="url(#hz-g1)" strokeWidth="1.2" strokeDasharray="2.5 2.5" opacity="0.7" />
      <path d="M13 24H35" stroke="url(#hz-g1)" strokeWidth="1.2" opacity="0.7" />
      <path d="M15 17C18 18.5 30 18.5 33 17M15 31C18 29.5 30 29.5 33 31" stroke="url(#hz-g1)" strokeWidth="1" opacity="0.5" />
      {/* orbit */}
      <ellipse cx="24" cy="24" rx="16" ry="7" stroke="url(#hz-g2)" strokeWidth="1.2" strokeDasharray="5 3" opacity="0.55" />
      <circle cx="38.5" cy="20.5" r="2.3" fill="url(#hz-g2)" />
      {/* chart up */}
      <path d="M10 36L18 28L23 31L34 20" stroke="url(#hz-g2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34" cy="20" r="2" fill="#00FF9D" stroke="#041018" strokeWidth="0.8" />
    </svg>
  );
}

function FlipIndicator({ flipped }) {
  return (
    <span className="flip-ind">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    </span>
  );
}

export default function RwaHorizonFlipBanner({ onGoRwa, onGoHorizon, t, haptic, isRTL }) {
  const fee = feePercentString();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', margin: '2px 0 14px' }}>
      
      {/* RWA CARD */}
      <div className="flip-face flip-face-rwa" onClick={onGoRwa} style={{ flex: 1, minHeight: 'auto', padding: '16px', flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer' }}>
        <div className="flip-face-aurora" />
        <div className="flip-face-sheen" />
        
        <div style={{ display: 'flex', width: '100%', gap: '14px', alignItems: 'flex-start' }}>
          <div className="flip-icon-tile rwa">
            <IconRwaModern size={46} />
          </div>
          <div className="flip-content" style={{ flex: 1 }}>
            <div className="flip-eyebrow">
              <span className="flip-dot rwa" />
              {isRTL ? 'دارایی واقعی • RWA' : 'Real World Assets • RWA'}
            </div>
            <div className="flip-title" style={{ whiteSpace: 'normal', display: 'block', overflow: 'visible' }}>
              {t?.('stocks.goToRwaBanner') || 'مشاهده و خرید RWA · طلا، خزانه، رابین‌هود'}
            </div>
            <div className="flip-sub">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              {t?.('stocks.rwaFeeNotice', { fee }) || `تسویه مستقیم با کیف پول شخصی · کارمزد ${fee}٪`}
            </div>
            <div className="flip-chips">
              <span className="flip-chip"><i className="fc-dot" style={{ background: '#FFD54F' }} /> {isRTL ? 'طلا' : 'Gold'}</span>
              <span className="flip-chip"><i className="fc-dot" style={{ background: '#00E5FF' }} /> {isRTL ? 'خزانه' : 'Treasury'}</span>
              <span className="flip-chip"><i className="fc-dot" style={{ background: '#7C4DFF' }} /> {isRTL ? 'رابین‌هود' : 'Robinhood'}</span>
            </div>
          </div>
        </div>
        
        <div className="flip-cta-col" style={{ width: '100%', marginTop: '12px', alignItems: 'center' }}>
          <span className="flip-cta rwa-cta" style={{ width: '100%', justifyContent: 'center' }}>
            {t?.('stocks.goToRwaCta') || 'ورود به RWA'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isRTL ? 'scaleX(-1)' : 'none' }}>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </div>
      </div>

      {/* HORIZON CARD */}
      <div className="flip-face flip-face-hz" onClick={onGoHorizon} style={{ flex: 1, minHeight: 'auto', padding: '16px', flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer', transform: 'none' }}>
        <div className="flip-face-aurora hz" />
        <div className="flip-face-sheen" />
        
        <div style={{ display: 'flex', width: '100%', gap: '14px', alignItems: 'flex-start' }}>
          <div className="flip-icon-tile hz">
            <IconHorizonModern size={46} />
          </div>
          <div className="flip-content" style={{ flex: 1 }}>
            <div className="flip-eyebrow">
              <span className="flip-dot hz" />
              {isRTL ? 'افق جهانی • بازارهای واقعی' : 'Global Horizon • Real Markets'}
            </div>
            <div className="flip-title" style={{ whiteSpace: 'normal', display: 'block', overflow: 'visible' }}>
              {isRTL ? 'افق جهانی · فارکس، طلا، سهام، شاخص‌ها' : 'Global Horizon · Forex, Gold, Stocks, Indices'}
            </div>
            <div className="flip-sub">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
              {isRTL ? 'معامله اهرمی با USDC · تسویه آنچین آربیتروم' : 'Leveraged with USDC · On-chain Arbitrum settlement'}
            </div>
            <div className="flip-chips">
              <span className="flip-chip"><i className="fc-dot" style={{ background: '#22D3EE' }} /> {isRTL ? 'فارکس' : 'Forex'}</span>
              <span className="flip-chip"><i className="fc-dot" style={{ background: '#00FF9D' }} /> {isRTL ? 'طلا' : 'Gold'}</span>
              <span className="flip-chip"><i className="fc-dot" style={{ background: '#A78BFA' }} /> {isRTL ? 'سهام' : 'Stocks'}</span>
            </div>
          </div>
        </div>
        
        <div className="flip-cta-col" style={{ width: '100%', marginTop: '12px', alignItems: 'center' }}>
          <span className="flip-cta hz-cta" style={{ width: '100%', justifyContent: 'center' }}>
            {isRTL ? 'ورود به افق جهانی' : 'Open Horizon'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isRTL ? 'scaleX(-1)' : 'none' }}>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </div>
      </div>

    </div>
  );
}
