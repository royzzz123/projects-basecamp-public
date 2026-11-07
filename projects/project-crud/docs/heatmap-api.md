# Heatmap API — `/v1/heatmap`

Two read-only endpoints that return investor-complaint counts per Indian **state** and per **district**, derived from each complaint's `complaint_code`. They are built to drive a **choropleth** of India (regions shaded by count).

- **Base URL (dev):** `http://localhost:8080` — replace with your environment's gateway.
- **Auth:** same as the rest of `/v1`. Send a `business_user` (or higher) JWT as `Authorization: Bearer <token>`.

```bash
# Get a token (the same login flow used for /v1/complaints, /v1/entities)
TOKEN=$(curl -s http://localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"••••••"}' | jq -r .token)
```

---

## 1) State heatmap — `GET /v1/heatmap`

One row per state/UT, **zero-filled** (every region is always present, so the whole map can be coloured), sorted by complaint count descending.

### Request
```bash
curl -s http://localhost:8080/v1/heatmap \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK`
`items` contains **all ~37 states/UTs** (including ones with `0`); trimmed here for brevity.
```json
{
  "items": [
    { "state_code": "MH", "state_name": "Maharashtra",  "complaints": 3369 },
    { "state_code": "GJ", "state_name": "Gujarat",       "complaints": 2310 },
    { "state_code": "UP", "state_name": "Uttar Pradesh", "complaints": 1546 },
    { "state_code": "RJ", "state_name": "Rajasthan",     "complaints": 1167 },
    { "state_code": "WB", "state_name": "West Bengal",   "complaints": 1096 },
    { "state_code": "DL", "state_name": "Delhi",         "complaints": 1085 },
    { "state_code": "KA", "state_name": "Karnataka",     "complaints": 954 },
    { "state_code": "TN", "state_name": "Tamil Nadu",    "complaints": 869 },
    { "state_code": "SK", "state_name": "Sikkim",        "complaints": 2 },
    { "state_code": "LA", "state_name": "Ladakh",        "complaints": 0 }
  ],
  "total": 17132,
  "unresolved_complaints": 0
}
```

| Field | Type | Meaning |
|---|---|---|
| `items[].state_code` | string | Canonical 2-letter code — **the join key for a state map** |
| `items[].state_name` | string | Display name |
| `items[].complaints` | integer | Count for that state (`0` when none) |
| `total` | integer | Total complaints counted |
| `unresolved_complaints` | integer | Complaints whose 2-letter code didn't map to a known state (currently `0`) |

---

## 2) District drill-down — `GET /v1/heatmap/{state_code}`

Per-district breakdown for a single state: the state total plus one row per district. `state_code` is case-insensitive (`MH`, `mh`).

### Request
```bash
curl -s http://localhost:8080/v1/heatmap/MH \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK` (trimmed)
```json
{
  "state_code": "MH",
  "state_name": "Maharashtra",
  "total_complaints": 3369,
  "districts": [
    { "district_code": "MUMB", "district_name": "Mumbai City", "complaints": 1628, "ambiguous": true },
    { "district_code": "PUNE", "district_name": "Pune",        "complaints": 411 },
    { "district_code": "THAN", "district_name": "Thane",       "complaints": 367 },
    { "district_code": "NAGP", "district_name": "Nagpur",      "complaints": 105 }
  ],
  "unresolved": [
    { "district_code": "MALE", "district_name": "", "complaints": 8 }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `state_code` / `state_name` | string | Echoed back (canonicalized) |
| `total_complaints` | integer | Total for this state |
| `districts[].district_code` | string | 4-letter SEBI code (first 4 letters of the district name) |
| `districts[].district_name` | string | Resolved district name — **the join key for a district map** |
| `districts[].complaints` | integer | Count |
| `districts[].ambiguous` | boolean | **Only present when `true`.** The 4-letter code matches several districts in the state (e.g. `MUMB` = Mumbai City / Mumbai Suburban); `district_name` is the alphabetically-first candidate. Absent ⇒ unambiguous. |
| `unresolved[]` | array | District codes that didn't match a known district (`district_name` is `""`). Always present; may be `[]`. |

---

## Errors (standard envelope)

```jsonc
// GET /v1/heatmap/ZZ  → 400 Bad Request (unknown state code)
{ "error": { "code": "validation", "message": "unknown state code: ZZ", "details": null }, "request_id": "01HQ…" }

// Missing/invalid token → 401 Unauthorized
{ "error": { "code": "auth.invalid_token", "message": "invalid or expired token", "details": null }, "request_id": "01HQ…" }
```

| Status | When |
|---|---|
| `200` | Success |
| `400` | `state_code` is not a known Indian state/UT code |
| `401` | Missing or invalid `Authorization` token |
| `403` | Token valid but role below `business_user` |

---

## Rendering notes for the frontend

- This is a **choropleth** (each region shaded by its count), **not** a point/density heatmap — that's the right tool because complaints only carry a region, not lat/long.
- **State map:** join your GeoJSON features to `state_code`. **District map:** join on `district_name`. The [`datameet/maps`](https://github.com/datameet/maps) India state + district GeoJSON uses names that match what these endpoints return.
- The **state view is exact**. District rows flagged `ambiguous: true` are approximate by nature of the 4-letter SEBI code — consider a tooltip noting the code maps to multiple districts.
- `unresolved[]` rows are filed-time district spellings not in the reference set; safe to ignore for v1 (they still count toward `total_complaints`).
- Suggested UX: render `/v1/heatmap` first; on click of a state, call `/v1/heatmap/{state_code}` for the drill-down.
