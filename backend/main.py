"""
FastAPI server: bug reporting and dashboard API.
Run: uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PROJECT_ROOT = Path(__file__).resolve().parent.parent

from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Tuple, Set
from collections import defaultdict
import threading
import time

from fastapi import Body, FastAPI, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import shutil
from pydantic import BaseModel

from backend.database.models import async_session, init_db, BugReport
from backend.database.crud import (
    create_bug_report,
    get_all_bugs,
    get_bugs_by_ids,
    get_bugs_since,
    get_session_stats,
    get_sessions_grouped_by_day,
    get_distinct_game_keys,
    get_all_game_keys_merged,
    list_game_configs,
    get_game_config,
    create_game_config,
    update_game_config,
)


class BugReportPayload(BaseModel):
    type: str
    timestamp: float
    screenshot: Optional[str] = ""
    severity: Optional[str] = None
    trace_filename: Optional[str] = None
    game_key: Optional[str] = None  # e.g. "nfs_rivals", "my_game"; default nfs_rivals
    fps_at_bug: Optional[float] = None
    pc_was_struggling: Optional[bool] = None


class BugReportResponse(BaseModel):
    id: int
    type: str
    severity: Optional[str] = None
    timestamp: float
    has_screenshot: bool
    trace_filename: Optional[str] = None
    fps_at_bug: Optional[float] = None
    pc_was_struggling: Optional[bool] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class CoveragePointsPayload(BaseModel):
    points: List[List[int]]  # [[x,y], [x,y], ...]


class CoverageGridPayload(BaseModel):
    grid: List[List[float]]  # 100x100 from spatial memory (visit counts)


class AnalyticsUpdatePayload(BaseModel):
    path: Optional[List[Dict[str, int]]] = None  # [{"x": gx, "y": gy}, ...]
    action_counts: Optional[Dict[str, int]] = None  # "0".."7" -> count
    unique_cells: Optional[int] = None
    distance_approx: Optional[float] = None
    step_count: Optional[int] = None
    episode_count: Optional[int] = None
    current_fps: Optional[float] = None  # Performance monitoring
    game_key: Optional[str] = None  # Per-game marker so dashboard knows which game current analytics belong to


class PausePayload(BaseModel):
    paused: bool


class LiveScreenshotPayload(BaseModel):
    base64: Optional[str] = None


class AgentStartPayload(BaseModel):
    """Optional body for POST /agent/start. When provided, agent runs with this game_key (Phase 1: start agent with selected game)."""
    game_key: Optional[str] = None


class AgentTrainPayload(BaseModel):
    """Body for POST /agent/train. Start per-game training in background (Phase 4)."""
    game_key: str
    algo: Optional[str] = "ppo"  # ppo or dqn


class TrainingProgressPayload(BaseModel):
    """Progress payload from training callback for dashboard Training page."""
    game_key: str
    algo: Optional[str] = None
    total_timesteps: Optional[int] = None
    target_timesteps: Optional[int] = None
    episode: Optional[int] = None
    reward: Optional[float] = None
    best_reward: Optional[float] = None
    done: Optional[bool] = None
    # Optional identifiers so we can distinguish dashboard vs CLI runs and
    # aggregate history per run.
    run_id: Optional[str] = None
    source: Optional[str] = None  # "dashboard" or "cli"


class GameConfigPayload(BaseModel):
    """Create a game config (Phase 1: genre, control_type, model_path)."""
    game_key: str
    display_name: str
    window_title: str = ""
    process_names: str = "[]"  # JSON array string, e.g. '["Game.exe", "Game (32 bit)"]'
    genre: str = "racing"  # racing, open_world, minimal
    control_type: str = "ppo"  # ppo, dqn
    model_path: Optional[str] = None  # optional; empty = use default agents/models/<game_key>/model_*.zip
    key_bindings: Optional[Dict[str, str]] = None  # e.g. {"accel":"up","brake":"down","left":"left","right":"right"}; null = default (arrows)
    mouse_mode: Optional[str] = "none"  # none | menus_only | gameplay
    mouse_sensitivity: Optional[int] = None  # pixels per look step when gameplay
    menu_click_positions: Optional[str] = None  # JSON e.g. {"start":[0.5,0.4],"continue":[0.5,0.5]}
    # Universal Vision
    minimap_left: Optional[int] = 200
    minimap_bottom: Optional[int] = 150
    minimap_size: Optional[int] = 200
    auto_detect_minimap: bool = True


class GameConfigUpdatePayload(BaseModel):
    """Partial update for PUT /game-configs/{game_key}."""
    display_name: Optional[str] = None
    window_title: Optional[str] = None
    process_names: Optional[str] = None
    genre: Optional[str] = None
    control_type: Optional[str] = None
    model_path: Optional[str] = None
    key_bindings: Optional[Dict[str, str]] = None
    mouse_mode: Optional[str] = None
    mouse_sensitivity: Optional[int] = None
    menu_click_positions: Optional[str] = None
    # Universal Vision
    minimap_left: Optional[int] = None
    minimap_bottom: Optional[int] = None
    minimap_size: Optional[int] = None
    marker_template_path: Optional[str] = None
    auto_detect_minimap: Optional[bool] = None


# In-memory heatmap: legacy points (50x50) or full grid from agent (100x100)
COVERAGE_GRID_SIZE = 50
SPATIAL_GRID_SIZE = 100
_coverage_counts: Dict[Tuple[int, int], int] = defaultdict(int)
_coverage_grid: Optional[List[List[float]]] = None  # 100x100 when agent sends /coverage/grid
_coverage_lock = threading.Lock()

# Backend start time: bugs with timestamp >= this are "current session" (main Dashboard shows only these)
_session_started_at: Optional[float] = None

# WebSocket: live coverage broadcast (Producer-Consumer)
_ws_coverage_clients: Set[WebSocket] = set()
_ws_lock = asyncio.Lock()

# --- Analytics (path trail, session stats, action distribution, pause, live view) ---
_path_trail: List[Dict[str, int]] = []  # [{"x": gx, "y": gy}, ...], max 1000
_action_counts: Dict[str, int] = defaultdict(int)  # "0".."7" -> count
_session_stats: Dict = {}  # unique_cells, distance_approx, step_count, episode_count, game_key
_analytics_lock = threading.Lock()
_analytics_max_path = 1000
_paused: bool = False
_live_screenshot_b64: Optional[str] = None
_session_history: List[Dict] = []  # previous session summaries for comparison
_last_step_count: int = -1

# --- Persistence ---
ANALYTICS_STATE_FILE = PROJECT_ROOT / "data" / "analytics_state.json"

def _save_analytics_state():
    """Write current in-memory analytics state to disk."""
    try:
        with _analytics_lock:
            with _coverage_lock:
                state = {
                    "session_stats": _session_stats,
                    "session_history": _session_history,
                    "action_counts": dict(_action_counts),
                    "path_trail": _path_trail,
                    "coverage_counts": [[x, y, c] for (x, y), c in _coverage_counts.items()],
                    "coverage_grid": _coverage_grid,
                    "last_step_count": _last_step_count
                }
        ANALYTICS_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(ANALYTICS_STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception as e:
        print(f"Error saving analytics state: {e}")

def _load_analytics_state():
    """Load analytics state from disk on startup."""
    global _session_stats, _session_history, _action_counts, _path_trail, _coverage_counts, _coverage_grid, _last_step_count
    if not ANALYTICS_STATE_FILE.exists():
        return
    try:
        with open(ANALYTICS_STATE_FILE, "r") as f:
            state = json.load(f)
        with _analytics_lock:
            with _coverage_lock:
                # Treat persisted session_stats as part of history so a fresh backend
                # never shows stale metrics as the "current" live session.
                persisted_stats = state.get("session_stats", {}) or {}
                history = state.get("session_history", []) or []
                if persisted_stats:
                    history.insert(0, persisted_stats)
                _session_stats = {}
                _session_history = history
                _action_counts = defaultdict(int, state.get("action_counts", {}))
                _path_trail = state.get("path_trail", [])
                _coverage_grid = state.get("coverage_grid")
                # Force analytics_update to treat the next payload as a fresh run
                _last_step_count = -1
                
                c_counts = state.get("coverage_counts", [])
                for x, y, c in c_counts:
                    _coverage_counts[(x, y)] = c
        print(f"Loaded analytics state from {ANALYTICS_STATE_FILE}")
    except Exception as e:
        print(f"Error loading analytics state: {e}")

# --- Agent process control (start/stop test from dashboard) ---
_agent_process: Optional[subprocess.Popen] = None
_agent_lock = threading.Lock()

# --- Training process (Phase 4: start training from dashboard) ---
_training_process: Optional[subprocess.Popen] = None
_training_lock = threading.Lock()
_training_progress: Dict[str, Dict] = {}  # latest snapshot per game_key
_training_history: Dict[str, List[Dict]] = {}  # list of past runs per game_key
_training_game_key: Optional[str] = None  # which game_key the current training run is for
_training_run_id: Optional[str] = None    # opaque run identifier for current training

# Persist training history/progress across backend restarts so the Training
# page still shows "so far" progress even after a restart.
TRAINING_STATE_FILE = PROJECT_ROOT / "data" / "training_state.json"


def _save_training_state() -> None:
    """Write training progress + history to disk (best-effort)."""
    try:
        with _training_lock:
            state = {
                "progress": _training_progress,
                "history": _training_history,
            }
        TRAINING_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(TRAINING_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception as e:
        print(f"Error saving training state: {e}")


def _load_training_state() -> None:
    """Load training state from disk on startup (if any)."""
    global _training_progress, _training_history
    if not TRAINING_STATE_FILE.exists():
        return
    try:
        with open(TRAINING_STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        with _training_lock:
            _training_progress = dict(state.get("progress") or {})
            # Keep only a small bounded history per game to avoid unbounded growth
            raw_history = state.get("history") or {}
            bounded: Dict[str, List[Dict]] = {}
            for gk, runs in raw_history.items():
                if not isinstance(runs, list):
                    continue
                # newest first; keep up to 10 entries per game
                bounded[gk] = list(runs)[-10:]
            _training_history = bounded
        print(f"Loaded training state from {TRAINING_STATE_FILE}")
    except Exception as e:
        print(f"Error loading training state: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _session_started_at
    await init_db()
    _session_started_at = time.time()
    _load_analytics_state()
    _load_training_state()
    yield
    # shutdown
    _save_analytics_state()
    _save_training_state()


app = FastAPI(title="AI Game Tester API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Include started_at so the dashboard can request only current-session bugs."""
    return {"status": "ok", "started_at": _session_started_at or time.time()}


