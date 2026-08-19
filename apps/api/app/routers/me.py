from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlmodel import Session, select

from app.auth import CurrentUser
from app.db import get_session
from app.db_models import Subscription
from app.i18n_labels import normalize_locale
from app.schemas import UserOut, UserUpdate
from fastapi import Depends

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
def get_me(user: CurrentUser) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        ui_locale=normalize_locale(user.ui_locale),  # type: ignore[arg-type]
        plan=user.plan,  # type: ignore[arg-type]
    )


@router.patch("", response_model=UserOut)
def update_me(
    body: UserUpdate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> UserOut:
    if body.ui_locale:
        user.ui_locale = normalize_locale(body.ui_locale)
        user.updated_at = datetime.now(timezone.utc)
        session.add(user)
        session.commit()
        session.refresh(user)
    return get_me(user)


@router.get("/subscription")
def get_subscription(
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    sub = session.exec(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    ).first()
    return {
        "plan": user.plan,
        "subscription": (
            {
                "status": sub.status,
                "stripe_subscription_id": sub.stripe_subscription_id,
                "stripe_price_id": sub.stripe_price_id,
                "current_period_end": sub.current_period_end,
            }
            if sub
            else None
        ),
    }
