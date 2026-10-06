from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    PROJECT_NAME: str = "Grounded Advisory Assistant"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "sqlite:///./data/app.db"
    POSTGRES_USER: Optional[str] = None
    POSTGRES_PASSWORD: Optional[str] = None
    POSTGRES_DB: Optional[str] = None

    # Security & JWT
    JWT_SECRET_KEY: str = "c8f1e29a34b578d0f12a3b4c5d6e7f80123456789abcdef0123456789abcdef0"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    RESET_TOKEN_EXPIRE_MINUTES: int = 15

    # Vector DB
    CHROMA_PERSIST_DIR: str = "./data/chromadb"
    VECTOR_DB_PATH: Optional[str] = None
    VECTOR_DB_TYPE: str = "chromadb"
    SIMILARITY_THRESHOLD: float = 0.50

    # LLM (Groq)
    LLM_PROVIDER: str = "groq"
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # Upload Limits
    MAX_UPLOAD_SIZE_BYTES: int = 25 * 1024 * 1024  # 25 MB
    DISABLE_RATE_LIMITS: bool = False

    # CORS & Public API
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    ALLOWED_ORIGINS: Optional[str] = None
    NEXT_PUBLIC_API_URL: str = "http://localhost:8000"

    @property
    def chroma_effective_dir(self) -> str:
        """Returns the effective vector store persistence path."""
        if os.environ.get("VERCEL"):
            return "/tmp/chromadb"
        return self.VECTOR_DB_PATH or self.CHROMA_PERSIST_DIR

    @property
    def effective_database_url(self) -> str:
        """Returns the effective database connection URL, adjusting for serverless environments."""
        if os.environ.get("VERCEL") and (
            not self.DATABASE_URL or self.DATABASE_URL.startswith("sqlite:///./data")
        ):
            return "sqlite:////tmp/app.db"
        return self.DATABASE_URL

    @property
    def cors_origins_list(self) -> List[str]:
        raw_origins = self.ALLOWED_ORIGINS or self.CORS_ORIGINS
        origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
        if self.ENVIRONMENT == "production" and "*" in origins:
            raise ValueError("Wildcard CORS origin '*' is strictly prohibited in production.")
        return origins

    def validate_production_configuration(self):
        """Validates critical enterprise security settings for production deployments."""
        if self.ENVIRONMENT == "production":
            # 1. Enforce high-entropy JWT secrets
            insecure_secret_indicators = [
                "dev-secret-key",
                "replace-with",
                "your-secret",
                "change-me",
                "default",
                "secret-replace",
            ]
            if (
                not self.JWT_SECRET_KEY
                or len(self.JWT_SECRET_KEY) < 32
                or any(ind in self.JWT_SECRET_KEY.lower() for ind in insecure_secret_indicators)
            ):
                raise ValueError(
                    "Production configuration error: JWT_SECRET_KEY must be set to a secure, "
                    "randomly generated key of at least 32 characters (e.g., via 'openssl rand -hex 32'). "
                    "Default or placeholder keys are strictly prohibited in production."
                )

            # 2. Enforce strong PostgreSQL credentials if PostgreSQL is configured
            is_postgres = self.DATABASE_URL.startswith("postgresql") or self.POSTGRES_PASSWORD is not None
            if is_postgres:
                pw = self.POSTGRES_PASSWORD or ""
                # Also extract password from DATABASE_URL if POSTGRES_PASSWORD not set directly
                if not pw and "@" in self.DATABASE_URL:
                    try:
                        user_pass = self.DATABASE_URL.split("://")[1].split("@")[0]
                        if ":" in user_pass:
                            pw = user_pass.split(":")[1]
                    except Exception:
                        pass

                insecure_passwords = ["postgres", "postgres_secure_pass_987", "password", "root", "admin", "123456"]
                min_len = 24 if self.POSTGRES_PASSWORD else 14
                if not pw or len(pw) < min_len or pw in insecure_passwords:
                    raise ValueError(
                        "Production configuration error: POSTGRES_PASSWORD must be a high-entropy string "
                        "with mixed case, digits, and symbols. Default values are prohibited."
                    )

            # 3. Enforce strict CORS whitelist
            if "*" in self.cors_origins_list:
                raise ValueError("Production configuration error: Wildcard CORS origin is prohibited.")

            # 4. Enforce production LLM credentials (fail closed)
            if (
                not self.GROQ_API_KEY
                or self.GROQ_API_KEY.startswith("gsk_mock")
                or self.GROQ_API_KEY.startswith("gsk_your")
                or "your_groq_api_key" in self.GROQ_API_KEY
            ):
                raise ValueError("Production configuration error: Valid GROQ_API_KEY is required.")

    model_config = SettingsConfigDict(
        env_file=[
            str(BASE_DIR.parent / ".env"),
            str(BASE_DIR / ".env"),
            ".env",
        ],
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