@app.get("/system/info")
async def system_info():
    """Return CPU and RAM usage for dashboard system health widget."""
    try:
        import psutil
        return {
            "cpu_percent": psutil.cpu_percent(),
            "ram_percent": psutil.virtual_memory().percent,
            "backend_status": "optimal",
            "uptime": int(time.time() - (_session_started_at or time.time()))
        }
    except Exception:
        return {"cpu_percent": 0, "ram_percent": 0, "backend_status": "unknown"}


@app.post("/report-bug")
async def report_bug(payload: BugReportPayload):
    async with async_session() as session:
        report = await create_bug_report(
            session,
            bug_type=payload.type,
            timestamp=payload.timestamp,
            screenshot_b64=payload.screenshot or None,
            severity=payload.severity,
            trace_filename=payload.trace_filename,
            game_key=payload.game_key,
            fps_at_bug=payload.fps_at_bug,
            pc_was_struggling=payload.pc_was_struggling,
        )
        await session.commit()
    return {"id": report.id, "status": "logged"}


@app.get("/sessions")
async def list_sessions(
    game: Optional[str] = Query(None, description="Filter by game_key (e.g. nfs_rivals, my_game)"),
):
    """Sessions inferred by grouping bug_reports by date (one session per day)."""
    async with async_session() as session:
        sessions = await get_sessions_grouped_by_day(session, game_key=game)
    return {"sessions": sessions}


