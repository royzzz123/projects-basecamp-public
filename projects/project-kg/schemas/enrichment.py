"""Structured per-complaint signals the LLM extracts from free text.

Every field maps to one of the framework's dimensions and is pinned to a
controlled vocabulary so the signals aggregate cleanly into the 11 KPIs. All
fields default to the conservative value so a partial/blurry LLM response still
validates instead of crashing the batch.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

SEVERITIES = ("Grave", "High", "Moderate", "None")


class ProductIdentifier(BaseModel):
    # A — common denominator across complaints (scheme / ISIN / IPO / app / branch)
    type: str = "other"
    value: str = ""


class ComplaintSignals(BaseModel):
    # ── C — Fraud & Severity Typology ─────────────────────────────────────
    severity: str = "None"                      # Grave | High | Moderate | None
    typology: str = ""                          # label from the controlled library
    typology_confidence: int = 50               # 0-100

    # ── B — Financial Magnitude ───────────────────────────────────────────
    amount_inr: float | None = None             # rupees; null if none stated
    amount_basis: str = "none"                  # explicit | implied | none
    is_misappropriation: bool = False
    liquidity_block: bool = False               # funds/securities investor cannot access

    # ── A — Scale / product ───────────────────────────────────────────────
    class_harm_assertion: bool = False          # "all investors in scheme X"
    class_harm_estimate: int | None = None
    products: list[ProductIdentifier] = Field(default_factory=list)

    # ── F — Vulnerable-Investor Impact ────────────────────────────────────
    vulnerable: bool = False
    vulnerability_flags: list[str] = Field(default_factory=list)  # senior_citizen, retiree, first_time_investor, essential_funds, disabled, low_literacy

    # ── G — Market-Integrity & Contagion ──────────────────────────────────
    market_integrity_risk: bool = False         # manipulation / PSI / run-risk

    # ── H — Distress, Coordination & Escalation-Intent ────────────────────
    distress: bool = False
    criminal_language: bool = False             # fraud/scam/FIR/police/EOW/court/SAT
    escalation_intent: bool = False             # media / social / investor associations
    sentiment: str = "neutral"

    # ── K — Legal, Reputational & Regulatory Sensitivity ──────────────────
    senior_mgmt_allegation: bool = False
    litigation_reference: bool = False
    precedent_setting: bool = False

    # ── Explainability (§18.1) ────────────────────────────────────────────
    evidence_quote: str = ""                    # short verbatim snippet
    reasoning: str = ""                         # 1-2 sentence justification


def normalize_severity(value: str) -> str:
    v = (value or "").strip().capitalize()
    return v if v in SEVERITIES else "None"
