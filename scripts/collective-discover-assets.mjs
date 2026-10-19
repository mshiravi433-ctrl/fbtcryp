#!/usr/bin/env node
import fs from 'node:fs';
import { isAddress } from 'ethers';
const address = process.env.COLLECTIVE_DEPLOYER_ADDRESS;
try {
  if (!isAddress(address)) throw new Error('public deployer address required');
  const response = await fetch(`https://explorer.testnet.chain.robinhood.com/api/v2/addresses/${address}/token-balances`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Blockscout unavailable');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('invalid Blockscout response');
  const cell = (v) => String(v ?? '').replace(/[|\r\n<>`]/g, ' ').slice(0, 200);
  const table = ['### TESTNET token discovery — select explicitly; never auto-selected', '| symbol | address | decimals | balance (raw) |', '| --- | --- | --- | --- |', ...rows.map(({token, value}) => `| ${cell(token?.symbol)} | ${cell(token?.address_hash)} | ${cell(token?.decimals)} | ${cell(value)} |`)].join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  else console.log(table);
} catch { console.error('Token discovery failed: Blockscout unavailable or public deployer address invalid. No token guessed.'); process.exitCode = 1; }
