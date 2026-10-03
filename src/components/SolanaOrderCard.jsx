import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SolanaTokenPicker from './SolanaTokenPicker';
import TokenIcon from '../lib/tokenIcon';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { SOLANA_BASE_TOKENS, getSolanaUniverseSync, loadSolanaUniverse, mergeSolanaUniverse } from '../lib/solanaUniverse';
import { addSolanaHandoff, loadSolanaHandoffs, removeSolanaHandoff } from '../lib/solanaOrders';
import { SOL_MINT, USDC_MINT } from '../lib/solana';

/**
 * SOLANA ORDER — the second network family for automatic orders.
 * ===========================================================================
 *
 * ─── WHY THIS IS A SEPARATE BOX AND NOT A CHAIN IN THE LIST ────────────────
 * The EVM form creates a PRICE-WATCHED order: a coingecko id goes to the
 * server watcher, which checks the rate and notifies when the level is
 * reached. A Solana mint has no CoinGecko id and the watcher holds no key, so
 * a Solana row cannot honestly be that same object.
 *
 * What it can be is a saved handoff: the pair and the amount are remembered
 * locally, and one tap opens the Solana swap with those values already
 * filled in. The box says that in plain language BEFORE it is used, and the
 * screen it opens says the same thing again, because "saved" and "placed" are
 * two different promises and only one of them is true here.
 *
 * ─── WHY IT BELONGS ON THIS SCREEN AT ALL ─────────────────────────────────
 * The Solana swap already accepts a handoff — `fromMint` / `toMint` / `amount`
 * in the query string, with a consumer written for exactly this screen. Until
 * now nothing produced those parameters, so the Solana side of "auto orders"
 * was unreachable from the orders tab and the token list stopped at the EVM
 * chains. It also makes the network count honest: this app trades Solana
 * tokens on a chain with tens of thousands of mints, and the picker offers the
 * same catalogue the swap screen does.
 *
 * The saved rows are capped (40) and local. Nothing here claims a fill, and
 * nothing is sent to a server.
 *
 * ─── IT MOVED TO THE BOTTOM OF THE PAGE, BEHIND A FOLD ─────────────────────
 * Requested: «سفارش سولانا را در باکس بازشونده و پایین صفحه ببر با ظاهری
 * مدرن‌تر.» It used to sit between the EVM rail and the user's own live
 * orders, which put a form they had not asked for above the list they came to
 * see. `embedded` renders the form with no outer chrome so
 * components/CollapsibleCard.jsx can own the header, the icon and the fold;
 * the non-embedded path is kept because other screens (and the tests) mount
 * this card directly.
 *
 * ─── EVERY MESSAGE HERE IS A KEY ───────────────────────────────────────────
 * Reported on this exact card: «ارورها را به صورت استرینگ میزنه … با توجه زبان
 * انتخابی باید درست بزنه.» Both calls below were always written as keys —
 * `orders.solana.err.BAD_AMOUNT`, `orders.solana.notice` — and the contents of
 * the toast was the defect: the toast host resolved `toast.<key>` with an
 * empty-string default, and because i18n is configured with
 * `returnEmptyString: false` the "missing" answer came back as the key path
 * itself. Fixed in components/Toasts.jsx (see MISSING there); the keys here are
 * translated in all twelve locales and now actually render.
 */
