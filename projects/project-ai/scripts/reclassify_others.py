#!/usr/bin/env python3
"""Backfill / scheduled re-classification driver for complaints filed as 'Others'.

Lists Others complaints that don't yet have a reclassification suggestion via
CRUD, then calls the AI service's /classify-sub-category endpoint for each.
Designed to work both:

  * **Backfill mode** — one-shot run over the historical 4.5k "Others" pile.
  * **Steady-state mode** — invoked every N minutes by a systemd timer (or
    cron) to pick up new "Others" complaints SCORES inserts.

Either way the script is **idempotent**: each iteration only processes
complaints whose `reclassification_status` is unset. A Ctrl-C and re-run picks
up where it left off — no checkpoint file needed.

Air-gapped deployment
---------------------
Designed to run inside the SEBI server's AI venv. No external pypi deps beyond
``httpx`` (already installed for the FastAPI app). Pure stdlib elsewhere.

Environment
-----------
::

    CRUD_BASE_URL=http://localhost:8080
    AI_BASE_URL=http://localhost:9000
    CRUD_SYSTEM_KEY=<same value as SYSTEM_API_KEY on CRUD>

Usage
-----
::

    # Pilot — eyeball the suggestions before committing
    python3 scripts/reclassify_others.py --limit 50 --workers 4

    # Full backfill
    python3 scripts/reclassify_others.py --workers 6

    # Steady-state cron run — process at most 200 per invocation, fail soft on
    # individual complaints
    python3 scripts/reclassify_others.py --limit 200 --workers 4

Exit codes
----------
0   any progress (at least one classification attempted)
1   misconfiguration / fatal upstream error (CRUD unreachable, etc.)
2   no candidates found (nothing to do)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from typing import AsyncIterator

import httpx

logger = logging.getLogger("reclassify-others")


def _env(name: str, *, default: str | None = None, required: bool = False) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        sys.stderr.write(f"missing required env var: {name}\n")
        sys.exit(1)
    return val or ""


CRUD_BASE_URL = _env("CRUD_BASE_URL", default="http://localhost:8080")
AI_BASE_URL = _env("AI_BASE_URL", default="http://localhost:9000")
CRUD_SYSTEM_KEY = _env("CRUD_SYSTEM_KEY", required=True)

# The cap CRUD enforces on /v1/complaints?limit=. Keeping this aligned avoids
# surprise 400s on tighter-than-expected page sizes.
PAGE_SIZE = 200

# Per-request timeout for the AI classify call. The endpoint internally does a
# CRUD fetch + an LLM call + a CRUD write — most runs land in 1–3s but reasoning
# models can spike, so we leave headroom.
CLASSIFY_TIMEOUT_SECONDS = 90


# ── CRUD page iterator ────────────────────────────────────────────────


async def iter_others_to_process(
    client: httpx.AsyncClient,
    *,
    hard_limit: int | None,
) -> AsyncIterator[int]:
    """Yield complaint IDs that still need a suggestion. Pages through CRUD's
    /v1/complaints filtered to sub_category='Others' AND
    reclassification_status='none' (the sentinel that matches "no field
    present yet"). Backed by the partial index we created in
    internal/db/mongo/indexes.go, so it's cheap regardless of dataset size."""

    yielded = 0
    cursor: str | None = None
    while True:
        params: dict[str, object] = {
            "sub_category": "Others",
            "reclassification_status": "none",
            "limit": PAGE_SIZE,
        }
        if cursor:
            params["after"] = cursor

        resp = await client.get(
            f"{CRUD_BASE_URL}/v1/complaints",
            params=params,
            headers={"X-System-Key": CRUD_SYSTEM_KEY},
            timeout=CLASSIFY_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        page = resp.json()
        items = page.get("items") or []
        if not items:
            return

        for item in items:
            yield item["complaint_id"]
            yielded += 1
            if hard_limit is not None and yielded >= hard_limit:
                return

        cursor = page.get("next_cursor")
        if not cursor:
            return


# ── Classify a single complaint ───────────────────────────────────────


async def classify_one(
    client: httpx.AsyncClient,
    complaint_id: int,
    *,
    persist: bool,
) -> dict:
    """Calls the AI service endpoint for one complaint. Always returns the
    parsed response body when successful — caller logs the suggestion +
    confidence."""
    resp = await client.post(
        f"{AI_BASE_URL}/classify-sub-category",
        json={"complaint_id": complaint_id, "persist": persist},
        timeout=CLASSIFY_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return resp.json()


# ── Driver ────────────────────────────────────────────────────────────


async def run(args: argparse.Namespace) -> int:
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    sem = asyncio.Semaphore(args.workers)
    started = time.perf_counter()
    counts = {"ok": 0, "skipped": 0, "failed": 0}

    async with httpx.AsyncClient() as client:
        # Collect the list first — small enough (≤4.5k) that fitting it in
        # memory beats interleaving I/O and worker-pool scheduling.
        ids: list[int] = [
            cid async for cid in iter_others_to_process(client, hard_limit=args.limit)
        ]

        if not ids:
            logger.info("no Others complaints awaiting classification — exiting")
            return 2

        logger.info(
            "found %d Others complaint(s) to process (workers=%d, persist=%s)",
            len(ids),
            args.workers,
            (not args.dry_run),
        )

        if args.dry_run and args.no_llm:
            # Cheap mode used in CI / sanity checks — verifies the listing path
            # without firing any LLM calls.
            logger.info("dry-run --no-llm: skipping classification calls")
            return 0

        async def worker(cid: int) -> None:
            async with sem:
                try:
                    out = await classify_one(client, cid, persist=not args.dry_run)
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code
                    body = exc.response.text[:200]
                    if status in (404, 422):
                        # Expected for: not-Others, no parent category, no
                        # candidates. Not interesting at INFO level.
                        counts["skipped"] += 1
                        logger.debug("skip %s (%s): %s", cid, status, body)
                        return
                    counts["failed"] += 1
                    logger.warning("FAIL %s (%s): %s", cid, status, body)
                    return
                except Exception as exc:  # noqa: BLE001 — boundary, want all
                    counts["failed"] += 1
                    logger.warning("FAIL %s: %s", cid, exc)
                    return

                counts["ok"] += 1
                suggested = out.get("suggested_sub_category") or "(none)"
                logger.info(
                    "[%d/%d] %s → %s (conf=%s, persisted=%s)",
                    counts["ok"] + counts["skipped"] + counts["failed"],
                    len(ids),
                    cid,
                    suggested[:48],
                    out.get("confidence"),
                    out.get("persisted"),
                )

        await asyncio.gather(*(worker(cid) for cid in ids))

    elapsed = time.perf_counter() - started
    logger.info(
        "done in %.1fs — ok=%d skipped=%d failed=%d",
        elapsed,
        counts["ok"],
        counts["skipped"],
        counts["failed"],
    )
    # We treat partial success as a success — the next run will pick up the
    # failures naturally.
    return 0 if (counts["ok"] + counts["skipped"]) > 0 else 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Backfill / steady-state classifier for complaints filed as 'Others'.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of complaints processed in this run (default: all).",
    )
    p.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Concurrent classifier calls (default: 4).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Run the LLM but tell it NOT to persist the suggestion. Useful for "
            "iterating on the prompt or evaluating accuracy on a held-out set."
        ),
    )
    p.add_argument(
        "--no-llm",
        action="store_true",
        help=(
            "Only verify the CRUD listing path; skip the LLM call entirely. "
            "Implies --dry-run. Used by CI smoke tests."
        ),
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="DEBUG-level logging.",
    )
    return p.parse_args(argv)


def main() -> None:
    args = parse_args()
    if args.no_llm:
        args.dry_run = True
    code = asyncio.run(run(args))
    sys.exit(code)


if __name__ == "__main__":
    main()
