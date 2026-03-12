import cv2
import numpy as np
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.vision_utils import find_minimap_circles

def test_detection():
    print("Testing Minimap Detection...")
    # Create a dummy frame with a circle
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    # Draw a "minimap" at bottom-left
    cv2.circle(frame, (200, 900), 100, (255, 255, 255), -1)
    
    circles = find_minimap_circles(frame)
    print(f"Detected circles: {circles}")
    
    if circles:
        print("SUCCESS: Circle detected!")
        return True
    else:
        print("FAIL: No circle detected.")
        return False

if __name__ == "__main__":
    if test_detection():
        sys.exit(0)
    else:
        sys.exit(1)