@app.get("/games")
async def list_games():
    """Game keys for dashboard selector: union of bug_reports and game_configs (Phase 2)."""
    async with async_session() as session:
        keys = await get_all_game_keys_merged(session)
    return {"games": keys}


@app.get("/game-config")
async def get_game_config_for_agent(game_key: Optional[str] = Query(None)):
    """Return full game config for the agent: window_title, process_names, genre, control_type, model_path."""
    if not game_key:
        raise HTTPException(400, "game_key required")
    async with async_session() as session:
        cfg = await get_game_config(session, game_key)
    if not cfg:
        raise HTTPException(404, f"Game config not found: {game_key}")
    try:
        names = json.loads(cfg.process_names or "[]")
    except Exception:
        names = []
    try:
        key_bindings = json.loads(cfg.key_bindings) if getattr(cfg, "key_bindings", None) else None
    except Exception:
        key_bindings = None
    try:
        menu_click_positions = json.loads(cfg.menu_click_positions) if getattr(cfg, "menu_click_positions", None) else None
    except Exception:
        menu_click_positions = None
    return {
        "window_title": cfg.window_title or "",
        "process_names": names,
        "genre": cfg.genre or "racing",
        "control_type": cfg.control_type or "ppo",
        "model_path": cfg.model_path if cfg.model_path else None,
        "key_bindings": key_bindings,
        "mouse_mode": getattr(cfg, "mouse_mode", None) or "none",
        "mouse_sensitivity": getattr(cfg, "mouse_sensitivity", None),
        "menu_click_positions": menu_click_positions,
        "minimap_left": getattr(cfg, "minimap_left", 200),
        "minimap_bottom": getattr(cfg, "minimap_bottom", 150),
        "minimap_size": getattr(cfg, "minimap_size", 200),
        "marker_template_path": getattr(cfg, "marker_template_path", None),
    }


@app.get("/game-configs")
async def list_game_configs_api():
    """List all game configs for dashboard Manage games page."""
    async with async_session() as session:
        configs = await list_game_configs(session)
    def _kb(c):
        try:
            return json.loads(c.key_bindings) if getattr(c, "key_bindings", None) else None
        except Exception:
            return None

    return {
        "configs": [
            {
                "game_key": c.game_key,
                "display_name": c.display_name,
                "window_title": c.window_title,
                "process_names": c.process_names,
                "genre": c.genre or "racing",
                "control_type": c.control_type or "ppo",
                "model_path": c.model_path or "",
                "key_bindings": _kb(c),
                "mouse_mode": getattr(c, "mouse_mode", None) or "none",
                "mouse_sensitivity": getattr(c, "mouse_sensitivity", None),
                "menu_click_positions": getattr(c, "menu_click_positions", None) or "",
                "minimap_left": getattr(c, "minimap_left", 200),
                "minimap_bottom": getattr(c, "minimap_bottom", 150),
                "minimap_size": getattr(c, "minimap_size", 200),
                "marker_template_path": getattr(c, "marker_template_path", None),
                "auto_detect_minimap": getattr(c, "auto_detect_minimap", True),
            }
            for c in configs
        ]
    }


@app.get("/game-configs/{game_key}")
async def get_game_config_api(game_key: str):
    """Get one game config."""
    async with async_session() as session:
        cfg = await get_game_config(session, game_key)
    if not cfg:
        raise HTTPException(404, f"Game config not found: {game_key}")
    return {
        "game_key": cfg.game_key,
        "display_name": cfg.display_name,
        "window_title": cfg.window_title,
        "process_names": cfg.process_names,
        "genre": cfg.genre or "racing",
        "control_type": cfg.control_type or "ppo",
        "model_path": cfg.model_path or "",
        "mouse_mode": getattr(cfg, "mouse_mode", None) or "none",
        "mouse_sensitivity": getattr(cfg, "mouse_sensitivity", None),
        "menu_click_positions": getattr(cfg, "menu_click_positions", None) or "",
        "minimap_left": getattr(cfg, "minimap_left", 200),
        "minimap_bottom": getattr(cfg, "minimap_bottom", 150),
        "minimap_size": getattr(cfg, "minimap_size", 200),
        "marker_template_path": getattr(cfg, "marker_template_path", None),
    }


