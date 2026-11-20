import { useLayoutEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../lib/scrollLock';
import { IconX } from './Icons';

// Native modal provides inert background, Escape, and focus restoration.
export default function BuySellScreen({ open, onClose, title, subtitle, icon, children, testId, dir, closeLabel, sell }) {
  const ref = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog.showModal();
    const unlock = lockBodyScroll();
    return () => {
      dialog.close();
      unlock();
      // React can detach a portal before the user agent restores focus.
      queueMicrotask(() => {
        if (!dialog.open && trigger instanceof HTMLElement && trigger.isConnected) {
          trigger.focus({ preventScroll: true });
        }
      });
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <dialog ref={ref} className={`bsland-screen ${sell ? 'is-sell' : 'is-buy'}`} dir={dir} aria-labelledby={titleId}
      data-testid={testId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="bsland-screen-head">
        <div>{icon && <span aria-hidden="true">{icon}</span>}<h2 id={titleId}>{title}</h2></div>
        <button type="button" className="bsland-icon" onClick={onClose} aria-label={closeLabel} data-testid={`${testId}-close`}>
          <IconX width={24} height={24} />
        </button>
      </header>
      <div className="bsland-screen-body">
        {subtitle && <p className="bsland-sheet-note">{subtitle}</p>}
        {children}
      </div>
    </dialog>, document.body
  );
}
