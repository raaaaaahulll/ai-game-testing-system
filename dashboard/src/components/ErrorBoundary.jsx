import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error) {
    // Keep the UI alive even if a page throws.
    // eslint-disable-next-line no-console
    console.error('Dashboard page crashed:', error)
  }

  handleReload = () => {
    try {
      window.location.reload()
    } catch (_) {}
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const msg = this.state.error?.message || String(this.state.error || 'Unknown error')
    return (
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="alert-error">
          <p className="font-display font-semibold text-lg mb-1">Something went wrong</p>
          <p className="text-sm">
            This page crashed while rendering. Reload to recover.
          </p>
          <p className="mt-3 font-mono text-xs break-words opacity-90">
            {msg}
          </p>
          <div className="mt-4">
            <button type="button" className="btn-secondary" onClick={this.handleReload}>
              Reload dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}

