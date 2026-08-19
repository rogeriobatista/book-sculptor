from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient
from sqlmodel import Session, select

from app.config import get_settings
from app.db import get_session
from app.db_models import User
from app.i18n_labels import normalize_locale

_jwks_client: PyJWKClient | None = None


@dataclass
class AuthUser:
    clerk_id: str
    email: str
    ui_locale: str


def _settings():
    return get_settings()


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    settings = _settings()
    if _jwks_client is None:
        if not settings.clerk_jwks_url:
            raise HTTPException(503, "Clerk JWKS URL not configured.")
        _jwks_client = PyJWKClient(settings.clerk_jwks_url)
    return _jwks_client


def _parse_bearer(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token.")
    return header.removeprefix("Bearer ").strip()


def _email_from_clerk_api(clerk_id: str) -> str:
    settings = _settings()
    if not settings.clerk_secret_key or not clerk_id:
        return ""
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"https://api.clerk.com/v1/users/{clerk_id}",
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            )
            if response.status_code != 200:
                return ""
            data = response.json()
        primary = data.get("primary_email_address_id")
        for item in data.get("email_addresses") or []:
            if item.get("id") == primary or not primary:
                return (item.get("email_address") or "").strip()
        return ""
    except Exception:  # noqa: BLE001
        return ""


def decode_token(token: str) -> AuthUser:
    settings = _settings()
    if settings.auth_dev_bypass and token.startswith("dev:"):
        parts = token.split(":", 2)
        if len(parts) < 2 or not parts[1]:
            raise HTTPException(401, "Invalid dev token.")
        clerk_id = parts[1]
        email = parts[2] if len(parts) > 2 else f"{clerk_id}@dev.local"
        return AuthUser(clerk_id=clerk_id, email=email, ui_locale="en")

    if not settings.clerk_issuer:
        raise HTTPException(503, "Clerk issuer not configured.")

    try:
        key = _get_jwks_client().get_signing_key_from_jwt(token)
        options = {
            "verify_aud": bool(settings.clerk_audience),
            # Clerk session JWTs can be a few seconds skewed vs local clock.
            "verify_iat": True,
        }
        payload = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer.rstrip("/"),
            audience=settings.clerk_audience or None,
            options=options,
            leeway=60,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(401, f"Invalid token ({type(exc).__name__}).") from exc

    clerk_id = payload.get("sub")
    if not clerk_id:
        raise HTTPException(401, "Invalid token subject.")

    email = (
        payload.get("email")
        or payload.get("primary_email_address")
        or ""
    )
    if not email:
        email = _email_from_clerk_api(clerk_id)

    locale = normalize_locale(payload.get("locale") or "en")
    return AuthUser(clerk_id=clerk_id, email=email, ui_locale=locale)


def ensure_user(session: Session, auth: AuthUser) -> User:
    user = session.exec(select(User).where(User.clerk_id == auth.clerk_id)).first()
    if user:
        changed = False
        if auth.email and user.email != auth.email:
            user.email = auth.email
            changed = True
        if changed:
            session.add(user)
            session.commit()
            session.refresh(user)
        return user

    user = User(
        clerk_id=auth.clerk_id,
        email=auth.email or "",
        ui_locale=auth.ui_locale,
        plan="free",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_current_user(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> User:
    token = _parse_bearer(request)
    auth = decode_token(token)
    return ensure_user(session, auth)


CurrentUser = Annotated[User, Depends(get_current_user)]
