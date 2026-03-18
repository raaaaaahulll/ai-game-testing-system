@echo off
title AI Game Tester - Launcher
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo  AI Game Tester - Starting Backend and Dashboard
echo  ------------------------------------------------------
echo.

if not exist ".venv\Scripts\activate.bat" (
    echo  ERROR: Virtual environment not found.
    echo  Run setup first: python -m venv .venv
    echo  Then: .venv\Scripts\activate
    echo        pip install -r requirements.txt
    echo        cd dashboard ^&^& npm install
    echo.
    pause
    exit /b 1
)

if not exist "dashboard\node_modules" (
    echo  WARNING: Dashboard dependencies may be missing.
    echo  Run: cd dashboard ^&^& npm install
    echo.
)

echo  Starting Backend (port 8000)...
:: Check if Stockfish is in a default location, otherwise fallback to "stockfish"
if not defined STOCKFISH_PATH (
    if exist "C:\Program Files\stockfish\stockfish-windows-x86-64-avx2.exe" (
        set "STOCKFISH_PATH=C:\Program Files\stockfish\stockfish-windows-x86-64-avx2.exe"
    ) else (
        set "STOCKFISH_PATH=stockfish"
    )
)
start "AI Game Tester - Backend" cmd /k "cd /d "%ROOT%" && set "PYTHONPATH=%ROOT%" && echo Backend starting... Keep this window open. && echo System monitoring and health checks enabled. && .venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo  Waiting for backend to bind to port 8000...
timeout /t 6 /nobreak >nul

echo  Starting Dashboard (port 3000)...
start "AI Game Tester - Dashboard" cmd /k "cd /d "%ROOT%\dashboard" && set "VITE_API_BASE=http://127.0.0.1:8000" && npm run dev"

echo  Waiting for dashboard to be ready...
timeout /t 6 /nobreak >nul

echo  Opening optional Agent terminal (advanced / manual use)...
start "AI Game Tester - Agent" cmd /k "cd /d "%ROOT%" && set "PYTHONPATH=%ROOT%" && echo Advanced usage - most users can ignore this window. && echo Normal workflow: control everything from the dashboard (Session ^& Analytics and Game Configs). && echo For manual runs you may still use: .venv\Scripts\python agents\run_agent.py  (or agents\train.py if no model yet). && echo."

timeout /t 3 /nobreak >nul
echo  Opening dashboard in browser...
start http://localhost:3000

echo.
echo  ------------------------------------------------------
echo  Backend and Dashboard are starting.
echo  ------------------------------------------------------
echo  Dashboard: http://localhost:3000
echo  Login: Click "Enter dashboard" (no password for local use).
echo.
echo  IMPORTANT: If the dashboard shows "Backend not reachable" or "Failed to fetch":
echo  - Check the "AI Game Tester - Backend" window. It must show:
echo    "Uvicorn running on http://127.0.0.1:8000"
echo  - If you see a Python error there, fix it (e.g. install deps, set STOCKFISH_PATH).
echo  - Once the backend is running, refresh the dashboard page (F5 or Ctrl+F5).
echo.
echo  Sidebar: Dashboard ^| Session ^& Analytics ^| Previous Sessions ^| Game Configs ^| Training ^| Play vs AI.
echo  Active game: On Session ^& Analytics use the "Active game" dropdown to choose which game the agent should control.
echo  Game configs: Add/edit games; set key bindings (arrows or WASD) and Mouse mode (None / Menus only / Gameplay); configure how each game is controlled.
echo  Training: Pick a game, click "Start training". Progress bar, "Last updated Xs ago", and stat cards update live; success/completion messages show inline. History table shows status icons and hover.
echo  Previous Sessions: Filter by game; summary (total sessions, total bugs, bugs this week); duration and severity per session.
echo  Play vs AI: Board games hub (Chess, Checkers, Othello, Connect Four, Tic-Tac-Toe). Chess uses Stockfish; others use in-browser AI. URL: /play (or /play?game=chess).
echo.
echo  Agent (recommended): In the dashboard go to Session ^& Analytics, pick the Active game, then click "Start agent" to begin testing. Click "Stop agent" to end the run.
echo  Training (recommended): In Training, select the game and click "Start training". Live progress, "Last updated Xs ago", and stat highlights appear. "Stop training" responds immediately; the run stops in the background and the model is saved.
echo  Agent details: The agent fetches per-game config from the backend and loads a model from agents\models\<game_key>\model_ppo.zip (or model_dqn.zip).
echo  Advanced CLI (optional): python agents\train.py --game_key ^<key^> [--algo ppo^|dqn] [--timesteps 500000]
echo  Legacy: agents\model_ppo.zip still used for nfs_rivals if agents\models\nfs_rivals\ missing.
echo  See setup.md, DEMONSTRATE.md, and docs\PROFESSIONAL_AI_TESTING.md.
echo.
echo  To verify backend: python scripts\verify_system.py (with backend already running).
echo.
pause
