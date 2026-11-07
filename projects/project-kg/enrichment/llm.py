"""Inference backend for dimension enrichment.

Two backends, selected by `INFERENCE_BACKEND`:

* ``claude_cli`` (default) — shells out to the local Claude Code CLI in headless
  mode (`claude -p ... --output-format json`). Uses the machine's existing
  Claude Code auth: no LiteLLM gateway, no port-forward, no API key. The call is
  stripped to a clean inference primitive: `--setting-sources ""` (skip
  CLAUDE.md/skills/hooks), `--system-prompt` (replace the agent persona),
  `--allowedTools ""` (no tools). Complaints are batched per call so the fixed
  harness context amortises.

* ``gateway`` — the OnFinance LiteLLM gateway (OpenAI-compatible) — retained for
  the SEBI VM deployment where the CLI is unavailable.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class InferenceError(RuntimeError):
    pass


async def infer(system_prompt: str, user_prompt: str) -> str:
    """Return the model's raw text answer for (system, user)."""
    backend = settings.inference_backend
    if backend == "claude_cli":
        return await _claude_cli(system_prompt, user_prompt)
    if backend == "gateway":
        return await _gateway(system_prompt, user_prompt)
    raise InferenceError(f"unknown INFERENCE_BACKEND '{backend}'")


# ── Backend: Claude Code CLI (headless) ────────────────────────────────────
async def _claude_cli(system_prompt: str, user_prompt: str) -> str:
    args = [
        "claude", "-p", user_prompt,
        "--system-prompt", system_prompt,
        "--setting-sources", "",
        "--allowedTools", "",
        "--exclude-dynamic-system-prompt-sections",
        "--model", settings.claude_model,
        "--output-format", "json",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=settings.claude_cli_cwd,
        )
        out, err = await asyncio.wait_for(
            proc.communicate(), timeout=settings.claude_timeout_seconds
        )
    except asyncio.TimeoutError as e:
        raise InferenceError("claude cli timed out") from e
    except FileNotFoundError as e:
        raise InferenceError("`claude` CLI not found on PATH") from e

    if proc.returncode != 0:
        raise InferenceError(f"claude cli exit {proc.returncode}: {err.decode()[:300]}")

    try:
        env = json.loads(out.decode())
    except json.JSONDecodeError as e:
        raise InferenceError(f"claude cli non-JSON envelope: {out.decode()[:300]}") from e

    if env.get("is_error") or env.get("subtype") != "success":
        raise InferenceError(f"claude cli error: {str(env.get('result'))[:300]}")
    return env.get("result") or ""


# ── Backend: LiteLLM gateway (OpenAI-compatible) ───────────────────────────
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.http_timeout_seconds),
            headers={
                "Authorization": f"Bearer {settings.llm_bearer_token}",
                "Content-Type": "application/json",
            },
            verify=settings.llm_verify_ssl,
            proxy=settings.llm_http_proxy or None,
        )
    return _client


async def _gateway(system_prompt: str, user_prompt: str) -> str:
    payload: dict[str, Any] = {
        "model": settings.llm_nemotron_120b_model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": settings.enrichment_max_tokens,
        "response_format": {"type": "json_object"},
    }
    try:
        resp = await _get_client().post(settings.llm_nemotron_120b_url, json=payload)
    except httpx.HTTPError as e:
        raise InferenceError(f"gateway connection failed: {e}") from e
    if resp.status_code >= 400:
        raise InferenceError(f"gateway {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise InferenceError(f"unexpected gateway shape: {str(data)[:400]}") from e


async def close_clients() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
