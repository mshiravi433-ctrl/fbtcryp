import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';

const LIFETIME = 3200;

function Toast({ item }) {
  const { t } = useTranslation();
  const dismiss = useAppStore((s) => s.dismiss);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), LIFETIME);
    return () => clearTimeout(timer);
  }, [item.id, dismiss]);

  return (
    <motion.div
      layout
      className={`toast toast-${item.kind}`}
      initial={{ opacity: 0, y: -22, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
    >
      {t(`toast.${item.key}`, { defaultValue: item.key, ...item.values })}
    </motion.div>
  );
}

export default function Toasts() {
  const notifications = useAppStore((s) => s.notifications);
  return (
    <div className="toast-host">
      <AnimatePresence initial={false}>
        {notifications.slice(0, 3).map((n) => (
          <Toast key={n.id} item={n} />
        ))}
      </AnimatePresence>
    </div>
  );
}
