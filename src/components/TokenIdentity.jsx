import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTokenProfile } from '../lib/tokenProfile';

function safeHref(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch { return null; }
}

function plainText(value) {
  if (typeof value !== 'string') return '';
  if (typeof DOMParser === 'undefined') return value.replace(/<[^>]*>/g, '').trim();
  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script, style').forEach((node) => node.remove());
  return doc.body.textContent.trim();
}

/** A single project profile; descriptions are source text, never generated claims. */
export default function TokenIdentity({ coin }) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!coin?.id) return undefined;
    const controller = new AbortController();
    setProfile(null);
    setLoading(true);
    getTokenProfile(coin.id, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setProfile(result); setLoading(false); }
    });
    return () => controller.abort();
  }, [coin?.id]);

  const detail = profile?.id === coin?.id ? profile : null;
  const language = String(i18n?.resolvedLanguage || i18n?.language || 'en').split('-')[0].toLowerCase();
  const localized = plainText(detail?.descriptions?.[language]);
  const english = plainText(detail?.descriptions?.en || coin?.description);
  const description = localized || english;
  const descriptionLanguage = localized ? language : 'en';
  const homepage = safeHref(detail?.homepage || coin?.homepage);
  const whitepaper = safeHref(detail?.whitepaper);
  const facts = useMemo(() => [
    detail?.genesisDate && [t('coin.identity.genesisDate'), detail.genesisDate],
    detail?.categories?.length && [t('coin.identity.categories'), detail.categories.join(' · ')],
    detail?.platforms?.length && [t('coin.identity.networks'), detail.platforms.join(' · ')]
  ].filter(Boolean), [detail, t]);

  return (
    <article className="coin-identity coin-id-profile" data-testid="coin-identity">
      <header className="coin-id-profile-head">
        <span className="coin-id-eyebrow">{t('coin.identity.identity')}</span>
        <h3>{coin?.name} <span>{coin?.symbol}</span></h3>
      </header>
      {loading && !description && <p className="coin-id-note" role="status">{t('common.loading')}</p>}
      {description && (
        <details className="coin-id-description" open>
          <summary>{t('coin.identity.aboutTitle')}</summary>
          <p className="coin-id-copy coin-id-typing" lang={descriptionLanguage} dir="auto" data-testid="coin-identity-description">{description}</p>
        </details>
      )}
      {facts.length > 0 && <dl className="coin-id-facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}
      </dl>}
      {(homepage || whitepaper) && <div className="coin-id-links">
        {homepage && <a className="coin-id-link" href={homepage} target="_blank" rel="noopener noreferrer nofollow" data-testid="coin-identity-homepage">{t('coin.identity.officialSite')}</a>}
        {whitepaper && <a className="coin-id-link" href={whitepaper} target="_blank" rel="noopener noreferrer nofollow">{t('coin.identity.whitepaper')}</a>}
      </div>}
      {detail && <span className="coin-id-source" data-testid="coin-identity-source">CoinGecko</span>}
    </article>
  );
}
