from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.access import assert_can_edit, get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import PublicationSocialAsset
from app.services.publication_profile import (
    PublicationProfile,
    SocialIntegration,
    merge_publication_into_settings,
    parse_publication_profile,
    publication_profile_from_book,
)
from app.services.publication_service import run_publication_generate
from app.services.social_art_service import (
    delete_social_asset,
    generate_social_assets,
    list_social_assets,
)
from app.services.social_oauth import list_user_accounts, oauth_dev_mode, platform_oauth_configured
from app.services.social_publish import (
    _job_out,
    cancel_publish_job,
    create_publish_job,
    list_publish_jobs,
    process_due_jobs,
    process_publish_job,
)
from typing import Literal

router = APIRouter(prefix="/books", tags=["publication"])


class PublicationPatch(BaseModel):
    synopsis: str | None = None
    short_description: str | None = None
    back_cover: str | None = None
    keywords: str | None = None
    categories: str | None = None
    social_posts: list[dict] | None = None
    social_integrations: list[dict] | None = None
    store_targets: list[dict] | None = None


class PublicationGenerateBody(BaseModel):
    kind: Literal["synopsis", "back_cover", "social_posts", "keywords"]
    hint: str = Field(default="", max_length=500)


class SocialArtGenerateBody(BaseModel):
    formats: list[str] = Field(min_length=1)
    quote: str = Field(default="", max_length=500)
    include_title: bool = True


class PublishQueueCreate(BaseModel):
    platform: str
    post_text: str = Field(min_length=1, max_length=2000)
    social_asset_id: str | None = None
    scheduled_at: datetime | None = None
    publish_now: bool = False


def _merge_profile_with_accounts(
    session: Session,
    user_id: str,
    profile: PublicationProfile,
) -> PublicationProfile:
    accounts = {row.platform: row for row in list_user_accounts(session, user_id)}
    integrations: list[SocialIntegration] = []
    for item in profile.social_integrations:
        acc = accounts.get(item.platform)
        status = item.status
        if acc and acc.status == "connected":
            status = "connected"
        elif item.platform in {"tiktok", "threads"} and not platform_oauth_configured(item.platform):
            status = "coming_soon" if not oauth_dev_mode() else status
        integrations.append(
            SocialIntegration(
                platform=item.platform,
                enabled=item.enabled,
                status=status,
                auto_publish=item.auto_publish,
            )
        )
    profile.social_integrations = integrations
    return profile


@router.get("/{book_id}/publication")
def get_publication_profile(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    profile = publication_profile_from_book(book)
    profile = _merge_profile_with_accounts(session, user.id, profile)
    return profile.model_dump()


@router.patch("/{book_id}/publication")
def patch_publication_profile(
    book_id: str,
    body: PublicationPatch,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    current = publication_profile_from_book(book)
    data = current.model_dump()
    patch = body.model_dump(exclude_unset=True)
    data.update(patch)
    profile = parse_publication_profile(data)
    book.settings_json = merge_publication_into_settings(book.settings_json, profile)
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    session.refresh(book)
    profile = publication_profile_from_book(book)
    profile = _merge_profile_with_accounts(session, user.id, profile)
    return profile.model_dump()


@router.post("/{book_id}/publication/generate")
def generate_publication(
    book_id: str,
    body: PublicationGenerateBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    profile = run_publication_generate(
        session,
        user=user,
        book=book,
        kind=body.kind,
        hint=body.hint,
    )
    profile = _merge_profile_with_accounts(session, user.id, profile)
    return profile.model_dump()


@router.get("/{book_id}/publication/social-art")
def get_social_art(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    get_owned_book(session, user, book_id)
    return list_social_assets(session, book_id=book_id)


@router.post("/{book_id}/publication/social-art/generate")
def generate_social_art(
    book_id: str,
    body: SocialArtGenerateBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    rows = generate_social_assets(
        session,
        user=user,
        book=book,
        formats=body.formats,
        quote=body.quote,
        include_title=body.include_title,
    )
    return [
        {
            "id": row.id,
            "format_id": row.format_id,
            "url": row.url,
            "quote_text": row.quote_text,
            "width": row.width,
            "height": row.height,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.delete("/{book_id}/publication/social-art/{asset_id}")
def remove_social_art(
    book_id: str,
    asset_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    delete_social_asset(session, book_id=book_id, asset_id=asset_id, user_id=user.id)
    return {"ok": True}


@router.get("/{book_id}/publication/publish-queue")
def get_publish_queue(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    get_owned_book(session, user, book_id)
    process_due_jobs(session, book_id=book_id, user_id=user.id)
    return list_publish_jobs(session, book_id=book_id, user_id=user.id)


@router.post("/{book_id}/publication/publish-queue")
def schedule_publish(
    book_id: str,
    body: PublishQueueCreate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    scheduled = None if body.publish_now else body.scheduled_at
    job = create_publish_job(
        session,
        book_id=book_id,
        user_id=user.id,
        platform=body.platform,
        post_text=body.post_text,
        social_asset_id=body.social_asset_id,
        scheduled_at=scheduled,
    )
    asset = session.get(PublicationSocialAsset, job.social_asset_id) if job.social_asset_id else None
    return _job_out(job, asset)


@router.post("/{book_id}/publication/publish-queue/{job_id}/publish-now")
def publish_now(
    book_id: str,
    job_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    get_owned_book(session, user, book_id)
    job = process_publish_job(session, job_id)
    if job.user_id != user.id or job.book_id != book_id:
        from fastapi import HTTPException

        raise HTTPException(404, "Publish job not found.")
    asset = session.get(PublicationSocialAsset, job.social_asset_id) if job.social_asset_id else None
    return _job_out(job, asset)


@router.delete("/{book_id}/publication/publish-queue/{job_id}")
def cancel_publish(
    book_id: str,
    job_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    get_owned_book(session, user, book_id)
    job = cancel_publish_job(session, job_id=job_id, user_id=user.id)
    asset = session.get(PublicationSocialAsset, job.social_asset_id) if job.social_asset_id else None
    return _job_out(job, asset)
