# Only Vercel's production web build may enable the reviewed history surface.
# Preview/development/local builds fail closed. android:sync does not source
# this file and explicitly sets all three flags false before building.
# TP/SL and depth remain blocked pending real testnet / rate-limit evidence.
export VITE_ENABLE_DYDX_TPSL=false
export VITE_ENABLE_SPOT_DEPTH=false
if [ "${VERCEL_ENV:-}" = "production" ]; then
  export VITE_ENABLE_FUTURES_HISTORY=true
else
  export VITE_ENABLE_FUTURES_HISTORY=false
fi
