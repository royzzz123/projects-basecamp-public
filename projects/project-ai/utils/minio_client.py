from __future__ import annotations

import asyncio
import logging
from io import BytesIO

from minio import Minio

from config.settings import settings

logger = logging.getLogger(__name__)


_client: Minio | None = None


def _get_client() -> Minio:
    global _client
    if _client is None:
        if not settings.minio_endpoint:
            raise RuntimeError("MINIO_ENDPOINT is not configured")
        _client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key or None,
            secret_key=settings.minio_secret_key or None,
            secure=settings.minio_secure,
        )
    return _client


def _download_sync(object_name: str) -> tuple[bytes, str]:
    client = _get_client()
    response = client.get_object(settings.minio_bucket, object_name)
    try:
        buf = BytesIO()
        for chunk in response.stream(64 * 1024):
            buf.write(chunk)
        content_type = response.headers.get("Content-Type", "application/octet-stream")
        return buf.getvalue(), content_type
    finally:
        response.close()
        response.release_conn()


async def download(object_name: str) -> tuple[bytes, str]:
    """Returns (bytes, content_type). Runs the blocking MinIO call in a thread."""
    logger.info("MinIO download: bucket=%s object=%s", settings.minio_bucket, object_name)
    return await asyncio.to_thread(_download_sync, object_name)
