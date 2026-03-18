"""PyDirectInput key mapping for NFS Rivals (DirectX-compatible). Supports per-game key_map."""
import time
from pathlib import Path
from typing import Optional, Dict, Any

_DEBUG_LOG_PATH = (Path(__file__).resolve().parent.parent / ".cursor" / "debug.log")

try:
    import pydirectinput as pdi
    PDI_AVAILABLE = True
except ImportError:
    PDI_AVAILABLE = False
    pdi = None

try:
    import pygetwindow as gw
    PYGW_AVAILABLE = True
except ImportError:
    PYGW_AVAILABLE = False
    gw = None

# Action space: [accel, brake, steer_left, steer_right]
# Default: arrow keys (use key_map for WASD or other games)
KEY_ACCEL = "up"
KEY_BRAKE = "down"
KEY_LEFT = "left"
KEY_RIGHT = "right"
KEY_NITRO = "space"  # Optional
KEY_RESET = "r"  # Restart / respawn if supported

# Default key map (arrows). Per-game override via key_map in set_action/release_all.
DEFAULT_KEY_MAP: Dict[str, str] = {
    "accel": KEY_ACCEL,
    "brake": KEY_BRAKE,
    "left": KEY_LEFT,
    "right": KEY_RIGHT,
    "nitro": KEY_NITRO,
    "reset": KEY_RESET,
}


