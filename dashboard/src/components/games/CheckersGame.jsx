import React, { useState, useCallback, useMemo, useEffect } from 'react'

const SIZE = 8
const EMPTY = null
const BLACK = 'B'
const RED = 'R'
const BLACK_KING = 'BK'
const RED_KING = 'RK'

function getInitialBoard() {
  const b = Array(SIZE).fill(null).map(() => Array(SIZE).fill(EMPTY))
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) b[r][c] = RED
        else if (r > 4) b[r][c] = BLACK
      }
    }
  }
  return b
}

function isRed(p) { return p === RED || p === RED_KING }
function isBlack(p) { return p === BLACK || p === BLACK_KING }
function isKing(p) { return p === RED_KING || p === BLACK_KING }

function getJumpMoves(board, r, c, player) {
  const moves = []
  const piece = board[r][c]
  if (!piece) return moves
  const isP1 = player === BLACK
  const dr = isP1 ? -1 : 1
  const dirs = [[dr, -1], [dr, 1]]
  if (isKing(piece)) dirs.push([-dr, -1], [-dr, 1])
  for (const [drr, dcc] of dirs) {
    const r2 = r + drr * 2
    const c2 = c + dcc * 2
    const r1 = r + drr
    const c1 = c + dcc
    if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) continue
    if (board[r2][c2]) continue
    const mid = board[r1][c1]
    if (!mid) continue
    if (isP1 && isBlack(mid)) continue
    if (!isP1 && isRed(mid)) continue
    moves.push({ from: [r, c], to: [r2, c2], jump: [r1, c1] })
  }
  return moves
}

function getSimpleMoves(board, r, c, player) {
  const moves = []
  const piece = board[r][c]
  if (!piece) return moves
  const isP1 = player === BLACK
  let dirs = isP1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]
  if (isKing(piece)) dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  for (const [drr, dcc] of dirs) {
    const r2 = r + drr
    const c2 = c + dcc
    if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) continue
    if (!board[r2][c2]) moves.push({ from: [r, c], to: [r2, c2], jump: null })
  }
  return moves
}

function getAllMoves(board, player) {
  let jumps = []
  let simples = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!board[r][c]) continue
      if (player === BLACK && !isBlack(board[r][c])) continue
      if (player === RED && !isRed(board[r][c])) continue
      const j = getJumpMoves(board, r, c, player)
      jumps = jumps.concat(j)
      simples = simples.concat(getSimpleMoves(board, r, c, player))
    }
  }
  if (jumps.length > 0) return jumps
  return simples
}

function applyMove(board, move, movingPlayer) {
  const next = board.map((row) => row.map((c) => c))
  const [fr, fc] = move.from
  const [tr, tc] = move.to
  const piece = next[fr][fc]
  next[fr][fc] = EMPTY
  next[tr][tc] = piece
  if (move.jump) {
    const [jr, jc] = move.jump
    next[jr][jc] = EMPTY
  }
  const crown = (movingPlayer === BLACK && tr === 0) || (movingPlayer === RED && tr === SIZE - 1)
  if (piece === BLACK && crown) next[tr][tc] = BLACK_KING
  if (piece === RED && crown) next[tr][tc] = RED_KING
  return next
}

function pieceCount(board, side) {
  let n = 0
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c]
      if (!p) continue
      if (side === BLACK && isBlack(p)) n += isKing(p) ? 2 : 1
      if (side === RED && isRed(p)) n += isKing(p) ? 2 : 1
    }
  return n
}

function evalBoard(board) {
  return pieceCount(board, RED) - pieceCount(board, BLACK)
}

function minimax(board, depth, alpha, beta, isRedTurn) {
  const moving = isRedTurn ? RED : BLACK
  const moves = getAllMoves(board, moving)
  if (depth === 0 || moves.length === 0) return evalBoard(board)
  if (isRedTurn) {
    let best = -Infinity
    for (const move of moves) {
      const next = applyMove(board, move, moving)
      const score = minimax(next, depth - 1, alpha, beta, false)
      best = Math.max(best, score)
      alpha = Math.max(alpha, score)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const move of moves) {
      const next = applyMove(board, move)
      const score = minimax(next, depth - 1, alpha, beta, true)
      best = Math.min(best, score)
      beta = Math.min(beta, score)
      if (beta <= alpha) break
    }
    return best
  }
}

