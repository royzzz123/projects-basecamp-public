# API playbook (curls + response shapes)

Copy-pasteable curls for every endpoint, plus the bits a frontend engineer needs:
request shapes, response shapes, filter semantics, pagination model, and the error
envelope. Mirrors the "Verification" section of the implementation plan, so the two
stay in lockstep when behaviour changes.

**Base URL** — `http://localhost:8080` in local dev. Set `$BASE_URL` accordingly.

**API version** — every business endpoint is namespaced under `/v1`. Ops endpoints
(`/health`, `/readyz`, `/metrics`, `/version`) are unversioned.

**Content type** — request bodies are JSON (`Content-Type: application/json`).
Responses are JSON unless noted otherwise.

---

## 0. Setup

```bash
export BASE_URL="http://localhost:8080"
# Replace credentials with a real seeded business_user / admin / developer.
# (First user has to be bootstrapped manually — see README.md → "Bootstrapping the first user".)
export TOKEN="$(curl -s -X POST "$BASE_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"replace-with-the-real-password"}' \
  | jq -r .token)"

echo "$TOKEN" | cut -c1-20   # sanity check — should print the leading 20 chars of a JWT
```

Every authenticated curl below relies on `$TOKEN` being set. Re-run the login one-liner
whenever the token expires (default TTL **24h** via `JWT_TTL`).

### Auth header

```
Authorization: Bearer <jwt>
```

The JWT is opaque to the frontend — don't try to parse claims out of it. On a `401
auth.invalid_token` from any endpoint, force a re-login.

### Roles

`developer` ⊇ `admin` ⊇ `business_user` (higher roles inherit access of lower ones).
All business endpoints below require **at least** `business_user`. `developer` is
the only cross-org role.

---

## Error envelope

**Every** non-2xx response uses this shape — frontend can map on `error.code`:

```json
{
  "error": {
    "code": "validation",
    "message": "limit must be an integer",
    "details": null
  },
  "request_id": "01KRNEFDW5AYF60YTJ3QNGYPGJ"
}
```

| HTTP | `error.code`               | When it fires                                                        |
|------|----------------------------|----------------------------------------------------------------------|
| 400  | `validation`               | malformed query / body, bad cursor, bad timestamp, reversed range    |
| 401  | `auth.invalid_credentials` | login: wrong password OR unknown email (no enumeration)              |
| 401  | `auth.invalid_token`       | missing / malformed / expired JWT                                    |
| 403  | `forbidden`                | authenticated but role is too low                                    |
| 404  | `not_found`                | resource doesn't exist OR caller can't see it (no leak)              |
| 422  | `unprocessable`            | semantic / business-rule failure                                     |
| 429  | `rate_limited`             | per-IP token bucket exhausted                                        |
| 500  | `internal`                 | unexpected — always echo `request_id` to backend for tracing         |

Always log `request_id` from any non-2xx so backend can trace the request.

---

## 1. `POST /v1/auth/login`

Exchange email + password for a JWT. Public — no `Authorization` header.

### Request
```json
{ "email": "you@example.com", "password": "..." }
```

### Response (200)
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_at": "2026-05-16T14:38:47Z",
  "user": {
    "id": "6a06e28320a9b217a65f7aa5",
    "email": "you@example.com",
    "role": "developer",          // developer | admin | business_user
    "org_id": null,               // null for developer; ObjectID hex for others
    "created_at": "2026-05-15T09:08:19Z",
    "updated_at": "2026-05-15T09:08:19Z"
  }
}
```

### Curls
```bash
# Happy path
curl -s -X POST "$BASE_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"replace-with-the-real-password"}' | jq

# Wrong password → 401 auth.invalid_credentials
curl -s -i -X POST "$BASE_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"wrong"}'

# Unknown email → same 401 auth.invalid_credentials (no user enumeration)
curl -s -i -X POST "$BASE_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ghost@example.com","password":"whatever"}'

# Validation failure → 400 (e.g. bad email format, missing password)
curl -s -i -X POST "$BASE_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"not-an-email"}'
```

