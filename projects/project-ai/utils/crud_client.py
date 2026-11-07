from __future__ import annotations

import logging

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """Shared async HTTP client for the CRUD service.

    The X-System-Key header is set once as a default so every request the
    client makes carries it. Reuse this client for all CRUD endpoints.
    """
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.crud_base_url,
            timeout=httpx.Timeout(settings.http_timeout_seconds),
            headers={"X-System-Key": settings.crud_system_key},
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
