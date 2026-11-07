"""The Systemic-Criticality Score (SCS) engine.

Pure, config-driven scoring. Each of the 11 dimensions produces a 0-100
sub-score and may fire a hard trigger. The additive dimensions combine by their
weights; Dimension F (vulnerability) is a capped multiplier on that subtotal;
any hard trigger forces Tier 3. Everything reads from `config.defaults`, so
SEBI can retune without code changes.

`score_complaint(feat)` takes a flat feature dict (assembled by the runner from
the graph) and returns a structured, explainable result.
"""
from __future__ import annotations

from config.defaults import (
    CRORE,
    DIMENSION_WEIGHTS,
    LAKH,
    THRESHOLDS,
    VULNERABILITY_MULTIPLIER_MAX,
    tier_for_scs,
)


def _clip(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


# ── A — Scale / Mass-Population Impact ─────────────────────────────────────
def _dim_a(f: dict) -> tuple[float, list[str], list[str]]:
    t = THRESHOLDS["A"]
    triggers: list[str] = []
    reasons: list[str] = []
    size = f.get("cl_size") or 1
    states = f.get("cl_states") or 0
    xre = f.get("xre_entities") or 0
    xre_size = f.get("xre_size") or 0

    if size >= t["cluster_critical"]:
        base = 90.0
    elif size >= t["cluster_priority"]:
        base = 70.0
    elif size >= 10:
        base = 50.0
    elif size >= 3:
        base = 30.0
    else:
        base = 10.0
    score = base
    if states >= t["states_critical"]:
        score += 15
        reasons.append(f"cluster spans {states} states")
    if xre >= t["cross_re_critical"]:
        score += 20
        reasons.append(f"cross-RE product cluster across {xre} REs")
    if f.get("class_harm") and (f.get("class_est") or 0) >= t["class_harm_priority"]:
        score += 30
        reasons.append(f"asserts harm to >= {t['class_harm_priority']} investors")

    # Templated (astroturfed) clusters are noise, not mass harm — discount scale.
    templated = f.get("cl_templated") or 0.0
    if templated >= 0.7 and size >= 3:
        score *= 0.6
        reasons.append(f"discounted: templated_frac={templated} (possible coordinated filing)")

    if size >= t["cluster_critical"]:
        triggers.append("A: root-cause cluster >= %d complainants" % t["cluster_critical"])
        reasons.append(f"cluster size {size}")
    if states >= t["states_critical"] and size >= t["states_min_size"]:
        triggers.append("A: cluster spans >= %d states (size %d)" % (t["states_critical"], size))
    if xre >= t["cross_re_critical"] and xre_size >= t["cross_re_min_size"]:
        triggers.append("A: cross-RE product cluster >= %d REs (%d complaints)" % (t["cross_re_critical"], xre_size))
    return _clip(score), triggers, reasons


# ── B — Financial Magnitude ────────────────────────────────────────────────
def _dim_b(f: dict) -> tuple[float, list[str], list[str]]:
    t = THRESHOLDS["B"]
    triggers: list[str] = []
    reasons: list[str] = []
    amt = f.get("amount") or 0
    agg = f.get("cl_agg_amount") or 0
    misapp = bool(f.get("misapp"))

    def band(a: float) -> float:
        if a >= t["single_critical"]:
            return 100.0
        if a >= t["misapp_critical"]:
            return 85.0
        if a >= t["single_priority"]:
            return 70.0
        if a >= t["liquidity_escalate"]:
            return 50.0
        if a >= 5 * LAKH:
            return 30.0
        return 15.0 if a > 0 else 0.0

    score = band(amt)
    if agg >= t["cluster_critical"]:
        score = max(score, 100.0)
        reasons.append(f"cluster aggregate >= Rs {t['cluster_critical']//CRORE} cr")
    elif agg >= t["cluster_priority"]:
        score = max(score, 70.0)
    if f.get("liquidity"):
        score = min(100.0, score + 15)
        reasons.append("liquidity denial (funds/securities inaccessible)")
    if amt > 0:
        reasons.append(f"stated amount ~Rs {int(amt):,}")

    if amt >= t["single_critical"]:
        triggers.append("B: single complaint >= Rs 5 cr")
    if misapp and amt >= t["misapp_critical"]:
        triggers.append("B: misappropriation >= Rs 2 cr")
    if agg >= t["cluster_critical"]:
        triggers.append("B: cluster aggregate >= Rs 50 cr")
    return _clip(score), triggers, reasons


# ── C — Fraud & Severity Typology ──────────────────────────────────────────
_SEVERITY_SCORE = {"Grave": 100.0, "High": 70.0, "Moderate": 35.0, "None": 10.0}


def _dim_c(f: dict) -> tuple[float, list[str], list[str]]:
    sev = f.get("severity") or "None"
    score = _SEVERITY_SCORE.get(sev, 10.0)
    conf = f.get("typology_confidence")
    if conf is not None:
        score *= 0.6 + 0.4 * (conf / 100.0)  # confidence-weighted, never below 60%
    triggers: list[str] = []
    reasons: list[str] = []
    if sev != "None" and f.get("typology"):
        reasons.append(f"{sev} typology: {f['typology']}")
    if sev == "Grave" and (conf is None or conf >= THRESHOLDS["C"]["grave_confidence_min"]):
        triggers.append("C: 'Grave' typology")
    return _clip(score), triggers, reasons


# ── D — Entity Systemic Importance & Risk ──────────────────────────────────
def _dim_d(f: dict) -> tuple[float, list[str], list[str]]:
    t = THRESHOLDS["D"]
    triggers: list[str] = []
    reasons: list[str] = []
    score = 0.0
    is_mii = bool(f.get("is_mii"))
    if is_mii:
        score = 70.0
        reasons.append("entity is a Market Infrastructure Institution")
    ecount = f.get("ecount") or 0
    if ecount >= 500:
        score = max(score, 55.0)
        reasons.append(f"high-volume RE ({ecount} complaints)")
    elif ecount >= 200:
        score = max(score, 40.0)
    if f.get("watchlist"):
        score = min(100.0, score + 25)
        reasons.append("entity on SEBI watch-list")

    # Hard triggers: MII in integrity / operational-failure; liquidity-stress cluster.
    typ = (f.get("typology") or "").lower()
    op_failure = any(k in typ for k in ("system failure", "technology", "default by the re", "settlement"))
    if is_mii and (f.get("integrity") or op_failure):
        triggers.append("D: MII implicated in integrity / operational-failure complaint")
    if (f.get("cl_n_liquidity") or 0) >= THRESHOLDS["A"]["cluster_priority"]:
        triggers.append("D: payout/redemption-delay cluster (possible solvency/liquidity stress)")
        reasons.append(f"{f['cl_n_liquidity']} liquidity-block complaints in cluster")
    return _clip(score), triggers, reasons


# ── E — Velocity & Emergent Patterns ───────────────────────────────────────
def _dim_e(f: dict) -> tuple[float, list[str], list[str]]:
    t = THRESHOLDS["E"]
    reasons: list[str] = []
    triggers: list[str] = []
    ratio = f.get("spike_ratio") or 1.0
    if ratio >= t["spike_multiple"]:
        score = min(100.0, 60 + 10 * (ratio - t["spike_multiple"]))
        reasons.append(f"volume spike {ratio:.1f}x baseline for this RE")
        triggers.append("E: volume >= %dx trailing baseline" % t["spike_multiple"])
    elif ratio >= 2:
        score = 40.0
    else:
        score = 15.0
    return _clip(score), triggers, reasons


# ── F — Vulnerable-Investor Impact (capped multiplier) ─────────────────────
def _dim_f_multiplier(f: dict) -> tuple[float, list[str]]:
    reasons: list[str] = []
    mult = 0.0
    if f.get("vulnerable"):
        mult += 0.15
    flags = set(f.get("vflags") or [])
    if flags & {"senior_citizen", "retiree", "essential_funds", "disabled"}:
        mult += 0.15
        reasons.append("vulnerable investor: " + ", ".join(sorted(flags)))
    mult = min(VULNERABILITY_MULTIPLIER_MAX, mult)
    return mult, reasons


# ── G — Market-Integrity & Contagion Risk ──────────────────────────────────
_MANIPULATION_KEYS = ("manipulation", "insider", "front-running", "front running",
                      "dabba", "circular trading", "pump")


def _dim_g(f: dict) -> tuple[float, list[str], list[str]]:
    triggers: list[str] = []
    reasons: list[str] = []
    score = 0.0
    if f.get("integrity"):
        typ = (f.get("typology") or "").lower()
        manip = any(k in typ for k in _MANIPULATION_KEYS)
        score = 80.0 if manip else 55.0
        reasons.append("market-integrity / price-sensitive / run-risk signal")
        # Precision guard: hard-trigger only for genuine manipulation-family conduct or
        # a Grave typology — NOT ordinary operational / tech-failure complaints.
        if manip or f.get("severity") == "Grave":
            triggers.append("G: credible manipulation / settlement / run-risk signal")
    return _clip(score), triggers, reasons


# ── H — Distress, Coordination & Escalation-Intent ─────────────────────────
def _dim_h(f: dict) -> tuple[float, list[str], list[str], bool]:
    reasons: list[str] = []
    score = 0.0
    if f.get("criminal"):
        score += 60
        reasons.append("criminal-process language (fraud/FIR/police/court)")
    if f.get("esc_intent"):
        score += 20
        reasons.append("stated intent to escalate (media/associations)")
    if f.get("distress"):
        score += 20
    # +1 tier bump: criminal-process language alongside a serious typology.
    bump = bool(f.get("criminal")) and f.get("severity") in ("Grave", "High")
    return _clip(score), [], reasons, bump


# ── I — Process & Resolution Failure ───────────────────────────────────────
def _dim_i(f: dict) -> tuple[float, list[str], bool]:
    """Process/resolution failure. Per-complaint only — the entity-level 'cluster of
    second-level reviews' pattern is surfaced in the RE-conduct panel, NOT as a
    per-complaint hard trigger (that would flag every complaint of a busy RE)."""
    t = THRESHOLDS["I"]
    reasons: list[str] = []
    score = 0.0
    if (f.get("n_2nd") or 0) > 0:
        score = 65.0
        reasons.append("this complaint reached second-level (SEBI) review")
    elif (f.get("n_review") or 0) > 0:
        score = 40.0
        reasons.append("escalated to first-level review")
    reopen = f.get("reopen") or 0
    bump = reopen >= t["reopen_escalate"]
    if bump:
        reasons.append(f"reviewed/reopened {reopen} times")
    # Entity systemic-resolution-failure raises this complaint's sub-score only if the
    # complaint itself was reviewed — it never, by itself, hard-triggers Tier 3.
    if (f.get("entity_2nd_count") or 0) >= THRESHOLDS["A"]["cluster_priority"] and (f.get("n_review") or 0) > 0:
        score = max(score, 60.0)
        reasons.append("RE shows a cluster of second-level-review escalations (systemic resolution-failure pattern)")
    return _clip(score), reasons, bump


# ── J — Cross-Portal & External Correlation (no data — honest stub) ────────
def _dim_j(f: dict) -> tuple[float, list[str], list[str]]:
    # No MI-portal / examination data in this dataset. Scored 0; wired for future.
    return 0.0, [], []


# ── K — Legal, Reputational & Regulatory Sensitivity ───────────────────────
def _dim_k(f: dict) -> tuple[float, list[str], list[str]]:
    triggers: list[str] = []
    reasons: list[str] = []
    score = 0.0
    if f.get("senior_mgmt"):
        score += 50
        reasons.append("allegation against RE senior management / promoters")
    if f.get("litigation"):
        score += 20
    if f.get("precedent"):
        score += 30
        reasons.append("potentially precedent-setting")
    if f.get("senior_mgmt") and f.get("severity") in ("Grave", "High"):
        triggers.append("K: senior-management allegation + High/Grave typology")
    return _clip(score), triggers, reasons


def score_complaint(f: dict) -> dict:
    """Compute the full SCS result for one complaint feature dict."""
    subs: dict[str, float] = {}
    all_triggers: list[str] = []
    reasons: dict[str, list[str]] = {}
    tier_bumps = 0

    for dim, fn in (("A", _dim_a), ("B", _dim_b), ("C", _dim_c), ("D", _dim_d),
                    ("E", _dim_e), ("G", _dim_g), ("K", _dim_k), ("J", _dim_j)):
        s, trg, rs = fn(f)
        subs[dim] = s
        all_triggers += trg
        if rs:
            reasons[dim] = rs

    h_score, _h_trg, h_rs, h_bump = _dim_h(f)
    subs["H"] = h_score
    if h_rs:
        reasons["H"] = h_rs
    if h_bump:
        tier_bumps += 1

    i_score, i_rs, i_bump = _dim_i(f)
    subs["I"] = i_score
    if i_rs:
        reasons["I"] = i_rs
    if i_bump:
        tier_bumps += 1

    # Additive subtotal (weights sum to 100; sub-scores 0-100 -> subtotal 0-100).
    subtotal = sum(DIMENSION_WEIGHTS[d] * subs[d] for d in DIMENSION_WEIGHTS) / 100.0

    # Dimension F — capped multiplier.
    f_mult, f_rs = _dim_f_multiplier(f)
    if f_rs:
        reasons["F"] = f_rs
    scs = min(100.0, subtotal * (1.0 + f_mult))

    band_tier, _ = tier_for_scs(scs)
    tier = min(3, band_tier + tier_bumps)
    if f.get("watchlist"):
        tier = min(3, tier + THRESHOLDS["D"]["watchlist_tier_bump"])
    if all_triggers:  # any hard trigger -> Tier 3
        tier = 3

    from config.defaults import TIER_BANDS
    tier_name = next((n for _lo, _hi, idx, n, _m, _s in TIER_BANDS if idx == tier), "Routine")

    return {
        "scs": round(scs, 1),
        "subtotal": round(subtotal, 1),
        "f_multiplier": round(f_mult, 3),
        "tier": tier,
        "tier_name": tier_name,
        "subscores": {k: round(v, 1) for k, v in subs.items()},
        "hard_triggers": all_triggers,
        "reasons": reasons,
    }
