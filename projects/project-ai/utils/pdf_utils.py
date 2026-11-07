from __future__ import annotations

import asyncio
import base64
from io import BytesIO

import fitz
from PIL import Image


def _pdf_to_images_sync(pdf_bytes: bytes, dpi: int = 200) -> list[Image.Image]:
    images: list[Image.Image] = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            images.append(img)
    return images


async def pdf_to_images(pdf_bytes: bytes, dpi: int = 200) -> list[Image.Image]:
    return await asyncio.to_thread(_pdf_to_images_sync, pdf_bytes, dpi)


def image_to_data_url(img: Image.Image, fmt: str = "PNG") -> str:
    buf = BytesIO()
    img.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if fmt.upper() == "PNG" else f"image/{fmt.lower()}"
    return f"data:{mime};base64,{b64}"


def bytes_to_data_url(image_bytes: bytes, content_type: str = "image/png") -> str:
    if not content_type.startswith("image/"):
        content_type = "image/png"
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{content_type};base64,{b64}"


def is_pdf(content_bytes: bytes, content_type: str | None = None) -> bool:
    if content_type and "pdf" in content_type.lower():
        return True
    return content_bytes[:4] == b"%PDF"
