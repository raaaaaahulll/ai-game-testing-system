import { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../api'

function HeatmapGrid({ heatmap, gridSize }) {
  const gridData = useMemo(() => {
    const g = Array(gridSize)
      .fill(0)
      .map(() => Array(gridSize).fill(0))
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

  return (
    <div
      className="inline-grid gap-0.5 rounded overflow-hidden bg-gray-200"
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
  )
}

export default function TestingSummary({ stats }) {
  const [coverage, setCoverage] = useState({ heatmap: [], gridSize: 50, message: '' })

  useEffect(() => {
    function fetchCoverage() {
      fetch(`${API_BASE}/coverage`)
        .then((r) => (r.ok ? r.json() : { heatmap: [], gridSize: 50, message: 'N/A' }))
        .then(setCoverage)
        .catch(() => setCoverage({ heatmap: [], gridSize: 50, message: 'N/A' }))
    }
    fetchCoverage()
    const interval = setInterval(fetchCoverage, 5000)
    return () => clearInterval(interval)
  }, [])

  const hasHeatmap = coverage.heatmap && coverage.heatmap.length > 0

  return (
    <section className="mb-10">
      <h2 className="font-display text-lg font-semibold text-textPrimary mb-4 tracking-wide">
        TESTING SUMMARY
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-kpi-orange rounded-card shadow-card p-6 border border-orange-100">
          <p className="form-label text-textMuted">Total bugs reported</p>
          <p className="font-display text-3xl font-bold text-textPrimary mt-1">{stats.total_bugs}</p>
        </div>
        <div className="bg-kpi-purple rounded-card shadow-card p-6 border border-purple-100">
          <p className="form-label text-textMuted">Last 24 hours</p>
          <p className="font-display text-3xl font-bold text-textPrimary mt-1">{stats.bugs_last_24h}</p>
        </div>
        <div className="bg-kpi-green rounded-card shadow-card p-6 border border-green-100">
          <p className="form-label text-textMuted">Coverage</p>
          <p className="font-mono text-sm text-textMuted mt-1">
            {hasHeatmap
              ? `${coverage.heatmap.length} cells visited`
              : coverage.message || 'Run the agent to build coverage.'}
          </p>
        </div>
      </div>
      <div className="glass-card min-h-[200px]">
        <p className="text-textMuted text-sm mb-3">
          {coverage.gridSize === 100
            ? 'Exploration heatmap (GPS from minimap; darker = less visited, red = more)'
            : 'Exploration heatmap (pseudo-position from agent actions; darker = less visited, red = more)'}
        </p>
        {hasHeatmap ? (
          <HeatmapGrid heatmap={coverage.heatmap} gridSize={coverage.gridSize || 50} />
        ) : (
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg h-48 flex items-center justify-center text-textMuted dark:text-gray-400 font-mono text-sm">
            {coverage.message || 'Run the agent to build coverage data.'}
          </div>
        )}
      </div>
    </section>
  )
}
