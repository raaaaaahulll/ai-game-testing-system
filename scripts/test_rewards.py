import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from environment.nfs_env import NFSRivalsEnv

def test_rewards():
    print("Testing Genre Rewards...")
    
    # Mock monitor
    monitor = {"left": 0, "top": 0, "width": 800, "height": 600}
    
    # Test Racing
    env_racing = NFSRivalsEnv(monitor=monitor, game_profile="racing")
    r_racing = env_racing._compute_genre_reward(action=1, motion=10.0)
    print(f"Racing Reward (Accel): {r_racing}")
    
    # Test Open World
    env_ow = NFSRivalsEnv(monitor=monitor, game_profile="open_world")
    r_ow = env_ow._compute_genre_reward(action=1, motion=10.0)
    print(f"Open World Reward: {r_ow}")
    
    # Test Action
    env_action = NFSRivalsEnv(monitor=monitor, game_profile="action")
    r_action = env_action._compute_genre_reward(action=1, motion=10.0)
    print(f"Action Reward: {r_action}")
    
    print("SUCCESS: Rewards computed.")

if __name__ == "__main__":
    test_rewards()
