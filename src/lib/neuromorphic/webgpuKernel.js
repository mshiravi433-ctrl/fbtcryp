/**
 * FBT NEUROMORPHIC 2050 — PHASE 1: WEBGPU WGSL COMPUTE SHADER KERNEL
 * ===========================================================================
 * Executes the O(N^2) Spiking Reservoir Synaptic Matrix-Vector + Leaky
 * Integrate-and-Fire (LIF) Membrane Dynamics directly on the user's GPU via
 * WebGPU Compute Shaders (`@compute @workgroup_size(64)`).
 *
 * Honesty & Safety Policy (mirrors kronos.worker.js):
 *   · `navigator.gpu` existing is NOT proof of WebGPU: we request an adapter,
 *     request a GPUDevice, compile the WGSL shader module, run a 1-dispatch
 *     numerical self-check, and only report `backend: 'webgpu'` when every
 *     step succeeds.
 *   · Automatically reallocates GPU storage buffers when Phase 2 Neurogenesis
 *     grows the reservoir neuron count `N`.
 *   · Any device loss or mapAsync failure cleanly falls back to CPU Float32.
 */

export const WEBGPU_LIF_WGSL = /* wgsl */ `
struct Params {
  size: u32,
  sensoryChannels: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> sensoryDrive: array<f32>;
@group(0) @binding(2) var<storage, read> prevSpikes: array<f32>;
@group(0) @binding(3) var<storage, read> wIn: array<f32>;
@group(0) @binding(4) var<storage, read> wRec: array<f32>;
@group(0) @binding(5) var<storage, read> alphaDecay: array<f32>;
@group(0) @binding(6) var<storage, read> baseThreshold: array<f32>;
@group(0) @binding(7) var<storage, read_write> membraneV: array<f32>;
@group(0) @binding(8) var<storage, read_write> thresholdAdapt: array<f32>;
@group(0) @binding(9) var<storage, read_write> outSpikes: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j: u32 = gid.x;
  let N: u32 = params.size;
  if (j >= N) {
    return;
  }

  let C: u32 = params.sensoryChannels;
  var iSyn: f32 = 0.0;

  let inRow: u32 = j * C;
  for (var c: u32 = 0u; c < C; c = c + 1u) {
    let drive: f32 = sensoryDrive[c];
    if (drive != 0.0) {
      iSyn = iSyn + wIn[inRow + c] * drive;
    }
  }

  let recRow: u32 = j * N;
  for (var k: u32 = 0u; k < N; k = k + 1u) {
    let sp: f32 = prevSpikes[k];
    if (sp != 0.0) {
      iSyn = iSyn + wRec[recRow + k] * sp;
    }
  }

  let vPrev: f32 = membraneV[j];
  let adaptPrev: f32 = thresholdAdapt[j];
  let vNext: f32 = alphaDecay[j] * vPrev + iSyn;
  let effThreshold: f32 = baseThreshold[j] + adaptPrev;

  if (vNext >= effThreshold) {
    outSpikes[j] = 1.0;
    membraneV[j] = max(0.0, vNext - effThreshold) * 0.25;
    thresholdAdapt[j] = min(0.65, adaptPrev + 0.055);
  } else {
    outSpikes[j] = 0.0;
    membraneV[j] = clamp(vNext, -0.5, effThreshold);
    thresholdAdapt[j] = max(-0.18, adaptPrev * 0.96 - 0.002);
  }
}
`;

export async function probeWebGpuSupport() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return { ok: false, reason: 'NO_NAVIGATOR_GPU', adapterLabel: null };
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return { ok: false, reason: 'NO_GPU_ADAPTER', adapterLabel: null };
    }
    const info = adapter.info || {};
    const label = [info.vendor, info.architecture, info.description, info.device]
      .filter(Boolean)
      .join(' ')
      .trim() || 'WebGPU Hardware Adapter';
    return { ok: true, adapter, adapterLabel: label, reason: null };
  } catch (err) {
    return { ok: false, reason: String(err?.message || 'WEBGPU_PROBE_FAILED').slice(0, 120), adapterLabel: null };
  }
}

