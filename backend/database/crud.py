"""CRUD operations for bug reports."""
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import BugReport, GameConfig


def _game_filter(game_key: Optional[str]):
    """Normalize game_key for filtering: None or 'nfs_rivals' includes legacy (NULL) rows."""
    if not game_key or game_key == "nfs_rivals":
        return (BugReport.game_key == None) | (BugReport.game_key == "nfs_rivals")
    return BugReport.game_key == game_key


async def create_bug_report(
    session: AsyncSession,
    bug_type: str,
    timestamp: float,
    screenshot_b64: Optional[str] = None,
    severity: Optional[str] = None,
    trace_filename: Optional[str] = None,
    game_key: Optional[str] = None,
    fps_at_bug: Optional[float] = None,
    pc_was_struggling: Optional[bool] = None,
) -> BugReport:
    """Log a bug. screenshot_b64 is the raw PNG data string.

    NOTE:
    - Older builds treated missing game_key as "nfs_rivals" and also stored
      legacy rows with NULL game_key.
    - We still treat NULL as nfs_rivals in _game_filter for backwards
      compatibility, but new bug rows should always use the explicit game_key
      provided by the agent/dashboard (or remain NULL only if the caller truly
      does not support per‑game routing).
    """
    report = BugReport(
        game_key=game_key or None,
        type=bug_type,
        timestamp=timestamp,
        screenshot_b64=screenshot_b64,
        severity=severity,
        trace_filename=trace_filename,
        fps_at_bug=fps_at_bug,
        pc_was_struggling=pc_was_struggling,
    )
    session.add(report)
    await session.flush()
    await session.refresh(report)
    return report


async def get_all_bugs(
    session: AsyncSession,
    limit: int = 200,
    offset: int = 0,
    game_key: Optional[str] = None,
) -> List[BugReport]:
    q = select(BugReport)
    if game_key is not None:
        q = q.where(_game_filter(game_key))
    result = await session.execute(q.order_by(BugReport.timestamp.desc()).limit(limit).offset(offset))
    return list(result.scalars().all())


async def get_bugs_since(
    session: AsyncSession,
    since_ts: float,
    limit: int = 200,
    offset: int = 0,
    game_key: Optional[str] = None,
) -> List[BugReport]:
    """Bugs with timestamp >= since_ts (for current-session view)."""
    q = select(BugReport).where(BugReport.timestamp >= since_ts)
    if game_key is not None:
        q = q.where(_game_filter(game_key))
    result = await session.execute(q.order_by(BugReport.timestamp.desc()).limit(limit).offset(offset))
    return list(result.scalars().all())


async def get_session_stats(session: AsyncSession, game_key: Optional[str] = None) -> dict:
    """Total bugs and bugs in last 24h for dashboard summary."""
    q_total = select(func.count(BugReport.id))
    if game_key is not None:
        q_total = q_total.where(_game_filter(game_key))
    total = await session.execute(q_total)
    total_count = total.scalar() or 0
    since_ts = (datetime.utcnow() - timedelta(hours=24)).timestamp()
    q_recent = select(func.count(BugReport.id)).where(BugReport.timestamp >= since_ts)
    if game_key is not None:
        q_recent = q_recent.where(_game_filter(game_key))
    recent = await session.execute(q_recent)
    recent_count = recent.scalar() or 0
    return {"total_bugs": total_count, "bugs_last_24h": recent_count}


