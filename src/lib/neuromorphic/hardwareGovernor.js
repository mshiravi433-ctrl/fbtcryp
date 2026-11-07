/**
 * FBT NEUROMORPHIC 2050 — PHASE 1: HARDWARE, BATTERY & THERMAL GOVERNOR
 * ===========================================================================
 * Budget local compute using available battery, visibility and latency signals.
 * Battery and temperature telemetry are not universally available; these guards
 * cannot guarantee that a device will not heat up or lose battery.
 *
 * Modes:
 *   · TURBO_SWARM   — WebGPU or >=4 cores, foreground, charging or >=55% battery:
 *                     Full LIF + Liquid ODE + Online R-STDP + K=4 Swarm Clones.
 *   · BALANCED_EDGE — Normal battery (>=28%), foreground:
 *                     Full LIF + Liquid ODE + Online R-STDP + light K=2 Clones.
 *   · ECO_SPARSE    — Low battery (<28%), hidden tab, <4 cores, or thermal lag:
 *                     Event-driven sparse spikes only; swarm clones paused.
 *   · PAUSED        — User explicitly paused on-device compute.
 */

export const GOVERNOR_MODES = Object.freeze({
  TURBO_SWARM: 'TURBO_SWARM',
  BALANCED_EDGE: 'BALANCED_EDGE',
  ECO_SPARSE: 'ECO_SPARSE',
  PAUSED: 'PAUSED'
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export async function readBatteryTelemetry() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
      const bat = await navigator.getBattery();
      if (bat) {
        return {
          supported: true,
          charging: Boolean(bat.charging),
          level: Number.isFinite(bat.level) ? clamp(Number(bat.level), 0, 1) : null
        };
      }
    }
  } catch {
    /* Battery Status API blocked or unsupported (Safari/Firefox) — honest null */
  }
  return { supported: false, charging: null, level: null };
}

export function readDeviceCapabilities({ webgpuAvailable = false, adapterLabel = null } = {}) {
  const cores = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
    ? Math.max(1, Number(navigator.hardwareConcurrency))
    : null;
  const memoryGb = typeof navigator !== 'undefined' && Number.isFinite(navigator.deviceMemory)
    ? Number(navigator.deviceMemory)
    : null;
  const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';

  return {
    webgpuAvailable: Boolean(webgpuAvailable),
    adapterLabel: adapterLabel || null,
    cpuCores: cores,
    memoryGb,
    tabVisible: visible
  };
}

/**
 * Pure policy evaluation for deterministic unit testing and runtime governance.
 */
