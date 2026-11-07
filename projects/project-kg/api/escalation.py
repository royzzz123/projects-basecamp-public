"""The /kg API — serves the auto-escalation dashboard from Neo4j.

Read-only endpoints. Handlers are sync `def` so FastAPI runs them in its
threadpool (the Neo4j driver here is synchronous).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from config.defaults import DIMENSION_NAMES, DIMENSION_WEIGHTS, HARD_TRIGGERS, TIER_BANDS
from graph.driver import run_query
from graph.ontology import NODE_LABELS, RELATIONSHIP_TYPES
from schemas.api import parse_json_field

router = APIRouter(prefix="/kg")


# ── Ontology + framework config (for the UI's browser / legend) ────────────
@router.get("/ontology")
def ontology() -> dict:
    return {
        "node_labels": NODE_LABELS,
        "relationship_types": RELATIONSHIP_TYPES,
        "dimensions": [
            {"key": k, "name": DIMENSION_NAMES[k], "weight": DIMENSION_WEIGHTS.get(k)}
            for k in DIMENSION_NAMES
        ],
        "tiers": [
            {"index": idx, "name": n, "band": [lo, hi], "meaning": m, "routing": s}
            for lo, hi, idx, n, m, s in TIER_BANDS
        ],
        "hard_triggers": HARD_TRIGGERS,
    }


# ── KPI summary for the dashboard header ───────────────────────────────────
@router.get("/kpis")
def kpis() -> dict:
    tiers = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true
        RETURN c.tier AS tier, c.tier_name AS name, count(*) AS n ORDER BY tier DESC
    """)
    totals = run_query("""
        MATCH (c:Complaint)
        RETURN count(*) AS total,
               sum(CASE WHEN c.enriched = true THEN 1 ELSE 0 END) AS enriched,
               sum(CASE WHEN c.scored = true THEN 1 ELSE 0 END) AS scored
    """)[0]
    triggers = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true AND size(c.hard_triggers) > 0
        RETURN count(*) AS n
    """)[0]["n"]
    clusters = run_query("""
        MATCH (cl:Cluster) RETURN cl.kind AS kind, count(*) AS n
    """)
    severity = run_query("""
        MATCH (c:Complaint) WHERE c.enriched = true
        RETURN c.severity AS severity, count(*) AS n ORDER BY n DESC
    """)
    top_entities = run_query("""
        MATCH (c:Complaint)-[:FILED_AGAINST]->(e:Entity)
        WHERE c.scored = true AND c.tier >= 2
        RETURN e.name AS entity, e.screenid AS entity_id, count(*) AS escalations,
               sum(CASE WHEN c.tier = 3 THEN 1 ELSE 0 END) AS critical
        ORDER BY escalations DESC LIMIT 10
    """)
    return {
        "totals": totals,
        "tiers": tiers,
        "hard_trigger_complaints": triggers,
        "clusters": {c["kind"]: c["n"] for c in clusters},
        "severity": {s["severity"]: s["n"] for s in severity},
        "top_entities": top_entities,
    }


# ── The escalation queue (Tier 2/3, ranked by SCS) ─────────────────────────
@router.get("/queue")
def queue(
    min_tier: int = Query(2, ge=0, le=3),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    entity: str | None = None,
) -> dict:
    where_entity = "AND e.screenid = $entity" if entity else ""
    rows = run_query(f"""
        MATCH (c:Complaint)-[:FILED_AGAINST]->(e:Entity)
        WHERE c.scored = true AND c.tier >= $min_tier {where_entity}
        OPTIONAL MATCH (c)-[:MEMBER_OF]->(cl:Cluster {{kind:'root_cause'}})
        RETURN c.complaintid AS id, c.scs AS scs, c.tier AS tier, c.tier_name AS tier_name,
               c.typology AS typology, c.severity AS severity, c.hard_triggers AS hard_triggers,
               c.evidence_quote AS evidence, c.created_date AS created,
               e.name AS entity, e.screenid AS entity_id,
               cl.cluster_id AS cluster_id, cl.size AS cluster_size
        ORDER BY c.scs DESC, c.tier DESC
        SKIP $offset LIMIT $limit
    """, min_tier=min_tier, entity=entity, offset=offset, limit=limit)
    total = run_query(f"""
        MATCH (c:Complaint)-[:FILED_AGAINST]->(e:Entity)
        WHERE c.scored = true AND c.tier >= $min_tier {where_entity}
        RETURN count(*) AS n
    """, min_tier=min_tier, entity=entity)[0]["n"]
    for r in rows:
        r["created"] = str(r["created"]) if r["created"] else None
    return {"total": total, "count": len(rows), "items": rows}


# ── Full SCS breakdown for one complaint (explainability) ──────────────────
@router.get("/complaint/{complaint_id}")
def complaint(complaint_id: int) -> dict:
    rows = run_query("""
        MATCH (c:Complaint {complaintid: $id})
        OPTIONAL MATCH (c)-[:FILED_AGAINST]->(e:Entity)
        OPTIONAL MATCH (c)-[:MEMBER_OF]->(cl:Cluster)
        OPTIONAL MATCH (c)-[:IMPLICATES]->(p:Product)
        RETURN c AS c, e.name AS entity, e.screenid AS entity_id,
               collect(DISTINCT {kind: cl.kind, cluster_id: cl.cluster_id, size: cl.size, tier: cl.tier}) AS clusters,
               collect(DISTINCT {type: p.type, value: p.value}) AS products
    """, id=complaint_id)
    if not rows:
        raise HTTPException(status_code=404, detail="complaint not found")
    r = rows[0]
    c = dict(r["c"])
    created = c.get("created_date")
    return {
        "complaintid": c.get("complaintid"),
        "code": c.get("code"),
        "details": c.get("details"),
        "category_code": c.get("category_code"),
        "sub_category": c.get("sub_category"),
        "state_code": c.get("state_code"),
        "created_date": str(created) if created else None,
        "entity": r["entity"],
        "entity_id": r["entity_id"],
        "ai_summary": c.get("ai_summary"),
        "scoring": {
            "scs": c.get("scs"),
            "tier": c.get("tier"),
            "tier_name": c.get("tier_name"),
            "f_multiplier": c.get("f_multiplier"),
            "subscores": parse_json_field(c.get("subscores_json"), {}),
            "hard_triggers": c.get("hard_triggers") or [],
            "reasons": parse_json_field(c.get("scs_reasons_json"), {}),
        },
        "signals": {
            "severity": c.get("severity"), "typology": c.get("typology"),
            "typology_confidence": c.get("typology_confidence"),
            "amount_inr": c.get("amount_inr"), "is_misappropriation": c.get("is_misappropriation"),
            "liquidity_block": c.get("liquidity_block"), "class_harm_assertion": c.get("class_harm_assertion"),
            "vulnerable": c.get("vulnerable"), "vulnerability_flags": c.get("vulnerability_flags"),
            "market_integrity_risk": c.get("market_integrity_risk"), "distress": c.get("distress"),
            "criminal_language": c.get("criminal_language"), "escalation_intent": c.get("escalation_intent"),
            "senior_mgmt_allegation": c.get("senior_mgmt_allegation"),
            "evidence_quote": c.get("evidence_quote"), "reasoning": c.get("enrich_reasoning"),
        },
        "clusters": [cl for cl in r["clusters"] if cl.get("cluster_id")],
        "products": [p for p in r["products"] if p.get("value")],
    }


# ── Cluster detail (consolidated case-file) ────────────────────────────────
@router.get("/cluster/{cluster_id}")
def cluster(cluster_id: str) -> dict:
    rows = run_query("""
        MATCH (cl:Cluster {cluster_id: $id})
        OPTIONAL MATCH (cl)-[:AGAINST]->(e:Entity)
        OPTIONAL MATCH (cl)<-[:MEMBER_OF]-(c:Complaint)
        WITH cl, e, c ORDER BY c.scs DESC
        RETURN cl AS cl, e.name AS entity, e.screenid AS entity_id,
               collect({id: c.complaintid, scs: c.scs, tier: c.tier, typology: c.typology,
                        state: c.state_code, evidence: c.evidence_quote})[..100] AS members
    """, id=cluster_id)
    if not rows or not rows[0]["cl"]:
        raise HTTPException(status_code=404, detail="cluster not found")
    r = rows[0]
    cl = dict(r["cl"])
    return {
        "cluster_id": cl.get("cluster_id"),
        "kind": cl.get("kind"),
        "entity": r["entity"],
        "entity_id": r["entity_id"],
        "size": cl.get("size"),
        "n_states": cl.get("n_states"),
        "states": cl.get("states"),
        "templated_frac": cl.get("templated_frac"),
        "tier": cl.get("tier"),
        "max_scs": cl.get("max_scs"),
        "n_entities": cl.get("n_entities"),
        "product_key": cl.get("product_key"),
        "created_min": str(cl.get("created_min")) if cl.get("created_min") else None,
        "created_max": str(cl.get("created_max")) if cl.get("created_max") else None,
        "members": [m for m in r["members"] if m.get("id")],
    }


# ── RE-conduct panel (Dimension D/I) ───────────────────────────────────────
@router.get("/entity/{entity_id}/conduct")
def entity_conduct(entity_id: str) -> dict:
    base = run_query("""
        MATCH (e:Entity {screenid: $id})
        OPTIONAL MATCH (e)<-[:FILED_AGAINST]-(c:Complaint)
        RETURN e.name AS name, e.entitytype AS type, e.categorycode AS category,
               count(c) AS total,
               sum(CASE WHEN c.tier = 3 THEN 1 ELSE 0 END) AS critical,
               sum(CASE WHEN c.tier >= 2 THEN 1 ELSE 0 END) AS priority_plus,
               sum(CASE WHEN c.liquidity_block = true THEN 1 ELSE 0 END) AS liquidity_blocks
    """, id=entity_id)
    if not base or base[0]["name"] is None:
        raise HTTPException(status_code=404, detail="entity not found")
    second_level = run_query("""
        MATCH (e:Entity {screenid: $id})<-[:FILED_AGAINST]-(c:Complaint)-[:HAS_EVENT]->(t:TimelineEvent {action:'SECOND_LEVEL_REVIEW'})
        RETURN count(DISTINCT c) AS n
    """, id=entity_id)[0]["n"]
    typologies = run_query("""
        MATCH (e:Entity {screenid: $id})<-[:FILED_AGAINST]-(c:Complaint)-[:ALLEGES]->(ty:Typology)
        RETURN ty.name AS typology, ty.severity AS severity, count(*) AS n ORDER BY n DESC LIMIT 8
    """, id=entity_id)
    return {**base[0], "second_level_reviews": second_level, "top_typologies": typologies}


# ── Subgraph for the knowledge-graph explorer ──────────────────────────────
@router.get("/graph/complaint/{complaint_id}")
def subgraph(complaint_id: int, neighbors: int = Query(6, ge=0, le=20)) -> dict:
    rows = run_query("""
        MATCH (c:Complaint {complaintid: $id})
        OPTIONAL MATCH (c)-[:FILED_AGAINST]->(e:Entity)
        OPTIONAL MATCH (c)-[:IN_CATEGORY]->(cat:Category)
        OPTIONAL MATCH (c)-[:LOCATED_IN]->(l:Location)
        OPTIONAL MATCH (c)-[:ALLEGES]->(ty:Typology)
        OPTIONAL MATCH (c)-[:MEMBER_OF]->(cl:Cluster)
        OPTIONAL MATCH (c)-[:IMPLICATES]->(p:Product)
        OPTIONAL MATCH (c)-[s:SIMILAR_TO]-(sim:Complaint)
        WITH c, e, cat, l, ty, cl, collect(DISTINCT p)[..5] AS prods,
             collect(DISTINCT {n: sim, score: s.score})[..$neighbors] AS sims
        RETURN c, e, cat, l, ty, cl, prods, sims
    """, id=complaint_id, neighbors=neighbors)
    if not rows:
        raise HTTPException(status_code=404, detail="complaint not found")
    r = rows[0]
    nodes: list[dict] = []
    edges: list[dict] = []
    seen: set[str] = set()

    def add_node(nid: str, label: str, ntype: str, props: dict | None = None):
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "label": label, "type": ntype, "props": props or {}})

    cid = f"complaint:{complaint_id}"
    c = dict(r["c"])
    add_node(cid, str(complaint_id), "Complaint",
             {"scs": c.get("scs"), "tier": c.get("tier"), "severity": c.get("severity"),
              "typology": c.get("typology")})
    for key, ntype, labelfn in (
        ("e", "Entity", lambda n: n.get("name")),
        ("cat", "Category", lambda n: n.get("name")),
        ("l", "Location", lambda n: n.get("state_name") or n.get("key")),
        ("ty", "Typology", lambda n: n.get("name")),
        ("cl", "Cluster", lambda n: n.get("cluster_id")),
    ):
        node = r[key]
        if node:
            nd = dict(node)
            key_id = f"{ntype.lower()}:{nd.get('screenid') or nd.get('code') or nd.get('key') or nd.get('name') or nd.get('cluster_id')}"
            add_node(key_id, str(labelfn(nd)), ntype, nd)
            rel = {"Entity": "FILED_AGAINST", "Category": "IN_CATEGORY", "Location": "LOCATED_IN",
                   "Typology": "ALLEGES", "Cluster": "MEMBER_OF"}[ntype]
            edges.append({"source": cid, "target": key_id, "type": rel})
    for p in r["prods"]:
        pd = dict(p)
        pid = f"product:{pd.get('key')}"
        add_node(pid, pd.get("value"), "Product", pd)
        edges.append({"source": cid, "target": pid, "type": "IMPLICATES"})
    for sim in r["sims"]:
        n = sim.get("n")
        if not n:
            continue
        nd = dict(n)
        sid = f"complaint:{nd.get('complaintid')}"
        add_node(sid, str(nd.get("complaintid")), "Complaint",
                 {"scs": nd.get("scs"), "tier": nd.get("tier"), "typology": nd.get("typology")})
        edges.append({"source": cid, "target": sid, "type": "SIMILAR_TO", "score": sim.get("score")})
    return {"nodes": nodes, "edges": edges}


# ── Overview graph for the hero visualisation ──────────────────────────────
@router.get("/graph/overview")
def graph_overview(min_tier: int = Query(2, ge=0, le=3), limit: int = Query(160, ge=10, le=400)) -> dict:
    rows = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true AND c.tier >= $min_tier
        WITH c ORDER BY c.scs DESC LIMIT $limit
        OPTIONAL MATCH (c)-[:FILED_AGAINST]->(e:Entity)
        OPTIONAL MATCH (c)-[:ALLEGES]->(ty:Typology)
        OPTIONAL MATCH (c)-[:MEMBER_OF]->(cl:Cluster {kind:'root_cause'})
        RETURN c.complaintid AS id, c.scs AS scs, c.tier AS tier, c.typology AS ctyp,
               e.screenid AS eid, e.name AS ename, ty.name AS tyname, ty.severity AS tysev,
               cl.cluster_id AS clid, cl.size AS clsize
    """, min_tier=min_tier, limit=limit)

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    deg: dict[str, int] = {}

    def touch(nid, label, ntype, props):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "label": label, "type": ntype, "props": props}
            deg[nid] = 0

    for r in rows:
        cid = f"c:{r['id']}"
        touch(cid, str(r["id"]), "Complaint",
              {"scs": r["scs"], "tier": r["tier"], "typology": r["ctyp"]})
        if r["eid"]:
            eid = f"e:{r['eid']}"
            touch(eid, r["ename"] or r["eid"], "Entity", {"screenid": r["eid"]})
            edges.append({"source": cid, "target": eid, "type": "FILED_AGAINST"})
            deg[eid] += 1; deg[cid] += 1
        if r["tyname"]:
            tid = f"t:{r['tyname']}"
            touch(tid, r["tyname"], "Typology", {"severity": r["tysev"]})
            edges.append({"source": cid, "target": tid, "type": "ALLEGES"})
            deg[tid] += 1; deg[cid] += 1
        if r["clid"]:
            clid = f"cl:{r['clid']}"
            touch(clid, f"cluster·{r['clsize']}", "Cluster", {"size": r["clsize"]})
            edges.append({"source": cid, "target": clid, "type": "MEMBER_OF"})
            deg[clid] += 1; deg[cid] += 1

    for nid, n in nodes.items():
        n["degree"] = deg.get(nid, 0)
    return {"nodes": list(nodes.values()), "edges": edges,
            "meta": {"complaints": sum(1 for n in nodes.values() if n["type"] == "Complaint"),
                     "entities": sum(1 for n in nodes.values() if n["type"] == "Entity")}}


