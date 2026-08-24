"""Publication / marketing metadata stored in settings_json.publication."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SocialPlatform = Literal["instagram", "facebook", "x", "threads", "tiktok", "linkedin"]
StorePlatform = Literal["kdp", "apple_books", "google_play", "kobo", "direct"]
IntegrationStatus = Literal["disconnected", "connected", "coming_soon"]


class SocialPostDraft(BaseModel):
    platform: SocialPlatform | str = "instagram"
    text: str = ""
    status: Literal["draft", "scheduled", "published"] = "draft"
    scheduled_at: str | None = None


class StoreTarget(BaseModel):
    platform: StorePlatform | str = "kdp"
    status: Literal["not_started", "in_progress", "published"] = "not_started"
    notes: str = ""


class SocialIntegration(BaseModel):
    platform: SocialPlatform | str
    enabled: bool = False
    status: IntegrationStatus | str = "disconnected"
    auto_publish: bool = False


class PublicationProfile(BaseModel):
    synopsis: str = ""
    short_description: str = ""
    back_cover: str = ""
    keywords: str = ""
    categories: str = ""
    social_posts: list[SocialPostDraft] = Field(default_factory=list)
    social_integrations: list[SocialIntegration] = Field(default_factory=list)
    store_targets: list[StoreTarget] = Field(default_factory=list)

    def model_post_init(self, __context: Any) -> None:
        if not self.social_integrations:
            self.social_integrations = default_social_integrations()
        if not self.store_targets:
            self.store_targets = default_store_targets()


def default_social_integrations() -> list[SocialIntegration]:
    platforms: list[SocialPlatform] = [
        "instagram",
        "facebook",
        "x",
        "threads",
        "tiktok",
        "linkedin",
    ]
    return [
        SocialIntegration(platform=p, status="coming_soon", enabled=False, auto_publish=False)
        for p in platforms
    ]


def default_store_targets() -> list[StoreTarget]:
    platforms: list[StorePlatform] = [
        "kdp",
        "apple_books",
        "google_play",
        "kobo",
        "direct",
    ]
    return [StoreTarget(platform=p) for p in platforms]


def parse_publication_profile(raw: Any) -> PublicationProfile:
    if not isinstance(raw, dict):
        return PublicationProfile()
    posts_raw = raw.get("social_posts") or []
    posts: list[SocialPostDraft] = []
    if isinstance(posts_raw, list):
        for item in posts_raw:
            if isinstance(item, dict):
                posts.append(SocialPostDraft(**item))

    integrations_raw = raw.get("social_integrations") or []
    integrations: list[SocialIntegration] = []
    if isinstance(integrations_raw, list):
        for item in integrations_raw:
            if isinstance(item, dict):
                integrations.append(SocialIntegration(**item))

    stores_raw = raw.get("store_targets") or []
    stores: list[StoreTarget] = []
    if isinstance(stores_raw, list):
        for item in stores_raw:
            if isinstance(item, dict):
                stores.append(StoreTarget(**item))

    profile = PublicationProfile(
        synopsis=str(raw.get("synopsis") or "").strip()[:8000],
        short_description=str(raw.get("short_description") or "").strip()[:500],
        back_cover=str(raw.get("back_cover") or "").strip()[:8000],
        keywords=str(raw.get("keywords") or "").strip()[:500],
        categories=str(raw.get("categories") or "").strip()[:500],
        social_posts=posts[:20],
        social_integrations=integrations or default_social_integrations(),
        store_targets=stores or default_store_targets(),
    )
    return profile


def publication_profile_from_book(book) -> PublicationProfile:
    settings = book.settings_json if hasattr(book, "settings_json") else {}
    if not isinstance(settings, dict):
        return PublicationProfile()
    return parse_publication_profile(settings.get("publication"))


def merge_publication_into_settings(
    existing: dict[str, Any] | None,
    profile: PublicationProfile,
) -> dict[str, Any]:
    settings = dict(existing or {})
    settings["publication"] = profile.model_dump()
    return settings
