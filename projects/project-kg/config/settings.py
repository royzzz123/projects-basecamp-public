from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── MongoDB (read-only source) ────────────────────────────────────────
    mongo_uri: str = Field(
        default="mongodb://localhost:27017/?directConnection=true", alias="MONGO_URI"
    )
    mongo_db: str = Field(default="SEBI-project", alias="MONGO_DB")

    # ── Neo4j (graph store of record) ─────────────────────────────────────
    neo4j_uri: str = Field(default="bolt://localhost:7687", alias="NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="NEO4J_USER")
    neo4j_password: str = Field(default="neo4j", alias="NEO4J_PASSWORD")

    # ── Inference backend (Phase 2 enrichment) ────────────────────────────
    # "claude_cli" = local Claude Code headless (no gateway/key); "gateway" = LiteLLM.
    inference_backend: str = Field(default="claude_cli", alias="INFERENCE_BACKEND")
    claude_model: str = Field(default="claude-haiku-4-5-20251001", alias="CLAUDE_MODEL")
    claude_cli_cwd: str = Field(default="/tmp", alias="CLAUDE_CLI_CWD")
    claude_timeout_seconds: int = Field(default=300, alias="CLAUDE_TIMEOUT_SECONDS")
    enrich_batch_size: int = Field(default=12, alias="ENRICH_BATCH_SIZE")
    enrich_workers: int = Field(default=5, alias="ENRICH_WORKERS")

    # ── LLM gateway (fallback backend for VM deployment) ──────────────────
    llm_bearer_token: str = Field(default="", alias="LLM_BEARER_TOKEN")
    llm_nemotron_120b_url: str = Field(default="", alias="LLM_NEMOTRON_120B_URL")
    llm_nemotron_120b_model_id: str = Field(
        default="nvidia/nemotron-3-super", alias="LLM_NEMOTRON_120B_MODEL_ID"
    )
    llm_http_proxy: str = Field(default="", alias="LLM_HTTP_PROXY")
    llm_verify_ssl: bool = Field(default=False, alias="LLM_VERIFY_SSL")

    enrichment_model: str = Field(default="nemotron-3-120b", alias="ENRICHMENT_MODEL")
    enrichment_max_tokens: int = Field(default=1200, alias="ENRICHMENT_MAX_TOKENS")

    # ── HTTP / app ────────────────────────────────────────────────────────
    http_timeout_seconds: int = Field(default=120, alias="HTTP_TIMEOUT_SECONDS")
    app_port: int = Field(default=9010, alias="APP_PORT")

    # ── ETL batch sizes ───────────────────────────────────────────────────
    etl_batch_complaints: int = Field(default=2000, alias="ETL_BATCH_COMPLAINTS")
    etl_batch_events: int = Field(default=5000, alias="ETL_BATCH_EVENTS")


settings = Settings()
