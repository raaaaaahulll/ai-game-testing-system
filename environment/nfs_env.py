"""
Custom Gymnasium Environment: Bridge to NFS Rivals (and other games via game_profile).
Observation: screen (e.g. 84x84 grayscale). Action: discrete [accel, brake, left, right].
Reward: gamified for testing (speed/distance +, crash/stuck -).

Game profiles (Phase 2):
- racing: full behavior — speed OCR, minimap/GPS, exploration, loop/stuck-wall, sharp-steer penalty, perf monitoring.
- open_world: motion + pseudo-position exploration; no minimap/loop/speed OCR; solid color, freeze, motion stuck; perf on.
- minimal: motion bonus only; no exploration reward, no OCR/minimap/loop; solid color, freeze, motion stuck; no perf.
"""
import json
import time
from collections import deque, defaultdict
from pathlib import Path
from typing import Any, Dict, Optional

import gymnasium as gym
import numpy as np

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import (
    PROJECT_ROOT,
    MOUSE_SENSITIVITY,
    OBS_HEIGHT,
    OBS_WIDTH,
    OBS_CHANNELS,
    FRAME_SKIP,
    MAX_EPISODE_STEPS,
    BACKEND_URL,
    GAME_KEY,
    GAME_WINDOW_TITLE,
    NFS_PROCESS_NAMES,
    SOLID_COLOR_THRESHOLD,
    SCREEN_ANOMALY_CONFIRMATION_FRAMES,
    STUCK_FRAMES_THRESHOLD,
    STUCK_SPEED_ZERO_FRAMES,
    IDENTICAL_FRAME_THRESHOLD,
    MIN_SPEED_OCR,
    ENABLE_SPEED_OCR_STUCK,
    SPEEDOMETER_RATIOS,
    SPEED_REWARD_SCALE,
    HIGH_SPEED_THRESHOLD,
    SHARP_STEER_PENALTY,
    HEATMAP_GRID_SIZE,
    COVERAGE_LOG_BATCH,
    EXPLORATION_BONUS_SCALE,
    SPATIAL_GRID_SIZE,
    CAR_ARROW_TEMPLATE_PATH,
    MINIMAP_LEFT,
    MINIMAP_BOTTOM_OFFSET,
    MINIMAP_SIZE,
    CAR_ARROW_MATCH_THRESHOLD,
    EXPLORATION_BONUS_MULTIPLIER,
    LOOP_SAME_TILES_MAX,
    LOOP_WINDOW_STEPS,
    STUCK_WALL_PIXEL_THRESHOLD,
    STUCK_WALL_STEPS,
    HEATMAP_SAVE_EVERY_STEPS,
    COVERAGE_PUSH_EVERY_STEPS,
    ANALYTICS_PUSH_EVERY_STEPS,
    STEP_LOG_EVERY,
    REPORTS_DIR,
    TRACES_DIR,
    TRACE_RING_BUFFER_SIZE,
    PERF_FRAME_TIME_WINDOW,
    PERF_MIN_FPS,
    PERF_LOW_FPS_STEPS,
    ENABLE_PERF_MONITORING,
)
from core.controller import set_action, release_all, click_mouse, move_mouse_relative, focus_game_window, KEY_ACCEL, KEY_BRAKE, KEY_LEFT, KEY_RIGHT  # KEY_* for trace/display
from core.game_monitor import is_process_running
from core.vision_utils import (
    capture_region,
    capture_minimap_region,
    get_game_window_rect,
    get_car_coordinates,
    is_solid_color_anomaly,
    compute_frame_difference,
    get_dynamic_stuck_threshold,
    get_base64_screenshot,
    frame_hash,
    get_speed_from_screen,
    is_game_window_foreground,
)
from environment.reports_utils import save_heatmap


# Discrete actions: 0=coast, 1=accel, 2=brake, 3=left, 4=right, 5=accel+left, 6=accel+right, 7=accel; 8–11 = look (Phase 6)
ACTION_MEANINGS = [
    (False, False, False, False),  # 0: no input
    (True, False, False, False),  # 1: accel
    (False, True, False, False),  # 2: brake
    (False, False, True, False),  # 3: left
    (False, False, False, True),  # 4: right
    (True, False, True, False),   # 5: accel+left
    (True, False, False, True),  # 6: accel+right
    (True, False, False, False), # 7: accel (duplicate for more weight)
    (False, False, False, False), # 8: look_left (mouse only when gameplay)
    (False, False, False, False), # 9: look_right
    (False, False, False, False), # 10: look_up
    (False, False, False, False), # 11: look_down
]
NUM_ACTIONS_BASE = 8
NUM_ACTIONS = len(ACTION_MEANINGS)  # 12

# Pseudo-movement (dx, dy) per action for position logging / heatmap (forward=+y, right=+x)
ACTION_DELTA = [
    (0.0, 0.0),   # 0: coast
    (0.0, 1.0),   # 1: accel
    (0.0, -0.5),  # 2: brake
    (-1.0, 0.0),  # 3: left
    (1.0, 0.0),   # 4: right
    (-0.7, 0.7),  # 5: accel+left
    (0.7, 0.7),   # 6: accel+right
    (0.0, 1.0),   # 7: accel
    (0.0, 0.0),   # 8: look_left
    (0.0, 0.0),   # 9: look_right
    (0.0, 0.0),   # 10: look_up
    (0.0, 0.0),   # 11: look_down
]

