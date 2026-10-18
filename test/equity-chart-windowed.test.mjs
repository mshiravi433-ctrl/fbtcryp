import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchEquityChartWindowed,
  isDrawableSeries,
  isUsableSeries
} from '../src/lib/equityChart.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubWindows(windows) {
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://local.test');
    const days = Number(url.searchParams.get('days'));
    requests.push({ host: url.host, days });
    const prices = windows[days];
    if (!Array.isArray(prices)) return { ok: false, status: 503, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({ prices: prices.map((price, index) => [1_700_000_000_000 + index * 86_400_000, price]) })
    };
  };
  return requests;
}

const points = (count, base = 100) => Array.from({ length: count }, (_, index) => base + index * 0.5);

describe('tokenized equity charts draw only verified quotes', () => {
  it('draws a sparse measured line without treating it as a reliable analysis sample', () => {
    const sparse = [{ p: 102 }, { p: 103 }];
    assert.equal(isDrawableSeries(sparse), true);
    assert.equal(isUsableSeries(sparse), false);
    assert.equal(isDrawableSeries([{ p: 102 }, { p: 0 }]), false);
    assert.equal(isDrawableSeries([{ p: 102 }, { p: Infinity }]), false);
  });

  it('uses the first shorter window with enough real observations and reports its span', async () => {
    const requests = stubWindows({ 30: points(24, 80) });
    const result = await fetchEquityChartWindowed('window-test-30-days', 90);
    assert.equal(result.days, 30);
    assert.equal(result.series.length, 24);
    assert.deepEqual([...new Set(requests.map(({ days }) => days))], [90, 30]);
  });

  it('keeps the densest sparse real series when no window is long enough for analysis', async () => {
    const requests = stubWindows({ 30: points(3, 55), 14: points(6, 60) });
    const result = await fetchEquityChartWindowed('window-test-sparse', 90);
    assert.equal(result.days, 14);
    assert.equal(result.series.length, 6);
    assert.deepEqual([...new Set(requests.map(({ days }) => days))], [90, 30, 14]);
    assert.equal(isDrawableSeries(result.series), true);
    assert.equal(isUsableSeries(result.series), false);
  });

  it('returns an honest empty series if every source fails instead of inventing a flat chart', async () => {
    stubWindows({});
    const result = await fetchEquityChartWindowed('window-test-empty', 90);
    assert.deepEqual(result, { series: [], days: 90 });
  });
});
