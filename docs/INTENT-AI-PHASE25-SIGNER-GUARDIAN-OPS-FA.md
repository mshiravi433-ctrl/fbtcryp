# فاز ۲۵ — Wallet / Guardian / Signer Ops

تاریخ: ۲۰۲۶-۰۸-۲۶

## هدف
Envelope دقیق، Guardian≠user، signer mock fail-closed.

## محدوده
داخل: signer/guardian envelope. خارج: live signer.

## ورودی/خروجی
ورودی: signerEvidence، guardianEvidence.

## محدودیت
Guardian مستقل؛ External Agent بدون seed.

## وضعیت
کد + probe. unavailable.

## تست
`npm run test:phase25`

## پذیرش
Mock signer / same-as-user guardian → fail-closed.