function getAIMove(board) {
  const moves = getAllMoves(board, RED)
  if (moves.length === 0) return null
  let best = moves[0]
  let bestScore = -Infinity
  const depth = 3
  for (const move of moves) {
    const next = applyMove(board, move, RED)
    const score = minimax(next, depth, -Infinity, Infinity, false)
    if (score > bestScore) {
      bestScore = score
      best = move
    }
  }
  return best
}

export default function CheckersGame() {
  const [board, setBoard] = useState(getInitialBoard)
  const [currentPlayer, setCurrentPlayer] = useState(BLACK)
  const [selected, setSelected] = useState(null)
  const [gameOver, setGameOver] = useState(false)

  const validMoves = useMemo(() => {
    if (!selected) return []
    const [r, c] = selected
    const piece = board[r][c]
    if (!piece || (currentPlayer === BLACK && !isBlack(piece)) || (currentPlayer === RED && !isRed(piece)))
      return []
    const allJumps = getAllMoves(board, currentPlayer).filter((m) => m.jump)
    if (allJumps.length > 0) {
      return allJumps.filter((m) => m.from[0] === r && m.from[1] === c)
    }
    return getSimpleMoves(board, r, c, currentPlayer)
  }, [board, currentPlayer, selected])

  const anyValidMoves = useMemo(() => getAllMoves(board, currentPlayer).length > 0, [board, currentPlayer])

  const handleCellClick = useCallback((r, c) => {
    if (gameOver) return
    const piece = board[r][c]
    const moveToHere = validMoves.find((m) => m.to[0] === r && m.to[1] === c)
    if (moveToHere) {
      const next = applyMove(board, moveToHere)
      setBoard(next)
      setSelected(null)
      setCurrentPlayer(currentPlayer === BLACK ? RED : BLACK)
      const nextMoves = getAllMoves(next, currentPlayer === BLACK ? RED : BLACK)
      if (nextMoves.length === 0) setGameOver(true)
      return
    }
    if (piece && ((currentPlayer === BLACK && isBlack(piece)) || (currentPlayer === RED && isRed(piece))))
      setSelected([r, c])
    else
      setSelected(null)
  }, [board, currentPlayer, gameOver, validMoves])

  useEffect(() => {
    if (gameOver || currentPlayer !== RED) return
    const moves = getAllMoves(board, RED)
    if (moves.length === 0) {
      setGameOver(true)
      return
    }
    const move = getAIMove(board)
    if (move) {
      const nextBoard = applyMove(board, move, RED)
      setBoard(nextBoard)
      setCurrentPlayer(BLACK)
      const nextMoves = getAllMoves(nextBoard, BLACK)
      if (nextMoves.length === 0) setGameOver(true)
    }
  }, [currentPlayer, gameOver])

  const startNew = () => {
    setBoard(getInitialBoard())
    setCurrentPlayer(BLACK)
    setSelected(null)
    setGameOver(false)
  }

  const status = gameOver
    ? 'Game over'
    : currentPlayer === BLACK
      ? 'Your turn (Black)'
      : 'AI thinking…'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <div className="glass-card">
          <h2 className="font-display font-semibold text-textPrimary mb-4">Checkers</h2>
          <p className="text-textMuted text-sm mb-4">{status}</p>
          <div
            className="inline-grid gap-0 border-2 border-amber-800 rounded overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${SIZE}, 2rem)`, width: 'min(90vw, 272px)' }}
          >
            {board.flat().map((cell, i) => {
              const r = Math.floor(i / SIZE)
              const c = i % SIZE
              const isDark = (r + c) % 2 === 1
              const isSelected = selected && selected[0] === r && selected[1] === c
              const isTarget = validMoves.some((m) => m.to[0] === r && m.to[1] === c)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleCellClick(r, c)}
                  disabled={gameOver}
                  className={`w-8 h-8 flex items-center justify-center border border-amber-900 ${
                    isDark ? 'bg-amber-800' : 'bg-amber-100'
                  } ${isSelected ? 'ring-2 ring-blue-400' : ''} ${isTarget ? 'ring-2 ring-green-400' : ''} disabled:cursor-not-allowed`}
                >
                  {cell && (
                    <div
                      className={`w-6 h-6 rounded-full border-2 ${
                        isRed(cell) ? 'bg-red-600 border-red-800' : 'bg-gray-800 border-gray-900'
                      } ${isKing(cell) ? 'ring-1 ring-yellow-400' : ''}`}
                    />
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
          <p className="text-textMuted text-xs mb-2">You are Black. Click a piece, then click a highlighted square to move. AI is Red.</p>
          <button type="button" onClick={startNew} className="btn-primary w-full">
            New game
          </button>
        </div>
      </div>
    </div>
  )
}
