# AI Game Testing System

AI based automated game testing using PPO and DQN.

This system trains reinforcement learning agents to explore
game environments and automatically detect crashes and bugs.
| Layer | Technology |
|-------|------------|
| AI Engine | Python, Stable Baselines3 (PPO) |
| Environment | Gymnasium, OpenCV, MSS |
| Input | PyDirectInput (DirectX-compatible) |
| Backend | FastAPI, SQLAlchemy, aiosqlite |
| Frontend | React, Vite, Tailwind CSS |

## Project Structure

```
nfs_ai_tester/
├── agents/           # RL training and inference
│   ├── train.py      # PPO training script
│   └── run_agent.py  # Run trained agent
├── core/             # Game interaction (screen capture, input, vision, process)
│   ├── capture.py    # Screen capture
│   ├── controller.py # PyDirectInput keys
│   ├── vision_utils.py
│   └── game_monitor.py
├── environment/      # Gymnasium bridge (uses core/)
│   ├── nfs_env.py    # NFSRivalsEnv
│   └── reports_utils.py
├── backend/          # FastAPI API + WebSocket + DB
│   ├── main.py
│   └── database/
├── dashboard/        # React dashboard (live heatmap, coverage %, bug severity)
├── logs/traces/      # Input traces on bug (ring buffer dumps)
├── reports/          # Generated reports
├── config.py
└── requirements.txt
```

## Setup

1. **Python (3.10+)**  
   Create a venv and install dependencies:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   ```

2. **Dashboard**  
   From project root:

   ```bash
   cd dashboard
   npm install
   npm run dev
   ```
   Dashboard: http://localhost:3000 (proxies API to backend).

3. **Backend**  
   From project root:

   ```bash
   uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
   ```
   API: http://localhost:8000

## Usage

1. Start **NFS Rivals** in **windowed mode** and get in-game (e.g. free roam).
2. Start the **backend** (`uvicorn backend.main:app --port 8000`).
3. (Optional) Start the **dashboard** (`cd dashboard && npm run dev`).
4. **Train** the agent (or run a trained model):
   - Training: `python agents/train.py`
   - Inference only: `python agents/run_agent.py`

The agent captures the game screen, sends actions via PyDirectInput, and reports bugs (crashes, solid-screen anomalies, stuck states, **performance degradation**) to the backend with **severity** (critical/major/minor) and **input traces** (last 100 actions in `logs/traces/`). The dashboard shows **Testing Summary**, **Exploration heatmap** (live via WebSocket), **Gameplay Coverage %** (unique tiles / total tiles), **Current FPS**, and a **Bug Gallery** with severity and trace filenames. From the **Analytics** page you can **Start** or **Stop** the agent (test execution control), **Pause** it, and **Export comprehensive report** (MD with embedded heatmap image and trace summaries per bug). The **Play vs AI** page is a board-games hub (Chess, Checkers, Othello, Connect Four, Tic-Tac-Toe). Chess uses Stockfish (you play White, AI plays Black); other games use in-browser AI. Chess requires Stockfish installed and on PATH (or set `STOCKFISH_PATH`); backend uses `python-chess` for UCI.

---

## What Agent Is Used?

**PPO (Proximal Policy Optimization)** from **Stable Baselines3**, with a **CNN policy** that takes the game screen as input. The algorithm is well-suited to continuous-looking control (racing) and is trained to explore the game rather than “win” — so it visits many areas and surfaces bugs.

- **Library**: `stable_baselines3.PPO`
- **Policy**: `CnnPolicy` (convolutional neural network on 84×84 grayscale frames)
- **Saved model**: `agents/model_ppo.zip` (created by `train.py`, used by `run_agent.py`)

---

## How the Agent Works

1. **Observation (state)**  
   Each step, the environment captures the screen with **MSS**, resizes it to **84×84 grayscale** with **OpenCV**, and passes it to the agent as the current state.

2. **Action**  
   The agent outputs a **discrete action** (0–7): coast, accelerate, brake, steer left, steer right, accel+left, accel+right, or accel again. The **controller** maps these to **arrow keys** (Up/Down/Left/Right) via **PyDirectInput** so the game receives input.

3. **Reward**  
   - **Small positive** reward for frame-to-frame **motion** (screen change), to encourage moving.
   - **Exploration bonus**: extra reward for visiting **less-visited grid cells** (so the agent prefers new areas over staying in one place).
   - **Small negative** reward each step (time penalty), to encourage progress.
   - **Large negative** (−10) and **episode end** when a **bug is detected** (crash, screen anomaly, or stuck).

   During **training**, PPO also uses **entropy** (`ent_coef`) so the policy keeps trying different actions (steer, brake, accel) instead of one fixed behavior.

4. **Loop**  
   The environment runs a **frame_skip** (e.g. 2) of small delays and screen captures per agent step, checks for bugs every sub-step, and logs pseudo-position for the **heatmap**. When you run `train.py`, PPO learns from this loop; when you run `run_agent.py`, it only runs the trained policy (no training).

**How to demonstrate the project** (live demo script, “no game” option, and where exploration is tuned): see **[DEMONSTRATE.md](DEMONSTRATE.md)**.

---

## How Bug Detection Works (Bug Oracle)

Bugs are detected **inside the environment** during `step()`, then reported to the backend with a screenshot.

| Bug type | How it’s detected | When it’s reported |
|----------|-------------------|--------------------|
| **Crash** | **Process check**: The game process is monitored (e.g. “Need for Speed™ Rivals (32 bit)” or `NFSRivals.exe`) with **psutil**. If that process is no longer running, the game has crashed. | Report: **"Crash Bug (process exited)"**. |
| **Screen anomaly** | **Image check**: The current frame is analyzed with **OpenCV**. If almost all pixels are the same color (e.g. ≥98% in one value), the screen is treated as “solid” — typical when the game freezes, you fall through the world, or the renderer fails. | Report: **"Screen Anomaly (solid/freeze)"**. |
| **Stuck** | **Motion check**: Frame-to-frame **mean absolute difference** is computed. If the screen barely changes (difference &lt; 2.0) for **120 consecutive frames** (~2 seconds), the agent is considered stuck (e.g. car not moving despite gas). | Report: **"Stuck (no motion)"**. |
| **Performance degradation** | **FPS check**: Frame capture times are averaged over a sliding window. If the resulting FPS stays below **PERF_MIN_FPS** (default 15) for **PERF_LOW_FPS_STEPS** consecutive step checks, the game is considered to have performance degradation. | Report: **"Performance degradation (FPS: X)"** (severity: major). Toggle with **ENABLE_PERF_MONITORING** in `config.py`. |

After any detected bug, the environment sends a **POST** to `http://localhost:8000/report-bug` with `type`, `timestamp`, and a base64 **screenshot**. The dashboard shows these in **Testing Summary** and **Detected Glitches**. **Test execution** can be controlled from the dashboard: **Analytics** → **Start agent** / **Stop agent**. **Comprehensive reports** (Analytics → Export comprehensive report) include the coverage heatmap image and trace summaries for each bug.

