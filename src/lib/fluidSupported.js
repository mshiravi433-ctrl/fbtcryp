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
