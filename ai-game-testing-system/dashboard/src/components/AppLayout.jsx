import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { GameProvider, useGame } from '../context/GameContext'
import ErrorBoundary from './ErrorBoundary'

// ── Dark mode hook ─────────────────────────────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [dark])

  return [dark, setDark]
}

// ── Nav icons ─────────────────────────────────────────────────────────────
const navIcon = (name) => {
  const cls = 'w-5 h-5 flex-shrink-0'
  switch (name) {
    case 'dashboard':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    case 'analytics':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    case 'sessions':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )
    case 'training':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3v7a3 3 0 006 0v-7c0-1.657-1.343-3-3-3z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5a3 3 0 016 0v3H9V5z" />
        </svg>
      )
    case 'chess':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'game-configs':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    default:
      return null
  }
}

// ── Sun / Moon icons for dark toggle ──────────────────────────────────────
function SunIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07l-.71.71M6.34 17.66l-.71.71m12.02 0l-.71-.71M6.34 6.34l-.71-.71M12 5a7 7 0 100 14A7 7 0 0012 5z" />
    </svg>
  )
}
function MoonIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/analytics', label: 'Session & Analytics', icon: 'analytics' },
  { to: '/sessions', label: 'Previous Sessions', icon: 'sessions' },
  { to: '/game-configs', label: 'Game Configs', icon: 'game-configs' },
  { to: '/training', label: 'Training', icon: 'training' },
  { to: '/play', label: 'Board game AI', icon: 'chess' },
]

function AppLayoutInner() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [dark, setDark] = useDarkMode()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { game, setGame, games, loading: gamesLoading, gameDisplayName, appTitle } = useGame()

  useEffect(() => {
    document.title = gameDisplayName ? `${appTitle} — ${gameDisplayName}` : appTitle
    return () => { document.title = appTitle }
  }, [appTitle, gameDisplayName])

  // Prevent accidental browser zoom on Ctrl+wheel / trackpad pinch.
  useEffect(() => {
    const onWheel = (e) => { if (e.ctrlKey) e.preventDefault() }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="h-screen bg-surfaceMuted dark:bg-darkSurface text-textPrimary dark:text-gray-100 flex overflow-hidden">
      {/* ── Sidebar ── */}
      <aside
        className={`border-r border-white/10 bg-sidebar flex-shrink-0 flex flex-col transition-all duration-200 ${sidebarCollapsed ? 'w-[4.5rem]' : 'w-56'
          }`}
      >
        {/* Logo */}
        <div className={`p-4 border-b border-white/10 flex items-center ${sidebarCollapsed ? 'justify-center' : ''}`}>
          <img src="/logo.svg" alt="AI Game Tester" className="w-10 h-10 flex-shrink-0 rounded-lg" />
          {!sidebarCollapsed && (
            <div className="ml-3 min-w-0 flex-1">
              <p className="font-semibold text-white truncate">AI Test Suite</p>
              <p className="text-xs text-gray-400 truncate">Gaming Automation</p>
            </div>
          )}
        </div>

        {/* Nav links */}
        <nav className="p-3 space-y-1 flex-1">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 py-2.5 rounded-lg text-sm transition-colors pl-3 ${isActive
                  ? 'bg-navActiveBg text-navActiveText font-medium'
                  : 'text-gray-300 hover:bg-sidebarHover hover:text-white'
                }`
              }
            >
              {navIcon(icon)}
              {!sidebarCollapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom controls */}
        <div className="p-3 border-t border-white/10 space-y-1">
          {/* Dark mode toggle */}
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-sidebarHover hover:text-white transition-colors"
          >
            {dark
              ? <SunIcon className="w-5 h-5 flex-shrink-0" />
              : <MoonIcon className="w-5 h-5 flex-shrink-0" />}
            {!sidebarCollapsed && <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>

          {/* Collapse toggle — icon direction fixes #11 */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-sidebarHover hover:text-white transition-colors"
          >
            {/* Show >> when collapsed (expand), << when expanded (collapse) */}
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {sidebarCollapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />   /* >> expand */
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /> /* << collapse */
              }
            </svg>
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>

          {/* Logout */}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!sidebarCollapsed && <span>Log Out</span>}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-surfaceMuted dark:bg-darkSurface overflow-hidden">
        <main className="flex-1 min-w-0 overflow-y-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export default function AppLayout() {
  return (
    <GameProvider>
      <AppLayoutInner />
    </GameProvider>
  )
}
