"""SCORES Systemic-Criticality Auto-Escalation Framework — default parameters.

Every value here is a *configurable default* transcribed from the OnFinance
"Systemic-Criticality Auto-Escalation Framework" v1.0 spec. SEBI can tune each
one; the tuning UI is deferred (Q4 decision), so this file is the single source
of truth the scoring engine reads. Monetary values are stored in rupees.
"""
from __future__ import annotations

CRORE = 10_000_000
LAKH = 100_000

# ── §15.1 Composite scoring — additive dimension weights (sum = 100) ───────
# Dimension F (Vulnerability) is intentionally absent: it is a *capped
# multiplier* applied to the additive subtotal, never an additive term.
DIMENSION_WEIGHTS: dict[str, int] = {
    "A": 18,  # Scale / Mass-Population Impact
    "B": 16,  # Financial Magnitude
    "C": 16,  # Fraud & Severity Typology
    "D": 10,  # Entity Systemic Importance
    "E": 10,  # Velocity & Emergent Patterns
    "G": 10,  # Market-Integrity & Contagion
    "I": 8,   # Process & Resolution Failure
    "J": 6,   # Cross-Portal & External Correlation
    "H": 3,   # Distress & Escalation Signals
    "K": 3,   # Legal & Reputational Sensitivity
}

DIMENSION_NAMES: dict[str, str] = {
    "A": "Scale / Mass-Population Impact",
    "B": "Financial Magnitude",
    "C": "Fraud & Severity Typology",
    "D": "Entity Systemic Importance & Risk",
    "E": "Velocity & Emergent Patterns",
    "F": "Vulnerable-Investor Impact",
    "G": "Market-Integrity & Contagion Risk",
    "H": "Distress, Coordination & Escalation-Intent",
    "I": "Process & Resolution Failure",
    "J": "Cross-Portal & External Correlation",
    "K": "Legal, Reputational & Regulatory Sensitivity",
}

# Dimension F — capped multiplier on the additive subtotal (§9, §15.1).
VULNERABILITY_MULTIPLIER_MAX = 0.30  # +0% .. +30%

# ── §15.2 Tier bands and routing ──────────────────────────────────────────
# (min_scs, max_scs, tier_index, name, meaning, routing_sla)
TIER_BANDS: list[tuple[int, int, int, str, str, str]] = [
    (0, 39, 0, "Routine", "Normal grievance; no systemic signal",
     "Standard SCORES queue; no escalation"),
    (40, 59, 1, "Watch", "Elevated; warrants analyst eyes",
     "Dealing officer + analytics watch-list; weekly digest to division"),
    (60, 79, 2, "Priority", "Likely systemic; needs senior review",
     "Division / Department Head within 48 hrs; daily priority digest"),
    (80, 100, 3, "Critical", "Confirmed or strongly-suspected systemic risk",
     "Senior management / WTM-level desk within 24 hrs; standing cross-functional review"),
]


def tier_for_scs(scs: float) -> tuple[int, str]:
    """Map a composite SCS (0-100) to (tier_index, tier_name)."""
    for lo, hi, idx, name, _meaning, _sla in TIER_BANDS:
        if lo <= scs <= hi:
            return idx, name
    return (3, "Critical") if scs > 100 else (0, "Routine")


# ── §6 Fraud & Severity Typology library ──────────────────────────────────
# severity -> {base_tier, typologies[]}. A "Grave" typology is itself a hard
# trigger to Tier 3 (§6 HARD TRIGGER).
TYPOLOGY_LIBRARY: dict[str, dict] = {
    "Grave": {
        "base_tier": 3,
        "typologies": [
            "Misappropriation / misuse of client funds or securities",
            "Unauthorised pledging or transfer of client securities; fund diversion",
            "Ponzi / assured-return / guaranteed-return scheme; Collective Investment Scheme fraud",
            "Default by the RE / inability to meet client obligations; broker default",
            "Unregistered or fake intermediary; impersonation; fraudulent apps / cloned websites",
            "Market manipulation (pump-and-dump, circular trading); front-running; insider trading; dabba / illegal trading platforms",
        ],
    },
    "High": {
        "base_tier": 2,
        "typologies": [
            "Unauthorised trading / dealing without client consent",
            "Mis-selling of unsuitable products, especially to retail / senior investors",
            "Redemption / exit denial by AMC / AIF / REIT / InvIT",
            "KYC / identity fraud; mule or benami demat accounts; unauthorised debit of securities",
            "Technology / system failure causing mass loss (trading outage, order-routing glitch, algo malfunction)",
            "Cybersecurity incident / data breach exposing investor funds or data",
        ],
    },
    "Moderate": {
        "base_tier": 1,
        "typologies": [
            "Delayed payout / transfer within plausible operational range",
            "Documentation or service deficiencies; fee / charge disputes",
        ],
    },
}

