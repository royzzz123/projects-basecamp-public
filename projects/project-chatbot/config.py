from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_uri: str = Field(alias="MONGO_URI")
    mongo_db: str = Field(default="SEBI-project", alias="MONGO_DB")

    # Same env var names as project-ai — reuse the same AIRawat credentials.
    # Local dev: point at the OnFinance gateway (http://localhost:4000/v1/chat/completions).
    # SEBI VM:   point at the AIRawat Llama-70B endpoint directly.
    llm_llama_70b_url: str = Field(
        default="http://localhost:4000/v1/chat/completions",
        alias="LLM_LLAMA_70B_URL",
    )
    llm_llama_70b_bearer_token: str = Field(default="no-key", alias="LLM_LLAMA_70B_BEARER_TOKEN")
    llm_llama_70b_model_id: str = Field(
        default="bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
        alias="LLM_LLAMA_70B_MODEL_ID",
    )
    # Outbound proxy (required on SEBI VM — no direct internet). Empty for local dev.
    llm_http_proxy: str = Field(default="", alias="LLM_HTTP_PROXY")
    # CDAC certs may not be in the VM trust store.
    llm_verify_ssl: bool = Field(default=True, alias="LLM_VERIFY_SSL")

    app_port: int = Field(default=3001, alias="APP_PORT")

    @computed_field
    @property
    def llm_base_url(self) -> str:
        """Strip /chat/completions — ChatOpenAI needs the base URL only."""
        return self.llm_llama_70b_url.removesuffix("/chat/completions")


settings = Settings()
