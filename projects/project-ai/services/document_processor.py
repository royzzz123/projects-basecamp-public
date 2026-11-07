from __future__ import annotations

import asyncio
import json
import logging
import re

from pydantic import ValidationError

from schemas.analysis import DocSummaryContent
from utils import minio_client
from utils.llm import build_json_schema_format, call_llm, call_vision
from utils.pdf_utils import bytes_to_data_url, image_to_data_url, is_pdf, pdf_to_images

logger = logging.getLogger(__name__)

OCR_PROMPT = (
    "Extract all readable text from this document image. Preserve structure (headings, "
    "paragraphs, bullet points, tables) using plain text. Output only the extracted text."
)

SUMMARY_SYSTEM = (
    "You are an analyst summarizing documents attached to a SEBI investor complaint. "
    "You are given the OCR-extracted text of a single document.\n"
    "Return ONLY a JSON object with exactly these fields:\n"
    "{\n"
    '  "ai_generated_name": "A short human-readable name describing what the document is, in '
    'Title Case (max ~6 words). Examples: \\"Action Taken Report\\", \\"Complaint\\", '
    '\\"Reply to Complaint\\", \\"Bank Statement\\", \\"Investor Email\\".",\n'
    '  "summary": "A concise, faithful 4-10 sentence summary capturing what the document is, who '
    'issued it, the main claims/facts/decisions, any dates, monetary amounts, and references to '
    'other parties."\n'
    "}\n"
    "Rules:\n"
    "- Base both fields strictly on the document text; do not invent information.\n"
    '- If the document type is unclear, use a sensible generic name such as "Supporting Document".\n'
    "- The summary must be plain prose (no markdown or bullet lists)."
)


def _extract_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Model output did not contain a JSON object: {text[:300]}")
    return json.loads(match.group(0))


async def _ocr_image_data_url(data_url: str) -> str:
    return await call_vision("lighton-ocr", OCR_PROMPT, data_url, temperature=0.0)


async def _ocr_document(uuid: str, content_bytes: bytes, content_type: str) -> str:
    if is_pdf(content_bytes, content_type):
        logger.info("[STEP] uuid=%s rendering PDF to images", uuid)
        images = await pdf_to_images(content_bytes)
        if not images:
            logger.warning("[STEP] uuid=%s PDF produced 0 images", uuid)
            return ""
        logger.info("[STEP] uuid=%s running OCR on %d PDF pages", uuid, len(images))
        page_tasks = [_ocr_image_data_url(image_to_data_url(img)) for img in images]
        pages = await asyncio.gather(*page_tasks, return_exceptions=True)
        out: list[str] = []
        ok = 0
        for i, p in enumerate(pages, start=1):
            if isinstance(p, Exception):
                logger.warning("[STEP] uuid=%s OCR failed for page %s: %s", uuid, i, p)
                out.append(f"[page {i}: OCR failed]")
            else:
                ok += 1
                out.append(f"--- Page {i} ---\n{p}")
        text = "\n\n".join(out)
        logger.info(
            "[STEP] uuid=%s OCR done pages_ok=%d/%d chars=%d",
            uuid, ok, len(images), len(text),
        )
        return text

    logger.info("[STEP] uuid=%s running OCR on single image (%s)", uuid, content_type)
    data_url = bytes_to_data_url(content_bytes, content_type or "image/png")
    text = await _ocr_image_data_url(data_url)
    logger.info("[STEP] uuid=%s OCR done chars=%d", uuid, len(text))
    return text


async def _summarize_text(uuid: str, ocr_text: str) -> tuple[str, str | None]:
    if not ocr_text.strip():
        logger.info("[STEP] uuid=%s skipping summary (empty OCR text)", uuid)
        return "Document appears to be empty or unreadable.", None
    logger.info("[STEP] uuid=%s summarising OCR text (chars=%d)", uuid, len(ocr_text))
    messages = [
        {"role": "system", "content": SUMMARY_SYSTEM},
        {"role": "user", "content": f"Document contents (OCR output):\n\n{ocr_text}"},
    ]
    raw = await call_llm(
        "nemotron-3-120b",
        messages=messages,
        temperature=0.2,
        response_format=build_json_schema_format(DocSummaryContent),
    )
    try:
        parsed = DocSummaryContent.model_validate(_extract_json(raw))
    except (ValueError, json.JSONDecodeError, ValidationError) as e:
        logger.warning("[STEP] uuid=%s failed to parse summary JSON, using raw text. err=%s", uuid, e)
        return raw, None
    summary = (parsed.summary or "").strip() or raw
    name = (parsed.ai_generated_name or "").strip() or None
    logger.info("[STEP] uuid=%s summary done (name=%s, chars=%d)", uuid, name, len(summary))
    return summary, name


async def process_document(complaint_id: int, uuid: str) -> tuple[str, str | None]:
    """Full pipeline for one doc UUID: download -> OCR -> summarize.
    Returns (summary_text, ai_generated_name)."""
    object_name = f"{complaint_id}/{uuid}"
    logger.info("[STEP] uuid=%s downloading from MinIO (object=%s)", uuid, object_name)
    content_bytes, content_type = await minio_client.download(object_name)
    logger.info(
        "[STEP] uuid=%s downloaded bytes=%d content_type=%s",
        uuid, len(content_bytes), content_type,
    )
    ocr_text = await _ocr_document(uuid, content_bytes, content_type)
    return await _summarize_text(uuid, ocr_text)
