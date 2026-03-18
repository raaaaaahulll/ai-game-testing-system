"""Configuration for NFS Rivals AI Tester."""
import os
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).resolve().parent
REPORTS_DIR = PROJECT_ROOT / "reports"
REPORTS_DIR.mkdir(exist_ok=True)
LOGS_DIR = PROJECT_ROOT / "logs"
TRACES_DIR = LOGS_DIR / "traces"
TRACES_DIR.mkdir(parents=True, exist_ok=True)
# Ring buffer: last N actions saved to logs/traces/ on bug (for reproduction)
TRACE_RING_BUFFER_SIZE = 100

# Environment
OBS_HEIGHT = 84
OBS_WIDTH = 84
OBS_CHANNELS = 1  # Grayscale
FRAME_SKIP = 2
MAX_EPISODE_STEPS = 5000

# Game key: used to separate bugs/sessions per game in the dashboard (universal game tester).
# Set via env GAME_KEY (e.g. GAME_KEY=my_game) or leave default for NFS Rivals.
GAME_KEY = os.getenv("GAME_KEY", "nfs_rivals")

# Game process: name as shown in Task Manager (or .exe name)
# "Need for Speed™ Rivals (32 bit)" = Task Manager Processes tab
NFS_PROCESS_NAME = "Need for Speed™ Rivals (32 bit)"
# Fallback names to check (e.g. if psutil reports .exe name instead)
NFS_PROCESS_NAMES = (
    "Need for Speed™ Rivals (32 bit)",
    "NFSRivals.exe",
)

# Backend
# Use explicit IPv4 loopback to avoid localhost resolving to IPv6 (::1) on some systems
# while uvicorn is bound only to 127.0.0.1, which caused the agent's HTTP calls to fail silently.
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
API_REPORT_BUG = f"{BACKEND_URL}/report-bug"
API_HEALTH = f"{BACKEND_URL}/health"

# Glitch detection thresholds — tuned for low-end PC (no dedicated GPU, old CPU).
# The FPS guard in _is_glitch_detected() already suppresses motion/freeze checks
# when the PC is struggling, so these values are a second line of defence.
SOLID_COLOR_THRESHOLD = 0.98     # Fraction of pixels same color = anomaly (unchanged; works at any FPS)
SCREEN_ANOMALY_CONFIRMATION_FRAMES = 30  # Step 3: solid screen must persist this many frames before firing
STUCK_FRAMES_THRESHOLD = 150    # was 500 — lower so stuck (e.g. Super TuxKart) fires sooner
MIN_SPEED_OCR = 5                # Below this speed for too long = stuck (OCR-based)
STUCK_SPEED_ZERO_FRAMES = 200    # was 150 — extra margin for slow CPU-only OCR
IDENTICAL_FRAME_THRESHOLD = 150  # was 90 — lag spikes repeat frames; bigger window avoids false positives
ENABLE_SPEED_OCR_STUCK = False   # Keep False on low-end PCs — OCR adds latency and causes its own lag
# Speedometer crop (x_ratio, y_ratio, w_ratio, h_ratio) of screen; tune for your game HUD
SPEEDOMETER_RATIOS = (0.35, 0.80, 0.30, 0.15)  # center-bottom 30% width, 15% height
# Speed-based reward: reward += speed * SPEED_REWARD_SCALE when OCR speed is available
SPEED_REWARD_SCALE = 0.1
# Continuous penalty for sharp steering at high speed (reduces crashes): small penalty when steering (left/right) above this speed
HIGH_SPEED_THRESHOLD = 50  # Speed above this = "high speed" for steering penalty
SHARP_STEER_PENALTY = 0.05  # Per-step penalty when steering at high speed

# Position logging for heatmap (pseudo-position from action + motion)
HEATMAP_GRID_SIZE = 50  # Legacy; dashboard grid size
COVERAGE_LOG_BATCH = 5  # Send position batch to backend every N steps
# Reward for visiting less-visited cells (encourages exploring rather than staying in one place)
EXPLORATION_BONUS_SCALE = 0.05  # Bonus = scale / (1 + visit_count) for current cell