---

## 2. `GET /v1/complaints`

Lists complaints with optional filters and cursor pagination. Requires
`business_user` or above. Always sorted by `complaint_id DESC` (newest first).

### Response (200)
```json
{
  "items": [
    {
      "complaint_id":      2057548,
      "entityscreenid":    "stb10169",
      "intermediary_name": "RAISE SECURITIES PRIVATE LIMITED (...)",
      "category":          "Stock Broker",                // resolved from category_master
      "sub_category":      "Improper Service",
      "status":            "CLOSED",                      // from wfstate
      "created_date":      "2024-12-30T17:34:25Z",        // BSON Date → RFC3339 UTC
      "modified_date":     "2025-02-21T11:49:20Z"
    }
  ],
  "next_cursor": "eyJjIjoyMDU3NTQ0fQ",  // opaque base64. null/absent on the last page.
  "limit": 50
}
```

Field notes:

| Field               | Type            | Notes                                                             |
|---------------------|-----------------|-------------------------------------------------------------------|
| `complaint_id`      | int64           | SEBI complaint ID. Stable.                                        |
| `entityscreenid`    | string          | Intermediary ID. Send this back as the `entityscreenid=` filter.  |
| `intermediary_name` | string \| null  | Display name, resolved from `entity_master`. May be `null`.       |
| `category`          | string \| null  | Human-readable category name (joined from `category_master`).     |
| `sub_category`      | string \| null  | Free-text sub-category from `tt_complaints`.                      |
| `status`            | string          | Workflow state. Enum is whatever `/v1/complaints/filters` returns.|
| `created_date`      | RFC3339 UTC     | When SEBI received the complaint.                                 |
| `modified_date`     | RFC3339 UTC     | Last workflow update.                                             |

### Query parameters

| Param               | Type           | Repeats? | Description                                                                          |
|---------------------|----------------|----------|--------------------------------------------------------------------------------------|
| `limit`             | int            | no       | Page size. Default **50**, max **200**. Non-numeric → 400.                           |
| `after`             | opaque string  | no       | Cursor from a previous response's `next_cursor`. Treat as opaque.                    |
| `entityscreenid`    | string         | **yes**  | One or more intermediary IDs (OR within the axis). IDs come from `/v1/entities/filter`. |
| `status`            | string         | **yes**  | Workflow status code (OR within the axis). Values come from `/v1/complaints/filters`.|
| `category`          | string         | **yes**  | SEBI category **code** (e.g. `cat12`), NOT the display name (OR within the axis).    |
| `sub_category`      | string         | **yes**  | Exact sub-category string (OR within the axis). URL-encode the value.                |
| `created_at_from`   | RFC3339        | no       | Inclusive lower bound on `created_date`. UTC, e.g. `2024-10-01T00:00:00Z`.           |
| `created_at_to`     | RFC3339        | no       | Inclusive upper bound on `created_date`.                                             |
| `modified_at_from`  | RFC3339        | no       | Inclusive lower bound on `modified_date`.                                            |
| `modified_at_to`    | RFC3339        | no       | Inclusive upper bound on `modified_date`.                                            |

### Filter semantics

- **Multi-value within an axis = OR.** Repeat the key:
  `?status=CLOSED&status=ACTION_BY_SE` returns rows in *either* status.
- **Across axes = AND.** Mixing different keys narrows the result:
  `?status=CLOSED&category=cat12` returns rows that are CLOSED **and** in category `cat12`.
- **Date ranges are inclusive on both ends.** If only one bound is given the other is open.
- **`created_at_from` must be ≤ `created_at_to`** (same for `modified_at_*`). Reversed → 400.

### Pagination

Cursor-based. Forward only. The server includes `next_cursor` whenever there's another page.
On the last page `next_cursor` is omitted (or `null`). Treat the cursor as opaque — never
construct or modify it. The cursor encodes the `complaint_id` of the last row in the current
page; it is **stable across filters** (you can pass the same `after=` value with a new filter
combination if your UI does that, but conceptually a cursor + filter pair is one paginated stream).

