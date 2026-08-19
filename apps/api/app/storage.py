from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.client import Config

from app.config import get_settings

settings = get_settings()


def _local_root() -> Path:
    root = Path(settings.local_storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def r2_configured() -> bool:
    return bool(
        settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket
        and (settings.r2_endpoint_url or settings.r2_account_id)
    )


def _s3_client():
    endpoint = settings.r2_endpoint_url
    if not endpoint and settings.r2_account_id:
        endpoint = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    if r2_configured():
        client = _s3_client()
        client.put_object(
            Bucket=settings.r2_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        if settings.r2_public_base_url:
            return f"{settings.r2_public_base_url.rstrip('/')}/{quote(key)}"
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.r2_bucket, "Key": key},
            ExpiresIn=3600 * 24,
        )

    path = _local_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"/api/v1/files/{quote(key, safe='/')}"


def get_bytes(key: str) -> bytes | None:
    if not key:
        return None
    if r2_configured():
        try:
            client = _s3_client()
            obj = client.get_object(Bucket=settings.r2_bucket, Key=key)
            return obj["Body"].read()
        except Exception:  # noqa: BLE001
            return None
    path = _local_root() / key
    return path.read_bytes() if path.exists() else None


def delete_key(key: str) -> None:
    if not key:
        return
    if r2_configured():
        try:
            client = _s3_client()
            client.delete_object(Bucket=settings.r2_bucket, Key=key)
        except Exception:  # noqa: BLE001
            pass
        return
    path = _local_root() / key
    if path.exists():
        path.unlink(missing_ok=True)


def get_local_path(key: str) -> Path | None:
    return resolve_safe_local_path(key)


def resolve_safe_local_path(key: str) -> Path | None:
    """Resolve a storage key under the local root; reject traversal."""
    if not key or not key.strip():
        return None
    root = _local_root().resolve()
    # Normalize separators and strip leading slashes
    normalized = key.replace("\\", "/").strip("/")
    if ".." in normalized.split("/"):
        return None
    candidate = (root / normalized).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None
