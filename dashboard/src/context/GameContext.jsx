import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../api'

const STORAGE_KEY = 'dashboard_game_key'

const GameContext = createContext(null)

const APP_TITLE = 'AI Game Tester'

export function GameProvider({ children }) {
  const [games, setGames] = useState(['nfs_rivals'])
  const [gameDisplayNames, setGameDisplayNames] = useState({})
  const [game, setGameState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'nfs_rivals'
    } catch {
      return 'nfs_rivals'
    }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_BASE}/games`).then((r) => (r.ok ? r.json() : { games: ['nfs_rivals'] })),
      fetch(`${API_BASE}/game-configs`).then((r) => (r.ok ? r.json() : { configs: [] })),
    ])
      .then(([gamesRes, configsRes]) => {
        if (cancelled) return
        if (Array.isArray(gamesRes.games) && gamesRes.games.length) setGames(gamesRes.games)
        const map = {}
        for (const c of configsRes.configs || []) {
          if (c.game_key && c.display_name) map[c.game_key] = c.display_name
        }
        setGameDisplayNames(map)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const setGame = useCallback((value) => {
    setGameState(value)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch (_) {}
  }, [])

  const gameDisplayName = gameDisplayNames[game] || game || 'Game'

  return (
    <GameContext.Provider value={{ game, setGame, games, loading, gameDisplayName, gameDisplayNames: gameDisplayNames, appTitle: APP_TITLE }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used within GameProvider')
  return ctx
}
