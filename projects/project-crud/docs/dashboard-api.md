# Dashboard API — `/v1/dashboard`

Three read-only endpoints that return **aggregate complaint metrics** for a supervisory dashboard, all filterable by **date range** and (where it makes sense) **category**. They aggregate `tt_complaints` live with MongoDB.

- **Base URL (dev):** `http://localhost:8080` — replace with your environment's gateway.
- **Auth:** same as the rest of `/v1`. Send a `business_user` (or higher) JWT as `Authorization: Bearer <token>` (service-to-service callers may use the `X-System-Key` header instead).

```bash
# Get a token (same login flow as /v1/complaints, /v1/heatmap)
TOKEN=$(curl -s http://localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"••••••"}' | jq -r .token)
```

> The example responses below were captured against the current dev dataset (**17,132 complaints, all filed Sep–Dec 2024**).

---

## The metric model (read this first)

The summary uses a **within-period cohort-progress** model: it takes the complaints **filed** in the window (`created_date`, after the optional `category` filter), then measures how many of *those same* complaints **also closed within the window**. The counts **reconcile**:

| Metric | Counts |
|---|---|
| `total` | complaints **filed** in the window (`created_date`; all-time when no range) |
| `closed` | of those, the ones that **also closed within the window** (`date_of_closure` in range) |
| `open` | `total − closed` — filed in the window but **not closed within it** (carryover) |

> **`total = open + closed`**, always.

- `resolution_rate` = `closed / total × 100`, 2 dp (0 when `total` is 0): the **within-period closure rate** — of the complaints filed in the window, the share also closed within it.
- The **category** filter, when supplied, scopes the whole cohort.
- With **no** date range there is no window to close "within", so `closed` is simply the currently-closed count (`wfstate == "CLOSED"`) and `open` is the current backlog.

A wider window catches more of the cohort's closures — that's the "progress" signal:

```jsonc
// October only — of October's intake, 21.7% was closed within October
{ "total": 6626,  "open": 5188, "closed": 1438,  "resolution_rate": 21.7 }   // 5188 + 1438 = 6626

// Q4 (Oct–Dec) — three months in, 68% of Q4's intake is closed
{ "total": 17115, "open": 5464, "closed": 11651, "resolution_rate": 68.07 }  // 5464 + 11651 = 17115

// No date range — lifetime: closed = currently closed, open = current backlog
{ "total": 17132, "open": 34,   "closed": 17098, "resolution_rate": 99.8 }
```

---

## 1) Summary — `GET /v1/dashboard/summary`

Headline counts: total / open / closed / resolution rate.

### Request
```bash
curl -s "http://localhost:8080/v1/dashboard/summary?created_at_from=2024-10-01T00:00:00Z&created_at_to=2024-11-01T00:00:00Z&category=cat12" \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK`
```json
{ "total": 2226, "open": 1825, "closed": 401, "resolution_rate": 18.01 }
```

| Field | Type | Meaning |
|---|---|---|
| `total` | integer | Complaints filed in the window (`created_date`; all-time if no range), after the category filter |
| `closed` | integer | Of those, the ones that also closed within the window (`date_of_closure` in range; currently-closed if no range) |
| `open` | integer | `total − closed` — filed in the window but not closed within it (carryover) |
| `resolution_rate` | number | `closed / total × 100`, 2 dp; `0` when `total` is `0` — within-period closure rate |

> `total = open + closed` always.

### Query parameters
| Param | Type | Notes |
|---|---|---|
| `created_at_from` / `created_at_to` | RFC3339 string | Optional; either bound may be omitted. `from` must be ≤ `to`. |
| `category` | string (repeatable) | Optional. SEBI category code(s), e.g. `category=cat12&category=cat2`. OR-combined. |

---

## 2) Volume by sub-category — `GET /v1/dashboard/volume-by-subcategory`

Complaints **filed** in the window grouped by `complaint_sub_category`, sorted by count descending, capped at `limit`.

### Request
```bash
curl -s "http://localhost:8080/v1/dashboard/volume-by-subcategory?limit=5" \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK`
```json
{
  "items": [
    { "sub_category": "Others", "complaints": 4585 },
    { "sub_category": "Technical glitches/outage/connectivity/system related problem", "complaints": 910 },
    { "sub_category": "Lack of response from RTA / Improper service", "complaints": 791 },
    { "sub_category": "Account opening / closing / suspension related", "complaints": 677 },
    { "sub_category": "Improper Service", "complaints": 560 }
  ],
  "total": 17132,
  "limit": 5
}
```

