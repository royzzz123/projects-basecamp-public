"""Compute Systemic-Criticality Scores over the graph and write them back.

    python -m scripts.score            # score all enriched complaints
    python -m scripts.score --limit 500

Assembles per-complaint features (entity flags, cluster aggregates, velocity
spikes, timeline-derived process signals), runs scoring.engine, and persists
scs / tier / subscores / hard_triggers / reasons onto each Complaint, then
consolidates cluster-level tiers. Idempotent; re-run after enrichment/clustering.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("score")


def _iso_week(neo_dt) -> tuple[int, int] | None:
    try:
        nd = neo_dt.to_native()  # neo4j DateTime -> python datetime
        y, w, _ = nd.isocalendar()
        return (y, w)
    except Exception:
        return None


def _mii_category_codes(run_query) -> set[str]:
    from config.defaults import MII_CATEGORY_HINTS
    rows = run_query("MATCH (cat:Category) RETURN cat.code AS code, cat.name AS name")
    hints = [h.lower() for h in MII_CATEGORY_HINTS]
    return {r["code"] for r in rows if r["name"] and any(h in r["name"].lower() for h in hints)}


def _entity_2nd_counts(run_query) -> dict[str, int]:
    rows = run_query("""
        MATCH (e:Entity)<-[:FILED_AGAINST]-(c:Complaint)-[:HAS_EVENT]->(t:TimelineEvent {action:'SECOND_LEVEL_REVIEW'})
        RETURN e.screenid AS entity, count(DISTINCT c) AS n
    """)
    return {r["entity"]: r["n"] for r in rows}


def _cluster_aggregates(run_query) -> dict[str, dict]:
    rows = run_query("""
        MATCH (cl:Cluster {kind:'root_cause'})<-[:MEMBER_OF]-(c:Complaint)
        RETURN cl.cluster_id AS cid,
               sum(coalesce(c.amount_inr,0)) AS agg_amount,
               sum(CASE WHEN c.liquidity_block THEN 1 ELSE 0 END) AS n_liquidity,
               count(c) AS n_members
    """)
    return {r["cid"]: r for r in rows}


def _velocity(run_query) -> dict[int, float]:
    """spike_ratio per complaint = (complaints in its ISO week for that RE) / (RE weekly mean)."""
    rows = run_query("""
        MATCH (c:Complaint)-[:FILED_AGAINST]->(e:Entity)
        RETURN e.screenid AS entity, c.complaintid AS id, c.created_date AS created
    """)
    per_entity_week: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    cid_week: dict[int, tuple] = {}
    for r in rows:
        wk = _iso_week(r["created"])
        if wk is None:
            continue
        per_entity_week[r["entity"]][wk] += 1
        cid_week[r["id"]] = (r["entity"], wk)

    baseline: dict[str, float] = {}
    for ent, weeks in per_entity_week.items():
        counts = list(weeks.values())
        baseline[ent] = (sum(counts) / len(counts)) if counts else 1.0

    ratio: dict[int, float] = {}
    for cid, (ent, wk) in cid_week.items():
        b = baseline.get(ent, 1.0) or 1.0
        ratio[cid] = per_entity_week[ent][wk] / b
    return ratio


_FEATURE_CYPHER = """
MATCH (c:Complaint) WHERE c.enriched = true
OPTIONAL MATCH (c)-[:FILED_AGAINST]->(e:Entity)
OPTIONAL MATCH (c)-[:MEMBER_OF]->(rc:Cluster {kind:'root_cause'})
OPTIONAL MATCH (c)-[:MEMBER_OF]->(xc:Cluster {kind:'cross_re_product'})
OPTIONAL MATCH (c)-[:HAS_EVENT]->(t:TimelineEvent)
WITH c, e, rc, xc,
     sum(CASE WHEN t.action='SECOND_LEVEL_REVIEW' THEN 1 ELSE 0 END) AS n_2nd,
     sum(CASE WHEN t.action IN ['FIRST_LEVEL_REVIEW','SECOND_LEVEL_REVIEW'] THEN 1 ELSE 0 END) AS n_review
RETURN c.complaintid AS id, c.severity AS severity, c.typology AS typology,
       c.typology_confidence AS typology_confidence, c.amount_inr AS amount, c.amount_basis AS amount_basis,
       c.is_misappropriation AS misapp, c.liquidity_block AS liquidity,
       c.class_harm_assertion AS class_harm, c.class_harm_estimate AS class_est,
       c.vulnerable AS vulnerable, c.vulnerability_flags AS vflags,
       c.market_integrity_risk AS integrity, c.distress AS distress, c.criminal_language AS criminal,
       c.escalation_intent AS esc_intent, c.senior_mgmt_allegation AS senior_mgmt,
       c.litigation_reference AS litigation, c.precedent_setting AS precedent,
       e.screenid AS entity, e.categorycode AS ecat, e.complaint_count AS ecount, e.entitytype AS etype,
       rc.cluster_id AS rc_id, rc.size AS cl_size, rc.n_states AS cl_states, rc.templated_frac AS cl_templated,
       xc.n_entities AS xre_entities, xc.size AS xre_size, n_2nd AS n_2nd, n_review AS n_review