export function evaluateGovernorPolicy({
  paused = false,
  swarmOptIn = true,
  webgpuAvailable = false,
  cpuCores = 4,
  memoryGb = null,
  batteryCharging = null,
  batteryLevel = null,
  tabVisible = true,
  emaTickMs = 0,
  computeMode = 'auto'
} = {}) {
  if (paused) {
    return {
      mode: GOVERNOR_MODES.PAUSED,
      allowInference: false,
      allowPlasticity: false,
      allowNeurogenesis: false,
      swarmCloneBudget: 0,
      maxReservoirNeurons: 96,
      reason: 'USER_PAUSED'
    };
  }

  // Thermal / frame-budget guard: if ticks exceed 18ms EMA, step down to ECO_SPARSE
  const thermalThrottle = Number.isFinite(emaTickMs) && emaTickMs > 18;
  const lowBattery = batteryCharging === false && batteryLevel !== null && batteryLevel < 0.28;
  const lowHardware = (cpuCores !== null && cpuCores <= 2 && !webgpuAvailable) || (memoryGb !== null && memoryGb < 2);

  if (!tabVisible || lowBattery || lowHardware || thermalThrottle || computeMode === 'eco') {
    return {
      mode: GOVERNOR_MODES.ECO_SPARSE,
      allowInference: tabVisible,
      allowPlasticity: false,
      allowNeurogenesis: false,
      swarmCloneBudget: 0,
      maxReservoirNeurons: 96,
      reason: !tabVisible
        ? 'TAB_BACKGROUND'
        : lowBattery
          ? 'LOW_BATTERY_GUARD'
          : thermalThrottle
            ? 'THERMAL_LATENCY_GUARD'
            : lowHardware ? 'LOW_POWER_CPU' : 'USER_ECO'
    };
  }

  const highPower =
    (webgpuAvailable || (cpuCores !== null && cpuCores >= 6)) &&
    (batteryCharging === true || (batteryLevel !== null && batteryLevel >= 0.55));

  if (highPower && computeMode !== 'balanced') {
    return {
      mode: GOVERNOR_MODES.TURBO_SWARM,
      allowInference: true,
      allowPlasticity: true,
      allowNeurogenesis: true,
      swarmCloneBudget: swarmOptIn ? 4 : 0,
      maxReservoirNeurons: 192,
      reason: webgpuAvailable ? 'WEBGPU_HIGH_PERF' : 'MULTICORE_HIGH_PERF'
    };
  }

  return {
    mode: GOVERNOR_MODES.BALANCED_EDGE,
    allowInference: true,
    allowPlasticity: true,
    allowNeurogenesis: true,
    swarmCloneBudget: swarmOptIn ? 2 : 0,
    maxReservoirNeurons: 144,
    reason: 'BALANCED_FOREGROUND'
  };
}

export function createHardwareGovernor({ paused = false, swarmOptIn = true, computeMode = 'auto' } = {}) {
  let state = {
    paused: Boolean(paused),
    swarmOptIn: Boolean(swarmOptIn),
    webgpuAvailable: false,
    adapterLabel: null,
    emaTickMs: 0,
    computeMode,
    environment: null
  };

  function recordTickDuration(ms) {
    const d = Math.max(0, Number(ms) || 0);
    state.emaTickMs = state.emaTickMs === 0 ? d : state.emaTickMs * 0.85 + d * 0.15;
  }

  function configure(patch = {}) {
    if (typeof patch.paused === 'boolean') state.paused = patch.paused;
    if (typeof patch.swarmOptIn === 'boolean') state.swarmOptIn = patch.swarmOptIn;
    if (typeof patch.webgpuAvailable === 'boolean') state.webgpuAvailable = patch.webgpuAvailable;
    if (patch.adapterLabel !== undefined) state.adapterLabel = patch.adapterLabel;
    if (['auto', 'eco', 'balanced'].includes(patch.computeMode)) state.computeMode = patch.computeMode;
    if (patch.environment && typeof patch.environment === 'object') state.environment = patch.environment;
  }

  async function evaluate() {
    const caps = readDeviceCapabilities({
      webgpuAvailable: state.webgpuAvailable,
      adapterLabel: state.adapterLabel
    });
    const localBattery = await readBatteryTelemetry();
    const environment = state.environment || {};
    const battery = environment.battery || localBattery;
    if (typeof environment.tabVisible === 'boolean') caps.tabVisible = environment.tabVisible;
    const policy = evaluateGovernorPolicy({
      paused: state.paused,
      swarmOptIn: state.swarmOptIn,
      webgpuAvailable: caps.webgpuAvailable,
      cpuCores: caps.cpuCores,
      memoryGb: caps.memoryGb,
      batteryCharging: battery.charging,
      batteryLevel: battery.level,
      tabVisible: caps.tabVisible,
      emaTickMs: state.emaTickMs,
      computeMode: state.computeMode
    });

    return {
      ...policy,
      hardware: {
        ...caps,
        batterySupported: battery.supported,
        batteryCharging: battery.charging,
        batteryPct: battery.level !== null ? Math.round(battery.level * 100) : null,
        emaTickMs: Number(state.emaTickMs.toFixed(2))
      }
    };
  }

  return {
    recordTickDuration,
    configure,
    evaluate
  };
}
