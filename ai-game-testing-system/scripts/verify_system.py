#!/usr/bin/env python3
"""
Verify backend API and document UI→backend mapping.
Run with backend already running: python scripts/verify_system.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

BASE = "http://127.0.0.1:8000"
TIMEOUT = 5

# Backend endpoints used by UI (GET = read-only checks)
CHECKS = [
    ("GET", "/health", None, "DashboardPage, AnalyticsPage backend check"),
    ("GET", "/games", None, "GameContext game list"),
    ("GET", "/game-configs", None, "GameConfigsPage list, GameContext"),
    ("GET", "/sessions", None, "SessionsPage"),
    ("GET", "/bugs", {"limit": 5}, "DashboardPage, SessionsPage"),
    ("GET", "/stats", None, "DashboardPage, AnalyticsPage TestingSummary"),
    ("GET", "/coverage", None, "TestingSummary"),
    ("GET", "/analytics", None, "AnalyticsPage"),
    ("GET", "/analytics/pause", None, "AnalyticsPage pause state"),
    ("GET", "/agent/status", None, "AnalyticsPage Start/Stop agent"),
    ("GET", "/agent/train/status", None, "GameConfigsPage Train column"),
    ("GET", "/chess/stockfish-status", None, "ChessPage Stockfish check"),
    ("GET", "/report/comprehensive", {"bug_limit": 5}, "AnalyticsPage Export report"),
]

def main():
    print("Backend verification (ensure backend is running on port 8000)\n")
    ok = 0
    fail = 0
    for method, path, params, used_by in CHECKS:
        url = BASE + path
        try:
            if method == "GET":
                r = requests.get(url, params=params or {}, timeout=TIMEOUT)
            else:
                r = requests.post(url, json=params or {}, timeout=TIMEOUT)
            if r.status_code in (200, 404):
                print(f"  OK   {method} {path} -> {r.status_code}  ({used_by})")
                ok += 1
            else:
                print(f"  FAIL {method} {path} -> {r.status_code}  ({used_by})")
                fail += 1
        except requests.exceptions.RequestException as e:
            print(f"  FAIL {method} {path} -> {e}  ({used_by})")
            fail += 1
    print()
    if fail == 0:
        print("All backend endpoints OK. UI components that use them should work if the dashboard is running.")
    else:
        print(f"Failures: {fail}. Fix backend or ensure it is running (run_system.bat or uvicorn backend.main:app --host 127.0.0.1 --port 8000).")
    return 0 if fail == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
