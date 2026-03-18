import React, { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from './PageHeader'
import ChessPage from './ChessPage'
import TicTacToeGame from './games/TicTacToeGame'
import ConnectFourGame from './games/ConnectFourGame'
import OthelloGame from './games/OthelloGame'
import CheckersGame from './games/CheckersGame'

const GAME_OPTIONS = [
  { id: 'chess', label: 'Chess', short: 'Chess' },
  { id: 'checkers', label: 'Checkers', short: 'Checkers' },
  { id: 'othello', label: 'Othello', short: 'Othello' },
  { id: 'connect4', label: 'Connect Four', short: 'Connect 4' },
  { id: 'tictactoe', label: 'Tic-Tac-Toe', short: 'Tic-Tac-Toe' },
]

function PlayPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const gameParam = searchParams.get('game') || 'chess'
  const selectedGame = useMemo(() => {
    const found = GAME_OPTIONS.find((o) => o.id === gameParam)
    return found ? found.id : 'chess'
  }, [gameParam])

  const setGame = (id) => {
    setSearchParams({ game: id }, { replace: true })
  }

  const GameContent = () => {
    switch (selectedGame) {
      case 'chess':
        return <ChessPage embedded />
      case 'tictactoe':
        return <TicTacToeGame />
      case 'connect4':
        return <ConnectFourGame />
      case 'othello':
        return <OthelloGame />
      case 'checkers':
        return <CheckersGame />
      default:
        return <ChessPage />
    }
  }

  return (
    <>
      <PageHeader
        title="Board game AI"
        description="Choose a game and play against the AI. Stockfish powers Chess; other games use in-browser AI."
      />
      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="glass-card mb-6">
          <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100 mb-3">Game</h2>
          <div className="flex flex-wrap gap-2">
            {GAME_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setGame(id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedGame === id
                    ? 'bg-accent text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-textPrimary dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <GameContent />
      </div>
    </>
  )
}

export default PlayPage