### Happy paths

```bash
# List, no filters, default limit (50)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints" | jq

# Custom limit
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?limit=5" | jq

# Cursor paging — page 1, capture next_cursor
NEXT=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?limit=5" | jq -r '.next_cursor')

# Page 2
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?limit=5&after=$NEXT" | jq
```

### Single-axis filters

```bash
# Intermediary filter — UI passes back IDs from /v1/entities/filter
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?entityscreenid=stb10700&limit=5" | jq

# Status filter (use any status returned by /v1/complaints/filters)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?status=CLOSED&limit=5" | jq

# Category filter (uses SEBI category CODE, not display name)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?category=cat12&limit=5" | jq

# Sub-category filter (exact string from /v1/complaints/filters.sub_categories[].name)
curl -s -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "sub_category=Mis-appropriation of client's funds / securities" \
  --get "$BASE_URL/v1/complaints?limit=5" | jq

# created_at range
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?created_at_from=2024-10-01T00:00:00Z&created_at_to=2024-10-31T23:59:59Z&limit=5" | jq

# modified_at range
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?modified_at_from=2024-10-01T00:00:00Z&modified_at_to=2024-12-31T23:59:59Z&limit=5" | jq
```

### Multi-value within an axis (repeated keys → OR)

```bash
# Two statuses
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?status=CLOSED&status=ACTION_BY_SE&limit=10" | jq

# Two categories
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?category=cat12&category=cat26&limit=10" | jq

# Two intermediaries
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?entityscreenid=stb10700&entityscreenid=mfd00041&limit=10" | jq
```

### Cross-axis combo (axes AND-combined)

```bash
# Status + category + created_at range
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?status=CLOSED&category=cat12&created_at_from=2024-10-01T00:00:00Z&limit=10" | jq
```

### Error cases

```bash
# Non-numeric limit → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?limit=abc"

# Garbage cursor → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?after=not-base64!!"

# Malformed timestamp → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?created_at_from=yesterday"

# Reversed date range → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints?created_at_from=2025-01-01T00:00:00Z&created_at_to=2024-01-01T00:00:00Z"

# Missing token → 401 auth.invalid_token
curl -s -i "$BASE_URL/v1/complaints"

# Bogus token → 401 auth.invalid_token
curl -s -i -H "Authorization: Bearer not.a.real.jwt" \
  "$BASE_URL/v1/complaints"
```

---

## 3. `GET /v1/complaints/filters`

Returns the **valid values** for each filter axis on `/v1/complaints`. Cheap, fixed-size
payload — call it **once when the filter drawer opens** and cache for the session. The
lists are *data-driven*: statuses come from `distinct(wfstate)`, categories and
sub-categories come from the corresponding master collections.

### Response (200)
```json
{
  "statuses": ["ACTION_BY_SE", "CLOSED", "MOVE_TO_REGULATORY_ACTION", "SECOND_LEVEL_REVIEW"],
  "categories": [
    { "code": "cat26", "name": "Bankers to the issue" },
    { "code": "cat48", "name": "Category 1 Alternative Investment Fund" },
    { "code": "cat12", "name": "Stock Broker" }
    // ...
  ],
  "sub_categories": [
    { "name": "Accessibility related issues faced by Person with Disabilities" },
    { "name": "Account opened in another name than as requested" }
    // ...
  ]
}
```

Field notes:

- `statuses[]` — array of opaque status codes. Show as-is or map to friendlier labels
  client-side. Pass back to `/v1/complaints?status=...`.
- `categories[].code` — what to send back to `/v1/complaints?category=<code>`. Stable.
- `categories[].name` — display label. May change over time; don't key UI state on it.
- `sub_categories[].name` — exact strings; that same string is what `/v1/complaints` returns
  in `sub_category` and what you send back via `?sub_category=...`.

