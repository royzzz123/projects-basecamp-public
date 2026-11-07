"""Batch dimension-enrichment runner (the AI pass, via Claude Code CLI).

    python -m scripts.enrich --limit 48 --sample     # validation batch
    python -m scripts.enrich                          # full remaining population
    python -m scripts.enrich --batch-size 12 --workers 5

Complaints are grouped into batches (one inference call per batch, returning a
JSON array). Idempotent & resumable: only complaints without `enriched=true`
are picked up, and results flush incrementally, so a re-run (or a crash)
continues where it stopped.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("enrich")

_PENDING_CYPHER = """
MATCH (c:Complaint)
WHERE c.enriched IS NULL AND c.details IS NOT NULL AND c.details <> ''
OPTIONAL MATCH (c)-[:IN_CATEGORY]->(cat:Category)
RETURN c.complaintid AS complaintid, c.details AS details,
       c.sub_category AS sub_category, cat.name AS category
ORDER BY c.complaintid
LIMIT $limit
"""


async def run(limit: int, batch_size: int, workers: int, flush_every: int, sample: bool) -> int:
    from config.settings import settings
    from enrichment.dimensions import extract_signals_batch
    from enrichment.llm import close_clients
    from enrichment.writer import write_signals
    from graph.driver import close_driver, run_query

    pending = run_query(_PENDING_CYPHER, limit=limit)
    total = len(pending)
    if total == 0:
        logger.info("nothing to enrich (all complaints already enriched).")
        return 0

    batches = [pending[i : i + batch_size] for i in range(0, total, batch_size)]
    logger.info("enriching %d complaints in %d batches of %d, %d workers (backend=%s model=%s)",
                total, len(batches), batch_size, workers,
                settings.inference_backend, settings.claude_model)

    sem = asyncio.Semaphore(workers)
    collected: list[dict] = []
    samples: list[dict] = []
    counters = {"batches": 0, "written": 0, "failed_batches": 0}
    t0 = time.time()

    async def do_batch(batch: list[dict]) -> list[dict]:
        async with sem:
            try:
                res = await extract_signals_batch(batch)
            except Exception as e:  # noqa: BLE001
                counters["failed_batches"] += 1
                logger.warning("batch of %d failed: %s", len(batch), e)
                return []
        rows: list[dict] = []
        for c in batch:
            sig = res.get(c["complaintid"])
            if sig is None:
                continue
            row = sig.model_dump()
            row["complaintid"] = c["complaintid"]
            row["model"] = settings.claude_model
            rows.append(row)
            if sample and len(samples) < 5:
                samples.append({"complaintid": c["complaintid"],
                                "details": (c["details"] or "")[:160], "signals": sig.model_dump()})
        return rows

    tasks = [asyncio.create_task(do_batch(b)) for b in batches]
    for fut in asyncio.as_completed(tasks):
        rows = await fut
        counters["batches"] += 1
        collected.extend(rows)
        if len(collected) >= flush_every:
            n = await asyncio.to_thread(write_signals, collected)
            counters["written"] += n
            logger.info("flushed %d  (%d/%d batches, %d written, %d failed batches)",
                        n, counters["batches"], len(batches), counters["written"],
                        counters["failed_batches"])
            collected = []

    if collected:
        counters["written"] += await asyncio.to_thread(write_signals, collected)

    await close_clients()
    dt = time.time() - t0
    logger.info("── enrichment done in %.0fs ──", dt)
    logger.info("written=%d/%d  failed_batches=%d  rate=%.1f complaints/s  (~$%.4f/complaint est.)",
                counters["written"], total, counters["failed_batches"],
                counters["written"] / dt if dt else 0, 0.004)

    if sample:
        print("\n===== SAMPLE EXTRACTIONS =====")
        for s in samples:
            print(f"\n[{s['complaintid']}] {s['details']!r}")
            print(json.dumps(s["signals"], indent=2, default=str))

    _print_distribution(run_query)
    close_driver()
    return 0


def _print_distribution(run_query) -> None:
    print("\n===== ENRICHED-POPULATION SIGNAL DISTRIBUTION =====")
    dist = run_query("""
        MATCH (c:Complaint) WHERE c.enriched = true
        RETURN c.severity AS severity, count(*) AS n ORDER BY n DESC
    """)
    total = sum(d["n"] for d in dist)
    print(f"enriched total: {total}")
    print("severity:", {d["severity"]: d["n"] for d in dist})
    for flag in ["is_misappropriation", "liquidity_block", "vulnerable",
                 "criminal_language", "market_integrity_risk", "class_harm_assertion",
                 "senior_mgmt_allegation", "distress"]:
        r = run_query(
            f"MATCH (c:Complaint) WHERE c.enriched = true AND c.{flag} = true RETURN count(*) AS n"
        )
        print(f"  {flag}: {r[0]['n']}")
    amt = run_query("""
        MATCH (c:Complaint) WHERE c.enriched = true AND c.amount_inr IS NOT NULL
        RETURN count(*) AS n, round(max(c.amount_inr)) AS max_amt
    """)
    print("  with amount:", amt[0])
    typ = run_query("""
        MATCH (:Complaint)-[:ALLEGES]->(t:Typology)
        RETURN t.severity AS severity, count(*) AS n ORDER BY n DESC
    """)
    print("  typology edges by severity:", {d["severity"]: d["n"] for d in typ})


def main() -> int:
    from config.settings import settings

    ap = argparse.ArgumentParser(description="LLM dimension enrichment (Claude Code CLI)")
    ap.add_argument("--limit", type=int, default=1_000_000, help="max complaints this run")
    ap.add_argument("--batch-size", type=int, default=settings.enrich_batch_size)
    ap.add_argument("--workers", type=int, default=settings.enrich_workers)
    ap.add_argument("--flush-every", type=int, default=48, help="write to graph every N results")
    ap.add_argument("--sample", action="store_true", help="print a few full extractions")
    args = ap.parse_args()
    try:
        return asyncio.run(run(args.limit, args.batch_size, args.workers, args.flush_every, args.sample))
    except KeyboardInterrupt:
        logger.warning("interrupted — flushed results are resumable; re-run to continue")
        return 130


if __name__ == "__main__":
    sys.exit(main())
