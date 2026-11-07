"""Per-complaint dimension extraction — the AI layer.

Reads the investor's free-text complaint and emits ontology-pinned signals for
dimensions A, B, C, F, G, H, K. Dimensions D and E are graph/temporal
aggregations (no per-complaint LLM); I is structural (workflow events) plus an
optional ATR-quality pass; J has no data in this dataset.

Complaints are processed in BATCHES (one inference call returns a JSON array of
signal objects) so the Claude Code CLI's fixed harness context amortises across
many complaints — ~10x cheaper than one call per complaint.
"""
from __future__ import annotations

import json
import logging
import re

from config.defaults import TYPOLOGY_LIBRARY
from enrichment.llm import InferenceError, infer
from schemas.enrichment import ComplaintSignals, normalize_severity

logger = logging.getLogger(__name__)

MAX_DETAIL_CHARS = 4000

SYSTEM_PROMPT = (
    "You are a SEBI SCORES systemic-risk analyst applying the Systemic-Criticality "
    "Auto-Escalation Framework. For EACH complaint in the input array, extract structured "
    "signals based ONLY on that complaint's text. When a signal is not present, use the "
    "conservative default (false / \"none\" / null). Never invent amounts, investor counts, "
    "or allegations not in the text. Output ONLY a strict JSON array — no prose, no code "
    "fences — with exactly one object per complaint, in the same order."
)


def _typology_menu() -> str:
    lines: list[str] = []
    for severity, spec in TYPOLOGY_LIBRARY.items():
        for t in spec["typologies"]:
            lines.append(f"- [{severity}] {t}")
    return "\n".join(lines)


_TYPOLOGY_MENU = _typology_menu()

# Reverse map {exact typology label -> its framework-fixed severity}. Used to
# reconcile severity deterministically instead of trusting the LLM's separate
# severity field (the framework fixes each typology's severity).
_TYPOLOGY_TO_SEVERITY: dict[str, str] = {
    t: severity
    for severity, spec in TYPOLOGY_LIBRARY.items()
    for t in spec["typologies"]
}

_STRICT_RULES = """STRICT RULES (default every boolean to false; set true ONLY on explicit textual support):
- class_harm_assertion: true ONLY if the text explicitly refers to a group/scheme/many investors ("all investors in X", "thousands of users", "every client of this branch"). A single person describing their own grievance is FALSE.
- market_integrity_risk: true ONLY for manipulation, insider/price-sensitive information, or run/settlement risk. Ordinary execution errors, refund/payout delays, login/KYC issues are FALSE.
- vulnerable / vulnerability_flags: true ONLY if the text states age/senior-citizen/retiree/pension/disability/medical or that the money is essential (life savings, retirement). Do NOT infer first_time_investor unless the text says so.
- amount_inr: a number ONLY if a figure is explicitly present in the text; otherwise null with amount_basis "none" or "implied".
- distress: reserve for acute personal/financial distress, not routine dissatisfaction.
- criminal_language: only if the text uses fraud/scam/cheating/FIR/police/EOW/court/SAT."""

_OBJECT_SHAPE = """Each object MUST have exactly these keys:
{
  "id": <the complaint id, copied from input>,
  "severity": "Grave" | "High" | "Moderate" | "None",
  "typology": "<closest label from the controlled list, or \\"\\" when severity is None>",
  "typology_confidence": <int 0-100>,
  "amount_inr": <number in rupees, or null if none stated>,
  "amount_basis": "explicit" | "implied" | "none",
  "is_misappropriation": <bool>,
  "liquidity_block": <bool: funds/securities the investor cannot access>,
  "class_harm_assertion": <bool: harm to a whole class asserted>,
  "class_harm_estimate": <int or null>,
  "products": [ {"type": "ISIN"|"scheme"|"IPO"|"mutual_fund"|"app_or_platform"|"branch"|"corporate_action"|"other", "value": "<identifier>"} ],
  "vulnerable": <bool>,
  "vulnerability_flags": [ "senior_citizen"|"retiree"|"first_time_investor"|"essential_funds"|"disabled"|"low_literacy" ],
  "market_integrity_risk": <bool: manipulation / price-sensitive info / run or settlement risk>,
  "distress": <bool>,
  "criminal_language": <bool: fraud, scam, cheating, FIR, police, EOW, court, SAT>,
  "escalation_intent": <bool: intent to approach media / social media / investor associations>,
  "sentiment": "<one or two words>",
  "senior_mgmt_allegation": <bool>,
  "litigation_reference": <bool>,
  "precedent_setting": <bool>,
  "evidence_quote": "<short verbatim snippet from the complaint>",
  "reasoning": "<one short sentence>"
}"""


def _build_batch_prompt(items: list[dict]) -> str:
    payload = [
        {
            "id": it["complaintid"],
            "category": it.get("category"),
            "sub_category": it.get("sub_category"),
            "text": (it.get("details") or "")[:MAX_DETAIL_CHARS],
        }
        for it in items
    ]
    return (
        f"Complaints (JSON array of {len(payload)}):\n"
        f"{json.dumps(payload, ensure_ascii=False)}\n\n"
        f"{_OBJECT_SHAPE}\n\n"
        f"{_STRICT_RULES}\n\n"
        f"Choose `typology` from this controlled list (the bracket is its severity); a 'Grave' "
        f"typology forces the highest tier, so use it only on a clear match:\n{_TYPOLOGY_MENU}\n\n"
        f"Return a JSON array of exactly {len(payload)} objects, one per complaint, same order. "
        f"Strict JSON only."
    )


_FENCE_RE = re.compile(r"```(?:json)?", re.IGNORECASE)


def _extract_json_array(text: str) -> list:
    cleaned = _FENCE_RE.sub("", text).replace("```", "").strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"no JSON array in response: {text[:200]}")
    return json.loads(cleaned[start : end + 1])


_ALLOWED = set(ComplaintSignals.model_fields)


def _coerce(obj: dict) -> ComplaintSignals:
    sig = ComplaintSignals(**{k: v for k, v in obj.items() if k in _ALLOWED})
    # Deterministic reconciliation: if the chosen typology is a known library
    # label, its framework-fixed severity wins over the LLM's separate field.
    fixed = _TYPOLOGY_TO_SEVERITY.get((sig.typology or "").strip())
    sig.severity = fixed if fixed else normalize_severity(sig.severity)
    if sig.severity == "None":
        sig.typology = ""
    return sig


async def extract_signals_batch(complaints: list[dict]) -> dict[int, ComplaintSignals]:
    """Enrich a batch; returns {complaintid: signals} for every id the model returned.

    Ids the model drops are simply absent — the caller leaves them unenriched so
    the next run retries them.
    """
    if not complaints:
        return {}
    prompt = _build_batch_prompt(complaints)
    raw = await infer(SYSTEM_PROMPT, prompt)
    arr = _extract_json_array(raw)

    out: dict[int, ComplaintSignals] = {}
    for obj in arr:
        if not isinstance(obj, dict) or obj.get("id") is None:
            continue
        try:
            cid = int(obj["id"])
        except (ValueError, TypeError):
            continue
        try:
            out[cid] = _coerce(obj)
        except Exception as e:  # noqa: BLE001 — one bad item must not sink the batch
            logger.debug("coerce failed for %s: %s", cid, e)
    return out


async def extract_signals(complaint: dict) -> ComplaintSignals:
    """Single-complaint convenience (used by the API); wraps the batch path."""
    res = await extract_signals_batch([complaint])
    return res.get(complaint["complaintid"], ComplaintSignals())
