/* UI contract: the Intent monitor form must send the SAME exact contract,
 * chain and metric that the user reviewed. A ticker or whale proxy is not an
 * adequate target. Also prove the existing PRICE draft remains usable. */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { fireEvent } from '@testing-library/react';
import { MonitorDraftForm } from '../src/components/IntentOpsPanels.jsx';

const TOKEN = `0x${'1'.repeat(40)}`;

export async function run(container) {
  const results = [];
  const test = (name, ok) => results.push([name, Boolean(ok)]);
  const root = createRoot(container);
  const created = [];
  const render = async (initial, key = 'initial') => {
    await act(async () => { root.render(<MonitorDraftForm key={key} open initial={initial}
      onCreate={(draft) => created.push(draft)} onClose={() => {}} locale="fa-IR" />); });
  };
  const submit = async () => {
    await act(async () => { fireEvent.submit(container.querySelector('form')); });
  };

  await render({ asset: { symbol: 'TEST' }, metric: 'SMART_MONEY_BUYERS',
    smartTarget: { chain: 1, token: TOKEN }, threshold: 3, intervalMinutes: 30 });
  test('all three verified metrics are offered alongside existing PRICE',
    ['PRICE', 'SMART_MONEY_BUYERS', 'SMART_MONEY_NET', 'SMART_MONEY_REVERSAL'].every((m) =>
      Boolean(container.querySelector(`option[value="${m}"]`))));
  test('exact chain and address visible for review',
    container.querySelector('input[placeholder="0x…"]')?.value === TOKEN &&
    container.querySelector('select option[value="1"]')?.textContent === 'Ethereum');
  await submit();
  test('buyers payload reaches server with qualified target and interval',
    created[0]?.metric === 'SMART_MONEY_BUYERS' && created[0]?.smartTarget?.token === TOKEN
    && created[0]?.smartTarget?.chain === 1 && created[0]?.threshold === 3 && created[0]?.intervalMinutes === 30);

  await render({ asset: { symbol: 'TEST' }, metric: 'SMART_MONEY_NET', operator: 'BELOW',
    threshold: -3000000, smartTarget: { chain: 1, token: TOKEN } }, 'negative');
  await submit();
  test('signed net-flow threshold does not silently turn into abs()',
    created[1]?.threshold === -3000000 && created[1]?.operator === 'BELOW');

  await render({ asset: { symbol: 'TEST' }, metric: 'SMART_MONEY_REVERSAL',
    threshold: 1, reversal: { fromUsd: 5000000, toUsd: -3000000 },
    smartTarget: { chain: 8453, token: TOKEN } }, 'reversal');
  test('reversal thresholds are separately editable',
    container.querySelector('input[placeholder="5000000"]')?.value === '5000000'
      && container.querySelector('input[placeholder="-3000000"]')?.value === '-3000000');
  await submit();
  test('reversal payload contains both signed thresholds and Base chain',
    created[2]?.reversal?.fromUsd === 5000000 && created[2]?.reversal?.toUsd === -3000000
      && created[2]?.smartTarget?.chain === 8453);

  await render({ asset: { symbol: 'TEST' }, metric: 'SMART_MONEY_BUYERS',
    threshold: 3, smartTarget: { chain: 1, token: '0xBAD' } }, 'bad-contract');
  await submit();
  test('invalid contract is rejected with a visible error and without creating a monitor',
    created.length === 3 && Boolean(container.querySelector('[role="alert"]')));

  await render({ asset: { symbol: 'BTC' }, metric: 'PRICE', threshold: 12345,
    operator: 'ABOVE' }, 'price');
  await submit();
  test('legacy PRICE monitor remains connected', created[3]?.metric === 'PRICE'
    && created[3]?.threshold === 12345 && created[3]?.asset?.symbol === 'BTC'
    && !created[3]?.smartTarget);

  await act(async () => root.unmount());
  return results;
}
