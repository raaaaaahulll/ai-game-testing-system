import React, { useState, useCallback, useMemo, useEffect } from 'react'

const ROWS = 6
const COLS = 7

function getEmptyBoard() {
  return Array(ROWS).fill(null).map(() => Array(COLS).fill(null))
}

function dropPiece(board, col, player) {
  const next = board.map((row) => [...row])
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!next[r][col]) {
      next[r][col] = player
      return { board: next, row: r }
    }
  }
  return null
}

function checkWin(board, row, col, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (const [dr, dc] of dirs) {
    let count = 1
    let r = row + dr
    let c = col + dc
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      count++
      r += dr
      c += dc
    }
    r = row - dr
    c = col - dc
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      count++
      r -= dr
      c -= dc
    }
    if (count >= 4) return true
  }
  return false
}

function isFull(board) {
  return board[0].every(Boolean)
}

function minimax(board, depth, alpha, beta, isMax) {
  const winner = (() => {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] && checkWin(board, r, c, board[r][c])) return board[r][c]
    return null
  })()
  if (winner === 'O') return 100 - depth
  if (winner === 'X') return -100 + depth
  if (isFull(board) || depth === 0) return 0

  if (isMax) {
    let best = -Infinity
    for (let col = 0; col < COLS; col++) {
      const result = dropPiece(board, col, 'O')
      if (!result) continue
      const score = minimax(result.board, depth - 1, alpha, beta, false)
      best = Math.max(best, score)
      alpha = Math.max(alpha, score)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (let col = 0; col < COLS; col++) {
      const result = dropPiece(board, col, 'X')
      if (!result) continue
      const score = minimax(result.board, depth - 1, alpha, beta, true)
      best = Math.min(best, score)
      beta = Math.min(beta, score)
      if (beta <= alpha) break
    }
    return best
  }
}

function getAIMove(board) {
  let bestCol = 0
  let bestScore = -Infinity
  const depth = 5
  for (let col = 0; col < COLS; col++) {
    const result = dropPiece(board, col, 'O')
    if (!result) continue
    const score = minimax(result.board, depth, -Infinity, Infinity, false)
    if (score > bestScore) {
      bestScore = score
      bestCol = col
    }
  }
  return bestCol
}

export default function ConnectFourGame() {
  const [board, setBoard] = useState(getEmptyBoard)
  const [isPlayerTurn, setIsPlayerTurn] = useState(true)
  const [winner, setWinner] = useState(null)

  const playColumn = useCallback((col) => {
    if (winner || !isPlayerTurn) return
    const result = dropPiece(board, col, 'X')
    if (!result) return
    const playerWon = checkWin(result.board, result.row, col, 'X')
    const full = isFull(result.board)
    setBoard(result.board)
    if (playerWon) setWinner('X')
    else if (full) setWinner('draw')
    else setIsPlayerTurn(false)
  }, [board, isPlayerTurn, winner])

  useEffect(() => {
    if (isPlayerTurn || winner) return
    const col = getAIMove(board)
    const result = dropPiece(board, col, 'O')
    if (!result) {
      setIsPlayerTurn(true)
      return
    }
    setBoard(result.board)
    if (checkWin(result.board, result.row, col, 'O')) setWinner('O')
    else if (isFull(result.board)) setWinner('draw')
    else setIsPlayerTurn(true)
  }, [isPlayerTurn, winner])

  const startNew = () => {
    setBoard(getEmptyBoard())
    setWinner(null)
    setIsPlayerTurn(true)
  }

  const status = winner
    ? winner === 'draw' ? "It's a draw!" : winner === 'X' ? 'You win!' : 'AI wins!'
    : isPlayerTurn ? 'Your turn — click a column to drop' : 'AI thinking…'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary mb-4">Connect Four</h2>
          <p className="text-textMuted text-sm mb-4">{status}</p>
          <div className="inline-block p-2 bg-blue-900 rounded-lg">
            <div className="flex gap-1 mb-1">
              {Array(COLS).fill(0).map((_, c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => playColumn(c)}
                  disabled={!!winner || !isPlayerTurn || board[0][c]}
                  className="w-10 h-8 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium"
                >
                  ↓
                </button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" style={{ width: COLS * 44 }}>
              {board.flat().map((cell, i) => (
                <div
                  key={i}
                  className="w-10 h-10 rounded-full border-2 border-gray-700 flex-shrink-0 bg-gray-800 flex items-center justify-center"
                >
                  {cell && (
                    <div
                      className={`w-8 h-8 rounded-full ${cell === 'X' ? 'bg-red-500' : 'bg-yellow-400'}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary mb-4">Controls</h2>
          <p className="text-textMuted text-xs mb-2">You are red (X). AI is yellow (O).</p>
          <button type="button" onClick={startNew} className="btn-primary w-full">
            New game
          </button>
        </div>
      </div>
    </div>
  )
}
