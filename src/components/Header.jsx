import { useTranslation } from 'react-i18next';
import { applyDirection } from '../i18n';

const LANGS = [
  { code: 'fa', label: 'فا' },
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'عر' }
];

export default function Header() {
  const { i18n } = useTranslation();

  const change = (code) => {
    i18n.changeLanguage(code);
    applyDirection(code);
  };

  return (
    <div className="top-bar">
      <div className="brand">
        <span className="brand-mark" />
        <span>Market Desk</span>
      </div>
      <div className="lang-switch">
        {LANGS.map((l) => (
          <button
            key={l.code}
            className={`lang-btn ${i18n.language === l.code ? 'active' : ''}`}
            onClick={() => change(l.code)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