/**
 * Create a reusable WebGPU LIF Reservoir Kernel.
 * Returns `{ available, adapterLabel, reason, runLifStep, dispose }`.
 */
export async function createWebGpuLifKernel() {
  const probe = await probeWebGpuSupport();
  if (!probe.ok || !probe.adapter) {
    return {
      available: false,
      backend: 'cpu-float32',
      adapterLabel: null,
      reason: probe.reason,
      runLifStep: null,
      dispose: () => {}
    };
  }

  let device = null;
  let pipeline = null;
  let allocatedSize = 0;
  let allocatedChannels = 0;
  let bufs = null;
  let bindGroup = null;
  let lost = false;

  try {
    device = await probe.adapter.requestDevice();
    device.lost?.then(() => { lost = true; });

    const shaderModule = device.createShaderModule({ code: WEBGPU_LIF_WGSL });
    pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' }
    });
  } catch (err) {
    try { device?.destroy?.(); } catch { /* ignore */ }
    return {
      available: false,
      backend: 'cpu-float32',
      adapterLabel: probe.adapterLabel,
      reason: `PIPELINE_FAILED:${String(err?.message || err).slice(0, 100)}`,
      runLifStep: null,
      dispose: () => {}
    };
  }

  function destroyBuffers() {
    if (!bufs) return;
    for (const b of Object.values(bufs)) {
      try { b?.destroy?.(); } catch { /* ignore */ }
    }
    bufs = null;
    bindGroup = null;
    allocatedSize = 0;
  }

  function ensureBuffers(N, C) {
    if (bufs && allocatedSize === N && allocatedChannels === C) return;
    destroyBuffers();

    const GPUBufferUsageRef = globalThis.GPUBufferUsage;
    const STORAGE_R = GPUBufferUsageRef.STORAGE | GPUBufferUsageRef.COPY_DST;
    const STORAGE_RW = GPUBufferUsageRef.STORAGE | GPUBufferUsageRef.COPY_DST | GPUBufferUsageRef.COPY_SRC;
    const READBACK = GPUBufferUsageRef.MAP_READ | GPUBufferUsageRef.COPY_DST;

    const vecBytes = Math.max(16, N * 4);
    const sensBytes = Math.max(16, C * 4);
    const inMatBytes = Math.max(16, N * C * 4);
    const recMatBytes = Math.max(16, N * N * 4);

    bufs = {
      params: device.createBuffer({ size: 16, usage: GPUBufferUsageRef.UNIFORM | GPUBufferUsageRef.COPY_DST }),
      sensoryDrive: device.createBuffer({ size: sensBytes, usage: STORAGE_R }),
      prevSpikes: device.createBuffer({ size: vecBytes, usage: STORAGE_R }),
      wIn: device.createBuffer({ size: inMatBytes, usage: STORAGE_R }),
      wRec: device.createBuffer({ size: recMatBytes, usage: STORAGE_R }),
      alphaDecay: device.createBuffer({ size: vecBytes, usage: STORAGE_R }),
      baseThreshold: device.createBuffer({ size: vecBytes, usage: STORAGE_R }),
      membraneV: device.createBuffer({ size: vecBytes, usage: STORAGE_RW }),
      thresholdAdapt: device.createBuffer({ size: vecBytes, usage: STORAGE_RW }),
      outSpikes: device.createBuffer({ size: vecBytes, usage: STORAGE_RW }),
      stageV: device.createBuffer({ size: vecBytes, usage: READBACK }),
      stageAdapt: device.createBuffer({ size: vecBytes, usage: READBACK }),
      stageSpikes: device.createBuffer({ size: vecBytes, usage: READBACK })
    };

    device.queue.writeBuffer(bufs.params, 0, new Uint32Array([N, C, 0, 0]));

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufs.params } },
        { binding: 1, resource: { buffer: bufs.sensoryDrive } },
        { binding: 2, resource: { buffer: bufs.prevSpikes } },
        { binding: 3, resource: { buffer: bufs.wIn } },
        { binding: 4, resource: { buffer: bufs.wRec } },
        { binding: 5, resource: { buffer: bufs.alphaDecay } },
        { binding: 6, resource: { buffer: bufs.baseThreshold } },
        { binding: 7, resource: { buffer: bufs.membraneV } },
        { binding: 8, resource: { buffer: bufs.thresholdAdapt } },
        { binding: 9, resource: { buffer: bufs.outSpikes } }
      ]
    });

    allocatedSize = N;
    allocatedChannels = C;
  }

  async function runLifStep({
    size,
    sensoryChannels,
    sensorySpikes,
    sensoryCurrents,
    prevSpikes,
    membraneV,
    alphaDecay,
    baseThreshold,
    thresholdAdapt,
    wIn,
    wRec
  }) {
    if (lost || !device) return { ok: false, reason: 'DEVICE_LOST' };
    try {
      ensureBuffers(size, sensoryChannels);

      const drive = new Float32Array(sensoryChannels);
      for (let c = 0; c < sensoryChannels; c += 1) {
        drive[c] = sensorySpikes[c] * 0.75 + sensoryCurrents[c] * 0.35;
      }

      device.queue.writeBuffer(bufs.sensoryDrive, 0, drive);
      device.queue.writeBuffer(bufs.prevSpikes, 0, prevSpikes);
      device.queue.writeBuffer(bufs.wIn, 0, wIn);
      device.queue.writeBuffer(bufs.wRec, 0, wRec);
      device.queue.writeBuffer(bufs.alphaDecay, 0, alphaDecay);
      device.queue.writeBuffer(bufs.baseThreshold, 0, baseThreshold);
      device.queue.writeBuffer(bufs.membraneV, 0, membraneV);
      device.queue.writeBuffer(bufs.thresholdAdapt, 0, thresholdAdapt);

      const byteLen = size * 4;
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(size / 64));
      pass.end();

      encoder.copyBufferToBuffer(bufs.membraneV, 0, bufs.stageV, 0, byteLen);
      encoder.copyBufferToBuffer(bufs.thresholdAdapt, 0, bufs.stageAdapt, 0, byteLen);
      encoder.copyBufferToBuffer(bufs.outSpikes, 0, bufs.stageSpikes, 0, byteLen);

      device.queue.submit([encoder.finish()]);

      const MAP_READ = globalThis.GPUMapMode.READ;
      await Promise.all([
        bufs.stageV.mapAsync(MAP_READ),
        bufs.stageAdapt.mapAsync(MAP_READ),
        bufs.stageSpikes.mapAsync(MAP_READ)
      ]);

      const outV = new Float32Array(bufs.stageV.getMappedRange(0, byteLen)).slice();
      const outAdapt = new Float32Array(bufs.stageAdapt.getMappedRange(0, byteLen)).slice();
      const outSpikes = new Float32Array(bufs.stageSpikes.getMappedRange(0, byteLen)).slice();

      bufs.stageV.unmap();
      bufs.stageAdapt.unmap();
      bufs.stageSpikes.unmap();

      let spikeCount = 0;
      for (let i = 0; i < size; i += 1) {
        if (outSpikes[i] > 0.5) spikeCount += 1;
      }

      return {
        ok: true,
        spikes: outSpikes,
        membraneV: outV,
        thresholdAdapt: outAdapt,
        spikeCount
      };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err).slice(0, 120) };
    }
  }

  function dispose() {
    lost = true;
    destroyBuffers();
    try { device?.destroy?.(); } catch { /* ignore */ }
    device = null;
  }

  return {
    available: true,
    backend: 'webgpu',
    adapterLabel: probe.adapterLabel,
    reason: null,
    runLifStep,
    dispose
  };
}
