# فاز ۲۴ — Sim / Monitor / Scheduler Ops

تاریخ: ۲۰۲۶-۰۸-۲۶

## هدف
Timeout≠quote، scheduler بدون sign، monitor جدا.

## محدوده
داخل: sim/monitor/scheduler evidence. خارج: live scheduler.

## ورودی/خروجی
ورودی: simEvidence، monitorEvidence، schedulerEvidence.

## محدودیت
Scheduler هرگز امضا یا اجرا نمی‌کند.

## وضعیت
کد + probe. unavailable.

## تست
`npm run test:phase24`

## پذیرش
Timeout/stale quote → fail-closed.
