# AI Game Tester — Setup & Test Guide

Follow these steps once to set up the project. After that, use **run_system.bat** to start everything.

---

## What You Need

- **Windows PC** (for NFS Rivals: game installed)
- **Python 3.10 or newer** — [Download](https://www.python.org/downloads/) (check "Add Python to PATH")
- **Node.js** — [Download](https://nodejs.org/) (LTS version)

---

## Step 1: One-Time Setup

### 1.1 Open a terminal in the project folder

- Go to the folder: `c:\NFS Rival Tester`
- **Shift + Right-click** in the folder → **"Open PowerShell window here"** (or open Command Prompt and `cd` to that folder)

### 1.2 Create Python virtual environment and install dependencies

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Wait until all packages finish installing.

### 1.3 Install dashboard dependencies

```bat
cd dashboard
npm install
cd ..
```

---

## Step 2: Configure for Your Game (Optional)

- **Game key:** The default game is **NFS Rivals** (`GAME_KEY=nfs_rivals`). To test another game, set `GAME_KEY=my_game` (env or in `config.py`) and add the game in the dashboard **Game configs** (game key, display name, window title, process names, genre, control type).
- **Keys:** The agent uses **arrow keys** by default (Up=accelerate, Down=brake, Left/Right=steer). To use WASD, edit `environment\controller.py` and set `KEY_ACCEL="w"`, `KEY_BRAKE="s"`, `KEY_LEFT="a"`, `KEY_RIGHT="d"`.
- **Game process:** For NFS Rivals the project looks for "Need for Speed™ Rivals (32 bit)" and `NFSRivals.exe`. To change, edit `config.py`: `NFS_PROCESS_NAMES`, `GAME_WINDOW_TITLE` (and `GAME_KEY` for a different game).
- **Spatial memory (GPS):** For minimap coverage heatmap, add a player-arrow template. See **templates/README.md**: crop the car icon from the minimap, save as `templates/car_arrow.png`. If missing, the agent still runs with estimated position.

---

## Step 3: Run the System (One-Click)

1. Double-click **`run_system.bat`** in the project folder.
2. Three windows will open:
   - **AI Game Tester - Backend** — leave it open (API on port 8000).
   - **AI Game Tester - Dashboard** — leave it open (web UI on port 3000).
   - **AI Game Tester - Agent** — use this to run the agent or training (or start the agent from the dashboard).
3. Wait until the dashboard shows something like: `Local: http://localhost:3000`
4. The batch file will open **http://localhost:3000** in your browser. Click **"Enter dashboard"** (no password for local use).

If the dashboard shows "Backend not reachable", wait for the Backend window to display `Uvicorn running on http://127.0.0.1:8000`, then refresh (F5). To verify: run `python scripts\verify_system.py` with the backend already running.

---

## Step 4: Dashboard and Agent

### Dashboard sidebar

- **Dashboard** — overview and recent bugs for the selected game.
- **Session & Analytics** — live heatmap, coverage %, path trail, FPS; **Start agent** / **Stop agent** (for the selected game); export reports.
- **Previous sessions** — past sessions and bugs, filtered by game.
- **Game configs** — add or edit games (game key, display name, window title, process names, genre, control type); **Copy train cmd** and **Start training** for per-game models.
- **Play vs AI** — board games (Chess, Checkers, Othello, Connect Four, Tic-Tac-Toe). Chess uses Stockfish (optional; set `STOCKFISH_PATH` in the .bat if needed).

Use the **Game (session filter)** dropdown to view bugs and sessions for one game.

### Running the agent

**Option A — From the dashboard**

1. In **Session & Analytics**, select the game in the **Game (session filter)** dropdown.
2. Click **Start agent**. The agent runs with that game’s config and loads the model for that game.

**Option B — From the Agent terminal**

1. Start your game (e.g. NFS Rivals) in **windowed mode** and get in-game.
2. In the **AI Game Tester - Agent** window (or a new terminal with `.venv` activated):

   ```bat
   set GAME_KEY=nfs_rivals
   python agents\run_agent.py
   ```

   For another game, set `GAME_KEY` to that game’s key (same as in Game configs).

The agent loads the model from `agents\models\<game_key>\model_ppo.zip` (or `model_dqn.zip` if that game uses DQN). If no model exists, train first (see below).

### First time: train a model (per game)

Models are stored per game under `agents\models\<game_key>\`.

1. Start your game in windowed mode and get in-game.
2. With the **backend running**, in a terminal (project folder, `.venv` activated):

   ```bat
   python agents\train.py --game_key nfs_rivals
   ```

   For another game use that game’s key. Optional: `--algo dqn` for DQN, `--timesteps 200000` to shorten training.
3. Let it run (or Ctrl+C to stop and save). The model is saved as `agents\models\nfs_rivals\model_ppo.zip` (or `model_dqn.zip` for DQN).
4. Then run the agent as above. You can also use **Game configs** in the dashboard: **Copy train cmd** or **Start training** for that game.

**Legacy:** If `agents\models\nfs_rivals\` does not exist, the agent still uses `agents\model_ppo.zip` for `nfs_rivals`.

---

## Quick Reference

| What                | How |
|---------------------|-----|
| Start backend + UI   | Double-click **run_system.bat** |
| Open dashboard      | Browser: **http://localhost:3000** |
| Login               | Click **Enter dashboard** (no password locally) |
| Run agent           | Dashboard: Session & Analytics → select game → **Start agent**; or terminal: `set GAME_KEY=nfs_rivals` then `python agents\run_agent.py` |
| Train agent (game)  | Terminal: `python agents\train.py --game_key <key>` or use **Game configs** → Copy train cmd / Start training |
| Add another game    | Dashboard: **Game configs** → add row (game key, display name, window title, process names, genre, control type); set `GAME_KEY` when running agent |
| Verify backend      | `python scripts\verify_system.py` (with backend running) |
| Stop everything     | Close Backend and Dashboard windows; stop agent from dashboard or Ctrl+C in agent terminal |

---

## Troubleshooting

- **"Backend not reachable" on dashboard**  
  Wait for the Backend window to show `Uvicorn running on http://127.0.0.1:8000`, then refresh the page. Run `python scripts\verify_system.py` to confirm the API.

- **Agent does not control the game**  
  Put the game in **windowed mode** and give it focus. Check `environment\controller.py` for key bindings. Run as administrator if needed.

- **No bugs appear**  
  Bugs are reported on crash, solid/frozen screen, or stuck (no motion). Drive around or trigger a crash to test.

- **"No model for game 'X'"**  
  Train for that game: `python agents\train.py --game_key X` or use **Game configs** → **Copy train cmd** / **Start training**.

- **Python or npm not found**  
  Install Python and Node.js and add them to your system PATH during installation.

- **Packages "already satisfied" in a different path (e.g. c:\\python314\\...)**  
  The backend and training use the project’s **.venv**. If `python -m pip install <package>` still reports the global path, install using the venv’s Python explicitly:  
  **`.venv\Scripts\python.exe -m pip install <package>`**  
  (e.g. `.venv\Scripts\python.exe -m pip install tensorboard`). No need to activate first.

---

See **DEMONSTRATE.md** for the demo guide, **docs/UNIVERSAL_GAME_TESTER.md** for multiple games, and **docs/PROFESSIONAL_AI_TESTING.md** for architecture detail.
