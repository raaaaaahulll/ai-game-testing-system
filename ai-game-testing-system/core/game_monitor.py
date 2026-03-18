"""Game process monitoring for crash detection."""
from typing import Union, List, Tuple

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    psutil = None


def _normalize(name: str) -> str:
    return (name or "").strip().lower()


def is_process_running(process_name: Union[str, List[str], Tuple[str, ...]]) -> bool:
    """Return True if any process with the given name is running.
    process_name can be a single string or a list/tuple of possible names.
    """
    if not PSUTIL_AVAILABLE:
        return True  # Assume running if we can't check
    names = (process_name,) if isinstance(process_name, str) else process_name
    allowed = {_normalize(n) for n in names}
    for p in psutil.process_iter(["name"]):
        try:
            if _normalize(p.info.get("name", "")) in allowed:
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return False


def is_process_responding(process_name: Union[str, List[str], Tuple[str, ...]]) -> bool:
    """Check if process exists and is not suspended."""
    if not PSUTIL_AVAILABLE:
        return True
    names = (process_name,) if isinstance(process_name, str) else process_name
    allowed = {_normalize(n) for n in names}
    for p in psutil.process_iter(["name", "status"]):
        try:
            if _normalize(p.info.get("name", "")) in allowed:
                return p.status() != psutil.STATUS_ZOMBIE
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return False
