"""Screen capture and image processing for NFS Rivals (MSS + OpenCV)."""
import base64
import hashlib
import io
import sys
from collections import deque
from pathlib import Path
from typing import Optional, Tuple, Union

import cv2
import numpy as np

# Step 5: rolling history for adaptive stuck threshold (module-level, shared across all env instances)
_frame_diff_history: deque = deque(maxlen=60)

try:
    import mss
    import mss.tools
    MSS_AVAILABLE = True
except ImportError:
    MSS_AVAILABLE = False
    mss = None

try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    pytesseract = None


def _resolve_title_substring(title_substring: Optional[str]) -> Optional[str]:
    """Helper: pick an appropriate window title substring from explicit arg or config."""
    if title_substring is not None and isinstance(title_substring, str) and title_substring.strip():
        return title_substring
    try:
        from config import GAME_WINDOW_TITLE
        ts = GAME_WINDOW_TITLE
    except Exception:
        return None
    return ts if isinstance(ts, str) and ts.strip() else None


def get_game_window_rect(title_substring: Optional[str] = None) -> Optional[dict]:
    """
    Find the game window by partial title match and return its rect as an mss-style monitor dict.
    Returns {"left", "top", "width", "height"} or None if not found / not Windows.
    When used as monitor in capture_minimap_region, MINIMAP_LEFT/MINIMAP_BOTTOM_OFFSET are relative to the window.
    """
    if sys.platform != "win32":
        return None
    title_substring = _resolve_title_substring(title_substring)
    if not title_substring:
        return None
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        RECT = wintypes.RECT

        found_rect = [None]  # mutable so callback can store result

        def enum_callback(hwnd: int, _lparam: int) -> int:
            if not user32.IsWindowVisible(hwnd):
                return 1
            length = user32.GetWindowTextLengthW(hwnd) + 1
            buf = ctypes.create_unicode_buffer(length)
            user32.GetWindowTextW(hwnd, buf, length)
            title = buf.value or ""
            if title_substring.lower() in title.lower():
                r = RECT()
                if user32.GetWindowRect(hwnd, ctypes.byref(r)):
                    found_rect[0] = (r.left, r.top, r.right - r.left, r.bottom - r.top)
                return 0  # stop enumeration
            return 1  # continue

        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows(WNDENUMPROC(enum_callback), 0)
        rect = found_rect[0]
        if rect is None:
            return None
        left, top, width, height = rect
        return {"left": left, "top": top, "width": width, "height": height}
    except Exception:
        return None


def is_game_window_foreground(title_substring: Optional[str] = None) -> bool:
    """
    Return True if the foreground window's title contains title_substring
    (or GAME_WINDOW_TITLE from config when title_substring is None).

    This is a best‑effort guard to detect when some other window (e.g. browser,
    desktop) is active while the agent is running. On non‑Windows platforms or
    on any error it returns True so we avoid over‑flagging.
    """
    if sys.platform != "win32":
        return True
    title_substring = _resolve_title_substring(title_substring)
    if not title_substring:
        return True
    try:
        import ctypes

        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return True
        length = user32.GetWindowTextLengthW(hwnd) + 1
        buf = ctypes.create_unicode_buffer(length)
        user32.GetWindowTextW(hwnd, buf, length)
        title = buf.value or ""
        return title_substring.lower() in title.lower()
    except Exception:
        return True


def capture_region(
    monitor: Optional[dict] = None,
    width: int = 84,
    height: int = 84,
    grayscale: bool = True,
) -> np.ndarray:
    """
    Capture screen region and return processed frame for RL observation.
    If monitor is None, uses primary monitor (full screen).
    """
    if not MSS_AVAILABLE:
        # Return dummy frame for headless/testing
        shape = (height, width) if grayscale else (height, width, 3)
        return np.zeros(shape, dtype=np.uint8)

    with mss.mss() as sctx:
        mon = monitor or sctx.monitors[0]
        shot = sctx.grab(mon)
        frame = np.array(shot)
        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
    frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
    if grayscale:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return frame


