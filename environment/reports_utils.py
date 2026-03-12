"""Report generation: heatmaps and coverage visuals for the project."""
from pathlib import Path
from typing import Optional, Union

import numpy as np

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False
    plt = None


def save_heatmap(
    memory_array: np.ndarray,
    save_path: Union[str, Path, None] = None,
    title: str = "Gameplay Coverage Heatmap",
) -> bool:
    """
    Save the spatial memory grid as a heatmap image.
    memory_array: 2D array (e.g. 100x100) of visit counts.
    save_path: default reports/coverage_heatmap.png if None.
    Returns True if saved, False if matplotlib unavailable or error.
    """
    if not MATPLOTLIB_AVAILABLE or plt is None:
        return False
    path = Path(save_path) if save_path else Path(__file__).resolve().parent.parent / "reports" / "coverage_heatmap.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        arr = np.asarray(memory_array, dtype=np.float64)
        if arr.ndim != 2:
            return False
        arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
        arr = np.maximum(arr, 0)
        plt.figure(figsize=(8, 8))
        plt.imshow(arr, cmap="hot", interpolation="nearest")
        plt.title(title)
        plt.colorbar(label="Time Spent in Area")
        plt.savefig(path, dpi=100, bbox_inches="tight")
        plt.close()
        return True
    except Exception:
        return False


def heatmap_to_png_bytes(memory_array: np.ndarray, title: str = "Gameplay Coverage Heatmap") -> Optional[bytes]:
    """
    Render the spatial memory grid as PNG bytes for embedding in reports.
    memory_array: 2D array (e.g. 100x100) of visit counts.
    Returns PNG bytes or None if matplotlib unavailable or error.
    """
    if not MATPLOTLIB_AVAILABLE or plt is None:
        return None
    try:
        import io
        plt.figure(figsize=(8, 8))
        plt.imshow(memory_array, cmap="hot", interpolation="nearest")
        plt.title(title)
        plt.colorbar(label="Time Spent in Area")
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=100, bbox_inches="tight")
        plt.close()
        buf.seek(0)
        return buf.read()
    except Exception:
        return None
