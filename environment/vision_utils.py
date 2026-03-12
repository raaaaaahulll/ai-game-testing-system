"""Re-export from core for backward compatibility."""
from core.vision_utils import (
    capture_region,
    capture_minimap_region,
    get_game_window_rect,
    get_car_coordinates,
    get_car_coordinates_with_score,
    is_solid_color_anomaly,
    compute_frame_difference,
    get_base64_screenshot,
    frame_hash,
    get_speed_from_screen,
    capture_speedometer_region,
    extract_speed_ocr,
    frame_to_base64,
)
