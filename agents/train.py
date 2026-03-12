"""
Per-game training: PPO or DQN for testing sessions.
Usage: python agents/train.py [--game_key KEY] [--algo ppo|dqn]
Fetches game config from backend (window title, process names, genre); saves to agents/models/<game_key>/model_ppo.zip or model_dqn.zip.
If backend is down and game_key is nfs_rivals, uses config.py defaults.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

import gymnasium as gym
from stable_baselines3 import PPO
from stable_baselines3 import DQN
from stable_baselines3.common.vec_env import DummyVecEnv
from stable_baselines3.common.callbacks import BaseCallback, CallbackList, CheckpointCallback
from stable_baselines3.common.monitor import Monitor

from environment.nfs_env import NFSRivalsEnv
from config import (
    PROJECT_ROOT,
    MAX_EPISODE_STEPS,
    GAME_KEY as CONFIG_GAME_KEY,
    BACKEND_URL,
    GAME_WINDOW_TITLE,
    NFS_PROCESS_NAMES,
)

LOG_DIR = PROJECT_ROOT / "logs" / "ppo"
SAVE_FREQ = 10000
DEFAULT_TIMESTEPS = 500_000

# When backend writes this file, training checks it and exits gracefully so the model is saved (not killed)
STOP_REQUEST_DIR = PROJECT_ROOT / "logs" / "training"
STOP_REQUEST_FILE = STOP_REQUEST_DIR / "stop_requested.txt"


def fetch_game_config(game_key: str):
    """
    Fetch game config from backend. Returns dict with window_title, process_names, genre.
    If backend unreachable and game_key is nfs_rivals, return defaults from config.
    Otherwise raises SystemExit.
    """
    if REQUESTS_AVAILABLE:
        try:
            r = requests.get(
                f"{BACKEND_URL.rstrip('/')}/game-config",
                params={"game_key": game_key},
                timeout=5,
            )
            if r.ok:
                data = r.json()
                process_names = data.get("process_names") or []
                return {
                    "window_title": (data.get("window_title") or "").strip(),
                    "process_names": tuple(p.strip() for p in process_names if p) if process_names else (),
                    "genre": (data.get("genre") or "racing").strip().lower(),
                    "key_bindings": data.get("key_bindings"),
                    "mouse_mode": (data.get("mouse_mode") or "none").strip().lower(),
                    "mouse_sensitivity": data.get("mouse_sensitivity"),
                    "menu_click_positions": data.get("menu_click_positions"),
                    "auto_detect_minimap": data.get("auto_detect_minimap", True),
                }
            if r.status_code == 404:
                raise SystemExit(f"Game config not found: {game_key}. Add the game in Dashboard → Game configs.")
            raise SystemExit(f"Backend returned {r.status_code}: {r.text}")
        except requests.RequestException as e:
            if game_key == "nfs_rivals":
                # Offline fallback for default game
                return {
                    "window_title": GAME_WINDOW_TITLE or "",
                    "process_names": NFS_PROCESS_NAMES,
                    "genre": "racing",
                    "key_bindings": None,
                    "mouse_mode": "none",
                    "mouse_sensitivity": None,
                    "menu_click_positions": None,
                }
            raise SystemExit(f"Failed to reach backend at {BACKEND_URL}: {e}")
    if game_key == "nfs_rivals":
        return {
            "window_title": GAME_WINDOW_TITLE or "",
            "process_names": NFS_PROCESS_NAMES,
            "genre": "racing",
            "mouse_mode": "none",
            "mouse_sensitivity": None,
            "menu_click_positions": None,
        }
    raise SystemExit("requests is required to fetch game config. pip install requests")


def make_env_factory(game_key: str, cfg: dict):
    """Return a callable that creates a single env with game config (profile, process_names, window_title, key_bindings, mouse_*)."""
    process_names = cfg.get("process_names") or ()
    window_title = (cfg.get("window_title") or "").strip()
    game_profile = (cfg.get("genre") or "racing").strip().lower()
    key_bindings = cfg.get("key_bindings")
    mouse_mode = cfg.get("mouse_mode") or "none"
    mouse_sensitivity = cfg.get("mouse_sensitivity")
    menu_click_positions = cfg.get("menu_click_positions")

    def _init():
        env = NFSRivalsEnv(
            max_episode_steps=MAX_EPISODE_STEPS,
            process_names=process_names if process_names else None,
            window_title=window_title or None,
            game_profile=game_profile,
            key_bindings=key_bindings,
            mouse_mode=mouse_mode,
            mouse_sensitivity=mouse_sensitivity,
            menu_click_positions=menu_click_positions,
            auto_detect_minimap=cfg.get("auto_detect_minimap", True),
        )
        return Monitor(env, filename=None)

    return _init


class ExplorationBonusCallback(BaseCallback):
    """Optional: log exploration-related metrics."""

    def _on_step(self) -> bool:
        return True


class TrainingProgressCallback(BaseCallback):
    """Send periodic training progress updates to the backend for dashboard display."""

    def __init__(
        self,
        game_key: str,
        algo: str,
        target_timesteps: int,
        run_id: str,
        source: str,
        verbose: int = 0,
    ):
        super().__init__(verbose)
        self.game_key = game_key
        self.algo = algo
        self.target_timesteps = int(target_timesteps) if target_timesteps is not None else None
        self.run_id = run_id
        self.source = source
        self._last_report_steps = 0
        self._episode_count = 0
        self._best_reward = None
        # Aim for ~50 updates over the full run; fall back to a sane default
        self._report_every = max(1, (self.target_timesteps // 50) if self.target_timesteps else 10_000)

    def _on_step(self) -> bool:
        # Count completed episodes from dones
        dones = self.locals.get("dones")
        if dones is not None:
            try:
                n = int(getattr(dones, "sum", lambda: sum(dones))())
                self._episode_count += n
            except (TypeError, ValueError):
                pass
        if not REQUESTS_AVAILABLE:
            return True
        total_steps = int(self.num_timesteps)
        if total_steps - self._last_report_steps < self._report_every:
            return True
        self._last_report_steps = total_steps
        try:
            reward = None
            # Prefer mean episode return from SB3's ep_info_buffer (recent completed episodes)
            if hasattr(self.model, "ep_info_buffer") and self.model.ep_info_buffer:
                try:
                    rewards = [float(ep["r"]) for ep in self.model.ep_info_buffer]
                    if rewards:
                        reward = sum(rewards) / len(rewards)
                except (KeyError, TypeError, ZeroDivisionError):
                    pass
            if reward is None and "rewards" in self.locals:
                r = self.locals["rewards"]
                try:
                    if hasattr(r, "mean"):
                        reward = float(r.mean())
                    elif isinstance(r, (list, tuple)) and r:
                        reward = float(sum(r) / len(r))
                except Exception:
                    pass
            if reward is not None and (self._best_reward is None or reward > self._best_reward):
                self._best_reward = reward
            import requests

            requests.post(
                f"{BACKEND_URL.rstrip('/')}/agent/train/progress",
                json={
                    "game_key": self.game_key,
                    "algo": self.algo,
                    "total_timesteps": total_steps,
                    "target_timesteps": self.target_timesteps,
                    "episode": self._episode_count,
                    "reward": reward,
                    "best_reward": self._best_reward,
                    "run_id": self.run_id,
                    "source": self.source,
                },
                timeout=3,
            )
        except Exception:
            # Never interrupt training because of progress reporting issues
            pass
        return True


class StopRequestCallback(BaseCallback):
    """Check for stop_requested.txt; when present, raise KeyboardInterrupt so finally block runs and model is saved."""

    def __init__(self, game_key: str, check_every: int = 500, verbose: int = 0):
        super().__init__(verbose)
        self.game_key = game_key
        self._check_every = check_every
        self._last_check = 0

    def _on_step(self) -> bool:
        if self.num_timesteps - self._last_check < self._check_every:
            return True
        self._last_check = int(self.num_timesteps)
        if not STOP_REQUEST_FILE.exists():
            return True
        try:
            content = STOP_REQUEST_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            content = ""
        if content and content != self.game_key:
            return True  # stop requested for another game
        raise KeyboardInterrupt("Stop requested from dashboard (model will be saved).")


def main():
    parser = argparse.ArgumentParser(description="Train PPO or DQN for a game (per-game model).")
    parser.add_argument(
        "--game_key",
        type=str,
        default=os.environ.get("GAME_KEY", CONFIG_GAME_KEY),
        help="Game key (must exist in Dashboard Game configs unless nfs_rivals). Default: GAME_KEY env or nfs_rivals",
    )
    parser.add_argument(
        "--algo",
        type=str,
        choices=("ppo", "dqn", "auto"),
        default="auto",
        help="Algorithm: ppo, dqn, or auto (suggests based on genre). Default: auto",
    )
    parser.add_argument(
        "--timesteps",
        type=int,
        default=DEFAULT_TIMESTEPS,
        help=f"Total training timesteps. Default: {DEFAULT_TIMESTEPS}",
    )
    args = parser.parse_args()
    game_key = (args.game_key or "nfs_rivals").strip()
    algo = (args.algo or "ppo").lower()

    cfg = fetch_game_config(game_key)
    genre = cfg.get("genre", "racing")
    
    if algo == "auto":
        if genre == "racing":
            algo = "dqn"
            print(f"Auto-selected DQN for {genre} genre (more efficient for discrete driving).")
        else:
            algo = "ppo"
            print(f"Auto-selected PPO for {genre} genre (more stable for complex action spaces).")

    print(f"Training {algo.upper()} for game_key={game_key} (genre={genre})")

    # Per-game save path: agents/models/<game_key>/model_ppo.zip or model_dqn.zip
    models_dir = PROJECT_ROOT / "agents" / "models" / game_key
    models_dir.mkdir(parents=True, exist_ok=True)
    model_path = models_dir / f"model_{algo}.zip"

    log_dir = LOG_DIR if game_key == "nfs_rivals" else (PROJECT_ROOT / "logs" / algo / game_key)
    log_dir.mkdir(parents=True, exist_ok=True)

    env = DummyVecEnv([make_env_factory(game_key, cfg)])

    if algo == "dqn":
        model_cls = DQN
        model_kwargs = dict(
            policy="CnnPolicy",
            env=env,
            learning_rate=1e-4,
            buffer_size=100_000,
            learning_starts=1000,
            batch_size=32,
            tau=1.0,
            gamma=0.99,
            train_freq=4,
            gradient_steps=1,
            target_update_interval=1000,
            verbose=1,
            policy_kwargs=dict(net_arch=[256, 256]),
            tensorboard_log=str(log_dir),
        )
    else:
        model_cls = PPO
        model_kwargs = dict(
            policy="CnnPolicy",
            env=env,
            learning_rate=3e-4,
            n_steps=2048,
            batch_size=64,
            n_epochs=10,
            gamma=0.99,
            gae_lambda=0.95,
            clip_range=0.2,
            ent_coef=0.01,
            verbose=1,
            policy_kwargs=dict(net_arch=dict(pi=[256, 256], vf=[256, 256])),
            tensorboard_log=str(log_dir),
        )

    if model_path.exists():
        print(f"Loading existing model from {model_path}")
        model = model_cls.load(model_path, env=env)
    else:
        model = model_cls(**model_kwargs)

    # Clear stop-request file so a previous "Stop training" doesn't stop this run immediately
    try:
        STOP_REQUEST_DIR.mkdir(parents=True, exist_ok=True)
        if STOP_REQUEST_FILE.exists():
            STOP_REQUEST_FILE.unlink()
    except Exception:
        pass

    callbacks = [ExplorationBonusCallback(), StopRequestCallback(game_key=game_key)]
    progress_cb = None
    # Run identifier & source: when launched from dashboard, backend passes
    # TRAIN_RUN_ID and TRAIN_SOURCE; CLI runs omit these and default to "cli".
    run_id = os.getenv("TRAIN_RUN_ID") or f"{game_key}-{int(time.time())}"
    source = (os.getenv("TRAIN_SOURCE") or "cli").lower()
    if REQUESTS_AVAILABLE:
        progress_cb = TrainingProgressCallback(
            game_key=game_key,
            algo=algo,
            target_timesteps=args.timesteps,
            run_id=run_id,
            source=source,
        )
        callbacks.append(progress_cb)
    
    # Checkpoint system: save a snapshot every 25,000 steps (e.g. every ~20 min on low-end PC)
    checkpoint_dir = models_dir / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    callbacks.append(CheckpointCallback(
        save_freq=max(1000, min(25000, args.timesteps // 10)), 
        save_path=str(checkpoint_dir),
        name_prefix=f"model_{algo}_checkpoint"
    ))

    # Progress bar requires tqdm+rich (e.g. pip install stable-baselines3[extra] or pip install tqdm rich)
    try:
        import tqdm
        import rich
        _use_progress_bar = True
    except ImportError:
        _use_progress_bar = False
        print("Progress bar disabled (install tqdm and rich for progress bar).")

    try:
        model.learn(
            total_timesteps=args.timesteps,
            callback=CallbackList(callbacks) if len(callbacks) > 1 else callbacks[0],
            progress_bar=_use_progress_bar,
        )
    except KeyboardInterrupt as e:
        print("Training interrupted." if "Stop requested" not in str(e) else str(e))
    finally:
        model.save(model_path)
        print(f"Model saved to {model_path}")
        if REQUESTS_AVAILABLE:
            try:
                import requests
                final_episode = getattr(progress_cb, "_episode_count", None) if progress_cb else None
                final_best = getattr(progress_cb, "_best_reward", None) if progress_cb else None
                requests.post(
                    f"{BACKEND_URL.rstrip('/')}/agent/train/progress",
                    json={
                        "game_key": game_key,
                        "algo": algo,
                        "total_timesteps": int(getattr(model, "num_timesteps", args.timesteps)),
                        "target_timesteps": args.timesteps,
                        "episode": final_episode,
                        "reward": None,
                        "best_reward": final_best,
                        "done": True,
                        "run_id": run_id,
                        "source": source,
                    },
                    timeout=3,
                )
            except Exception:
                pass
        env.close()


if __name__ == "__main__":
    main()
