#!/usr/bin/env node
/**
 * Offline cost probe for the optional FBT-native report → AI Trade prompt.
 * It imports no provider credentials and makes no network requests.
 * Run with the repository's supported Node version: node scripts/measure-ai-trade-research.mjs
 */
import { performance } from 'node:perf_hooks';
import { buildAnalystMessages } from '../src/lib/hyperliquid/aiClient.js';
import { tradeResearchFromTask } from '../src/lib/hyperliquid/tradeResearch.js';

const ITERATIONS = 10_000;
const WARMUP = 500;
const now = Date.now();
const active = {
  id: 'fbt-native:smart-money-tracker',
  native: true,
  source: 'native',
  name: 'Smart Money Tracker'
};
const task = {
  agentId: active.id,
  providerId: 'fbt-native',
  state: 'completed',
  result: {
    text: 'x'.repeat(3_000),
    data: {
      agent: 'smart-money-tracker',
      title: 'T'.repeat(100),
      dataStatus: 'live',
      readAt: now,
      citations: [
        `https://example.com/${'a'.repeat(170)}`,
        `https://example.org/${'b'.repeat(170)}`,
        `https://example.net/${'c'.repeat(170)}`
      ]
    }
  }
};
const research = tradeResearchFromTask(task, active, { now });
const args = {
  rules: { strategy: 'manual', notes: '' },
  caps: { maxOrderUsd: 20_000, maxLeverage: 2, maxStopLossPct: 0.05, allowedCoins: ['BTC'] },
  account: {},
  mids: {},
  candles: []
};
const plain = buildAnalystMessages({ ...args, now });
const enriched = buildAnalystMessages({ ...args, firstPartyResearch: research, now });

function measure(withResearch) {
  const make = () => buildAnalystMessages({ ...args, firstPartyResearch: withResearch ? research : null, now });
  for (let i = 0; i < WARMUP; i += 1) make();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) make();
  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);
  return {
    wallMs: Number(wallMs.toFixed(1)),
    cpuMs: Number(((cpu.user + cpu.system) / 1_000).toFixed(1)),
    cpuUsPerBuild: Number((((cpu.user + cpu.system) / ITERATIONS)).toFixed(2))
  };
}

const incrementalChars = enriched[1].content.length - plain[1].content.length;
console.log(JSON.stringify({
  noEgress: true,
  providerCalls: 0,
  reportChars: research?.text.length ?? 0,
  maxReportChars: 2_200,
  citations: research?.citations.length ?? 0,
  maxCitations: 3,
  maxCitationChars: 200,
  promptCharsWithoutResearch: plain[1].content.length,
  promptCharsWithMaxResearch: enriched[1].content.length,
  incrementalPromptChars: incrementalChars,
  estimatedAdditionalTokensAt8CharsEach: Math.ceil(incrementalChars / 8),
  warmupIterations: WARMUP,
  measuredIterations: ITERATIONS,
  withoutResearch: measure(false),
  withResearch: measure(true)
}, null, 2));
