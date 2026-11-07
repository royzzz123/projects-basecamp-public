from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    crud_base_url: str = Field(default="http://localhost:8080", alias="CRUD_BASE_URL")
    crud_system_key: str = Field(default="", alias="CRUD_SYSTEM_KEY")

    minio_endpoint: str = Field(default="", alias="MINIO_ENDPOINT")
    minio_bucket: str = Field(default="", alias="MINIO_BUCKET")
    minio_secure: bool = Field(default=True, alias="MINIO_SECURE")
    minio_access_key: str = Field(default="", alias="MINIO_ACCESS_KEY")
    minio_secret_key: str = Field(default="", alias="MINIO_SECRET_KEY")

    llm_bearer_token: str = Field(default="", alias="LLM_BEARER_TOKEN")

    llm_nemotron_nano_url: str = Field(default="", alias="LLM_NEMOTRON_NANO_URL")
    llm_nemotron_120b_url: str = Field(default="", alias="LLM_NEMOTRON_120B_URL")
    llm_lighton_ocr_url: str = Field(default="", alias="LLM_LIGHTON_OCR_URL")
    llm_gemma_url: str = Field(default="", alias="LLM_GEMMA_URL")
    llm_llama_70b_url: str = Field(default="", alias="LLM_LLAMA_70B_URL")
    llm_ministral_url: str = Field(default="", alias="LLM_MINISTRAL_URL")

    llm_nemotron_nano_model_id: str = Field(
        default="nemotron-3-nano:30b-a3b-q4_K_M", alias="LLM_NEMOTRON_NANO_MODEL_ID"
    )
    llm_nemotron_120b_model_id: str = Field(
        default="nvidia/nemotron-3-super", alias="LLM_NEMOTRON_120B_MODEL_ID"
    )
    llm_lighton_ocr_model_id: str = Field(
        default="lightonai/LightOnOCR-2-1B-bbox", alias="LLM_LIGHTON_OCR_MODEL_ID"
    )
    llm_gemma_model_id: str = Field(
        default="gemma-4-26b-aa4b-it", alias="LLM_GEMMA_MODEL_ID"
    )
    llm_llama_70b_model_id: str = Field(
        default="meta/llama-3.3-70b-instruct", alias="LLM_LLAMA_70B_MODEL_ID"
    )
    llm_ministral_model_id: str = Field(
        default="ministral-3:14b-instruct-2512-q8_0", alias="LLM_MINISTRAL_MODEL_ID"
    )

    llm_llama_70b_bearer_token: str = Field(default="", alias="LLM_LLAMA_70B_BEARER_TOKEN")

    llm_http_proxy: str = Field(default="", alias="LLM_HTTP_PROXY")
    llm_verify_ssl: bool = Field(default=False, alias="LLM_VERIFY_SSL")

    http_timeout_seconds: int = Field(default=120, alias="HTTP_TIMEOUT_SECONDS")
    app_port: int = Field(default=9000, alias="APP_PORT")

    # ── Reclassification ────────────────────────────────────────────────
    # Logical model name (one of the keys in utils.llm._registry) used by the
    # /classify-sub-category endpoint. Same model used by all other pipeline
    # services (workflow_analyzer, complaint_summarizer, document_processor).
    reclassify_model: str = Field(default="nemotron-3-120b", alias="RECLASSIFY_MODEL")
    # Soft cap on the response budget. Reasoning models (nemotron-nano) eat
    # most of the token budget on reasoning before they emit content, so the
    # default is intentionally generous.
    reclassify_max_tokens: int = Field(default=800, alias="RECLASSIFY_MAX_TOKENS")


settings = Settings()
