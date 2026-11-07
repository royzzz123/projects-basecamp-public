from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from config.settings import settings

logger = logging.getLogger(__name__)

SchemaKind = Literal["openai_chat", "ollama_generate"]


class LLMError(RuntimeError):
    pass


@dataclass(frozen=True)
class ModelConfig:
    url: str
    model_id: str
    schema_kind: SchemaKind
    auth_token: str | None = None  # if set, overrides the shared LLM_BEARER_TOKEN


def _registry() -> dict[str, ModelConfig]:
    return {
        "nemotron-3-nano": ModelConfig(
            url=settings.llm_nemotron_nano_url,
            model_id=settings.llm_nemotron_nano_model_id,
            schema_kind="ollama_generate",
        ),
        "nemotron-3-120b": ModelConfig(
            url=settings.llm_nemotron_120b_url,
            model_id=settings.llm_nemotron_120b_model_id,
            schema_kind="openai_chat",
        ),
        "lighton-ocr": ModelConfig(
            url=settings.llm_lighton_ocr_url,
            model_id=settings.llm_lighton_ocr_model_id,
            schema_kind="openai_chat",
        ),
        "gemma-4-26b": ModelConfig(
            url=settings.llm_gemma_url,
            model_id=settings.llm_gemma_model_id,
            schema_kind="openai_chat",
        ),
        "llama-3.3-70b": ModelConfig(
            url=settings.llm_llama_70b_url,
            model_id=settings.llm_llama_70b_model_id,
            schema_kind="openai_chat",
            auth_token=settings.llm_llama_70b_bearer_token or None,
        ),
        "ministral-3-14b": ModelConfig(
            url=settings.llm_ministral_url,
            model_id=settings.llm_ministral_model_id,
            schema_kind="ollama_generate",
        ),
    }


def _request_headers(cfg: ModelConfig) -> dict[str, str] | None:
    """Per-request header override when a model has its own bearer token."""
    if cfg.auth_token:
        return {"Authorization": f"Bearer {cfg.auth_token}"}
    return None


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


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def build_json_schema_format(model: type[BaseModel], *, strict: bool = False) -> dict[str, Any]:
    """OpenAI-compatible structured-output `response_format` derived from a Pydantic model.

    vLLM compiles this JSON Schema into a grammar and constrains decoding so the model's output
    conforms to `model`'s shape (guided decoding). The Pydantic model is the single source of
    truth — schema sent to the LLM and validator of the response. If a gateway ignores the field,
    the call still returns JSON and the caller's defensive parsing handles it.
    """
    return {
        "type": "json_schema",
        "json_schema": {
            "name": model.__name__,
            "schema": model.model_json_schema(),
            "strict": strict,
        },
    }


async def call_llm(
    model: str,
    messages: list[dict[str, Any]] | None = None,
    prompt: str | None = None,
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    response_format: dict[str, Any] | None = None,
) -> str:
    """Unified entrypoint. Returns assistant text."""
    registry = _registry()
    if model not in registry:
        raise LLMError(f"Unknown model '{model}'. Known: {list(registry)}")
    cfg = registry[model]
    if not cfg.url:
        raise LLMError(f"No URL configured for model '{model}'")

    if cfg.schema_kind == "openai_chat":
        if not messages:
            if prompt is None:
                raise LLMError("openai_chat models require either `messages` or `prompt`")
            messages = [{"role": "user", "content": prompt}]
        return await _call_openai_chat(
            cfg, messages, temperature=temperature, max_tokens=max_tokens, response_format=response_format
        )

    if cfg.schema_kind == "ollama_generate":
        if prompt is None:
            if messages:
                prompt = _messages_to_prompt(messages)
            else:
                raise LLMError("ollama_generate models require `prompt` or `messages`")
        if response_format is not None:
            logger.warning(
                "response_format ignored for ollama_generate model '%s' — "
                "JSON constraints are not forwarded to the Ollama API",
                model,
            )
        return await _call_ollama_generate(cfg, prompt, temperature=temperature, max_tokens=max_tokens)

    raise LLMError(f"Unsupported schema_kind for model '{model}'")


async def _call_openai_chat(
    cfg: ModelConfig,
    messages: list[dict[str, Any]],
    *,
    temperature: float,
    max_tokens: int | None,
    response_format: dict[str, Any] | None,
) -> str:
    payload: dict[str, Any] = {
        "model": cfg.model_id,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if response_format is not None:
        payload["response_format"] = response_format

    logger.info("LLM call -> %s (%s)", cfg.model_id, cfg.url)
    resp = await _get_client().post(cfg.url, json=payload, headers=_request_headers(cfg))
    if resp.status_code >= 400:
        raise LLMError(f"{cfg.model_id} returned {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    try:
        choice = data["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError(f"Unexpected response shape from {cfg.model_id}: {data}") from e
    if choice.get("finish_reason") == "length":
        logger.warning(
            "%s response truncated (finish_reason=length). Consider raising max_tokens.",
            cfg.model_id,
        )
    if content is None:
        # Reasoning models (e.g. nemotron) emit chain-of-thought into a separate `reasoning`
        # field and only put the final answer in `content`. If generation is cut off before
        # the answer, `content` is null — return "" so callers' JSON-parse fallback runs
        # instead of crashing on None.
        logger.warning(
            "%s returned null content (finish_reason=%s); using empty fallback.",
            cfg.model_id, choice.get("finish_reason"),
        )
        content = ""
    return content


async def _call_ollama_generate(
    cfg: ModelConfig,
    prompt: str,
    *,
    temperature: float,
    max_tokens: int | None,
) -> str:
    options: dict[str, Any] = {"temperature": temperature}
    if max_tokens is not None:
        options["num_predict"] = max_tokens

    payload = {
        "model": cfg.model_id,
        "prompt": prompt,
        "stream": False,
        "options": options,
    }

    logger.info("LLM call -> %s (%s)", cfg.model_id, cfg.url)
    resp = await _get_client().post(cfg.url, json=payload, headers=_request_headers(cfg))
    if resp.status_code >= 400:
        raise LLMError(f"{cfg.model_id} returned {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    response_text = data.get("response")
    if response_text is None:
        raise LLMError(f"Unexpected response shape from {cfg.model_id}: {data}")
    if data.get("done_reason") == "length":
        logger.warning(
            "%s response truncated (done_reason=length). Consider raising max_tokens.",
            cfg.model_id,
        )
    return _strip_think_block(response_text)


_THINK_RE = re.compile(r"^.*?</think>\s*", re.DOTALL)


def _strip_think_block(text: str) -> str:
    """Remove leading `<think>...</think>` reasoning block from reasoning-model output.

    Nemotron Nano emits its chain-of-thought first, ending with `</think>`, then the
    real answer. If no `</think>` marker is present, returns the text unchanged.
    """
    if "</think>" not in text:
        return text
    return _THINK_RE.sub("", text, count=1)


def _messages_to_prompt(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for m in messages:
        role = m.get("role", "user").upper()
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(p.get("text", "") for p in content if p.get("type") == "text")
        parts.append(f"{role}: {content}")
    return "\n\n".join(parts)


async def call_vision(
    model: str,
    text: str,
    image_data_url: str,
    *,
    temperature: float = 0.0,
    max_tokens: int | None = None,
) -> str:
    """Convenience for vision-capable chat models (LightOn OCR, Gemma). `image_data_url`
    can be a public URL or a data: URL (`data:image/png;base64,...`)."""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    ]
    return await call_llm(model, messages=messages, temperature=temperature, max_tokens=max_tokens)