def _resolve_key_map(key_map: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Return key map to use; merge with DEFAULT_KEY_MAP so missing keys fall back to default."""
    if not key_map or not isinstance(key_map, dict):
        return DEFAULT_KEY_MAP
    out = dict(DEFAULT_KEY_MAP)
    for k, v in key_map.items():
        if k in out and v is not None and str(v).strip():
            out[k] = str(v).strip()
    return out


def focus_game_window(window_title: Optional[str]) -> bool:
    """
    Bring the game window to the foreground so pydirectinput key presses are received.
    Returns True if the window was found and focused, False otherwise.
    Will attempt to force focus if ordinary activation fails.
    """
    # #region agent log
    _debug_log = str(_DEBUG_LOG_PATH)
    _found = False
    _activated = False
    # #endregion
    if not window_title or not PYGW_AVAILABLE:
        try:
            with open(_debug_log, "a", encoding="utf-8") as _f:
                import json as _json
                _f.write(_json.dumps({"location": "controller.py:focus_game_window", "message": "skip focus", "data": {"window_title": window_title or "(empty)", "pygw_available": PYGW_AVAILABLE}, "timestamp": __import__("time").time() * 1000, "hypothesisId": "H1"}) + "\n")
        except Exception:
            pass
        return False
    try:
        windows = gw.getWindowsWithTitle(window_title)
        if not windows:
            # Try partial match: literal substring, then normalized (no spaces) so "SuperTuxKart" matches "Super TuxKart"
            all_titles = gw.getAllTitles()
            q = window_title.lower()
            q_nospace = q.replace(" ", "")
            for t in all_titles:
                if not t or not q:
                    continue
                t_lower = t.lower()
                if (q in t_lower or q_nospace in t_lower.replace(" ", "")) and gw.getWindowsWithTitle(t):
                    windows = [gw.getWindowsWithTitle(t)[0]]
                    break
        _found = bool(windows)
        if windows:
            win = windows[0]
            import ctypes
            
            if win.isMinimized:
                win.restore()
                # Windows SW_RESTORE = 9
                if hasattr(win, '_hWnd'):
                    ctypes.windll.user32.ShowWindow(win._hWnd, 9)
                time.sleep(0.5)
            
            try:
                win.activate()
            except Exception as e:
                msg = str(e).lower()
                # Windows often returns 0 "operation completed successfully" but pygetwindow still raises
                if "0" in msg and "operation completed successfully" in msg:
                    pass  # Treat as success; focus likely worked
                else:
                    print(f"Standard activate failed: {e}. Attempting forced focus.")
                    # Press and release ALT to allow foreground change
                    ctypes.windll.user32.keybd_event(0x12, 0, 0, 0)  # ALT down
                    ctypes.windll.user32.keybd_event(0x12, 0, 2, 0)  # ALT up
                    # Force window to foreground
                    if hasattr(win, '_hWnd'):
                        ctypes.windll.user32.SetForegroundWindow(win._hWnd)

            time.sleep(0.2)  # Let the OS switch focus
            _activated = True
            # #region agent log
            try:
                with open(_debug_log, "a", encoding="utf-8") as _f:
                    import json as _json
                    _f.write(_json.dumps({"location": "controller.py:focus_game_window", "message": "focus ok", "data": {"window_title": window_title, "found": _found, "activated": True}, "timestamp": time.time() * 1000, "hypothesisId": "H5"}) + "\n")
            except Exception:
                pass
            # #endregion
            return True
    except Exception as e:
        print(f"Error focusing window: {e}")
        # #region agent log
        try:
            with open(_debug_log, "a", encoding="utf-8") as _f:
                import json as _json
                _f.write(_json.dumps({"location": "controller.py:focus_game_window", "message": "focus error", "data": {"window_title": window_title, "found": _found, "error": str(e)}, "timestamp": time.time() * 1000, "hypothesisId": "H5"}) + "\n")
        except Exception:
            pass
        # #endregion
    if not _activated:
        try:
            with open(_debug_log, "a", encoding="utf-8") as _f:
                import json as _json
                _f.write(_json.dumps({"location": "controller.py:focus_game_window", "message": "no window", "data": {"window_title": window_title, "found": _found}, "timestamp": time.time() * 1000, "hypothesisId": "H1"}) + "\n")
        except Exception:
            pass
    return False


def ensure_pdi() -> None:
    """Fail fast if PyDirectInput is not available."""
    if not PDI_AVAILABLE:
        raise ImportError(
            "pydirectinput is required for NFS Rivals. Install with: pip install pydirectinput"
        )


def press_key(key: str, duration: float = 0.05) -> None:
    """Press and release a key. Duration in seconds."""
    if not PDI_AVAILABLE:
        return
    pdi.keyDown(key)
    time.sleep(duration)
    pdi.keyUp(key)


def set_action(
    accel: bool,
    brake: bool,
    left: bool,
    right: bool,
    key_map: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Apply continuous action state. Call every frame/tick.
    Keys are held down until next set_action or release_all.
    key_map: optional dict e.g. {"accel":"w","brake":"s","left":"a","right":"d"}; None = use default (arrows).
    """
    # #region agent log (only first few calls to avoid flood)
    if not hasattr(set_action, "_log_count"):
        set_action._log_count = 0
    set_action._log_count += 1
    if set_action._log_count <= 3:
        _debug_log = str(_DEBUG_LOG_PATH)
        try:
            import json as _json
            km = _resolve_key_map(key_map)
            with open(_debug_log, "a", encoding="utf-8") as _f:
                _f.write(_json.dumps({"location": "controller.py:set_action", "message": "keys applied", "data": {"pdi_available": PDI_AVAILABLE, "km": km, "accel": accel, "brake": brake, "left": left, "right": right}, "timestamp": time.time() * 1000, "hypothesisId": "H3"}) + "\n")
        except Exception:
            pass
    # #endregion
    if not PDI_AVAILABLE:
        return
    km = _resolve_key_map(key_map)
    if accel:
        pdi.keyDown(km["accel"])
    else:
        pdi.keyUp(km["accel"])
    if brake:
        pdi.keyDown(km["brake"])
    else:
        pdi.keyUp(km["brake"])
    if left:
        pdi.keyDown(km["left"])
    else:
        pdi.keyUp(km["left"])
    if right:
        pdi.keyDown(km["right"])
    else:
        pdi.keyUp(km["right"])


def release_all(key_map: Optional[Dict[str, Any]] = None) -> None:
    """Release all driving keys. key_map must match the one used in set_action (or None for default)."""
    if not PDI_AVAILABLE:
        return
    km = _resolve_key_map(key_map)
    for key in (km["accel"], km["brake"], km["left"], km["right"], km["nitro"]):
        try:
            pdi.keyUp(key)
        except Exception:
            pass


# --- Mouse (DirectX-compatible) ---

def move_mouse(x: int, y: int) -> None:
    """Move cursor to absolute screen position (x, y)."""
    if not PDI_AVAILABLE:
        return
    pdi.moveTo(x, y)


def move_mouse_relative(dx: int, dy: int) -> None:
    """Move cursor by delta (dx, dy) in pixels. Use 0 for no movement on an axis."""
    if not PDI_AVAILABLE:
        return
    if dx != 0 or dy != 0:
        pdi.move(dx, dy)


def click_mouse(
    x: Optional[int] = None,
    y: Optional[int] = None,
    button: str = "left",
    duration: float = 0.05,
) -> None:
    """Click at (x, y) or at current position. button: 'left'|'right'. Small delay helps games register."""
    if not PDI_AVAILABLE:
        return
    if x is not None and y is not None:
        pdi.moveTo(x, y)
        time.sleep(0.02)
    if button == "right":
        if x is not None and y is not None:
            pdi.rightClick(x, y)
        else:
            pdi.rightClick()
    else:
        if x is not None and y is not None:
            pdi.click(x, y)
        else:
            pdi.click()
    time.sleep(duration)
