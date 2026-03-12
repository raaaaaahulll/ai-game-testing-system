/**
 * Backend API base URL.
 * - Set VITE_API_BASE=http://127.0.0.1:8000 to call backend directly.
 * - When dashboard is served from localhost:3000 (dev), default to direct backend URL so the
 *   request always reaches the backend even if the proxy fails or env was not set.
 */
function getEffectiveApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE
  if (fromEnv && fromEnv.startsWith('http')) return fromEnv
  if (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://127.0.0.1:8000'
  }
  return '/api'
}
export const API_BASE = getEffectiveApiBase()

/** WebSocket URL for live coverage. Uses direct backend host when VITE_API_BASE is set. */
export function getWsCoverageUrl() {
  if (API_BASE.startsWith('http')) {
    const wsBase = API_BASE.replace(/^http/, 'ws').replace(/\/$/, '')
    return `${wsBase}/ws/coverage`
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws/coverage`
}
