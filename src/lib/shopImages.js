/**
 * PROMO AND DESTINATION IMAGERY.
 * ---------------------------------------------------------------------------
 * ─── WHY THE OLD PICTURES LOOKED WASHED OUT ─────────────────────────────────
 * Reported twice: «عکس های فروشگاه هنوز بی رنگ و زشته». The cause was
 * resolution, not the gradient I fixed last time.
 *
 * Every banner used the provider's own destination photos, and those exist at
 * exactly ONE size: 200x250. I checked for larger variants — `_400x500` and
 * `_600x750` both return AccessDenied — so 200 pixels wide was the ceiling.
 * Stretching a 200px image across a full-width 21:9 banner upscales it about
 * six times, which is precisely what "faint and ugly" looks like.
 *
 * These are 1280px wide instead. On the same banner that is a downscale rather
 * than an upscale, which is the difference between soft and sharp.
 *
 * ─── AND WHY IRAN IS IN THE SET ─────────────────────────────────────────────
 * Asked for: «از ایران هم باشد یا اصفهان جای تاریخی». The provider's own
 * catalogue has no Iranian destination at all — unsurprising, since Iran is
 * not among the 233 countries they serve. So these come from Wikimedia
 * Commons, where the Isfahan and Persepolis photographs are award-winning
 * (several are Commons "featured" and Picture of the Year finalists) and far
 * better than anything in the provider's set.
 *
 * ─── THE LICENCE OBLIGATION IS REAL AND IS MET ──────────────────────────────
 * Every one of these is Creative Commons with `AttributionRequired: true`,
 * read from the Commons API rather than assumed. CC-BY and CC-BY-SA both
 * require crediting the author wherever the work appears.
 *
 * So `credit` is not decoration: it is rendered on the banner and the licence
 * is named. Using these without it would be a copyright violation, and the
 * fact that "nobody would notice" is not a reason — this is the same standard
 * applied to the issuer notes and the venue disclosures.
 *
 * Photographs are hotlinked from upload.wikimedia.org, which is Wikimedia's
 * documented public CDN. Nothing is copied into the repo, so nothing here
 * bloats the bundle.
 */

const WM = 'https://upload.wikimedia.org/wikipedia/commons/thumb';

/**
 * Wide artwork for the rotating promo banner (21:9).
 *
 * Landscape or panoramic sources only — a portrait photo cropped to 21:9 keeps
 * a horizontal sliver of its middle, which is usually the least interesting
 * part of the frame.
 */
export const PROMO_IMAGES = {
  isfahanBridge: {
    src: `${WM}/c/c2/Si-o-se-Pol.jpg/1280px-Si-o-se-Pol.jpg`,
    credit: 'Reza Haji-pour',
    licence: 'CC BY 3.0'
  },
  isfahanMosque: {
    src: `${WM}/6/65/Isfahan_Lotfollah_mosque_ceiling_symmetric.jpg/1280px-Isfahan_Lotfollah_mosque_ceiling_symmetric.jpg`,
    credit: 'Phillip Maiwald',
    licence: 'CC BY-SA 3.0'
  },
  persepolis: {
    src: `${WM}/7/7b/%D9%BE%D8%A7%D9%86%D9%88%D8%B1%D8%A7%D9%85%D8%A7_%D8%B1%D9%88%D8%B2_%D8%AA%D8%AE%D8%AA_%D8%AC%D9%85%D8%B4%DB%8C%D8%AF.jpg/1280px-%D9%BE%D8%A7%D9%86%D9%88%D8%B1%D8%A7%D9%85%D8%A7_%D8%B1%D9%88%D8%B2_%D8%AA%D8%AE%D8%AA_%D8%AC%D9%85%D8%B4%DB%8C%D8%AF.jpg`,
    credit: 'Hamidhassas',
    licence: 'CC BY-SA 4.0'
  },
  naqsheJahan: {
    src: `${WM}/0/06/Naghsh-e_Jahan_Square.jpg/1280px-Naghsh-e_Jahan_Square.jpg`,
    credit: 'Reza Sobhani',
    licence: 'CC BY-SA 4.0'
  },
  tehran: {
    src: `${WM}/d/de/Si-o-se_Pol%2C_Isfahan%2C_Ir%C3%A1n%2C_2016-09-19%2C_DD_04-06_HDR.jpg/1280px-Si-o-se_Pol%2C_Isfahan%2C_Ir%C3%A1n%2C_2016-09-19%2C_DD_04-06_HDR.jpg`,
    credit: 'Diego Delso',
    licence: 'CC BY-SA 4.0'
  }
};

/**
 * The promo rotation.
 *
 * Iranian landmarks throughout, on request. Each slide names the tab it opens
 * so the banner is navigation rather than decoration.
 */
export const PROMO_SLIDES = [
  { id: 'p-fly', img: PROMO_IMAGES.isfahanBridge, title: 'shop.promo.flights', go: 'flights' },
  { id: 'p-stay', img: PROMO_IMAGES.naqsheJahan, title: 'shop.promo.stays', go: 'stays' },
  { id: 'p-card', img: PROMO_IMAGES.isfahanMosque, title: 'shop.promo.cards', go: 'cards' },
  { id: 'p-esim', img: PROMO_IMAGES.persepolis, title: 'shop.promo.esim', go: 'topup' }
];
