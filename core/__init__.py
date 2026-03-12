# Core: game interaction — screen capture, input simulation, vision, process monitoring.
# Used by environment/nfs_env.py and agents.

from core.controller import set_action, release_all, KEY_ACCEL, KEY_BRAKE, KEY_LEFT, KEY_RIGHT
from core.game_monitor import is_process_running
from core.vision_utils import (
    capture_region,
    capture_minimap_region,
    get_game_window_rect,
    get_car_coordinates,
    is_solid_color_anomaly,
    compute_frame_difference,
    get_base64_screenshot,
    frame_hash,
    get_speed_from_screen,
)

__all__ = [
    "set_action",
    "release_all",
    "KEY_ACCEL",
    "KEY_BRAKE",
    "KEY_LEFT",
    "KEY_RIGHT",
    "is_process_running",
    "capture_region",
    "capture_minimap_region",
    "get_game_window_rect",
    "get_car_coordinates",
    "is_solid_color_anomaly",
    "compute_frame_difference",
    "get_base64_screenshot",
    "frame_hash",
    "get_speed_from_screen",
]