| Field | Type | Meaning |
|---|---|---|
| `items[].sub_category` | string | Sub-category name (`""` for complaints with none) |
| `items[].complaints` | integer | Count filed in the window |
| `total` | integer | Full matched complaint count — **≥ the sum of the returned items** (it ignores `limit`) |
| `limit` | integer | The effective cap actually applied (after clamping) |

### Query parameters
| Param | Type | Notes |
|---|---|---|
| `created_at_from` / `created_at_to` | RFC3339 string | Optional. Same rules as the summary. |
| `category` | string (repeatable) | Optional. Restrict to one or more category codes. |
| `limit` | integer | Optional. Default **50**, clamped to **200** (`DASHBOARD_SUBCAT_LIMIT_DEFAULT` / `_MAX`). |

---

## 3) Volume by category — `GET /v1/dashboard/volume-by-category`

Complaints **filed** in the window grouped by `complaint_category`, with the name resolved from `category_master`, sorted by count descending. **No category filter** — category is the group key; only the date range applies.

### Request
```bash
curl -s "http://localhost:8080/v1/dashboard/volume-by-category" \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK` (30 items; trimmed)
```json
{
  "items": [
    { "category_code": "cat12", "category_name": "Stock Broker", "complaints": 6117 },
    { "category_code": "cat34", "category_name": "Listed Company- Equity Issue (Dividend/Transfer/Transmission/Duplicate Shares/Bonus Shares etc.)", "complaints": 3215 },
    { "category_code": "cat22", "category_name": "Registrar and Share Transfer Agent", "complaints": 2375 },
    { "category_code": "cat2",  "category_name": "Mutual Fund", "complaints": 941 },
    { "category_code": "cat32", "category_name": "Listed Company-IPO/Prelisting/Offer document (shares)", "complaints": 915 }
  ],
  "total": 17132
}
```

| Field | Type | Meaning |
|---|---|---|
| `items[].category_code` | string | SEBI category code (`""` for complaints with no category) |
| `items[].category_name` | string | Resolved name from `category_master` (`""` when the code has no master entry) |
| `items[].complaints` | integer | Count filed in the window |
| `total` | integer | Full matched complaint count (sum across all returned categories) |

### Query parameters
| Param | Type | Notes |
|---|---|---|
| `created_at_from` / `created_at_to` | RFC3339 string | Optional. Same rules as the summary. |

---

## 4) Volume by category, time series — `GET /v1/dashboard/volume-by-category-trend`

Same as `volume-by-category`, but bucketed across time so the dashboard can render a **stacked area / multi-line chart** of complaint volume per category over the window.

The bucket size is controlled by `granularity` (`day` | `week` | `month`, default `day`). Each series only contains buckets that have **non-zero** complaints — the frontend is expected to build its own date axis from the requested range and zero-fill the gaps. The optional `category` filter narrows the returned series (useful when the dashboard has the category multi-select active).

### Request
```bash
curl -s "http://localhost:8080/v1/dashboard/volume-by-category-trend?created_at_from=2024-09-01T00:00:00Z&created_at_to=2024-12-31T23:59:59Z&granularity=week" \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK` (trimmed)
```json
{
  "granularity": "week",
  "series": [
    {
      "category_code": "cat12",
      "category_name": "Stock Broker",
      "total": 6117,
      "points": [
        { "date": "2024-09-02", "count": 312 },
        { "date": "2024-09-09", "count": 401 }
      ]
    },
    {
      "category_code": "cat2",
      "category_name": "Mutual Fund",
      "total": 941,
      "points": [
        { "date": "2024-09-02", "count": 58 }
      ]
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `granularity` | string | Echoes the resolved bucket size: `"day"`, `"week"` or `"month"`. |
| `series[].category_code` | string | SEBI category code (`""` when missing). |
| `series[].category_name` | string | Resolved from `category_master` (`""` when the code has no master entry). |
| `series[].total` | integer | Sum of all points in the series — useful for sorting / legend ordering. |
| `series[].points[].date` | string | Bucket start as `YYYY-MM-DD` (Monday for week, 1st for month). |
| `series[].points[].count` | integer | Filed-complaint count in that bucket for that category. |

### Query parameters
| Param | Type | Notes |
|---|---|---|
| `created_at_from` / `created_at_to` | RFC3339 string | Optional; same rules as the other endpoints. |
| `granularity` | string | Optional. One of `day` (default), `week`, `month`. |
| `category` | string (repeatable) | Optional. Restrict to specific category codes. |

### Notes
- Series are sorted by `total` descending — render in that order and the largest stack lands on top in a typical Recharts stacked area.
- Each series' points are **chronologically ascending** (Mongo sorts buckets before pushing them into the series array).
- Frontends should treat a missing `(series, bucket)` as a `0` — the response is sparse.

---

## 5) Volume by sub-category, time series — `GET /v1/dashboard/volume-by-subcategory-trend`

Sub-category cousin of `volume-by-category-trend`. Same shape, but grouped by `complaint_sub_category` and capped at `limit` (sub-categories are open-ended free text and can be many).

### Request
```bash
curl -s "http://localhost:8080/v1/dashboard/volume-by-subcategory-trend?created_at_from=2024-09-01T00:00:00Z&created_at_to=2024-12-31T23:59:59Z&granularity=week&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### Response `200 OK` (trimmed)
```json
{
  "granularity": "week",
  "limit": 10,
  "series": [
    {
      "sub_category": "Lack of response from RTA / Improper service",
      "total": 791,
      "points": [
        { "date": "2024-09-02", "count": 42 },
        { "date": "2024-09-09", "count": 51 }
      ]
    }
  ]
}
```

