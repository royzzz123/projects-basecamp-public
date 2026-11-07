"""The knowledge-graph ontology for SCORES complaints.

Nodes (subjects / objects) and relationships (predicates) — the "triples" the
engine reasons over. Structural nodes/edges are built deterministically by the
ETL (Phase 1); enrichment nodes (Typology, Product, Cluster, MarketEvent) and
score properties are added by later phases.

    (Complaint)-[:FILED_AGAINST]->(Entity)          # which RE
    (Complaint)-[:FILED_BY]->(Investor)             # pseudonymised complainant
    (Complaint)-[:IN_CATEGORY]->(Category)          # SEBI category
    (Complaint)-[:IN_SUBCATEGORY]->(SubCategory)    # SEBI sub-category
    (Complaint)-[:LOCATED_IN]->(Location)           # state / district
    (Complaint)-[:HAS_EVENT]->(TimelineEvent)       # workflow / ATR log
    (Entity)-[:IN_CATEGORY]->(Category)             # RE classification

    # added by later phases:
    (Complaint)-[:ALLEGES]->(Typology)              # C — severity library
    (Complaint)-[:IMPLICATES]->(Product)            # A — scheme / ISIN / IPO / app
    (Complaint)-[:SIMILAR_TO {score}]->(Complaint)  # A/H — semantic similarity
    (Complaint)-[:MEMBER_OF]->(Cluster)             # A/E — consolidated case-file
    (Cluster)-[:AGAINST]->(Entity)                  # cluster's RE
    (Cluster)-[:ON_PRODUCT]->(Product)              # cross-RE product cluster
"""
from __future__ import annotations

# Node labels and the relationship types in the ontology — also surfaced to the
# UI's ontology browser.
NODE_LABELS: list[str] = [
    "Complaint", "Entity", "Investor", "Category", "SubCategory",
    "Location", "TimelineEvent", "Typology", "Product", "Cluster", "MarketEvent",
]

RELATIONSHIP_TYPES: list[str] = [
    "FILED_AGAINST", "FILED_BY", "IN_CATEGORY", "IN_SUBCATEGORY", "LOCATED_IN",
    "HAS_EVENT", "ALLEGES", "IMPLICATES", "SIMILAR_TO", "MEMBER_OF",
    "AGAINST", "ON_PRODUCT",
]

CONSTRAINTS: list[str] = [
    "CREATE CONSTRAINT complaint_id IF NOT EXISTS FOR (c:Complaint) REQUIRE c.complaintid IS UNIQUE",
    "CREATE CONSTRAINT entity_screenid IF NOT EXISTS FOR (e:Entity) REQUIRE e.screenid IS UNIQUE",
    "CREATE CONSTRAINT category_code IF NOT EXISTS FOR (c:Category) REQUIRE c.code IS UNIQUE",
    "CREATE CONSTRAINT subcategory_name IF NOT EXISTS FOR (s:SubCategory) REQUIRE s.name IS UNIQUE",
    "CREATE CONSTRAINT investor_hash IF NOT EXISTS FOR (i:Investor) REQUIRE i.id_hash IS UNIQUE",
    "CREATE CONSTRAINT location_key IF NOT EXISTS FOR (l:Location) REQUIRE l.key IS UNIQUE",
    "CREATE CONSTRAINT event_logid IF NOT EXISTS FOR (t:TimelineEvent) REQUIRE t.logid IS UNIQUE",
    "CREATE CONSTRAINT typology_name IF NOT EXISTS FOR (t:Typology) REQUIRE t.name IS UNIQUE",
    "CREATE CONSTRAINT product_key IF NOT EXISTS FOR (p:Product) REQUIRE p.key IS UNIQUE",
    "CREATE CONSTRAINT cluster_id IF NOT EXISTS FOR (cl:Cluster) REQUIRE cl.cluster_id IS UNIQUE",
]

INDEXES: list[str] = [
    "CREATE INDEX complaint_created IF NOT EXISTS FOR (c:Complaint) ON (c.created_date)",
    "CREATE INDEX complaint_entity IF NOT EXISTS FOR (c:Complaint) ON (c.entity_screenid)",
    "CREATE INDEX complaint_scs IF NOT EXISTS FOR (c:Complaint) ON (c.scs)",
    "CREATE INDEX complaint_tier IF NOT EXISTS FOR (c:Complaint) ON (c.tier)",
    "CREATE INDEX complaint_category IF NOT EXISTS FOR (c:Complaint) ON (c.category_code)",
    "CREATE INDEX event_action IF NOT EXISTS FOR (t:TimelineEvent) ON (t.action)",
    "CREATE INDEX entity_category IF NOT EXISTS FOR (e:Entity) ON (e.categorycode)",
]


def apply_ontology() -> None:
    """Idempotently create all constraints and indexes."""
    from graph.driver import run_statements

    run_statements(CONSTRAINTS)
    run_statements(INDEXES)
