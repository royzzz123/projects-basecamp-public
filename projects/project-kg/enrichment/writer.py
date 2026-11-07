"""Persist extracted dimension signals onto the graph.

Sets signal properties on the Complaint node and materialises the AI-derived
triples: (Complaint)-[:ALLEGES]->(Typology) and (Complaint)-[:IMPLICATES]->(Product).
"""
from __future__ import annotations

from graph.driver import run_write_multi

_SIGNALS_CYPHER = """
UNWIND $rows AS r
MATCH (c:Complaint {complaintid: r.complaintid})
SET c.severity = r.severity,
    c.typology = r.typology,
    c.typology_confidence = r.typology_confidence,
    c.amount_inr = r.amount_inr,
    c.amount_basis = r.amount_basis,
    c.is_misappropriation = r.is_misappropriation,
    c.liquidity_block = r.liquidity_block,
    c.class_harm_assertion = r.class_harm_assertion,
    c.class_harm_estimate = r.class_harm_estimate,
    c.vulnerable = r.vulnerable,
    c.vulnerability_flags = r.vulnerability_flags,
    c.market_integrity_risk = r.market_integrity_risk,
    c.distress = r.distress,
    c.criminal_language = r.criminal_language,
    c.escalation_intent = r.escalation_intent,
    c.sentiment = r.sentiment,
    c.senior_mgmt_allegation = r.senior_mgmt_allegation,
    c.litigation_reference = r.litigation_reference,
    c.precedent_setting = r.precedent_setting,
    c.evidence_quote = r.evidence_quote,
    c.enrich_reasoning = r.reasoning,
    c.enriched = true,
    c.enriched_model = r.model
FOREACH (_ IN CASE WHEN r.severity IN ['Grave','High','Moderate'] AND r.typology <> '' THEN [1] ELSE [] END |
    MERGE (ty:Typology {name: r.typology})
    SET ty.severity = r.severity
    MERGE (c)-[:ALLEGES]->(ty)
)
"""

_PRODUCTS_CYPHER = """
UNWIND $rows AS r
UNWIND r.products AS p
WITH r, p WHERE p.value IS NOT NULL AND trim(p.value) <> ''
MATCH (c:Complaint {complaintid: r.complaintid})
MERGE (pr:Product {key: toLower(p.type) + ':' + toLower(trim(p.value))})
SET pr.type = p.type, pr.value = p.value
MERGE (c)-[:IMPLICATES]->(pr)
"""


def write_signals(rows: list[dict]) -> int:
    """rows: complaint signal dicts including complaintid, all signal fields, products[], model."""
    if not rows:
        return 0
    return run_write_multi([_SIGNALS_CYPHER, _PRODUCTS_CYPHER], rows, batch_size=200)
