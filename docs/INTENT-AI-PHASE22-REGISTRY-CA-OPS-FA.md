# فاز ۲۲ — عملیات Registry / CA

تاریخ: ۲۰۲۶-۰۸-۲۶

## هدف
ثبت‌نام durable، CA revoke/expiry، handshake fail-closed.

## محدوده
داخل: registry store، cert expiry/revoke، handshake. خارج: live CA، live handshake.

## ورودی/خروجی
ورودی: registryEvidence، certEvidence. خروجی: operational=false بدون evidence.

## محدودیت
Handshake بدون cert معتبر هرگز live نیست.

## وضعیت
کد + probe. unavailable.

## تست
`npm run test:phase22`

## پذیرش
Missing registry/cert → fail-closed.
