from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Book Sculptor API"
    environment: str = "development"
    api_cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # When true, also accept private-LAN browser origins (home network).
    api_allow_lan: bool = False
    # Optional host used in docs / health; e.g. 192.168.1.131
    lan_host: str = ""

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/booksculptor"

    clerk_issuer: str = ""
    clerk_jwks_url: str = ""
    clerk_secret_key: str = ""
    clerk_audience: str = ""
    # Keep false when using real Clerk keys
    auth_dev_bypass: bool = False

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_pro: str = ""
    stripe_price_studio: str = ""
    stripe_success_url: str = "http://localhost:3000/en/pricing?success=1"
    stripe_cancel_url: str = "http://localhost:3000/en/pricing?canceled=1"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "book-sculptor"
    r2_public_base_url: str = ""
    r2_endpoint_url: str = ""

    # OpenAI or any OpenAI-compatible server (Ollama, LM Studio, vLLM, LocalAI, etc.)
    # Base URL must include the /v1 prefix (e.g. https://api.openai.com/v1 or http://127.0.0.1:11434/v1).
    openai_api_key: str = ""
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = ""
    llm_model_pro: str = "gpt-4o-mini"
    llm_model_studio: str = "gpt-4o"
    llm_timeout_seconds: float = 180.0
    # When true, a key is required even for non-OpenAI endpoints.
    llm_require_api_key: bool = False
    # OpenAI Images model for book covers (DALL·E 3 / gpt-image-*).
    llm_image_model: str = "dall-e-3"

    local_storage_dir: str = ".storage"

    # Social OAuth (set SOCIAL_OAUTH_DEV_MODE=true for simulated connections locally)
    social_oauth_dev_mode: bool = False
    social_oauth_secret: str = "dev-social-oauth-secret-change-me"
    api_public_url: str = "http://localhost:8000"
    web_public_url: str = "http://localhost:3000"

    twitter_client_id: str = ""
    twitter_client_secret: str = ""
    meta_app_id: str = ""
    meta_app_secret: str = ""
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]
        host = (self.lan_host or "").strip()
        if host:
            for port in ("3000",):
                candidate = f"http://{host}:{port}"
                if candidate not in origins:
                    origins.append(candidate)
        return origins

    @property
    def cors_origin_regex(self) -> str | None:
        if not self.api_allow_lan:
            return None
        # localhost + RFC1918 private networks (any port)
        return (
            r"https?://("
            r"localhost|"
            r"127\.0\.0\.1|"
            r"192\.168\.\d{1,3}\.\d{1,3}|"
            r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
            r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
            r")(:\d+)?$"
        )

    @property
    def resolved_llm_api_key(self) -> str:
        return (self.llm_api_key or self.openai_api_key or "").strip()

    @property
    def resolved_llm_base_url(self) -> str:
        return (self.llm_base_url or "https://api.openai.com/v1").rstrip("/")

    @property
    def is_openai_cloud(self) -> bool:
        return "api.openai.com" in self.resolved_llm_base_url.lower()

    @property
    def llm_live_enabled(self) -> bool:
        """True when we should call a chat-completions endpoint instead of the offline stub."""
        has_key = bool(self.resolved_llm_api_key)
        if self.is_openai_cloud:
            return has_key
        if self.llm_require_api_key:
            return has_key
        # Local / on-prem OpenAI-compatible servers usually accept anonymous or dummy auth.
        return True


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    url = settings.database_url
    if url.startswith("postgres://"):
        settings.database_url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://") and "+psycopg" not in url:
        settings.database_url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return settings
