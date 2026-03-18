import React, { useState, useCallback, useMemo, useEffect } from 'react'

const SIZE = 8
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]

function getInitialBoard() {
  const b = Array(SIZE).fill(null).map(() => Array(SIZE).fill(null))
  const m = SIZE / 2
  b[m-1][m-1] = b[m][m] = 'W'
  b[m-1][m] = b[m][m-1] = 'B'
  return b
}

function getFlips(board, row, col, player) {
  const opponent = player === 'B' ? 'W' : 'B'
  const flips = []
  for (const [dr, dc] of DIRS) {
    const line = []
    let r = row + dr, c = col + dc
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === opponent) {
      line.push([r, c])
      r += dr
      c += dc
    }
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player && line.length > 0)
      flips.push(...line)
  }
  return flips
}

function getValidMoves(board, player) {
  const moves = []
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (!board[r][c] && getFlips(board, r, c, player).length > 0) moves.push([r, c])
  return moves
}

function makeMove(board, row, col, player) {
  const flips = getFlips(board, row, col, player)
  if (flips.length === 0) return null
  const next = board.map((row) => [...row])
  next[row][col] = player
  for (const [r, c] of flips) next[r][c] = player
  return next
}

function countPieces(board) {
  let b = 0, w = 0
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 'B') b++
      else if (board[r][c] === 'W') w++
    }
  return { b, w }
}

function evalBoard(board) {
  const { b, w } = countPieces(board)
  return w - b
}

function minimax(board, depth, alpha, beta, isMax) {
  const playerMoves = getValidMoves(board, 'W')
  const oppMoves = getValidMoves(board, 'B')
  if (depth === 0 || (playerMoves.length === 0 && oppMoves.length === 0)) return evalBoard(board)
  const moves = isMax ? playerMoves : oppMoves
  const player = isMax ? 'W' : 'B'
  if (moves.length === 0) return minimax(board, depth - 1, alpha, beta, !isMax)
  if (isMax) {
    let best = -Infinity
    for (const [r, c] of moves) {
      const next = makeMove(board, r, c, player)
      if (!next) continue
      const score = minimax(next, depth - 1, alpha, beta, false)
      best = Math.max(best, score)
      alpha = Math.max(alpha, score)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const [r, c] of moves) {
      const next = makeMove(board, r, c, player)
      if (!next) continue
      const score = minimax(next, depth - 1, alpha, beta, true)
      best = Math.min(best, score)
      beta = Math.min(beta, score)
      if (beta <= alpha) break
    }
    return best
  }
}

function getAIMove(board) {
  const moves = getValidMoves(board, 'W')
  if (moves.length === 0) return null
  let best = moves[0]
  let bestScore = -Infinity
  const depth = 3
  for (const [r, c] of moves) {
    const next = makeMove(board, r, c, 'W')
    if (!next) continue
    const score = minimax(next, depth, -Infinity, Infinity, false)
    if (score > bestScore) {
      bestScore = score
      best = [r, c]
    }
  }
  return best
}

export default function OthelloGame() {
  const [board, setBoard] = useState(getInitialBoard)
  const [currentPlayer, setCurrentPlayer] = useState('B')
  const [gameOver, setGameOver] = useState(false)

  const validMoves = useMemo(() => getValidMoves(board, currentPlayer), [board, currentPlayer])
  const { b: blackCount, w: whiteCount } = useMemo(() => countPieces(board), [board])

  useEffect(() => {
    if (gameOver || currentPlayer !== 'W') return
    const moves = getValidMoves(board, 'W')
    if (moves.length === 0) {
      const oppMoves = getValidMoves(board, 'B')
      if (oppMoves.length === 0) setGameOver(true)
      else setCurrentPlayer('B')
      return
    }
    const [r, c] = getAIMove(board)
    const next = makeMove(board, r, c, 'W')
    if (next) {
      setBoard(next)
      const nextBMoves = getValidMoves(next, 'B')
      if (nextBMoves.length === 0) {
        const nextWMoves = getValidMoves(next, 'W')
        if (nextWMoves.length === 0) setGameOver(true)
        else setCurrentPlayer('W')
      } else setCurrentPlayer('B')
    }
  }, [currentPlayer, gameOver, board])

  const play = useCallback((row, col) => {
    if (currentPlayer !== 'B' || gameOver) return
    const next = makeMove(board, row, col, 'B')
    if (!next) return
    setBoard(next)
    const wMoves = getValidMoves(next, 'W')
    if (wMoves.length === 0) {
      const bMoves = getValidMoves(next, 'B')
      if (bMoves.length === 0) setGameOver(true)
      else setCurrentPlayer('B')
    } else setCurrentPlayer('W')
  }, [board, currentPlayer, gameOver])

  const startNew = () => {
    setBoard(getInitialBoard())
    setCurrentPlayer('B')
    setGameOver(false)
  }

  const status = gameOver
    ? blackCount > whiteCount ? 'You win!' : whiteCount > blackCount ? 'AI wins!' : "It's a draw!"
    : currentPlayer === 'B'
      ? 'Your turn (Black)'
      : 'AI thinking…'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary mb-4">Othello</h2>
          <p className="text-textMuted text-sm mb-2">{status}</p>
          <p className="text-textMuted text-xs mb-4">Black: {blackCount} — White: {whiteCount}</p>
          <div className="inline-grid grid-cols-8 gap-0.5 bg-green-800 p-1 rounded-lg" style={{ width: 'min(90vw, 320px)' }}>
            {board.flat().map((cell, i) => {
              const r = Math.floor(i / SIZE)
              const c = i % SIZE
              const isValid = currentPlayer === 'B' && validMoves.some(([mr, mc]) => mr === r && mc === c)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => play(r, c)}
                  disabled={!!cell || currentPlayer !== 'B' || gameOver}
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded flex items-center justify-center border ${
                    isValid ? 'ring-2 ring-yellow-400 bg-green-600' : 'bg-green-700 border-green-800'
                  } ${!cell ? 'hover:bg-green-600' : ''} disabled:cursor-default transition-colors`}
                >
                  {cell && (
                    <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full ${cell === 'B' ? 'bg-gray-900' : 'bg-white'}`} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary mb-4">Controls</h2>
          <p className="text-textMuted text-xs mb-2">You are Black. Click a valid green cell to place a piece and flip AI pieces.</p>
          <button type="button" onClick={startNew} className="btn-primary w-full">
            New game
          </button>
        </div>
      </div>
    </div>
  )
}