### Query parameters
| Param | Type | Notes |
|---|---|---|
| `created_at_from` / `created_at_to` | RFC3339 string | Optional; same rules as the other endpoints. |
| `granularity` | string | Optional. One of `day` (default), `week`, `month`. |
| `category` | string (repeatable) | Optional. Scope to specific category codes. |
| `limit` | integer | Optional. Default **50**, clamped to **200** (same `DASHBOARD_SUBCAT_LIMIT_*` knobs as the aggregate endpoint). |

---

## Response times

Measured on **localhost**, server warm (Mongo pool established), 6 runs each, against the full **17,132-doc** `tt_complaints`. Numbers are the **wall-clock round trip including the Mongo aggregation**.

| Endpoint / variant | min | avg | max |
|---|--:|--:|--:|
| `summary` (no filter) | 30 ms | 38 ms | 46 ms |
| `summary` (`category=cat12`) | 37 ms | 39 ms | 44 ms |
| `summary` (date range, populated — Oct 2024) | 31 ms | 37 ms | 53 ms |
| `volume-by-subcategory` (`limit=10`) | 34 ms | 37 ms | 45 ms |
| `volume-by-subcategory` (`category=cat12`) | 36 ms | 56 ms | 134 ms |
| `volume-by-category` (no filter) | 38 ms | 45 ms | 56 ms |
| `volume-by-category` (date range) | 28 ms | 30 ms | 34 ms |

**Rule of thumb: ~30–55 ms warm**, with occasional spikes to ~100–135 ms (GC / scheduler / first call after idle).

Caveats:
- The **first** request after startup or a long idle is slower (connection-pool warm-up) — exclude it from any SLO baseline.
- These are localhost figures. A remote DB or an API gateway adds its own network latency on top.
- All filter paths are index-backed: `by_created_date`, `by_category_recent`, `by_status_recent`. The `summary` endpoint runs its two counts (closed + open) **in parallel** and sums them for `total`, so its latency is roughly the slower single count.

---

## Errors (standard envelope)

```jsonc
// Bad date → 400 Bad Request
// GET /v1/dashboard/summary?created_at_from=nonsense
{ "error": { "code": "validation", "message": "created_at_from must be RFC3339 (e.g. 2024-10-01T00:00:00Z)", "details": null }, "request_id": "01HQ…" }

// from > to → 400 Bad Request
{ "error": { "code": "validation", "message": "created_at_from must be <= created_at_to", "details": null }, "request_id": "01HQ…" }

// Bad limit → 400 Bad Request
// GET /v1/dashboard/volume-by-subcategory?limit=abc
{ "error": { "code": "validation", "message": "limit must be an integer", "details": null }, "request_id": "01HQ…" }
```

| Status | When |
|---|---|
| `200` | Success |
| `400` | Malformed `created_at_*` (not RFC3339, or `from > to`) or non-integer `limit` |
| `401` | Missing or invalid `Authorization` token |
| `403` | Token valid but role below `business_user` |

---

## Notes for the frontend

- `total` splits exactly into `closed` + `open` for the complaints filed in the window — safe to render as a donut or stacked bar; `resolution_rate` is the within-period closed share.
- For a month card, pass that month's window: `total` = filed that month, `closed` = how many of those also closed that month, `open` = the carryover, `resolution_rate` = within-month closure rate. Widen the window (quarter, year) to watch the rate climb as more of the cohort gets resolved.
- `volume-by-subcategory.total` and `volume-by-category.total` are the **un-truncated** matched count — use them for "X of Y" labels, not the sum of the rows shown.
- These endpoints aggregate live on each call (fast today at ~17k docs). If volume grows or call frequency rises, the planned next step is a pre-aggregated collection refreshed every 24h behind these same response shapes — no client change required.
