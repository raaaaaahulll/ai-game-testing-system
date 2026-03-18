import sqlite3
import time
import random
import json
from pathlib import Path
from datetime import datetime, timedelta

# Paths
DB_PATH = Path("c:/AI Game Tester(V1)/data/bugs.db")
PROJECT_ROOT = Path("c:/AI Game Tester(V1)")

def seed_data():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}. Run the backend first to initialize it.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("--- Seeding Demo Data ---")

    # 1. Ensure Super TuxKart and other games exist in game_configs
    games = [
        ('super_tuxkart', 'Super TuxKart', 'SuperTuxKart', '["supertuxkart.exe"]', 'racing', 'ppo'),
        ('nfs_rivals', 'NFS Rivals', 'Need for Speed™ Rivals', '["NFSRivals.exe"]', 'racing', 'ppo'),
        ('track_mania', 'TrackMania', 'TrackMania Nations Forever', '["TmForever.exe"]', 'racing', 'dqn')
    ]
    
    for g in games:
        cursor.execute("""
            INSERT OR IGNORE INTO game_configs (game_key, display_name, window_title, process_names, genre, control_type)
            VALUES (?, ?, ?, ?, ?, ?)
        """, g)

    # 2. Add Mock Bug Reports for the last 7 days
    bug_types = [
        ("Stuck (no motion)", "major"),
        ("Freeze (identical frames)", "critical"),
        ("Terrain Collision Bug", "major"),
        ("Screen Anomaly (black)", "minor"),
        ("Performance degradation", "minor"),
        ("Logic Loop Bug", "major"),
        ("Crash Bug (process exited)", "critical")
    ]

    now = datetime.utcnow()
    for i in range(25):  # 25 mock bugs
        game = random.choice(['super_tuxkart', 'nfs_rivals', 'track_mania'])
        b_type, b_sev = random.choice(bug_types)
        days_ago = random.uniform(0, 7)
        timestamp = (now - timedelta(days=days_ago)).timestamp()
        
        cursor.execute("""
            INSERT INTO bug_reports (game_key, type, severity, timestamp, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (game, b_type, b_sev, timestamp, datetime.fromtimestamp(timestamp).isoformat()))

    conn.commit()
    print(f"Successfully seeded 25 mock bugs across 3 games.")

    # 3. Create Mock Analytics State
    analytics_state_path = PROJECT_ROOT / "data" / "analytics_state.json"
    analytics_state_path.parent.mkdir(parents=True, exist_ok=True)
    
    mock_history = []
    for i in range(10):
        mock_history.append({
            "unique_cells": random.randint(200, 800),
            "distance_approx": round(random.uniform(500, 5000), 2),
            "step_count": random.randint(10000, 100000),
            "episode_count": random.randint(5, 50),
            "current_fps": round(random.uniform(30, 60), 1),
            "timestamp": (now - timedelta(hours=i*4)).isoformat()
        })

    mock_state = {
        "session_stats": mock_history[0],
        "session_history": mock_history,
        "action_counts": {"0": 1200, "1": 5000, "2": 800, "3": 1500, "4": 1500, "5": 600, "6": 600, "7": 4500},
        "path_trail": [{"x": random.randint(0, 100), "y": random.randint(0, 100)} for _ in range(100)],
        "coverage_counts": [],
        "coverage_grid": None,
        "last_step_count": mock_history[0]["step_count"]
    }

    with open(analytics_state_path, "w") as f:
        json.dump(mock_state, f, indent=2)
    
    print(f"Successfully seeded mock analytics state to {analytics_state_path}")
    print("\n--- DONE: Refresh your dashboard to see the data! ---")

    conn.close()

if __name__ == "__main__":
    seed_data()
