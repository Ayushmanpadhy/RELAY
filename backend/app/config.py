from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Provider Keys
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""
    GITHUB_TOKEN: str = ""

    # Provider Endpoints & Models
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    GEMINI_MODEL: str = "gemini-3.6-flash"
    GEMINI_LITE_MODEL: str = "gemini-3.5-flash-lite"

    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_MODEL: str = "openai/gpt-oss-20b"

    MISTRAL_BASE_URL: str = "https://api.mistral.ai/v1"
    MISTRAL_MODEL: str = "mistral-small-latest"

    GITHUB_BASE_URL: str = "https://models.github.ai/inference"
    GITHUB_MODEL: str = "openai/gpt-4o-mini"

    # OpenRouter
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "nvidia/nemotron-3.5-lightning:free"

    # Firebase
    FIREBASE_PROJECT_ID: str = "relay"
    GOOGLE_APPLICATION_CREDENTIALS: str = "./secrets/firebase-service-account.json"
    FIREBASE_SERVICE_ACCOUNT_JSON: str = ""
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    # Admin
    ADMIN_EMAIL: str = "admin@gmail.com"
    ADMIN_PASSWORD: str = "admin123"

    # Worker Pool & Execution
    WORKER_NODE_COUNT: int = 100
    GLOBAL_CONCURRENCY: int = 10
    PER_PROVIDER_CONCURRENCY: int = 3
    MAX_ATTEMPTS: int = 4

    # Environment & Operator Controls
    APP_ENV: str = "development"  # 'development', 'test', 'production'
    ENABLE_CHAOS: int = 1
    JOB_TIMEOUT_SECONDS: float = 300.0

    # Switches
    RELAY_FAKE_PROVIDERS: int = 0
    RELAY_FIREBASE_EMULATOR: int = 0

    # Paths
    UPLOAD_DIR: Path = Field(
        default_factory=lambda: Path(__file__).parent.parent / "data" / "uploads"
    )

    def mask_key(self, key: str) -> str:
        if not key:
            return ""
        if len(key) <= 6:
            return "***"
        return f"***{key[-4:]}"

    def model_post_init(self, __context: object) -> None:
        # Validate Provider Keys
        if (
            not (
                self.GEMINI_API_KEY
                or self.GROQ_API_KEY
                or self.MISTRAL_API_KEY
                or self.GITHUB_TOKEN
                or self.OPENROUTER_API_KEY
            )
            and not self.RELAY_FAKE_PROVIDERS
        ):
            raise ValueError(
                "Configuration Error: No AI provider keys configured. At least one of GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY, or GITHUB_TOKEN must be provided."
            )

        # Validate URLs
        for name, url in [
            ("GEMINI_BASE_URL", self.GEMINI_BASE_URL),
            ("GROQ_BASE_URL", self.GROQ_BASE_URL),
            ("MISTRAL_BASE_URL", self.MISTRAL_BASE_URL),
            ("GITHUB_BASE_URL", self.GITHUB_BASE_URL),
            ("OPENROUTER_BASE_URL", self.OPENROUTER_BASE_URL),
            ("FRONTEND_ORIGIN", self.FRONTEND_ORIGIN),
        ]:
            if url and not (url.startswith("http://") or url.startswith("https://")):
                raise ValueError(
                    f"Configuration Error: {name} must be a valid HTTP or HTTPS URL (got '{url}')"
                )

        # Validate Numeric Limits
        if self.WORKER_NODE_COUNT <= 0:
            raise ValueError(
                f"Configuration Error: WORKER_NODE_COUNT must be positive (got {self.WORKER_NODE_COUNT})"
            )
        if self.GLOBAL_CONCURRENCY <= 0:
            raise ValueError(
                f"Configuration Error: GLOBAL_CONCURRENCY must be positive (got {self.GLOBAL_CONCURRENCY})"
            )
        if self.MAX_ATTEMPTS <= 0:
            raise ValueError(
                f"Configuration Error: MAX_ATTEMPTS must be positive (got {self.MAX_ATTEMPTS})"
            )

        # Validate Gemini and Gemini Lite are distinct
        if (
            self.GEMINI_MODEL
            and self.GEMINI_LITE_MODEL
            and self.GEMINI_MODEL.strip() == self.GEMINI_LITE_MODEL.strip()
        ):
            raise ValueError(
                f"Configuration Error: GEMINI_MODEL and GEMINI_LITE_MODEL must be distinct models (both set to '{self.GEMINI_MODEL}')"
            )

        # Production-specific validations
        if self.APP_ENV == "production":
            if self.RELAY_FAKE_PROVIDERS:
                raise ValueError(
                    "Security violation: RELAY_FAKE_PROVIDERS cannot be enabled in production environment."
                )
            if self.RELAY_FIREBASE_EMULATOR:
                raise ValueError(
                    "Security violation: RELAY_FIREBASE_EMULATOR cannot be enabled in production environment."
                )
            if self.ADMIN_PASSWORD == "admin123":
                raise ValueError(
                    "Security violation: ADMIN_PASSWORD must be changed from the default password in production environment."
                )
            cred_path = Path(self.GOOGLE_APPLICATION_CREDENTIALS)
            if not cred_path.is_absolute():
                cred_path = Path(__file__).parent.parent / cred_path
            if not cred_path.exists():
                raise ValueError(
                    f"Configuration Error: Missing Firebase service account credentials file at {cred_path}"
                )
            if "ENABLE_CHAOS" not in self.model_fields_set:
                self.ENABLE_CHAOS = 0


settings = Settings()
# Ensure upload dir exists
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
