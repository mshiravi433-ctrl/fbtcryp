import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const STACK_CARDS = [
  {
    id: 'loan',
    to: '/loan',
    image: '/images/market-stack/loan.jpg',
    accent: '#f59e0b',
    copy: {
      fa: { tag: 'اعتبار آنی', title: 'وام کریپتویی', sub: 'وثیقه‌گذاری هوشمند با نرخ شفاف' },
      ar: { tag: 'ائتمان فوري', title: 'قروض الكريبتو', sub: 'ضمان ذكي بشروط شفافة' },
      en: { tag: 'Instant Credit', title: 'Crypto Loans', sub: 'Smart collateral with transparent rates' }
    }
  },
  {
    id: 'farm',
    to: '/farm',
    image: '/images/market-stack/farm.jpg',
    accent: '#10b981',
    copy: {
      fa: { tag: 'سود پایدار', title: 'فارم و استخرها', sub: 'بازدهی آن‌چین با مدیریت ریسک' },
      ar: { tag: 'عائد مستقر', title: 'الفارم والمجمعات', sub: 'عوائد على السلسلة بإدارة ذكية' },
      en: { tag: 'Live Yield', title: 'Yield Farming', sub: 'On-chain returns with curated risk' }
    }
  },
  {
    id: 'whales',
    to: '/smart-money',
    image: '/images/market-stack/whales.jpg',
    accent: '#38bdf8',
    copy: {
      fa: { tag: 'پول هوشمند', title: 'ردیابی نهنگ‌ها', sub: 'جریان زنده ورود و خروج سرمایه بزرگ' },
      ar: { tag: 'الأموال الذكية', title: 'تتبع الحيتان', sub: 'تدفقات السيولة الكبرى لحظياً' },
      en: { tag: 'Smart Money', title: 'Whale Radar', sub: 'Live institutional inflows & moves' }
    }
  },
  {
    id: 'global',
    to: '/global',
    image: '/images/market-stack/global.jpg',
    accent: '#fb923c',
    copy: {
      fa: { tag: 'نقشه کلان', title: 'هوش جهانی', sub: 'نبض بازارهای بین‌المللی در یک نگاه' },
      ar: { tag: 'نظرة شاملة', title: 'الذكاء العالمي', sub: 'نبض الأسواق العالمية في شاشة واحدة' },
      en: { tag: 'Macro View', title: 'Global Intel', sub: 'World markets pulse in one console' }
    }
  },
  {
    id: 'ai',
    to: '/intent',
    image: '/images/market-stack/ai.jpg',
    accent: '#c084fc',
    copy: {
      fa: { tag: 'دستیار هوشمند', title: 'هوش مصنوعی FBT', sub: 'تحلیل، تصمیم‌گیری و اجرای مستقیم' },
      ar: { tag: 'مساعد ذكي', title: 'الذكاء الاصطناعي', sub: 'تحليل واتخاذ قرار وتنفيذ فوري' },
      en: { tag: 'AI Copilot', title: 'FBT Intelligence', sub: 'Analyze, decide & execute directly' }
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
  const total = STACK_CARDS.length;

  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total]);
  const prev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total]);

  // Gentle auto-advance when user isn't dragging
  useEffect(() => {
    if (dragging) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % total);
    }, 5200);
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
    if (dragX < -42) next();
    else if (dragX > 42) prev();
    setDragX(0);
  };

  // Render top 3 visible layers (front, +1, +2)
  const visibleLayers = [2, 1, 0].map((offset) => {
    const cardIdx = (index + offset) % total;
    return { card: STACK_CARDS[cardIdx], offset, cardIdx };
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
                transform: `translate3d(${dragX}px, 0, 0) rotate(${dragX * 0.025}deg)`,
                zIndex: 3
              }
            : {
                '--stack-accent': card.accent,
                transform: `translate3d(0, ${offset * 9}px, 0) scale(${1 - offset * 0.055})`,
                opacity: offset === 1 ? 0.72 : 0.4,
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
              <div className="mx-stack-content">
                <span className="mx-stack-tag">
                  <i aria-hidden="true" />
                  {text.tag}
                </span>
                <h2 className="mx-stack-title">{text.title}</h2>
                <p className="mx-stack-sub">{text.sub}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mx-stack-dots" role="tablist" aria-label="Slides">
        {STACK_CARDS.map((card, i) => (
          <button
            key={card.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={(card.copy[locale] || card.copy.en).title}
            className={`mx-stack-dot${i === index ? ' is-active' : ''}`}
            style={{ '--stack-accent': card.accent }}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  );
}

export default memo(MarketStackedHero);
