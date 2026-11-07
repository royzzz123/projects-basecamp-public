"""Lightweight response helpers for the /kg API (dicts, parsed where needed)."""
from __future__ import annotations

import json
from typing import Any


def parse_json_field(value: Any, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default