---

## Configuration

- **config.py**: observation size (84×84), frame skip, max episode steps, game process name(s), backend URL, glitch thresholds (solid-color %, stuck-frame count).
- **environment/controller.py**: key bindings (arrow keys by default; change to WASD if needed).

### Mouse automation (per game)

Not all games need the mouse; you configure it per game in **Dashboard → Game configs**:

| Mouse mode | Use case | Behavior |
|------------|----------|----------|
| **None** | Racing, keyboard-only games | No mouse; agent uses only keys (default). |
| **Menus only** | Most games | Scripted clicks at episode start (e.g. Start / Continue). Set **Menu click positions** as JSON (normalized 0–1), e.g. `{"start":[0.5,0.4]}`. |
| **Gameplay (camera)** | FPS, open-world | Agent has 12 actions: 0–7 = drive (unchanged), 8–11 = look left/right/up/down via relative mouse. Set **Mouse sensitivity** (pixels per step) or use `config.py` fallback `MOUSE_SENSITIVITY` (default 30). Train a model for that game so the policy outputs 0–11. |

Fallbacks in **config.py**: `MOUSE_SENSITIVITY = 30`, `MENU_CLICK_POSITIONS = {}`. See **[Mouse automation](docs/MOUSE_AUTOMATION_IMPLEMENTATION_PLAN.md)** for implementation details.

---

## Documentation

- **[setup.md](setup.md)** — One-time setup, run instructions, dashboard sidebar, agent and training.
- **[DEMONSTRATE.md](DEMONSTRATE.md)** — Live demo guide: run_system.bat, dashboard walkthrough, agent/training demo, reports.
- **[configgame.md](configgame.md)** — Game capture and car-arrow (GPS) template setup for the minimap.
- **[Universal Game Tester](docs/UNIVERSAL_GAME_TESTER.md)** — Multi-game support, game key, per-game config and training.
- **[Mouse automation](docs/MOUSE_AUTOMATION_IMPLEMENTATION_PLAN.md)** — Per-game mouse mode (none / menus only / gameplay), dashboard config, and usage.
- **[Professional AI Testing — Architecture & Implementation](docs/PROFESSIONAL_AI_TESTING.md)** — Modular structure (agents / core / backend / dashboard / logs), real-time heatmap (Producer–Consumer over WebSockets), professional bug reporting (ring-buffer traces, severity), and the 5-phase implementation strategy.
=======
# ai-game-testing-system
AI based automated game testing using PPO and DQN
>>>>>>> 7f80c5857b188904fed6df6cc732744a63503aeb
