# projects-basecamp

Monorepo for all services of an investor-complaint management platform.

## Repository structure

```
projects-basecamp/
└── projects/
    ├── project-ai/           # Python AI service (classification, sub-category, summaries)
    ├── project-chatbot/      # LangGraph chatbot (SSE streaming)
    ├── project-crud/         # Go CRUD / analytics API over MongoDB
    ├── project-db-uploader/  # Complaint document download/upload utility
    ├── project-fe/           # React/Vite frontend
    └── project-kg/           # KG + Systemic-Criticality auto-escalation (Neo4j, port 9010, UI at /autoescalation)
```

Each project keeps its own README, Dockerfile, `bare-metal/` build scripts and `k8s/` manifests.

## Configuration

All credentials in this repo are placeholders (`CHANGE_ME`, `replace-me…`, `<REDACTED_JWT>`).
Copy each project's `.env.example` to `.env` and fill in your own values. Complaint data is not included.

## Guidelines

- Branch off `main` for features (`feature/...`, `fix/...`) and open a PR.
- Never commit `.env` files — use each project's `.env.example`.
