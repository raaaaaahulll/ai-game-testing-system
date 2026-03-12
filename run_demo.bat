@echo off
title AI Game Tester - Demo
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo  AI Game Tester - DEMO
echo  ---------------------------
echo  This will start Backend + Dashboard and open the dashboard in your browser.
echo  Then run the agent manually (see DEMONSTRATE.md for full steps).
echo.

if not exist ".venv\Scripts\activate.bat" (
    echo  ERROR: Virtual environment not found.
    echo  Run setup first: python -m venv .venv
    echo  Then: .venv\Scripts\activate
    echo        pip install -r requirements.txt
    echo        cd dashboard ^&^& npm install
    echo  See setup.md for details.
    echo.
    pause
    exit /b 1
)

if not exist "dashboard\node_modules" (
    echo  WARNING: Dashboard dependencies may be missing.
    echo  Run: cd dashboard ^&^& npm install
    echo.
)

echo.
set /p SEED="Do you want to seed demo data (sessions, bugs, analytics)? [y/n]: "
if /i "%SEED%"=="y" (
    echo  Seeding demo data...
    .venv\Scripts\python scripts/seed_demo_data.py
)
echo.

echo  Starting Backend (port 8000)...
:: Check if Stockfish is in a default location, otherwise fallback to "stockfish"
if not defined STOCKFISH_PATH (
    if exist "C:\Program Files\stockfish\stockfish-windows-x86-64-avx2.exe" (
        set "STOCKFISH_PATH=C:\Program Files\stockfish\stockfish-windows-x86-64-avx2.exe"
    ) else (
        set "STOCKFISH_PATH=stockfish"
    )
)
start "AI Game Tester - Backend" cmd /k "cd /d "%ROOT%" && call .venv\Scripts\activate.bat && set "PYTHONPATH=%ROOT%" && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
echo  Waiting for backend...
timeout /t 6 /nobreak >nul

echo  Starting Dashboard (port 3000)...
start "AI Game Tester - Dashboard" cmd /k "cd /d "%ROOT%\dashboard" && set "VITE_API_BASE=http://127.0.0.1:8000" && npm run dev"
echo  Waiting for dashboard to be ready...
timeout /t 6 /nobreak >nul

echo  Opening dashboard in browser...
start http://localhost:3000

echo.
echo  Dashboard: http://localhost:3000
echo  Login: Click "Enter dashboard" (no password for local use).
echo.
echo  If dashboard shows "Backend not reachable": wait for Backend window to display "Uvicorn running on http://127.0.0.1:8000", then refresh (F5).
echo  To run the agent: new terminal, cd to project root, .venv\Scripts\activate, set PYTHONPATH=%%CD%%, then python agents\run_agent.py.
echo  See DEMONSTRATE.md and docs\PROFESSIONAL_AI_TESTING.md for full steps.
echo.
pause
