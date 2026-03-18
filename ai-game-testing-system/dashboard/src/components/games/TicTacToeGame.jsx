import React, { useState, useCallback, useMemo } from 'react'

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function getWinner(squares) {
  for (const [a, b, c] of WIN_LINES) {
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) return squares[a]
  }
  return null
}

function getBestMove(squares, player) {
  const opponent = player === 'X' ? 'O' : 'X'
  function score(s, isMax) {
    const w = getWinner(s)
    if (w === 'O') return 1
    if (w === 'X') return -1
    if (s.every(Boolean)) return 0
    const moves = s.map((v, i) => (v ? null : i)).filter((i) => i !== null)
    if (isMax) {
      let best = -Infinity
      for (const i of moves) {
        const next = [...s]
        next[i] = 'O'
        best = Math.max(best, score(next, false))
      }
      return best
    } else {
      let best = Infinity
      for (const i of moves) {
        const next = [...s]
        next[i] = 'X'
        best = Math.min(best, score(next, true))
      }
      return best
    }
  }
  const moves = squares.map((v, i) => (v ? null : i)).filter((i) => i !== null)
  let bestIdx = moves[0]
  let bestScore = -Infinity
  for (const i of moves) {
    const next = [...squares]
    next[i] = 'O'
    const s = score(next, false)
    if (s > bestScore) {
      bestScore = s
      bestIdx = i
    }
  }
  return bestIdx
}

export default function TicTacToeGame() {
  const [squares, setSquares] = useState(Array(9).fill(null))
  const [isPlayerTurn, setIsPlayerTurn] = useState(true)

  const winner = useMemo(() => getWinner(squares), [squares])
  const draw = useMemo(() => !winner && squares.every(Boolean), [squares, winner])
  const gameOver = winner || draw

  const makeMove = useCallback((index) => {
    if (squares[index] || !isPlayerTurn || gameOver) return
    const next = [...squares]
    next[index] = 'X'
    setSquares(next)
    setIsPlayerTurn(false)
  }, [squares, isPlayerTurn, gameOver])

  React.useEffect(() => {
    if (isPlayerTurn || gameOver) return
    const w = getWinner(squares)
    if (w) return
    const move = getBestMove(squares, 'O')
    const next = [...squares]
    next[move] = 'O'
    setSquares(next)
    setIsPlayerTurn(true)
  }, [isPlayerTurn, gameOver, squares])

  const startNew = () => {
    setSquares(Array(9).fill(null))
    setIsPlayerTurn(true)
  }

  const status = gameOver
    ? winner ? (winner === 'X' ? 'You win!' : 'AI wins!') : "It's a draw!"
    : isPlayerTurn ? 'Your turn (X)' : 'AI thinking…'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100 mb-4">Tic-Tac-Toe</h2>
          <p className="text-textMuted dark:text-gray-400 text-sm mb-4">{status}</p>
          <div className="inline-grid grid-cols-3 gap-2 bg-gray-200 dark:bg-gray-700 p-2 rounded-lg" style={{ width: 'min(90vw, 240px)' }}>
            {squares.map((val, i) => (
              <button
                key={i}
                type="button"
                onClick={() => makeMove(i)}
                disabled={!!val || !isPlayerTurn || !!gameOver}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 flex items-center justify-center text-2xl font-bold text-textPrimary dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
              >
                {val || ''}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100 mb-4">Controls</h2>
          <button type="button" onClick={startNew} className="btn-primary w-full">
            New game
          </button>
        </div>
      </div>
    </div>
  )
}