def frame_to_base64(frame: np.ndarray, fmt: str = ".png") -> str:
    """Encode frame as base64 for API payload."""
    _, buf = cv2.imencode(fmt, frame)
    return base64.b64encode(buf.tobytes()).decode("ascii")


def get_base64_screenshot(monitor: Optional[dict] = None) -> str:
    """Full-size screenshot as base64 for bug reports."""
    if not MSS_AVAILABLE:
        return ""
    with mss.mss() as sctx:
        mon = monitor or sctx.monitors[0]
        shot = sctx.grab(mon)
        frame = np.array(shot)
        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
    _, buf = cv2.imencode(".png", frame)
    return base64.b64encode(buf.tobytes()).decode("ascii")


def is_solid_color_anomaly(frame: np.ndarray, threshold: float = 0.98) -> bool:
    """
    Detect if screen is nearly one color (e.g. falling through world, freeze).
    Returns True if fraction of pixels in dominant color >= threshold.
    """
    if frame.size == 0:
        return True
    flat = frame.flatten()
    unique, counts = np.unique(flat, return_counts=True)
    dominant_count = counts.max()
    return (dominant_count / flat.size) >= threshold


def extract_speed_ocr(region: np.ndarray) -> Optional[float]:
    """
    Optional: OCR on a cropped speedometer region. Returns speed number or None.
    Requires pytesseract and a properly cropped region (you may need to tune crop).
    """
    if not TESSERACT_AVAILABLE or region.size == 0:
        return None
    try:
        text = pytesseract.image_to_string(region, config="--psm 7 digits")
        digits = "".join(c for c in text if c.isdigit())
        return float(digits) if digits else None
    except Exception:
        return None


def compute_frame_difference(prev: np.ndarray, curr: np.ndarray) -> float:
    """Mean absolute difference between two frames (motion indicator).
    Also appends the diff to the module-level history for adaptive threshold computation.
    """
    if prev.shape != curr.shape:
        return 1.0
    diff = float(np.abs(prev.astype(float) - curr.astype(float)).mean())
    _frame_diff_history.append(diff)  # Step 5: feed rolling history
    return diff


def get_dynamic_stuck_threshold() -> float:
    """Step 5: Return an adaptive stuck threshold based on recent frame diffs.
    Uses mean - 2*std of the rolling 60-frame history; falls back to 2.0.
    """
    if len(_frame_diff_history) >= 10:
        arr = np.array(_frame_diff_history)
        return float(max(1.0, arr.mean() - 2.0 * arr.std()))
    return 2.0  # Original static fallback


def frame_hash(frame: np.ndarray) -> str:
    """Stable hash of frame bytes for identical-frame detection (freeze)."""
    return hashlib.md5(frame.tobytes()).hexdigest()


def capture_speedometer_region(
    monitor: Optional[dict] = None,
    ratios: Tuple[float, float, float, float] = (0.35, 0.80, 0.30, 0.15),
) -> np.ndarray:
    """
    Capture a crop of the screen where speedometer usually is (e.g. bottom-center).
    ratios = (x_ratio, y_ratio, w_ratio, h_ratio) in [0,1] of monitor size.
    Returns grayscale region for OCR; empty array if capture fails.
    """
    if not MSS_AVAILABLE:
        return np.array([], dtype=np.uint8)
    try:
        with mss.mss() as sctx:
            mon = monitor or sctx.monitors[0]
            W, H = mon["width"], mon["height"]
            x = int(ratios[0] * W)
            y = int(ratios[1] * H)
            w = max(1, int(ratios[2] * W))
            h = max(1, int(ratios[3] * H))
            region = {"left": mon["left"] + x, "top": mon["top"] + y, "width": w, "height": h}
            shot = sctx.grab(region)
            frame = np.array(shot)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            return frame
    except Exception:
        return np.array([], dtype=np.uint8)


