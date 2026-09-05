import { useEffect, useRef } from 'react'

/*
 * FLUID BACKDROP — an interactive WebGL2 fluid for the Start screen.
 * ---------------------------------------------------------------------------
 * Requested: the first page a new user sees (the one with the Start button)
 * should no longer be a starfield — it should look like a fluid playground,
 * WITHOUT the source site's branding, and the colours should shift as the
 * user moves a finger / cursor over the screen. And it must not make the app
 * feel slower.
 *
 * ─── WHAT IT IS ────────────────────────────────────────────────────────────
 * A self-contained Navier–Stokes dye simulation (velocity advection,
 * divergence → pressure projection, vorticity confinement, dye advection and
 * an additive paint pass). It is the same algorithm family as the well-known
 * MIT-licensed WebGL fluid playgrounds, written from scratch for this screen.
 * There is no logo, text, or watermark anywhere: only paint.
 *
 * ─── WHY THE SPEED GUARANTEE HOLDS ─────────────────────────────────────────
 * The whole sim lives INSIDE the Splash and dies with it:
 *   • It mounts only while the Start screen is shown — a few seconds, once,
 *     for someone who has not onboarded. The moment the user taps Start the
 *     screen unmounts: the rAF loop stops, the pointer listeners detach and
 *     the GL resources are deleted with the canvas. Nothing keeps running
 *     behind Welcome/Onboarding/the app.
 *   • It refuses to run at all when the OS asks for reduced motion (which
 *     Android's battery saver forces) or when WebGL2 + float render targets
 *     are missing — in both cases the caller falls back to the static galaxy.
 *   • Internal resolution is modest (SIM ≈ 96px short side, DYE scaled down
 *     further on low-end devices), DPR is capped at 2, and the loop pauses
 *     whenever the document is hidden.
 *   • The scene only animates on the GPU; the CPU does one tiny blit per
 *     splat and no per-frame array churn of consequence.
 *
 * Heavier than the starfield on purpose — but only for the seconds the user
 * is looking at it, and never again after. That is the difference between a
 * splash costing battery while the user reads Start, and costing it forever.
 */

// ---------------------------------------------------------------------------
// License note: the shader math follows the public, MIT-licensed
// WebGL-Fluid-Simulation technique (P. Dobryakov), re-implemented and
// re-tuned here for this app's splash. MIT license text:
//
//   MIT License
//   Copyright (c) 2019 Pavel Dobryakov
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software...
// ---------------------------------------------------------------------------

const VERT_SRC = `
  precision highp float;
  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 uTexelSize;
  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(uTexelSize.x, 0.0);
    vR = vUv + vec2(uTexelSize.x, 0.0);
    vT = vUv + vec2(0.0, uTexelSize.y);
    vB = vUv - vec2(0.0, uTexelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const CLEAR_FRAG = `
  precision highp float;
  uniform vec4 uColor;
  void main () {
    gl_FragColor = uColor;
  }
`

/* Additive paint: writes splat * gaussian, blended ONE+ONE onto the target,
   so paint accumulates without ever reading the texture it is drawing into. */
const SPLAT_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uPoint;
  uniform vec3 uColor;
  uniform float uAspect;
  uniform float uRadius;
  void main () {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
    gl_FragColor = vec4(splat, 1.0);
  }
`

const ADVECT_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 uTexelSize;     // texel size of the VELOCITY grid
  uniform vec2 uDyeTexelSize;  // texel size of the sampled source grid
  uniform float uDt;
  uniform float uDissipation;
  vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
  }
  void main () {
    vec2 coord = vUv - uDt * bilerp(uVelocity, vUv, uTexelSize).xy * uTexelSize;
    vec4 result = bilerp(uSource, coord, uDyeTexelSize);
    float decay = 1.0 + uDissipation * uDt;
    gl_FragColor = result / decay;
  }
`

const DIVERGENCE_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) L = -C.x;
    if (vR.x > 1.0) R = -C.x;
    if (vT.y > 1.0) T = -C.y;
    if (vB.y < 0.0) B = -C.y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`

const CURL_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`

const VORTICITY_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform float uCurl;
  uniform float uDt;
  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = abs(R - L - T + B);
    vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
    force *= 1.0 / (length(force) + 0.0001);
    force *= vorticity * uCurl * uDt;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    gl_FragColor = vec4(velocity + force, 0.0, 1.0);
  }
`

