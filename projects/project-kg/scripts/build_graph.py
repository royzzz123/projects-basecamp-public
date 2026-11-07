"""Build the SCORES knowledge graph from MongoDB.

    python -m scripts.build_graph              # full build
    python -m scripts.build_graph --wipe       # clear graph first, then build
    python -m scripts.build_graph --limit 500  # smoke-test on 500 complaints

Phase 1 = structural ETL only (no LLM). Idempotent: re-running MERGEs in place.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("build_graph")


def _wipe() -> None:
    from graph.driver import get_driver

    logger.info("wiping graph (DETACH DELETE all nodes) ...")
    driver = get_driver()
    with driver.session() as session:
        # delete in batches to avoid a huge single transaction
        while True:
            res = session.run(
                "MATCH (n) WITH n LIMIT 20000 DETACH DELETE n RETURN count(n) AS c"
            ).single()
            if not res or res["c"] == 0:
                break


def main() -> int:
    ap = argparse.ArgumentParser(description="Build the SCORES knowledge graph")
    ap.add_argument("--wipe", action="store_true", help="clear the graph before loading")
    ap.add_argument("--limit", type=int, default=None, help="cap complaints (smoke test)")
    ap.add_argument("--skip-events", action="store_true", help="skip tr_complaints timeline load")
    args = ap.parse_args()

    from etl import loader, mongo_reader
    from graph.driver import close_driver, graph_healthcheck
    from graph.ontology import apply_ontology

    t0 = time.time()
    try:
        if args.wipe:
            _wipe()

        logger.info("applying ontology (constraints + indexes) ...")
        apply_ontology()

        logger.info("loading master data (categories / subcategories / entities) ...")
        masters = loader.load_master_data()

        logger.info("loading complaints ...")
        n_complaints, ids = loader.load_complaints(limit=args.limit)

        n_events = 0
        if not args.skip_events:
            logger.info("loading timeline events (tr_complaints) ...")
            # when limited, restrict events to the loaded complaints
            n_events = loader.load_timeline_events(ids if args.limit else None)

        health = graph_healthcheck()
        logger.info("── build complete in %.1fs ──", time.time() - t0)
        logger.info("masters=%s complaints=%d events=%d", masters, n_complaints, n_events)
        logger.info("graph: nodes=%s relationships=%s labels=%s",
                    health.get("nodes"), health.get("relationships"), health.get("labels"))
        return 0
    except Exception:  # noqa: BLE001
        logger.exception("build failed")
        return 1
    finally:
        mongo_reader.close()
        close_driver()


if __name__ == "__main__":
    sys.exit(main())