@app.post("/game-configs")
async def create_game_config_api(payload: GameConfigPayload):
    """Create a game config."""
    async with async_session() as session:
        existing = await get_game_config(session, payload.game_key)
        if existing:
            raise HTTPException(409, f"Game key already exists: {payload.game_key}")
        cfg = await create_game_config(
            session,
            game_key=payload.game_key,
            display_name=payload.display_name,
            window_title=payload.window_title,
            process_names=payload.process_names,
            genre=payload.genre,
            control_type=payload.control_type,
            model_path=payload.model_path,
            key_bindings=payload.key_bindings,
            mouse_mode=payload.mouse_mode or "none",
            mouse_sensitivity=payload.mouse_sensitivity,
            menu_click_positions=payload.menu_click_positions,
            minimap_left=payload.minimap_left if payload.minimap_left is not None else 200,
            minimap_bottom=payload.minimap_bottom if payload.minimap_bottom is not None else 150,
            minimap_size=payload.minimap_size if payload.minimap_size is not None else 200,
            auto_detect_minimap=payload.auto_detect_minimap,
        )
        await session.commit()
    return _game_config_to_response(cfg)


def _game_config_to_response(cfg) -> dict:
    """Build API response dict for a GameConfig."""
    return {
        "game_key": cfg.game_key,
        "display_name": cfg.display_name,
        "window_title": cfg.window_title,
        "process_names": cfg.process_names,
        "genre": cfg.genre or "racing",
        "control_type": cfg.control_type or "ppo",
        "model_path": cfg.model_path or "",
        "mouse_mode": getattr(cfg, "mouse_mode", None) or "none",
        "mouse_sensitivity": getattr(cfg, "mouse_sensitivity", None),
        "menu_click_positions": getattr(cfg, "menu_click_positions", None) or "",
        "minimap_left": getattr(cfg, "minimap_left", 200),
        "minimap_bottom": getattr(cfg, "minimap_bottom", 150),
        "minimap_size": getattr(cfg, "minimap_size", 200),
        "marker_template_path": getattr(cfg, "marker_template_path", None),
    }


@app.post("/game-configs/{game_key}/template")
async def post_game_config_template(game_key: str, file: UploadFile = File(...)):
    """Upload a marker template (e.g. car_arrow.png) for a specific game."""
    target_dir = PROJECT_ROOT / "templates" / "markers"
    target_dir.mkdir(parents=True, exist_ok=True)
    
    # Save file with game_key prefix to avoid collisions
    filename = f"{game_key}_marker_{file.filename}"
    target_path = target_dir / filename
    
    try:
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(500, f"Failed to save file: {e}")
        
    rel_path = str(target_path.relative_to(PROJECT_ROOT))
    
    async with async_session() as session:
        cfg = await get_game_config(session, game_key)
        if not cfg:
            raise HTTPException(404, f"Game config not found: {game_key}")
        
        from backend.database.crud import update_game_config
        await update_game_config(session, game_key=game_key, marker_template_path=rel_path)
        await session.commit()
        
    return {"status": "ok", "path": rel_path}


@app.put("/game-configs/{game_key}")
async def update_game_config_api(game_key: str, payload: GameConfigUpdatePayload):
    """Update a game config."""
    async with async_session() as session:
        cfg = await update_game_config(
            session,
            game_key=game_key,
            display_name=payload.display_name,
            window_title=payload.window_title,
            process_names=payload.process_names,
            genre=payload.genre,
            control_type=payload.control_type,
            model_path=payload.model_path,
            key_bindings=payload.key_bindings,
            mouse_mode=payload.mouse_mode,
            mouse_sensitivity=payload.mouse_sensitivity,
            menu_click_positions=payload.menu_click_positions,
            minimap_left=payload.minimap_left,
            minimap_bottom=payload.minimap_bottom,
            minimap_size=payload.minimap_size,
            auto_detect_minimap=payload.auto_detect_minimap,
        )
        await session.commit()
    if not cfg:
        raise HTTPException(404, f"Game config not found: {game_key}")
    return _game_config_to_response(cfg)


@app.get("/bugs", response_model=List[BugReportResponse])
async def list_bugs(
    limit: int = 100,
    offset: int = 0,
    ids: Optional[str] = Query(None, description="Comma-separated bug ids, e.g. ids=1,2,3"),
    since: Optional[float] = Query(None, description="Only bugs with timestamp >= since (current session)"),
    game: Optional[str] = Query(None, description="Filter by game_key"),
):
    async with async_session() as session:
        if ids:
            id_list = [int(x.strip()) for x in ids.split(",") if x.strip()]
            reports = await get_bugs_by_ids(session, id_list)
        elif since is not None:
            reports = await get_bugs_since(session, since_ts=since, limit=limit, offset=offset, game_key=game)
        else:
            reports = await get_all_bugs(session, limit=limit, offset=offset, game_key=game)
        return [
            BugReportResponse(
                id=r.id,
                type=r.type,
                severity=getattr(r, "severity", None),
                timestamp=r.timestamp,
                has_screenshot=bool(r.screenshot_b64),
                trace_filename=getattr(r, "trace_filename", None),
                created_at=r.created_at.isoformat() if r.created_at else None,
            )
            for r in reports
        ]


@app.get("/bugs/{bug_id}/screenshot")
async def get_bug_screenshot(bug_id: int):
    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(BugReport).where(BugReport.id == bug_id))
        report = result.scalar_one_or_none()
        if not report or not report.screenshot_b64:
            raise HTTPException(404, "Screenshot not found")
        return {"base64": report.screenshot_b64}


@app.get("/stats")
async def stats(
    game: Optional[str] = Query(None, description="Filter by game_key"),
):
    async with async_session() as session:
        return await get_session_stats(session, game_key=game)


@app.post("/coverage/points")
async def log_coverage_points(payload: CoveragePointsPayload):
    """Accept position logs from the agent (env.step()) when GPS unavailable."""
    with _coverage_lock:
        for pt in payload.points:
            if len(pt) >= 2:
                x, y = int(pt[0]), int(pt[1])
                if 0 <= x < COVERAGE_GRID_SIZE and 0 <= y < COVERAGE_GRID_SIZE:
                    _coverage_counts[(x, y)] += 1
    return {"status": "ok", "logged": len(payload.points)}


