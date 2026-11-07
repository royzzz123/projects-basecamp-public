# Keyword Extraction — Scaling Notes

## Current implementation (POC)

`GET /v1/keywords` fetches all `complaint_details` texts for the requested
scope (entity or category+sub_category) on every request, then runs
document-frequency scoring in Go.

- **Latency**: 50–150 ms per request (dominated by MongoDB read)
- **Memory**: < 1 MB per request (texts are GC'd after scoring)
- **Concurrent load**: fine for low-traffic internal dashboards; degrades
  linearly under high concurrency because each request re-scans the same rows

---

## Scaling option 1 — lazy compute + MongoDB TTL cache (recommended next step)

On the first request for entity X or (category, sub_category) Y:
1. Compute keywords as today (~100 ms)
2. Write result to a `keyword_summaries` collection:
   ```json
   {
     "scope": "entity",
     "key": "stb11048",
     "keywords": ["unauthorized", "transfer", "freeze", "margin", "pledge"],
     "complaint_count": 676,
     "computed_at": ISODate("2025-06-30T10:00:00Z"),
     "expires_at": ISODate("2025-07-01T10:00:00Z")
   }
   ```
3. Index on `{ scope: 1, key: 1 }` (unique) + TTL index on `expires_at`
4. Subsequent requests → `findOne` point lookup → 5–10 ms

**Result**: first hit per entity is ~100 ms, all subsequent hits are ~10 ms,
cache auto-expires after 24 h so keywords stay fresh as new complaints arrive.

**Effort**: ~2–3 days (new collection, TTL index, cache read/write in service).

---

## Scaling option 2 — pre-compute everything at startup (highest performance)

At container startup, run one MongoDB aggregation that groups ALL
`complaint_details` by entity and by (category, sub_category) in a single
pass, compute keywords for every group, and write all results to
`keyword_summaries`.

- **Startup cost**: ~3–5 s for 17k complaints (acceptable)
- **Per-request latency**: 5–10 ms (always cached)
- **Freshness**: requires a nightly cron job or re-run on deploy

**When to use**: when the entity table or dashboard loads keywords for many
rows simultaneously (e.g., pre-loading all visible rows on page render).

---

## Scaling option 3 — true TF-IDF with global IDF (better keyword quality)

Current scoring = document frequency within the group only (no IDF).
This means a word that appears in EVERY complaint in the corpus can still
rank highly for a specific group.

Full TF-IDF adds the global IDF signal:
```
IDF(word) = log(total_complaints / complaints_containing_word)
```

1. At startup: fetch all `complaint_details`, build a global
   `word → document_count` map (~10–15 MB in RAM for 17k complaints, 1–3 s)
2. Store as a singleton `sync.Map` in the keyword service
3. Per request: combine per-group TF with the global IDF map

**When to use**: when keyword quality matters more than implementation
simplicity — e.g., if too many "universal" complaint words (account, broker,
trading) are leaking into results despite the stopword list.

---

## Summary

| Option | Latency (cold) | Latency (warm) | Effort | When |
|---|---|---|---|---|
| POC (current) | 50–150 ms | 50–150 ms | done | now |
| Lazy TTL cache | ~100 ms | 5–10 ms | 2–3 days | when dashboard goes live |
| Startup pre-compute | 3–5 s startup | 5–10 ms | 3–4 days | high concurrency or bulk load |
| Full TF-IDF | same as above | same | +1 day | if keyword quality is insufficient |
