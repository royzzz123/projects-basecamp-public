"""Deterministic ETL: project MongoDB documents into the Neo4j knowledge graph.

No LLM here — only structural nodes and relationships that follow directly from
the source data. Enrichment (typology, amounts, clusters, scores) is layered on
in later phases.
"""
from __future__ import annotations

import hashlib
import logging

from config.settings import settings
from etl import mongo_reader
from etl.locations import parse_location
from graph.driver import run_write_batched, run_write_multi

logger = logging.getLogger(__name__)


def _investor_hash(complainant_id) -> str:
    return hashlib.sha256(str(complainant_id).encode()).hexdigest()[:16]


# ── Master data ────────────────────────────────────────────────────────────
_CATEGORY_CYPHER = """
UNWIND $rows AS r
MERGE (c:Category {code: r.code})
SET c.name = r.name
"""

_SUBCATEGORY_CYPHER = """
UNWIND $rows AS r
MERGE (s:SubCategory {name: r.name})
"""

_ENTITY_CYPHER = """
UNWIND $rows AS r
MERGE (e:Entity {screenid: r.screenid})
SET e.name = r.name,
    e.registrationnumber = r.registrationnumber,
    e.entitytype = r.entitytype,
    e.categorycode = r.categorycode,
    e.complaint_count = r.complaint_count,
    e.active = r.active,
    e.isin = r.isin
"""

_ENTITY_CATEGORY_CYPHER = """
UNWIND $rows AS r
WITH r WHERE r.categorycode IS NOT NULL
MATCH (e:Entity {screenid: r.screenid})
MATCH (cat:Category {code: r.categorycode})
MERGE (e)-[:IN_CATEGORY]->(cat)
"""


def load_master_data() -> dict[str, int]:
    cats = mongo_reader.read_categories()
    subs = mongo_reader.read_subcategories()
    ents = mongo_reader.read_entities()

    n_cat = run_write_batched(_CATEGORY_CYPHER, cats, batch_size=500)
    n_sub = run_write_batched(_SUBCATEGORY_CYPHER, subs, batch_size=500)
    n_ent = run_write_batched(_ENTITY_CYPHER, ents, batch_size=1000)
    run_write_batched(_ENTITY_CATEGORY_CYPHER, ents, batch_size=1000)

    logger.info("masters: %d categories, %d subcategories, %d entities", n_cat, n_sub, n_ent)
    return {"categories": n_cat, "subcategories": n_sub, "entities": n_ent}


# ── Complaints (node + all structural relationships, per batch) ────────────
_COMPLAINT_NODE_CYPHER = """
UNWIND $rows AS r
MERGE (c:Complaint {complaintid: r.complaintid})
SET c.code = r.code,
    c.category_code = r.category_code,
    c.sub_category = r.sub_category,
    c.details = r.details,
    c.created_date = r.created_date,
    c.closed_date = r.closed_date,
    c.modified_date = r.modified_date,
    c.wfstate = r.wfstate,
    c.status = r.status,
    c.currentaction = r.currentaction,
    c.entity_screenid = r.entity_screenid,
    c.state_code = r.state_code,
    c.district_code = r.district_code,
    c.time_taken_days = r.time_taken_days
"""

_COMPLAINT_INVESTOR_CYPHER = """
UNWIND $rows AS r
MATCH (c:Complaint {complaintid: r.complaintid})
MERGE (i:Investor {id_hash: r.investor_hash})
MERGE (c)-[:FILED_BY]->(i)
"""

_COMPLAINT_ENTITY_CYPHER = """
UNWIND $rows AS r
WITH r WHERE r.entity_screenid IS NOT NULL
MATCH (c:Complaint {complaintid: r.complaintid})
MATCH (e:Entity {screenid: r.entity_screenid})
MERGE (c)-[:FILED_AGAINST]->(e)
"""

_COMPLAINT_CATEGORY_CYPHER = """
UNWIND $rows AS r
WITH r WHERE r.category_code IS NOT NULL
MATCH (c:Complaint {complaintid: r.complaintid})
MATCH (cat:Category {code: r.category_code})
MERGE (c)-[:IN_CATEGORY]->(cat)
"""

