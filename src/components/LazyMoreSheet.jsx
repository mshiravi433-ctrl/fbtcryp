import { Suspense, useEffect, useState } from 'react';
import lazyRetry from '../lib/lazyRetry';

const MoreSheet = lazyRetry(() => import('./MoreSheet'));

/** Load the menu only when requested, then keep it mounted for exit animation. */
export default function LazyMoreSheet({ open, onClose }) {
  const [opened, setOpened] = useState(open);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  return (
    <Suspense fallback={null}>
      {(open || opened) && <MoreSheet open={open} onClose={onClose} />}
    </Suspense>
  );
}
