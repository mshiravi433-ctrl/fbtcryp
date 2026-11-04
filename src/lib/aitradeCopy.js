export const AI_TRADE_COPY_FA = {
  tabTitle: 'AI ترید',
  sectionTitle: 'ترید با هوش مصنوعی (shadow)',
  sectionBody: 'در حالت shadow قیمت واقعی mainnet خوانده می‌شود ولی هیچ سفارشی ارسال نمی‌شود. هیچ سود یا بازدهی تضمین نمی‌شود؛ ممکن است بخش یا همهٔ سرمایه از بین برود.',
  connectAgent: 'وصل کردن کلید agent',
  connectAi: 'وصل کردن کلید AI (اختیاری)',
  mainKeyWarning: 'کلید اصلی کیف پول را اینجا وارد نکنید.',
  deleteKey: 'حذف کلید',
  killSwitch: 'توقف اضطراری',
  killSwitchConfirm: 'همهٔ سفارش‌های در صف لغو می‌شوند.',
  confirmHold: 'برای تأیید ۵۰۰ میلی‌ثانیه نگه دارید',
  shadow: 'حالت shadow (بدون ارسال)',
  unknown: 'نامشخص',
  geoWarning: 'هشدار: محدودیت جغرافیایی ممکن است ترید واقعی را محدود کند.',
  caps: {
    perTx: 'سقف هر تراکنش: ۲۰٬۰۰۰ دلار',
    totalExposure: 'سقف کل exposure باید حداقل برابر سقف هر تراکنش باشد.',
    incompatibility: 'تنظیمات سقف ناسازگار است و ذخیره نشد.'
  },
  err: {
    HL_CAP_PER_TX_EXCEEDED: 'مبلغ این سفارش از سقف هر تراکنش (۲۰٬۰۰۰ دلار) بیشتر است.',
    HL_CAP_KILL_SWITCH: 'کلید توقف فعال است؛ هیچ سفارشی ارسال نمی‌شود.'
  }
};

export const AI_TRADE_COPY_EN = {
  tabTitle: 'AI Trade',
  sectionTitle: 'AI trading (shadow)',
  sectionBody: 'In shadow mode real mainnet prices are read but no order is sent. No profit or return is guaranteed; you may lose part or all of your funds.',
  connectAgent: 'Connect agent key',
  connectAi: 'Connect AI key (optional)',
  mainKeyWarning: 'Do not enter your main wallet key here.',
  deleteKey: 'Delete key',
  killSwitch: 'Emergency stop',
  killSwitchConfirm: 'All queued orders will be cancelled.',
  confirmHold: 'Hold 500ms to confirm',
  shadow: 'Shadow mode (no sending)',
  unknown: 'Unknown',
  geoWarning: 'Warning: geographic restrictions may limit real trading.',
  caps: {
    perTx: 'Per-transaction cap: 20,000 USD',
    totalExposure: 'Total exposure cap must be at least the per-transaction cap.',
    incompatibility: 'Incompatible cap settings; not saved.'
  },
  err: {
    HL_CAP_PER_TX_EXCEEDED: 'This order exceeds the per-transaction cap (20,000 USD).',
    HL_CAP_KILL_SWITCH: 'Kill switch is on; no order will be sent.'
  }
};

export function aiTradeCopyFor(lang) {
  const l = String(lang || '').toLowerCase();
  if (l === 'fa' || l.startsWith('fa')) return AI_TRADE_COPY_FA;
  return AI_TRADE_COPY_EN;
}

// aliases
export const AI_TRADE_COPY = AI_TRADE_COPY_FA;
export const AITradeCopy = { fa: AI_TRADE_COPY_FA, en: AI_TRADE_COPY_EN };