export default function SolanaOrderCard({ embedded = false, onSaved = null } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const notify = useAppStore((s) => s.notify);

  const [universe, setUniverse] = useState(() => getSolanaUniverseSync());
  const [fromMint, setFromMint] = useState(SOL_MINT);
  const [toMint, setToMint] = useState(USDC_MINT);
  const [amount, setAmount] = useState('');
  const [picker, setPicker] = useState(null); // 'from' | 'to' | null
  const [rows, setRows] = useState(() => loadSolanaHandoffs());

  /*
   * The curated list paints first and the remote catalogue arrives when it
   * answers — the same contract the swap screen uses, from the same cache.
   */
  useEffect(() => {
    let alive = true;
    loadSolanaUniverse((next) => {
      if (alive && Array.isArray(next) && next.length) setUniverse(next);
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const tokens = useMemo(
    () => mergeSolanaUniverse(SOLANA_BASE_TOKENS, universe),
    [universe]
  );

  const from = useMemo(() => tokens.find((tk) => tk.mint === fromMint) ?? null, [tokens, fromMint]);
  const to = useMemo(() => tokens.find((tk) => tk.mint === toMint) ?? null, [tokens, toMint]);

  /* A mint the catalogue does not know is still selectable (the picker imports
     it by address), so a bare mint must not render as an empty row. */
  const label = (tk, mint) => tk?.symbol || `${String(mint).slice(0, 4)}…${String(mint).slice(-4)}`;

  const pick = (tk) => {
    const mint = String(tk?.mint || '');
    if (!mint) return;
    const side = picker;
    if (side === 'from') {
      if (mint === toMint) setToMint(fromMint);
      setFromMint(mint);
    } else {
      if (mint === fromMint) setFromMint(toMint);
      setToMint(mint);
    }
    setPicker(null);
  };

  const save = () => {
    const res = addSolanaHandoff({
      fromMint,
      toMint,
      amountIn: amount,
      fromSymbol: label(from, fromMint),
      toSymbol: label(to, toMint)
    });
    if (res.error) {
      notify(`orders.solana.err.${res.error}`, 'error');
      return;
    }
    haptic?.('success');
    const next = loadSolanaHandoffs();
    setRows(next);
    /* The fold's badge is owned by the page, so the count is reported rather
       than duplicated. Optional, so the standalone card (and the tests that
       mount it alone) do not have to supply a handler. */
    onSaved?.(next.length);
    notify('orders.solana.notice', 'success');
  };

  const open = (row) => {
    haptic?.('light');
    const params = new URLSearchParams({
      fromMint: row.fromMint,
      toMint: row.toMint
    });
    if (Number(row.amountIn) > 0) params.set('amount', String(row.amountIn));
    navigate(`/solana?${params.toString()}`);
  };

  const drop = (id) => {
    const next = removeSolanaHandoff(id);
    setRows(next);
    onSaved?.(next.length);
  };

  const form = (
    <>
      {/* The same disclosure the standalone card carried in its header: this
          is a saved handoff, not a price-watched order. Inside the fold it
          stays first, so it is read before the fields are filled. */}
      {embedded && (
        <p className="faint" style={{ fontSize: 11.4, lineHeight: 1.75, margin: '0 0 10px' }}>
          {t('orders.solana.body')}
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="ord-sol-row" style={{ flex: 1, minWidth: 0 }} onClick={() => setPicker('from')}>
          <TokenIcon token={from ?? { symbol: label(from, fromMint) }} size={26} />
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
            <span className="faint" style={{ fontSize: 10 }}>{t('orders.solana.from')}</span>
            <span className="ord-sol-pair">{label(from, fromMint)}</span>
          </span>
        </button>
        <button type="button" className="ord-sol-row" style={{ flex: 1, minWidth: 0 }} onClick={() => setPicker('to')}>
          <TokenIcon token={to ?? { symbol: label(to, toMint) }} size={26} />
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
            <span className="faint" style={{ fontSize: 10 }}>{t('orders.solana.to')}</span>
            <span className="ord-sol-pair">{label(to, toMint)}</span>
          </span>
        </button>
      </div>

      <label className="ord-field" style={{ marginTop: 9 }}>
        <span>{t('orders.solana.amount')}</span>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
        />
      </label>

      {/* The network this box is for, stated so the EVM cards above are not
          mistaken for something that can spend a Solana balance. */}
      <p className="faint" style={{ fontSize: 11, lineHeight: 1.7, margin: '9px 0 0' }}>
        {t('orders.solana.evmHint')}
      </p>

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={save}>
          {t('orders.solana.create')}
        </button>
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="section-label" style={{ marginBottom: 6 }}>{t('orders.solana.saved')}</p>
          {rows.map((row) => (
            <div className="ord-sol-row" key={row.id}>
              <span className="ord-sol-pair">
                {row.amountIn ? `${row.amountIn} ` : ''}
                {row.fromSymbol || '—'} → {row.toSymbol || '—'}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(row)}>
                {t('orders.solana.open')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => drop(row.id)}>
                {t('orders.solana.remove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={embedded ? 'ord-sol-body' : 'ord-sol-card'} data-testid="ord-sol-card">
      {!embedded && (
        <div className="ord-sol-head">
          <span className="ord-sol-mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5 6 6h14.5L18 8.5H3.5Z" />
              <path d="M3.5 15.5 6 18h14.5L18 15.5H3.5Z" />
            </svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 13.5, lineHeight: 1.3 }}>{t('orders.solana.title')}</div>
            <div className="faint" style={{ fontSize: 11.4, lineHeight: 1.65, marginTop: 3 }}>{t('orders.solana.body')}</div>
          </div>
        </div>
      )}

      {form}

      <SolanaTokenPicker
        open={picker != null}
        onClose={() => setPicker(null)}
        tokens={tokens}
        onPick={pick}
        onImport={pick}
        side={picker === 'from' ? 'from' : 'to'}
        selectedMints={[fromMint, toMint]}
      />
    </div>
  );
}
