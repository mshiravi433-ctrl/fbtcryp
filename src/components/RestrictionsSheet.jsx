import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';

/**
 * RESTRICTIONS — who can use which third party, and why.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS A SHEET AND NOT A RED BOX ON THE P2P SCREEN ────────────────
 * It used to be a permanent danger notice at the top of the P2P desk list,
 * written entirely about Iran. The owner's objection is correct and it is a
 * product point, not a cosmetic one:
 *
 *     «ما از همه جهان مشتری داریم نه فقط ایران»
 *
 * A user in Ankara, Dubai or Berlin opening the P2P screen was met with a
 * red warning about sanctions that does not apply to them, on a screen whose
 * job is to help them trade. That teaches everybody to scroll past red boxes
 * — including the one person the box was written for.
 *
 * ─── AND WHY IT IS STILL ONE TAP AWAY, NOT DELETED ──────────────────────────
 * The facts have not changed. Binance, OKX and Bybit do publish Iran as a
 * fully blocked jurisdiction under OFAC, and somebody who deposits and then
 * has an account frozen is materially worse off than somebody who never
 * signed up. Removing the information to make the screen tidier would be
 * trading a real harm for a cosmetic gain.
 *
 * So: an "eligibility" link sits next to the desk list, in neutral styling,
 * and everything is in here — as a per-country table rather than a paragraph
 * about one country. That way a Turkish user learns TRY works, an Emirati
 * user learns AED works, and an Iranian user still gets the warning that
 * matters, without any of the three being shouted at on arrival.
 *
 * ─── NOTHING HERE IS MACHINE-TRANSLATED ─────────────────────────────────────
 * Every string comes from the locale files, hand-written. Legal and safety
 * copy is the one category where an approximate translation is a liability:
 * "may be restricted" and "is prohibited" are one word apart and a world
 * apart.
 */

/**
 * Regions, ordered so the workable ones come FIRST.
 *
 * Deliberate. Leading with the blocked case would reproduce the problem this
 * sheet exists to solve — the reader's first impression should be "this works
 * in most places", because that is true, with the exception stated plainly
 * afterwards rather than hidden.
 *
 * `status` drives the pill, and it is a three-way, not a boolean:
 *   ok        — works today, verified against the provider's own list
 *   partial   — works for some rails only
 *   blocked   — the provider publishes this jurisdiction as excluded
 *
 * A two-way flag would have forced Turkey and the UAE into the same bucket as
 * either the UK or Iran, and both of those would be wrong.
 */
const REGIONS = [
  { id: 'eu', status: 'ok' },
  { id: 'uk', status: 'ok' },
  { id: 'turkey', status: 'ok' },
  { id: 'uae', status: 'ok' },
  { id: 'global', status: 'partial' },
  { id: 'us', status: 'blocked' },
  { id: 'iran', status: 'blocked' }
];

const PILL = {
  ok: 'pill-up',
  partial: 'pill-neutral',
  blocked: 'pill-down'
};

export default function RestrictionsSheet({ open, onClose }) {
  const { t } = useTranslation();

  return (
    <Sheet open={open} onClose={onClose} title={t('restrict.title')} size="lg">
      <p className="prose-sm">{t('restrict.intro')}</p>

      <div style={{ marginTop: 14 }}>
        {REGIONS.map((r) => (
          <div className="restrict-row" key={r.id}>
            <span className="restrict-row-name">{t(`restrict.region.${r.id}.name`)}</span>
            <span className={`pill ${PILL[r.status]}`}>{t(`restrict.status.${r.status}`)}</span>
            <span className="restrict-row-note">{t(`restrict.region.${r.id}.note`)}</span>
          </div>
        ))}
      </div>

      {/*
        The one thing that is a property of the payment networks rather than
        of any company's policy, and therefore the one thing no partner change
        can fix. Kept separate from the table so it is not read as one more
        provider rule that might be waived.
      */}
      <p className="notice" style={{ marginTop: 16 }}>{t('restrict.cards')}</p>

      <p className="prose-sm" style={{ marginTop: 14 }}>{t('restrict.ourPosition')}</p>

      <p className="faint" style={{ fontSize: 11.4, marginTop: 12, lineHeight: 1.8 }}>
        {t('restrict.sourceNote')}
      </p>
    </Sheet>
  );
}