def get_speed_from_screen(
    monitor: Optional[dict] = None,
    ratios: Tuple[float, float, float, float] = (0.35, 0.80, 0.30, 0.15),
) -> Optional[float]:
    """Capture speedometer region and return OCR speed number, or None if unavailable."""
    region = capture_speedometer_region(monitor, ratios)
    return extract_speed_ocr(region) if region.size > 0 else None


def capture_minimap_region(
    monitor: Optional[dict] = None,
    left: int = 20,
    top: Optional[int] = None,
    width: int = 200,
    height: int = 200,
    bottom_offset: Optional[int] = None,
) -> np.ndarray:
    """
    Capture the minimap region from the screen (e.g. bottom-left).
    left, width, height are in pixels. If bottom_offset is set (e.g. 20),
    top is computed as mon['height'] - height - bottom_offset. Otherwise use top.
    Returns BGR image; empty array if MSS unavailable or capture fails.
    """
    if not MSS_AVAILABLE:
        return np.array([], dtype=np.uint8)
    try:
        with mss.mss() as sctx:
            mon = monitor or sctx.monitors[0]
            if bottom_offset is not None:
                top_px = mon["height"] - height - bottom_offset
            else:
                top_px = top if top is not None else 0
            region = {
                "left": mon["left"] + left,
                "top": mon["top"] + top_px,
                "width": width,
                "height": height,
            }
            shot = sctx.grab(region)
            frame = np.array(shot)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            return frame
    except Exception:
        return np.array([], dtype=np.uint8)


def find_minimap_circles(frame: np.ndarray) -> list:
    """Detect circular HUD elements using HoughCircles. Returns list of (x, y, r)."""
    if frame.size == 0:
        return []
    try:
        from config import MINIMAP_CIRCLE_PARAMS
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        dp, minDist, param1, param2, minR, maxR = MINIMAP_CIRCLE_PARAMS
        circles = cv2.HoughCircles(
            gray, cv2.HOUGH_GRADIENT, dp, minDist,
            param1=param1, param2=param2,
            minRadius=minR, maxRadius=maxR
        )
        if circles is not None:
            return circles[0].tolist()
    except Exception:
        pass
    return []


