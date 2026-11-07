# SEBI Complaint Workflow Analysis — API Reference

Base URL: `http://<host>:9000`

---

## 1. `GET /complaint-workflow-analysis/{complaint_id}`

Full workflow analysis — fetches the complaint, summarizes each attached document, enriches the activity timeline, and runs an LLM analysis across timeline quality, entity conduct, and investor grievance assessment.

**Path params:** `complaint_id` (int)

**Response 200:**
```json
{
  "complaint_id": 123,
  "complaint_code": "SCORES/2024/XXXX",
  "category": "string | null",
  "sub_category": "string | null",
  "entity_name": "string | null",
  "filed_at": "2024-01-15T10:30:00Z | null",
  "closed_at": "2024-02-20T14:00:00Z | null",
  "time_taken_label": "string | null",
  "current_status": "string | null",
  "enriched_timeline": [
    {
      "at": "2024-01-15T10:30:00Z | null",
      "role": "string | null",
      "action": "string | null",
      "wfstate": "string | null",
      "remarks": "string | null",
      "current_assignee_role": "string | null",
      "doc_summaries": [
        { "uuid": "string", "summary": "string | null", "error": "string | null" }
      ]
    }
  ],
  "workflow_analysis": {
    "timeline_quality": "string | null",
    "entity_conduct": "string | null",
    "investor_grievance_assessment": "string | null",
    "overall_summary": "string | null"
  }
}
```

**Errors:** `404` (complaint not found), `502` (upstream CRUD failure)

**Note:** Slow — does document OCR + multiple LLM calls.

---

## 2. `GET /complaint-summary/{complaint_id}`

Lightweight summary — fetches the complaint and summarizes only the investor's `complaint_details` text. No timeline / no workflow checks.

**Path params:** `complaint_id` (int)

**Response 200:**
```json
{
  "complaint_id": 123,
  "complaint_code": "SCORES/2024/XXXX",
  "category": "string | null",
  "sub_category": "string | null",
  "entity_name": "string | null",
  "filed_at": "2024-01-15T10:30:00Z | null",
  "complaint_details": "original raw complaint text from the investor",
  "summary": {
    "brief_summary": "2-4 sentence neutral paragraph",
    "key_issues": ["escalation channels unreachable", "fake call-back promises", "..."],
    "demands": ["Rs. 2000/day delay penalty", "Rs. 10,00,000 compensation"],
    "sentiment": "frustrated"
  }
}
```

**Errors:** `404` (complaint not found), `502` (upstream CRUD failure)

**Note:** Single LLM call — fast.

---

## Bonus

- `GET /health` → `{ "status": "ok" }` for liveness checks.
- Interactive API docs available at `/docs` (Swagger UI) and `/redoc` once the service is running.