_COMPLAINT_SUBCATEGORY_CYPHER = """
UNWIND $rows AS r
WITH r WHERE r.sub_category IS NOT NULL
MATCH (c:Complaint {complaintid: r.complaintid})
MERGE (s:SubCategory {name: r.sub_category})
MERGE (c)-[:IN_SUBCATEGORY]->(s)
"""

_COMPLAINT_LOCATION_CYPHER = """
UNWIND $rows AS r
WITH r WHERE r.location_key IS NOT NULL
MATCH (c:Complaint {complaintid: r.complaintid})
MERGE (l:Location {key: r.location_key})
SET l.state_code = r.state_code, l.state_name = r.state_name, l.district_code = r.district_code
MERGE (c)-[:LOCATED_IN]->(l)
"""

_COMPLAINT_STATEMENTS = [
    _COMPLAINT_NODE_CYPHER,
    _COMPLAINT_INVESTOR_CYPHER,
    _COMPLAINT_ENTITY_CYPHER,
    _COMPLAINT_CATEGORY_CYPHER,
    _COMPLAINT_SUBCATEGORY_CYPHER,
    _COMPLAINT_LOCATION_CYPHER,
]


def _complaint_row(d: dict) -> dict:
    created = d.get("created_date")
    closed = d.get("date_of_closure")
    time_taken_days = None
    if created and closed:
        time_taken_days = round((closed - created).total_seconds() / 86400.0, 2)

    entity_screenid = d.get("entityscreenid") or d.get("company_name")
    loc = parse_location(d.get("complaint_code"))
    sub = d.get("complaint_sub_category")

    return {
        "complaintid": d.get("complaintid"),
        "code": d.get("complaint_code"),
        "category_code": d.get("complaint_category"),
        "sub_category": sub,
        "details": d.get("complaint_details"),
        "created_date": created,
        "closed_date": closed,
        "modified_date": d.get("modified_date"),
        "wfstate": d.get("wfstate"),
        "status": d.get("status"),
        "currentaction": d.get("currentaction"),
        "entity_screenid": entity_screenid,
        "investor_hash": _investor_hash(d.get("complainant_id") or d.get("userid")),
        "state_code": loc["state_code"] if loc else None,
        "state_name": loc["state_name"] if loc else None,
        "district_code": loc["district_code"] if loc else None,
        "location_key": loc["key"] if loc else None,
    }


def load_complaints(limit: int | None = None) -> tuple[int, set[int]]:
    rows: list[dict] = []
    ids: set[int] = set()
    for d in mongo_reader.iter_complaints(limit=limit):
        row = _complaint_row(d)
        if row["complaintid"] is None:
            continue
        rows.append(row)
        ids.add(row["complaintid"])

    n = run_write_multi(_COMPLAINT_STATEMENTS, rows, batch_size=settings.etl_batch_complaints)
    logger.info("complaints: %d loaded", n)
    return n, ids


# ── Timeline events (tr_complaints -> TimelineEvent) ───────────────────────
_EVENT_CYPHER = """
UNWIND $rows AS r
MATCH (c:Complaint {complaintid: r.complaintid})
MERGE (t:TimelineEvent {logid: r.logid})
SET t.complaintid = r.complaintid,
    t.action = r.action,
    t.wfstate = r.wfstate,
    t.role = r.role,
    t.at = r.at,
    t.remarks = r.remarks,
    t.has_docs = r.has_docs
MERGE (c)-[:HAS_EVENT]->(t)
"""


def _event_row(d: dict) -> dict:
    doc_url = d.get("doc_url")
    has_docs = bool(doc_url) and doc_url not in ("[]", "")
    return {
        "logid": d.get("logid"),
        "complaintid": d.get("complaintid"),
        "action": d.get("action"),
        "wfstate": d.get("wfstate"),
        "role": d.get("role") or d.get("currentassignerole"),
        "at": d.get("created_date"),
        "remarks": d.get("remarks"),
        "has_docs": has_docs,
    }


def load_timeline_events(complaint_ids: set[int] | None = None) -> int:
    rows = [_event_row(d) for d in mongo_reader.iter_tr_events(complaint_ids)]
    rows = [r for r in rows if r["logid"] is not None and r["complaintid"] is not None]
    n = run_write_batched(_EVENT_CYPHER, rows, batch_size=settings.etl_batch_events)
    logger.info("timeline events: %d loaded", n)
    return n