def auto_detect_minimap(monitor: Optional[dict] = None) -> Optional[dict]:
    """
    Scan the full screen/window for likely circular minimaps.
    Returns {'left', 'top', 'width', 'height'} relative to monitor, or None.
    Prefer circles in corners.
    """
    if not MSS_AVAILABLE:
        return None
    try:
        with mss.mss() as sctx:
            mon = monitor or sctx.monitors[0]
            shot = sctx.grab(mon)
            frame = np.array(shot)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            
            circles = find_minimap_circles(frame)
            if not circles:
                return None
            
            # Heuristic: pick the circle in a corner (usually bottom-left or bottom-right)
            W, H = mon["width"], mon["height"]
            best_circle = None
            max_score = -1.0
            
            for cx, cy, r in circles:
                # Score based on how "corner-y" it is
                dist_to_bl = np.sqrt(cx**2 + (H - cy)**2)
                dist_to_br = np.sqrt((W - cx)**2 + (H - cy)**2)
                dist_to_tl = np.sqrt(cx**2 + cy**2)
                dist_to_tr = np.sqrt((W - cx)**2 + cy**2)
                
                min_dist = min(dist_to_bl, dist_to_br, dist_to_tl, dist_to_tr)
                score = 1000.0 / (1.0 + min_dist)
                if score > max_score:
                    max_score = score
                    best_circle = (cx, cy, r)
            
            if best_circle:
                cx, cy, r = best_circle
                # Return slightly padded square rect
                pad = 10
                size = int(2 * r + pad)
                return {
                    "left": int(max(0, cx - r - pad//2)),
                    "top": int(max(0, cy - r - pad//2)),
                    "width": size,
                    "height": size
                }
    except Exception:
        pass
    return None


def _pick_best_match_near_prev(
    res: np.ndarray,
    template_h: int,
    template_w: int,
    best_loc: Tuple[int, int],
    best_val: float,
    prev_position: Tuple[int, int],
    match_threshold: float,
    max_jump_px: int = 35,
) -> Tuple[Tuple[int, int], float]:
    """
    If the global best is far from prev_position, check second-best match; prefer the one
    closer to prev (lock onto the moving arrow instead of a static false match).
    """
    prev_x, prev_y = prev_position
    best_x, best_y = best_loc
    dist_best = np.sqrt((best_x - prev_x) ** 2 + (best_y - prev_y) ** 2)
    if dist_best <= max_jump_px or best_val < match_threshold:
        return (best_loc, best_val)
    res_copy = res.copy()
    y1, y2 = max(0, best_y - 2), min(res.shape[0], best_y + template_h + 2)
    x1, x2 = max(0, best_x - 2), min(res.shape[1], best_x + template_w + 2)
    res_copy[y1:y2, x1:x2] = -1.0
    _, max_val2, _, max_loc2 = cv2.minMaxLoc(res_copy)
    if max_val2 < match_threshold:
        return (best_loc, best_val)
    dist_2 = np.sqrt((max_loc2[0] - prev_x) ** 2 + (max_loc2[1] - prev_y) ** 2)
    if dist_2 < dist_best:
        return ((int(max_loc2[0]), int(max_loc2[1])), float(max_val2))
    return (best_loc, best_val)


def get_car_coordinates(
    game_frame_or_minimap: np.ndarray,
    template_path: Union[str, Path],
    match_threshold: float = 0.7,
    prev_position: Optional[Tuple[int, int]] = None,
) -> Optional[Tuple[int, int]]:
    """
    Find the player arrow on the minimap using template matching.
    prev_position: if set, prefer the match closest to this (follow the moving arrow, not a static icon).
    Returns (x, y) in minimap pixel coords, or None if match quality < threshold.
    """
    path = Path(template_path)
    if not path.is_file():
        return None
    template = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if template is None or game_frame_or_minimap.size == 0:
        return None
    if len(game_frame_or_minimap.shape) == 3:
        gray = cv2.cvtColor(game_frame_or_minimap, cv2.COLOR_BGR2GRAY)
    else:
        gray = game_frame_or_minimap
    res = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    if max_val < match_threshold:
        return None
    if prev_position is not None:
        th, tw = template.shape[0], template.shape[1]
        chosen_loc, _ = _pick_best_match_near_prev(
            res, th, tw, max_loc, float(max_val), prev_position, match_threshold
        )
        return (int(chosen_loc[0]), int(chosen_loc[1]))
    return (int(max_loc[0]), int(max_loc[1]))


def get_car_coordinates_with_score(
    game_frame_or_minimap: np.ndarray,
    template_path: Union[str, Path],
    match_threshold: float = 0.7,
    prev_position: Optional[Tuple[int, int]] = None,
) -> tuple[Optional[Tuple[int, int]], float]:
    """
    Same as get_car_coordinates but also returns the chosen match score.
    prev_position: if set, prefer match closest to this (moving arrow).
    """
    path = Path(template_path)
    if not path.is_file():
        return None, 0.0
    template = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if template is None or game_frame_or_minimap.size == 0:
        return None, 0.0
    if len(game_frame_or_minimap.shape) == 3:
        gray = cv2.cvtColor(game_frame_or_minimap, cv2.COLOR_BGR2GRAY)
    else:
        gray = game_frame_or_minimap
    res = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    if max_val < match_threshold:
        return None, float(max_val)
    if prev_position is not None:
        th, tw = template.shape[0], template.shape[1]
        chosen_loc, chosen_val = _pick_best_match_near_prev(
            res, th, tw, max_loc, float(max_val), prev_position, match_threshold
        )
        return (int(chosen_loc[0]), int(chosen_loc[1])), chosen_val
    return (int(max_loc[0]), int(max_loc[1])), float(max_val)
