import sqlite3
from pathlib import Path

db_path = Path("c:/AI Game Tester(V1)/data/bugs.db")
if not db_path.exists():
    print(f"Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("--- Game Configs ---")
cursor.execute("SELECT game_key, display_name, window_title, process_names, genre, control_type FROM game_configs")
for row in cursor.fetchall():
    print(row)

print("\n--- Recent Bug Reports ---")
cursor.execute("SELECT id, game_key, type, timestamp FROM bug_reports ORDER BY timestamp DESC LIMIT 5")
for row in cursor.fetchall():
    print(row)

conn.close()
