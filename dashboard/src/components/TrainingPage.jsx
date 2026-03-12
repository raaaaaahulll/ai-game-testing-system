import { useEffect, useState } from 'react'
import PageHeader from './PageHeader'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './EmptyState'
import { API_BASE } from '../api'
import { useGame } from '../context/GameContext'

export default function TrainingPage() {
  const { game, setGame, games, gameDisplayName, gameDisplayNames, loading: gamesLoading } = useGame()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)

  const selectedGame = game || (games[0] ?? '')

  const fetchStatus = async (currentGame) => {
    if (!currentGame) {
      setStatus(null)
      setLoading(false)
      return
    }
    try {
      const r = await fetch(`${API_BASE}/agent/train/status?game=${encodeURIComponent(currentGame)}`)
      if (!r.ok) throw new Error('Failed to load training status')
      const data = await r.json()
      setStatus(data)
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load training status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchStatus(selectedGame)
    const interval = setInterval(() => {
      fetchStatus(selectedGame)
    }, 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame])

  const startTraining = async () => {
    if (!selectedGame) return
    setStarting(true)
    try {
      const r = await fetch(`${API_BASE}/agent/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_key: selectedGame }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.detail || r.statusText || 'Failed to start training')
      }
      await r.json().catch(() => ({}))
      await fetchStatus(selectedGame)
      alert(`Training started for ${gameDisplayNames?.[selectedGame] || selectedGame}.`)
    } catch (e) {
      alert(e.message || 'Failed to start training')
    } finally {
      setStarting(false)
    }
  }

  const stopTraining = async () => {
    if (!window.confirm('Stop the current training run?')) return
    setStarting(true)
    try {
      const r = await fetch(`${API_BASE}/agent/train/stop`, { method: 'POST' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.detail || r.statusText || 'Failed to stop training')
      }
      await fetchStatus(selectedGame)
    } catch (e) {
      alert(e.message || 'Failed to stop training')
    } finally {
      setStarting(false)
    }
  }

  const progress = status?.progress || null
  const history = Array.isArray(status?.history) ? status.history : []
  const anyRunning = status?.running === true
  const runningGameKey = status?.running_game_key || null
  const runningForThisGame = anyRunning && runningGameKey === selectedGame
  const runningForOtherGame = anyRunning && runningGameKey && runningGameKey !== selectedGame

  const totalSteps = typeof progress?.total_timesteps === 'number' ? progress.total_timesteps : null
  const targetSteps = typeof progress?.target_timesteps === 'number' ? progress.target_timesteps : null
  const percent =
    totalSteps != null && targetSteps && targetSteps > 0
      ? Math.min(100, Math.round((totalSteps / targetSteps) * 100))
      : null
  const isDone = progress?.done === true

  return (
    <>
      <PageHeader
        title="Training"
        description="Monitor and manage per-game training runs for your agents."
      />
      <div className="max-w-7xl mx-auto px-6 pb-8 space-y-6">
        {/* Game Selector Row */}
        <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-darkCard p-4 rounded-card border border-gray-200 dark:border-darkBorder shadow-sm">
          <label htmlFor="training-game-selector" className="form-label text-textMuted dark:text-gray-400 whitespace-nowrap mb-0">
            Game
          </label>
          <select
            id="training-game-selector"
            value={selectedGame}
            onChange={(e) => setGame(e.target.value || 'nfs_rivals')}
            disabled={gamesLoading}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-textPrimary dark:text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent min-w-[200px]"
          >
            {games.map((g) => (
              <option key={g} value={g}>
                {gameDisplayNames?.[g] || g}
              </option>
            ))}
          </select>
          {selectedGame && (
            <span className="text-sm text-textMuted dark:text-gray-400">
              Training for{' '}
              <strong className="text-textPrimary dark:text-gray-100">
                {gameDisplayName || gameDisplayNames?.[selectedGame] || selectedGame}
              </strong>
            </span>
          )}
        </div>

        {/* Banner: training running for a different game */}
        {runningForOtherGame && (
          <div className="rounded-lg border border-yellow-300 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200 shadow-sm flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>
              Training is currently running for <strong>{gameDisplayNames?.[runningGameKey] || runningGameKey}</strong>. Stop it or wait before starting another run.
            </span>
          </div>
        )}

        {loading ? (
          <LoadingSpinner label="Loading training status..." />
        ) : games.length === 0 ? (
          <div className="glass-card flex items-center justify-center p-12">
            <EmptyState
              imageSrc="/empty-state-games.svg"
              title="No game configs"
              description="Add a game in Game Configs before starting training."
            />
          </div>
        ) : (
          <>
            {error && (
              <div className="alert-error">{error}</div>
            )}

            <div className="glass-card p-8 space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-6 border-b border-gray-100 dark:border-gray-800 pb-6">
                <div>
                  <p className="form-label text-textMuted dark:text-gray-400">Training status</p>
                  <div className="flex items-center gap-3 mt-1">
                    {runningForThisGame && <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />}
                    <p className="font-display text-3xl font-bold text-textPrimary dark:text-gray-100">
                      {runningForThisGame
                        ? 'Running'
                        : isDone
                          ? (percent != null && percent < 1 ? 'Stopped early' : 'Completed')
                          : 'Idle'}
                    </p>
                  </div>
                  {progress?.updated_at && (
                    <p className="text-xs text-textLight dark:text-gray-500 mt-1.5 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Last update: {new Date(progress.updated_at * 1000).toLocaleTimeString()}
                    </p>
                  )}
                  {!runningForThisGame && !anyRunning && (
                    <p className="text-xs text-textMuted dark:text-gray-500 mt-1">
                      Showing the last known training snapshot for this game. New runs started from the dashboard or command line will continue from the saved model.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {runningForThisGame ? (
                    <button
                      type="button"
                      onClick={stopTraining}
                      disabled={starting}
                      className="btn-danger flex items-center gap-2"
                      title="Stops gracefully so the model is saved; next run will continue from here."
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                      </svg>
                      {starting ? 'Stopping…' : 'Stop training'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startTraining}
                      disabled={starting || runningForOtherGame || !selectedGame}
                      className="btn-primary flex items-center gap-2"
                      title={runningForOtherGame ? `Training is running for ${gameDisplayNames?.[runningGameKey] || runningGameKey}` : ''}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {starting ? 'Starting…' : 'Start training'}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="form-label text-textMuted dark:text-gray-400 mb-2">Progress</p>
                {percent != null ? (
                  <div className="space-y-3">
                    <div className="w-full h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 p-0.5">
                      <div
                        className="h-full bg-gradient-to-r from-accent to-blue-400 rounded-full transition-all duration-1000"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs font-mono">
                      <span className="text-textMuted dark:text-gray-400">
                        {totalSteps?.toLocaleString() ?? '—'} / {targetSteps?.toLocaleString() ?? '—'} steps
                      </span>
                      <span className="text-accent dark:text-blue-400 font-bold">{percent}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 text-center border border-gray-100 dark:border-gray-800">
                    <p className="text-sm text-textMuted dark:text-gray-500 font-mono">No progress data yet for this game.</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
                  <p className="form-label text-textMuted dark:text-gray-400 text-xs">Algorithm</p>
                  <p className="font-mono text-xl font-bold text-textPrimary dark:text-gray-100 mt-1">
                    {(progress?.algo || 'ppo').toUpperCase()}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
                  <p className="form-label text-textMuted dark:text-gray-400 text-xs">Episodes</p>
                  <p className="font-mono text-xl font-bold text-textPrimary dark:text-gray-100 mt-1">
                    {typeof progress?.episode === 'number' ? progress.episode.toLocaleString() : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
                  <p className="form-label text-textMuted dark:text-gray-400 text-xs">Mean reward (recent eps)</p>
                  <p className="font-mono text-xl font-bold text-textPrimary dark:text-gray-100 mt-1">
                    {typeof progress?.reward === 'number' ? progress.reward.toFixed(3) : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800">
                  <p className="form-label text-textMuted dark:text-gray-400 text-xs">Best reward</p>
                  <p className="font-mono text-xl font-bold text-textPrimary dark:text-gray-100 mt-1">
                    {typeof progress?.best_reward === 'number' ? progress.best_reward.toFixed(3) : '—'}
                  </p>
                </div>
              </div>
              {(typeof progress?.reward === 'number' || typeof progress?.best_reward === 'number') && (
                <p className="text-sm text-textMuted dark:text-gray-400 mt-2">
                  Trend: mean reward is the average return over recent completed episodes; best reward is the highest so far. An upward trend suggests the agent is learning.
                </p>
              )}
            </div>

            {/* Past training runs for this game */}
            {history.length > 0 && (
              <div className="glass-card p-6 space-y-3">
                <p className="form-label text-textMuted dark:text-gray-400 mb-1">Recent runs for this game</p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs border-separate border-spacing-y-1">
                    <thead className="text-textLight dark:text-gray-500">
                      <tr>
                        <th className="text-left pr-4">When</th>
                        <th className="text-left pr-4">Source</th>
                        <th className="text-left pr-4">Algo</th>
                        <th className="text-left pr-4">Steps</th>
                        <th className="text-left pr-4">Best reward</th>
                        <th className="text-left pr-4">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history
                        .slice()
                        .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
                        .slice(0, 8)
                        .map((run) => {
                          const started = typeof run.started_at === 'number' ? new Date(run.started_at * 1000) : null
                          const finished = typeof run.finished_at === 'number' ? new Date(run.finished_at * 1000) : null
                          const labelDate = finished || started
                          const source = (run.source || 'cli').toLowerCase()
                          const steps =
                            typeof run.total_timesteps === 'number' && typeof run.target_timesteps === 'number'
                              ? `${run.total_timesteps.toLocaleString()} / ${run.target_timesteps.toLocaleString()}`
                              : run.total_timesteps?.toLocaleString() ?? '—'
                          const best =
                            typeof run.best_reward === 'number' ? run.best_reward.toFixed(3) : '—'
                          const done = run.done === true
                          const pct =
                            typeof run.total_timesteps === 'number' &&
                            typeof run.target_timesteps === 'number' &&
                            run.target_timesteps > 0
                              ? Math.round((run.total_timesteps / run.target_timesteps) * 100)
                              : null
                          const statusLabel = done
                            ? pct != null && pct < 100
                              ? 'Stopped early'
                              : 'Completed'
                            : 'In progress'
                          return (
                            <tr key={run.run_id || `${run.game_key}-${run.updated_at || Math.random()}`}>
                              <td className="pr-4 text-textPrimary dark:text-gray-100">
                                {labelDate ? labelDate.toLocaleString() : '—'}
                              </td>
                              <td className="pr-4 text-textMuted dark:text-gray-400">
                                {source === 'dashboard' ? 'Dashboard' : 'CMD'}
                              </td>
                              <td className="pr-4 text-textPrimary dark:text-gray-100">
                                {(run.algo || 'ppo').toUpperCase()}
                              </td>
                              <td className="pr-4 text-textMuted dark:text-gray-400 font-mono">{steps}</td>
                              <td className="pr-4 text-textMuted dark:text-gray-400 font-mono">{best}</td>
                              <td className="pr-4 text-textMuted dark:text-gray-400">
                                {statusLabel}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