# Genre-specific reward weights
ACTION_MOTION_WEIGHT = 0.2
OPENWORLD_EXPLORATION_WEIGHT = 2.0
RACING_SPEED_WEIGHT = 0.1

# --- Spatial Memory (GPS + grid) ---
SPATIAL_GRID_SIZE = 500  # NxN grid for map memory — Step 6: 100→500 for 5× finer exploration resolution
# Path to player-arrow template (crop from minimap). If missing, env falls back to pseudo-position.
CAR_ARROW_TEMPLATE_PATH = PROJECT_ROOT / "templates" / "car_arrow.png"
# Game window: when set, minimap/speedometer capture is relative to the game window (works in windowed mode).
# Partial match on window title (e.g. "NFS" or "Rivals"). Leave empty "" to use primary monitor (fullscreen).
GAME_WINDOW_TITLE = "Need for Speed™ Rivals"
# Minimap region relative to game window (or primary monitor if GAME_WINDOW_TITLE not found): left, bottom offset, size.
# Tune for your resolution; example: bottom-left 200x200, 20px from left, 20px from bottom.
MINIMAP_LEFT = 200
MINIMAP_BOTTOM_OFFSET = 150# from bottom of screen
MINIMAP_SIZE = 200  # width and height
# Template match quality threshold (0–1). Below this, car is treated as not found.
CAR_ARROW_MATCH_THRESHOLD = 0.5
# Exploration bonus multiplier (increase if agent circles for small rewards)
EXPLORATION_BONUS_MULTIPLIER = 1.0  # e.g. 5.0 to discourage circling

# Loop / stuck detection (GPS-based; relaxed for low-FPS to reduce false positives)
LOOP_SAME_TILES_MAX = 8  # Same N tiles for LOOP_WINDOW_STEPS = Logic Loop Bug (higher = less sensitive)
LOOP_WINDOW_STEPS = 3000  # Steps before checking loop (~2x longer window)
STUCK_WALL_PIXEL_THRESHOLD = 5  # Coords unchanged within this = no movement (higher = more lenient)
STUCK_WALL_SECONDS = 3.0  # Accel + no movement for this long = Terrain Collision Bug
STUCK_WALL_STEPS = 250           # was 150 — slow input response on low-end PC; extra buffer
HEATMAP_SAVE_EVERY_STEPS = 1000  # Save reports/coverage_heatmap.png every N steps
# Less frequent full-grid + analytics pushes to reduce backend load on low-end PCs
COVERAGE_PUSH_EVERY_STEPS = 300  # Push full grid to backend for live dashboard
# New: send lightweight analytics (no full grid) much more often so the
# Session & Analytics page shows live data quickly even on short runs.
ANALYTICS_PUSH_EVERY_STEPS = 20   # Push /analytics/update every N steps
# Less frequent CSV logging to reduce disk writes during long runs
STEP_LOG_EVERY = 50  # Write step, reward, action, coords to reports/step_log.csv every N steps

# --- Performance degradation monitoring ---
PERF_FRAME_TIME_WINDOW = 30      # Number of frame timings to average for FPS
PERF_MIN_FPS = 8.0               # was 15 — realistic minimum for no-GPU hardware; only flag truly abnormal drops
PERF_LOW_FPS_STEPS = 15          # was 5 — require sustained low FPS, not a momentary spike
ENABLE_PERF_MONITORING = True    # Set False to disable performance degradation detection entirely

# --- Minimap Auto-Detection (OpenCV) ---
AUTO_DETECT_MINIMAP = True       # Default toggle for new game configs
# HoughCircles parameters: [dp, minDist, param1, param2, minRadius, maxRadius]
MINIMAP_CIRCLE_PARAMS = (1.2, 100, 50, 30, 40, 150)

# --- Mouse automation (per-game override via dashboard; these are fallbacks) ---
# Pixels per "look" step when mouse_mode=gameplay (camera); used if game config has no mouse_sensitivity.
MOUSE_SENSITIVITY = 30
# Normalized (0–1) menu click positions when mouse_mode=menus_only and no per-game positions.
# e.g. {"start": [0.5, 0.4], "continue": [0.5, 0.5]} = center-x, 40% / 50% from top of window.
MENU_CLICK_POSITIONS: dict = {}
