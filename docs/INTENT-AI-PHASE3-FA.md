# FBT Intent AI — فاز ۳: اکوسیستم چند-ایجنت

## هدف
ایجاد همکاری بین ایجنت‌های داخلی (استراتژی، اجرا) و ایجنت‌های خارجیِ تأییدشده با **Social Protocol** (فقط اجتماعی، نه دستور) و **capability token** محدود — بدون اینکه Agent یا UI هرگز Guardian / Risk / Audit را دور بزند و بدون اینکه هیچ credential خام به Agent خارجی داده شود.

## ماژول‌ها (`src/lib/intent-ai/`)

### `capabilityToken.js`
توکن محدود به `policyId + agentId + capabilities[] + allowedChains + allowedProtocols + maxAmountUsd + expiration`.
- **هرگز master credential نیست.** Agent فقط `handle` می‌بیند؛ payload مخفی در حافظه باقی می‌ماند.
- **Revoke فوری:** `revokeCapabilityToken` بلافاصله دسترسی را می‌بندد، حتی پیش از انقضا.
- **ممنوعیت‌ها:** `withdrawFunds`, `executeWithoutUser`, `bypassGuardian`, `holdRawCredential`, `fabricateReceipt` (و همچنین `unrestrictedSigner`, `holdPrivateKey`, `disableAudit`) همیشه stripped و اگر همهٔ درخواستی ممنوع باشد، توکن صادر نمی‌شود.
- Fail-closed: توکن منقضی / revoke / خارج از chain / protocol / سقف مبلغ → رد.

### `agentDirectory.js`
کشف ایجنت‌ها. فقط `securityStatus === 'verified'` (و در صورت وجود گواهی، گواهی `active`) برای مسیر اجرا واجد شرایط است.
- ایجنت `unverified` هرگز اجرا نمی‌شود؛ فقط فهرست می‌شود.
- **Listing = خوداظهاری، نه authority** (`DIRECTORY_IS_SELF_REPORTED = true`).
- هر ایجنت با کلید ممنوع (`FORBIDDEN_AGENT_KEYS` از `externalAgentSecurity.js`) از ثبت رد می‌شود.
- `matchAgent` فقط ایجنت‌های verified را برمی‌گرداند؛ `assertAgentForExecute` fail-closed.

### `multiAgentOrchestrator.js`
هماهنگی Strategy + Execution + External با Guardian **per-step**.
- **Handshake فقط Social Protocol** (`isCommand=false`, `isExecutable=false`).
- External فقط با capabilityToken معتبر + sessionKey scoped (handle، نه secret).
- **REPLAN** اگر متخصص رد شد → بهترین برنامهٔ بدون متخصص (هرگز Guardian-bypass).
- اگر کاربر ایجنت مشخصی را خواست و آن ایجنت پیدا/تأیید نشد، به‌جای جایگزینی بی‌صدا، همان متخصص را رد و replan می‌کند.
- `emergencyStopAllForPolicy` همهٔ کلیدهای نشست و capability tokenهای آن policy را revoke می‌کند.

### `learningOptIn.js`
فقط با رضایت صریح (`session.learningOptIn === true`). رکورد **ناشناس** بدون address / tx hash خام / user id / IP / کلید.
- بدون opt-in هیچ ذخیره/ارسالی.
- رکورد جعلی (COMPLETED بدون confirm) رد می‌شود.
- disclaimer صادقانه `NOT_GUARANTEED` همیشه موجود.
- کاربر می‌تواند همهٔ رکوردها را پاک کند.

## جریان
```
Intent → Strategy → Directory.match (اختیاری) → Guardian → capabilityToken
→ plan → ConfirmationGate / L3+TermsHash → SessionKey → sign → submit
→ Monitor → Reconcile → Audit → (opt-in) learning record
```

## تصمیمات امنیتی
- Guardian همیشه فعال و غیرقابل‌غیرفعال (`GUARDIAN_NON_DISABLEABLE`).
- هرگز credential خام / کلید خصوصی / seed / mnemonic / broker master credential / api secret بدون scope به Agent یا Adapter خارجی داده نمی‌شود.
- رسید جعلی ممنوع؛ partial صادقانه.
- Fail-closed: دادهٔ ناقص، خطا، timeout → توقف اجرا.
- Emergency Stop همهٔ نشست‌های L3 + capability token + session key را قطع می‌کند.

## تست‌ها
- `test/intent-ai/phase3-capability-token-probe.mjs`
- `test/intent-ai/phase3-directory-probe.mjs`
- `test/intent-ai/phase3-multi-agent-probe.mjs`
- `test/intent-ai/phase3-learning-optin-probe.mjs`
- `test/intent-ai/phase3-fail-closed-probe.mjs`

همه از `npm test` از طریق `test/run.mjs` اجرا می‌شوند.
