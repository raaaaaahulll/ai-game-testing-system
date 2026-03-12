"""
Run a trained RL agent (PPO or DQN) for testing sessions.
Fetches game config from backend by GAME_KEY; loads per-game model from agents/models/<game_key>/model_*.zip.
Start the game in windowed mode, then run this script (or start from dashboard Session & Analytics).
Pause from the dashboard Analytics page to send no-op (coast) instead of model action.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from stable_baselines3 import PPO
from stable_baselines3 import DQN

from environment.nfs_env import NFSRivalsEnv
from environment.reports_utils import save_heatmap
from core.controller import release_all
from config import BACKEND_URL, REPORTS_DIR, PROJECT_ROOT, GAME_KEY

# Default path when no per-game model (backward compat)
LEGACY_MODEL_PATH = Path(__file__).resolve().parent / "model_ppo.zip"


def fetch_game_config(game_key: str) -> dict:
    """Fetch game config from backend. Raises SystemExit on failure."""
    if not REQUESTS_AVAILABLE:
        raise SystemExit("requests is required to fetch game config. pip install requests")
    url = f"{BACKEND_URL.rstrip('/')}/game-config"
    try:
        r = requests.get(url, params={"game_key": game_key}, timeout=5)
    except Exception as e:
        raise SystemExit(f"Failed to reach backend at {BACKEND_URL}: {e}")
    if r.status_code == 404:
        raise SystemExit(f"Game config not found: {game_key}. Add the game in Dashboard → Game configs.")
    if not r.ok:
        raise SystemExit(f"Backend returned {r.status_code}: {r.text}")
    return r.json()


def resolve_model_path(game_key: str, control_type: str, model_path_from_config):
    """Resolve path to model file. Prefer config model_path; else agents/models/<game_key>/model_ppo.zip or model_dqn.zip."""
    if model_path_from_config and (model_path_from_config := (model_path_from_config or "").strip()):
        p = Path(model_path_from_config)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        return p
    algo = "ppo" if (control_type or "ppo").lower() == "ppo" else "dqn"
    return PROJECT_ROOT / "agents" / "models" / game_key / f"model_{algo}.zip"


def is_paused():
    """Check if dashboard requested pause (agent sends coast when paused)."""
    if not REQUESTS_AVAILABLE:
        return False
    try:
        r = requests.get(f"{BACKEND_URL.rstrip('/')}/analytics/pause", timeout=1)
        return r.ok and r.json().get("paused") is True
    except Exception:
        return False


def main():
    game_key = os.environ.get("GAME_KEY", GAME_KEY)
    if not game_key:
        print("GAME_KEY not set. Set it in the environment or in config.py.")
        return

    cfg = fetch_game_config(game_key)
    window_title = (cfg.get("window_title") or "").strip()
    process_names_raw = cfg.get("process_names") or []
    process_names = tuple(p.strip() for p in process_names_raw if p) if process_names_raw else ()
    control_type = (cfg.get("control_type") or "ppo").strip().lower()
    model_path_from_config = cfg.get("model_path")
    key_bindings = cfg.get("key_bindings")  # None = use default (arrows); dict for WASD etc.
    mouse_mode = cfg.get("mouse_mode") or "none"
    mouse_sensitivity = cfg.get("mouse_sensitivity")
    menu_click_positions = cfg.get("menu_click_positions")  # dict or None (from API)

    model_path = resolve_model_path(game_key, control_type, model_path_from_config)
    # Backward compat: if per-game path missing and game is nfs_rivals, try legacy single model_ppo.zip
    if not model_path.exists() and game_key == "nfs_rivals" and LEGACY_MODEL_PATH.exists():
        model_path = LEGACY_MODEL_PATH

    if not model_path.exists():
        algo = "dqn" if control_type == "dqn" else "ppo"
        cmd = f"python agents/train.py --game_key {game_key} --algo {algo}"
        print(f"No model for game '{game_key}'.")
        print(f"  Expected: {model_path}")
        print(f"  Train first: {cmd}")
        print(f"  See docs/UNIVERSAL_GAME_TESTER.md (Per-game training).")
        return

    if control_type == "dqn":
        model = DQN.load(model_path)
    else:
        model = PPO.load(model_path)

    game_profile = (cfg.get("genre") or "racing").strip().lower()
    env = NFSRivalsEnv(
        process_names=process_names if process_names else None,
        window_title=window_title or None,
        game_profile=game_profile,
        key_bindings=key_bindings,
        mouse_mode=mouse_mode,
        mouse_sensitivity=mouse_sensitivity,
        menu_click_positions=menu_click_positions,
        minimap_left=cfg.get("minimap_left"),
        minimap_bottom=cfg.get("minimap_bottom"),
        minimap_size=cfg.get("minimap_size"),
        marker_template_path=cfg.get("marker_template_path"),
    )
    obs, _ = env.reset()
    try:
        while True:
            action, _ = model.predict(obs, deterministic=False)
            if is_paused():
                action = 0  # Coast when paused from dashboard
            obs, reward, terminated, truncated, info = env.step(int(action))
            if terminated or truncated:
                print("Episode ended:", info)
                obs, _ = env.reset()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            if hasattr(env, "_map_memory") and env._map_memory is not None:
                save_heatmap(env._map_memory)
        except BaseException:
            pass
        try:
            release_all(key_map=key_bindings)  # from cfg; None = default keys
        except BaseException:
            pass
        try:
            env.close()
        except BaseException:
            pass


if __name__ == "__main__":
    main()
