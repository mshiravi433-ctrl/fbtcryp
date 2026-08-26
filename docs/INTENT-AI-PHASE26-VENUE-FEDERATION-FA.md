# فاز ۲۶ — Venue Federation

تاریخ: ۲۰۲۶-۰۸-۲۶

## هدف
Wallet، broker، bridge، venue جدا؛ health واقعی.

## محدوده
داخل: venue federation evidence. خارج: live venues.

## ورودی/خروجی
ورودی: venueEvidence، providerHealth.

## محدودیت
Venue unavailable بدون health واقعی.

## وضعیت
کد + probe. unavailable.

## تست
`npm run test:phase26`

## پذیرش
Fake venue / missing health → fail-closed.
