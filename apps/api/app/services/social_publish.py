"""Publish queued social posts to connected platforms."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlmodel import Session, select

from app.db_models import PublicationSocialAsset, SocialAccount, SocialPublishJob
from app.services.social_oauth import oauth_dev_mode


def _job_out(job: SocialPublishJob, asset: PublicationSocialAsset | None = None) -> dict:
    return {
        "id": job.id,
        "book_id": job.book_id,
        "platform": job.platform,
        "post_text": job.post_text,
        "social_asset_id": job.social_asset_id,
        "asset_url": asset.url if asset else None,
        "scheduled_at": job.scheduled_at,
        "status": job.status,
        "external_post_id": job.external_post_id,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def list_publish_jobs(session: Session, *, book_id: str, user_id: str) -> list[dict]:
    rows = session.exec(
        select(SocialPublishJob)
        .where(SocialPublishJob.book_id == book_id, SocialPublishJob.user_id == user_id)
        .order_by(SocialPublishJob.created_at.desc())
        .limit(50)
    ).all()
    out: list[dict] = []
    for row in rows:
        asset = None
        if row.social_asset_id:
            asset = session.get(PublicationSocialAsset, row.social_asset_id)
        out.append(_job_out(row, asset))
    return out


def create_publish_job(
    session: Session,
    *,
    book_id: str,
    user_id: str,
    platform: str,
    post_text: str,
    social_asset_id: str | None = None,
    scheduled_at: datetime | None = None,
) -> SocialPublishJob:
    text = post_text.strip()
    if not text:
        raise HTTPException(400, "Post text is required.")
    account = session.exec(
        select(SocialAccount).where(
            SocialAccount.user_id == user_id,
            SocialAccount.platform == platform,
            SocialAccount.status == "connected",
        )
    ).first()
    if not account:
        raise HTTPException(400, f"Connect {platform} before scheduling posts.")

    if social_asset_id:
        asset = session.get(PublicationSocialAsset, social_asset_id)
        if not asset or asset.book_id != book_id:
            raise HTTPException(404, "Social asset not found.")

    job = SocialPublishJob(
        book_id=book_id,
        user_id=user_id,
        platform=platform,
        post_text=text[:2000],
        social_asset_id=social_asset_id,
        scheduled_at=scheduled_at,
        status="queued",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    if not scheduled_at or scheduled_at <= datetime.now(timezone.utc):
        job = process_publish_job(session, job.id)

    return job


def process_due_jobs(session: Session, *, book_id: str, user_id: str) -> None:
    now = datetime.now(timezone.utc)
    rows = session.exec(
        select(SocialPublishJob).where(
            SocialPublishJob.book_id == book_id,
            SocialPublishJob.user_id == user_id,
            SocialPublishJob.status == "queued",
        )
    ).all()
    for row in rows:
        if row.scheduled_at and row.scheduled_at > now:
            continue
        process_publish_job(session, row.id)


def process_publish_job(session: Session, job_id: str) -> SocialPublishJob:
    job = session.get(SocialPublishJob, job_id)
    if not job:
        raise HTTPException(404, "Publish job not found.")
    if job.status in {"published", "processing"}:
        return job

    account = session.exec(
        select(SocialAccount).where(
            SocialAccount.user_id == job.user_id,
            SocialAccount.platform == job.platform,
            SocialAccount.status == "connected",
        )
    ).first()
    if not account:
        job.status = "failed"
        job.error = "Account disconnected."
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        session.refresh(job)
        return job

    job.status = "processing"
    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()

    try:
        external_id = _publish_to_platform(account, job.post_text)
        job.status = "published"
        job.external_post_id = external_id
        job.error = None
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)[:500]

    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def cancel_publish_job(session: Session, *, job_id: str, user_id: str) -> SocialPublishJob:
    job = session.get(SocialPublishJob, job_id)
    if not job or job.user_id != user_id:
        raise HTTPException(404, "Publish job not found.")
    if job.status not in {"queued", "failed"}:
        raise HTTPException(400, "Only queued or failed jobs can be canceled.")
    job.status = "canceled"
    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def _publish_to_platform(account: SocialAccount, text: str) -> str:
    token = account.access_token or ""
    meta = account.meta_json or {}
    if token.startswith("dev:") or meta.get("dev") or oauth_dev_mode():
        return f"dev-post-{account.platform}-{int(datetime.now(timezone.utc).timestamp())}"

    if account.platform in {"x", "threads"}:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                "https://api.twitter.com/2/tweets",
                headers=headers,
                json={"text": text[:280]},
            )
            if resp.status_code >= 400:
                raise RuntimeError(resp.text[:300])
            data = resp.json()
        tweet_id = (data.get("data") or {}).get("id", "")
        return str(tweet_id or "posted")

    if account.platform == "linkedin":
        # Minimal text share — production apps need author URN from profile API
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        }
        author = meta.get("author_urn") or "urn:li:person:UNKNOWN"
        payload = {
            "author": author,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text[:3000]},
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                "https://api.linkedin.com/v2/ugcPosts",
                headers=headers,
                json=payload,
            )
            if resp.status_code >= 400:
                raise RuntimeError(resp.text[:300])
            return resp.headers.get("x-restli-id", "posted")

    if account.platform in {"facebook", "instagram"}:
        page_token = meta.get("page_access_token") or token
        page_id = meta.get("page_id") or account.external_id
        if not page_id:
            raise RuntimeError("Facebook Page ID missing. Reconnect with page permissions.")
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"https://graph.facebook.com/v19.0/{page_id}/feed",
                data={"message": text[:5000], "access_token": page_token},
            )
            if resp.status_code >= 400:
                raise RuntimeError(resp.text[:300])
            data = resp.json()
        return str(data.get("id", "posted"))

    raise RuntimeError(f"Publishing not implemented for {account.platform}.")
