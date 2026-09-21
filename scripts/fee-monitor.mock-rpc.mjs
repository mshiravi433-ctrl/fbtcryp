#!/usr/bin/env node
/**
 * Local JSON-RPC mock for fee-monitor.mjs — proves the script's logic with a
 * simulated chain, because this dev sandbox has no route to public RPCs.
 * Answers a fixed chain (56 by default, overridable) with:
 *   eth_chainId, eth_getBalance, eth_blockNumber, eth_getLogs, eth_call
 * and a Solana-style getBalance/getTokenAccountsByOwner on the same port
 * when SOL=1 (Solana client hits the same URL shape with POST JSON-RPC 2.0).
 *
 *   node scripts/fee-monitor.mock-rpc.mjs 8137        # starts on :8137
 *   RPC_URL=http://127.0.0.1:8137 node scripts/fee-monitor.mjs --chain 56 --no-logs
 */
import http from 'node:http';

const port = Number(process.argv[2] || 8137);

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RECIPIENT = '0xaf5ce154cefd22da5bd1d0a54479e81963a224d6';
const USDT = '0x55d398326f99059ff775485246999027b3197955'; // BSC USDT, decimals 18
const USDT_DEC = '0x' + (18n).toString(16).padStart(64, '0');
const USDT_SYM = '0x' + Buffer.from('USDT', 'ascii').toString('hex').padEnd(64, '0');
const FEE_ROUTER = '0x1111111111111111111111111111111111111111';

const pad = (a) => '0x' + a.replace(/^0x/, '').padStart(64, '0');
const hexQty = (n) => '0x' + BigInt(n).toString(16);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400).end('{}');
      return;
    }
    const { method, params } = msg;
    let result = null;

    if (method === 'eth_chainId') result = hexQty(56);
    else if (method === 'eth_getBalance') {
      // Recipient holds 2.5 BNB; anyone else 0.
      result = params[0]?.toLowerCase() === RECIPIENT ? hexQty(2_500_000_000_000_000_000n) : '0x0';
    } else if (method === 'eth_blockNumber') result = hexQty(50_000_000);
    else if (method === 'eth_getLogs') {
      const to = params[0]?.topics?.[2];
      if (to === pad(RECIPIENT)) {
        // Three fee transfers: 120 + 30 + 7.5 USDT (18 dp on this mock).
        const mk = (v) => ({ address: USDT, data: hexQty(v), transactionHash: '0x' + 'ab' + v.toString(16), topics: [TRANSFER_TOPIC, pad('0x' + '9'.repeat(40)), pad(RECIPIENT)] });
        result = [mk(120_000_000_000_000_000_000n), mk(30_000_000_000_000_000_000n), mk(7_500_000_000_000_000_000n)];
      } else {
        result = [];
      }
    } else if (method === 'eth_call') {
      const to = params[0]?.to?.toLowerCase();
      const data = params[0]?.data;
      if (to === USDT && data === '0x313ce567') result = USDT_DEC; // decimals()
      else if (to === USDT && data === '0x95d89b41') result = USDT_SYM; // symbol()
      else if (to === FEE_ROUTER && data === '0x24a9d853') result = hexQty(70); // feeBps()
      else if (to === FEE_ROUTER && data === '0x46904840') result = pad(RECIPIENT); // feeRecipient()
      else result = '0x';
    } else if (method === 'getBalance') {
      result = { value: 3_100_000_000 }; // 3.1 SOL
    } else if (method === 'getTokenAccountsByOwner') {
      result = { value: [{ account: { data: { parsed: { info: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: { uiAmount: 42.5 } } } } } }] };
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { message: 'MOCK_UNSUPPORTED' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
});

server.listen(port, '127.0.0.1', () => console.log(`mock rpc on http://127.0.0.1:${port}`));
