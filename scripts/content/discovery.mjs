/**
 * Shared brand identity and bottom-of-page discovery links.
 * These are readable navigation, not a hidden keyword list. Generic words
 * such as "swap" and "crypto" describe the product; they are NOT aliases of
 * the organisation. Rankings and answer-engine citations are not guaranteed.
 */
export const BRAND_ALIASES = [
  'FBT', 'FBTSwap', 'FBT Swap', 'اف‌بی‌تی سواپ', 'اف بی تی سواپ', 'اف بی تی', 'اف‌بی‌تی'
];
export const INDEXABLE_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
// An editorial date: change only when the homepage/product prose changes.
export const HOME_CONTENT_UPDATED = '2026-10-13';

export const DISCOVERY_COPY = {
  en: {
    heading: 'FBT Swap and practical crypto guides',
    description: 'FBT Swap, also written FBTSwap or FBT, is a non-custodial crypto swap interface. Swap means exchanging tokens; crypto refers to digital assets, not a promised return or unrestricted access.',
    links: [
      ['fbt-swap', 'What is FBT Swap (FBTSwap)?'],
      ['crypto-profit-and-risk', 'Crypto profit: net returns, costs and risks'],
      ['crypto-access-and-restrictions', 'Crypto access, sanctions and provider restrictions'],
      ['crypto-swap-without-kyc', 'Swap crypto without an FBT account'],
      ['trust/contact-and-verification', 'Verify the official site and contact']
    ]
  },
  fa: {
    heading: 'شناخت اف بی تی و راهنماهای کاربردی کریپتو',
    description: 'FBT Swap یا FBTSwap، با نام فارسی اف بی تی سواپ، رابط سواپ غیرامانی ارز دیجیتال است. «Swap» یعنی تبدیل توکن و «Crypto» یعنی ارز دیجیتال؛ این واژه‌ها وعدهٔ سود یا حذف محدودیت‌ها نیستند.',
    links: [
      ['fa/fbt-swap', 'معرفی FBT Swap و اف بی تی سواپ'],
      ['fa/crypto-profit-and-risk', 'سود با کریپتو: محاسبهٔ بازده و ریسک‌ها'],
      ['fa/crypto-access-and-restrictions', 'صرافی بدون تحریم؟ بررسی محدودیت‌ها'],
      ['fa/crypto-swap-without-kyc', 'سواپ ارز دیجیتال بدون حساب اف بی تی'],
      ['fa/trust/contact-and-verification', 'بررسی دامنهٔ رسمی و راه تماس']
    ]
  }
};

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderDiscovery({ lang = 'en', site = '', headingTag = 'h2', className = '' } = {}) {
  const copy = DISCOVERY_COPY[lang];
  if (!copy || !['h2', 'h3'].includes(headingTag)) throw new Error('[discovery] invalid language or heading level');
  const origin = site.replace(/\/+$/, '');
  return `<section class="search-guides${className ? ` ${esc(className)}` : ''}" lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">
    <${headingTag}>${esc(copy.heading)}</${headingTag}>
    <p>${esc(copy.description)}</p>
    <nav aria-label="${esc(copy.heading)}">
      <ul>${copy.links.map(([slug, label]) => `
        <li><a href="${esc(`${origin}/${slug}`)}">${esc(label)}</a></li>`).join('')}
      </ul>
    </nav>
  </section>`;
}

export const DISCOVERY_STYLES = `
  .search-guides {
    box-sizing: border-box;
    margin: 24px 0 0;
    padding: clamp(20px, 3vw, 32px);
    border: 1px solid var(--line, var(--border, rgba(168,186,236,.22)));
    border-radius: 20px;
    color: var(--text-1, var(--ink, inherit));
    font: inherit;
    line-height: 1.85;
  }
  .search-guides :is(h2,h3) { margin: 0 0 10px; font-size: clamp(18px, 3vw, 23px); line-height: 1.5; letter-spacing: 0; }
  .search-guides p { margin: 0 0 14px; font-size: 14px; color: var(--text-2, var(--muted, inherit)); }
  .search-guides ul { margin: 0; padding-inline-start: 20px; display: grid; gap: 8px; }
  .search-guides a { color: var(--ink-cyan, var(--cy, var(--cyan, #7dd3fc))); font-size: 14px; text-underline-offset: 4px; overflow-wrap: anywhere; }
  .search-guides a:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; border-radius: 3px; }
`;
