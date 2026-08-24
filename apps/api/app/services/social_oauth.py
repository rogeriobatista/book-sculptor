"""OAuth helpers for social platform connections."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import get_settings
from app.db_models import SocialAccount

settings = get_settings()

SUPPORTED_PLATFORMS = frozenset(
    {"instagram", "facebook", "x", "threads", "tiktok", "linkedin"}
)

# Platforms with real OAuth when credentials are configured
OAUTH_PLATFORMS = frozenset({"x", "facebook", "instagram", "linkedin"})


def oauth_dev_mode() -> bool:
    return settings.social_oauth_dev_mode or settings.environment == "development"


def platform_oauth_configured(platform: str) -> bool:
    if platform in {"x", "threads"}:
        return bool(settings.twitter_client_id and settings.twitter_client_secret)
    if platform in {"facebook", "instagram"}:
        return bool(settings.meta_app_id and settings.meta_app_secret)
    if platform == "linkedin":
        return bool(settings.linkedin_client_id and settings.linkedin_client_secret)
    return False


def _sign_state(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(
        settings.social_oauth_secret.encode(),
        raw,
        hashlib.sha256,
    ).hexdigest()
    blob = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return f"{blob}.{sig}"


def _verify_state(token: str, max_age_seconds: int = 900) -> dict[str, Any]:
    try:
        blob, sig = token.rsplit(".", 1)
        pad = "=" * (-len(blob) % 4)
        raw = base64.urlsafe_b64decode(blob + pad)
        expected = hmac.new(
            settings.social_oauth_secret.encode(),
            raw,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ValueError("bad signature")
        payload = json.loads(raw.decode())
        issued = int(payload.get("iat", 0))
        if time.time() - issued > max_age_seconds:
            raise ValueError("expired")
        return payload
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "Invalid OAuth state.") from exc


def build_oauth_state(
    *,
    user_id: str,
    platform: str,
    return_url: str,
    code_verifier: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "uid": user_id,
        "platform": platform,
        "return_url": return_url[:500],
        "iat": int(time.time()),
        "nonce": secrets.token_hex(8),
    }
    if code_verifier:
        payload["cv"] = code_verifier
    return _sign_state(payload)


def parse_oauth_state(state: str) -> dict[str, Any]:
    return _verify_state(state)


def _redirect_uri() -> str:
    return f"{settings.api_public_url.rstrip('/')}/api/v1/social/oauth/callback"


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode().rstrip("=")
    return verifier, challenge


def oauth_start_url(platform: str, *, user_id: str, return_url: str) -> tuple[str, dict[str, str]]:
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, "Unsupported platform.")
    if oauth_dev_mode() and not platform_oauth_configured(platform):
        raise HTTPException(
            400,
            "Use dev connect endpoint when OAuth credentials are not configured.",
        )
    if not platform_oauth_configured(platform):
        raise HTTPException(503, f"OAuth not configured for {platform}.")

    redirect = _redirect_uri()
    meta: dict[str, str] = {}

    if platform in {"x", "threads"}:
        verifier, challenge = _pkce_pair()
        state = build_oauth_state(
            user_id=user_id,
            platform=platform,
            return_url=return_url,
            code_verifier=verifier,
        )
        meta["state"] = state
        params = {
            "response_type": "code",
            "client_id": settings.twitter_client_id,
            "redirect_uri": redirect,
            "scope": "tweet.read tweet.write users.read offline.access",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return f"https://twitter.com/i/oauth2/authorize?{urlencode(params)}", meta

    state = build_oauth_state(user_id=user_id, platform=platform, return_url=return_url)
    meta["state"] = state

    if platform in {"facebook", "instagram"}:
        scopes = "pages_manage_posts,pages_read_engagement,pages_show_list"
        if platform == "instagram":
            scopes += ",instagram_basic,instagram_content_publish"
        params = {
            "client_id": settings.meta_app_id,
            "redirect_uri": redirect,
            "state": state,
            "scope": scopes,
            "response_type": "code",
        }
        return f"https://www.facebook.com/v19.0/dialog/oauth?{urlencode(params)}", meta

    if platform == "linkedin":
        params = {
            "response_type": "code",
            "client_id": settings.linkedin_client_id,
            "redirect_uri": redirect,
            "state": state,
            "scope": "w_member_social openid profile email",
        }
        return f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}", meta

    raise HTTPException(400, "Platform OAuth not available.")


def exchange_oauth_code(
    platform: str,
    *,
    code: str,
    code_verifier: str | None = None,
) -> dict[str, Any]:
    redirect = _redirect_uri()
    if platform in {"x", "threads"}:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect,
            "client_id": settings.twitter_client_id,
            "code_verifier": code_verifier or "",
        }
        auth = (settings.twitter_client_id, settings.twitter_client_secret)
        token_url = "https://api.twitter.com/2/oauth2/token"
        with httpx.Client(timeout=30) as client:
            resp = client.post(token_url, data=data, auth=auth)
            resp.raise_for_status()
            token = resp.json()
        return {
            "access_token": token.get("access_token", ""),
            "refresh_token": token.get("refresh_token", ""),
            "expires_in": token.get("expires_in"),
            "external_id": "",
            "account_label": "X account",
        }

    if platform in {"facebook", "instagram"}:
        with httpx.Client(timeout=30) as client:
            token_resp = client.get(
                "https://graph.facebook.com/v19.0/oauth/access_token",
                params={
                    "client_id": settings.meta_app_id,
                    "client_secret": settings.meta_app_secret,
                    "redirect_uri": redirect,
                    "code": code,
                },
            )
            token_resp.raise_for_status()
            token = token_resp.json()
        return {
            "access_token": token.get("access_token", ""),
            "refresh_token": "",
            "expires_in": token.get("expires_in"),
            "external_id": "",
            "account_label": "Meta account",
        }

    if platform == "linkedin":
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect,
            "client_id": settings.linkedin_client_id,
            "client_secret": settings.linkedin_client_secret,
        }
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                "https://www.linkedin.com/oauth/v2/accessToken",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            token = resp.json()
        return {
            "access_token": token.get("access_token", ""),
            "refresh_token": token.get("refresh_token", ""),
            "expires_in": token.get("expires_in"),
            "external_id": "",
            "account_label": "LinkedIn account",
        }

    raise HTTPException(400, "Unsupported platform.")


def upsert_social_account(
    session: Session,
    *,
    user_id: str,
    platform: str,
    account_label: str,
    external_id: str,
    access_token: str,
    refresh_token: str = "",
    expires_in: int | None = None,
    meta: dict[str, Any] | None = None,
) -> SocialAccount:
    expires_at = None
    if expires_in:
        expires_at = datetime.now(timezone.utc).replace(microsecond=0)
        from datetime import timedelta

        expires_at = expires_at + timedelta(seconds=int(expires_in))

    row = session.exec(
        select(SocialAccount).where(
            SocialAccount.user_id == user_id,
            SocialAccount.platform == platform,
        )
    ).first()
    if not row:
        row = SocialAccount(user_id=user_id, platform=platform)
    row.account_label = account_label[:120] or platform
    row.external_id = external_id[:200]
    row.access_token = access_token
    row.refresh_token = refresh_token
    row.token_expires_at = expires_at
    row.status = "connected"
    row.meta_json = meta or {}
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def dev_connect_account(
    session: Session,
    *,
    user_id: str,
    platform: str,
    account_label: str | None = None,
) -> SocialAccount:
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, "Unsupported platform.")
    label = (account_label or f"Dev {platform}").strip()
    token = f"dev:{platform}:{secrets.token_hex(12)}"
    return upsert_social_account(
        session,
        user_id=user_id,
        platform=platform,
        account_label=label,
        external_id=f"dev-{platform}",
        access_token=token,
        refresh_token="",
        meta={"dev": True},
    )


def list_user_accounts(session: Session, user_id: str) -> list[SocialAccount]:
    return list(
        session.exec(
            select(SocialAccount)
            .where(SocialAccount.user_id == user_id)
            .order_by(SocialAccount.platform.asc())
        ).all()
    )


def account_out(row: SocialAccount) -> dict[str, Any]:
    return {
        "id": row.id,
        "platform": row.platform,
        "account_label": row.account_label,
        "status": row.status,
        "connected": row.status == "connected",
        "dev": bool((row.meta_json or {}).get("dev")),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