async def get_sessions_grouped_by_day(
    session: AsyncSession, game_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Group bug_reports by date (day); one session per day. Returns list of { date, start_ts, end_ts, bug_count, bug_ids }."""
    # SQLite: date(timestamp, 'unixepoch') gives YYYY-MM-DD. Legacy NULL game_key treated as nfs_rivals.
    if game_key is None or game_key == "nfs_rivals":
        where = "WHERE (game_key IS NULL OR game_key = 'nfs_rivals')"
    else:
        where = "WHERE game_key = :game_key"
    stmt = text(f"""
        SELECT date(timestamp, 'unixepoch') AS day,
               min(timestamp) AS start_ts,
               max(timestamp) AS end_ts,
               count(*) AS bug_count,
               group_concat(id) AS bug_ids_str
        FROM bug_reports
        {where}
        GROUP BY day
        ORDER BY day DESC
    """)
    if game_key is None or game_key == "nfs_rivals":
        result = await session.execute(stmt)
    else:
        result = await session.execute(stmt, {"game_key": game_key})
    rows = result.fetchall()
    out = []
    for row in rows:
        bug_ids_str = row.bug_ids_str or ""
        bug_ids = [int(x.strip()) for x in bug_ids_str.split(",") if x.strip()]
        out.append({
            "date": row.day,
            "start_ts": row.start_ts,
            "end_ts": row.end_ts,
            "bug_count": row.bug_count,
            "bug_ids": bug_ids,
        })
    return out


async def get_bugs_by_ids(session: AsyncSession, ids: List[int]) -> List[BugReport]:
    """Return BugReport rows with id in ids, order by timestamp desc."""
    if not ids:
        return []
    result = await session.execute(
        select(BugReport).where(BugReport.id.in_(ids)).order_by(BugReport.timestamp.desc())
    )
    return list(result.scalars().all())


async def get_distinct_game_keys(session: AsyncSession) -> List[str]:
    """Return distinct game_key values; always include 'nfs_rivals' for default/legacy."""
    result = await session.execute(
        select(BugReport.game_key).distinct().where(BugReport.game_key.isnot(None))
    )
    keys = [r[0] for r in result.fetchall() if r[0]]
    if "nfs_rivals" not in keys:
        keys = ["nfs_rivals"] + keys
    return keys if keys else ["nfs_rivals"]


async def get_all_game_keys_merged(session: AsyncSession) -> List[str]:
    """Union of distinct bug_reports.game_key and game_configs.game_key; always include nfs_rivals."""
    from_bugs = await get_distinct_game_keys(session)
    result = await session.execute(select(GameConfig.game_key))
    from_configs = [r[0] for r in result.fetchall() if r[0]]
    merged = list(dict.fromkeys(from_bugs + from_configs))
    if "nfs_rivals" not in merged:
        merged = ["nfs_rivals"] + merged
    return merged


# --- GameConfig (Phase 2: per-game config) ---

async def list_game_configs(session: AsyncSession) -> List[GameConfig]:
    """List all game configs ordered by game_key."""
    result = await session.execute(select(GameConfig).order_by(GameConfig.game_key))
    return list(result.scalars().all())


async def get_game_config(session: AsyncSession, game_key: str) -> Optional[GameConfig]:
    """Get one game config by game_key."""
    result = await session.execute(select(GameConfig).where(GameConfig.game_key == game_key))
    return result.scalar_one_or_none()


def _serialize_key_bindings(obj: Optional[Dict[str, str]]) -> Optional[str]:
    """Serialize key_bindings dict to JSON string; None or empty dict -> None."""
    if not obj or not isinstance(obj, dict):
        return None
    cleaned = {k: str(v).strip() for k, v in obj.items() if v and str(v).strip()}
    return json.dumps(cleaned) if cleaned else None


async def create_game_config(
    session: AsyncSession,
    game_key: str,
    display_name: str,
    window_title: str = "",
    process_names: str = "[]",
    genre: str = "racing",
    control_type: str = "ppo",
    model_path: Optional[str] = None,
    key_bindings: Optional[Dict[str, str]] = None,
    mouse_mode: str = "none",
    mouse_sensitivity: Optional[int] = None,
    menu_click_positions: Optional[str] = None,
    minimap_left: int = 200,
    minimap_bottom: int = 150,
    minimap_size: int = 200,
    marker_template_path: Optional[str] = None,
    auto_detect_minimap: bool = True,
) -> GameConfig:
    """Create a game config. process_names must be JSON array string. menu_click_positions: JSON string."""
    cfg = GameConfig(
        game_key=game_key.strip(),
        display_name=display_name.strip(),
        window_title=(window_title or "").strip(),
        process_names=process_names.strip() or "[]",
        genre=(genre or "racing").strip(),
        control_type=(control_type or "ppo").strip(),
        model_path=(model_path or "").strip() or None,
        key_bindings=_serialize_key_bindings(key_bindings),
        mouse_mode=(mouse_mode or "none").strip() or "none",
        mouse_sensitivity=mouse_sensitivity,
        menu_click_positions=(menu_click_positions or "").strip() or None,
        minimap_left=minimap_left,
        minimap_bottom=minimap_bottom,
        minimap_size=minimap_size,
        marker_template_path=marker_template_path,
        auto_detect_minimap=auto_detect_minimap,
    )
    session.add(cfg)
    await session.flush()
    await session.refresh(cfg)
    return cfg


async def update_game_config(
    session: AsyncSession,
    game_key: str,
    display_name: Optional[str] = None,
    window_title: Optional[str] = None,
    process_names: Optional[str] = None,
    genre: Optional[str] = None,
    control_type: Optional[str] = None,
    model_path: Optional[str] = None,
    key_bindings: Optional[Dict[str, str]] = None,
    mouse_mode: Optional[str] = None,
    mouse_sensitivity: Optional[int] = None,
    menu_click_positions: Optional[str] = None,
    minimap_left: Optional[int] = None,
    minimap_bottom: Optional[int] = None,
    minimap_size: Optional[int] = None,
    marker_template_path: Optional[str] = None,
    auto_detect_minimap: Optional[bool] = None,
) -> Optional[GameConfig]:
    """Update a game config. Returns None if not found."""
    cfg = await get_game_config(session, game_key)
    if not cfg:
        return None
    if display_name is not None:
        cfg.display_name = display_name.strip()
    if window_title is not None:
        cfg.window_title = window_title.strip()
    if process_names is not None:
        cfg.process_names = process_names.strip() or "[]"
    if genre is not None:
        cfg.genre = genre.strip() or "racing"
    if control_type is not None:
        cfg.control_type = control_type.strip() or "ppo"
    if model_path is not None:
        cfg.model_path = (model_path.strip() or None) if model_path else None
    if key_bindings is not None:
        cfg.key_bindings = _serialize_key_bindings(key_bindings)
    if mouse_mode is not None:
        cfg.mouse_mode = (mouse_mode.strip() or "none") or "none"
    if mouse_sensitivity is not None:
        cfg.mouse_sensitivity = mouse_sensitivity
    if menu_click_positions is not None:
        cfg.menu_click_positions = (menu_click_positions.strip() or None) if menu_click_positions else None
    if minimap_left is not None:
        cfg.minimap_left = minimap_left
    if minimap_bottom is not None:
        cfg.minimap_bottom = minimap_bottom
    if minimap_size is not None:
        cfg.minimap_size = minimap_size
    if marker_template_path is not None:
        cfg.marker_template_path = marker_template_path
    if auto_detect_minimap is not None:
        cfg.auto_detect_minimap = auto_detect_minimap
    await session.flush()
    await session.refresh(cfg)
    return cfg
