import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition from './PageTransition';
import SegIndicator from './SegIndicator';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft } from './Icons';

/**
 * A page that hosts two or three existing screens as tabs.
 * ---------------------------------------------------------------------------
 * Requested: merge prediction+invest, explorer+discover, and help+docs into
 * single screens with tabs, and make the tab sizing consistent.
 *
 * ─── WHY A SHELL, NOT FIVE REWRITES ─────────────────────────────────────────
 * The obvious approach is to open each pair and splice one into the other.
 * That means touching five working screens, and every splice is a chance to
 * break a hook order, drop a piece of state or lose an effect — for a change
 * that is purely navigational.
 *
 * Instead the existing pages stay exactly as they are and this renders one of
 * them. Zero risk to their internals, and the merge is reversible by deleting
 * one file.
 *
 * ─── WHY EACH TAB IS A SEPARATE COMPONENT INSTANCE ──────────────────────────
 * Only the active tab is mounted. The alternative — render both and hide one
 * with CSS — would run both screens' polling, effects and network calls at
 * once, which on the Explorer/Discover pair would double the API traffic for
 * a tab nobody is looking at.
 *
 * The cost is that switching tabs remounts, losing scroll position and local
 * state. For these pairs that is right: they are different tasks, not two
 * views of one thing.
 *
 * ─── THE TAB IS IN THE URL ──────────────────────────────────────────────────
 * `?tab=` rather than component state, for three reasons that all bit this
 * app before: the Android back button can step between tabs instead of
 * leaving the screen, a link can point at a specific tab, and a crash-reload
 * returns to where the user was rather than to tab one.
 */
export default function TabbedPage({ titleKey, tabs, indicatorId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [params, setParams] = useSearchParams();

  const fromUrl = params.get('tab');
  const valid = tabs.some((x) => x.id === fromUrl);
  const [active, setActive] = useState(valid ? fromUrl : tabs[0].id);

  /*
   * Follow the URL when it changes underneath us — which is what happens when
   * the user presses Back. Without this the address bar would say `?tab=docs`
   * while the screen still showed Help.
   */
  useEffect(() => {
    if (valid && fromUrl !== active) setActive(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const select = (id) => {
    if (id === active) return;
    haptic?.('select');
    setActive(id);
    /*
     * `replace`, not push. Pushing would make Back walk through every tab a
     * user idly tapped before it left the screen, which is the single most
     * irritating form of history pollution on a phone.
     */
    setParams({ tab: id }, { replace: true });
  };

  const current = tabs.find((x) => x.id === active) ?? tabs[0];
  const Body = current.Component;

  return (
    <PageTransition>
      <div className="row" style={{ gap: 10, marginBottom: 2 }}>
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19, margin: 0 }}>{t(titleKey)}</h1>
      </div>

      {/*
        `.segmented` with `.seg-lg`: the shared control, sized up.

        Reported: "اندازه تب ها در صفحات خوب باشه". The base control is 12px
        text in 9px of padding, which was drawn for a three-way filter inside
        a card — as a page's primary navigation it reads as a footnote and the
        tap target is under the 44px minimum.
      */}
      <div className="segmented seg-lg">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={active === tab.id ? 'active' : ''}
            onClick={() => select(tab.id)}
            aria-pressed={active === tab.id}
            style={{ isolation: 'isolate' }}
          >
            {active === tab.id && <SegIndicator id={indicatorId} />}
            {tab.Icon && <tab.Icon width={15} height={15} aria-hidden="true" />}
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/*
        The hosted screen renders its own PageTransition, which would nest one
        motion wrapper inside another — two transforms on the same subtree,
        and a transform is the containing block for any `position: fixed`
        child. That is the exact cause of the sheet-centring bug fixed
        earlier, so hosted pages are given `embedded` and skip their own
        wrapper.
      */}
      <Body embedded />
    </PageTransition>
  );
}