### Curls
```bash
# Happy path
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/complaints/filters" | jq

# Missing token → 401
curl -s -i "$BASE_URL/v1/complaints/filters"
```

---

## 4. `GET /v1/entities/filter`

Typeahead lookup over the intermediary master (`entity_master`). Used to power the
"Intermediary" filter in the complaints list — the `id` returned here is what you
pass back as `entityscreenid` to `/v1/complaints`. `/v1/entities` and
`/v1/entities/{id}` are reserved for the full entity list / detail endpoints.

### Response (200)
```json
{
  "items": [
    { "id": "aif00039", "name": "HDFC AMC AIF –II(FORMERLY HDFC AMC REAL ESTATE AIF)" },
    { "id": "aif00137", "name": "HDFC CAPITAL AFFORDABLE REAL ESTATE FUND 1" }
  ],
  "next_cursor": "eyJ1IjoiYWlmbjAwMTkxIn0",
  "limit": 5
}
```

Field notes:

| Field    | Type   | Notes                                                                       |
|----------|--------|-----------------------------------------------------------------------------|
| `id`     | string | The intermediary ID. Pass to `/v1/complaints?entityscreenid=<id>`.          |
| `name`   | string | Display label. May contain non-ASCII / unicode dashes — render verbatim.    |

### Query parameters

| Param   | Type          | Description                                                                |
|---------|---------------|----------------------------------------------------------------------------|
| `q`     | string        | Prefix typeahead, **anchored** and **case-insensitive**. Empty / omitted → alphabetical list. |
| `limit` | int           | Default 50, max 200. Non-numeric → 400.                                    |
| `after` | opaque string | Cursor from a previous response's `next_cursor`. Treat as opaque.          |

Notes:
- Matching is **prefix-only** (anchored). `q=hdfc` matches "HDFC AMC AIF…" but **not** "ABC HDFC FUND".
- Sort is by `id` ASC. Pagination order is the same with or without `q`.
- Typeahead UX tip: debounce 150–250ms; abort in-flight requests when `q` changes.

### Happy paths

```bash
# Empty q — alphabetical first page
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities/filter" | jq

# Prefix typeahead — case-insensitive, anchored
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities/filter?q=HDFC&limit=5" | jq

# Cursor paging
NEXT=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities/filter?limit=5" | jq -r '.next_cursor')

curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities/filter?limit=5&after=$NEXT" | jq
```

### Error cases

```bash
# Non-numeric limit → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities/filter?limit=abc"

# Garbage cursor → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities/filter?after=not-base64!!"

# Missing token → 401
curl -s -i "$BASE_URL/v1/entities/filter"
```

---

## 5. `GET /v1/entities`

Full entity table with rolled-up complaint counts. Powers the Entities screen.
Includes intermediaries **and** listed companies; listed companies have
`category` and `registration_number` = `null`. Sorted by `uid DESC` (newest
registered first). Requires `business_user` or above.

### Response (200)
```json
{
  "items": [
    {
      "id": "stb10700",
      "entity": "HDFC SECURITIES LTD.",
      "entity_type": "intermediary",
      "category": "Stock Broker",            // resolved from category_master, nullable
      "registration_number": "INZ000186937", // nullable
      "total_complaints": 142,
      "open_complaints": 12,                 // wfstate != "CLOSED"
      "closed_complaints": 130               // wfstate == "CLOSED"
    },
    {
      "id": "i00470",
      "entity": "NORTHERN ARC CAPITAL LIMITED",
      "entity_type": "listed",
      "category": null,
      "registration_number": null,
      "total_complaints": 0,
      "open_complaints": 0,
      "closed_complaints": 0
    }
  ],
  "next_cursor": "eyJ1IjoyMDAwMH0",          // opaque base64. null/absent on the last page.
  "limit": 50
}
```

Field notes:

| Field                 | Type              | Notes                                                                          |
|-----------------------|-------------------|--------------------------------------------------------------------------------|
| `id`                  | string            | Entity ID. Same value `tt_complaints.entityscreenid` uses.                     |
| `entity`              | string            | Display name from `entity_master.name`.                                        |
| `entity_type`         | string            | e.g. `"intermediary"`, `"listed"`. Use `/v1/entities` itself to discover values. |
| `category`            | string \| null    | Human-readable category name. `null` for entities without a `categorycode`.    |
| `registration_number` | string \| null    | SEBI registration number. `null` for listed companies.                         |
| `total_complaints`    | int64             | `open + closed`. Always present (zero when entity has no complaints).          |
| `open_complaints`     | int64             | Count of `tt_complaints` with `wfstate != "CLOSED"`.                           |
| `closed_complaints`   | int64             | Count of `tt_complaints` with `wfstate == "CLOSED"`.                           |

### Query parameters

| Param         | Type           | Repeats? | Description                                                                          |
|---------------|----------------|----------|--------------------------------------------------------------------------------------|
| `limit`       | int            | no       | Page size. Default **50**, max **200**. Non-numeric → 400.                           |
| `after`       | opaque string  | no       | Cursor from a previous response's `next_cursor`. Treat as opaque.                    |
| `category`    | string         | **yes**  | SEBI category **code** (e.g. `cat12`), NOT the display name. OR within the axis.     |
| `entity_type` | string         | **yes**  | Entity type (e.g. `intermediary`, `listed`). OR within the axis.                     |

Cross-axis filters are AND-combined (same convention as `/v1/complaints`).

### Happy paths

```bash
# No filters, custom limit
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?limit=10" | jq

# Cursor paging — page 1, capture next_cursor
NEXT=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?limit=10" | jq -r '.next_cursor')

# Page 2
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?limit=10&after=$NEXT" | jq
```

### Single-axis filters

```bash
# Category filter (uses SEBI category code, not display name)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?category=cat12&limit=10" | jq

# Entity-type filter
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?entity_type=intermediary&limit=10" | jq
```

### Multi-value within an axis (repeated keys → OR)

```bash
# Two categories
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?category=cat12&category=cat2&limit=10" | jq

# Two entity types
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?entity_type=intermediary&entity_type=listed&limit=10" | jq
```

### Cross-axis combo (axes AND-combined)

```bash
# Category + entity_type
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?category=cat12&entity_type=intermediary&limit=10" | jq
```

### Error cases

```bash
# Non-numeric limit → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?limit=abc"

# Garbage cursor → 400 validation
curl -s -i -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/entities?after=not-base64!!"

# Missing token → 401
curl -s -i "$BASE_URL/v1/entities"
```

---

## 6. Putting it together — typical UI flows

### Filter drawer open (Complaints screen)
1. `GET /v1/complaints/filters` → populate the status / category / sub-category pickers.
2. `GET /v1/entities/filter` (or `?q=<prefix>` as the user types) → populate the intermediary picker.

### Apply filters & paginate (Complaints screen)
1. `GET /v1/complaints?<filters>&limit=50` → first page.
2. While `next_cursor` is present: `GET /v1/complaints?<same filters>&limit=50&after=<next_cursor>`.
3. When user changes any filter: discard the cursor and start from page 1.

### Entities screen
1. `GET /v1/entities?limit=50` → first page of the entity table (with counts).
2. Paginate via `next_cursor` exactly like complaints.
3. On row click, drill in via `GET /v1/complaints?entityscreenid=<row.id>` for that entity's complaints.

### Reading a row
- On `/v1/complaints`: `category` and `intermediary_name` may be `null` if the join didn't resolve — fall back to
  `entityscreenid` / category `code` for display.
- On `/v1/entities`: `category` and `registration_number` are `null` for listed companies.
- All timestamps are RFC3339 UTC; format with the user's local timezone client-side.

---

## 7. Quick smoke run (paste-friendly)

```bash
# Walks all happy paths in order — handy for verifying a fresh deploy.
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/complaints?limit=3" | jq
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/complaints/filters" | jq
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/entities/filter?q=HDFC&limit=3" | jq
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/entities?limit=3" | jq
```
