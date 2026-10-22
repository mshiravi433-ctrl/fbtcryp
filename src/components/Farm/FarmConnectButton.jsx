import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import WalletConnectSheet from '../WalletConnectSheet';
import { IconWallet } from '../Icons';

/** A real wallet entry point for every Farm execution surface. */
export default function FarmConnectButton({ hint }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="farm-connect-action">
      {hint && <span className="faint">{hint}</span>}
      <button
        type="button"
        className="btn btn-primary farm-btn"
        onClick={() => setOpen(true)}
        data-testid="farm-connect-wallet"
      >
        <IconWallet width={15} height={15} /> {t('wallet.connect')}
      </button>
      {open && <WalletConnectSheet open onClose={() => setOpen(false)} />}
    </div>
  );
}
