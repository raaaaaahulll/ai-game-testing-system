import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import PageHeader from './PageHeader'
import LoadingSpinner from './LoadingSpinner'
import { API_BASE } from '../api'

const INITIAL_FEN_WHITE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const INITIAL_FEN_BLACK = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'

function getInitialFen(examinerSide) {
  return examinerSide === 'white' ? INITIAL_FEN_WHITE : INITIAL_FEN_BLACK
}

const DIFFICULTY_MOVETIME = { easy: 0.5, medium: 1.5, hard: 3.0 }
const DIFFICULTY_SKILL = { easy: 0, medium: 5, hard: 20 }

function isValidFen(fen) {
  if (typeof fen !== 'string' || !fen.trim()) return false
  const part = fen.split(' ')[0]
  return part && part.includes('/') && part.length >= 10
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return uci
  try {
    const c = new Chess(fen)
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    const move = c.move({ from, to, promotion })
    return move ? move.san : uci
  } catch (_) {
    return uci
  }
}

function getFriendlyMoveName(fen, uci) {
  if (!uci || uci.length < 4) return uci
  try {
    const c = new Chess(fen)
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined

    // Get the piece name
    const piece = c.get(from)
    const pieceNames = {
      p: 'Pawn',
      n: 'Knight',
      b: 'Bishop',
      r: 'Rook',
      q: 'Queen',
      k: 'King'
    }
    const name = pieceNames[piece?.type] || 'Piece'

    const moveStr = `Move ${name} from ${from} to ${to}`
    return promotion ? `${moveStr} (Promote to ${pieceNames[promotion] || promotion})` : moveStr
  } catch (_) {
    return uci
  }
}

class ChessErrorBoundary extends React.Component {
  state = { hasError: false, retryKey: 0 }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-lg bg-amber-900/80 border border-amber-600 text-amber-100">
          <p className="font-semibold">Chess board failed to load.</p>
          <p className="text-sm mt-2 opacity-90">Refresh the page or check the browser console for errors.</p>
          <button
            type="button"
            className="mt-4 px-4 py-2 rounded font-mono text-sm bg-amber-700 hover:bg-amber-600 text-white"
            onClick={() => this.setState({ hasError: false, retryKey: this.state.retryKey + 1 })}
          >
            Try again
          </button>
        </div>
      )
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>
  }
}

class PageErrorBoundary extends React.Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <>
          {!this.props.embedded && <PageHeader title="Play vs AI (Chess)" description="Something went wrong on this page." />}
          <div className="max-w-7xl mx-auto px-6 pb-8">
            <div className="alert-error">
              <p className="font-semibold">This page encountered an error.</p>
              <p className="text-sm mt-2">Refresh the page (F5) or try again later.</p>
            </div>
          </div>
        </>
      )
    }
    return this.props.children
  }
}

