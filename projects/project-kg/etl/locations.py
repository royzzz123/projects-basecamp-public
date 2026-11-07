"""Derive location from a SCORES complaint_code.

Complaint codes look like `SEBIE/MH24/GOND/034396/1`:
    segment[1] = <STATE-CODE><YY>   e.g. MH24  -> state MH, year 24
    segment[2] = <DISTRICT-CODE>    e.g. GOND

tt_complaints carries no explicit state/district field, so this is the only
geographic signal available for Dimension A (geographic concentration).
"""
from __future__ import annotations

import re

# Best-effort 2-letter SEBI region code -> state/UT name. Grouping/KPIs only
# need the code; the name is for display. Unknown codes fall back to the code.
STATE_NAMES: dict[str, str] = {
    "MH": "Maharashtra", "GJ": "Gujarat", "UP": "Uttar Pradesh",
    "RJ": "Rajasthan", "WB": "West Bengal", "DH": "Delhi", "DL": "Delhi",
    "KN": "Karnataka", "KA": "Karnataka", "TN": "Tamil Nadu",
    "MP": "Madhya Pradesh", "HY": "Telangana", "TG": "Telangana",
    "AP": "Andhra Pradesh", "KL": "Kerala", "PB": "Punjab", "HR": "Haryana",
    "BR": "Bihar", "OR": "Odisha", "OD": "Odisha", "JH": "Jharkhand",
    "CG": "Chhattisgarh", "AS": "Assam", "UK": "Uttarakhand", "UT": "Uttarakhand",
    "HP": "Himachal Pradesh", "JK": "Jammu & Kashmir", "GA": "Goa",
    "PY": "Puducherry", "CH": "Chandigarh", "TR": "Tripura", "MN": "Manipur",
    "ML": "Meghalaya", "NL": "Nagaland", "MZ": "Mizoram", "SK": "Sikkim",
    "AR": "Arunachal Pradesh", "AN": "Andaman & Nicobar", "DN": "Dadra & Nagar Haveli",
}

_STATE_RE = re.compile(r"^([A-Za-z]{2})\d{0,2}$")


def parse_location(complaint_code: str | None) -> dict | None:
    """Return {state_code, state_name, district_code, key} or None."""
    if not complaint_code:
        return None
    parts = complaint_code.split("/")
    if len(parts) < 2:
        return None

    m = _STATE_RE.match(parts[1].strip())
    if not m:
        return None
    state_code = m.group(1).upper()
    district_code = parts[2].strip().upper() if len(parts) >= 3 and parts[2].strip() else None

    return {
        "state_code": state_code,
        "state_name": STATE_NAMES.get(state_code, state_code),
        "district_code": district_code,
        "key": f"{state_code}:{district_code}" if district_code else state_code,
    }
