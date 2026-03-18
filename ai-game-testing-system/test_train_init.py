import os
import sys
import gymnasium as gym
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from environment.nfs_env import NFSRivalsEnv

def test_train_init():
    print("Testing training initialization for SuperTuxKart...")
    
    # Mock config that would be fetched from backend
    cfg = {
        "window_title": "SuperTuxKart",
        "process_names": ("supertuxkart.exe", "SuperTuxKart"),
        "genre": "racing",
        "control_type": "ppo"
    }
    
    def make_env():
        env = NFSRivalsEnv(
            max_episode_steps=100,
            process_names=cfg["process_names"],
            window_title=cfg["window_title"],
            game_profile=cfg["genre"]
        )
        return env

    try:
        env = DummyVecEnv([make_env])
        model = PPO("CnnPolicy", env, verbose=1)
        print("Model and Environment initialized successfully.")
        
        print("Attempting to 'learn' for 1 step to see if it crashes...")
        # We don't actually need the game to be running for this test to pass initialization
        # but the env might fail capture if no window is found. 
        # However, capture_region in vision_utils usually handles missing windows gracefully (returns black frame).
        
        model.learn(total_timesteps=1)
        print("Training successfully started (1 step).")
        
    except Exception as e:
        print(f"Error during training initialization: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_train_init()