export default function ChessPage({ embedded = false }) {
  const [gameStarted, setGameStarted] = useState(false)
  const [examinerSide, setExaminerSide] = useState('white') // 'white' | 'black'
  const initialFen = getInitialFen(examinerSide)
  const [game, setGame] = useState(() => new Chess(initialFen))
  const [aiThinking, setAiThinking] = useState(false)
  const [gameOver, setGameOver] = useState(null)
  const [fen, setFen] = useState(initialFen)
  const [stockfishError, setStockfishError] = useState(null)
  const [stockfishAvailable, setStockfishAvailable] = useState(null)
  const [backendReachable, setBackendReachable] = useState(null)
  const [difficulty, setDifficulty] = useState('medium') // 'easy' | 'medium' | 'hard'
  const [hintMove, setHintMove] = useState(null) // UCI string or null
  const [hintLoading, setHintLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/chess/stockfish-status`)
      .then((r) => {
        if (!cancelled) setBackendReachable(true)
        return r.ok ? r.json() : {}
      })
      .then((d) => { if (!cancelled) setStockfishAvailable(d.available === true) })
      .catch(() => {
        if (!cancelled) {
          setBackendReachable(false)
          setStockfishAvailable(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  const updateFen = useCallback((newGame) => {
    setFen(newGame.fen())
    if (newGame.isGameOver()) {
      if (newGame.isCheckmate()) setGameOver('checkmate')
      else if (newGame.isStalemate()) setGameOver('stalemate')
      else if (newGame.isDraw()) setGameOver('draw')
      else setGameOver('over')
    } else {
      setGameOver(null)
    }
  }, [])

  const requestStockfishMove = useCallback((currentFen, side) => {
    setStockfishError(null)
    const movetime = DIFFICULTY_MOVETIME[difficulty] ?? 1.5
    const skill_level = DIFFICULTY_SKILL[difficulty] ?? 5
    fetch(`${API_BASE}/chess/next-move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: currentFen, ai_side: side, movetime, skill_level }),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.detail || r.statusText)))
        return r.json()
      })
      .then(({ move }) => {
        const newGame = new Chess(currentFen)
        const from = move.slice(0, 2)
        const to = move.slice(2, 4)
        const promotion = move.length > 4 ? move[4] : undefined
        const result = newGame.move({ from, to, promotion })
        if (result) {
          setGame(newGame)
          updateFen(newGame)
        }
      })
      .catch((e) => setStockfishError(e.message || 'Stockfish request failed'))
      .finally(() => setAiThinking(false))
  }, [updateFen, difficulty])

  const aiSide = examinerSide === 'white' ? 'b' : 'w'
  const isExaminerTurn = game && typeof game.turn === 'function'
    ? (examinerSide === 'white' ? game.turn() === 'w' : game.turn() === 'b')
    : true
  const canExaminerMove = isExaminerTurn && !aiThinking && !gameOver

  const requestHint = useCallback(() => {
    if (!game || !isExaminerTurn || gameOver || aiThinking) return
    const currentFen = game.fen()
    const sideToMove = game.turn()
    setHintMove(null)
    setHintLoading(true)
    const movetime = DIFFICULTY_MOVETIME[difficulty] ?? 1.5
    const skill_level = DIFFICULTY_SKILL[difficulty] ?? 5
    fetch(`${API_BASE}/chess/next-move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: currentFen, ai_side: sideToMove, movetime, skill_level }),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.detail || r.statusText)))
        return r.json()
      })
      .then(({ move }) => setHintMove(move))
      .catch(() => setHintMove(null))
      .finally(() => setHintLoading(false))
  }, [game, isExaminerTurn, gameOver, aiThinking, difficulty])

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }) => {
    if (!canExaminerMove || !targetSquare) return false
    setHintMove(null)
    const newGame = new Chess(game.fen())
    const move = newGame.move({ from: sourceSquare, to: targetSquare })
    if (!move) return false
    setGame(newGame)
    updateFen(newGame)
    if (newGame.isGameOver()) return true
    if (newGame.turn() === aiSide) {
      setAiThinking(true)
      requestStockfishMove(newGame.fen(), aiSide)
    }
    return true
  }, [game, canExaminerMove, updateFen, requestStockfishMove, aiSide])

  const startNewGame = useCallback(() => {
    const startFen = getInitialFen(examinerSide)
    setGame(new Chess(startFen))
    setFen(startFen)
    setGameOver(null)
    setAiThinking(false)
    setStockfishError(null)
    setHintMove(null)
  }, [examinerSide])

  const setExaminerSideAndReset = useCallback((side) => {
    setExaminerSide(side)
    const startFen = getInitialFen(side)
    setGame(new Chess(startFen))
    setFen(startFen)
    setGameOver(null)
    setAiThinking(false)
    setStockfishError(null)
    setHintMove(null)
  }, [])

  const startGameAs = useCallback((side) => {
    const startFen = getInitialFen(side)
    setExaminerSide(side)
    setGame(new Chess(startFen))
    setFen(startFen)
    setGameOver(null)
    setStockfishError(null)
    setHintMove(null)
    setGameStarted(true)
    if (side === 'black') {
      setAiThinking(true)
      requestStockfishMove(startFen, 'w')
    } else {
      setAiThinking(false)
    }
  }, [requestStockfishMove])

  const safeFen = isValidFen(fen) ? fen : getInitialFen(examinerSide)
  const lastMoveSquares = useMemo(() => {
    if (!game || typeof game.history !== 'function') return {}
    const verbose = game.history({ verbose: true })
    if (verbose.length === 0) return {}
    const last = verbose[verbose.length - 1]
    const highlight = { backgroundColor: 'rgba(255, 255, 0, 0.35)' }
    return { [last.from]: highlight, [last.to]: highlight }
  }, [fen])
  const boardOptions = useMemo(() => ({
    id: 'nfs-chess-board',
    position: safeFen,
    boardOrientation: examinerSide === 'white' ? 'white' : 'black',
    allowDragging: true,
    allowDragOffBoard: false,
    showAnimations: true,
    animationDurationInMs: 250,
    onPieceDrop,
    canDragPiece: () => canExaminerMove,
    squareStyles: {
      ...lastMoveSquares,
      ...(hintMove ? {
        [hintMove.slice(0, 2)]: { backgroundColor: 'rgba(0, 255, 0, 0.4)' },
        [hintMove.slice(2, 4)]: { backgroundColor: 'rgba(0, 255, 0, 0.4)' }
      } : {})
    },
  }), [safeFen, examinerSide, canExaminerMove, onPieceDrop, lastMoveSquares, hintMove])

  const moveHistory = game && typeof game.history === 'function' ? game.history() : []
  const moveHistoryRows = moveHistory.length === 0
    ? []
    : moveHistory.reduce((acc, move, i) => {
      const moveNum = Math.floor(i / 2) + 1
      if (i % 2 === 0) acc.push(`${moveNum}. ${move}`)
      else acc[acc.length - 1] += ` ${move}`
      return acc
    }, [])

  if (backendReachable === null) {
    return (
      <PageErrorBoundary embedded={embedded}>
        {!embedded && <PageHeader title="Play vs AI (Chess)" description="You play White or Black; Stockfish plays the other side." />}
        <div className="max-w-7xl mx-auto px-6 pb-8">
          <LoadingSpinner label="Loading…" />
        </div>
      </PageErrorBoundary>
    )
  }

  if (backendReachable === false) {
    return (
      <PageErrorBoundary embedded={embedded}>
        {!embedded && <PageHeader title="Play vs AI (Chess)" description="You play White or Black; Stockfish plays the other side." />}
        <div className="max-w-7xl mx-auto px-6 pb-8">
          <div className="alert-error">
            Backend not reachable. Start the backend (e.g. run <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-sm">run_system.bat</code>), then refresh this page.
          </div>
        </div>
      </PageErrorBoundary>
    )
  }

  if (!gameStarted) {
    return (
      <PageErrorBoundary>
        <PageHeader
          title="Play vs AI (Chess)"
          description="You play White or Black; Stockfish plays the other side. Choose your color and start a game."
        />
        <div className="max-w-7xl mx-auto px-6 pb-8">
          <div className="glass-card max-w-lg mx-auto p-12 text-center">
            <h2 className="font-display font-bold text-2xl text-textPrimary dark:text-gray-100 mb-4">Choose Your Side</h2>
            <p className="text-textMuted dark:text-gray-400 mb-8">
              Choose your side to begin. You move first as White, or let Stockfish open as White.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => startGameAs('white')}
                className="group flex flex-col items-center gap-4 p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-accent dark:hover:border-accent bg-white dark:bg-gray-800 transition-all shadow-sm hover:shadow-md"
              >
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-500 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/40 group-hover:text-accent transition-colors">
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12h2v6h-2zm0 8h2v2h-2z" /></svg>
                </div>
                <span className="font-bold text-textPrimary dark:text-gray-100 uppercase tracking-wider">White</span>
              </button>
              <button
                type="button"
                onClick={() => startGameAs('black')}
                className="group flex flex-col items-center gap-4 p-6 rounded-xl border-2 border-gray-800 dark:border-gray-600 hover:border-accent dark:hover:border-accent bg-gray-900 dark:bg-black transition-all shadow-sm hover:shadow-md"
              >
                <div className="w-16 h-16 bg-gray-800 dark:bg-gray-900 rounded-full flex items-center justify-center text-gray-400 group-hover:bg-blue-900/60 group-hover:text-accent transition-colors">
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12h2v6h-2zm0 8h2v2h-2z" /></svg>
                </div>
                <span className="font-bold text-white uppercase tracking-wider">Black</span>
              </button>
            </div>
          </div>
        </div>
      </PageErrorBoundary>
    )
  }

  const examinerColorLabel = examinerSide === 'white' ? 'White' : 'Black'
  const aiColorLabel = examinerSide === 'white' ? 'Black' : 'White'
  let examinerWinsCheckmate = false
  try {
    examinerWinsCheckmate = Boolean(
      gameOver === 'checkmate' && game && typeof game.turn === 'function' &&
      ((examinerSide === 'white' && game.turn() === 'b') || (examinerSide === 'black' && game.turn() === 'w'))
    )
  } catch (_) { }
  const moveCount = game && typeof game.history === 'function' ? game.history().length : 0
  const fullMoves = Math.ceil(moveCount / 2)
  const gameOverSummary = gameOver
    ? (gameOver === 'checkmate'
      ? (examinerWinsCheckmate ? `You win by checkmate in ${fullMoves} move${fullMoves !== 1 ? 's' : ''}.` : `Stockfish wins by checkmate in ${fullMoves} move${fullMoves !== 1 ? 's' : ''}.`)
      : gameOver === 'stalemate'
        ? `Draw by stalemate (${fullMoves} move${fullMoves !== 1 ? 's' : ''}).`
        : gameOver === 'draw'
          ? `Draw (${fullMoves} move${fullMoves !== 1 ? 's' : ''}).`
          : `Game over (${fullMoves} move${fullMoves !== 1 ? 's' : ''}).`)
    : null

  return (
    <PageErrorBoundary embedded={embedded}>
      {!embedded && (
        <PageHeader
          title="Play vs AI (Chess)"
          description="You play White or Black; Stockfish plays the other side. Drag pieces to move."
        />
      )}
      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: Chess Board card */}
          <div className="lg:col-span-2">
            <div className="glass-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100">Chess Board</h2>
                <div className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <span className="text-xs font-mono text-textMuted dark:text-gray-400">
                    {gameOver
                      ? 'Game over'
                      : aiThinking
                        ? `AI Thinking (${aiColorLabel})`
                        : `${examinerColorLabel}'s Turn`}
                  </span>
                </div>
              </div>
              <div className="flex justify-center bg-gray-50/50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-100 dark:border-gray-800">
                <div className="inline-block" style={{ maxWidth: 'min(90vw, 480px)', width: '100%' }}>
                  <ChessErrorBoundary>
                    <Chessboard options={boardOptions} />
                  </ChessErrorBoundary>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Game Controls, Status, Live results */}
          <div className="space-y-4">
            {/* Game Controls card */}
            <div className="glass-card">
              <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100 mb-4">Game Controls</h2>
              <p className="form-label text-textMuted dark:text-gray-400 mb-2">Strength</p>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-textPrimary dark:text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent mb-4"
                aria-label="AI strength"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <p className="form-label text-textMuted dark:text-gray-400 mb-2">Choose Side</p>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 mb-4">
                <button
                  type="button"
                  onClick={() => setExaminerSideAndReset('white')}
                  className={`flex-1 px-4 py-2.5 text-xs font-mono font-bold transition-colors ${examinerSide === 'white' ? 'bg-accent text-white' : 'bg-white dark:bg-gray-800 text-textPrimary dark:text-gray-400 border-r border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                >
                  WHITE
                </button>
                <button
                  type="button"
                  onClick={() => setExaminerSideAndReset('black')}
                  className={`flex-1 px-4 py-2.5 text-xs font-mono font-bold transition-colors ${examinerSide === 'black' ? 'bg-accent text-white' : 'bg-white dark:bg-gray-800 text-textPrimary dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                >
                  BLACK
                </button>
              </div>
              <button
                type="button"
                onClick={requestHint}
                disabled={aiThinking || !!gameOver || !isExaminerTurn || hintLoading}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-textPrimary dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed mb-2 transition-colors"
              >
                {hintLoading ? 'Thinking…' : 'Get Hint'}
              </button>
              {hintMove && (
                <div className="p-3 mb-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded shadow-sm">
                  <p className="text-sm text-blue-800 dark:text-blue-300 font-medium">
                    💡 <span className="underline decoration-blue-400 decoration-2 underline-offset-4">{getFriendlyMoveName(game.fen(), hintMove)}</span>
                  </p>
                  <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-1 italic uppercase tracking-wider">
                    Green highlight on the board
                  </p>
                </div>
              )}
              <button type="button" onClick={startNewGame} className="btn-primary w-full mt-2">
                New game
              </button>
            </div>

            {/* Status card */}
            <div className="glass-card">
              <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100 mb-4">Status</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center p-2 rounded bg-gray-50 dark:bg-gray-900/50">
                  <span className="text-textMuted dark:text-gray-400">Stockfish</span>
                  <span className={stockfishAvailable === true ? 'text-success dark:text-green-400 font-bold' : 'text-red-600 dark:text-red-400'}>
                    {stockfishAvailable === true ? 'ONLINE' : stockfishAvailable === false ? 'OFFLINE' : 'WAITING…'}
                  </span>
                </div>
                <div className="flex justify-between items-center p-2 rounded bg-gray-50 dark:bg-gray-900/50">
                  <span className="text-textMuted dark:text-gray-400">Backend</span>
                  <span className={backendReachable === true ? 'text-success dark:text-green-400 font-bold' : 'text-red-600 dark:text-red-400'}>
                    {backendReachable === true ? 'CONNECTED' : backendReachable === false ? 'DISCONNECTED' : 'WAITING…'}
                  </span>
                </div>
              </div>
              {stockfishError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-900/40">{stockfishError}</p>
              )}
            </div>

            {/* Live results card */}
            <div className="glass-card">
              <h2 className="font-display font-semibold text-textPrimary dark:text-gray-100 mb-4">Live Results</h2>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="form-label text-textMuted dark:text-gray-400 mb-1">Game state</p>
                  <p className="text-textPrimary dark:text-gray-100 font-mono bg-gray-50 dark:bg-gray-900/50 p-2 rounded border border-gray-100 dark:border-gray-800">
                    {gameOver
                      ? gameOverSummary
                      : aiThinking
                        ? 'AI thinking…'
                        : isExaminerTurn
                          ? `Your turn (${examinerColorLabel})`
                          : `Stockfish's turn (${aiColorLabel})`}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="form-label text-textMuted dark:text-gray-400 mb-0">Move history</p>
                    <span className="text-[10px] text-textLight dark:text-gray-500 uppercase">{moveCount} moves</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-3 shadow-inner">
                    {moveHistoryRows.length === 0 ? (
                      <p className="text-textLight dark:text-gray-600 font-mono text-xs italic">No moves yet</p>
                    ) : (
                      <ul className="space-y-1 text-textPrimary dark:text-gray-300 font-mono text-xs leading-relaxed">
                        {moveHistoryRows.map((row, i) => (
                          <li key={i} className="flex gap-2 border-b border-gray-100 dark:border-gray-900/50 last:border-0 pb-0.5">
                            <span className="text-textLight dark:text-gray-600 w-4 text-right">{i + 1}.</span>
                            <span>{row.split(' ').slice(1).join(' ')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                {gameOver && (
                  <p className="text-success dark:text-green-400 text-xs font-bold animate-pulse">
                    🏆 Game Over! Click &quot;New Game&quot; to play again.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageErrorBoundary>
  )
}
