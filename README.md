# Market Desk — Telegram Mini App (starter)

React + Vite Telegram Mini App skeleton: multilingual (fa/en/ar, RTL-aware),
AI market analysis UI, non-custodial trading, portfolio view, BSC wallet connect.

## مهم — معماری غیرحضانتی (Non-custodial)

این پروژه **عمداً** هیچ آدرس کیف پول متعلق به ادمین/بات نداره. کاربر فقط
از کیف پول خودش تراکنش امضا می‌کنه (`WalletContext.jsx`). این تصمیم آگاهانه‌ست:

- جمع‌آوری وجوه کاربران در یک کیف پول مرکزی برای "سرمایه‌گذاری" از نظر قانونی
  در اکثر کشورها نیازمند مجوز رسمی نهاد مالی/بورس است.
- این الگو دقیقاً همون چیزیه که در کلاهبرداری‌های سرمایه‌گذاری کریپتو دیده می‌شه.
- اگر می‌خوای یک صندوق سرمایه‌گذاری واقعی و قانونی بسازی، باید با یک وکیل/مشاور
  حقوقی حوزه فین‌تک صحبت کنی و از قراردادهای هوشمند استاندارد و ممیزی‌شده
  (مثلاً الگوهای vault مثل ERC-4626) و مجوزهای لازم استفاده کنی — نه یک کیف پول شخصی.

## Setup

```bash
npm install
npm run dev
```

Open the dev server through a tunnel (e.g. `ngrok http 5173`) and register that
HTTPS URL as your bot's Mini App URL with @BotFather (`/newapp`).

## What's wired up

- **i18n**: `src/i18n` — fa/en/ar with automatic RTL via `applyDirection()`.
  Language is auto-detected from `Telegram.WebApp.initDataUnsafe.user.language_code`.
- **Telegram SDK**: `src/context/TelegramContext.jsx` — reads the Telegram user,
  expands the viewport, sets header/background color to match the app theme.
- **Wallet**: `src/context/WalletContext.jsx` — connects to BSC via injected
  `window.ethereum` (desktop/testing). For real use inside Telegram's in-app
  browser (which has no injected wallet), wire up WalletConnect v2 — the
  exact spot is marked with a `TODO` in that file.
- **Pages**: Home (market pulse), Analysis (AI sentiment + price prediction —
  currently mock data), Trade (swap UI, signs from the user's wallet only),
  Portfolio (read-only holdings view).

## What you still need to add

1. **Real AI analysis backend** — an API endpoint that returns sentiment
   scores (e.g. from news/Twitter NLP) and a price-prediction model output.
   Replace `src/lib/mockData.js` with real fetch calls.
2. **WalletConnect v2** for in-Telegram wallet connection.
3. **Swap contract call** in `Trade.jsx` (e.g. PancakeSwap router) using the
   connected signer.
4. **Portfolio balances** — read live token balances for the connected
   address via BscScan API or an RPC call instead of `mockPortfolio`.
5. **Legal review** if you plan to offer any pooled/managed investment product.
