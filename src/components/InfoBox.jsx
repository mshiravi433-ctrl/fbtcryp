import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronRight } from './Icons';

/**
 * A COLLAPSIBLE BOX FOR WARNINGS AND EXPLANATIONS.
 * ---------------------------------------------------------------------------
 * Asked for directly:
 *
 *   «کلا هشدارها بهم نریخته باشد و داخل یک جعبه باز شونده باشد بهتر است
 *    هم هشدار هم توصیه ها»
 *
 * — the warnings are scattered; put them in one box that opens, both the
 * warnings and the advice. And the Restrictions sheet was named as the model.
 *
 * ─── THE PROBLEM THIS SOLVES, MEASURED ──────────────────────────────────────
 * Counting `.notice` blocks on the screens named: Wallet has 8, SolanaSwap has
 * 8, Stocks has 5, Signals has 4. On a phone that is a column of amber and red
 * boxes the user scrolls past to reach the thing they came for.
 *
 * That is not a cosmetic problem. It is the mechanism by which safety copy
 * stops working: when every third block is a warning, none of them is a
 * warning any more. The one that would have saved somebody money looks
 * exactly like the four that were only ever legal boilerplate.
 *
 * ─── WHY COLLAPSED IS SAFER THAN VISIBLE, WHICH IS COUNTERINTUITIVE ─────────
 * The instinct is that hiding a warning is worse. It is not, and the reason is
 * specific: a collapsed box with a clear title is READ — the title is short
 * enough to land — while an expanded wall is SKIPPED entirely. A title the
 * user actually reads plus content one tap away beats four paragraphs nobody
 * looks at.
 *
 * The exception is anything that is about to cost money irreversibly on THIS
 * tap. Those stay inline as a plain `.notice`, and `InfoBox` is deliberately
 * not used for them. The rule: if it describes what the button will do, it
 * stays visible; if it explains how a market works or restates policy, it goes
 * in here.
 *
 * ─── AND WHY IT IS NOT A SHEET ──────────────────────────────────────────────
 * RestrictionsSheet is a modal, correct for something that interrupts. This
 * expands in place, so the reader keeps their scroll position and their
 * context. A modal for "how do futures work" would be a heavier interruption
 * than the question deserves.
 */

/**
 * @param {object}  props
 * @param {string}  props.title      the always-visible line. Must be a real
 *                                   question or claim, never "More info" —
 *                                   the whole design depends on the title
 *                                   being informative on its own.
 * @param {'info'|'warn'|'danger'} [props.tone='info']
 * @param {boolean} [props.defaultOpen=false]
 * @param {string}  [props.id]       for a stable animation key
 */
export default function InfoBox({ title, tone = 'info', defaultOpen = false, id, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const { haptic } = useTelegram();

  return (
    <div className={`infobox infobox-${tone} ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="infobox-head"
        aria-expanded={open}
        onClick={() => {
          haptic?.('select');
          setOpen((v) => !v);
        }}
      >
        {/*
          A dot rather than an icon glyph. Tone is carried by colour alone at
          this size — a 14px warning triangle next to 13px text is noise, and
          the four screens this replaces were already too busy.
        */}
        <span className="infobox-dot" aria-hidden="true" />
        <span className="infobox-title">{title}</span>
        <motion.span
          className="infobox-chev"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden="true"
        >
          <IconChevronRight width={15} height={15} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={id ?? 'body'}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="infobox-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