const PRESSURE_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`

const GRADIENT_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`

/* Paint → screen. Velocities give the paint a subtle "wet light" sheen and
   curl highlights, which is most of what makes a fluid read as fluid rather
   than as smeared ink. Two things make the colour feel ALIVE: a slow hue
   cycle that keeps shifting even when the paint has settled, and a filmic
   soft knee so overlapping thin strokes saturate to vivid colour instead of
   clipping to white. No vignette here — a CSS overlay handles legibility so
   the two can be tuned independently per theme. */
const DISPLAY_FRAG = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uDye;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  uniform float uTime;
  void main () {
    vec3 dye = texture2D(uDye, vUv).rgb;
    /* Slow hue rotation (~5°/s): resting swirls keep changing colour, so the
       screen never feels like a frozen poster. Luminance-preserving matrix
       (Hoskins), so bright paint stays bright while the hue drifts. */
    float c = cos(uTime * 0.09);
    float s = sin(uTime * 0.09);
    mat3 hr = mat3(
      vec3(0.299 + 0.701*c + 0.168*s, 0.299 - 0.701*c - 0.168*s, 0.299 - 0.700*c + 1.168*s),
      vec3(0.299 - 0.299*c + 0.330*s, 0.299 + 0.299*c + 0.330*s, 0.299 - 0.299*c - 0.330*s),
      vec3(0.299 - 0.300*c - 0.497*s, 0.299 - 0.300*c + 1.497*s, 0.299 + 0.300*c - 0.497*s)
    );
    dye = clamp(hr * dye, 0.0, 1.0);
    float lum = dot(dye, vec3(0.299, 0.587, 0.114));
    vec3 col = dye * (0.9 + lum * 0.55);
    vec2 vel = texture2D(uVelocity, vUv).xy;
    float Lv = texture2D(uVelocity, vL).y;
    float Rv = texture2D(uVelocity, vR).y;
    float Tv = texture2D(uVelocity, vT).x;
    float Bv = texture2D(uVelocity, vB).x;
    float spin = Rv - Lv - Tv + Bv;
    col += vec3(0.85, 0.92, 1.0) * smoothstep(0.3, 1.4, abs(spin)) * 0.16;
    /* Soft knee: thin strokes stack additively fast, so map the tail off with
       a filmic curve — saturated colour stays saturated. */
    col = 1.0 - exp(-col * 1.35);
    gl_FragColor = vec4(col, 1.0);
  }