# ── Ranked clusters (the "topical clusters" analytics list) ────────────────
@router.get("/clusters")
def clusters_list(limit: int = Query(24, ge=1, le=100)) -> dict:
    rows = run_query("""
        MATCH (cl:Cluster {kind:'root_cause'})
        OPTIONAL MATCH (cl)-[:AGAINST]->(e:Entity)
        RETURN cl.cluster_id AS id, cl.size AS size, cl.n_states AS states,
               coalesce(cl.tier, 0) AS tier, coalesce(cl.templated_frac, 0.0) AS templated,
               e.name AS entity
        ORDER BY tier DESC, size DESC LIMIT $limit
    """, limit=limit)
    total = run_query("""
        MATCH (cl:Cluster {kind:'root_cause'}) RETURN coalesce(sum(cl.size),0) AS s
    """)[0]["s"] or 1
    for r in rows:
        r["share"] = round(100.0 * (r["size"] or 0) / total, 1)
    return {"clusters": rows, "total_members": total}


# ── Escalation drivers (Dimensions tab) ────────────────────────────────────
@router.get("/drivers")
def drivers() -> dict:
    trg = run_query("""
        MATCH (c:Complaint) WHERE c.scored = true AND size(c.hard_triggers) > 0
        UNWIND c.hard_triggers AS t
        WITH split(t, ':')[0] AS dim, count(*) AS n
        RETURN dim, n ORDER BY n DESC
    """)
    flags: dict[str, int] = {}
    for f in ["is_misappropriation", "liquidity_block", "market_integrity_risk",
              "class_harm_assertion", "vulnerable", "criminal_language", "distress",
              "senior_mgmt_allegation"]:
        flags[f] = run_query(
            f"MATCH (c:Complaint) WHERE c.enriched = true AND c.{f} = true RETURN count(*) AS n"
        )[0]["n"]
    enriched = run_query("MATCH (c:Complaint) WHERE c.enriched = true RETURN count(*) AS n")[0]["n"]
    return {"triggers_by_dimension": trg, "signal_prevalence": flags, "enriched": enriched}
