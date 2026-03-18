import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from './PageHeader'
import TestingSummary from './TestingSummary'
import BugGallery from './BugGallery'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './EmptyState'
import SystemHealth from './SystemHealth'
import { IconAnalytics } from './Icons'
import { API_BASE } from '../api'
import { useGame } from '../context/GameContext'

// ── KPI card ──────────────────────────────────────────────────────────────
const KPI_CARD = ({ label, value, sub, gradient, Icon }) => (
  <div className="glass-card relative overflow-hidden">
    <div className={`absolute top-4 right-4 w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
      <Icon className="w-5 h-5 text-white" />
    </div>
    <p className="form-label text-textMuted dark:text-gray-400">{label}</p>
    <p className="font-mono text-3xl font-bold text-textPrimary dark:text-gray-100 mt-1">{value}</p>
    {sub != null && <p className="text-sm text-textMuted dark:text-gray-400 mt-0.5">{sub}</p>}
  </div>
)

// ── "Last updated X sec ago" counter ──────────────────────────────────────
function LastUpdated({ ts }) {
  const [secAgo, setSecAgo] = useState(0)

  useEffect(() => {
    setSecAgo(0)
    const iv = setInterval(() => setSecAgo((s) => s + 1), 1000)
    return () => clearInterval(iv)
  }, [ts])

  const label = secAgo < 5 ? 'just now' : `${secAgo}s ago`
  return (
    <span className="text-xs text-textLight dark:text-gray-500 flex items-center gap-1">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Updated {label}
    </span>
  )
}

// ── Action card icons ─────────────────────────────────────────────────────
function NewSessionIcon({ cls }) {
  return (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
    </svg>
  )
}
function AnalyticsIcon({ cls }) {
  return (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}
function ConfigIcon({ cls }) {
  return (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

const ACTION_CARDS = [
  {
    to: '/analytics',
    title: 'New Test Session',
    desc: 'Start a fresh AI testing session.',
    accent: 'border-l-blue-400',
    iconColor: 'text-blue-400',
    Icon: NewSessionIcon,
  },
  {
    to: '/analytics',
    title: 'View Analytics',
    desc: 'Detailed performance insights.',
    accent: 'border-l-green-400',
    iconColor: 'text-green-400',
    Icon: AnalyticsIcon,
  },
  {
    to: '/game-configs',
    title: 'Configure Tests',
    desc: 'Manage game test settings.',
    accent: 'border-l-purple-400',
    iconColor: 'text-purple-400',
    Icon: ConfigIcon,
  },
]

// ── DashboardPage ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { game, gameDisplayName } = useGame()
  const [stats, setStats] = useState({ total_bugs: 0, bugs_last_24h: 0 })
  const [bugs, setBugs] = useState([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastFetchTs, setLastFetchTs] = useState(null)   // for "last updated" counter

  useEffect(() => {
    let cancelled = false
    const timeoutMs = 12000
    const gameQ = game ? `&game=${encodeURIComponent(game)}` : ''

    async function fetchData() {
      const healthUrl = `${API_BASE}/health`
      try {
        const ac = new AbortController()
        const to = setTimeout(() => ac.abort(), timeoutMs)
        const healthRes = await fetch(healthUrl, { signal: ac.signal })
        clearTimeout(to)
        if (!healthRes.ok) throw new Error('API error')
        const health = await healthRes.json()
        const startedAt = health.started_at
        const ac2 = new AbortController()
        const to2 = setTimeout(() => ac2.abort(), timeoutMs)
        const [statsRes, bugsRes, agentRes] = await Promise.all([
          fetch(`${API_BASE}/stats?${game ? `game=${encodeURIComponent(game)}` : ''}`, { signal: ac2.signal }),
          startedAt != null
            ? fetch(`${API_BASE}/bugs?limit=50&since=${startedAt}${gameQ}`, { signal: ac2.signal })
            : fetch(`${API_BASE}/bugs?limit=50${gameQ}`, { signal: ac2.signal }),
          fetch(`${API_BASE}/agent/status`).then((r) => (r.ok ? r.json() : { running: false })).catch(() => ({ running: false })),
        ])
        clearTimeout(to2)
        if (!statsRes.ok || !bugsRes.ok) throw new Error('API error')
        const [s, b, agent] = await Promise.all([statsRes.json(), bugsRes.json(), agentRes])
        if (!cancelled) {
          setStats(s)
          setBugs(b)
          setAgentRunning(agent.running === true)
          setError(null)
          setLastFetchTs(Date.now())
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.name === 'AbortError' ? 'Backend did not respond in time. Is it running?' : e.message)
          setLoading(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [game])

  const criticalCount = bugs.filter((b) => (b.severity || '').toLowerCase() === 'critical').length
  const successRate = (stats.total_bugs > 0 || stats.bugs_last_24h > 0)
    ? (100 - Math.min(100, (stats.bugs_last_24h / Math.max(1, stats.total_bugs + 1)) * 20)).toFixed(1)
    : '—'

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Monitor your AI-powered game testing operations in real-time."
      />
      <div className="max-w-7xl mx-auto px-6 pb-8">
        {loading && bugs.length === 0 && !error ? (
          <LoadingSpinner label="Loading dashboard..." />
        ) : (
          <>
            {error && (
              <div className="mb-6 alert-error">
                {error} Start the backend (e.g. <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-sm">run_system.bat</code> or <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-sm">uvicorn backend.main:app --host 0.0.0.0 --port 8000</code>), then refresh this page.
              </div>
            )}

            <SystemHealth />

            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <KPI_CARD
                label="Active Tests"
                value={agentRunning ? '1' : '0'}
                sub={agentRunning ? `${gameDisplayName || game || 'Session'} running` : 'No active session'}
                gradient="from-blue-500 to-cyan-400"
                Icon={({ className }) => (
                  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                )}
              />
              <KPI_CARD
                label="Bugs Reported"
                value={String(stats.total_bugs)}
                sub={`${stats.bugs_last_24h} in last 24h`}
                gradient="from-green-500 to-emerald-400"
                Icon={({ className }) => (
                  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              />
              <KPI_CARD
                label="Avg. Success Rate"
                value={typeof successRate === 'string' && successRate !== '—' ? `${successRate}%` : successRate}
                sub="Session health"
                gradient="from-purple-500 to-violet-400"
                Icon={({ className }) => (
                  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                )}
              />
              <KPI_CARD
                label="Critical Issues"
                value={String(criticalCount)}
                sub={criticalCount > 0 ? 'Requires attention' : 'None'}
                gradient="from-red-500 to-rose-400"
                Icon={({ className }) => (
                  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
              />
            </div>

            {/* Recent Test Sessions */}
            <section className="glass-card mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display font-semibold text-lg text-textPrimary dark:text-gray-100">Recent Test Sessions</h2>
                  <p className="text-sm text-textMuted dark:text-gray-400 mt-0.5">Live status of your ongoing and recent tests</p>
                </div>
                <div className="flex items-center gap-3">
                  {lastFetchTs && <LastUpdated ts={lastFetchTs} />}
                  <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div className="space-y-3">
                {agentRunning && (
                  <div className="flex items-center gap-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="font-medium text-textPrimary dark:text-gray-100 flex-1">{gameDisplayName || game || 'Current game'}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">Running</span>
                    <div className="flex-1 max-w-[120px] h-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                      {/* Animated shimmer instead of static 60% */}
                      <div className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded animate-pulse" style={{ width: '60%' }} />
                    </div>
                    <span className="text-textMuted dark:text-gray-400 text-sm">Live</span>
                  </div>
                )}
                {bugs.slice(0, 3).map((bug) => (
                  <div key={bug.id} className="flex items-center gap-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="font-medium text-textPrimary dark:text-gray-100 flex-1 truncate">{bug.type || `Bug #${bug.id}`}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">Completed</span>
                    <div className="flex-1 max-w-[120px] h-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                      <div className="h-full bg-gray-400 dark:bg-gray-500 rounded" style={{ width: '100%' }} />
                    </div>
                    <span className="text-textMuted dark:text-gray-400 text-sm">Reported</span>
                  </div>
                ))}
                {!agentRunning && bugs.length === 0 && (
                  <EmptyState
                    compact
                    imageSrc="/empty-state-sessions.svg"
                    title="No recent sessions"
                    description="Start the agent from Session & Analytics to begin testing."
                    action={
                      <Link to="/analytics" className="btn-primary btn-icon">
                        <IconAnalytics />
                        Go to Session & Analytics
                      </Link>
                    }
                  />
                )}
              </div>
            </section>

            {/* Action cards — all with icons and consistent accent borders (#12) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
              {ACTION_CARDS.map(({ to, title, desc, accent, iconColor, Icon }) => (
                <Link
                  key={to + title}
                  to={to}
                  className={`glass-card p-6 hover:border-accent/50 hover:shadow-md transition-all flex flex-col gap-3 border-l-4 ${accent}`}
                >
                  <Icon cls={`w-8 h-8 ${iconColor}`} />
                  <div>
                    <span className="font-semibold text-textPrimary dark:text-gray-100 block">{title}</span>
                    <span className="text-sm text-textMuted dark:text-gray-400 mt-0.5">{desc}</span>
                  </div>
                </Link>
              ))}
            </div>

            <TestingSummary stats={stats} />
            <BugGallery bugs={bugs} apiBase={API_BASE} />
          </>
        )}
      </div>
    </>
  )
}
