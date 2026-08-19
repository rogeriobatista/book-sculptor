from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings

settings = get_settings()

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    Path(".data").mkdir(exist_ok=True)

engine = create_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=not settings.database_url.startswith("sqlite"),
    connect_args=connect_args,
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _ensure_book_cover_columns()


def _ensure_book_cover_columns() -> None:
    """Add cover columns on existing DBs (create_all does not alter tables)."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "books" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("books")}
    additions = {
        "cover_key": "VARCHAR",
        "cover_url": "VARCHAR",
        "cover_source": "VARCHAR",
        "cover_prompt": "TEXT",
    }
    missing = [name for name in additions if name not in existing]
    if not missing:
        return
    dialect = engine.dialect.name
    with engine.begin() as conn:
        for name in missing:
            col_type = additions[name]
            if dialect == "sqlite":
                conn.execute(text(f"ALTER TABLE books ADD COLUMN {name} {col_type}"))
            else:
                conn.execute(text(f"ALTER TABLE books ADD COLUMN IF NOT EXISTS {name} {col_type}"))


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