`

/* Cheap HSL→RGB for the paint hues; used a handful of times per frame at most. */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return [r + m, g + m, b + m]
}

const NOISE = () => Math.random()

/* One-time capability probe. Also refuses reduced motion: on Android, battery
   saver forces `prefers-reduced-motion`, and a GPU loop there is exactly the
   wrong trade — the starfield fallback already renders static in that case. */
export function fluidSupported() {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false })
    if (!gl) return false
    const ok = Boolean(gl.getExtension('EXT_color_buffer_float'))
    const lose = gl.getExtension('WEBGL_lose_context')
    if (lose) lose.loseContext()
    return ok
  } catch {
    return false
  }
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'unknown error'
    gl.deleteShader(sh)
    throw new Error(`FluidBackdrop shader error: ${log}`)
  }
  return sh
}

function createProgram(gl, vs, fs) {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs)
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs)
  const p = gl.createProgram()
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  // Keep the quad attribute at location 0 so one attrib setup serves all passes.
  gl.bindAttribLocation(p, 0, 'aPosition')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) || 'unknown error'
    throw new Error(`FluidBackdrop program error: ${log}`)
  }
  gl.deleteShader(v)
  gl.deleteShader(f)
  return p
}

function makeProgram(gl, vs, fs, uniformNames) {
  const prog = createProgram(gl, vs, fs)
  const loc = {}
  for (const name of uniformNames) loc[name] = gl.getUniformLocation(prog, name)
  return { prog, loc }
}

function makeFbo(gl, w, h) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
  const fb = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { tex, fb, w, h }
}

/* Resolution for a given short-side target, matching the canvas aspect. */
function aspectRes(shortSide, w, h) {
  const aspect = Math.max(w, h) / Math.min(w, h)
  if (w >= h) return { w: Math.round(shortSide * aspect), h: shortSide }
  return { w: shortSide, h: Math.round(shortSide * aspect) }
}

function lowEndDevice() {
  if (typeof navigator === 'undefined') return false
  const cores = navigator.hardwareConcurrency || 8
  const mem = navigator.deviceMemory || 8
  const smallPhone = navigator.maxTouchPoints > 0 && window.innerWidth < 430
  return cores <= 4 || mem <= 4 || smallPhone
}

class FluidEngine {
  constructor(canvas) {
    this.canvas = canvas
    this.pointerMap = new Map()
    this.splatQueue = []
    this.hueCursor = 200 // start cyan-ish, advances with every gesture
    this.rafId = 0
    this.lastTime = 0
    this.elapsed = 0 // seconds since start; drives the display hue cycle
    this.ambientTimer = 0
    this.ambientGap = 1.2
    this.alive = true
    this.boundHandlers = null

    const gl = canvas.getContext('webgl2', {
      antialias: false, depth: false, stencil: false, alpha: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance'
    })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      if (gl) {
        const lose = gl.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
      }
      this.gl = null
      return
    }
    this.gl = gl
    this.ok = true

    const lowEnd = lowEndDevice()
    // Dye resolution sets how crisp the painted LINES read: thin strokes
    // alias and smear if the dye grid is too coarse, so it is a notch higher
    // than the old blob-tuned values. Still a few hundred px, not screen res.
    const dyeShort = lowEnd ? 320 : window.innerWidth >= 900 ? 640 : 512
    const simShort = lowEnd ? 64 : 96

    this.dyeShort = dyeShort
    this.simShort = simShort

    this.quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

    this.clearProg = makeProgram(gl, VERT_SRC, CLEAR_FRAG, ['uColor'])
    this.splatProg = makeProgram(gl, VERT_SRC, SPLAT_FRAG, ['uPoint', 'uColor', 'uAspect', 'uRadius'])
    this.advectProg = makeProgram(gl, VERT_SRC, ADVECT_FRAG, [
      'uVelocity', 'uSource', 'uTexelSize', 'uDyeTexelSize', 'uDt', 'uDissipation'
    ])
    this.divergenceProg = makeProgram(gl, VERT_SRC, DIVERGENCE_FRAG, ['uVelocity'])
    this.curlProg = makeProgram(gl, VERT_SRC, CURL_FRAG, ['uVelocity'])
    this.vorticityProg = makeProgram(gl, VERT_SRC, VORTICITY_FRAG, ['uVelocity', 'uCurl', 'uDt'])
    this.pressureProg = makeProgram(gl, VERT_SRC, PRESSURE_FRAG, ['uPressure', 'uDivergence'])
    this.gradientProg = makeProgram(gl, VERT_SRC, GRADIENT_FRAG, ['uPressure', 'uVelocity'])
    this.displayProg = makeProgram(gl, VERT_SRC, DISPLAY_FRAG, ['uDye', 'uVelocity', 'uTexelSize', 'uTime'])
    this.programList = [
      this.clearProg.prog, this.splatProg.prog, this.advectProg.prog,
      this.divergenceProg.prog, this.curlProg.prog, this.vorticityProg.prog,
      this.pressureProg.prog, this.gradientProg.prog, this.displayProg.prog
    ]
    this.fboList = []

    this.resize()

    // Tuning — deliberate, and retuned for the THIN-STROKE look (small
    // splats, "zoomed-out" lines) instead of big blobs:
    //   • dye still fades over a couple of seconds so a held finger cannot
    //     flood the screen — but a little slower so the painted line lingers
    //     long enough to read as a line, not a flicker;
    //   • velocity decays slowly so the hand's motion keeps travelling
    //     through the paint after the finger stops;
    //   • vorticity is on the strong side so swirls are an obvious,
    //     mesmerising feature of the motion rather than a hint.
    this.dyeDissipation = 0.72
    this.velDissipation = 0.2
    this.curlStrength = 30
    this.pressureIterations = 14

    // Stroke geometry — the heart of the "line, not blob" look. The radius
    // is the Gaussian exponent in UV², so the visible stroke width is
    // ~2*sqrt(radius) UV: 0.006 → a ~15%-of-screen-wide ribbon on a phone,
    // continuous because onMove interpolates every pixel of the path.
    this.strokeRadius = 0.006
    this.tapRadius = 0.014
  }

  resize() {
    const gl = this.gl
    if (!gl) return
    // Release the previous field buffers first (a rotate/resize keeps the
    // same engine but needs new grid dimensions).
    for (const f of this.fboList) {
      gl.deleteTexture(f.tex)
      gl.deleteFramebuffer(f.fb)
    }
    this.fboList = []
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = this.canvas.clientWidth || window.innerWidth
    const cssH = this.canvas.clientHeight || window.innerHeight
    const w = Math.max(2, Math.round(cssW * dpr))
    const h = Math.max(2, Math.round(cssH * dpr))
    this.canvas.width = w
    this.canvas.height = h

    const dyeRes = aspectRes(this.dyeShort, w, h)
    const simRes = aspectRes(this.simShort, w, h)

    this.dyeRes = dyeRes
    this.simRes = simRes
    this.dyeTexel = [1 / dyeRes.w, 1 / dyeRes.h]
    this.simTexel = [1 / simRes.w, 1 / simRes.h]

    const track = (f) => {
      this.fboList.push(f)
      return f
    }
    this.dye = [track(makeFbo(gl, dyeRes.w, dyeRes.h)), track(makeFbo(gl, dyeRes.w, dyeRes.h))]
    this.vel = [track(makeFbo(gl, simRes.w, simRes.h)), track(makeFbo(gl, simRes.w, simRes.h))]
    this.divergence = track(makeFbo(gl, simRes.w, simRes.h))
    this.curl = track(makeFbo(gl, simRes.w, simRes.h))
    this.pressure = [track(makeFbo(gl, simRes.w, simRes.h)), track(makeFbo(gl, simRes.w, simRes.h))]
    this.dyeIdx = 0
    this.velIdx = 0
    this.pressureIdx = 0

    // Blank every field so the first frame starts from black, not garbage.
    this.clearTo(this.dye[0], [0, 0, 0, 1])
    this.clearTo(this.dye[1], [0, 0, 0, 1])
    this.clearTo(this.vel[0], [0, 0, 0, 1])
    this.clearTo(this.vel[1], [0, 0, 0, 1])

    this.burst()
  }

  clearTo(fbo, rgba) {
    const gl = this.gl
    gl.disable(gl.BLEND)
    const p = this.clearProg
    gl.useProgram(p.prog)
    gl.uniform4fv(p.loc.uColor, rgba)
    this.bindQuad()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb)
    gl.viewport(0, 0, fbo.w, fbo.h)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  bindQuad() {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  drawTo(fbo, p) {
    const gl = this.gl
    gl.useProgram(p.prog)
    this.bindQuad()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb)
    gl.viewport(0, 0, fbo.w, fbo.h)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  drawScreen(p) {
    const gl = this.gl
    gl.useProgram(p.prog)
    this.bindQuad()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /* Additive splat: no texture read, so blending ONE+ONE is mathematically the
     same as "existing paint + gaussian" without a feedback loop. */
  splat(fbo, x, y, color3, radius) {
    const gl = this.gl
    const p = this.splatProg
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(p.prog)
    gl.uniform2f(p.loc.uPoint, x, y)
    gl.uniform3fv(p.loc.uColor, color3)
    gl.uniform1f(p.loc.uAspect, this.canvas.width / this.canvas.height)
    gl.uniform1f(p.loc.uRadius, radius)
    this.bindQuad()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb)
    gl.viewport(0, 0, fbo.w, fbo.h)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.disable(gl.BLEND)
  }

  advect(dstFbo, srcFbo, velFbo, dt, dissipation) {
    const gl = this.gl
    const p = this.advectProg
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, velFbo.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, srcFbo.tex)
    gl.useProgram(p.prog)
    gl.uniform1i(p.loc.uVelocity, 0)
    gl.uniform1i(p.loc.uSource, 1)
    gl.uniform2fv(p.loc.uTexelSize, this.simTexel)
    gl.uniform2fv(p.loc.uDyeTexelSize, [1 / srcFbo.w, 1 / srcFbo.h])
    gl.uniform1f(p.loc.uDt, dt)
    gl.uniform1f(p.loc.uDissipation, dissipation)
    this.drawTo(dstFbo, p)
  }

  computeDivergence() {
    const gl = this.gl
    const p = this.divergenceProg
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.vel[this.velIdx].tex)
    gl.useProgram(p.prog)
    gl.uniform1i(p.loc.uVelocity, 0)
    this.drawTo(this.divergence, p)
  }

  computeCurl() {
    const gl = this.gl
    const p = this.curlProg
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.vel[this.velIdx].tex)
    gl.useProgram(p.prog)
    gl.uniform1i(p.loc.uVelocity, 0)
    this.drawTo(this.curl, p)
  }

  applyVorticity(dt) {
    const gl = this.gl
    const p = this.vorticityProg
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.vel[this.velIdx].tex)
    gl.useProgram(p.prog)
    gl.uniform1i(p.loc.uVelocity, 0)
    gl.uniform1f(p.loc.uCurl, this.curlStrength)
    gl.uniform1f(p.loc.uDt, dt)
    const dst = this.vel[this.velIdx ^ 1]
    this.drawTo(dst, p)
    this.velIdx ^= 1
  }

  solvePressure() {
    const gl = this.gl
    gl.disable(gl.BLEND)
    this.clearTo(this.pressure[0], [0, 0, 0, 1])
    this.clearTo(this.pressure[1], [0, 0, 0, 1])
    this.pressureIdx = 0
    const p = this.pressureProg
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.divergence.tex)
    for (let i = 0; i < this.pressureIterations; i++) {
      const src = this.pressure[this.pressureIdx]
      const dst = this.pressure[this.pressureIdx ^ 1]
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.useProgram(p.prog)
      gl.uniform1i(p.loc.uPressure, 0)
      gl.uniform1i(p.loc.uDivergence, 1)
      this.drawTo(dst, p)
      this.pressureIdx ^= 1
    }
  }

  subtractGradient() {
    const gl = this.gl
    const p = this.gradientProg
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.pressure[this.pressureIdx].tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.vel[this.velIdx].tex)
    gl.useProgram(p.prog)
    gl.uniform1i(p.loc.uPressure, 0)
    gl.uniform1i(p.loc.uVelocity, 1)
    const dst = this.vel[this.velIdx ^ 1]
    this.drawTo(dst, p)
    this.velIdx ^= 1
  }

  display() {
    const gl = this.gl
    const p = this.displayProg
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.dye[this.dyeIdx].tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.vel[this.velIdx].tex)
    gl.useProgram(p.prog)
    gl.uniform1i(p.loc.uDye, 0)
    gl.uniform1i(p.loc.uVelocity, 1)
    gl.uniform2fv(p.loc.uTexelSize, this.dyeTexel)
    gl.uniform1f(p.loc.uTime, this.elapsed)
    this.drawScreen(p)
  }

  /* A starting wash so the screen is already colourful before the first
     touch. Deliberately a field of SMALL wisps, not a few giant blobs —
     six 0.3-radius blobs read as a zoomed-in photo of paint, while a scatter
     of thin streaks reads as a zoomed-out view of the same fluid: you see
     the whole surface at once, and the drift below keeps it breathing.
     Placed so none sits under the wordmark (roughly uv 0.35–0.65 × 0.3–0.7). */
  burst() {
    const spots = [
      [0.16, 0.24, 198, 0.034],
      [0.34, 0.12, 212, 0.024],
      [0.58, 0.16, 232, 0.028],
      [0.84, 0.2, 272, 0.032],
      [0.88, 0.5, 300, 0.022],
      [0.72, 0.84, 324, 0.034],
      [0.46, 0.9, 342, 0.026],
      [0.18, 0.68, 240, 0.03],
      [0.08, 0.42, 186, 0.024]
    ]
    for (const [x, y, hue, rad] of spots) {
      const rgb = hslToRgb(hue, 0.95, 0.6).map((v) => v * 0.45)
      this.splat(this.dye[this.dyeIdx ^ 1], x, y, rgb, rad)
      this.splat(this.dye[this.dyeIdx], x, y, rgb, rad)
      // A little initial stirring so the wash is alive, not a poster — a slow
      // drift outwards from centre, converted to sim-texels/s per axis. The
      // velocity splat is a touch wider than the dye so the whole wisp moves.
      const ux = (0.5 - x) * 0.22
      const uy = (y - 0.5) * 0.22
      this.splat(this.vel[this.velIdx], x, y, [ux * this.simRes.w, uy * this.simRes.h, 0], rad * 1.6)
    }
  }

  paintSplat(s) {
    const viewW = window.innerWidth || 1
    const viewH = window.innerHeight || 1
    const dtEv = Math.max(s.dt, 0.001)
    // Finger velocity in uv/s. The sim stores velocity in sim-texels/s (the
    // advection shader converts back with uTexelSize), so multiply per axis
    // by that grid's texel count.
    let vx = (s.dx / viewW / dtEv) * this.simRes.w
    let vy = (-s.dy / viewH / dtEv) * this.simRes.h
    const speed = Math.hypot(vx, vy)
    // Cap ~ a 6 uv/s flick (≈ a very fast swipe); beyond that reads as an
    // explosion, not a fluid.
    if (speed > 6 * Math.min(this.simRes.w, this.simRes.h)) {
      const k = (6 * Math.min(this.simRes.w, this.simRes.h)) / speed
      vx *= k
      vy *= k
    }
    // Thin strokes add their energy into a small area, so they need a higher
    // amplitude than the old wide blobs to read as vivid lines; the display
    // soft-knee keeps the overlap from clipping to white.
    const rgb = hslToRgb(s.hue, 0.95, 0.6)
    const dyeAmp = 0.62 * (dtEv / (1 / 60))
    const dye = [rgb[0] * dyeAmp, rgb[1] * dyeAmp, rgb[2] * dyeAmp]
    // A bit stronger than 1:1 so the hand's motion is the obvious driver of
    // the flow — the user should SEE the colour moving where the hand moved.
    const vel = [vx * 1.15, vy * 1.15, 0]

    // Splat into the buffer the upcoming advection reads (step() always
    // applies the queue before it advects), so the stroke lands on the
    // very next display frame. One write per field — writing both ping-pong
    // buffers doubled the draw cost for no visual difference, which matters
    // now that a stroke is many small splats, not one big one.
    this.splat(this.dye[this.dyeIdx], s.x, s.y, dye, s.radius)
    this.splat(this.vel[this.velIdx], s.x, s.y, vel, s.radius)
  }

  step(dt) {
    this.elapsed += dt
    // Interactivity splats queued by pointer events since the last frame.
    // The budget is per stroke-segment (a swipe of one frame can queue 10+
    // tiny splats); the surplus just waits one frame and the line stays
    // continuous.
    const budget = Math.min(this.splatQueue.length, 24)
    for (let i = 0; i < budget; i++) {
      const s = this.splatQueue[i]
      if (s.dyeOnly) {
        // Same reasoning as paintSplat: small radius needs a touch more
        // amplitude to read, and one write to the buffer the advection reads.
        const rgb = hslToRgb(s.hue, 0.92, 0.6)
        const dye = [rgb[0] * 0.55, rgb[1] * 0.55, rgb[2] * 0.55]
        this.splat(this.dye[this.dyeIdx], s.x, s.y, dye, s.radius)
      } else {
        this.paintSplat(s)
      }
    }
    if (budget > 0) this.splatQueue.splice(0, budget)

    // Gentle ambient drift so the scene keeps breathing when untouched.
    this.ambientTimer += dt
    if (this.ambientTimer > this.ambientGap) {
      this.ambientTimer = 0
      this.ambientGap = 1.2 + NOISE() * 1.2
      this.queueAmbient()
    }

    this.advect(this.vel[this.velIdx ^ 1], this.vel[this.velIdx], this.vel[this.velIdx], dt, this.velDissipation)
    this.velIdx ^= 1
    this.advect(this.dye[this.dyeIdx ^ 1], this.dye[this.dyeIdx], this.vel[this.velIdx], dt, this.dyeDissipation)
    this.dyeIdx ^= 1
    this.computeDivergence()
    this.computeCurl()
    this.applyVorticity(dt)
    this.solvePressure()
    this.subtractGradient()
    this.display()
  }

  queueAmbient() {
    const t = performance.now() / 1000
    const x = 0.5 + 0.38 * Math.sin(t * 0.21)
    const y = 0.62 + 0.3 * Math.sin(t * 0.17 + 1.7)
    const hue = (t * 9 + 200) % 360
    // Small wandering dye (matching the stroke scale), almost no velocity:
    // colour drifts rather than stirs, so untouched screen still shows fine
    // colour movement instead of one big smudge.
    this.splatQueue.push({
      x, y, dyeOnly: true, hue,
      radius: 0.022 + 0.012 * Math.sin(t * 0.5),
      dt: 0.016
    })
  }

  /* Pointer → uv mapping. GL uv has its origin at the bottom-left, so the
     clientY (top origin) has to be flipped. */
  pointerUV(e) {
    return [e.clientX / (window.innerWidth || 1), 1 - e.clientY / (window.innerHeight || 1)]
  }

  onDown(e) {
    if (!this.alive) return
    const id = e.pointerId !== undefined ? e.pointerId : 1
    const [x, y] = this.pointerUV(e)
    if (e.pointerType === 'mouse' && e.button !== 0) return
    this.hueCursor = (this.hueCursor + 41) % 360
    this.pointerMap.set(id, { x, y, hue: this.hueCursor, t: performance.now(), down: true })
    // A press with no drag still releases a dot of paint (thin, like the
    // stroke — a tap should read as a point on a line, not a balloon).
    this.splatQueue.push({ x, y, dyeOnly: true, hue: this.hueCursor, radius: this.tapRadius, dt: 0.016 })
  }

  onMove(e) {
    if (!this.alive) return
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) return
    const id = e.pointerId !== undefined ? e.pointerId : 1
    let p = this.pointerMap.get(id)
    if (!p) {
      // A mouse that started dragging outside the window; adopt it.
      const [x, y] = this.pointerUV(e)
      this.hueCursor = (this.hueCursor + 41) % 360
      p = { x, y, hue: this.hueCursor, t: performance.now(), down: true }
      this.pointerMap.set(id, p)
    }
    const [x, y] = this.pointerUV(e)
    const dx = (x - p.x) * (window.innerWidth || 1)
    const dy = -(y - p.y) * (window.innerHeight || 1) // uv y-up → css y-down
    const now = performance.now()
    const dt = Math.max((now - p.t) / 1000, 1 / 240)
    const dist = Math.hypot(dx, dy)
    if (dist > 0.4) {
      // Stitch the stroke together point by point so the paint reads as a
      // CONTINUOUS LINE at any speed — this is what a thin stroke needs,
      // because (unlike the old wide blobs) two 8-apart splats do not blend
      // on their own. Steps of ~8px keep the line unbroken even when
      // pointermove fires sparsely during a fast flick. The hue eases along
      // the stroke (~0.2°/px), so a moving hand visibly shifts the colour
      // as it paints — a short swipe is a visible rainbow.
      const steps = Math.min(Math.max(1, Math.round(dist / 8)), 10)
      const shift = (dist * 0.2) % 360
      for (let i = 0; i < steps; i++) {
        const f = (i + 1) / steps
        this.splatQueue.push({
          x: p.x + (x - p.x) * f,
          y: p.y + (y - p.y) * f,
          dx: dx / steps,
          dy: dy / steps,
          hue: (p.hue + shift * f) % 360,
          dt,
          radius: this.strokeRadius
        })
      }
      p.hue = (p.hue + shift) % 360
      p.x = x
      p.y = y
      p.t = now
    }
  }

  onUp(e) {
    const id = e.pointerId !== undefined ? e.pointerId : 1
    this.pointerMap.delete(id)
  }

  frame = (now) => {
    if (!this.alive) return
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 1 / 24) : 1 / 60
    this.lastTime = now
    if (dt > 0) {
      try {
        this.step(dt)
      } catch (err) {
        // Never let a shader hiccup take the Start screen down with it.
        if (window.console && console.error) console.error('FluidBackdrop frame error', err)
        this.stop()
        return
      }
    }
    this.rafId = requestAnimationFrame(this.frame)
  }

  attach() {
    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window
    const handlers = {}
    if (hasPointer) {
      handlers.down = (e) => this.onDown(e)
      handlers.move = (e) => {
        if (e.pointerType !== 'mouse' && e.cancelable) e.preventDefault()
        this.onMove(e)
      }
      handlers.up = (e) => this.onUp(e)
      window.addEventListener('pointerdown', handlers.down, { passive: true })
      window.addEventListener('pointermove', handlers.move, { passive: false })
      window.addEventListener('pointerup', handlers.up, { passive: true })
      window.addEventListener('pointercancel', handlers.up, { passive: true })
    } else {
      // Very old WebView fallback: touch + mouse.
      handlers.down = (e) => {
        const t = e.changedTouches ? e.changedTouches[0] : e
        this.onDown({ clientX: t.clientX, clientY: t.clientY, pointerId: e.changedTouches ? t.identifier : 1, pointerType: 'touch', button: 0 })
      }
      handlers.move = (e) => {
        if (e.cancelable) e.preventDefault()
        const t = e.changedTouches ? e.changedTouches[0] : e
        this.onMove({
          clientX: t.clientX, clientY: t.clientY,
          pointerId: e.changedTouches ? t.identifier : 1,
          pointerType: e.changedTouches ? 'touch' : 'mouse',
          buttons: e.changedTouches ? 1 : (e.buttons || 0)
        })
      }
      handlers.up = (e) => {
        const t = e.changedTouches ? e.changedTouches[0] : e
        this.onUp({ pointerId: e.changedTouches ? t.identifier : 1 })
      }
      window.addEventListener('touchstart', handlers.down, { passive: true })
      window.addEventListener('touchmove', handlers.move, { passive: false })
      window.addEventListener('touchend', handlers.up, { passive: true })
      window.addEventListener('mousedown', handlers.down, { passive: true })
      window.addEventListener('mousemove', handlers.move, { passive: false })
      window.addEventListener('mouseup', handlers.up, { passive: true })
    }
    handlers.vis = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.rafId)
        this.rafId = 0
      } else if (this.alive && !this.rafId) {
        this.lastTime = 0
        this.rafId = requestAnimationFrame(this.frame)
      }
    }
    handlers.resize = () => {
      if (!document.hidden) this.resize()
    }
    handlers.lost = (e) => {
      e.preventDefault()
      this.stop()
    }
    document.addEventListener('visibilitychange', handlers.vis)
    window.addEventListener('resize', handlers.resize)
    this.canvas.addEventListener('webglcontextlost', handlers.lost)
    this.boundHandlers = handlers
  }

  start() {
    if (!this.ok) return
    this.attach()
    this.lastTime = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop() {
    this.alive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
    if (this.boundHandlers) {
      const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window
      const h = this.boundHandlers
      if (hasPointer) {
        window.removeEventListener('pointerdown', h.down)
        window.removeEventListener('pointermove', h.move)
        window.removeEventListener('pointerup', h.up)
        window.removeEventListener('pointercancel', h.up)
      } else {
        window.removeEventListener('touchstart', h.down)
        window.removeEventListener('touchmove', h.move)
        window.removeEventListener('touchend', h.up)
        window.removeEventListener('mousedown', h.down)
        window.removeEventListener('mousemove', h.move)
        window.removeEventListener('mouseup', h.up)
      }
      document.removeEventListener('visibilitychange', h.vis)
      window.removeEventListener('resize', h.resize)
      if (this.canvas) this.canvas.removeEventListener('webglcontextlost', h.lost)
      this.boundHandlers = null
    }
    this.pointerMap.clear()
    this.splatQueue.length = 0
  }

  dispose() {
    this.stop()
    const gl = this.gl
    if (gl) {
      for (const f of this.fboList || []) {
        gl.deleteTexture(f.tex)
        gl.deleteFramebuffer(f.fb)
      }
      this.fboList = []
      for (const p of this.programList || []) gl.deleteProgram(p)
      this.programList = []
      if (this.quad) gl.deleteBuffer(this.quad)
    }
    this.gl = null
    this.ok = false
  }
}

export default function FluidBackdrop() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let engine = null
    try {
      engine = new FluidEngine(canvas)
      if (!engine.ok) {
        engine.dispose()
        return undefined
      }
      engine.start()
    } catch (err) {
      // A driver that chokes on a shader must never take the Start screen
      // down with it — the splash keeps its plain background and still works.
      if (engine) engine.dispose()
      if (window.console && console.error) console.error('FluidBackdrop init error', err)
      return undefined
    }
    return () => {
      engine.dispose()
    }
  }, [])

  return (
    <div className="fluid" aria-hidden="true">
      <canvas ref={canvasRef} className="fluid-canvas" />
      {/* Legibility overlay — the paint stays colourful centre-screen while
          the footer (Start + socials) gets a darker bed. Theme-aware in CSS. */}
      <div className="fluid-vignette" />
    </div>
  )
}