def _heatmap_from_grid(grid: Optional[List[List[float]]], grid_size: int) -> List[Dict]:
    """Build heatmap list of {x, y, count} from 2D grid for WebSocket/GET."""
    if not grid:
        return []
    heatmap = []
    for x in range(len(grid)):
        row = grid[x]
        for y in range(len(row) if row else 0):
            c = row[y] if y < len(row) else 0
            if c > 0:
                heatmap.append({"x": x, "y": y, "count": int(c)})
    return heatmap


async def _broadcast_coverage():
    """Broadcast current coverage grid to all WebSocket clients."""
    with _coverage_lock:
        grid = _coverage_grid
        size = SPATIAL_GRID_SIZE if grid else COVERAGE_GRID_SIZE
    if grid is None:
        with _coverage_lock:
            heatmap = [{"x": x, "y": y, "count": c} for (x, y), c in _coverage_counts.items() if c > 0]
        size = COVERAGE_GRID_SIZE
    else:
        heatmap = _heatmap_from_grid(grid, size)
    msg = {"heatmap": heatmap, "gridSize": size}
    async with _ws_lock:
        dead = []
        for ws in _ws_coverage_clients:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _ws_coverage_clients.discard(ws)


@app.websocket("/ws/coverage")
async def websocket_coverage(websocket: WebSocket):
    """Live coverage: send current heatmap on connect, then broadcast on each grid update."""
    await websocket.accept()
    async with _ws_lock:
        _ws_coverage_clients.add(websocket)
    try:
        # Send initial snapshot so new/reconnecting clients get state
        with _coverage_lock:
            if _coverage_grid is not None:
                heatmap = _heatmap_from_grid(_coverage_grid, SPATIAL_GRID_SIZE)
                grid_size = SPATIAL_GRID_SIZE
            else:
                heatmap = [{"x": x, "y": y, "count": c} for (x, y), c in _coverage_counts.items() if c > 0]
                grid_size = COVERAGE_GRID_SIZE
        await websocket.send_json({"heatmap": heatmap, "gridSize": grid_size})
        # Keep connection alive; client can just receive broadcasts (we push on POST /coverage/grid)
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"ping": True})
    except WebSocketDisconnect:
        pass
    finally:
        async with _ws_lock:
            _ws_coverage_clients.discard(websocket)


@app.post("/coverage/grid")
async def log_coverage_grid(payload: CoverageGridPayload):
    """Accept full 100x100 spatial memory grid from the agent for live heatmap."""
    global _coverage_grid
    grid = payload.grid
    if not grid or not isinstance(grid, list):
        return {"status": "ok", "logged": False}
    # Normalize to 100x100 list of lists
    rows = min(SPATIAL_GRID_SIZE, len(grid))
    out = []
    for r in range(rows):
        row = grid[r] if r < len(grid) and isinstance(grid[r], list) else []
        out.append([float(row[c]) if c < len(row) else 0.0 for c in range(SPATIAL_GRID_SIZE)])
    while len(out) < SPATIAL_GRID_SIZE:
        out.append([0.0] * SPATIAL_GRID_SIZE)
    with _coverage_lock:
        _coverage_grid = out[:SPATIAL_GRID_SIZE]
    await _broadcast_coverage()
    # Periodic save (every grid update from agent)
    _save_analytics_state()
    return {"status": "ok", "logged": True}


@app.get("/coverage")
async def get_coverage():
    """Return heatmap data for dashboard: list of {x, y, count} and grid size."""
    with _coverage_lock:
        if _coverage_grid is not None:
            heatmap = []
            for x in range(len(_coverage_grid)):
                row = _coverage_grid[x]
                for y in range(len(row) if row else 0):
                    c = row[y] if y < len(row) else 0
                    if c > 0:
                        heatmap.append({"x": x, "y": y, "count": int(c)})
            return {
                "heatmap": heatmap,
                "gridSize": SPATIAL_GRID_SIZE,
                "message": "" if heatmap else "Run the agent to build coverage data.",
            }
        heatmap = [
            {"x": x, "y": y, "count": c}
            for (x, y), c in _coverage_counts.items()
            if c > 0
        ]
    return {
        "heatmap": heatmap,
        "gridSize": COVERAGE_GRID_SIZE,
        "message": "" if heatmap else "Run the agent to build coverage data.",
    }


# --- Analytics ---
@app.post("/analytics/update")
async def analytics_update(payload: AnalyticsUpdatePayload):
    """Agent pushes path trail, action counts, session stats."""
    global _path_trail, _action_counts, _session_stats, _session_history, _last_step_count
    with _analytics_lock:
        if payload.path is not None:
            _path_trail = payload.path[-_analytics_max_path:]
        if payload.action_counts is not None:
            _action_counts = defaultdict(int, {k: v for k, v in payload.action_counts.items()})
        if payload.step_count is not None:
            if _last_step_count >= 0 and payload.step_count < _last_step_count:
                # New episode/session: push current to history
                if _session_stats:
                    _session_history.insert(0, dict(_session_stats))
                    _session_history[:] = _session_history[:10]
            _last_step_count = payload.step_count
        if any(
            getattr(payload, k) is not None
            for k in ("unique_cells", "distance_approx", "step_count", "episode_count", "current_fps", "game_key")
        ):
            s = dict(_session_stats)
            if payload.unique_cells is not None:
                s["unique_cells"] = payload.unique_cells
            if payload.distance_approx is not None:
                s["distance_approx"] = payload.distance_approx
            if payload.step_count is not None:
                s["step_count"] = payload.step_count
            if payload.episode_count is not None:
                s["episode_count"] = payload.episode_count
            if payload.current_fps is not None:
                s["current_fps"] = payload.current_fps
            if payload.game_key is not None:
                # Per-game marker so dashboard can display which game the current analytics came from
                s["game_key"] = payload.game_key
            _session_stats = s
    
    # Periodic save for stats
    if payload.step_count is not None and payload.step_count % 10 == 0:
        _save_analytics_state()
        
    return {"status": "ok"}


