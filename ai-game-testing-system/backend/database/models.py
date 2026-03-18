"""SQLAlchemy models for bug reports and session stats."""
import os
from pathlib import Path
from datetime import datetime
from typing import AsyncGenerator

from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

Base = declarative_base()

# DB next to backend folder
DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "bugs.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{DB_PATH}",
)


class BugReport(Base):
    __tablename__ = "bug_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    game_key = Column(String(64), nullable=True)  # e.g. "nfs_rivals", "my_game"; null = legacy (treated as nfs_rivals)
    type = Column(String(128), nullable=False)
    severity = Column(String(32), nullable=True)  # critical, major, minor
    timestamp = Column(Float, nullable=False)
    screenshot_b64 = Column(Text, nullable=True)  # base64 PNG
    trace_filename = Column(String(256), nullable=True)  # logs/traces/<filename>
    fps_at_bug = Column(Float, nullable=True)  # performance at time of report
    pc_was_struggling = Column(Boolean, nullable=True)  # whether FPS < threshold
    created_at = Column(DateTime, default=datetime.utcnow)


class GameConfig(Base):
    """Per-game config for universal tester. window_title and process_names override config.py when agent fetches by game_key.
    Phase 1: genre (reward_preset), control_type (ppo/dqn), model_path (optional)."""
    __tablename__ = "game_configs"

    game_key = Column(String(64), primary_key=True)  # e.g. "nfs_rivals", "my_game"
    display_name = Column(String(128), nullable=False)  # e.g. "NFS Rivals"
    window_title = Column(String(256), nullable=False, default="")  # partial match for capture
    process_names = Column(Text, nullable=False, default="[]")  # JSON array of strings, e.g. ["Game.exe", "Game (32 bit)"]
    # Phase 1: per-game RL and profile
    genre = Column(String(64), nullable=False, default="racing")  # racing, open_world, minimal (reward/bug profile)
    control_type = Column(String(32), nullable=False, default="ppo")  # ppo, dqn
    model_path = Column(String(512), nullable=True, default=None)  # optional; if empty, use agents/models/<game_key>/model_ppo.zip etc.
    # Per-game key bindings: JSON dict e.g. {"accel":"up","brake":"down","left":"left","right":"right"}. Null/empty = use default (arrows).
    key_bindings = Column(Text, nullable=True, default=None)
    # Mouse automation: none | menus_only | gameplay (camera)
    mouse_mode = Column(String(32), nullable=False, default="none")
    mouse_sensitivity = Column(Integer, nullable=True, default=None)  # pixels per look step when gameplay
    menu_click_positions = Column(Text, nullable=True, default=None)  # JSON e.g. {"start":[0.5,0.4],"continue":[0.5,0.5]}
    # Universal Vision: Minimap ROI and marker template
    minimap_left = Column(Integer, nullable=True, default=200)
    minimap_bottom = Column(Integer, nullable=True, default=150)
    minimap_size = Column(Integer, nullable=True, default=200)
    marker_template_path = Column(String(512), nullable=True, default=None)
    auto_detect_minimap = Column(Boolean, nullable=False, default=True)


engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Add new columns if they don't exist (migration for existing DBs)
    async with engine.begin() as conn:
        from sqlalchemy import text
        for col, spec in [
            ("severity", "VARCHAR(32)"), 
            ("trace_filename", "VARCHAR(256)"), 
            ("game_key", "VARCHAR(64)"),
            ("fps_at_bug", "FLOAT"),
            ("pc_was_struggling", "BOOLEAN")
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE bug_reports ADD COLUMN {col} {spec}"))
            except Exception:
                pass  # column already exists
        # Phase 1: game_configs new columns
        for col, spec in [("genre", "VARCHAR(64)"), ("control_type", "VARCHAR(32)"), ("model_path", "VARCHAR(512)"), ("key_bindings", "TEXT")]:
            try:
                await conn.execute(text(f"ALTER TABLE game_configs ADD COLUMN {col} {spec}"))
            except Exception:
                pass  # column already exists
        # Phase 2: mouse automation
        for col, spec in [("mouse_mode", "VARCHAR(32)"), ("mouse_sensitivity", "INTEGER"), ("menu_click_positions", "TEXT")]:
            try:
                await conn.execute(text(f"ALTER TABLE game_configs ADD COLUMN {col} {spec}"))
            except Exception:
                pass  # column already exists
        # Phase 3: Universal Vision
        for col, spec in [
            ("minimap_left", "INTEGER"), 
            ("minimap_bottom", "INTEGER"), 
            ("minimap_size", "INTEGER"),
            ("marker_template_path", "VARCHAR(512)"),
            ("auto_detect_minimap", "BOOLEAN DEFAULT 1")
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE game_configs ADD COLUMN {col} {spec}"))
            except Exception:
                pass  # column already exists
    # Seed default nfs_rivals game config if none exist
    async with async_session() as session:
        from sqlalchemy import select
        r = await session.execute(select(GameConfig).limit(1))
        if r.scalar_one_or_none() is None:
            session.add(GameConfig(
                game_key="nfs_rivals",
                display_name="NFS Rivals",
                window_title="Need for Speed™ Rivals",
                process_names='["Need for Speed™ Rivals (32 bit)", "NFSRivals.exe"]',
                genre="racing",
                control_type="ppo",
                model_path=None,
            ))
            await session.commit()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
