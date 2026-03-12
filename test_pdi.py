import time
from core.controller import focus_game_window, press_key

def test_input():
    # Try to focus an available window, like Brave or the current PowerShell/Antigravity window
    # or just try to press a key without focus if no specific window is found.
    # The goal is to see if pydirectinput can execute without error.
    
    print("Starting input test...")
    target_window = "Brave" # common window
    
    success = focus_game_window(target_window)
    if success:
        print(f"Focused window: {target_window}")
    else:
        print(f"Could not focus {target_window}, continuing without specific focus.")
    
    print("Pressing 'up' key in 2 seconds (switch to a text editor!)...")
    time.sleep(2)
    try:
        press_key("up")
        print("Successfully called press_key('up')")
    except Exception as e:
        print(f"Error calling press_key: {e}")

if __name__ == "__main__":
    test_input()