@app.get("/analytics")
async def get_analytics():
    """Full analytics for Analytics page: path, actions, stats, pause, live screenshot, coverage, session history."""
    with _analytics_lock:
        path = list(_path_trail)
        action_counts = dict(_action_counts)
        session_stats = dict(_session_stats)
        paused = _paused
        live_b64 = _live_screenshot_b64
        history = list(_session_history)
    with _coverage_lock:
        if _coverage_grid is not None:
            heatmap = []
            for x in range(len(_coverage_grid)):
                row = _coverage_grid[x]
                for y in range(len(row) if row else 0):
                    c = row[y] if y < len(row) else 0
                    if c > 0:
                        heatmap.append({"x": x, "y": y, "count": int(c)})
            grid_size = SPATIAL_GRID_SIZE
        else:
            heatmap = [
                {"x": x, "y": y, "count": c}
                for (x, y), c in _coverage_counts.items()
                if c > 0
            ]
            grid_size = COVERAGE_GRID_SIZE
    return {
        "path": path,
        "action_counts": action_counts,
        "session_stats": session_stats,
        "paused": paused,
        "live_screenshot": live_b64,
        "session_history": history,
        "heatmap": heatmap,
        "grid_size": grid_size,
    }


@app.get("/analytics/pause")
async def get_pause():
    return {"paused": _paused}


@app.patch("/analytics/pause")
async def set_pause(payload: PausePayload):
    global _paused
    _paused = payload.paused
    return {"paused": _paused}


@app.post("/analytics/live-screenshot")
async def post_live_screenshot(payload: LiveScreenshotPayload):
    global _live_screenshot_b64
    if payload.base64:
        _live_screenshot_b64 = payload.base64
    return {"status": "ok"}


@app.get("/analytics/live-screenshot")
async def get_live_screenshot():
    if _live_screenshot_b64 is None:
        raise HTTPException(404, "No live screenshot")
    return {"base64": _live_screenshot_b64}


# --- Agent control (start/stop test execution from dashboard) ---
@app.get("/agent/status")
async def agent_status():
    """Return whether the testing agent is currently running."""
    with _agent_lock:
        running = _agent_process is not None and _agent_process.poll() is None
        pid = _agent_process.pid if _agent_process and running else None
    return {"running": running, "pid": pid}


@app.post("/agent/start")
async def agent_start(payload: Optional[AgentStartPayload] = Body(None)):
    """Start the testing agent (run_agent.py) in a subprocess. Requires a trained model. Optional body: { \"game_key\": \"nfs_rivals\" } to run for that game."""
    global _agent_process
    game_key = (payload.game_key if payload and payload.game_key else None) or "nfs_rivals"
    with _agent_lock:
        if _agent_process is not None and _agent_process.poll() is None:
            raise HTTPException(409, "Agent is already running")
        env = {**__import__("os").environ, "PYTHONPATH": str(PROJECT_ROOT), "GAME_KEY": game_key}
        _agent_process = subprocess.Popen(
            [sys.executable, "agents/run_agent.py"],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=env,
        )
    return {"status": "started", "pid": _agent_process.pid, "game_key": game_key}


@app.post("/agent/stop")
async def agent_stop():
    """Stop the testing agent if it is running."""
    global _agent_process
    with _agent_lock:
        if _agent_process is None:
            return {"status": "stopped", "message": "Agent was not running"}
        if _agent_process.poll() is None:
            _agent_process.terminate()
            try:
                _agent_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _agent_process.kill()
        _agent_process = None
    return {"status": "stopped"}


@app.get("/agent/train/status")
async def training_status(
    game: Optional[str] = Query(None, description="Optional game_key to get training progress for a specific game"),
):
    """Return whether a training run is currently active (Phase 4), plus latest progress snapshot
    and a short history of recent runs for the selected game.

    History is persisted across backend restarts so users can see "so far"
    training progress even after downtime. Only the last ~10 runs per game are kept."""
    global _training_process, _training_game_key
    with _training_lock:
        if _training_process is not None and _training_process.poll() is not None:
            # Process exited (crash or finish); clear so dashboard and Start training work
            _training_process = None
            _training_game_key = None
        running = _training_process is not None and _training_process.poll() is None
        pid = _training_process.pid if _training_process and running else None
        running_game = _training_game_key if running else None
        if game:
            progress = _training_progress.get(game)
            history = list(_training_history.get(game, []))
        else:
            progress = list(_training_progress.values())[-1] if _training_progress else None
            # When no game is specified, history is not particularly meaningful; return empty list.
            history = []
    return {
        "running": running,
        "pid": pid,
        "progress": progress,
        "running_game_key": running_game,
        "history": history,
    }


