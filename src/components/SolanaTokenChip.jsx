import TokenIcon from '../lib/tokenIcon';
import '../styles/solana-token-chip.css';

/**
 * THE TOKEN BUTTON ON THE SOLANA SWAP TICKET.
 * ---------------------------------------------------------------------------
 *   «صفحه سواپ سولانا فقط مدرن تر باکس توکن بهتر که اسم توکن مشخص باشد …
 *   عرض و اندازه درست و ظاهر خیلی مدرن و بی نهایت زیبا باشد»
 *
 * ─── WHY THE NAME IS ON THE BUTTON ─────────────────────────────────────────
 * The button used to show a bare ticker, truncated with an ellipsis at 54% of
 * the box. On Solana that is not a cosmetic problem, it is a correctness one:
 * the tickers people actually trade collide constantly — three different
 * tokens answer to `USDC`-adjacent names, a dozen answer to `PUMP`-shaped
 * strings, and a five-character truncation renders half the deep list as
 * identical text. A user choosing between two rows that read the same has
 * been given no information at all.
 *
 * So the chip is TWO lines: the ticker, which is what the user says out loud,
 * and the name, which is what tells two same-ticker tokens apart. The name is
 * muted rather than hidden so it never competes with the amount on the right.
 *
 * ─── SIZED, NOT SQUEEZED ───────────────────────────────────────────────────
 * The old control was `max-width: 54%` with `flex: 0 0 auto`, which on a
 * narrow phone meant the ticker got ellipsised before the name could be shown
 * at all. This one is `flex: 1 1 auto` with a `min-width: 0` column, so the
 * NAME truncates and the TICKER never does — the one string the user needs
 * in full is the one guaranteed to survive a 320px viewport. A 44px minimum
 * height keeps it a real thumb target.
 *
 * Trust stays visible: an imported token keeps its verified/unverified mark
 * beside the ticker after the picker closes, because a name can be spoofed
 * and a badge beside it cannot be un-seen.
 */
export default function SolanaTokenChip({ token, onClick, testId, label }) {
  const symbol = token?.symbol || `${String(token?.mint ?? '').slice(0, 4)}…${String(token?.mint ?? '').slice(-4)}`;
  const name = token?.name && token.name !== symbol ? token.name : null;

  return (
    <button
      type="button"
      className="sol-chip"
      onClick={onClick}
      data-testid={testId}
      aria-label={name ? `${symbol} — ${name}` : symbol}
    >
      <TokenIcon token={token} size={32} />
      <span className="sol-chip-text">
        <span className="sol-chip-top">
          <span className="sol-chip-sym">{symbol}</span>
          {token?.imported ? (
            <span className={`sol-token-imported-chip ${token.verified ? 'verified' : 'unverified'}`}>
              {token.verified ? '✓' : '!'}
            </span>
          ) : null}
          {token?.verified && !token?.imported ? (
            <span className="sol-token-imported-chip verified" aria-hidden="true">✓</span>
          ) : null}
        </span>
        {/* The name is the whole point of the redesign, and it is the string
            allowed to truncate. A hidden name helps nobody; a clipped ticker
            makes two different tokens look like one. */}
        <span className="sol-chip-name">{name ?? label ?? ''}</span>
      </span>
      <span className="sol-chip-caret" aria-hidden="true">
        <svg width="11" height="7" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m1 1.5 5 5 5-5" />
        </svg>
      </span>
    </button>
  );
}