# Human-readable keys per action for trace (ring buffer)
ACTION_KEYS_STR = [
    "none",
    "UP",
    "DOWN",
    "LEFT",
    "RIGHT",
    "UP+LEFT",
    "UP+RIGHT",
    "UP",
    "look_left",
    "look_right",
    "look_up",
    "look_down",
]


class NFSRivalsEnv(gym.Env):
    metadata = {"render_modes": ["human", "rgb_array"]}

    def __init__(
        self,
        monitor: Optional[dict] = None,
        obs_height: int = OBS_HEIGHT,
        obs_width: int = OBS_WIDTH,
        frame_skip: int = FRAME_SKIP,
        max_episode_steps: int = MAX_EPISODE_STEPS,
        backend_url: Optional[str] = None,
        render_mode: Optional[str] = None,
        process_names: Optional[tuple] = None,
        window_title: Optional[str] = None,
        game_profile: Optional[str] = None,
        key_bindings: Optional[Dict[str, str]] = None,
        mouse_mode: Optional[str] = None,
        mouse_sensitivity: Optional[int] = None,
        menu_click_positions: Optional[Dict[str, Any]] = None,
        minimap_left: Optional[int] = None,
        minimap_bottom: Optional[int] = None,
        minimap_size: Optional[int] = None,
        marker_template_path: Optional[str] = None,
        auto_detect_minimap: bool = True,
    ):
        super().__init__()
        self._monitor = monitor
        self.obs_height = obs_height
        self.obs_width = obs_width
        self.frame_skip = frame_skip
        self.max_episode_steps = max_episode_steps
        self._backend_url = (backend_url or BACKEND_URL).rstrip("/")
        self._report_url = self._backend_url + "/report-bug"
        # Phase 1: optional overrides from game config (agent fetches by game_key)
        self._process_names = tuple(process_names) if process_names else NFS_PROCESS_NAMES
        self._window_title = window_title if window_title is not None else (GAME_WINDOW_TITLE or "")
        # Phase 2: reward/bug profile: racing (full), open_world (motion + pseudo exploration), minimal (motion only)
        self._game_profile = (game_profile or "racing").strip().lower()
        if self._game_profile not in ("racing", "open_world", "minimal"):
            self._game_profile = "racing"
        self.render_mode = render_mode
        # Per-game key bindings (None = default arrows)
        self._key_bindings = key_bindings if isinstance(key_bindings, dict) else None
        # Mouse automation: none | menus_only | gameplay (Phase 4)
        self._mouse_mode = (mouse_mode or "none").strip().lower() if mouse_mode else "none"
        if self._mouse_mode not in ("none", "menus_only", "gameplay"):
            self._mouse_mode = "none"
        self._mouse_sensitivity = mouse_sensitivity if isinstance(mouse_sensitivity, int) and mouse_sensitivity >= 1 else None
        self._menu_click_positions = menu_click_positions if isinstance(menu_click_positions, dict) else None
        # Universal Vision: defaults from config.py
        self._minimap_left = minimap_left if minimap_left is not None else MINIMAP_LEFT
        self._minimap_bottom = minimap_bottom if minimap_bottom is not None else MINIMAP_BOTTOM_OFFSET
        self._minimap_size = minimap_size if minimap_size is not None else MINIMAP_SIZE
        # Resolve marker template: custom from DB or default car_arrow.png
        if marker_template_path:
            p = PROJECT_ROOT / marker_template_path
            self._marker_template_path = str(p) if p.exists() else str(CAR_ARROW_TEMPLATE_PATH)
        else:
            self._marker_template_path = str(CAR_ARROW_TEMPLATE_PATH)
        
        self._auto_detect_minimap_toggle = auto_detect_minimap
        self._auto_minimap_rect: Optional[dict] = None  # Cache for detection

        self.observation_space = gym.spaces.Box(
            low=0,
            high=255,
            shape=(obs_height, obs_width, OBS_CHANNELS),
            dtype=np.uint8,
        )
        # Phase 6: when gameplay, action space includes look_left/right/up/down (8–11)
        self.action_space = gym.spaces.Discrete(
            NUM_ACTIONS if self._mouse_mode == "gameplay" else NUM_ACTIONS_BASE
        )

        self._step_count = 0
        self._prev_frame: Optional[np.ndarray] = None
        self._stuck_frames = 0
        self._last_reward = 0.0
        # Position logging for heatmap (pseudo-position from actions when GPS unavailable)
        self._grid_size = HEATMAP_GRID_SIZE
        self._pos_x = float(self._grid_size // 2)
        self._pos_y = float(self._grid_size // 2)
        self._position_buffer: list = []
        self._coverage_url = self._backend_url + "/coverage/points"
        self._coverage_grid_url = self._backend_url + "/coverage/grid"
        self._visit_counts: dict = {}  # (gx, gy) -> count, for exploration bonus
        self._exploration_scale = EXPLORATION_BONUS_SCALE
        # Spatial memory: 100x100 grid from GPS (minimap arrow); fallback to pseudo when no template
        self._spatial_grid_size = SPATIAL_GRID_SIZE
        self._map_memory = np.zeros((SPATIAL_GRID_SIZE, SPATIAL_GRID_SIZE), dtype=np.float64)
        self._recent_tiles: deque = deque(maxlen=LOOP_WINDOW_STEPS)  # for Logic Loop detection
        self._last_gps_coords: Optional[tuple] = None  # (px, py) minimap pixels
        self._stuck_wall_steps = 0  # accel + no movement for Terrain Collision detection
        # Analytics: path trail, action counts, session stats (pushed to backend)
        self._path_trail: deque = deque(maxlen=1000)
        self._action_counts: dict = defaultdict(int)
        self._distance_approx = 0.0
        self._last_path_point: Optional[tuple] = None
        self._episode_count = 0
        self._analytics_url = self._backend_url + "/analytics/update"
        # Identical-frame freeze detection
        self._identical_frame_count = 0
        self._last_frame_hash: Optional[str] = None
        # OCR: speed 0 for N frames while accel = stuck
        self._speed_zero_accel_frames = 0
        # Ring buffer of last N actions for trace on bug (reproduction)
        self._action_trace: deque = deque(maxlen=TRACE_RING_BUFFER_SIZE)
        self._session_id = f"{int(time.time() * 1000)}"
        # Performance monitoring: frame timings and low-FPS count
        self._frame_times: deque = deque(maxlen=PERF_FRAME_TIME_WINDOW)
        self._last_frame_time: Optional[float] = None
        self._low_fps_count: int = 0
        self._current_fps: Optional[float] = None
        # Step 2: Confirmation buffer — pending bug candidate counts (persist across episodes)
        self.bug_pending: dict = {}
        self.BUG_CONFIRMATION_FRAMES = 10
        # Step 3: Screen anomaly persistence counter
        self.screen_anomaly_counter: int = 0

    def _get_obs(self) -> np.ndarray:
        frame = capture_region(
            self._monitor,
            width=self.obs_width,
            height=self.obs_height,
            grayscale=(OBS_CHANNELS == 1),
        )
        if OBS_CHANNELS == 1 and len(frame.shape) == 2:
            frame = np.expand_dims(frame, axis=-1)
        return frame

    def _get_minimap_frame(self) -> np.ndarray:
        """Capture the minimap region (auto-detected or manual)."""
        monitor = get_game_window_rect(self._window_title or None) or self._monitor
        
        if self._auto_detect_minimap_toggle:
            if self._auto_minimap_rect is None or self._step_count % 100 == 0:
                from core.vision_utils import auto_detect_minimap
                det = auto_detect_minimap(monitor)
                if det:
                    self._auto_minimap_rect = det
            
            if self._auto_minimap_rect:
                # Capture using detected rect
                try:
                    with mss.mss() as sctx:
                        mon = monitor
                        region = {
                            "left": mon["left"] + self._auto_minimap_rect["left"],
                            "top": mon["top"] + self._auto_minimap_rect["top"],
                            "width": self._auto_minimap_rect["width"],
                            "height": self._auto_minimap_rect["height"],
                        }
                        shot = sctx.grab(region)
                        return cv2.cvtColor(np.array(shot), cv2.COLOR_BGRA2BGR)
                except Exception:
                    pass

        # Fallback to manual
        return capture_minimap_region(
            monitor,
            left=self._minimap_left,
            bottom_offset=self._minimap_bottom,
            width=self._minimap_size,
            height=self._minimap_size,
        )

    def _apply_action(self, action: int) -> None:
        action_idx = min(int(action) % NUM_ACTIONS, NUM_ACTIONS - 1)
        accel, brake, left, right = ACTION_MEANINGS[action_idx]
        # #region agent log
        if self._step_count < 2:
            _debug_log = getattr(self, "_debug_log_path", str(PROJECT_ROOT / ".cursor" / "debug.log"))
            try:
                import json as _json
                with open(_debug_log, "a", encoding="utf-8") as _f:
                    _f.write(_json.dumps({"location": "nfs_env.py:_apply_action", "message": "before set_action", "data": {"step": self._step_count, "action": action, "action_idx": action_idx, "accel": accel, "brake": brake, "left": left, "right": right, "key_bindings": self._key_bindings}, "timestamp": time.time() * 1000, "hypothesisId": "H4"}, default=str) + "\n")
            except Exception:
                pass
        # #endregion
        try:
            set_action(accel, brake, left, right, key_map=self._key_bindings)
        except Exception:
            pass
        # Phase 6: gameplay — relative mouse for camera (look_left/right/up/down)
        if self._mouse_mode == "gameplay" and action_idx >= NUM_ACTIONS_BASE:
            step = self._mouse_sensitivity if self._mouse_sensitivity is not None else MOUSE_SENSITIVITY
            if action_idx == 8:
                move_mouse_relative(-step, 0)
            elif action_idx == 9:
                move_mouse_relative(step, 0)
            elif action_idx == 10:
                move_mouse_relative(0, -step)
            elif action_idx == 11:
                move_mouse_relative(0, step)

    def _is_accel_pressed(self, action: int) -> bool:
        """True if current action includes accelerate."""
        accel, _, _, _ = ACTION_MEANINGS[action % NUM_ACTIONS]
        return accel

    def _is_glitch_detected(self, frame: np.ndarray, action: int) -> tuple[bool, str]:
        """Returns (is_glitch, bug_type).

        FPS guard: if the tester's own PC is already below PERF_MIN_FPS, skip
        motion/freeze/stuck checks — those events are caused by hardware lag, not
        a real game bug.  Solid-color anomalies (e.g. black screen, white flash)
        are still checked because they are visible regardless of FPS.
        """
        # --- FPS guard: suppress motion-based false positives when PC is struggling ---
        pc_is_struggling = (
            self._current_fps is not None and self._current_fps < PERF_MIN_FPS
        )

        # Step 3: Screen anomaly requires 30 consecutive frames to prevent transient false positives
        if is_solid_color_anomaly(frame, threshold=SOLID_COLOR_THRESHOLD):
            self.screen_anomaly_counter += 1
            if self.screen_anomaly_counter >= SCREEN_ANOMALY_CONFIRMATION_FRAMES:
                self.screen_anomaly_counter = 0
                return True, "Screen Anomaly (solid/freeze)"  # confirmed — terminate
        else:
            self.screen_anomaly_counter = 0
            self._clear_bug("Screen Anomaly (solid/freeze)")
        # Identical frames (freeze): same image hash repeated
        fhash = frame_hash(frame)
        if not pc_is_struggling:  # skip freeze check when PC is lagging
            if self._last_frame_hash == fhash:
                self._identical_frame_count += 1
                if self._identical_frame_count >= IDENTICAL_FRAME_THRESHOLD:
                    return True, "Freeze (identical frames)"
            else:
                self._identical_frame_count = 0
        else:
            # Reset counter so lag gaps don't carry over into the next good window
            self._identical_frame_count = 0
        self._last_frame_hash = fhash
        # Steps 1 & 5: Motion-based stuck with adaptive threshold + 3 guard gates
        if not pc_is_struggling and self._prev_frame is not None:
            motion = compute_frame_difference(self._prev_frame, frame)
            dynamic_threshold = get_dynamic_stuck_threshold()  # Step 5: adaptive
            if motion < dynamic_threshold:
                self._stuck_frames += 1
                if self._stuck_frames >= STUCK_FRAMES_THRESHOLD:
                    # Gate 1: Only fire if agent is actively pressing accelerate
                    is_accelerating = (action % NUM_ACTIONS) in [1, 5, 6, 7]
                    if not is_accelerating:
                        self._stuck_frames = 0  # Idling — not a stuck bug
                    elif ENABLE_SPEED_OCR_STUCK and self._game_profile == "racing":
                        # Gate 2: OCR speed cross-check — if speed > threshold, visual artefact
                        speed = get_speed_from_screen(self._monitor, SPEEDOMETER_RATIOS)
                        if speed is not None and speed > MIN_SPEED_OCR:
                            self._stuck_frames = 0  # OCR says moving, skip
                        elif self._unique_pixel_ratio(frame) < 0.05:
                            self._stuck_frames = 0  # Gate 3: loading/menu screen
                        else:
                            return True, "Stuck (no motion)"
                    else:
                        # Gate 3: too few unique colors = menu or loading screen
                        if self._unique_pixel_ratio(frame) < 0.05:
                            self._stuck_frames = 0
                        else:
                            return True, "Stuck (no motion)"
            else:
                self._stuck_frames = 0
                self._clear_bug("Stuck (no motion)")  # motion resumed — clear pending
        elif pc_is_struggling:
            self._stuck_frames = 0  # reset so lag doesn't accumulate toward the threshold
        # OCR: speed 0 for N frames while accel = stuck (racing only; requires speedometer crop)
        if not pc_is_struggling and self._game_profile == "racing" and ENABLE_SPEED_OCR_STUCK and self._is_accel_pressed(action):
            speed = get_speed_from_screen(self._monitor, SPEEDOMETER_RATIOS)
            if speed is not None:
                if speed < MIN_SPEED_OCR:
                    self._speed_zero_accel_frames += 1
                    if self._speed_zero_accel_frames >= STUCK_SPEED_ZERO_FRAMES:
                        return True, "Stuck (speed 0 with accel)"
                else:
                    self._speed_zero_accel_frames = 0
        else:
            self._speed_zero_accel_frames = 0
        return False, ""

    def _write_step_log(
        self, step: int, reward: float, action: int, gx: int, gy: int, bug_type: str = ""
    ) -> None:
        """Append one row to reports/step_log.csv for offline analysis."""
        path = REPORTS_DIR / "step_log.csv"
        try:
            write_header = not path.exists()
            with open(path, "a", encoding="utf-8") as f:
                if write_header:
                    f.write("step,reward,action,grid_x,grid_y,bug_type\n")
                f.write(f"{step},{reward:.4f},{action},{gx},{gy},{bug_type}\n")
        except Exception:
            pass

    def _get_severity(self, bug_type: str) -> str:
        """Map bug type to severity: critical, major, minor."""
        if "Crash" in bug_type or "process exited" in bug_type:
            return "critical"
        if any(x in bug_type for x in (
            "Stuck (speed 0 with accel)", "Terrain Collision", "Logic Loop", "Performance degradation"
        )):
            return "major"
        return "minor"

    def _save_trace(self, bug_type: str, severity: str) -> Optional[str]:
        """Flush action ring buffer to logs/traces/; return filename or None."""
        if not self._action_trace:
            return None
        safe_type = "".join(c if c.isalnum() or c in " _-" else "_" for c in bug_type)[:50]
        filename = f"{self._session_id}_{safe_type}_{int(time.time() * 1000)}.json"
        path = TRACES_DIR / filename
        try:
            data = {
                "session_id": self._session_id,
                "bug_type": bug_type,
                "severity": severity,
                "timestamp": time.time(),
                "actions": list(self._action_trace),
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return filename
        except Exception:
            return None

    def _report_bug(self, bug_type: str, screenshot_b64: str = "") -> None:
        """
        Send a bug report to the backend.

        Enhancements:
        - Attach explicit GAME_KEY so bugs/sessions are grouped under the correct game.
        - Capture the screenshot from the game window rect when available (rather than
          the full primary monitor) to reduce accidental captures of other monitors.
        - If a different window is in the foreground when the bug fires, append a
          marker to the bug type so the dashboard makes this obvious.
        """
        severity = self._get_severity(bug_type)
        trace_filename = self._save_trace(bug_type, severity)
        if not REQUESTS_AVAILABLE:
            return
        try:
            # Prefer the explicit game window rect when available; fall back to the
            # monitor passed into the env (or primary monitor) otherwise.
            window_rect = get_game_window_rect(self._window_title or None)
            monitor = window_rect or self._monitor

            # Flag cases where some other window was on top when we captured.
            non_game_foreground = False
            if (self._window_title or "").strip():
                non_game_foreground = not is_game_window_foreground(self._window_title)
            effective_bug_type = (
                f"{bug_type} (Non‑game window active)"
                if non_game_foreground
                else bug_type
            )

            payload = {
                "type": effective_bug_type,
                "severity": severity,
                "timestamp": time.time(),
                "screenshot": screenshot_b64 or get_base64_screenshot(monitor),
                "trace_filename": trace_filename or None,
                "game_key": GAME_KEY,
                # Fix 1: attach FPS so dashboard can flag hardware-caused reports
                "fps_at_bug": round(self._current_fps, 1) if self._current_fps is not None else None,
                "pc_was_struggling": (
                    self._current_fps is not None and self._current_fps < PERF_MIN_FPS
                ),
            }
            requests.post(self._report_url, json=payload, timeout=5)
        except Exception:
            pass

    # ── Step 2: Confirmation buffer helpers ─────────────────────────────────

    def _propose_bug(self, bug_type: str, severity: str) -> None:
        """Buffer a bug candidate. Only call _report_bug after BUG_CONFIRMATION_FRAMES
        consecutive detections. This stops transient events from spamming the backend
        while episode termination is still handled separately in step()."""
        self.bug_pending[bug_type] = self.bug_pending.get(bug_type, 0) + 1
        if self.bug_pending[bug_type] >= self.BUG_CONFIRMATION_FRAMES:
            self._report_bug(bug_type)
            del self.bug_pending[bug_type]

    def _clear_bug(self, bug_type: str) -> None:
        """Reset pending counter when the bug condition clears (e.g. motion resumes)."""
        self.bug_pending.pop(bug_type, None)

    def _unique_pixel_ratio(self, frame: np.ndarray) -> float:
        """Step 1 Gate 3: ratio of unique pixel values to total pixels.
        Values < 0.05 indicate a menu or loading screen (very low color variety)."""
        if frame.size == 0:
            return 1.0
        flat = frame.reshape(-1, frame.shape[-1] if len(frame.shape) == 3 else 1)
        unique = len(np.unique(flat, axis=0))
        total = frame.shape[0] * frame.shape[1]
        return unique / total if total > 0 else 1.0

    # ─────────────────────────────────────────────────────────────────────────

    def _update_position_and_log(self, action: int, exploration_scale: float = 1.0) -> float:
        """Update pseudo-position from action, log to backend, return exploration bonus (scaled; 0 for minimal)."""
        dx, dy = ACTION_DELTA[action % NUM_ACTIONS]
        self._pos_x = max(0.0, min(self._grid_size - 1.0, self._pos_x + dx))
        self._pos_y = max(0.0, min(self._grid_size - 1.0, self._pos_y + dy))
        gx, gy = int(self._pos_x), int(self._pos_y)
        self._position_buffer.append([gx, gy])
        key = (gx, gy)
        self._visit_counts[key] = self._visit_counts.get(key, 0) + 1
        visit_count = self._visit_counts[key]
        exploration_bonus = (self._exploration_scale / (1.0 + visit_count)) * exploration_scale
        if len(self._position_buffer) >= COVERAGE_LOG_BATCH and REQUESTS_AVAILABLE:
            try:
                requests.post(
                    self._coverage_url,
                    json={"points": self._position_buffer},
                    timeout=2,
                )
            except Exception:
                pass
            self._position_buffer.clear()
        return exploration_bonus

    def _update_spatial_memory(self, action: int) -> tuple[Optional[float], Optional[int], Optional[int], Optional[str]]:
        """
        Try GPS from minimap; update 100x100 grid, exploration bonus, loop/stuck detection.
        Returns (exploration_bonus, grid_x, grid_y, bug_type).
        If bug_type is set, caller should terminate and report. If coords unavailable, returns (None, None, None, None).
        """
        minimap = self._get_minimap_frame()
        if minimap.size == 0:
            self._last_gps_coords = None
            self._stuck_wall_steps = 0
            return None, None, None, None
        coords = get_car_coordinates(
            minimap,
            self._marker_template_path,
            match_threshold=CAR_ARROW_MATCH_THRESHOLD,
            prev_position=self._last_gps_coords,
        )
        if coords is None:
            self._last_gps_coords = None
            self._stuck_wall_steps = 0
            return None, None, None, None
        # Map minimap pixels (0..minimap_size-1) to grid (0..SPATIAL_GRID_SIZE-1)
        grid_x = int((coords[0] / max(1, self._minimap_size)) * (SPATIAL_GRID_SIZE - 1))
        grid_y = int((coords[1] / max(1, self._minimap_size)) * (SPATIAL_GRID_SIZE - 1))
        grid_x = max(0, min(SPATIAL_GRID_SIZE - 1, grid_x))
        grid_y = max(0, min(SPATIAL_GRID_SIZE - 1, grid_y))
        visits = self._map_memory[grid_x, grid_y]
        exploration_bonus = EXPLORATION_BONUS_MULTIPLIER * (1.0 / (np.sqrt(visits + 1)))
        self._map_memory[grid_x, grid_y] += 1
        self._recent_tiles.append((grid_x, grid_y))
        bug_type = None
        # Infinite loop: same few tiles for LOOP_WINDOW_STEPS
        if len(self._recent_tiles) >= LOOP_WINDOW_STEPS:
            unique_tiles = len(set(self._recent_tiles))
            if unique_tiles <= LOOP_SAME_TILES_MAX:
                bug_type = "Logic Loop Bug"
        # Stuck in wall: accel but coords barely moved for STUCK_WALL_STEPS
        if bug_type is None and self._is_accel_pressed(action) and self._last_gps_coords is not None:
            dx = coords[0] - self._last_gps_coords[0]
            dy = coords[1] - self._last_gps_coords[1]
            dist = np.sqrt(dx * dx + dy * dy)
            if dist <= STUCK_WALL_PIXEL_THRESHOLD:
                self._stuck_wall_steps += 1
                if self._stuck_wall_steps >= STUCK_WALL_STEPS:
                    bug_type = "Terrain Collision Bug"
            else:
                self._stuck_wall_steps = 0
        else:
            if not self._is_accel_pressed(action):
                self._stuck_wall_steps = 0
        self._last_gps_coords = coords
        return exploration_bonus, grid_x, grid_y, bug_type

    def step(self, action: int) -> tuple[Any, float, bool, bool, dict]:
        # #region agent log (first step only per episode to confirm training loop)
        if self._step_count == 0:
            _dl = getattr(self, "_debug_log_path", str(PROJECT_ROOT / ".cursor" / "debug.log"))
            try:
                import json as _json
                with open(_dl, "a", encoding="utf-8") as _f:
                    _f.write(_json.dumps({"location": "nfs_env.py:step", "message": "step entry", "data": {"step_count": self._step_count, "action": action}, "timestamp": time.time() * 1000, "hypothesisId": "H2"}) + "\n")
            except Exception:
                pass
        # #endregion
        # Re-focus game window every step so input reaches the game (fix: focus was only at reset)
        if self._window_title:
            focus_game_window(self._window_title)
        self._apply_action(action)
        # Ring buffer: record action for trace on bug
        self._action_trace.append({
            "step": self._step_count + 1,
            "action": action,
            "keys": ACTION_KEYS_STR[action % NUM_ACTIONS],
            "ts": time.time(),
        })
        total_reward = 0.0
        for _ in range(self.frame_skip):
            t_frame_start = time.perf_counter()
            time.sleep(0.02)
            frame = self._get_obs()
            # Performance monitoring: racing and open_world only; minimal skips
            if ENABLE_PERF_MONITORING and self._game_profile != "minimal":
                self._frame_times.append(time.perf_counter() - t_frame_start)
                self._last_frame_time = time.perf_counter()
            # Motion-based reward proxy (no OCR required)
            if self._prev_frame is not None:
                motion = compute_frame_difference(self._prev_frame, frame)
                total_reward += motion * 0.1  # Small reward for movement
            self._prev_frame = frame.copy()

            is_glitch, bug_type = self._is_glitch_detected(frame, action)
            if is_glitch:
                total_reward += 5.0  # Step 4: reward finding the bug; episode still ends
                self._propose_bug(bug_type, self._get_severity(bug_type))  # Step 2
                release_all(key_map=self._key_bindings)
                return frame, total_reward, True, False, {"bug": bug_type}

        # Performance degradation: sustained low FPS (racing and open_world only)
        if ENABLE_PERF_MONITORING and self._game_profile != "minimal" and len(self._frame_times) >= PERF_FRAME_TIME_WINDOW // 2:
            total_time = sum(self._frame_times)
            if total_time > 0:
                self._current_fps = len(self._frame_times) / total_time
                if self._current_fps < PERF_MIN_FPS:
                    self._low_fps_count += 1
                    if self._low_fps_count >= PERF_LOW_FPS_STEPS:
                        perf_bug = f"Performance degradation (FPS: {self._current_fps:.1f})"
                        total_reward += 5.0  # Step 4
                        self._propose_bug(perf_bug, "major")  # Step 2
                        release_all(key_map=self._key_bindings)
                        obs = self._get_obs()
                        return obs, total_reward, True, False, {"bug": perf_bug}
                else:
                    self._low_fps_count = 0

        # Crash detection: game process exited (definitive — keep direct _report_bug, no buffer)
        if not is_process_running(self._process_names):
            self._report_bug("Crash Bug (process exited)")
            release_all(key_map=self._key_bindings)
            obs = self._get_obs()
            return obs, total_reward + 5.0, True, False, {"bug": "Crash Bug"}  # Step 4

        self._step_count += 1
        info: dict = {}
        # Spatial memory: racing = GPS/minimap + loop/stuck-wall; open_world/minimal = pseudo only
        exploration_bonus = None
        grid_x = grid_y = None
        spatial_bug = None
        if self._game_profile == "racing":
            exploration_bonus, grid_x, grid_y, spatial_bug = self._update_spatial_memory(action)
            if spatial_bug is not None:
                total_reward += 5.0  # Step 4
                self._propose_bug(spatial_bug, self._get_severity(spatial_bug))  # Step 2
                release_all(key_map=self._key_bindings)
                obs = self._get_obs()
                return obs, total_reward, True, False, {"bug": spatial_bug}
        if exploration_bonus is not None and grid_x is not None and grid_y is not None:
            total_reward += exploration_bonus
            info["coords"] = (grid_x, grid_y)
            current_cell = (grid_x, grid_y)
        else:
            # open_world: full exploration bonus; minimal: motion only (no exploration reward)
            exploration_scale = 0.0 if self._game_profile == "minimal" else 1.0
            total_reward += self._update_position_and_log(action, exploration_scale=exploration_scale)
            current_cell = (int(self._pos_x), int(self._pos_y))
        # Path trail and distance (analytics)
        self._path_trail.append(current_cell)
        if self._last_path_point is not None:
            dx = current_cell[0] - self._last_path_point[0]
            dy = current_cell[1] - self._last_path_point[1]
            self._distance_approx += np.sqrt(dx * dx + dy * dy)
        self._last_path_point = current_cell
        self._action_counts[action] = self._action_counts.get(action, 0) + 1
        
        # --- Genre-Based Reward Logic ---
        total_reward += self._compute_genre_reward(action, motion=total_reward/self.frame_skip if self.frame_skip > 0 else 0)
        
        # Time penalty to encourage progress
        total_reward -= 0.01
        # Save heatmap to reports/ every N steps
        if self._step_count % HEATMAP_SAVE_EVERY_STEPS == 0:
            save_heatmap(self._map_memory)

        # Push full spatial grid (100x100) less frequently, to keep load low.
        if self._step_count % COVERAGE_PUSH_EVERY_STEPS == 0 and REQUESTS_AVAILABLE:
            try:
                requests.post(
                    self._coverage_grid_url,
                    json={"grid": self._map_memory.tolist()},
                    timeout=3,
                )
            except Exception:
                pass

        # Push lightweight analytics (path, action_counts, summary stats) much
        # more often so the dashboard shows live data quickly, even on short runs.
        if self._step_count % ANALYTICS_PUSH_EVERY_STEPS == 0 and REQUESTS_AVAILABLE:
            try:
                unique_cells = int((self._map_memory > 0).sum())
                requests.post(
                    self._analytics_url,
                    json={
                        "path": [{"x": p[0], "y": p[1]} for p in self._path_trail],
                        "action_counts": {str(k): v for k, v in self._action_counts.items()},
                        "unique_cells": unique_cells,
                        "distance_approx": round(self._distance_approx, 2),
                        "step_count": self._step_count,
                        "episode_count": self._episode_count,
                        "current_fps": round(self._current_fps, 1) if self._current_fps is not None else None,
                        # Per-game marker so backend/dashboard know which game these analytics describe
                        "game_key": GAME_KEY,
                    },
                    timeout=3,
                )
                # Live view: push screenshot along with analytics
                try:
                    b64 = get_base64_screenshot(self._monitor)
                    if b64:
                        requests.post(
                            self._backend_url + "/analytics/live-screenshot",
                            json={"base64": b64},
                            timeout=2,
                        )
                except Exception:
                    pass
            except Exception:
                pass
        # Step log to CSV (every N steps)
        if self._step_count % STEP_LOG_EVERY == 0:
            self._write_step_log(self._step_count, total_reward, action, current_cell[0], current_cell[1], "")
        terminated = self._step_count >= self.max_episode_steps
        truncated = False
        self._last_reward = total_reward
        obs = self._get_obs()
        if self._prev_frame is None:
            self._prev_frame = obs.copy()
        return obs, total_reward, terminated, truncated, info

    def _compute_genre_reward(self, action: int, motion: float = 0.0) -> float:
        """Calculate reward components based on genre profile."""
        from config import (
            RACING_SPEED_WEIGHT, SHARP_STEER_PENALTY, HIGH_SPEED_THRESHOLD,
            OPENWORLD_EXPLORATION_WEIGHT, ACTION_MOTION_WEIGHT
        )
        
        reward = 0.0
        
        if self._game_profile == "racing":
            # Speed priority
            speed = get_speed_from_screen(self._monitor, SPEEDOMETER_RATIOS)
            if speed is not None:
                reward += speed * RACING_SPEED_WEIGHT
                if action in (3, 4, 5, 6) and speed > HIGH_SPEED_THRESHOLD:
                    reward -= SHARP_STEER_PENALTY
        
        elif self._game_profile == "open_world":
            # Exploration priority (already handled in _update_position_and_log, but we add a stagnation penalty)
            if motion < 1.0:
                reward -= 0.05  # Stagnation penalty
            reward *= OPENWORLD_EXPLORATION_WEIGHT
            
        elif self._game_profile == "action":
            # Action/Intensity priority (motion as proxy)
            reward += motion * ACTION_MOTION_WEIGHT
            
        return reward

    def _run_menu_phase(self) -> None:
        """Run scripted mouse clicks for menu (e.g. Start / Continue). Used when mouse_mode == menus_only.
        Converts normalized (0-1) positions from _menu_click_positions to screen coords using game window rect."""
        rect = get_game_window_rect(self._window_title or None)
        if not rect:
            return
        left = rect["left"]
        top = rect["top"]
        width = rect["width"]
        height = rect["height"]
        # Default: single click at center of window if no positions configured
        positions_to_click: list[tuple[float, float]] = []
        if self._menu_click_positions and isinstance(self._menu_click_positions, dict):
            for _name, coords in self._menu_click_positions.items():
                if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                    nx, ny = float(coords[0]), float(coords[1])
                    nx = max(0.0, min(1.0, nx))
                    ny = max(0.0, min(1.0, ny))
                    x = int(left + width * nx)
                    y = int(top + height * ny)
                    positions_to_click.append((x, y))
        if not positions_to_click:
            positions_to_click = [(left + width // 2, top + height // 2)]
        for x, y in positions_to_click:
            click_mouse(x, y, button="left", duration=0.08)
            time.sleep(0.35)

    def reset(
        self, *, seed: Optional[int] = None, options: Optional[dict] = None
    ) -> tuple[Any, dict]:
        super().reset(seed=seed, options=options)
        release_all(key_map=self._key_bindings)
        # Ensure game window has OS focus so pydirectinput key presses are received
        # #region agent log
        _debug_log = getattr(self, "_debug_log_path", str(PROJECT_ROOT / ".cursor" / "debug.log"))
        _focused = False
        try:
            Path(_debug_log).parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        # #endregion
        if self._window_title:
            _focused = focus_game_window(self._window_title)
        # #region agent log
        try:
            import json as _json
            with open(_debug_log, "a", encoding="utf-8") as _f:
                _f.write(_json.dumps({"location": "nfs_env.py:reset", "message": "focus at reset", "data": {"window_title": self._window_title or "(empty)", "focus_called": bool(self._window_title), "focused": _focused}, "timestamp": time.time() * 1000, "hypothesisId": "H1"}) + "\n")
        except Exception:
            pass
        # #endregion
        self._step_count = 0
        self._prev_frame = None
        self._stuck_frames = 0
        self._identical_frame_count = 0
        self._last_frame_hash = None
        self._speed_zero_accel_frames = 0
        self._pos_x = float(self._grid_size // 2)
        self._pos_y = float(self._grid_size // 2)
        self._position_buffer.clear()
        self._visit_counts.clear()
        self._recent_tiles.clear()
        self._last_gps_coords = None
        self._stuck_wall_steps = 0
        self._path_trail.clear()
        self._last_path_point = None
        self._distance_approx = 0.0
        self._episode_count += 1
        self._frame_times.clear()
        self._last_frame_time = None
        self._low_fps_count = 0
        self._current_fps = None
        # _map_memory and _action_counts kept cumulative for session
        obs = self._get_obs()
        self._prev_frame = obs.copy()
        # Phase 5: menus_only — scripted clicks at start of episode (e.g. Start / Continue)
        if self._mouse_mode == "menus_only":
            self._run_menu_phase()
            time.sleep(0.2)
            obs = self._get_obs()
            self._prev_frame = obs.copy()
        return obs, {}

    def close(self) -> None:
        release_all(key_map=self._key_bindings)
