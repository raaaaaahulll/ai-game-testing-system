import { useState } from 'react'

export default function SessionBugCard({ bug, apiBase }) {
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

  return (
    <div
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-card shadow-card overflow-hidden hover:border-accent/50 transition-colors"
      onMouseEnter={loadScreenshot}
    >
      <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start">
        <div>
          <span className="font-mono text-sm font-semibold text-textPrimary dark:text-gray-100">{bug.type}</span>
          <p className="text-textMuted dark:text-gray-400 text-xs mt-1">{date}</p>
        </div>
        <span className="text-textLight dark:text-gray-500 text-xs">#{bug.id}</span>
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