LIMIT $limit
"""

_WRITE_CYPHER = """
UNWIND $rows AS r
MATCH (c:Complaint {complaintid: r.id})
SET c.scs = r.scs, c.tier = r.tier, c.tier_name = r.tier_name, c.f_multiplier = r.f_multiplier,
    c.hard_triggers = r.hard_triggers, c.subscores_json = r.subscores_json,
    c.scs_reasons_json = r.reasons_json, c.scored = true
"""

_CLUSTER_ROLLUP = """
MATCH (cl:Cluster)<-[:MEMBER_OF]-(c:Complaint) WHERE c.scored = true
WITH cl, max(c.tier) AS mtier, max(c.scs) AS mscs, count(c) AS n
SET cl.tier = mtier, cl.max_scs = mscs, cl.scored_members = n
"""


def run(limit: int) -> int:
    from config.defaults import ENTITY_WATCHLIST
    from graph.driver import close_driver, run_query, run_write_batched
    from scoring.engine import score_complaint

    t0 = time.time()
    logger.info("assembling context (MII, entity reviews, clusters, velocity) ...")
    mii = _mii_category_codes(run_query)
    e2nd = _entity_2nd_counts(run_query)
    clagg = _cluster_aggregates(run_query)
    spike = _velocity(run_query)
    watch = set(ENTITY_WATCHLIST)
    logger.info("MII categories=%d, entities-with-2nd-level=%d, clusters=%d",
                len(mii), len(e2nd), len(clagg))

    feats = run_query(_FEATURE_CYPHER, limit=limit)
    logger.info("scoring %d enriched complaints ...", len(feats))

    rows: list[dict] = []
    for f in feats:
        agg = clagg.get(f.get("rc_id")) or {}
        f["is_mii"] = f.get("ecat") in mii
        f["watchlist"] = f.get("entity") in watch
        f["entity_2nd_count"] = e2nd.get(f.get("entity"), 0)
        f["spike_ratio"] = spike.get(f["id"], 1.0)
        f["cl_agg_amount"] = agg.get("agg_amount", 0)
        f["cl_n_liquidity"] = agg.get("n_liquidity", 0)
        f["cl_n_members"] = agg.get("n_members", 0)
        f["reopen"] = f.get("n_review", 0)

        res = score_complaint(f)
        rows.append({
            "id": f["id"], "scs": res["scs"], "tier": res["tier"], "tier_name": res["tier_name"],
            "f_multiplier": res["f_multiplier"], "hard_triggers": res["hard_triggers"],
            "subscores_json": json.dumps(res["subscores"]), "reasons_json": json.dumps(res["reasons"]),
        })

    run_write_batched(_WRITE_CYPHER, rows, batch_size=1000)
    run_query(_CLUSTER_ROLLUP)

    _print_tiers(run_query)
    logger.info("── scoring done in %.0fs (%d complaints) ──", time.time() - t0, len(rows))
    close_driver()
    return 0


def _print_tiers(run_query) -> None:
    print("\n===== TIER DISTRIBUTION (scored complaints) =====")
    dist = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true
        RETURN c.tier AS tier, c.tier_name AS name, count(*) AS n ORDER BY tier DESC
    """)
    for d in dist:
        print(f"  Tier {d['tier']} {d['name']}: {d['n']}")
    ht = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true AND size(c.hard_triggers) > 0
        RETURN count(*) AS n
    """)
    print(f"  complaints with >=1 hard trigger: {ht[0]['n']}")
    top = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true
        RETURN c.complaintid AS id, c.scs AS scs, c.tier_name AS tier, c.typology AS typology,
               c.hard_triggers AS triggers ORDER BY c.scs DESC LIMIT 5
    """)
    print("  top by SCS:")
    for t in top:
        print(f"    [{t['id']}] SCS={t['scs']} {t['tier']} | {t['typology']} | triggers={t['triggers']}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Compute Systemic-Criticality Scores")
    ap.add_argument("--limit", type=int, default=1_000_000)
    args = ap.parse_args()
    try:
        return run(args.limit)
    except Exception:  # noqa: BLE001
        logger.exception("scoring failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
