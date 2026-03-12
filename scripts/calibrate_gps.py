"""
Calibration script for GPS (minimap template matching).
Run with NFS Rivals in windowed mode and drive the car.
Prints (x, y) minimap coordinates every 0.5s; numbers should change as you move.
Saves what it captures to templates/captured_region.png so you can check the region.
Ctrl+C to exit.
"""
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import (
    CAR_ARROW_TEMPLATE_PATH,
    CAR_ARROW_MATCH_THRESHOLD,
    MINIMAP_LEFT,
    MINIMAP_BOTTOM_OFFSET,
    MINIMAP_SIZE,
)
from core.vision_utils import get_game_window_rect
from environment.vision_utils import capture_minimap_region, get_car_coordinates_with_score

# Where to save the captured region so you can see what the script is looking at
CAPTURED_REGION_PATH = Path(__file__).resolve().parent.parent / "templates" / "captured_region.png"


def main():
    if not CAR_ARROW_TEMPLATE_PATH.is_file():
        print(f"Template not found: {CAR_ARROW_TEMPLATE_PATH}")
        print("Create it by cropping the player arrow from the minimap. See templates/README.md")
        return
    # Prefer game window so capture is relative to the window (works in windowed mode)
    monitor = get_game_window_rect()
    if monitor:
        print("Game window found; capture is relative to the game window.")
    else:
        print("Game window not found (check GAME_WINDOW_TITLE in config.py); using primary monitor.")
    print("GPS calibration — drive the car and watch (x, y) change. Ctrl+C to stop.")
    print("(x, y) are minimap pixel coordinates (0–{}).".format(MINIMAP_SIZE - 1))
    print("Captured region is saved to:", CAPTURED_REGION_PATH)
    print("  -> Open that image to check the capture is your minimap; if not, adjust config.py")
    last_coords = None
    try:
        while True:
            minimap = capture_minimap_region(
                monitor=monitor,
                left=MINIMAP_LEFT,
                bottom_offset=MINIMAP_BOTTOM_OFFSET,
                width=MINIMAP_SIZE,
                height=MINIMAP_SIZE,
            )
            # Save what we're capturing so you can verify the region
            if minimap.size > 0:
                CAPTURED_REGION_PATH.parent.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(CAPTURED_REGION_PATH), minimap)
            coords, best_score = get_car_coordinates_with_score(
                minimap,
                CAR_ARROW_TEMPLATE_PATH,
                match_threshold=CAR_ARROW_MATCH_THRESHOLD,
                prev_position=last_coords,
            )
            if coords is not None:
                last_coords = coords
                print(f"  coords: {coords}  (score: {best_score:.2f})")
            else:
                print(f"  coords: No match (best score: {best_score:.2f}, need >={CAR_ARROW_MATCH_THRESHOLD})")
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nDone.")


if __name__ == "__main__":
    main()
