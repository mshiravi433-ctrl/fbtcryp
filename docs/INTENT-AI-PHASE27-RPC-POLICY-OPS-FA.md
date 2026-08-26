# فاز ۲۷ — RPC / Policy Ops

تاریخ: ۲۰۲۶-۰۸-۲۶

## هدف
Quorum، code-hash، mismatch fail-closed.

## محدوده
داخل: rpc quorum، policy hash. خارج: live RPC.

## ورودی/خروجی
ورودی: rpcEvidence، policyHashEvidence.

## محدودیت
Mismatch هرگز ready نیست.

## وضعیت
کد + probe. unavailable.

## تست
`npm run test:phase27`

## پذیرش
RPC/policy mismatch → fail-closed.