@app.post("/agent/train/stop")
async def agent_train_stop():
    """Stop the training process. Writes a stop-request file so the process can save the model before exiting."""
    global _training_process, _training_game_key, _training_run_id
    with _training_lock:
        if _training_process is None:
            return {"status": "stopped", "message": "Training was not running"}
        game_key = _training_game_key or ""
        proc = _training_process
        running = proc.poll() is None
    if running:
        # Ask training script to stop gracefully so it saves the model (finally block runs)
        stop_dir = PROJECT_ROOT / "logs" / "training"
        stop_file = stop_dir / "stop_requested.txt"
        try:
            stop_dir.mkdir(parents=True, exist_ok=True)
            stop_file.write_text(game_key or "", encoding="utf-8")
        except Exception:
            pass
        # Wait up to 30 seconds for process to exit
        for _ in range(30):
            if proc.poll() is not None:
                break
            time.sleep(1)
        # If still running, terminate (model may not be saved)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    with _training_lock:
        _training_process = None
        if game_key and game_key in _training_progress:
            snap = _training_progress[game_key]
            snap["done"] = True
            snap["updated_at"] = time.time()
            # Also mark finished_at on the corresponding history entry
            runs = _training_history.get(game_key) or []
            run_id = snap.get("run_id") or _training_run_id
            if run_id:
                for r in reversed(runs):
                    if r.get("run_id") == run_id:
                        r["done"] = True
                        r.setdefault("finished_at", snap["updated_at"])
                        break
        _training_game_key = None
        _training_run_id = None
    return {"status": "stopped", "game_key": game_key}


@app.post("/agent/train/progress")
async def agent_train_progress(payload: TrainingProgressPayload):
    """Receive training progress updates from agents/train.py."""
    now = time.time()
    game_key = payload.game_key
    run_id = payload.run_id or f"{game_key}-{int(now)}"
    source = (payload.source or "cli").lower()
    data = {
        "game_key": game_key,
        "algo": payload.algo,
        "total_timesteps": payload.total_timesteps,
        "target_timesteps": payload.target_timesteps,
        "episode": payload.episode,
        "reward": payload.reward,
        "best_reward": payload.best_reward,
        "done": bool(payload.done) if payload.done is not None else False,
        "updated_at": now,
        "run_id": run_id,
        "source": source,
    }
    with _training_lock:
        # Update latest snapshot
        _training_progress[game_key] = data
        # Append/update history for this game_key + run_id
        runs = _training_history.setdefault(game_key, [])
        existing = None
        for r in reversed(runs):
            if r.get("run_id") == run_id:
                existing = r
                break
        if existing is None:
            snapshot = dict(data)
            snapshot.setdefault("started_at", now)
            runs.append(snapshot)
        else:
            existing.update({k: v for k, v in data.items() if v is not None})
            if data["done"]:
                existing.setdefault("finished_at", now)
        # Keep only the last 10 runs for this game
        if len(runs) > 10:
            _training_history[game_key] = runs[-10:]
    return {"status": "ok"}


@app.post("/agent/train")
async def agent_train_start(payload: AgentTrainPayload = Body(...)):
    """Start training for a game in a subprocess (agents/train.py --game_key ...). Phase 4."""
    global _training_process, _training_game_key, _training_run_id
    game_key = (payload.game_key or "").strip() or "nfs_rivals"
    algo = (payload.algo or "ppo").strip().lower()
    if algo not in ("ppo", "dqn"):
        algo = "ppo"
    # Try to align algo with game config control_type when available; fallback to lowercase key
    async with async_session() as session:
        cfg = await get_game_config(session, game_key)
        if cfg is None and game_key != game_key.lower():
            cfg = await get_game_config(session, game_key.lower())
            if cfg is not None:
                game_key = game_key.lower()
    if cfg is None:
        raise HTTPException(404, f"Game config not found: {payload.game_key or game_key}. Add the game in Dashboard → Game configs.")
    if getattr(cfg, "control_type", None):
        cfg_algo = (cfg.control_type or "").strip().lower()
        if cfg_algo in ("ppo", "dqn"):
            algo = cfg_algo
    with _training_lock:
        if _training_process is not None and _training_process.poll() is not None:
            _training_process = None
            _training_game_key = None
            _training_run_id = None
        if _training_process is not None and _training_process.poll() is None:
            raise HTTPException(409, "Training is already running. Wait for it to finish or click Stop training.")
        
        # Redirect stdout/stderr to a log file to avoid hanging on pipe buffer limits (Windows)
        log_dir = PROJECT_ROOT / "logs" / "training"
        log_dir.mkdir(parents=True, exist_ok=True)
        started_at = int(time.time())
        log_file_path = log_dir / f"train_{game_key}_{started_at}.log"
        log_file = open(log_file_path, "w", encoding="utf-8")

        # Run identifier so progress + history can distinguish individual runs.
        run_id = f"{game_key}-{started_at}"
        env = {
            **__import__("os").environ,
            "PYTHONPATH": str(PROJECT_ROOT),
            "TRAIN_RUN_ID": run_id,
            "TRAIN_SOURCE": "dashboard",
        }
        _training_process = subprocess.Popen(
            [sys.executable, "agents/train.py", "--game_key", game_key, "--algo", algo],
            cwd=str(PROJECT_ROOT),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            env=env,
        )
        _training_progress.pop(game_key, None)
        _training_game_key = game_key
        _training_run_id = run_id
    return {
        "status": "started",
        "pid": _training_process.pid,
        "game_key": game_key,
        "algo": algo,
        "log_file": str(log_file_path),
    }


# --- Chess: Stockfish next move (Play vs AI) ---
class ChessNextMovePayload(BaseModel):
    fen: str
    ai_side: Optional[str] = "b"  # "w" = AI plays White, "b" = AI plays Black
    movetime: Optional[float] = None  # seconds per move (clamped 0.2–5.0); None = 1.5
    skill_level: Optional[int] = None  # Stockfish skill level (0-20)


