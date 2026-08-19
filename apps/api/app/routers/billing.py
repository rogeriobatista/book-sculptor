from __future__ import annotations

from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.db_models import Subscription, User
from app.i18n_labels import normalize_locale, stripe_checkout_locale
from app.schemas import CheckoutBody, CheckoutOut

router = APIRouter(prefix="/billing", tags=["billing"])


def _stripe() -> None:
    settings = get_settings()
    if not settings.stripe_secret_key or settings.stripe_secret_key.startswith("sk_test_..."):
        raise HTTPException(503, "Stripe is not configured.")
    stripe.api_key = settings.stripe_secret_key


def _price_for_plan(plan: str) -> str:
    settings = get_settings()
    if plan == "studio":
        price = settings.stripe_price_studio
    else:
        price = settings.stripe_price_pro
    if not price or price.startswith("price_..."):
        raise HTTPException(
            503,
            f"Stripe price for {plan} is not configured. Set STRIPE_PRICE_{plan.upper()} in apps/api/.env",
        )
    return price


def _plan_from_price(price_id: str | None) -> str:
    settings = get_settings()
    if price_id and price_id == settings.stripe_price_studio:
        return "studio"
    if price_id and price_id == settings.stripe_price_pro:
        return "pro"
    return "pro"


@router.post("/checkout", response_model=CheckoutOut)
def create_checkout(
    body: CheckoutBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> CheckoutOut:
    settings = get_settings()
    _stripe()
    price = _price_for_plan(body.plan)
    locale = stripe_checkout_locale(body.ui_locale or user.ui_locale)

    try:
        if not user.stripe_customer_id:
            customer = stripe.Customer.create(
                email=user.email or None,
                metadata={"user_id": user.id, "clerk_id": user.clerk_id},
            )
            user.stripe_customer_id = customer["id"]
            session.add(user)
            session.commit()
            session.refresh(user)

        success = settings.stripe_success_url.replace(
            "/en/", f"/{normalize_locale(locale)}/"
        )
        cancel = settings.stripe_cancel_url.replace(
            "/en/", f"/{normalize_locale(locale)}/"
        )

        checkout = stripe.checkout.Session.create(
            mode="subscription",
            customer=user.stripe_customer_id,
            line_items=[{"price": price, "quantity": 1}],
            success_url=success,
            cancel_url=cancel,
            locale=locale,
            metadata={"user_id": user.id, "plan": body.plan},
            subscription_data={"metadata": {"user_id": user.id, "plan": body.plan}},
        )
    except stripe.StripeError as exc:
        raise HTTPException(502, f"Stripe error: {exc.user_message or str(exc)}") from exc

    url = checkout["url"] if checkout and checkout["url"] else None
    if not url:
        raise HTTPException(500, "Stripe did not return a checkout URL.")
    return CheckoutOut(url=url)


@router.post("/portal")
def create_portal(
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    settings = get_settings()
    _stripe()
    if not user.stripe_customer_id:
        raise HTTPException(400, "No Stripe customer on this account. Subscribe once first.")
    locale = normalize_locale(user.ui_locale)
    try:
        portal = stripe.billing_portal.Session.create(
            customer=user.stripe_customer_id,
            return_url=settings.stripe_success_url.replace("/en/", f"/{locale}/"),
        )
    except stripe.StripeError as exc:
        raise HTTPException(502, f"Stripe error: {exc.user_message or str(exc)}") from exc
    return {"url": portal["url"]}


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    settings = get_settings()
    _stripe()
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not settings.stripe_webhook_secret or settings.stripe_webhook_secret.startswith("whsec_123"):
        raise HTTPException(503, "Stripe webhook secret not configured.")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.stripe_webhook_secret
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Webhook error: {exc}") from exc

    etype = event["type"]
    data = event["data"]["object"]

    if etype == "checkout.session.completed":
        user_id = (data.get("metadata") or {}).get("user_id")
        customer_id = data.get("customer")
        subscription_id = data.get("subscription")
        plan = (data.get("metadata") or {}).get("plan") or "pro"
        if user_id:
            _upsert_subscription(
                session,
                user_id=user_id,
                customer_id=customer_id,
                subscription_id=subscription_id,
                plan=plan,
                status="active",
            )
    elif etype in {
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        subscription_id = data.get("id")
        status = data.get("status") or "inactive"
        customer_id = data.get("customer")
        price_id = None
        items = (data.get("items") or {}).get("data") or []
        if items:
            price_id = (items[0].get("price") or {}).get("id")
        plan = _plan_from_price(price_id)
        user = session.exec(
            select(User).where(User.stripe_customer_id == customer_id)
        ).first()
        if user:
            if status in {"canceled", "unpaid", "incomplete_expired"}:
                plan = "free"
                status = "inactive"
            _upsert_subscription(
                session,
                user_id=user.id,
                customer_id=customer_id,
                subscription_id=subscription_id,
                plan=plan,
                status="active" if status == "active" else status,
                price_id=price_id,
            )

    return {"received": True}


def _upsert_subscription(
    session: Session,
    *,
    user_id: str,
    customer_id: str | None,
    subscription_id: str | None,
    plan: str,
    status: str,
    price_id: str | None = None,
) -> None:
    user = session.get(User, user_id)
    if not user:
        return
    if customer_id:
        user.stripe_customer_id = customer_id
    user.plan = plan if status == "active" else "free"
    user.updated_at = datetime.now(timezone.utc)
    session.add(user)

    sub = session.exec(
        select(Subscription).where(Subscription.user_id == user_id)
    ).first()
    if not sub:
        sub = Subscription(user_id=user_id)
    sub.stripe_subscription_id = subscription_id
    sub.stripe_price_id = price_id
    sub.status = status
    sub.updated_at = datetime.now(timezone.utc)
    session.add(sub)
    session.commit()
