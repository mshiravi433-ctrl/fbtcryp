/**
 * Risk Trainer — interactive R:R + position size calculator.
 *
 * VISUAL PASS: five `LabSlider`s (each showing its own filled track and live
 * value pill) and one picture that makes the whole screen worth opening — a
 * risk/reward bar whose two segments are sized by the actual ratio. Dragging
 * the take-profit slider visibly grows the green half, which teaches R:R faster
 * than the number next to it.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { AICoach, LAB_EASE, LabBack, LabSlider, Notice, Panel, Row } from './Shared';
import { calcPositionSize } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useStill } from '../AnimatedIcon';

export default function RiskTrainer({ onBack }) {
  const { t } = useTranslation();
  const balance = useLabStore((s) => s.balance);
  const [capital, setCapital] = useState(balance);
  const [riskPct, setRiskPct] = useState(1);
  const [stopLossPct, setStopLossPct] = useState(3);
  const [takeProfitPct, setTakeProfitPct] = useState(9);
  const [entry, setEntry] = useState(100);

  const sizing = useMemo(
    () => calcPositionSize({ capital, riskPct, stopLossPct, entryPrice: entry }),
    [capital, riskPct, stopLossPct, entry]
  );

  const rr = stopLossPct > 0 ? takeProfitPct / stopLossPct : 0;
  const winRateNeeded = rr > 0 ? (1 / (1 + rr)) * 100 : 100;

  const coachMsg =
    riskPct > 2
      ? t('lab2.risk.coachAggressive')
      : rr < 1.5
      ? t('lab2.risk.coachBadRr')
      : rr >= 3
      ? t('lab2.risk.coachGood')
      : t('lab2.risk.coachNeutral');

  const coachTone = riskPct > 2 || rr < 1.5 ? 'warn' : rr >= 3 ? 'good' : 'neutral';

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="shield"
        accent="cyan"
        title={t('lab2.screens.risk.title')}
        sub={t('lab2.screens.risk.sub')}
      />

      <Panel title={t('lab2.risk.inputs')} icon="gauge" accent="cyan">
        <div className="lab2-stack" style={{ gap: 14 }}>
          <LabSlider
            label={t('lab2.risk.capital')}
            value={capital}
            onChange={setCapital}
            min={100}
            max={1000000}
            step={100}
            accent="amber"
            display={<span className="lab2-num">${capital.toLocaleString()}</span>}
          />
          <LabSlider
            label={t('lab2.risk.entryPrice')}
            value={entry}
            onChange={setEntry}
            min={1}
            max={100000}
            step={1}
            accent="cyan"
            display={<span className="lab2-num">${entry.toLocaleString()}</span>}
          />
          <LabSlider
            label={t('lab2.risk.riskPerTrade')}
            value={riskPct}
            onChange={setRiskPct}
            min={0.1}
            max={10}
            step={0.1}
            accent={riskPct > 2 ? 'rose' : 'violet'}
            display={<span className="lab2-num">{riskPct.toFixed(1)}%</span>}
          />
          <LabSlider
            label={t('lab2.risk.stopLoss')}
            value={stopLossPct}
            onChange={setStopLossPct}
            min={0.5}
            max={20}
            step={0.5}
            accent="rose"
            display={<span className="lab2-num">{stopLossPct.toFixed(1)}%</span>}
          />
          <LabSlider
            label={t('lab2.risk.takeProfit')}
            value={takeProfitPct}
            onChange={setTakeProfitPct}
            min={0.5}
            max={50}
            step={0.5}
            accent="mint"
            display={<span className="lab2-num">{takeProfitPct.toFixed(1)}%</span>}
          />
        </div>
      </Panel>

      <Panel title={t('lab2.risk.rrAnalysis')} icon="scale" accent="mint">
        <RatioBar rr={rr} stopLossPct={stopLossPct} takeProfitPct={takeProfitPct} />
        <Row
          label={t('lab2.risk.rr')}
          value={<span className="lab2-num">1 : {rr.toFixed(2)}</span>}
          valueClass={rr >= 3 ? 'pos' : rr >= 1.5 ? '' : 'neg'}
        />
        <Row label={t('lab2.risk.winRateBreakEven')} value={<span className="lab2-num">{winRateNeeded.toFixed(1)}%</span>} />
        <Row label={t('lab2.risk.winRate2x')} value={<span className="lab2-num">{Math.max(winRateNeeded, 0).toFixed(1)}% + 5%</span>} />
      </Panel>

      <Panel title={t('lab2.risk.positionSizing')} icon="pie" accent="violet">
        <Row label={t('lab2.risk.positionSizeUnits')} value={<span className="lab2-num">{sizing.qty}</span>} />
        <Row label={t('lab2.risk.positionValue')} value={<span className="lab2-num">${sizing.positionValue.toFixed(2)}</span>} />
        <Row label={t('lab2.risk.potentialLoss')} value={<span className="lab2-num">${sizing.potentialLoss.toFixed(2)}</span>} valueClass="neg" />
        <Row
          label={t('lab2.risk.potentialProfit')}
          value={<span className="lab2-num">${((sizing.positionValue * takeProfitPct) / stopLossPct).toFixed(2)}</span>}
          valueClass="pos"
        />
      </Panel>

      <AICoach tone={coachTone} message={coachMsg} />

      <Notice variant="info" icon="scale">
        {t('lab2.risk.notice')}
      </Notice>
    </div>
  );
}

/**
 * Risk (red) vs reward (green), sized by the ratio.
 *
 * The reward segment is capped at 82% of the bar so a 1:12 setup still shows a
 * visible sliver of red — a bar that is 100% green teaches nothing about the
 * risk that is still on the table.
 */
function RatioBar({ rr, stopLossPct, takeProfitPct }) {
  const still = useStill();
  const capped = Math.max(0, Math.min(rr, 8));
  const rewardPct = 18 + (capped / 8) * 64;
  const riskPct = 100 - rewardPct;

  return (
    <div className="lab2-rr" role="img" aria-label={`1 : ${rr.toFixed(2)}`}>
      <motion.div
        className="lab2-rr-seg risk"
        initial={still ? false : { flexBasis: '50%' }}
        animate={{ flexBasis: `${riskPct}%` }}
        transition={{ duration: 0.5, ease: LAB_EASE }}
      >
        <span className="lab2-num">−{stopLossPct.toFixed(1)}%</span>
      </motion.div>
      <motion.div
        className="lab2-rr-seg reward"
        initial={still ? false : { flexBasis: '50%' }}
        animate={{ flexBasis: `${rewardPct}%` }}
        transition={{ duration: 0.5, ease: LAB_EASE }}
      >
        <span className="lab2-num">+{takeProfitPct.toFixed(1)}%</span>
      </motion.div>
    </div>
  );
}
