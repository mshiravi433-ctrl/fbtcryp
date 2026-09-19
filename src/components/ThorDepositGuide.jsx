import { useTranslation } from 'react-i18next';
import InfoBox from './InfoBox';
import {
  IconActivity,
  IconAlertTriangle,
  IconExternal,
  IconPen,
  IconQr,
  IconRoute,
  IconShield,
  IconWallet
} from './Icons';
import { assetChain, assetLabel } from '../lib/thorswap';
import { thorSourceKind } from '../lib/thorDeposit';
import '../styles/bridge-safety.css';

/*
 * ─── A STEP TIMELINE, NOT A WALL OF TEXT ───────────────────────────────────
 * Asked for directly: «باکس راهنمای پل بومی را مدرن و زیب کن». The old box was
 * an InfoBox with a bare <ol> — five bold titles, five long paragraphs, a red
 * <p> and two plain links, all one undifferentiated column.
 *
 * The redesign keeps every sentence (they are the safety copy; each one exists
 * because of a way somebody actually lost money) and changes the SHAPE:
 *
 *   badge → title → text, connected by a rail, so the eye can walk the five
 *   steps in order and come back for the one it needs;
 *   the warning becomes a red strip with an icon, not a fifth paragraph that
 *   reads like the other four;
 *   the two exits (THORSwap, official docs) become buttons, because a link
 *   that looks like body text is a link nobody finds.
 *
 * The collapsible InfoBox shell stays: a closed box with an informative title
 * is read; an open wall is skipped — the component's own documented rule.
 */

/* The glyphs live in the shared icon set (Icons.jsx): one vocabulary, one
   stroke weight — the same rule the Smart Money tile taught. */

export default function ThorDepositGuide({ from, to, signable = false }) {
  const { t } = useTranslation();
  const values = { source: assetChain(from), target: assetChain(to), asset: assetLabel(from) };
  const steps = [
    { icon: <IconWallet width={16} height={16} />, title: t('thor.guide.walletTitle'), text: t('thor.guide.wallet', values) },
    { icon: <IconQr width={16} height={16} />, title: t('thor.guide.receiveTitle'), text: t('thor.guide.receive', values) },
    { icon: <IconRoute width={17} height={17} />, title: t('thor.guide.routeTitle'), text: t(`thor.guide.${thorSourceKind(from)}`, values) },
    { icon: <IconShield width={16} height={16} />, title: t('thor.guide.reviewTitle'), text: t('thor.guide.review', values) },
    { icon: <IconActivity width={16} height={16} />, title: t('thor.guide.trackTitle'), text: t('thor.guide.track') }
  ];
  return (
    <div className="thor-guide">
      <InfoBox title={t('thor.guide.title')} id="thor-deposit-guide" defaultOpen icon={<IconRoute width={15} height={15} />}>
        <p className="thor-guide-intro">{t('thor.guide.manual')}</p>

        {/*
          The sign-here chip appears only when the SOURCE is one of THORChain's
          EVM chains — those swaps can now be signed on this page with the
          connected wallet (src/lib/thorEvmDeposit.js). It sits ABOVE the five
          manual steps because it is the shorter, safer path: one signature,
          no copy-paste, no external interface. For Bitcoin-family and Cosmos
          sources the chip is absent and the manual steps below remain the
          only way.
        */}
        {signable && (
          <div className="thor-guide-signhere">
            <IconPen width={15} height={15} />
            <span>{t('thor.guide.signHere')}</span>
          </div>
        )}

        <ol className="thor-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="thor-step">
              <span className="thor-step-badge" aria-hidden="true">{s.icon}</span>
              <div className="thor-step-body">
                <span className="thor-step-title">
                  <span className="thor-step-num mono">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </span>
                <p className="thor-step-text">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="thor-guide-danger" role="note">
          <IconAlertTriangle width={15} height={15} />
          <span>{t('thor.guide.noSend')}</span>
        </div>

        <div className="thor-guide-actions">
          <a
            className="btn btn-ghost btn-sm"
            href="https://app.thorswap.finance/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('thor.guide.openSwap')} <IconExternal width={13} height={13} />
          </a>
          <a
            className="btn btn-ghost btn-sm"
            href="https://dev.thorchain.org/concepts/sending-transactions.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('thor.guide.docs')} <IconExternal width={13} height={13} />
          </a>
        </div>

        <p className="thor-guide-foot">{t('thor.guide.external')}</p>
      </InfoBox>
    </div>
  );
}
