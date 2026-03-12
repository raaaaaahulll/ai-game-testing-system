import { useState, useEffect, useMemo, useRef } from 'react'
import PageHeader from './PageHeader'
import LoadingSpinner from './LoadingSpinner'
import { API_BASE } from '../api'
import { useGame } from '../context/GameContext'

const ACTION_LABELS = ['Coast', 'Accel', 'Brake', 'Left', 'Right', 'Accel+Left', 'Accel+Right', 'Accel']

// ── KPI card (Unified with Dashboard style) ──────────────────────────────
const KPI_CARD = ({ label, value, sub, gradient, Icon, isHistorical }) => (
  <div className={`glass-card relative overflow-hidden transition-all ${isHistorical ? 'opacity-90 grayscale-[0.2]' : ''}`}>
    <div className={`absolute top-4 right-4 w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
      {Icon && <Icon className="w-5 h-5 text-white" />}
    </div>
    <p className="form-label text-textMuted dark:text-gray-400 flex items-center gap-1.5">
      {label}
      {isHistorical && (
        <span className="text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-800 text-textLight dark:text-gray-500 uppercase tracking-tighter">Last</span>
      )}
    </p>
    <p className="font-mono text-3xl font-bold text-textPrimary dark:text-gray-100 mt-1">{value}</p>
    {sub != null && <p className="text-sm text-textMuted dark:text-gray-400 mt-0.5">{sub}</p>}
  </div>
)

function HeatmapWithPath({ heatmap, gridSize, path }) {
  const gridData = useMemo(() => {
    const g = Array(gridSize).fill(0).map(() => Array(gridSize).fill(0))
    if (!Array.isArray(heatmap)) return { grid: g, maxCount: 1 }
    let maxCount = 1
    for (const cell of heatmap) {
      const x = cell.x
      const y = cell.y
      const c = cell.count || 0
      if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
        g[y][x] = c
        if (c > maxCount) maxCount = c
      }
    }
    return { grid: g, maxCount }
  }, [heatmap, gridSize])

  const { grid, maxCount } = gridData
  const cellSize = Math.max(4, Math.min(12, Math.floor(400 / gridSize)))
  const width = gridSize * cellSize
  const height = gridSize * cellSize

  const pathPoints = useMemo(() => {
    if (!Array.isArray(path) || path.length < 2) return ''
    return path
      .filter((p) => p.x >= 0 && p.x < gridSize && p.y >= 0 && p.y < gridSize)
      .map((p) => `${p.x * cellSize + cellSize / 2},${p.y * cellSize + cellSize / 2}`)
      .join(' ')
  }, [path, gridSize, cellSize])

  return (
    <div className="relative inline-block">
      <div
        className="inline-grid gap-0.5 rounded overflow-hidden bg-gray-200 dark:bg-gray-800"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${gridSize}, ${cellSize}px)`,
        }}
      >
        {grid.map((row, y) =>
          row.map((count, x) => {
            const intensity = maxCount > 0 ? count / maxCount : 0
            const r = Math.round(230 * intensity + 25)
            const g = Math.round(57 * (1 - intensity * 0.5))
            const b = Math.round(70 * (1 - intensity * 0.5))
            return (
              <div
                key={`${x}-${y}`}
                className="rounded-sm"
                style={{
                  backgroundColor: count > 0 ? `rgb(${r},${g},${b})` : 'rgb(20,20,20)',
                  width: cellSize,
                  height: cellSize,
                }}
                title={count > 0 ? `(${x},${y}) visits: ${count}` : ''}
              />
            )
          })
        )}
      </div>
      {pathPoints && (
        <svg
          className="absolute inset-0 pointer-events-none"
          width={width}
          height={height}
          style={{ left: 0, top: 0 }}
        >
          <polyline
            points={pathPoints}
            fill="none"
            stroke="cyan"
            strokeWidth={2}
            strokeOpacity={0.9}
          />
        </svg>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  const { game, setGame, games, gameDisplayName, gameDisplayNames, loading: gamesLoading } = useGame()
  const reportTitle = gameDisplayName ? `AI Game Tester — ${gameDisplayName}` : 'AI Game Tester'
  const reportSlug = (game || 'report').replace(/\s+/g, '-')
  const [analytics, setAnalytics] = useState(null)
  const [liveHeatmap, setLiveHeatmap] = useState(null)
  const [liveGridSize, setLiveGridSize] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [paused, setPaused] = useState(false)
  const [agentStatus, setAgentStatus] = useState({ running: false, pid: null })
  const [agentBusy, setAgentBusy] = useState(false)
  const wsRef = useRef(null)
  const gameQ = game ? `&game=${encodeURIComponent(game)}` : ''
  const gameQPrefix = game ? `?game=${encodeURIComponent(game)}` : ''

  const fetchAnalytics = async () => {
    try {
      const ac = new AbortController()
      // Allow a bit more time on slower machines before declaring the backend unreachable
      const to = setTimeout(() => ac.abort(), 15000)
      const r = await fetch(`${API_BASE}/analytics`, { signal: ac.signal })
      clearTimeout(to)
      if (!r.ok) throw new Error('Analytics failed')
      const data = await r.json()
      setAnalytics(data)
      setPaused(!!data.paused)
      setError(null)
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Backend did not respond. Is it running?' : e.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchAgentStatus = async () => {
    try {
      const r = await fetch(`${API_BASE}/agent/status`)
      if (r.ok) setAgentStatus(await r.json())
    } catch (_) { }
  }

  useEffect(() => {
    fetchAnalytics()
    fetchAgentStatus()
    const interval = setInterval(() => {
      fetchAnalytics()
      fetchAgentStatus()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket: live coverage updates
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${proto}://${window.location.host}/api/ws/coverage`
    let ws
    try {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data)
          if (d.heatmap !== undefined) {
            setLiveHeatmap(d.heatmap)
            setLiveGridSize(d.gridSize || 100)
          }
        } catch (_) { }
      }
      ws.onclose = () => {
        setLiveHeatmap(null)
        setLiveGridSize(null)
      }
    } catch (_) { }
    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
      wsRef.current = null
    }
  }, [])

  const togglePause = async () => {
    try {
      const r = await fetch(`${API_BASE}/analytics/pause`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !paused }),
      })
      if (r.ok) {
        const d = await r.json()
        setPaused(!!d.paused)
      }
    } catch (_) { }
  }

  const startAgent = async () => {
    setAgentBusy(true)
    try {
      const r = await fetch(`${API_BASE}/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_key: game || 'nfs_rivals' }),
      })
      if (r.ok) await fetchAgentStatus()
      else {
        const d = await r.json().catch(() => ({}))
        alert(d.detail || 'Failed to start agent')
      }
    } catch (e) {
      alert('Failed to start agent')
    } finally {
      setAgentBusy(false)
    }
  }

  const stopAgent = async () => {
    setAgentBusy(true)
    try {
      await fetch(`${API_BASE}/agent/stop`, { method: 'POST' })
      await fetchAgentStatus()
    } catch (_) { }
    finally {
      setAgentBusy(false)
    }
  }

  const exportComprehensiveReport = async () => {
    try {
      const healthRes = await fetch(`${API_BASE}/health`)
      const startedAt = healthRes.ok ? (await healthRes.json()).started_at : null
      const reportUrl = `${API_BASE}/report/comprehensive?bug_limit=200${startedAt != null ? `&since=${startedAt}` : ''}${gameQ}`
      const r = await fetch(reportUrl)
      if (!r.ok) throw new Error('Report failed')
      const data = await r.json()
      const lines = [
        `# ${reportTitle} — Comprehensive Test Report`,
        '',
        `Generated: ${new Date(data.generated_at * 1000).toISOString()}`,
        `Session started: ${data.session_started_at ? new Date(data.session_started_at * 1000).toISOString() : 'N/A'}`,
        '',
        '## Summary',
        `- Total bugs (all time): ${data.stats?.total_bugs ?? 0}`,
        `- Bugs last 24h: ${data.stats?.bugs_last_24h ?? 0}`,
        `- Gameplay coverage: ${data.coverage_pct != null ? `${data.coverage_pct}%` : 'N/A'} (${data.unique_cells ?? '—'} / ${data.grid_size * data.grid_size} tiles)`,
        `- Unique cells: ${data.session_stats?.unique_cells ?? '—'}`,
        `- Distance (approx): ${data.session_stats?.distance_approx ?? '—'}`,
        `- Steps: ${data.session_stats?.step_count ?? '—'}`,
        `- Episodes: ${data.session_stats?.episode_count ?? '—'}`,
        data.session_stats?.current_fps != null ? `- Current FPS: ${data.session_stats.current_fps}` : '',
        '',
        '## Coverage heatmap',
        data.heatmap_image_b64
          ? `![Coverage Heatmap](data:image/png;base64,${data.heatmap_image_b64})`
          : '_No heatmap data. Run the agent to build coverage._',
        '',
        '## Detected bugs (with trace summaries)',
        '',
        '| # | Type | Severity | Timestamp | Trace summary |',
        '|---|------|---------|-----------|----------------|',
        ...(data.bugs || []).map((b) => {
          const ts = new Date(b.timestamp * 1000).toISOString()
          const summary = (b.trace_summary || '').replace(/\|/g, '\\|').slice(0, 80)
          return `| ${b.id} | ${b.type} | ${b.severity} | ${ts} | ${summary} |`
        }),
        '',
      ]
      const blob = new Blob([lines.filter(Boolean).join('\n')], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${reportSlug}-comprehensive-report-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Failed to generate report: ' + (e.message || 'Unknown error'))
    }
  }

  const exportReport = async () => {
    try {
      const [healthRes, statsRes, bugsRes, analyticsRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/stats${gameQPrefix}`),
        fetch(`${API_BASE}/bugs?limit=200${game ? `&game=${encodeURIComponent(game)}` : ''}`),
        fetch(`${API_BASE}/analytics`),
      ])
      const startedAt = healthRes.ok ? (await healthRes.json()).started_at : null
      const stats = statsRes.ok ? await statsRes.json() : {}
      const bugs = bugsRes.ok ? await bugsRes.json() : []
      const an = analyticsRes.ok ? await analyticsRes.json() : {}
      const lines = [
        `# ${reportTitle} — Session Report`,
        '',
        `Generated: ${new Date().toISOString()}`,
        `Session started: ${startedAt ? new Date(startedAt * 1000).toISOString() : 'N/A'}`,
        '',
        '## Stats',
        `- Total bugs (all time): ${stats.total_bugs ?? 0}`,
        `- Bugs last 24h: ${stats.bugs_last_24h ?? 0}`,
        '',
        '## Session analytics',
        `- Unique cells visited: ${an.session_stats?.unique_cells ?? 'N/A'}`,
        `- Distance (approx): ${an.session_stats?.distance_approx ?? 'N/A'}`,
        `- Steps: ${an.session_stats?.step_count ?? 'N/A'}`,
        `- Episodes: ${an.session_stats?.episode_count ?? 'N/A'}`,
        '',
        '## Bugs this session',
        ...bugs.slice(0, 50).map((b) => `- [${b.type}] ${new Date(b.timestamp * 1000).toISOString()}`),
      ]
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${reportSlug}-report-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (_) { }
  }

  if (loading && !analytics) {
    return (
      <>
        <PageHeader title="Session & Analytics" description="Live coverage, path trail, agent control, and report export." />
        <div className="max-w-7xl mx-auto px-6 pb-8">
          <LoadingSpinner label="Loading analytics..." />
        </div>
      </>
    )
  }

  const stats = analytics?.session_stats || {}
  const analyticsGameKey = stats.game_key || null
  const actionCounts = analytics?.action_counts || {}
  const totalActions = Object.values(actionCounts).reduce((s, n) => s + Number(n), 0)
  const prevSession = analytics?.session_history?.[0]
  const gridSize = liveGridSize ?? analytics?.grid_size ?? 100
  const heatmapSource = liveHeatmap ?? analytics?.heatmap ?? []
  const uniqueCells = stats.unique_cells
  const totalTiles = gridSize * gridSize
  const coveragePct = totalTiles > 0 && typeof uniqueCells === 'number'
    ? ((uniqueCells / totalTiles) * 100).toFixed(1)
    : null

  const isLive = agentStatus.running
  const hasData = heatmapSource.length > 0 || totalActions > 0 || stats.step_count > 0

  return (
    <>
      <PageHeader
        title="Session & Analytics"
        description="Comprehensive insights into your AI testing performance and trends."
      />
      <div className="max-w-7xl mx-auto px-6 pb-8 space-y-8">
        {error && (
          <div className="alert-error">
            Could not load analytics. Is the backend running?
          </div>
        )}

        {/* Status indicator row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className="text-sm font-bold tracking-wider uppercase text-textPrimary dark:text-gray-200">
                {isLive ? 'Live Analysis' : hasData ? 'Historical Data (Last Session)' : 'System Idle'}
              </span>
            </div>
            {analyticsGameKey && (
              <span className="text-xs text-textMuted dark:text-gray-500 font-mono">
                Analytics source game:&nbsp;
                <span className="text-textPrimary dark:text-gray-200">
                  {gameDisplayNames?.[analyticsGameKey] || analyticsGameKey}
                </span>
              </span>
            )}
          </div>
          {!isLive && hasData && (
            <span className="text-xs text-textMuted dark:text-gray-500 font-mono italic">
              * Showing the most recent test run data.
            </span>
          )}
        </div>

        {/* Game Selector Row */}
        <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-darkCard p-4 rounded-card border border-gray-200 dark:border-darkBorder shadow-sm">
          <label htmlFor="analytics-game-selector" className="form-label text-textMuted dark:text-gray-400 whitespace-nowrap mb-0">
            Active game
          </label>
          <select
            id="analytics-game-selector"
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
              Controlling{' '}
              <strong className="text-textPrimary dark:text-gray-100">
                {gameDisplayName || game}
              </strong>
            </span>
          )}
        </div>

        {/* KPI Grid (Unified) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPI_CARD
            label="Gameplay coverage"
            value={coveragePct != null ? `${coveragePct}%` : '—'}
            sub={uniqueCells != null && totalTiles > 0 ? `${uniqueCells} / ${totalTiles} tiles` : ''}
            gradient="from-orange-400 to-orange-500"
            isHistorical={!isLive && hasData}
            Icon={() => (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7l5-2.5L19.553 7.224A1 1 0 0121 8.118v10.764a1 1 0 01-1.447.894L15 17l-6 3z" />
              </svg>
            )}
          />
          <KPI_CARD
            label="Unique cells"
            value={stats.unique_cells ?? '—'}
            gradient="from-sky-400 to-sky-500"
            isHistorical={!isLive && hasData}
            Icon={() => (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            )}
          />
          <KPI_CARD
            label="Distance (approx)"
            value={stats.distance_approx != null ? stats.distance_approx.toFixed(1) : '—'}
            gradient="from-cyan-400 to-cyan-500"
            isHistorical={!isLive && hasData}
            Icon={() => (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            )}
          />
          <KPI_CARD
            label="Steps"
            value={stats.step_count ?? '—'}
            gradient="from-purple-400 to-purple-500"
            isHistorical={!isLive && hasData}
            Icon={() => (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-1-1m1 1v-3m0 3h3" />
              </svg>
            )}
          />
          <KPI_CARD
            label="Episodes"
            value={stats.episode_count ?? '—'}
            gradient="from-pink-400 to-pink-500"
            isHistorical={!isLive && hasData}
            Icon={() => (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          />
        </div>

        {/* Heatmap and Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card flex flex-col items-center">
            <p className="text-textMuted dark:text-gray-400 text-sm mb-4 w-full flex justify-between">
              <span>Coverage heatmap + path trail (cyan)</span>
              {isLive ? <span className="text-accent dark:text-blue-400 animate-pulse font-mono text-xs">LIVE STREAMING</span> : (hasData && <span className="text-textMuted dark:text-gray-500 font-mono text-xs uppercase">Stored Frame</span>)}
            </p>
            {heatmapSource.length > 0 ? (
              <div className={!isLive ? 'filter saturate-[0.8] opacity-90' : ''}>
                <HeatmapWithPath
                  heatmap={heatmapSource}
                  gridSize={gridSize}
                  path={analytics?.path || []}
                />
              </div>
            ) : (
              <div className="bg-gray-100 dark:bg-gray-900 rounded-lg h-64 w-full flex items-center justify-center text-textMuted dark:text-gray-500 font-mono text-sm border border-gray-200 dark:border-gray-800">
                Run the agent to see coverage and path.
              </div>
            )}
          </div>

          <div className="glass-card">
            <p className="text-textMuted dark:text-gray-400 text-sm mb-3">Action distribution</p>
            {totalActions > 0 ? (
              <div className={`space-y-2 ${!isLive ? 'opacity-80' : ''}`}>
                {ACTION_LABELS.map((label, i) => {
                  const count = Number(actionCounts[String(i)] ?? 0)
                  const pct = ((100 * count) / totalActions).toFixed(1)
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-textMuted dark:text-gray-400 font-mono text-xs w-24">{label}</span>
                      <div className="flex-1 h-6 bg-gray-200 dark:bg-gray-800 rounded overflow-hidden">
                        <div
                          className={`h-full ${isLive ? 'bg-accent' : 'bg-gray-400 dark:bg-gray-600'} rounded transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-textMuted dark:text-gray-400 text-xs w-12">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-gray-100 dark:bg-gray-900 rounded-lg h-48 flex items-center justify-center text-textMuted dark:text-gray-500 font-mono text-sm border border-gray-200 dark:border-gray-800">
                No action data yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-8 space-y-6">
        {/* Agent Controls Block */}
        <div className="glass-card p-4 flex flex-wrap gap-4 items-center">
          <span className="text-textMuted dark:text-gray-400 text-sm font-mono flex items-center gap-2">
            Status:
            {agentStatus.running ? (
              <span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold border border-green-200 dark:border-green-800/50">
                AGENT RUNNING {agentStatus.pid != null ? `(PID ${agentStatus.pid})` : ''}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-textLight dark:text-gray-500 font-bold border border-gray-200 dark:border-gray-700">
                STANDBY
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={startAgent}
            disabled={agentBusy || agentStatus.running}
            className="btn-primary"
          >
            Start agent
          </button>
          <button
            type="button"
            onClick={stopAgent}
            disabled={agentBusy || !agentStatus.running}
            className="btn-danger"
          >
            Stop agent
          </button>
          <button
            type="button"
            onClick={togglePause}
            className={paused ? 'btn-primary' : 'btn-secondary'}
          >
            {paused ? 'Resume agent' : 'Pause agent'}
          </button>
          <button
            type="button"
            onClick={exportReport}
            className="btn-secondary"
          >
            Export report (MD)
          </button>
          <button
            type="button"
            onClick={exportComprehensiveReport}
            className="btn-secondary"
          >
            Export comprehensive report
          </button>
        </div>

        {analytics?.live_screenshot && isLive && (
          <div className="glass-card">
            <p className="text-textMuted dark:text-gray-400 text-sm mb-3">Live view (agent camera)</p>
            <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-800">
              <img
                src={`data:image/png;base64,${analytics.live_screenshot}`}
                alt="Live"
                className="max-w-full h-auto rounded max-h-64 mx-auto object-contain"
              />
            </div>
          </div>
        )}

        {prevSession && (
          <div className="glass-card">
            <p className="text-textMuted dark:text-gray-400 text-sm mb-3">Previous session (comparison)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-textMuted dark:text-gray-400">Unique cells</span>
                <p className="font-mono text-textPrimary dark:text-gray-100">{prevSession.unique_cells ?? '—'}</p>
              </div>
              <div>
                <span className="text-textMuted dark:text-gray-400">Distance</span>
                <p className="font-mono text-textPrimary dark:text-gray-100">{prevSession.distance_approx ?? '—'}</p>
              </div>
              <div>
                <span className="text-textMuted dark:text-gray-400">Steps</span>
                <p className="font-mono text-textPrimary dark:text-gray-100">{prevSession.step_count ?? '—'}</p>
              </div>
              <div>
                <span className="text-textMuted dark:text-gray-400">Episodes</span>
                <p className="font-mono text-textPrimary dark:text-gray-100">{prevSession.episode_count ?? '—'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