# ── §16 Consolidated hard-trigger catalogue ───────────────────────────────
# Any enabled trigger routes the complaint (or cluster) to Tier 3 regardless of
# the composite SCS. Each is independently toggleable and tunable.
HARD_TRIGGERS: list[dict] = [
    {"id": 1, "dim": "A", "enabled": True,
     "desc": "Root-cause cluster >= 100 complainants, or spanning >= 3 states, or a cross-RE product cluster >= 3 REs"},
    {"id": 2, "dim": "B", "enabled": True,
     "desc": "Single complaint >= Rs 5 cr; or misappropriation >= Rs 2 cr; or cluster aggregate >= Rs 50 cr"},
    {"id": 3, "dim": "C", "enabled": True,
     "desc": "Any 'Grave' typology (misappropriation, manipulation, front-running/insider, Ponzi/assured-return, RE default, fake/unregistered entity)"},
    {"id": 4, "dim": "D", "enabled": True,
     "desc": "Any MII (exchange/clearing corp/depository) implicated in an integrity / operational-failure complaint"},
    {"id": 5, "dim": "D", "enabled": True,
     "desc": "Payout / redemption-delay cluster against one RE (possible solvency / liquidity stress)"},
    {"id": 6, "dim": "G", "enabled": True,
     "desc": "Credible manipulation, settlement-risk, run-risk, or price-sensitive-information signal"},
    {"id": 7, "dim": "I", "enabled": True,
     "desc": "Cluster of second-level-review escalations against one RE (systemic resolution failure)"},
    {"id": 8, "dim": "J", "enabled": True,
     "desc": "SCORES complaint corroborating an open MI-portal subject or live examination"},
    {"id": 9, "dim": "K", "enabled": True,
     "desc": "Allegation against RE senior management / promoters combined with a High/Grave typology"},
]

# ── Per-dimension escalation thresholds (§4-§14 configurable defaults) ─────
THRESHOLDS: dict[str, dict] = {
    "A": {  # Scale
        "cluster_priority": 25,        # >=25 distinct complainants, same cluster, same RE, 30d -> Priority
        "cluster_critical": 100,       # >=100 distinct complainants -> Critical
        "cluster_window_days": 30,
        "states_critical": 3,          # cluster spanning >= 3 states -> Critical ...
        "states_min_size": 10,         # ... but only once the cluster is this large
        "cross_re_critical": 3,        # cross-RE product cluster >= 3 REs -> Critical ...
        "cross_re_min_size": 25,       # ... but only when the product has this many complaints
        "class_harm_priority": 1000,   # single complaint alleging harm to >= 1000 investors -> Priority
    },
    "B": {  # Financial Magnitude
        "single_priority": 1 * CRORE,
        "single_critical": 5 * CRORE,
        "misapp_critical": 2 * CRORE,
        "cluster_priority": 10 * CRORE,
        "cluster_critical": 50 * CRORE,
        "liquidity_escalate": 25 * LAKH,  # redemption/withdrawal block -> +1 tier
    },
    "D": {  # Entity systemic importance
        "complaint_rate_multiple": 3,   # RE complaint-rate > 3x trailing 90d baseline -> Priority
        "trailing_days": 90,
        "watchlist_tier_bump": 1,
    },
    "C": {  # Typology
        "grave_confidence_min": 70,     # 'Grave' hard-triggers only at/above this confidence
    },
    "E": {  # Velocity
        "spike_multiple": 4,            # volume >= 4x trailing baseline within window -> Priority
        "spike_window_hours": 72,
    },
    "I": {  # Process failure
        "reopen_escalate": 2,          # complaint reopened >= 2 times -> +1 tier
        "nonsubstantive_atr_share": 0.30,  # RE non-substantive-ATR rate over this share -> Priority
    },
}

# ── Entity flags used by Dimension D (from entity_master + config lists) ───
# Category codes that denote Market Infrastructure Institutions (systemic by
# definition). Populated from category_master at ETL time; this list is the
# name-based fallback used to tag MII entities.
MII_CATEGORY_HINTS: list[str] = [
    "Stock Exchange",
    "Clearing Corporation",
    "Depository",
    "Depositories",
]

# SEBI-maintained watch-list of entities under enforcement / surveillance.
# Empty by default; SEBI populates via config. Values are entity screen ids.
ENTITY_WATCHLIST: list[str] = []

# ── Semantic clustering (Phase 3) — Dimension A scale + H coordination ─────
CLUSTERING: dict = {
    "min_entity_complaints": 5,     # only cluster within entities having >= N complaints
    "similarity_threshold": 0.45,   # cosine >= this -> SIMILAR_TO edge (same root cause)
    "template_threshold": 0.85,     # cosine >= this -> near-identical wording (coordination)
    "max_neighbors": 6,             # cap SIMILAR_TO edges per complaint (avoid explosion)
    "min_cluster_size": 3,          # connected component >= N members -> a Cluster node
    "cross_re_min_entities": 3,     # a Product implicated by >= N distinct REs -> cross-RE cluster
}
