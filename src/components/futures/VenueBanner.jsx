import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStill } from '../AnimatedIcon';

const ART = {
  dydx: ['dydx-markets', 'dydx-depth', 'dydx-funding'],
  onchain: ['onchain-network', 'onchain-assets', 'onchain-settlement']
};

export default function VenueBanner({ venue, title, subtitle, status }) {
  const { t } = useTranslation();
  const still = useStill();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (still || paused || hovered) return;
    const timer = setInterval(() => { if (!document.hidden) setSlide((index) => (index + 1) % 3); }, 6500);
    return () => clearInterval(timer);
  }, [still, paused, hovered]);
  const index = still ? 0 : slide;
  return (
    <section className="derivatives-hero futures-venue-banner" data-venue={venue} data-slide={index} data-still={still || paused} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="futures-venue-art" key={`art-${index}`} aria-hidden="true">
        <img src={`/images/venue-banner/${ART[venue][index]}.svg`} alt="" draggable="false" />
      </div>
      <div className="futures-venue-slide" key={index}>
        <h2>{index === 0 ? title : t(`futures.venueSlides.${venue}.${index}.title`)}</h2>
        <p>{index === 0 ? subtitle : t(`futures.venueSlides.${venue}.${index}.body`)}</p>
      </div>
      <div className="futures-venue-meta">
        {status}
        {!still && <button type="button" className="futures-slide-pause" aria-pressed={paused}
          aria-label={t('futures.venueSlides.pause')} onClick={() => setPaused((value) => !value)}>
          {[0, 1, 2].map((dot) => <i key={dot} className={dot === index ? 'is-current' : ''} aria-hidden="true" />)}
        </button>}
      </div>
    </section>
  );
}
