from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.routers import ai, billing, books, chapters, collaboration, exports, files, marketplace, me, members

settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0")
_cors_kwargs: dict = {
    "allow_origins": settings.cors_origins or ["*"],
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.cors_origin_regex:
    _cors_kwargs["allow_origin_regex"] = settings.cors_origin_regex
app.add_middleware(CORSMiddleware, **_cors_kwargs)

app.include_router(me.router, prefix="/api/v1")
app.include_router(books.router, prefix="/api/v1")
app.include_router(chapters.router, prefix="/api/v1")
app.include_router(exports.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(collaboration.router, prefix="/api/v1")
app.include_router(marketplace.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "book-sculptor-api",
        "lan_host": settings.lan_host or None,
        "allow_lan": settings.api_allow_lan,
    }


@app.get("/")
def root() -> dict:
    return {
        "name": settings.app_name,
        "docs": "/docs",
        "health": "/health",
    }


def run() -> None:
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)


if __name__ == "__main__":
    run()
