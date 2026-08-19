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


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
