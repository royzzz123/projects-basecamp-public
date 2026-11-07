"""Build semantic clusters over the knowledge graph.

    python -m scripts.build_clusters                       # full pass (run AFTER enrichment)
    python -m scripts.build_clusters --dry-run rti00032    # validate one RE, no writes

Root-cause clusters need only complaint text; cross-RE product clusters need the
Phase-2 Product nodes, so run the full pass once enrichment has completed.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("build_clusters")


def _dry_run(entity: str) -> int:
    from collections import defaultdict
    from clustering.clusterer import cluster_entity
    from graph.driver import close_driver, run_query

    rows = run_query("""
        MATCH (c:Complaint)-[:FILED_AGAINST]->(e:Entity {screenid:$e})
        WHERE c.details IS NOT NULL AND c.details <> ''
        RETURN $e AS entity, c.complaintid AS id, c.details AS details, c.state_code AS state
    """, e=entity)
    if not rows:
        print(f"no complaints for entity {entity}")
        return 1
    edges, clusters = cluster_entity(rows)
    clusters.sort(key=lambda c: c["size"], reverse=True)
    print(f"entity {entity}: {len(rows)} complaints -> {len(edges)} SIMILAR_TO edges, "
          f"{len(clusters)} clusters (size>= min)")
    by_id = {r["id"]: r["details"] for r in rows}
    for cl in clusters[:8]:
        print(f"\n  cluster size={cl['size']} states={cl['n_states']} templated_frac={cl['templated_frac']}")
        for mid in cl["member_ids"][:3]:
            print(f"     [{mid}] {by_id[mid][:110]!r}")
    close_driver()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Build semantic clusters")
    ap.add_argument("--dry-run", metavar="ENTITY_SCREENID", help="validate one RE, no writes")
    args = ap.parse_args()

    if args.dry_run:
        return _dry_run(args.dry_run)

    from clustering.clusterer import build_all
    from graph.driver import close_driver

    t0 = time.time()
    try:
        summary = build_all()
        logger.info("── clustering done in %.0fs ── %s", time.time() - t0, summary)
        return 0
    except Exception:  # noqa: BLE001
        logger.exception("clustering failed")
        return 1
    finally:
        close_driver()


if __name__ == "__main__":
    sys.exit(main())
