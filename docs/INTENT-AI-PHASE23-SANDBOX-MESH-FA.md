# فاز ۲۳ — Sandbox Mesh

تاریخ: ۲۰۲۶-۰۸-۲۶

## هدف
Isolation، stage audit، جلوگیری از mainnet.

## محدوده
داخل: mesh isolation، stage evidence. خارج: live mesh.

## ورودی/خروجی
ورودی: sandboxEvidence. خروجی: mainnetBlocked=true.

## محدودیت
Sandbox هرگز اجرای مالی واقعی نیست.

## وضعیت
کد + probe. unavailable.

## تست
`npm run test:phase23`

## پذیرش
Mainnet از sandbox fail-closed.
