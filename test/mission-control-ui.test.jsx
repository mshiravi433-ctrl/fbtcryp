// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MissionControl from '../src/components/MissionControl.jsx';
import { missionApi } from '../src/lib/missionControlClient.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'fa' } }) }));
vi.mock('../src/lib/missionControlClient.js', () => ({
  missionApi: { status: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), command: vi.fn(), opportunities: vi.fn(), learning: vi.fn(), events: vi.fn(), emergency: vi.fn(), release: vi.fn() }
}));
const mission = { id: 'mis_1', goal: 'بررسی نهنگ‌های BTC', status: 'Completed', version: 3, created_at: Date.now(), plan: [{ id: 'smart_money' }, { id: 'final_judge' }], result: { costUsd: 0 }, error: null };
function ok(overrides = {}) {
  missionApi.status.mockResolvedValue({ enabled: true, worker: { running: true }, globalStop: false, cost: { chargedUsd: 0 }, ...overrides.status });
  missionApi.list.mockResolvedValue({ missions: overrides.missions ?? [mission] });
  missionApi.opportunities.mockResolvedValue({ opportunities: overrides.opportunities ?? [{ id: 'opp_1', instrument: 'crypto:base:0xabc', score: 72, risk: 'MODERATE', confidence: 0.61, evidenceIds: ['ev1'], signals: ['ACTIVE_VOLUME'], discoveredAt: Date.now(), kind: 'smart_money_flow' }] });
  missionApi.learning.mockResolvedValue({ metrics: [], policy: { version: 1 }, pending: 0 });
  missionApi.events.mockResolvedValue({ events: [{ seq: 1, type: 'mission.verified', created_at: Date.now() }] });
  missionApi.detail.mockResolvedValue({ mission, tasks: [{ id: 't1', agent_id: 'smart_money', status: 'completed', attempts: 1, max_attempts: 3 }], evidence: [{ id: 'ev1', source: 'DexScreener', status: 'verified', received_at: Date.now(), observed_at: Date.now(), raw_sha256: 'a'.repeat(64), verification: { ok: true } }] });
}
const mount = () => render(<MemoryRouter><MissionControl /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => '12345678-1234-4234-8234-123456789abc' }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Mission Control dashboard', () => {
  it('renders real server missions, opportunities and evidence without sample data', async () => {
    ok(); mount();
    await waitFor(() => expect(screen.getByText('بررسی نهنگ‌های BTC')).toBeTruthy());
    expect(screen.getByText('تکمیل‌شده')).toBeTruthy();
    expect(screen.getByText('crypto:base:0xabc')).toBeTruthy();
    expect(screen.getByText('مغز فعال')).toBeTruthy();
    fireEvent.click(screen.getByText('جزئیات'));
    await waitFor(() => expect(screen.getByText('DexScreener')).toBeTruthy());
    expect(screen.queryByText(/دادهٔ نمونه/)).toBeNull();
  });
  it('shows an honest outage instead of fabricating missions when the worker is unavailable', async () => {
    ok({ missions: [], opportunities: [] }); missionApi.status.mockRejectedValue(new Error('WORKER_UNAVAILABLE'));
    mount();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('WORKER_UNAVAILABLE'));
    expect(screen.getByText('هنوز مأموریتی ثبت نشده')).toBeTruthy();
    expect(screen.getByText('دادهٔ نمونه نمایش داده نمی‌شود.')).toBeTruthy();
  });
  it('submits a mission with an idempotency key and bounded model budget', async () => {
    ok({ missions: [] }); missionApi.create.mockResolvedValue({ mission: { ...mission, id: 'mis_new' } });
    mount();
    fireEvent.click(await screen.findByText('مأموریت جدید'));
    fireEvent.change(screen.getByPlaceholderText(/جریان نهنگ/), { target: { value: 'بررسی جریان نهنگ BTC' } });
    fireEvent.click(screen.getByText('ثبت و ارسال به کارگر'));
    await waitFor(() => expect(missionApi.create).toHaveBeenCalled());
    const body = missionApi.create.mock.calls[0][0];
    expect(body.goal).toBe('بررسی جریان نهنگ BTC'); expect(body.idempotencyKey).toBe('12345678-1234-4234-8234-123456789abc'); expect(body.permissions.maxModelUsd).toBe(0.02);
  });
});
