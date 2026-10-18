import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { IconActivity, IconShield, IconClock, IconTrend, IconSwap, IconInfo } from '../../components/Icons';

export default function CollectiveDashboard() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'fa';

  const [activeTab, setActiveTab] = useState('vaults'); // vaults, radar, dividends, queue
  const [selectedVault, setSelectedVault] = useState(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawShares, setWithdrawShares] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  // Mock initial reactive state for zero-cost operation
  const [vaults, setVaults] = useState([
    {
      id: 'vault-stable-01',
      name: isRtl ? 'صندوق سود پایدار USDG' : 'Robinhood USDG Stable Yield',
      symbol: 'fbtUSDG',
      type: 'stable',
      network: 'Robinhood Chain (4663)',
      asset: 'USDG',
      totalAssets: 485200.0,
      sharePrice: 1.054,
      monthlyApy: 8.65,
      lastMonthProfitUSDT: 3490.5,
      userShares: 0,
      claimableUSDT: 0,
      riskLevel: isRtl ? 'کم‌ریسک (وام‌دهی)' : 'Low (Lending)'
    },
    {
      id: 'vault-farm-02',
      name: isRtl ? 'صندوق نقدینگی و فارمینگ HOOD/USDG' : 'Robinhood LP Farming & Liquidity',
      symbol: 'fbtFARM',
      type: 'farming',
      network: 'Robinhood Chain (4663)',
      asset: 'HOOD-USDG LP',
      totalAssets: 320400.0,
      sharePrice: 1.142,
      monthlyApy: 21.4,
      lastMonthProfitUSDT: 5610.0,
      userShares: 0,
      claimableUSDT: 0,
      riskLevel: isRtl ? 'متوسط (تأمین نقدینگی)' : 'Medium (AMM Liquidity)'
    },
    {
      id: 'vault-stocks-03',
      name: isRtl ? 'صندوق معاملات سهام توکنایزشده رابین‌هود' : 'Robinhood Tokenized Equities Trading',
      symbol: 'fbtSTOCK',
      type: 'stock_trading',
      network: 'Robinhood Chain (4663)',
      asset: 'NVDA / AAPL / USDG',
      totalAssets: 195000.0,
      sharePrice: 1.098,
      monthlyApy: 16.2,
      lastMonthProfitUSDT: 2840.25,
      userShares: 0,
      claimableUSDT: 0,
      riskLevel: isRtl ? 'متوسط (الگوریتمی)' : 'Medium (Algorithmic)'
    }
  ]);

  const opportunities = [
    {
      title: isRtl ? 'استخر Aave V3 USDG' : 'Aave V3 USDG Optimizer',
      apy: '8.42%',
      risk: isRtl ? 'امن' : 'Low',
      action: isRtl ? 'تأمین پایدار نقدینگی' : 'Stable Supply',
      score: 95
    },
    {
      title: isRtl ? 'جفت‌ارز HOOD / USDG در Kyber' : 'HOOD/USDG Kyber Pool',
      apy: '22.80%',
      risk: isRtl ? 'متوسط' : 'Medium',
      action: isRtl ? 'کسب کارمزد تراکنش' : 'Fee Harvest & Auto-compound',
      score: 89
    },
    {
      title: isRtl ? 'مومنتوم سهام توکنیزه NVDA' : 'NVDA Tokenized Equity Momentum',
      apy: '18.50%',
      risk: isRtl ? 'کنترل‌شده' : 'Guarded',
      action: isRtl ? 'سوئیچ خودکار به USDG در صورت افت > ۴٪' : 'Auto Stop-loss to USDG on >4% drop',
      score: 92
    }
  ];

  const handleDeposit = () => {
    const val = parseFloat(depositAmount);
    if (!val || val <= 0) return;
    if (!selectedVault) return;

    setVaults(prev => prev.map(v => {
      if (v.id === selectedVault.id) {
        const addedShares = val / v.sharePrice;
        return {
          ...v,
          totalAssets: v.totalAssets + val,
          userShares: v.userShares + addedShares
        };
      }
      return v;
    }));

    showToast(isRtl 
      ? `واریز ${val} ${selectedVault.asset} با موفقیت ثبت و سهم استخر اختصاص یافت.`
      : `Successfully deposited ${val} ${selectedVault.asset}. Shares minted.`
    );
    setDepositAmount('');
    setSelectedVault(null);
  };

  const handleWithdrawRequest = () => {
    const val = parseFloat(withdrawShares);
    if (!val || val <= 0) return;
    if (!selectedVault || selectedVault.userShares < val) {
      showToast(isRtl ? 'موجودی سهم شما کافی نیست.' : 'Insufficient shares balance.');
      return;
    }

    setVaults(prev => prev.map(v => {
      if (v.id === selectedVault.id) {
        return {
          ...v,
          userShares: v.userShares - val
        };
      }
      return v;
    }));

    showToast(isRtl
      ? `درخواست بازخرید ${val} سهم در صف سررسید ماهانه ثبت شد.`
      : `Withdrawal request for ${val} shares queued for monthly epoch settlement.`
    );
    setWithdrawShares('');
    setSelectedVault(null);
  };

  const handleClaim = (vaultId) => {
    showToast(isRtl 
      ? 'سود نقدی محقق‌شده به کیف‌پول شما واریز شد (تراکنش بدون کارمزد ثبت شد).' 
      : 'Realized dividends claimed to your wallet.'
    );
  };

  return (
    <div className={`min-h-screen pb-28 pt-4 px-4 max-w-5xl mx-auto text-slate-100 ${isRtl ? 'rtl' : 'ltr'}`}>
      
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 backdrop-blur-xl text-emerald-200 text-sm font-medium shadow-2xl flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero Header Card - Glassmorphism */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-white/[0.07] to-white/[0.02] border border-white/10 backdrop-blur-2xl shadow-2xl mb-6">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-emerald-400 mb-3 tracking-wide uppercase">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {isRtl ? 'شبکه واقعی رابین‌هود (Chain 4663)' : 'Robinhood Chain Mainnet'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              FBT AI Collective
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-xl leading-relaxed">
              {isRtl
                ? 'صندوق سرمایه‌گذاری الگوریتمی جمعی با حاکمیت قرارداد هوشمند، مدیریت خودکار حد ضرر و توزیع ماهانهٔ سود نقد در قالب USDT بدون ریسک اصل سرمایه.'
                : 'Decentralized algorithmic collective vaults governed by strict on-chain risk controllers, automated stop-loss protection, and monthly net cash USDT distributions.'}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 self-stretch md:self-auto">
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-center">
              <div className="text-xs text-slate-400">{isRtl ? 'سررسید دوره' : 'Epoch Cycle'}</div>
              <div className="text-base font-bold text-slate-100 mt-1">{isRtl ? '۳۰ روزه (ماهانه)' : '30-Day Monthly'}</div>
            </div>
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-center">
              <div className="text-xs text-slate-400">{isRtl ? 'حداکثر اسلیپیج' : 'Max Slippage'}</div>
              <div className="text-base font-bold text-emerald-400 mt-1">۰.۵۰%</div>
            </div>
            <div className="col-span-2 sm:col-span-1 p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-center">
              <div className="text-xs text-slate-400">{isRtl ? 'حد ضرر خودکار' : 'Auto Stop-Loss'}</div>
              <div className="text-base font-bold text-cyan-400 mt-1">{isRtl ? 'سوئیچ به USDT' : 'Flight to USDT'}</div>
            </div>
          </div>
        </div>

        {/* Tab Navigation Navigation Pill */}
        <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-white/5">
          {[
            { id: 'vaults', label: isRtl ? 'صندوق‌های فعال' : 'Active Vaults', icon: IconActivity },
            { id: 'radar', label: isRtl ? 'رادار هوش مصنوعی و ریسک' : 'AI Radar & Governance', icon: IconShield },
            { id: 'dividends', label: isRtl ? 'سود ماهانه و سررسید' : 'Epoch & Dividends', icon: IconTrend },
            { id: 'queue', label: isRtl ? 'صف بازخرید اصل سرمایه' : 'Withdrawal Queue', icon: IconClock }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 ${
                activeTab === tab.id
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shadow-lg shadow-emerald-500/10'
                  : 'bg-white/[0.03] text-slate-400 border border-white/5 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: ACTIVE VAULTS */}
      {activeTab === 'vaults' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {vaults.map((vault) => (
            <motion.div
              key={vault.id}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.2 }}
              className="rounded-3xl p-6 bg-gradient-to-b from-white/[0.06] to-white/[0.02] border border-white/10 backdrop-blur-xl flex flex-col justify-between shadow-xl relative overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-emerald-400 uppercase">
                    {vault.riskLevel}
                  </span>
                  <h3 className="font-bold text-lg text-slate-100 mt-2">{vault.name}</h3>
                  <div className="text-xs text-slate-400">{vault.symbol} • {vault.asset}</div>
                </div>
              </div>

              <div className="space-y-3 my-4 py-3 border-y border-white/5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">{isRtl ? 'ارزش کل دارایی‌ها (NAV):' : 'Total NAV:'}</span>
                  <span className="font-semibold text-slate-200">${vault.totalAssets.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isRtl ? 'قیمت هر سهم:' : 'Share Price:'}</span>
                  <span className="font-semibold text-slate-200">${vault.sharePrice.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isRtl ? 'بازده تخمینی ماهانه:' : 'Monthly APY:'}</span>
                  <span className="font-bold text-emerald-400">+{vault.monthlyApy}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isRtl ? 'سهم شما در صندوق:' : 'Your Shares:'}</span>
                  <span className="font-semibold text-cyan-300">{vault.userShares.toFixed(2)} سهم</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={() => setSelectedVault(vault)}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-500/20"
                >
                  {isRtl ? 'واریز سرمایه' : 'Deposit'}
                </button>
                <button
                  onClick={() => setSelectedVault(vault)}
                  className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 font-semibold text-xs border border-white/10 transition"
                >
                  {isRtl ? 'درخواست برداشت' : 'Withdraw'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* TAB 2: AI RADAR & GOVERNANCE */}
      {activeTab === 'radar' && (
        <div className="space-y-5">
          <div className="rounded-3xl p-6 bg-white/[0.04] border border-white/10 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 mb-4">
              <IconShield className="w-5 h-5 text-emerald-400" />
              {isRtl ? 'رادار فرصت‌های هوش مصنوعی (اسکن زنده شبکه رابین‌هود)' : 'AI Opportunity Live Radar'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {opportunities.map((opp, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex justify-between items-center text-xs mb-2">
                    <span className="text-slate-400">{opp.title}</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">{opp.apy}</span>
                  </div>
                  <div className="text-xs text-slate-300 font-medium mb-3">{opp.action}</div>
                  <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-400 h-full rounded-full" style={{ width: `${opp.score}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-400 mt-2 text-right">
                    {isRtl ? `امتیاز اطمینان مدل: ${opp.score}٪` : `Model Confidence: ${opp.score}%`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl p-6 bg-white/[0.04] border border-white/10 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-slate-100 mb-2">
              {isRtl ? 'قوانین و محدودیت‌های قطعی قرارداد (On-Chain Hard Limits)' : 'On-Chain Hard Limits'}
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              {isRtl
                ? 'هوش مصنوعی تنها در چهارچوب کدهای قرارداد هوشمند حق ارائه پیشنهاد دارد و دسترسی به انتقال دارایی به خارج از سیستم نخواهد داشت.'
                : 'AI execution is strictly sandboxed by immutable on-chain policies.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400 block">{isRtl ? 'حداکثر لغزش (Slippage):' : 'Max Slippage:'}</span>
                <span className="font-bold text-slate-200 mt-1 block">۰.۵%</span>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400 block">{isRtl ? 'سقف هر تراکنش:' : 'Max Trade Size:'}</span>
                <span className="font-bold text-slate-200 mt-1 block">$50,000 USD</span>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400 block">{isRtl ? 'آستانه فعال‌سازی حد ضرر:' : 'Stop-Loss Trigger:'}</span>
                <span className="font-bold text-amber-400 mt-1 block">افت ۴٪ (سوئیچ به USDT)</span>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400 block">{isRtl ? 'روترهای مجاز:' : 'Approved Routers:'}</span>
                <span className="font-bold text-cyan-300 mt-1 block">Kyber / OpenOcean</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: EPOCHS & DIVIDENDS */}
      {activeTab === 'dividends' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-3xl p-6 bg-white/[0.04] border border-white/10 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-slate-100 mb-3 flex items-center gap-2">
              <IconTrend className="w-5 h-5 text-emerald-400" />
              {isRtl ? 'تسویه سود ماهانه در قالب USDT' : 'Monthly USDT Dividend Distribution'}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              {isRtl
                ? 'طبق استانداردهای دیفای، تنها سود خالص نقدی محقق‌شده (Realized Profit) به USDT تبدیل و به عنوان سود ماهانه میان سهم‌داران واجد شرایط تقسیم می‌شود.'
                : 'Only net realized cash income is converted to USDT and allocated proportionally to eligible share owners.'}
            </p>
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
              <div className="text-xs text-slate-300">{isRtl ? 'کل سود نقدی توزیع‌شده ماه‌های قبل:' : 'Total Past Dividends Paid:'}</div>
              <div className="text-2xl font-extrabold text-emerald-400 mt-1">$14,250.75 USDT</div>
            </div>
            <button
              onClick={() => handleClaim('all')}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20"
            >
              {isRtl ? 'دریافت سود نقدی ماهانه (Claim USDT)' : 'Claim Realized Dividends (USDT)'}
            </button>
          </div>

          <div className="rounded-3xl p-6 bg-white/[0.04] border border-white/10 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-slate-100 mb-3 flex items-center gap-2">
              <IconClock className="w-5 h-5 text-cyan-400" />
              {isRtl ? 'وضعیت دوره جاری (Epoch #2)' : 'Current Epoch Status'}
            </h3>
            <div className="space-y-3 text-xs my-4">
              <div className="flex justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400">{isRtl ? 'مدت دوره:' : 'Duration:'}</span>
                <span className="font-semibold text-slate-200">{isRtl ? '۳۰ روز کامل' : '30 Full Days'}</span>
              </div>
              <div className="flex justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400">{isRtl ? 'زمان باقی‌مانده تا سررسید و تقسیم سود:' : 'Days to Settlement:'}</span>
                <span className="font-bold text-cyan-400">{isRtl ? '۱۸ روز دیگر' : '18 Days Left'}</span>
              </div>
              <div className="flex justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-slate-400">{isRtl ? 'پنجره ثبت برداشت اصل سرمایه:' : 'Withdrawal Window:'}</span>
                <span className="font-semibold text-amber-300">{isRtl ? '۵ روز پایانی ماه (۱۳ روز دیگر باز می‌شود)' : 'Opens in 13 Days'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: WITHDRAWAL QUEUE */}
      {activeTab === 'queue' && (
        <div className="rounded-3xl p-6 bg-white/[0.04] border border-white/10 backdrop-blur-xl">
          <h3 className="text-lg font-bold text-slate-100 mb-2 flex items-center gap-2">
            <IconClock className="w-5 h-5 text-amber-400" />
            {isRtl ? 'صف شفاف بازخرید اصل سرمایه' : 'Transparent Principal Redemption Queue'}
          </h3>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            {isRtl
              ? 'برای حفظ نقدینگی و منافع سایر مشارکت‌کنندگان، درخواست‌های بازخرید اصل سرمایه در ۵ روز پایانی هر ماه ثبت و پس از تسویه ماهانه به صورت نوبتی و عادلانه نقد می‌شوند.'
              : 'Principal redemption requests are processed fairly at the monthly epoch boundary to ensure liquidity stability.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left rtl:text-right">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="pb-3">{isRtl ? 'شناسه درخواست' : 'Request ID'}</th>
                  <th className="pb-3">{isRtl ? 'صندوق' : 'Vault'}</th>
                  <th className="pb-3">{isRtl ? 'تعداد سهم' : 'Shares'}</th>
                  <th className="pb-3">{isRtl ? 'دوره سررسید' : 'Epoch'}</th>
                  <th className="pb-3">{isRtl ? 'وضعیت' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-200">
                <tr>
                  <td className="py-3 font-mono text-slate-400">#REQ-8021</td>
                  <td className="py-3">USDG Stable Yield</td>
                  <td className="py-3 font-bold">1,250.00</td>
                  <td className="py-3">Epoch #1</td>
                  <td className="py-3 text-emerald-400 font-semibold">{isRtl ? 'تسویه و پرداخت شد' : 'Processed'}</td>
                </tr>
                <tr>
                  <td className="py-3 font-mono text-slate-400">#REQ-8194</td>
                  <td className="py-3">LP Farming</td>
                  <td className="py-3 font-bold">450.00</td>
                  <td className="py-3">Epoch #2</td>
                  <td className="py-3 text-amber-300 font-semibold">{isRtl ? 'در صف تسویه ماه جاری' : 'Queued for Epoch #2'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* POPUP MODAL FOR DEPOSIT / WITHDRAW */}
      <AnimatePresence>
        {selectedVault && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-md p-6 rounded-3xl bg-slate-900 border border-white/10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-base text-slate-100">{selectedVault.name}</h3>
                <button
                  onClick={() => setSelectedVault(null)}
                  className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Deposit Section */}
              <div className="mb-5 pb-5 border-b border-white/5">
                <label className="text-xs text-slate-400 block mb-1">
                  {isRtl ? `مبلغ واریز به صندوق (${selectedVault.asset}):` : `Deposit Amount (${selectedVault.asset}):`}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="100.0"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    onClick={handleDeposit}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition"
                  >
                    {isRtl ? 'واریز' : 'Deposit'}
                  </button>
                </div>
              </div>

              {/* Withdraw Section */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {isRtl ? 'تعداد سهم جهت ثبت در صف بازخرید:' : 'Shares to queue for redemption:'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={withdrawShares}
                    onChange={(e) => setWithdrawShares(e.target.value)}
                    placeholder="50.0"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    onClick={handleWithdrawRequest}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-200 font-semibold border border-white/10 rounded-xl text-xs transition"
                  >
                    {isRtl ? 'ثبت صف' : 'Queue'}
                  </button>
                </div>
                <div className="text-[11px] text-slate-500 mt-2">
                  {isRtl ? `موجودی سهم شما: ${selectedVault.userShares.toFixed(2)} سهم` : `Your shares: ${selectedVault.userShares.toFixed(2)}`}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
