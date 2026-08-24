from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.auth import CurrentUser
from app.db import get_session
from app.services.social_oauth import (
    SUPPORTED_PLATFORMS,
    account_out,
    dev_connect_account,
    exchange_oauth_code,
    list_user_accounts,
    oauth_dev_mode,
    oauth_start_url,
    parse_oauth_state,
    platform_oauth_configured,
    upsert_social_account,
)
from app.db_models import SocialAccount

router = APIRouter(prefix="/social", tags=["social"])


class DevConnectBody(BaseModel):
    platform: str
    account_label: str = Field(default="", max_length=120)


@router.get("/accounts")
def get_social_accounts(
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    rows = list_user_accounts(session, user.id)
    return [account_out(row) for row in rows]


@router.post("/accounts/dev-connect")
def dev_connect(
    body: DevConnectBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    if not oauth_dev_mode():
        raise HTTPException(403, "Dev connect is disabled.")
    row = dev_connect_account(
        session,
        user_id=user.id,
        platform=body.platform,
        account_label=body.account_label or None,
    )
    return account_out(row)


@router.delete("/accounts/{account_id}")
def disconnect_account(
    account_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(SocialAccount, account_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Account not found.")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.get("/oauth/{platform}/start")
def oauth_start(
    platform: str,
    user: CurrentUser,
    return_url: str = "/en/books",
) -> dict:
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, "Unsupported platform.")
    if oauth_dev_mode() and not platform_oauth_configured(platform):
        return {
            "authorize_url": None,
            "platform": platform,
            "dev_mode": True,
        }
    url, _meta = oauth_start_url(platform, user_id=user.id, return_url=return_url)
    return {
        "authorize_url": url,
        "platform": platform,
        "dev_mode": False,
    }


@router.get("/oauth/callback")
def oauth_callback(
    code: str = "",
    state: str = "",
    error: str = "",
    session: Session = Depends(get_session),
) -> RedirectResponse:
    payload = parse_oauth_state(state)
    return_url = str(payload.get("return_url") or "/en/books")
    platform = str(payload.get("platform") or "")
    user_id = str(payload.get("uid") or "")

    if error:
        sep = "&" if "?" in return_url else "?"
        return RedirectResponse(
            f"{return_url}{sep}social_oauth=error&platform={quote(platform)}"
        )

    if not code or not user_id or platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, "Invalid OAuth callback.")

    token_data = exchange_oauth_code(
        platform,
        code=code,
        code_verifier=str(payload.get("cv") or "") or None,
    )
    upsert_social_account(
        session,
        user_id=user_id,
        platform=platform,
        account_label=str(token_data.get("account_label") or platform),
        external_id=str(token_data.get("external_id") or ""),
        access_token=str(token_data.get("access_token") or ""),
        refresh_token=str(token_data.get("refresh_token") or ""),
        expires_in=token_data.get("expires_in"),
    )

    sep = "&" if "?" in return_url else "?"
    return RedirectResponse(
        f"{return_url}{sep}social_oauth=connected&platform={quote(platform)}"
    )