def _get_stockfish_path():
    import shutil
    path = __import__("os").environ.get("STOCKFISH_PATH")
    if path:
        return path
    for name in ("stockfish", "stockfish.exe"):
        p = shutil.which(name)
        if p:
            return p
    return None


def _stockfish_best_move_sync(fen: str, movetime: float = 1.0, ai_side: str = "b", skill_level: Optional[int] = None) -> Optional[str]:
    """Run Stockfish synchronously; return UCI move string (e.g. e7e5) or None. ai_side: 'w' or 'b'."""
    try:
        import chess
        import chess.engine
    except ImportError:
        return None
    path = _get_stockfish_path()
    if not path:
        return None
    side = chess.WHITE if (ai_side or "b").lower() == "w" else chess.BLACK
    try:
        engine = chess.engine.SimpleEngine.popen_uci(path)
        
        # Set skill level if provided (Stockfish support 0-20 range)
        if skill_level is not None:
            engine.configure({"Skill Level": max(0, min(20, skill_level))})
            
        board = chess.Board(fen)
        if board.is_game_over() or board.turn != side:
            engine.quit()
            return None
        result = engine.play(board, chess.engine.Limit(time=movetime))
        engine.quit()
        if result.move is None:
            return None
        return result.move.uci()
    except Exception:
        return None


@app.post("/chess/next-move")
async def chess_next_move(payload: ChessNextMovePayload):
    """Get Stockfish's best move for the given FEN. ai_side: 'w' = AI plays White, 'b' = AI plays Black. movetime: seconds (0.2–5.0)."""
    movetime = payload.movetime if payload.movetime is not None else 1.5
    movetime = max(0.2, min(5.0, movetime))
    move = await asyncio.to_thread(
        _stockfish_best_move_sync, 
        payload.fen, 
        movetime, 
        payload.ai_side or "b",
        payload.skill_level
    )
    if move is None:
        path = _get_stockfish_path()
        raise HTTPException(
            503,
            detail="Stockfish not available. Install Stockfish and add it to PATH, or set STOCKFISH_PATH."
            if not path else "Stockfish could not produce a move (invalid FEN or engine error).",
        )
    return {"move": move}


@app.get("/chess/stockfish-status")
async def chess_stockfish_status():
    """Check if Stockfish is available."""
    path = _get_stockfish_path()
    return {"available": path is not None, "path": path}


# --- Comprehensive test report (heatmap image, trace summaries, full stats) ---
TRACES_DIR = PROJECT_ROOT / "logs" / "traces"


def _read_trace_summary(trace_filename: str, max_actions: int = 20) -> str:
    """Read trace file and return a short summary of last actions for the report."""
    if not trace_filename:
        return ""
    path = TRACES_DIR / trace_filename
    if not path.exists():
        return f"(trace file not found: {trace_filename})"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        actions = data.get("actions") or []
        if not actions:
            return "No actions recorded"
        subset = actions[-max_actions:]
        return " | ".join(f"Step {a.get('step', '?')}: {a.get('keys', '?')}" for a in subset)
    except Exception:
        return f"(could not read trace: {trace_filename})"


@app.get("/report/comprehensive")
async def report_comprehensive(
    since: Optional[float] = Query(None, description="Only bugs with timestamp >= since (current session)"),
    bug_limit: int = Query(100, ge=1, le=500),
    game: Optional[str] = Query(None, description="Filter by game_key"),
):
    """Generate comprehensive report data: stats, bugs with trace summaries, coverage heatmap as base64."""
    import base64
    import numpy as np

    with _analytics_lock:
        session_stats = dict(_session_stats)
    with _coverage_lock:
        grid = _coverage_grid
        if not grid:
            grid = [[_coverage_counts.get((x, y), 0) for y in range(COVERAGE_GRID_SIZE)] for x in range(COVERAGE_GRID_SIZE)]
        grid_size = SPATIAL_GRID_SIZE if _coverage_grid is not None else COVERAGE_GRID_SIZE

    heatmap_b64 = None
    try:
        from environment.reports_utils import heatmap_to_png_bytes
        arr = np.array(grid, dtype=float)
        png_bytes = heatmap_to_png_bytes(arr, title="Gameplay Coverage Heatmap")
        if png_bytes:
            heatmap_b64 = base64.b64encode(png_bytes).decode("ascii")
    except Exception:
        pass

    async with async_session() as session:
        stats = await get_session_stats(session, game_key=game)
        if since is not None:
            bugs_result = await get_bugs_since(session, since_ts=since, limit=bug_limit, offset=0, game_key=game)
        else:
            bugs_result = await get_all_bugs(session, limit=bug_limit, offset=0, game_key=game)

    bugs_out = []
    for r in bugs_result:
        trace_summary = _read_trace_summary(getattr(r, "trace_filename", None) or "")
        bugs_out.append({
            "id": r.id,
            "type": r.type,
            "severity": getattr(r, "severity", None) or "minor",
            "timestamp": r.timestamp,
            "trace_filename": getattr(r, "trace_filename", None),
            "trace_summary": trace_summary,
            "has_screenshot": bool(r.screenshot_b64),
        })

    total_tiles = grid_size * grid_size
    unique_cells = session_stats.get("unique_cells")
    coverage_pct = (100.0 * unique_cells / total_tiles) if (total_tiles and unique_cells is not None) else None

    return {
        "generated_at": time.time(),
        "session_started_at": _session_started_at,
        "stats": stats,
        "session_stats": session_stats,
        "bugs": bugs_out,
        "heatmap_image_b64": heatmap_b64,
        "coverage_pct": round(coverage_pct, 1) if coverage_pct is not None else None,
        "grid_size": grid_size,
        "unique_cells": unique_cells,
    }
