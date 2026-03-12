import { useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from './EmptyState'
import { IconAnalytics } from './Icons'

// ── Hardware-cause badge ───────────────────────────────────────────────────
function HWBadge({ bug }) {
  const fps = bug.fps_at_bug
  const hwCaused = bug.pc_was_struggling === true

  if (fps == null && bug.pc_was_struggling == null) return null   // old report, no data

  return hwCaused ? (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
                 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      title={fps != null ? `FPS at time of report: ${fps}` : 'PC was struggling when this was reported'}
    >
      ⚠️ HW-Caused{fps != null ? ` (${fps} fps)` : ''}
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
                 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      title={fps != null ? `FPS at time of report: ${fps}` : 'PC was healthy when this was reported'}
    >
      ✅ Real Bug{fps != null ? ` (${fps} fps)` : ''}
    </span>
  )
}

// ── Single bug card ────────────────────────────────────────────────────────
function BugCard({ bug, apiBase }) {
  const [screenshot, setScreenshot] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadScreenshot = () => {
    if (!bug.has_screenshot || screenshot !== null) return
    setLoading(true)
    fetch(`${apiBase}/bugs/${bug.id}/screenshot`)
      .then((r) => r.json())
      .then((d) => setScreenshot(d.base64))
      .catch(() => setScreenshot(''))
      .finally(() => setLoading(false))
  }

  const date = bug.created_at
    ? new Date(bug.created_at).toLocaleString()
    : new Date(bug.timestamp * 1000).toLocaleString()

  const severity = (bug.severity || 'minor').toLowerCase()
  const severityMap = { critical: 'critical', major: 'high', minor: 'low', high: 'high', medium: 'medium', low: 'low' }
  const severityKey = severityMap[severity] || 'low'
  const severityStyle = {
    critical: 'bg-severityCriticalBg text-severityCriticalText',
    high: 'bg-severityHighBg text-severityHighText',
    medium: 'bg-severityMediumBg text-severityMediumText',
    low: 'bg-severityLowBg text-severityLowText',
  }[severityKey] || 'bg-severityLowBg text-severityLowText'

  return (
    <div
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-card shadow-card overflow-hidden hover:border-accent/50 transition-all duration-200 hover:shadow-md"
      onMouseEnter={loadScreenshot}
    >
      <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col gap-2">
        <div className="flex justify-between items-start gap-2">
          <span className="font-mono text-sm font-semibold text-textPrimary dark:text-gray-100 block truncate">
            {bug.type}
          </span>
          <span className="text-textLight dark:text-gray-500 text-xs flex-shrink-0">#{bug.id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${severityStyle}`}>
            {severity}
          </span>
          <HWBadge bug={bug} />
        </div>
        <p className="text-textMuted dark:text-gray-400 text-xs">{date}</p>
        {bug.trace_filename && (
          <p className="text-textMuted dark:text-gray-500 text-xs font-mono truncate" title={bug.trace_filename}>
            trace: {bug.trace_filename}
          </p>
        )}
      </div>
      <div className="aspect-video bg-gray-100 dark:bg-gray-900 flex items-center justify-center min-h-[120px]">
        {loading && <span className="text-textMuted dark:text-gray-400 text-sm">Loading…</span>}
        {screenshot && !loading && (
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="Bug screenshot"
            className="max-w-full max-h-full object-contain"
          />
        )}
        {!screenshot && !loading && bug.has_screenshot && (
          <span className="text-textMuted dark:text-gray-400 text-sm">Hover to load</span>
        )}
        {!screenshot && !loading && !bug.has_screenshot && (
          <span className="text-textMuted dark:text-gray-400 text-sm">No screenshot</span>
        )}
      </div>
    </div>
  )
}

// ── Filter tab button ──────────────────────────────────────────────────────
const FILTERS = [
  { id: 'all', label: 'All Bugs' },
  { id: 'real', label: '✅ Confirmed Real' },
  { id: 'hardware', label: '⚠️ Hardware-Caused' },
  { id: 'unknown', label: 'Unknown' },
]

function filterBugs(bugs, filter) {
  if (filter === 'real') return bugs.filter((b) => b.pc_was_struggling === false)
  if (filter === 'hardware') return bugs.filter((b) => b.pc_was_struggling === true)
  if (filter === 'unknown') return bugs.filter((b) => b.pc_was_struggling == null)
  return bugs
}

// ── BugGallery ─────────────────────────────────────────────────────────────
export default function BugGallery({ bugs, apiBase }) {
  const [activeFilter, setActiveFilter] = useState('all')

  const counts = {
    all: bugs.length,
    real: bugs.filter((b) => b.pc_was_struggling === false).length,
    hardware: bugs.filter((b) => b.pc_was_struggling === true).length,
    unknown: bugs.filter((b) => b.pc_was_struggling == null).length,
  }

  const visible = filterBugs(bugs, activeFilter)

  return (
    <section>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg font-semibold text-textPrimary dark:text-gray-100 tracking-wide">
          DETECTED GLITCHES
        </h2>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveFilter(id)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all duration-150 whitespace-nowrap ${activeFilter === id
                  ? 'bg-white dark:bg-gray-700 text-textPrimary dark:text-gray-100 shadow-sm'
                  : 'text-textMuted dark:text-gray-400 hover:text-textPrimary dark:hover:text-gray-200'
                }`}
            >
              {label}
              <span className="ml-1 text-textLight dark:text-gray-500">({counts[id]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visible.map((bug) => (
          <BugCard key={bug.id} bug={bug} apiBase={apiBase} />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="glass-card">
          {bugs.length === 0 ? (
            <EmptyState
              imageSrc="/empty-state-bugs.svg"
              title="No bugs reported yet"
              description="Start the agent from Session & Analytics to collect reports for the selected game."
              action={
                <Link to="/analytics" className="btn-primary btn-icon">
                  <IconAnalytics />
                  Go to Session & Analytics
                </Link>
              }
            />
          ) : (
            <EmptyState
              compact
              title="No bugs match this filter"
              description={`Switch to "All Bugs" to see all ${bugs.length} reported issue${bugs.length !== 1 ? 's' : ''}.`}
              action={
                <button type="button" className="btn-secondary" onClick={() => setActiveFilter('all')}>
                  Show all bugs
                </button>
              }
            />
          )}
        </div>
      )}
    </section>
  )
}
