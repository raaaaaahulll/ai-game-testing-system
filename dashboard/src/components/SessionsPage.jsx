import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from './PageHeader'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './EmptyState'
import { IconAnalytics } from './Icons'
import SessionBugCard from './SessionBugCard'
import { API_BASE } from '../api'
import { useGame } from '../context/GameContext'

function formatTimeRange(start_ts, end_ts) {
  if (start_ts == null || end_ts == null) return '—'
  const s = new Date(start_ts * 1000).toLocaleTimeString()
  const e = new Date(end_ts * 1000).toLocaleTimeString()
  return `${s} – ${e}`
}

function formatDuration(start_ts, end_ts) {
  if (start_ts == null || end_ts == null) return '—'
  const secs = Math.max(0, Math.floor(end_ts - start_ts))
  if (secs < 60) return '< 1 min'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  if (remainMins === 0) return `${hours}h`
  return `${hours}h ${remainMins}m`
}

function getSeverityBreakdown(bugs) {
  const counts = { critical: 0, major: 0, minor: 0, other: 0 }
  for (const b of bugs) {
    const s = (b.severity || '').toLowerCase()
    if (s === 'critical') counts.critical++
    else if (s === 'major') counts.major++
    else if (s === 'minor') counts.minor++
    else counts.other++
  }
  return counts
}

function getBugsThisWeek(sessions) {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const weekStr = weekAgo.toISOString().slice(0, 10)
  return sessions
    .filter((s) => s.date >= weekStr)
    .reduce((sum, s) => sum + (s.bug_count || 0), 0)
}

export default function SessionsPage() {
  const { game, setGame, games, gameDisplayName, gameDisplayNames, loading: gamesLoading } = useGame()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedDate, setExpandedDate] = useState(null)
  const [sessionBugs, setSessionBugs] = useState([])
  const [loadingBugs, setLoadingBugs] = useState(false)

  useEffect(() => {
    let cancelled = false
    const gameQ = game ? `?game=${encodeURIComponent(game)}` : ''
    fetch(`${API_BASE}/sessions${gameQ}`)
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((d) => {
        if (!cancelled) setSessions(d.sessions || [])
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [game])

  function toggleSession(session) {
    if (expandedDate === session.date) {
      setExpandedDate(null)
      setSessionBugs([])
      return
    }
    setExpandedDate(session.date)
    setLoadingBugs(true)
    const ids = session.bug_ids || []
    if (ids.length === 0) {
      setSessionBugs([])
      setLoadingBugs(false)
      return
    }
    fetch(`${API_BASE}/bugs?ids=${ids.join(',')}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((b) => setSessionBugs(Array.isArray(b) ? b : []))
      .catch(() => setSessionBugs([]))
      .finally(() => setLoadingBugs(false))
  }

  return (
    <>
      <PageHeader
        title="Previous Sessions"
        description="Browse and review historical test session data and results."
      />
      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label htmlFor="sessions-game-filter" className="form-label text-textMuted whitespace-nowrap">
            Filter by game
          </label>
          <select
            id="sessions-game-filter"
            value={game || ''}
            onChange={(e) => setGame(e.target.value || 'nfs_rivals')}
            disabled={gamesLoading}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-textPrimary dark:text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent min-w-[180px]"
          >
            {games.map((g) => (
              <option key={g} value={g}>
                {(gameDisplayNames && gameDisplayNames[g]) || g}
              </option>
            ))}
          </select>
          {game && (
            <span className="text-sm text-textMuted dark:text-gray-400">
              Showing sessions for <strong className="text-textPrimary dark:text-gray-100">{gameDisplayName || game}</strong>
            </span>
          )}
        </div>
        {loading ? (
          <LoadingSpinner label="Loading sessions..." />
        ) : (
          <>
            {error && <div className="mb-6 alert-error">{error}</div>}
            {sessions.length > 0 && !error && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="glass-card p-4">
                  <p className="form-label text-textMuted">Total sessions</p>
                  <p className="font-display text-2xl font-bold text-textPrimary">{sessions.length}</p>
                </div>
                <div className="glass-card p-4">
                  <p className="form-label text-textMuted">Total bugs</p>
                  <p className="font-display text-2xl font-bold text-textPrimary">
                    {sessions.reduce((sum, s) => sum + (s.bug_count || 0), 0)}
                  </p>
                </div>
                <div className="glass-card p-4">
                  <p className="form-label text-textMuted">Bugs this week</p>
                  <p className="font-display text-2xl font-bold text-textPrimary">{getBugsThisWeek(sessions)}</p>
                </div>
              </div>
            )}
            {sessions.length === 0 && !error && (
              <div className="glass-card">
                <EmptyState
                  imageSrc="/empty-state-sessions.svg"
                  title="No sessions yet"
                  description="Sessions are grouped by day. Run the agent from Session & Analytics to collect bug reports."
                  action={
                    <Link to="/analytics" className="btn-primary btn-icon">
                      <IconAnalytics />
                      Go to Session & Analytics
                    </Link>
                  }
                />
              </div>
            )}
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.date}
                  className="glass-card p-0 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleSession(session)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-6 flex-wrap">
                      <span className="font-mono text-textPrimary font-medium">{session.date}</span>
                      <span className="text-textMuted text-sm">
                        {formatTimeRange(session.start_ts, session.end_ts)}
                      </span>
                      <span className="text-textMuted text-sm">
                        Dur. {formatDuration(session.start_ts, session.end_ts)}
                      </span>
                      <span className="text-accent text-sm font-medium">
                        {session.bug_count} bug{session.bug_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="text-textMuted text-sm">
                      {expandedDate === session.date ? '▼ Hide' : '▶ View details'}
                    </span>
                  </button>
                  {expandedDate === session.date && (
                    <div className="border-t border-gray-200 p-6">
                      {loadingBugs ? (
                        <p className="text-textMuted text-sm">Loading bugs…</p>
                      ) : (
                        <>
                          {sessionBugs.length > 0 && (() => {
                            const sev = getSeverityBreakdown(sessionBugs)
                            const parts = []
                            if (sev.critical > 0) parts.push(<span key="c" className="text-red-600 font-medium">{sev.critical} critical</span>)
                            if (sev.major > 0) parts.push(<span key="m" className="text-amber-600">{sev.major} major</span>)
                            if (sev.minor > 0) parts.push(<span key="n" className="text-blue-600">{sev.minor} minor</span>)
                            if (sev.other > 0) parts.push(<span key="o" className="text-textMuted">{sev.other} other</span>)
                            if (parts.length === 0) return null
                            return (
                              <p className="text-sm text-textMuted mb-4 flex flex-wrap gap-x-2 gap-y-1 items-center">
                                <span className="text-textPrimary">Severity:</span>
                                {parts.map((el, i) => (
                                  <span key={i}>{i > 0 && ', '}{el}</span>
                                ))}
                              </p>
                            )
                          })()}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {sessionBugs.map((bug) => (
                              <SessionBugCard key={bug.id} bug={bug} apiBase={API_BASE} />
                            ))}
                          </div>
                        </>
                      )}
                      {!loadingBugs && sessionBugs.length === 0 && session.bug_count > 0 && (
                        <p className="text-textMuted text-sm">No bug details available.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
