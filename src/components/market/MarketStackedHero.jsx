import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const STACK_CARDS = [
  {
    id: 'loan',
    to: '/loan',
    image: '/images/market-stack/loan.jpg',
    accent: '#f59e0b',
    edge: '#d97706',
    copy: {
      fa: { tag: 'اعتبار آنی', title: 'وام کریپتویی', sub: 'وثیقه‌گذاری هوشمند با نرخ شفاف', cta: 'ورود' },
      ar: { tag: 'ائتمان فوري', title: 'قروض الكريبتو', sub: 'ضمان ذكي بشروط شفافة', cta: 'دخول' },
      en: { tag: 'Instant Credit', title: 'Crypto Loans', sub: 'Smart collateral, transparent rates', cta: 'Open' }
    }
  },
  {
    id: 'farm',
    to: '/farm',
    image: '/images/market-stack/farm.jpg',
    accent: '#10b981',
    edge: '#059669',
    copy: {
      fa: { tag: 'سود پایدار', title: 'فارم و استخرها', sub: 'بازدهی آن‌چین با مدیریت ریسک', cta: 'ورود' },
      ar: { tag: 'عائد مستقر', title: 'الفارم والمجمعات', sub: 'عوائد على السلسلة بإدارة ذكية', cta: 'دخول' },
      en: { tag: 'Live Yield', title: 'Yield Farming', sub: 'On-chain returns with curated risk', cta: 'Open' }
    }
  },
  {
    id: 'whales',
    to: '/smart-money',
    image: '/images/market-stack/whales.jpg',
    accent: '#38bdf8',
    edge: '#0284c7',
    copy: {
      fa: { tag: 'پول هوشمند', title: 'ردیابی نهنگ‌ها', sub: 'جریان زنده ورود و خروج سرمایه بزرگ', cta: 'ورود' },
      ar: { tag: 'الأموال الذكية', title: 'تتبع الحيتان', sub: 'تدفقات السيولة الكبرى لحظياً', cta: 'دخول' },
      en: { tag: 'Smart Money', title: 'Whale Radar', sub: 'Live institutional inflows & moves', cta: 'Open' }
    }
  },
  {
    id: 'global',
    to: '/global',
    image: '/images/market-stack/global.jpg',
    accent: '#fb923c',
    edge: '#ea580c',
    copy: {
      fa: { tag: 'نقشه کلان', title: 'هوش جهانی', sub: 'نبض بازارهای بین‌المللی در یک نگاه', cta: 'ورود' },
      ar: { tag: 'نظرة شاملة', title: 'الذكاء العالمي', sub: 'نبض الأسواق العالمية في شاشة واحدة', cta: 'دخول' },
      en: { tag: 'Macro View', title: 'Global Intel', sub: 'World markets pulse in one console', cta: 'Open' }
    }
  },
  {
    id: 'ai',
    to: '/intent',
    image: '/images/market-stack/ai.jpg',
    accent: '#c084fc',
    edge: '#9333ea',
    copy: {
      fa: { tag: 'دستیار هوشمند', title: 'هوش مصنوعی FBT', sub: 'تحلیل، تصمیم‌گیری و اجرای مستقیم', cta: 'ورود' },
      ar: { tag: 'مساعد ذكي', title: 'الذكاء الاصطناعي', sub: 'تحليل واتخاذ قرار وتنفيذ فوري', cta: 'دخول' },
      en: { tag: 'AI Copilot', title: 'FBT Intelligence', sub: 'Analyze, decide & execute directly', cta: 'Open' }
    }
  }
];

function MarketStackedHero() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const movedRef = useRef(false);

  const lang = String(i18n.resolvedLanguage || i18n.language || 'fa').split('-')[0];
  const locale = lang === 'fa' || lang === 'ar' ? lang : 'en';
  const rtl = locale === 'fa' || locale === 'ar';
  const total = STACK_CARDS.length;

  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total]);
  const prev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total]);

  useEffect(() => {
    if (dragging) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % total);
    }, 4600);
    return () => window.clearInterval(id);
  }, [dragging, total]);

  const onPointerDown = (e) => {
    startXRef.current = e.clientX;
    movedRef.current = false;
    setDragging(true);
    setDragX(0);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startXRef.current;
    if (Math.abs(dx) > 6) movedRef.current = true;
    setDragX(dx);
  };

  const onPointerEnd = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragX < -38) next();
    else if (dragX > 38) prev();
    setDragX(0);
  };

  // Side peek direction: peeks out to the logical end edge + slightly down
  const peekDir = rtl ? -1 : 1;
  const visibleLayers = [2, 1, 0].map((offset) => {
    const cardIdx = (index + offset) % total;
    return { card: STACK_CARDS[cardIdx], offset };
  });

  return (
    <section className="mx-stack-hero" aria-label={locale === 'fa' ? 'کارت‌های ویژه بازار' : 'Featured market cards'}>
      <div
        className={`mx-stack-deck${dragging ? ' is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {visibleLayers.map(({ card, offset }) => {
          const text = card.copy[locale] || card.copy.en;
          const isFront = offset === 0;
          const style = isFront
            ? {
                '--stack-accent': card.accent,
                '--stack-edge': card.edge,
                transform: `translate3d(${dragX}px, 0, 0) rotate(${dragX * 0.03}deg)`,
                zIndex: 3
              }
            : {
                '--stack-accent': card.accent,
                '--stack-edge': card.edge,
                transform: `translate3d(${peekDir * offset * 10}px, ${offset * 6}px, 0) scale(${1 - offset * 0.045})`,
                opacity: offset === 1 ? 0.88 : 0.62,
                zIndex: 3 - offset
              };

          return (
            <div
              key={card.id}
              className={`mx-stack-card${isFront ? ' is-front' : ''}`}
              style={style}
              role={isFront ? 'button' : undefined}
              tabIndex={isFront ? 0 : -1}
              aria-hidden={!isFront}
              onClick={() => {
                if (isFront && !movedRef.current) navigate(card.to);
              }}
              onKeyDown={(e) => {
                if (isFront && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  navigate(card.to);
                }
              }}
            >
              <img
                className="mx-stack-img"
                src={card.image}
                alt=""
                loading={isFront ? 'eager' : 'lazy'}
                decoding="async"
                draggable="false"
              />
              <span className="mx-stack-scrim" aria-hidden="true" />
              {isFront && <span className="mx-stack-sheen" aria-hidden="true" />}

              <div className="mx-stack-content">
                <span className="mx-stack-tag">
                  <i aria-hidden="true" />
                  {text.tag}
                </span>
                <h2 className="mx-stack-title">{text.title}</h2>
                <p className="mx-stack-sub">{text.sub}</p>
              </div>

              {isFront && (
                <span className="mx-stack-cta" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17 17 7M7 7h10v10" />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default memo(MarketStackedHero);
